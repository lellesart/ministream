export class StatsMonitor {
  constructor(rtcEngine) {
    this.rtcEngine = rtcEngine;
    this.interval = null;
    this.listeners = new Map();
    this.previousStats = new Map(); // Store previous stats to calculate rates
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const callback of this.listeners.get(event)) {
        callback(data);
      }
    }
  }

  start(intervalMs = 2000) {
    if (this.interval) clearInterval(this.interval);
    
    this.interval = setInterval(() => {
      this.collectStats();
    }, intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async collectStats() {
    for (const [peerId, pc] of this.rtcEngine.peerConnections.entries()) {
      if (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') continue;

      try {
        const stats = await pc.getStats();
        const parsedStats = this.parseStats(stats, peerId);
        if (parsedStats) {
          this.emit('stats-updated', { peerId, stats: parsedStats });
        }
      } catch (err) {
        console.error('Error collecting stats:', err);
      }
    }
  }

  parseStats(stats, peerId) {
    let videoBitrate = 0;
    let audioBitrate = 0;
    let packetLoss = 0;
    let rtt = 0;

    const currentStats = { timestamp: Date.now() };

    stats.forEach(report => {
      if (report.type === 'outbound-rtp') {
        const isVideo = report.kind === 'video';
        
        currentStats[report.id] = {
          bytesSent: report.bytesSent,
          timestamp: report.timestamp
        };

        const prev = this.previousStats.get(`${peerId}-${report.id}`);
        if (prev) {
          const timeDiff = report.timestamp - prev.timestamp;
          if (timeDiff > 0) {
            const bitrate = 8 * (report.bytesSent - prev.bytesSent) / timeDiff; // kbps
            if (isVideo) videoBitrate += bitrate;
            else audioBitrate += bitrate;
          }
        }
        
        this.previousStats.set(`${peerId}-${report.id}`, currentStats[report.id]);
      } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        if (report.currentRoundTripTime !== undefined) {
          rtt = report.currentRoundTripTime * 1000; // ms
        }
      } else if (report.type === 'remote-inbound-rtp') {
        if (report.packetsLost) {
          packetLoss += report.packetsLost;
        }
      }
    });

    return {
      videoBitrate: Math.round(videoBitrate),
      audioBitrate: Math.round(audioBitrate),
      packetLoss,
      rtt: Math.round(rtt)
    };
  }
}
