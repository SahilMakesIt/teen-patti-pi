class SoundEffectsManager {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }

  getContext() {
    if (!this.enabled || typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
      } catch (_err) {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playTone(freqStart, freqEnd, durationMs, gainPeak = 0.08, type = 'triangle') {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + durationMs / 1000);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(gainPeak, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + durationMs / 1000);
    } catch (_err) {
      // Ignore audio failures cleanly
    }
  }

  playCardDeal() {
    this.playTone(460, 220, 65, 0.07, 'triangle');
  }

  playCardFlip() {
    this.playTone(540, 820, 80, 0.08, 'sine');
  }

  playChipBet() {
    this.playTone(980, 660, 70, 0.07, 'sine');
  }

  playPack() {
    this.playTone(300, 140, 120, 0.06, 'sawtooth');
  }

  playWinFanfare() {
    this.playTone(523.25, 659.25, 160, 0.09, 'triangle');
    setTimeout(() => this.playTone(659.25, 783.99, 200, 0.09, 'triangle'), 110);
    setTimeout(() => this.playTone(783.99, 1046.5, 280, 0.1, 'triangle'), 230);
  }
}

export const soundEffects = new SoundEffectsManager();
