export class VideoProcessor {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    
    // Default config
    this.config = {
      brightness: 100, // percentage
      contrast: 100, // percentage
      blur: 0, // px (suavização)
      zoom: 1, // scale multiplier
      chromaKey: {
        enabled: false,
        color: { r: 0, g: 255, b: 0 }, // default green
        similarity: 0.1, // 0 to 1
        smoothness: 0.1 // 0 to 1
      },
      aiBackground: false,
      mirror: false
    };

    this.stream = null;
    this.processedStream = null;
    this.animationId = null;

    // AI Variables
    this.segmentationModel = null;
    this.segmentationMask = null;
    this.isAiInitializing = false;
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    // Handle AI initialization
    if (this.config.aiBackground && !this.segmentationModel && !this.isAiInitializing) {
      this.initAI();
    }
  }

  setChromaColor(hexColor) {
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    this.config.chromaKey.color = { r, g, b };
  }

  async initAI() {
    if (typeof window.SelfieSegmentation === 'undefined') {
      console.warn("MediaPipe SelfieSegmentation library not loaded yet.");
      return;
    }

    this.isAiInitializing = true;
    window.dispatchEvent(new CustomEvent('ai-loading-start'));
    
    this.segmentationModel = new window.SelfieSegmentation({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
      }
    });

    this.segmentationModel.setOptions({
      modelSelection: 1, // 0 for general, 1 for landscape (faster)
    });

    this.segmentationModel.onResults((results) => {
      this.segmentationMask = results.segmentationMask;
      if (this.isAiInitializing) {
        this.isAiInitializing = false;
        window.dispatchEvent(new CustomEvent('ai-loading-end'));
      }
    });

    // Force model to load by sending a blank frame
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 64;
    tempCanvas.height = 64;
    try {
      await this.segmentationModel.send({ image: tempCanvas });
    } catch (e) {
      console.error("Error initializing AI", e);
      this.isAiInitializing = false;
      window.dispatchEvent(new CustomEvent('ai-loading-end'));
    }
  }

  processStream(rawStream) {
    if (!rawStream || rawStream.getVideoTracks().length === 0) return rawStream;

    this.stop();
    this.stream = rawStream;
    this.video.srcObject = this.stream;
    
    // Create new processed stream
    this.processedStream = this.canvas.captureStream(30);
    
    // Add audio tracks from original stream to the processed one
    this.stream.getAudioTracks().forEach(track => {
      this.processedStream.addTrack(track);
    });

    this.video.onloadedmetadata = () => {
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;
      this.video.play();
      this.loop();
    };

    return this.processedStream;
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (this.video.srcObject) {
      this.video.srcObject = null;
    }
    this.stream = null;
  }

  async processAIFrame() {
    if (this.segmentationModel && this.video.readyState >= 2) {
      await this.segmentationModel.send({ image: this.video });
    }
  }

  applyChromaKey(imageData) {
    const data = imageData.data;
    const { r: cr, g: cg, b: cb } = this.config.chromaKey.color;
    const similaritySq = Math.pow(this.config.chromaKey.similarity * 255, 2);
    const smoothSq = Math.pow(this.config.chromaKey.smoothness * 255, 2);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const distanceSq = Math.pow(r - cr, 2) + Math.pow(g - cg, 2) + Math.pow(b - cb, 2);

      if (distanceSq < similaritySq) {
        data[i + 3] = 0; // Fully transparent
      } else if (distanceSq < similaritySq + smoothSq && smoothSq > 0) {
        const factor = (distanceSq - similaritySq) / smoothSq;
        data[i + 3] = Math.floor(data[i + 3] * factor);
      }
    }
    return imageData;
  }

  setCustomBackground(file) {
    if (!file) {
      this.config.customBgImage = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      this.config.customBgImage = img;
    };
    img.src = URL.createObjectURL(file);
  }

  loop = async () => {
    if (!this.stream) return;

    const width = this.canvas.width;
    const height = this.canvas.height;

    // AI Segmentation processing (async)
    if (this.config.aiBackground && this.segmentationModel) {
      await this.processAIFrame();
    }

    // Prepare offscreen composition if we have AI
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.save();
    
    // Transform coordinates for video (Zoom & Mirror)
    if (this.config.mirror) {
      this.ctx.translate(width, 0);
      this.ctx.scale(-1, 1);
    }
    if (this.config.zoom !== 1) {
      this.ctx.translate(width / 2, height / 2);
      this.ctx.scale(this.config.zoom, this.config.zoom);
      this.ctx.translate(-width / 2, -height / 2);
    }

    // Apply Filter
    let filterStr = `brightness(${this.config.brightness}%) contrast(${this.config.contrast}%)`;
    if (this.config.blur > 0) filterStr += ` blur(${this.config.blur}px)`;
    this.ctx.filter = filterStr;

    // Draw Video
    this.ctx.drawImage(this.video, 0, 0, width, height);

    // Remove Filter
    this.ctx.filter = 'none';

    // If AI Background, mask it
    if (this.config.aiBackground && this.segmentationMask) {
      this.ctx.globalCompositeOperation = 'destination-in';
      this.ctx.drawImage(this.segmentationMask, 0, 0, width, height);
    }

    this.ctx.restore(); // Restore removes mirror, zoom, and any stray filter

    // Chroma Key
    if (this.config.chromaKey.enabled && !this.config.aiBackground) {
      const imageData = this.ctx.getImageData(0, 0, width, height);
      const processedData = this.applyChromaKey(imageData);
      this.ctx.putImageData(processedData, 0, 0);
    }

    // Custom Background (draw behind everything)
    if (this.config.customBgImage && (this.config.aiBackground || this.config.chromaKey.enabled)) {
      this.ctx.globalCompositeOperation = 'destination-over';
      // Draw background covering the canvas (cover logic)
      const imgAspectRatio = this.config.customBgImage.width / this.config.customBgImage.height;
      const canvasAspectRatio = width / height;
      let drawWidth = width;
      let drawHeight = height;
      let offsetX = 0;
      let offsetY = 0;

      if (imgAspectRatio > canvasAspectRatio) {
        drawWidth = height * imgAspectRatio;
        offsetX = (width - drawWidth) / 2;
      } else {
        drawHeight = width / imgAspectRatio;
        offsetY = (height - drawHeight) / 2;
      }

      this.ctx.drawImage(this.config.customBgImage, offsetX, offsetY, drawWidth, drawHeight);
      this.ctx.globalCompositeOperation = 'source-over';
    }

    this.animationId = requestAnimationFrame(this.loop);
  };
}
