// Procedural arcade SFX (Web Audio, no sound files) + Web Speech announcer.
// Every sound is rate-limited so 300 seekers do not turn into noise.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.vol = 0.6;
    this.last = Object.create(null);
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.vol;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolume(v) {
    this.vol = v;
    if (this.master) this.master.gain.value = v;
  }

  gate(name, ms) {
    const now = performance.now();
    if (now - (this.last[name] || 0) < ms) return false;
    this.last[name] = now;
    return true;
  }

  tone(f0, f1, dur, type = 'square', vol = 0.15, delay = 0) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, vol, f0, f1, type = 'lowpass', delay = 0) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  play(name, size = 1) {
    if (!this.ready) return;
    switch (name) {
      case 'laser':
        if (this.gate(name, 45)) this.tone(1200, 260, 0.09, 'square', 0.035);
        break;
      case 'launch':
        if (this.gate(name, 60)) {
          this.noise(0.14, 0.05, 3000, 700, 'bandpass');
          this.tone(320, 760, 0.12, 'triangle', 0.04);
        }
        break;
      case 'hit':
        if (this.gate(name, 50)) this.noise(0.08, 0.06, 2400, 300);
        break;
      case 'boom':
        if (this.gate(name, 90)) {
          this.noise(0.25 + 0.25 * size, 0.18 * Math.min(2, size), 1800, 60);
          this.tone(140, 40, 0.3 + 0.2 * size, 'sine', 0.2);
        }
        break;
      case 'coin':
        if (this.gate(name, 70)) {
          this.tone(988, 988, 0.07, 'square', 0.06);
          this.tone(1319, 1319, 0.18, 'square', 0.06, 0.07);
        }
        break;
      case 'join':
        if (this.gate(name, 80)) this.tone(520, 1040, 0.1, 'triangle', 0.05);
        break;
      case 'ko':
        if (this.gate(name, 80)) this.tone(600, 90, 0.25, 'sawtooth', 0.05);
        break;
      case 'ready':
        if (this.gate(name, 400)) {
          this.tone(1320, 1320, 0.09, 'triangle', 0.08);
          this.tone(1760, 1760, 0.2, 'triangle', 0.08, 0.09);
        }
        break;
      case 'stagger':
        if (this.gate(name, 500)) {
          for (let i = 0; i < 3; i++) this.tone(440, 220, 0.18, 'sawtooth', 0.1, i * 0.2);
          this.noise(0.6, 0.12, 4000, 200);
        }
        break;
      case 'siren':
        if (this.gate(name, 900)) for (let i = 0; i < 2; i++) this.tone(620, 920, 0.4, 'sine', 0.1, i * 0.42);
        break;
      case 'limit':
        if (this.gate(name, 800)) {
          [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.22, 'square', 0.07, i * 0.07));
          this.noise(1.2, 0.08, 600, 6000, 'bandpass');
        }
        break;
      case 'slash':
        if (this.gate(name, 50)) this.noise(0.12, 0.12, 6000, 900, 'highpass');
        break;
      case 'summon':
        if (this.gate(name, 2000)) {
          [55, 82.5, 110, 165].forEach((f) => this.tone(f, f * 2, 3.5, 'sawtooth', 0.05));
          this.noise(3.8, 0.1, 200, 8000, 'bandpass');
        }
        break;
      case 'beam':
        if (this.gate(name, 600)) {
          this.noise(1.2, 0.3, 8000, 80);
          this.tone(90, 30, 1.4, 'sawtooth', 0.25);
        }
        break;
      case 'victory':
        if (this.gate(name, 2000)) [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, f, 0.24, 'square', 0.08, i * 0.13));
        break;
      case 'meteor':
        if (this.gate(name, 120)) this.noise(0.5, 0.08, 5000, 200, 'bandpass');
        break;
      case 'ascend':
        if (this.gate(name, 1500)) {
          [220, 330, 440, 660, 880, 1320].forEach((f, i) => this.tone(f, f * 1.5, 0.5, 'sawtooth', 0.045, i * 0.06));
          this.noise(1.6, 0.12, 300, 12000, 'bandpass');
          this.tone(55, 110, 1.8, 'sine', 0.25);
        }
        break;
      case 'streak':
        if (this.gate(name, 250)) {
          const base = 660 + Math.min(4, size) * 110;
          for (let i = 0; i < Math.min(5, size); i++) this.tone(base + i * 220, base + i * 220, 0.09, 'square', 0.07, i * 0.07);
          this.noise(0.3, 0.08, 7000, 1500, 'highpass');
        }
        break;
      case 'shield':
        if (this.gate(name, 150)) this.tone(880, 1760, 0.25, 'sine', 0.06);
        break;
    }
  }
}

