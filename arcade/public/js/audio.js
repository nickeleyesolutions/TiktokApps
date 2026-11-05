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
