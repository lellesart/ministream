import { AudioProcessor } from './audio-processor.js';
import { VideoProcessor } from './video-processor.js';

export class MediaManager {
  constructor(rtcEngine) {
    this.rtcEngine = rtcEngine;
    this.currentStream = null;
    this.rawStream = null; // Keep track of un-processed stream to stop tracks later
    this.audioProcessor = new AudioProcessor();
    this.videoProcessor = new VideoProcessor();
    this.listeners = new Map();
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

  async enumerateDevices() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        throw new Error('navigator.mediaDevices is unavailable. Are you using HTTPS or localhost?');
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(d => d.kind === 'videoinput');
      const microphones = devices.filter(d => d.kind === 'audioinput');
      return { cameras, microphones };
    } catch (err) {
      console.error('Error enumerating devices', err);
      return { cameras: [], microphones: [] };
    }
  }

  async startCamera(videoId, audioId, options = {}) {
    this.stopCurrentStream();
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('navigator.mediaDevices.getUserMedia is unavailable. WebRTC requires HTTPS or localhost.');
      }
      
      const {
        audioOnly = false,
        echoCancellation = true,
        autoGainControl = true,
        noiseSuppression = true
      } = options;

      const constraints = {
        video: audioOnly ? false : {
          deviceId: videoId ? { exact: videoId } : undefined,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          aspectRatio: { ideal: 1.7777777778 }
        },
        audio: {
          deviceId: audioId ? { exact: audioId } : undefined,
          echoCancellation,
          autoGainControl,
          noiseSuppression
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.handleNewStream(stream);
      return stream;
    } catch (err) {
      console.error('Error starting camera', err);
      if (err.name === 'NotAllowedError' || err.name === 'NotFoundError') {
        this.emit('media-error', err);
      }
      throw err;
    }
  }

  async startScreenShare(withAudio = true) {
    this.stopCurrentStream();
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error('navigator.mediaDevices.getDisplayMedia is unavailable. WebRTC requires HTTPS or localhost.');
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: withAudio
      });
      
      // Stop sharing when user clicks "Stop sharing" on the browser native UI
      stream.getVideoTracks()[0].onended = () => {
        this.emit('screen-share-ended');
      };

      this.handleNewStream(stream);
      return stream;
    } catch (err) {
      console.error('Error starting screen share', err);
      if (err.name === 'NotAllowedError') {
        this.emit('media-error', err);
      }
      throw err;
    }
  }

  async switchCamera(deviceId) {
    try {
      const constraints = { video: { deviceId: { exact: deviceId } } };
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newVideoTrack = newStream.getVideoTracks()[0];
      
      if (this.currentStream) {
        // Stop old track
        const oldTrack = this.currentStream.getVideoTracks()[0];
        if (oldTrack) {
          oldTrack.stop();
          this.currentStream.removeTrack(oldTrack);
        }
        // Add new track
        this.currentStream.addTrack(newVideoTrack);
        
        // Update RTC engine (it handles replaceTrack internally if setup properly)
        this.rtcEngine.setLocalStream(this.currentStream);
      }
      return this.currentStream;
    } catch (err) {
      console.error('Error switching camera', err);
      throw err;
    }
  }

  async switchMicrophone(deviceId) {
    try {
      const constraints = { audio: { deviceId: { exact: deviceId } } };
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newAudioTrack = newStream.getAudioTracks()[0];
      
      if (this.currentStream) {
        const oldTrack = this.currentStream.getAudioTracks()[0];
        if (oldTrack) {
          oldTrack.stop();
          this.currentStream.removeTrack(oldTrack);
        }
        this.currentStream.addTrack(newAudioTrack);
        this.rtcEngine.setLocalStream(this.currentStream);
      }
      return this.currentStream;
    } catch (err) {
      console.error('Error switching microphone', err);
      throw err;
    }
  }

  handleNewStream(stream) {
    this.rawStream = stream;
    
    // Process audio
    let processedStream = this.audioProcessor.processStream(stream);
    
    // Process video
    processedStream = this.videoProcessor.processStream(processedStream);
    
    this.currentStream = processedStream;
    this.rtcEngine.setLocalStream(this.currentStream);
    this.emit('stream-changed', this.currentStream);
  }

  toggleAudio() {
    if (!this.rawStream) return false;
    const track = this.rawStream.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      return track.enabled;
    }
    return false;
  }

  toggleVideo() {
    if (!this.rawStream) return false;
    const track = this.rawStream.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      return track.enabled;
    }
    return false;
  }

  stopCurrentStream() {
    if (this.rawStream) {
      this.rawStream.getTracks().forEach(track => track.stop());
      this.rawStream = null;
    }
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(track => track.stop());
      this.currentStream = null;
      this.rtcEngine.setLocalStream(null);
    }
    if (this.videoProcessor) {
      this.videoProcessor.stop();
    }
  }
}