export class Voice {
  constructor() {
    this.enabled = true;
    this.minGap = 3000;
    this.last = 0;
    this.ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  // prio 1 = flavor, 2 = important, 3 = interrupt anything
  say(text, prio = 1) {
    if (!this.enabled || !this.ok) return;
    const now = performance.now();
    const synth = window.speechSynthesis;
    if (prio < 3 && now - this.last < this.minGap) return;
    if (synth.speaking) {
      if (prio < 3) return;
      synth.cancel();
    }
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.1;
      u.pitch = 0.85;
      u.volume = 1;
      synth.speak(u);
      this.last = now;
    } catch {
      /* speech not available in this browser */
    }
  }
}

// Procedural chiptune loop on the Web Audio clock (no files, no licensing).
// Am - F - C - G, 16 steps per bar. Intensity changes the arrangement:
//   0 = bass + drums, 1 = + lead arpeggio (stagger, happy hour),
//   2 = faster + high arpeggio (execution gate), -1 = muted (victory)
const PROG = [
  { root: 45, tones: [0, 3, 7] }, // A minor
  { root: 41, tones: [0, 4, 7] }, // F
  { root: 48, tones: [0, 4, 7] }, // C
  { root: 43, tones: [0, 4, 7] }, // G
];
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor(sfx) {
    this.sfx = sfx;
    this.on = true;
    this.vol = 0.35;
    this.step = 0;
    this.next = 0;
    this.intensity = 0;
    this.duck = 1;
    this.gain = null;
    this.timer = null;
    this.dim = 1;
    this.kicks = [];
  }

  // 0..1 envelope that spikes on every kick drum; drives beat-synced visuals.
  pulse() {
    const c = this.sfx.ctx;
    if (!c || c.state !== 'running' || !this.on || this.intensity < 0 || !this.kicks.length) return 0;
    const now = c.currentTime;
    let last = -1;
    for (const k of this.kicks) if (k <= now && k > last) last = k;
    return last < 0 ? 0 : Math.exp(-(now - last) * 7);
  }

  start() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), 25);
  }

  setLevel(intensity, duck, dim = 1) {
    this.dim = dim;
    this.intensity = dim >= 5 && intensity >= 0 ? Math.max(1, intensity) : intensity;
    this.duck = duck;
    if (this.gain) {
      const c = this.sfx.ctx;
      const target = this.on && intensity >= 0 ? this.vol * duck : 0;
      this.gain.gain.setTargetAtTime(target, c.currentTime, 0.15);
    }
  }

  tick() {
    const c = this.sfx.ctx;
    if (!c || c.state !== 'running') return;
    if (!this.gain) {
      this.gain = c.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(this.sfx.master);
      this.setLevel(this.intensity, this.duck);
    }
    if (!this.on || this.intensity < 0) {
      this.next = 0;
      return;
    }
    const tempo = (this.intensity >= 2 ? 146 : this.intensity === 1 ? 132 : 118) + (this.dim - 1) * 2;
    const len = 60 / tempo / 4;
    if (this.next < c.currentTime) this.next = c.currentTime + 0.05;
    while (this.next < c.currentTime + 0.12) {
      this.playStep(this.step, this.next, len);
      this.next += len;
      this.step = (this.step + 1) % 64;
    }
  }

  note(t, freq, dur, type, vol) {
    const c = this.sfx.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.gain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  hit(t, dur, vol, f0, f1, type) {
    const c = this.sfx.ctx;
    const src = c.createBufferSource();
    src.buffer = this.sfx.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.gain);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  playStep(s, t, len) {
    const bar = PROG[(s >> 4) % 4];
    const i = s % 16;
    // drums
    // D3+: a soft pad chord under each bar
    if (i === 0 && this.dim >= 3) for (const tn of bar.tones) this.note(t, hz(bar.root + 12 + tn), len * 15, 'triangle', 0.035);
    if (i % 4 === 0) {
      this.kicks.push(t);
      if (this.kicks.length > 8) this.kicks.shift();
      const c = this.sfx.ctx;
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g);
      g.connect(this.gain);
      o.start(t);
      o.stop(t + 0.18);
    }
    if (i === 4 || i === 12) this.hit(t, 0.14, 0.25, 3000, 900, 'bandpass');
    if (i % 2 === 1 || this.intensity >= 2) this.hit(t, 0.04, i % 4 === 2 ? 0.12 : 0.07, 9000, 6000, 'highpass');
    // bass: driving 8ths with an octave bounce
    if (i % 2 === 0) this.note(t, hz(bar.root - 12 + (i % 4 === 2 ? 12 : 0)), len * 1.8, 'triangle', 0.32);
    // lead arpeggio
    if (this.intensity >= 1) {
      const tone = bar.tones[i % 3] + (i % 6 >= 3 ? 12 : 0);
      this.note(t, hz(bar.root + 24 + tone), len * 0.9, 'square', 0.05);
    }
    if (this.intensity >= 2 && i % 2 === 0) this.note(t, hz(bar.root + 36 + bar.tones[(i >> 1) % 3]), len * 0.6, 'square', 0.035);
  }
}
