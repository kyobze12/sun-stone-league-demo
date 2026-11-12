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

  // ------------------------------------------------------------ recorded sound
  // Music, ambience and impact sounds from the Curse of Mirra assets
  // (LambdaClass, CC BY-SA 4.0). Loaded lazily after the first tap; until a
  // sample arrives, the procedural sounds below still play.
  async loadSamples(names) {
    if (!this.ready) return;
    this.samples ||= {};
    await Promise.all(names.map(async (name) => {
      if (this.samples[name]) return;
      try {
        const res = await fetch(`./assets/audio/${name}.mp3`);
        if (!res.ok) return;
        this.samples[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch { /* this sound stays procedural */ }
    }));
  }
  has(name) { return !!this.samples?.[name]; }
  play(name, { volume = .8, rate = 1, detune = 0 } = {}) {
    const buffer = this.samples?.[name]; if (!buffer || !this.ready) return false;
    const src = this.ctx.createBufferSource(); src.buffer = buffer;
    src.playbackRate.value = rate * (1 + (Math.random() - .5) * detune);
    const gain = this.ctx.createGain(); gain.gain.value = volume;
    src.connect(gain).connect(this.master); src.start();
    return true;
  }
  /** Loop a track on its own channel, crossfading from whatever was playing there. */
  loop(channel, name, volume = .4, fade = 1.5) {
    if (!this.ready) return;
    this.channels ||= {};
    const current = this.channels[channel];
    if (current?.name === name) return;
    const now = this.ctx.currentTime;
    if (current) { current.gain.gain.cancelScheduledValues(now); current.gain.gain.setValueAtTime(current.gain.gain.value, now); current.gain.gain.linearRampToValueAtTime(0, now + fade); current.src.stop(now + fade + .05); }
    this.channels[channel] = null;
    const buffer = name && this.samples?.[name];
    if (!buffer) return;
    const src = this.ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const gain = this.ctx.createGain(); gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(volume, now + fade);
    src.connect(gain).connect(this.master); src.start();
    this.channels[channel] = { name, src, gain, volume };
  }
  /** Dip the music under a moment (a goal, a KO) and bring it back. */
  duck(amount = .35, hold = 1.2) {
    const m = this.channels?.music; if (!m || !this.ready) return;
    const now = this.ctx.currentTime, g = m.gain.gain;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(m.volume * amount, now + .08);
    g.linearRampToValueAtTime(m.volume, now + .08 + hold + .8);
  }

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
  tackle() { if (!this.play('dash', { volume: .7, detune: .1 })) { this.noise(.18, .09, 700, .5); this.tone(90, .15, 'square', .04, 50); } }
  hit(heavy = false) {
    if (this.play(heavy ? 'hit_heavy' : 'impact', { volume: heavy ? .95 : .55, rate: heavy ? 1 : 1.35, detune: .15 })) return;
    this.noise(.14, .1, 500, .6); this.tone(70, .2, 'sine', .08, 35);
  }
  whoosh() { this.play('whoosh', { volume: .45, rate: 1.2, detune: .2 }); }
  gong() { if (!this.play('gong', { volume: .7 })) this.drum(); }
  fireBlast() { if (!this.play('fire_blast', { volume: .6, detune: .1 })) this.tone(180, .25, 'sawtooth', .06); }
  roar(beast = false) { this.play(beast ? (Math.random() < .5 ? 'growl1' : 'growl2') : 'transform', { volume: .85 }); }
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
