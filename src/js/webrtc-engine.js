export class WebRTCEngine {
  constructor(signalingClient) {
    this.signaling = signalingClient;
    // Map of peerId -> RTCPeerConnection
    this.peerConnections = new Map();
    this.localStream = null;
    this.listeners = new Map();
    this.currentVideoQuality = 'normal';
    
    // Default STUN servers
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ];

    this.setupSignalingListeners();
  }

  async setVideoQuality(qualityMode) {
    this.currentVideoQuality = qualityMode;
    for (const [peerId, pc] of this.peerConnections.entries()) {
      await this.applyVideoQualityToPeer(pc);
    }
  }

  async applyVideoQualityToPeer(pc) {
    const senders = pc.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
    if (!videoSender) return;

    try {
      const parameters = videoSender.getParameters();
      if (!parameters.encodings || parameters.encodings.length === 0) {
        parameters.encodings = [{}];
      }
      
      const encoding = parameters.encodings[0];
      
      switch (this.currentVideoQuality) {
        case 'high':
          encoding.maxBitrate = 3000000; // 3 Mbps
          encoding.scaleResolutionDownBy = 1.0;
          break;
        case 'normal':
          encoding.maxBitrate = 1200000; // 1.2 Mbps
          encoding.scaleResolutionDownBy = 1.5;
          break;
        case 'low':
          encoding.maxBitrate = 500000;  // 500 kbps
          encoding.scaleResolutionDownBy = 2.0;
          break;
      }
      
      await videoSender.setParameters(parameters);
    } catch (err) {
      console.error('Failed to set video parameters:', err);
    }
  }

  setPlayoutDelay(delaySeconds) {
    this.playoutDelay = delaySeconds;
    for (const pc of this.peerConnections.values()) {
      pc.getReceivers().forEach(receiver => {
        if ('playoutDelayHint' in receiver) {
          try {
            receiver.playoutDelayHint = delaySeconds;
          } catch(e) {
            console.warn('Browser does not support playoutDelayHint', e);
          }
        }
      });
    }
  }

  setLocalStream(stream) {
    this.localStream = stream;
    
    // If we already have peer connections, we need to add the tracks or replace them
    for (const [peerId, pc] of this.peerConnections.entries()) {
      if (stream) {
        stream.getTracks().forEach(track => {
          // Check if sender already exists for this track kind
          const senders = pc.getSenders();
          const existingSender = senders.find(s => s.track && s.track.kind === track.kind);
          
          if (existingSender) {
            existingSender.replaceTrack(track);
          } else {
            pc.addTrack(track, stream);
          }
        });
        this.applyVideoQualityToPeer(pc);
      }
    }
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

  setupSignalingListeners() {
    this.signaling.on('peer-joined', async ({ peerId, role }) => {
      console.log(`Peer joined: ${peerId} (${role})`);
      // The sender initiates the connection.
      // With bidirectional gallery, we use deterministic initiator logic based on peerId
      const isInitiator = this.signaling.peerId > peerId;
      this.createPeerConnection(peerId, isInitiator);
    });

    this.signaling.on('room-info', (peers) => {
      console.log('Room info:', peers);
      for (const peer of peers) {
        const isInitiator = this.signaling.peerId > peer.peerId;
        this.createPeerConnection(peer.peerId, isInitiator);
      }
    });

    this.signaling.on('peer-left', (peerId) => {
      this.closePeerConnection(peerId);
    });

    this.signaling.on('offer', async (data) => {
      const { senderPeerId, sdp } = data;
      await this.handleOffer(senderPeerId, sdp);
    });

    this.signaling.on('answer', async (data) => {
      const { senderPeerId, sdp } = data;
      await this.handleAnswer(senderPeerId, sdp);
    });

    this.signaling.on('ice-candidate', async (data) => {
      const { senderPeerId, candidate } = data;
      await this.handleIceCandidate(senderPeerId, candidate);
    });
  }

  createPeerConnection(peerId, isInitiator) {
    if (this.peerConnections.has(peerId)) {
      console.warn(`Peer connection for ${peerId} already exists`);
      return this.peerConnections.get(peerId);
    }

    console.log(`Creating peer connection for ${peerId}, initiator: ${isInitiator}`);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.sendIceCandidate(peerId, event.candidate);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`ICE state for ${peerId}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        this.emit('peer-disconnected', peerId);
      } else if (pc.iceConnectionState === 'connected') {
        this.emit('peer-connected', peerId);
      }
    };

    pc.ontrack = (event) => {
      console.log(`Received track from ${peerId}`, event.streams[0]);
      this.emit('track-received', {
        peerId,
        track: event.track,
        stream: event.streams[0]
      });
    };

    // Add local stream if available
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
      // Apply the current quality setting to the newly added video track
      this.applyVideoQualityToPeer(pc);
    } else {
      // Explicitly add transceivers to ensure we receive media even if not sending
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    this.peerConnections.set(peerId, pc);

    if (isInitiator) {
      this.createAndSendOffer(peerId, pc);
    }

    return pc;
  }

  async createAndSendOffer(peerId, pc) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signaling.sendOffer(peerId, pc.localDescription);
    } catch (err) {
      console.error(`Error creating offer for ${peerId}:`, err);
    }
  }

  async handleOffer(peerId, sdp) {
    let pc = this.peerConnections.get(peerId);
    if (!pc) {
      pc = this.createPeerConnection(peerId, false);
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.signaling.sendAnswer(peerId, pc.localDescription);
    } catch (err) {
      console.error(`Error handling offer from ${peerId}:`, err);
    }
  }

  async handleAnswer(peerId, sdp) {
    const pc = this.peerConnections.get(peerId);
    if (!pc) {
      console.warn(`No peer connection for ${peerId} to handle answer`);
      return;
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch (err) {
      console.error(`Error handling answer from ${peerId}:`, err);
    }
  }

  async handleIceCandidate(peerId, candidate) {
    const pc = this.peerConnections.get(peerId);
    if (!pc) {
      console.warn(`No peer connection for ${peerId} to handle ICE candidate`);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error(`Error adding ICE candidate from ${peerId}:`, err);
    }
  }

  closePeerConnection(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
      this.emit('peer-disconnected', peerId);
      console.log(`Closed peer connection for ${peerId}`);
    }
  }

  disconnectAll() {
    for (const peerId of this.peerConnections.keys()) {
      this.closePeerConnection(peerId);
    }
  }
}
