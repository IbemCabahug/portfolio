/**
 * Zero-Asset Procedural Audio Engine for Ibem's Tavern
 * Synthesizes ambient hearth crackle, diegetic UI interactions, room acoustics,
 * and parchment rustle entirely via Web Audio API. Zero audio asset download overhead.
 */

import { getSound, subscribePreferences } from '../store/preferences';

class TavernSoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private hearthGain: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private isHearthActive = false;
  private crackleTimeoutId: number | null = null;
  private clinkTimeoutId: number | null = null;
  private brownNoiseNode: AudioNode | null = null;
  private droneOsc1: OscillatorNode | null = null;
  private droneOsc2: OscillatorNode | null = null;
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

    // Handle tab visibility to prevent background sound waste
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

    // Check initial preference with user gesture unlocking
    if (getSound() === 'on') {
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
      if (this.masterGain) {
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, this.ctx.currentTime);
        this.masterGain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);
      }
      setTimeout(() => {
        this.ctx?.suspend();
      }, 260);
    }
  }

  /**
   * Duck ambient audio during active simulations or dialogue
   */
  public duckAmbient(duck: boolean) {
    if (!this.ctx || !this.hearthGain || !this.isHearthActive) return;
    const now = this.ctx.currentTime;
    const target = duck ? 0.02 : 0.075;
    this.hearthGain.gain.cancelScheduledValues(now);
    this.hearthGain.gain.setValueAtTime(this.hearthGain.gain.value, now);
    this.hearthGain.gain.linearRampToValueAtTime(target, now + 0.35);
  }

  /**
   * Continuous procedural hearth fire synthesis
   * Combines low-frequency Brownian chimney draft, resonant ember crackles,
   * warm chamber harmonic drone, and subtle distant room clinks.
   */
  private startHearthAmbient() {
    const ctx = this.getContext();
    if (!ctx || this.isHearthActive) return;
    this.isHearthActive = true;

    // 1. Dedicated hearth sub-master gain
    this.hearthGain = ctx.createGain();
    this.hearthGain.gain.setValueAtTime(0.001, ctx.currentTime);
    this.hearthGain.gain.linearRampToValueAtTime(0.075, ctx.currentTime + 0.8);
    this.hearthGain.connect(this.masterGain || ctx.destination);

    // 2. Continuous warm low-frequency chimney air draft (5-second looped Brownian noise buffer)
    const bufferSize = ctx.sampleRate * 5;
    const brownBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = brownBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = output[i];
      output[i] *= 3.2;
    }

    const brownSource = ctx.createBufferSource();
    brownSource.buffer = brownBuffer;
    brownSource.loop = true;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(170, ctx.currentTime);
    lowpass.Q.setValueAtTime(1.1, ctx.currentTime);

    brownSource.connect(lowpass);
    lowpass.connect(this.hearthGain);
    brownSource.start();
    this.brownNoiseNode = brownSource;

    // 3. Warm Tavern Room Tone (Gentle harmonic fifth drone: D2=73.4Hz + A2=110Hz)
    this.droneGain = ctx.createGain();
    this.droneGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.droneGain.gain.linearRampToValueAtTime(0.012, ctx.currentTime + 1.2);

    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.setValueAtTime(140, ctx.currentTime);

    this.droneOsc1 = ctx.createOscillator();
    this.droneOsc1.type = 'sine';
    this.droneOsc1.frequency.setValueAtTime(73.42, ctx.currentTime); // D2

    this.droneOsc2 = ctx.createOscillator();
    this.droneOsc2.type = 'sine';
    this.droneOsc2.frequency.setValueAtTime(110.0, ctx.currentTime); // A2

    this.droneOsc1.connect(droneFilter);
    this.droneOsc2.connect(droneFilter);
    droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.hearthGain);

    this.droneOsc1.start();
    this.droneOsc2.start();

    // 4. Procedural Ember Pops with Dual-Resonance Physics
    const schedulePops = () => {
      if (!this.isHearthActive || !this.ctx || !this.hearthGain) return;

      const now = this.ctx.currentTime;
      // Organic crackle clustering: 2-5 pops per cluster
      const popCount = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < popCount; i++) {
        const popTime = now + Math.random() * 0.28;
        this.synthesizeDualCrackle(popTime);
      }

      // Vary the next interval: small burst or brief pause
      const nextDelay = Math.random() > 0.3 ? 180 + Math.random() * 220 : 500 + Math.random() * 600;
      this.crackleTimeoutId = window.setTimeout(schedulePops, nextDelay);
    };

    schedulePops();

    // 5. Rare Distant Tavern Ambience (subtle soft tankard clink every 18-35s)
    const scheduleDistantClink = () => {
      if (!this.isHearthActive || !this.ctx || !this.hearthGain) return;
      const delay = 18000 + Math.random() * 17000;
      this.clinkTimeoutId = window.setTimeout(() => {
        if (!this.isHearthActive) return;
        this.playDistantTankard();
        scheduleDistantClink();
      }, delay);
    };

    scheduleDistantClink();
  }

  /**
   * Dual-Resonance Firewood Crackle:
   * Layer 1: High-frequency sharp acoustic snap (1.8kHz - 3.8kHz)
   * Layer 2: Warm mid-frequency woody body pop (380Hz - 720Hz with resonance)
   */
  private synthesizeDualCrackle(time: number) {
    if (!this.ctx || !this.hearthGain) return;

    try {
      const crackleLength = 0.016 + Math.random() * 0.032; // 16ms - 48ms
      const buffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * crackleLength), this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let j = 0; j < data.length; j++) {
        data[j] = (Math.random() * 2 - 1) * Math.exp(-j / (this.ctx.sampleRate * 0.007));
      }

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;

      // Layer 1: Sharp crisp snap
      const highFilter = this.ctx.createBiquadFilter();
      highFilter.type = 'highpass';
      highFilter.frequency.setValueAtTime(1800 + Math.random() * 2200, time);

      const highGain = this.ctx.createGain();
      const highVol = 0.035 + Math.random() * 0.06;
      highGain.gain.setValueAtTime(highVol, time);
      highGain.gain.exponentialRampToValueAtTime(0.001, time + crackleLength);

      source.connect(highFilter);
      highFilter.connect(highGain);
      highGain.connect(this.hearthGain);

      // Layer 2: Warm woody pop resonance (gives firewood depth)
      const bodyFilter = this.ctx.createBiquadFilter();
      bodyFilter.type = 'bandpass';
      bodyFilter.frequency.setValueAtTime(380 + Math.random() * 340, time);
      bodyFilter.Q.setValueAtTime(2.8, time);

      const bodyGain = this.ctx.createGain();
      const bodyVol = 0.04 + Math.random() * 0.07;
      bodyGain.gain.setValueAtTime(bodyVol, time);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, time + crackleLength * 1.3);

      source.connect(bodyFilter);
      bodyFilter.connect(bodyGain);
      bodyGain.connect(this.hearthGain);

      source.start(time);
    } catch (e) {}
  }

  /**
   * Subtle distant wooden/ceramic tankard clink
   */
  private playDistantTankard() {
    if (!this.ctx || !this.hearthGain) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = 'sine';
      const freq = 1350 + Math.random() * 250;
      osc.frequency.setValueAtTime(freq, now);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq, now);
      filter.Q.setValueAtTime(4.0, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.016, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.hearthGain);

      osc.start(now);
      osc.stop(now + 0.38);
    } catch (e) {}
  }

  private stopHearthAmbient() {
    this.isHearthActive = false;
    if (this.crackleTimeoutId !== null) {
      clearTimeout(this.crackleTimeoutId);
      this.crackleTimeoutId = null;
    }
    if (this.clinkTimeoutId !== null) {
      clearTimeout(this.clinkTimeoutId);
      this.clinkTimeoutId = null;
    }

    if (this.ctx && this.hearthGain) {
      this.hearthGain.gain.setValueAtTime(this.hearthGain.gain.value, this.ctx.currentTime);
      this.hearthGain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
      setTimeout(() => {
        try {
          if (this.brownNoiseNode && 'stop' in this.brownNoiseNode) {
            (this.brownNoiseNode as AudioBufferSourceNode).stop();
          }
          if (this.droneOsc1) {
            this.droneOsc1.stop();
            this.droneOsc1.disconnect();
            this.droneOsc1 = null;
          }
          if (this.droneOsc2) {
            this.droneOsc2.stop();
            this.droneOsc2.disconnect();
            this.droneOsc2 = null;
          }
          this.droneGain?.disconnect();
          this.droneGain = null;
          this.hearthGain?.disconnect();
          this.hearthGain = null;
        } catch (e) {}
      }, 320);
    }
  }

  /**
   * Tactile wooden token / button clink
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
