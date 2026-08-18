export class AudioProcessor {
  constructor() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    this.gainNode = this.audioContext.createGain();
    
    // Compressor for leveling
    this.compressor = this.audioContext.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 30;
    this.compressor.ratio.value = 12;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    // Filters for basic EQ / Noise Reduction
    this.highpassFilter = this.audioContext.createBiquadFilter();
    this.highpassFilter.type = 'highpass';
    this.highpassFilter.frequency.value = 80; // Cut low rumble

    this.sourceNode = null;
    this.destinationNode = this.audioContext.createMediaStreamDestination();

    // Connect graph: Source -> Highpass -> Gain -> Compressor -> Analyser -> Destination
    this.highpassFilter.connect(this.gainNode);
    this.gainNode.connect(this.compressor);
    this.compressor.connect(this.analyser);
    this.analyser.connect(this.destinationNode);
    
    this.isMuted = false;
    this.previousVolume = 1.0;
  }

  processStream(stream) {
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return stream;

    // Disconnect old source if exists
    if (this.sourceNode) {
      this.sourceNode.disconnect();
    }

    // Create a new stream with only the audio track to avoid adding video to audio context
    const audioStream = new MediaStream([audioTracks[0]]);
    this.sourceNode = this.audioContext.createMediaStreamSource(audioStream);
    this.sourceNode.connect(this.highpassFilter);

    // Return a new stream containing the original video (if any) and the processed audio
    const processedStream = new MediaStream();
    
    stream.getVideoTracks().forEach(track => processedStream.addTrack(track));
    
    // Add the processed audio track
    const processedAudioTrack = this.destinationNode.stream.getAudioTracks()[0];
    processedStream.addTrack(processedAudioTrack);

    // Sync muted state
    if (this.isMuted) {
      this.gainNode.gain.value = 0;
    }

    return processedStream;
  }

  setVolume(volume) {
    if (!this.isMuted) {
      this.gainNode.gain.value = volume;
      this.previousVolume = volume;
    } else {
      this.previousVolume = volume; // Save for when unmuted
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.gainNode.gain.value = 0;
    } else {
      this.gainNode.gain.value = this.previousVolume;
    }
    return this.isMuted;
  }

  getVolumeLevel() {
    this.analyser.getByteFrequencyData(this.dataArray);
    
    // Calculate RMS average
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i] * this.dataArray[i];
    }
    const rms = Math.sqrt(sum / this.dataArray.length);
    
    // Return normalized value 0.0 to 1.0
    return Math.min(1.0, rms / 255.0);
  }

  enableNoiseSuppression(enable) {
    // A simplistic approach: increase highpass filter frequency when enabled
    if (enable) {
      this.highpassFilter.frequency.value = 150; 
    } else {
      this.highpassFilter.frequency.value = 80;
    }
  }
}
