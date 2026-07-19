/**
 * Shared Web Audio engine for the Sound Laboratory stations
 * (src/app/blog/sound-laboratory). Client-side only.
 *
 * Conventions (established by DissonanceDemo, #3159):
 * - The AudioContext is created lazily, on a user gesture (browser requirement).
 * - All level changes ramp via setTargetAtTime — no clicks.
 * - Callers own teardown: suspend() on pause, dispose() on unmount.
 *
 * Three timbres: 'sine' (pure tone — psychoacoustics stations), 'rich'
 * (six harmonics at 1/n^1.5 — tuning-preference stations, where beating
 * between upper partials is the audible difference between temperaments),
 * and 'pulse' (a click train: hundreds of near-equal harmonics, so the same
 * oscillator is countable ticks at 2 Hz and a buzzy pitch at 200 Hz — the
 * Galileo rhythm-becomes-pitch continuum needs one mechanism across both).
 */

export type Timbre = 'sine' | 'rich' | 'pulse';

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
  lfo?: OscillatorNode;
}

export class ToneEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private richWave: PeriodicWave | null = null;
  private pulseWave: PeriodicWave | null = null;
  private voices = new Map<string, Voice>();

  /** Create (or resume) the context. Call only from a user-gesture handler. */
  ensure(): AudioContext | null {
    if (this.ctx) {
      void this.ctx.resume();
      return this.ctx;
    }
    const Ctx: typeof AudioContext | undefined =
      typeof window !== 'undefined'
        ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    const n = 6;
    const real = new Float32Array(n + 1);
    const imag = new Float32Array(n + 1);
    for (let i = 1; i <= n; i++) imag[i] = 1 / Math.pow(i, 1.5);
    this.richWave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    // Click train: near-flat spectrum. WebAudio band-limits PeriodicWave per
    // octave, so the same wave is safe from 2 Hz (ticks) to 300 Hz (a tone).
    const pn = 1024;
    const preal = new Float32Array(pn + 1);
    const pimag = new Float32Array(pn + 1);
    for (let i = 1; i <= pn; i++) pimag[i] = 1 / Math.pow(i, 0.2);
    this.pulseWave = ctx.createPeriodicWave(preal, pimag, { disableNormalization: false });
    this.ctx = ctx;
    this.master = master;
    return ctx;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Master bus, for stations that build their own node graphs (resonator banks). */
  get output(): GainNode | null {
    return this.master;
  }

  private applyTimbre(osc: OscillatorNode, timbre: Timbre) {
    if (timbre === 'rich' && this.richWave) osc.setPeriodicWave(this.richWave);
    else if (timbre === 'pulse' && this.pulseWave) osc.setPeriodicWave(this.pulseWave);
    else osc.type = 'sine';
  }

  /** Create or retune a sustained voice. Level is per-voice (0..1). */
  setVoice(id: string, freq: number, level: number, timbre: Timbre = 'sine') {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const existing = this.voices.get(id);
    if (existing) {
      existing.osc.frequency.setTargetAtTime(freq, t, 0.02);
      existing.gain.gain.setTargetAtTime(level, t, 0.03);
      return;
    }
    const osc = ctx.createOscillator();
    this.applyTimbre(osc, timbre);
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    gain.gain.setTargetAtTime(level, t, 0.03);
    this.voices.set(id, { osc, gain });
  }

  /**
   * A sustained voice that glides continuously between two frequencies —
   * Kepler's planet-song, "a continuous series of intermediate notes"
   * (Harmonices Mundi V.6). Sine-shaped sweep, one full cycle per `periodS`.
   */
  setSiren(id: string, fLow: number, fHigh: number, periodS: number, level: number, timbre: Timbre = 'sine') {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.removeVoice(id);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    this.applyTimbre(osc, timbre);
    osc.frequency.value = (fLow + fHigh) / 2;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 1 / periodS;
    const depth = ctx.createGain();
    depth.gain.value = (fHigh - fLow) / 2;
    lfo.connect(depth);
    depth.connect(osc.frequency);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    lfo.start();
    gain.gain.setTargetAtTime(level, t, 0.03);
    this.voices.set(id, { osc, gain, lfo });
  }

  removeVoice(id: string) {
    const ctx = this.ctx;
    const v = this.voices.get(id);
    if (!ctx || !v) return;
    v.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    const osc = v.osc;
    const lfo = v.lfo;
    window.setTimeout(() => {
      try { osc.stop(); lfo?.stop(); } catch { /* stopped */ }
    }, 150);
    this.voices.delete(id);
  }

  stopAllVoices() {
    for (const id of [...this.voices.keys()]) this.removeVoice(id);
  }

  suspend() {
    const ctx = this.ctx;
    if (!ctx) return;
    window.setTimeout(() => { void ctx.suspend(); }, 180);
  }

  /**
   * Play one enveloped tone (or a chord) for `ms`, resolving when it ends.
   * Used by the trial-based stations (śruti test, Salmon trial).
   */
  playTones(freqs: number[], ms: number, timbre: Timbre = 'sine', level = 0.5): Promise<void> {
    const ctx = this.ensure();
    if (!ctx || !this.master) return Promise.resolve();
    const t0 = ctx.currentTime;
    const dur = ms / 1000;
    const per = level / Math.max(1, freqs.length);
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      this.applyTimbre(osc, timbre);
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(per, t0 + 0.03);
      g.gain.setValueAtTime(per, t0 + dur - 0.06);
      g.gain.linearRampToValueAtTime(0, t0 + dur);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
    return new Promise((resolve) => window.setTimeout(resolve, ms + 40));
  }

  /**
   * One plucked-string note: eight partials at 1/n^1.1, higher partials
   * decaying faster (τ = 0.55/n^0.75 s) — the playable-facsimile demos'
   * voice (#3224). `at` is seconds from now (for arpeggios); level 1 peaks
   * around −14 dBFS after the master bus.
   */
  pluck(freq: number, at = 0, level = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + 0.02 + Math.max(0, at);
    for (let h = 1; h <= 8; h++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * h;
      const g = ctx.createGain();
      const a = (1.27 * level) / Math.pow(h, 1.1);
      const tau = 0.55 / Math.pow(h, 0.75);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(a, t0 + 0.01);
      g.gain.setTargetAtTime(0.0001, t0 + 0.015, tau);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + 2.6);
    }
  }

  dispose() {
    try {
      for (const v of this.voices.values()) { v.osc.stop(); v.lfo?.stop(); }
      void this.ctx?.close();
    } catch { /* already closed */ }
    this.voices.clear();
    this.ctx = null;
    this.master = null;
    this.richWave = null;
    this.pulseWave = null;
  }
}

export const centsBetween = (f1: number, f2: number) => 1200 * Math.log2(f2 / f1);
