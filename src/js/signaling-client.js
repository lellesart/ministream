export class SignalingClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.peerId = this.generateId();
    this.roomId = null;
    this.role = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  generateId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
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

  connect(roomId, role) {
    this.roomId = roomId;
    this.role = role;

    return new Promise((resolve, reject) => {
      try {
        // Determine correct ws protocol based on location protocol
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        
        // 1. Try environment variable (Vercel/Netlify injects this at build time)
        // 2. Try explicitly passed URL
        // 3. Fallback for Local Dev (port 3000)
        // 4. Fallback for Same-Server Production (same host)
        const envWsUrl = import.meta.env.VITE_WS_URL;
        const wsUrl = envWsUrl || this.url || (import.meta.env.DEV ? `ws://${window.location.hostname}:3000` : `${protocol}//${window.location.host}/ws`);
        
        console.log('Connecting to signaling server:', wsUrl);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('Connected to signaling server');
          this.reconnectAttempts = 0;
          
          // Join the room
          this.send({
            type: 'join',
            roomId: this.roomId,
            peerId: this.peerId,
            role: this.role
          });
          
          resolve(this.peerId);
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (err) {
            console.error('Failed to parse signaling message:', err);
          }
        };

        this.ws.onclose = () => {
          console.log('Disconnected from signaling server');
          this.emit('disconnected');
          this.attemptReconnect();
        };

        this.ws.onerror = (err) => {
          console.error('WebSocket error:', err);
          if (this.ws.readyState === WebSocket.CONNECTING) {
            reject(err);
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
      console.log(`Attempting to reconnect in ${delay}ms... (Attempt ${this.reconnectAttempts})`);
      setTimeout(() => {
        if (this.roomId && this.role) {
          this.connect(this.roomId, this.role).catch(console.error);
        }
      }, delay);
    } else {
      console.error('Max reconnect attempts reached');
      this.emit('reconnect-failed');
    }
  }

  handleMessage(data) {
    switch (data.type) {
      case 'room-info':
        this.emit('room-info', data.peers);
        break;
      case 'peer-joined':
        this.emit('peer-joined', { peerId: data.peerId, role: data.role });
        break;
      case 'peer-left':
        this.emit('peer-left', data.peerId);
        break;
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        this.emit(data.type, data);
        break;
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('Cannot send message, WebSocket is not open', data);
    }
  }

  sendOffer(targetPeerId, sdp) {
    this.send({ type: 'offer', targetPeerId, sdp });
  }

  sendAnswer(targetPeerId, sdp) {
    this.send({ type: 'answer', targetPeerId, sdp });
  }

  sendIceCandidate(targetPeerId, candidate) {
    this.send({ type: 'ice-candidate', targetPeerId, candidate });
  }

  disconnect() {
    if (this.ws) {
      // Prevent reconnects when intentionally disconnecting
      this.maxReconnectAttempts = 0; 
      this.ws.close();
      this.ws = null;
    }
  }
}
