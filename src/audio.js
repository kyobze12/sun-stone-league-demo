/**
 * Procedural WebAudio sound: no sample files to load, works offline, and the
 * drums/flutes lean toward the wooden, breathy palette of Mesoamerican music.
 */
export class Audio {
  constructor() { this.ctx = null; this.noiseBuffer = null; this.master = null; }

  unlock() {
    try {
      this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (!this.master) { this.master = this.ctx.createGain(); this.master.gain.value = .9; this.master.connect(this.ctx.destination); }
    } catch { /* audio optional */ }
  }

  get ready() { this.unlock(); return !!this.ctx; }

  tone(frequency, duration, type = 'sine', volume = .06, slideTo = null) {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    osc.connect(gain).connect(this.master); osc.start(now); osc.stop(now + duration);
  }

  noise(duration, volume = .08, filterHz = 1200, q = .7) {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (!this.noiseBuffer) {
      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource(); source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = filterHz; filter.Q.value = q;
    const gain = ctx.createGain(); gain.gain.setValueAtTime(volume, now); gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    source.connect(filter).connect(gain).connect(this.master); source.start(now); source.stop(now + duration);
  }

  strike(kind, power = .5, big = false) {
    const p = .5 + power * .5;
    if (kind === 'lob') { this.tone(220, .22, 'triangle', .07 * p, 520); this.noise(.12, .05, 2200); }
    else { this.tone(150 + power * 60, .18, 'sawtooth', .08 * p, 70); this.noise(.1, .07 * p, 900); }
    if (big) { this.tone(60, .5, 'sine', .12, 30); this.noise(.4, .12, 400, .4); }
  }
  tackle() { this.noise(.18, .09, 700, .5); this.tone(90, .15, 'square', .04, 50); }
  hit() { this.noise(.14, .1, 500, .6); this.tone(70, .2, 'sine', .08, 35); }
  powerup() { this.tone(660, .12, 'sine', .06); setTimeout(() => this.tone(880, .12, 'sine', .06), 80); setTimeout(() => this.tone(1320, .22, 'sine', .06), 160); }
  score() { this.tone(520, .18, 'triangle', .09); setTimeout(() => this.tone(760, .34, 'triangle', .07), 110); }
  ring() {
    [392, 523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, .6, 'triangle', .08), i * 70));
    setTimeout(() => this.tone(1046, 1, 'sine', .06), 300);
    this.drum();
  }
  drum() { this.tone(80, .35, 'sine', .14, 40); this.noise(.12, .06, 300, .5); setTimeout(() => { this.tone(65, .3, 'sine', .12, 35); }, 180); }
  crowd(intensity = .5) { this.noise(1.6 * intensity + .4, .07 * intensity, 1600, .2); }
}
