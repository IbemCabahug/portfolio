/**
 * Zero-Asset Procedural Audio Engine for Ibem's Tavern
 * Synthesizes ambient hearth crackle, diegetic UI interactions, and parchment
 * rustle entirely via Web Audio API. Zero audio asset download overhead.
 */

import { getSound, subscribePreferences } from '../store/preferences';

class TavernSoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private hearthGain: GainNode | null = null;
  private isHearthActive = false;
  private crackleIntervalId: number | null = null;
  private brownNoiseNode: AudioNode | null = null;
  private isInitialized = false;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return null;
      this.ctx = new AudioCtxClass();
      
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  public init() {
    if (this.isInitialized || typeof window === 'undefined') return;
    this.isInitialized = true;

    // Handle tab visibility to prevent annoying background sound
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) {
        if (this.ctx.state === 'running') {
          this.ctx.suspend();
        }
      } else {
        if (getSound() === 'on' && this.ctx.state === 'suspended') {
          this.ctx.resume();
        }
      }
    });

    // React to preference store changes
    subscribePreferences(() => {
      const sound = getSound();
      if (sound === 'on') {
        this.enable();
      } else {
        this.disable();
      }
    });

    // Check initial preference
    if (getSound() === 'on') {
      // Browsers block autoplay without user gesture,
      // so on first interaction, resume
      const unlockAudio = () => {
        if (getSound() === 'on') {
          this.enable();
        }
        window.removeEventListener('click', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
      };
      window.addEventListener('click', unlockAudio, { once: true });
      window.addEventListener('keydown', unlockAudio, { once: true });
    }
  }

  public async enable() {
    const ctx = this.getContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    this.startHearthAmbient();
  }

  public disable() {
    this.stopHearthAmbient();
    if (this.ctx && this.ctx.state === 'running') {
      // Smoothly fade out then suspend
      if (this.masterGain) {
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, this.ctx.currentTime);
        this.masterGain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
      }
      setTimeout(() => {
        this.ctx?.suspend();
      }, 160);
    }
  }

  /**
   * Continuous procedural hearth fire synthesis
   * Combines low-frequency Brownian draft rumble with randomized popping sparks
   */
  private startHearthAmbient() {
    const ctx = this.getContext();
    if (!ctx || this.isHearthActive) return;
    this.isHearthActive = true;

    // 1. Create dedicated hearth sub-master gain
    this.hearthGain = ctx.createGain();
    this.hearthGain.gain.setValueAtTime(0.001, ctx.currentTime);
    this.hearthGain.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 0.8);
    this.hearthGain.connect(this.masterGain || ctx.destination);

    // 2. Continuous warm low-frequency air rumble (5-second looped Brownian noise buffer)
    const bufferSize = ctx.sampleRate * 5;
    const brownBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = brownBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5; // Boost low Brownian energy
    }

    const brownSource = ctx.createBufferSource();
    brownSource.buffer = brownBuffer;
    brownSource.loop = true;

    // Filter to warm hearth chimney frequencies (120Hz - 240Hz)
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(180, ctx.currentTime);
    lowpass.Q.setValueAtTime(1.2, ctx.currentTime);

    brownSource.connect(lowpass);
    lowpass.connect(this.hearthGain);
    brownSource.start();
    this.brownNoiseNode = brownSource;

    // 3. Procedural Ember Pops & Crackles
    const schedulePops = () => {
      if (!this.isHearthActive || !this.ctx || !this.hearthGain) return;

      const now = this.ctx.currentTime;
      // Schedule 3-6 random micro-crackles in the next 300ms
      const popCount = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < popCount; i++) {
        const popTime = now + Math.random() * 0.35;
        this.synthesizeSingleCrackle(popTime);
      }

      this.crackleIntervalId = window.setTimeout(schedulePops, 250);
    };

    schedulePops();
  }

  private synthesizeSingleCrackle(time: number) {
    if (!this.ctx || !this.hearthGain) return;

    try {
      // High-pass filtered impulse noise
      const crackleLength = 0.015 + Math.random() * 0.035; // 15ms - 50ms
      const buffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * crackleLength), this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let j = 0; j < data.length; j++) {
        data[j] = (Math.random() * 2 - 1) * Math.exp(-j / (this.ctx.sampleRate * 0.008));
      }

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(1200 + Math.random() * 2400, time);

      const gain = this.ctx.createGain();
      const popVolume = 0.04 + Math.random() * 0.09;
      gain.gain.setValueAtTime(popVolume, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + crackleLength);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.hearthGain);

      source.start(time);
    } catch (e) {
      // Graceful ignore if context closed
    }
  }

  private stopHearthAmbient() {
    this.isHearthActive = false;
    if (this.crackleIntervalId !== null) {
      clearTimeout(this.crackleIntervalId);
      this.crackleIntervalId = null;
    }

    if (this.ctx && this.hearthGain) {
      this.hearthGain.gain.setValueAtTime(this.hearthGain.gain.value, this.ctx.currentTime);
      this.hearthGain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
      setTimeout(() => {
        try {
          if (this.brownNoiseNode && 'stop' in this.brownNoiseNode) {
            (this.brownNoiseNode as AudioBufferSourceNode).stop();
          }
          this.hearthGain?.disconnect();
          this.hearthGain = null;
        } catch (e) {}
      }, 320);
    }
  }

  /**
   * Tactile wooden token / button clink
   * A gentle decaying pitch-drop triangle wave
   */
  public playWoodClink() {
    if (getSound() !== 'on') return;
    const ctx = this.getContext();
    if (!ctx || ctx.state !== 'running') return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      const now = ctx.currentTime;

      osc.frequency.setValueAtTime(460, now);
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.07);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc.connect(gain);
      gain.connect(this.masterGain || ctx.destination);

      osc.start(now);
      osc.stop(now + 0.08);
    } catch (e) {}
  }

  /**
   * Parchment scroll unroll / rustle
   * Soft bandpass-filtered noise sweep
   */
  public playParchmentRustle() {
    if (getSound() !== 'on') return;
    const ctx = this.getContext();
    if (!ctx || ctx.state !== 'running') return;

    try {
      const duration = 0.16;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      const now = ctx.currentTime;
      filter.frequency.setValueAtTime(800, now);
      filter.frequency.linearRampToValueAtTime(1600, now + duration * 0.5);
      filter.frequency.linearRampToValueAtTime(600, now + duration);
      filter.Q.setValueAtTime(2.0, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.09, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain || ctx.destination);

      source.start(now);
    } catch (e) {}
  }
}

export const soundEngine = new TavernSoundEngine();
