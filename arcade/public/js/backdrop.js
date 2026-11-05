// LAYER 1: reactive backdrop.
// Procedural synthwave arena by default (sky, pixel skyline, striped sun,
// perspective grid, territory wall). Drop any jpg/png/webp/mp4/webm into
// public/assets and pick it in the director: it is drawn under the grid and
// gets the same CRT treatment, so any art you add matches the arcade look.
import { W, H, TAU, clamp, rgba, mix, mulberry32 } from './util.js';

const HORIZON = 430;

export class Backdrop {
  constructor() {
    const rnd = mulberry32(7);
    this.stars = Array.from({ length: 140 }, () => ({ x: rnd() * W, y: rnd() * HORIZON, s: rnd() < 0.15 ? 3 : 2, p: rnd() * TAU, sp: 0.5 + rnd() * 2 }));
    // blocky skyline, two layers
    this.sky1 = [];
    this.sky2 = [];
    for (let x = 0; x < W; ) {
      const w = 24 + Math.floor(rnd() * 46);
      this.sky1.push({ x, w, h: 30 + Math.floor(rnd() * 90), lit: Math.floor(rnd() * 1e9) });
      x += w;
    }
    for (let x = -10; x < W; ) {
      const w = 30 + Math.floor(rnd() * 60);
      this.sky2.push({ x, w, h: 20 + Math.floor(rnd() * 50) });
      x += w + 6;
    }
    this.gridPhase = 0;
    this.mediaName = '';
    this.media = null;
  }

  setAsset(name, serverMode) {
    if (name === this.mediaName) return;
    this.mediaName = name;
    if (this.media && this.media.tagName === 'VIDEO') this.media.pause();
    this.media = null;
    if (!name || !serverMode) return;
    const url = '/assets/' + encodeURIComponent(name);
    if (/\.(mp4|webm)$/i.test(name)) {
      const v = document.createElement('video');
      v.src = url;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.autoplay = true;
      v.play().catch(() => {});
      this.media = v;
    } else {
      const img = new Image();
      img.src = url;
      this.media = img;
    }
  }

  mediaReady() {
    const m = this.media;
    if (!m) return false;
    return m.tagName === 'VIDEO' ? m.readyState >= 2 : m.complete && m.naturalWidth > 0;
  }

  // The pixel skyline (dozens of rects + window loop) is rendered once into
  // an offscreen canvas and redrawn only when scale, theme or the territory
  // line moves enough to recolor the windows.
  skyline(S, A, B, tx) {
    const key = S + '|' + A.c1 + '|' + B.c1 + '|' + Math.round(tx / 6);
    if (key === this.skyKey) return this.skyCanvas;
    const top = HORIZON - 160;
    const cv = this.skyCanvas || document.createElement('canvas');
    cv.width = Math.ceil(W * S);
    cv.height = Math.ceil(160 * S);
    const ctx = cv.getContext('2d');
    ctx.setTransform(S, 0, 0, S, 0, -top * S);
    ctx.clearRect(0, top, W, 160);
    ctx.fillStyle = '#0d0820';
    for (const s of this.sky2) ctx.fillRect(s.x, HORIZON - s.h - 10, s.w, s.h + 10);
    for (const s of this.sky1) {
      ctx.fillStyle = '#07040f';
      ctx.fillRect(s.x, HORIZON - s.h, s.w - 2, s.h);
      let bits = s.lit;
      for (let wy = HORIZON - s.h + 8; wy < HORIZON - 6; wy += 10) {
        for (let wx = s.x + 5; wx < s.x + s.w - 7; wx += 8) {
          bits = (bits * 1103515245 + 12345) >>> 0;
          if ((bits & 7) === 0) {
            ctx.fillStyle = wx + 2 < tx ? rgba(A.c1, 0.55) : rgba(B.c1, 0.55);
            ctx.fillRect(wx, wy, 3, 3);
          }
        }
      }
    }
    this.skyCanvas = cv;
    this.skyKey = key;
    return cv;
  }

  draw(ctx, t, dt, b, wts, theme, S = 1) {
    const A = theme.A;
    const B = theme.B;
    const tx = b.territoryX;
    const speedBoost = 1 + (b.teams.A.staggerTime > 0 || b.teams.B.staggerTime > 0 ? 1.5 : 0) + (b.teams.A.stacks.haste + b.teams.B.stacks.haste) * 0.01;
    this.gridPhase = (this.gridPhase + dt * 0.55 * wts.backdrop.gridSpeed * speedBoost) % 1;

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#04020c');
    sky.addColorStop(0.3, '#120626');
    sky.addColorStop(0.34, '#2a0a3a');
    sky.addColorStop(0.36, '#0a0418');
    sky.addColorStop(1, '#030209');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    const hasMedia = this.mediaReady();
    if (hasMedia) {
      const m = this.media;
      const mw = m.videoWidth || m.naturalWidth;
      const mh = m.videoHeight || m.naturalHeight;
      const s = Math.max(W / mw, H / mh);
      ctx.drawImage(m, (W - mw * s) / 2, (H - mh * s) / 2, mw * s, mh * s);
      ctx.fillStyle = `rgba(3,2,10,${wts.backdrop.dim})`;
      ctx.fillRect(0, 0, W, H);
    }

    // team tint split at the territory line
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // one full-screen pass for both team tints (hard split at the territory line)
    const f = clamp(tx / W, 0.02, 0.98);
    const tint = ctx.createLinearGradient(0, 0, W, 0);
    tint.addColorStop(0, rgba(A.c2, 0.16));
    tint.addColorStop(f - 0.001, rgba(A.c1, 0.05));
    tint.addColorStop(f, rgba(B.c1, 0.05));
    tint.addColorStop(1, rgba(B.c2, 0.16));
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, W, H);
    // stagger / gate pulses on a team's half
    for (const k of ['A', 'B']) {
      const team = b.teams[k];
      let col = null;
      let a = 0;
      if (team.gate.active) {
        col = '#ff1030';
        a = 0.12 + 0.1 * Math.sin(t * 10);
      } else if (team.staggerTime > 0) {
        col = '#ffcc33';
        a = 0.1 + 0.07 * Math.sin(t * 8);
      }
      if (col) {
        ctx.fillStyle = rgba(col, Math.max(0, a));
        if (k === 'A') ctx.fillRect(0, 0, tx, H);
        else ctx.fillRect(tx, 0, W - tx, H);
      }
    }
    ctx.restore();

    if (!hasMedia) {
      // stars
      for (const s of this.stars) {
        const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.sp + s.p));
        ctx.fillStyle = `rgba(230,220,255,${a * 0.8})`;
        ctx.fillRect(s.x, s.y, s.s, s.s);
      }
      // sun
      const sunX = W / 2 + (tx - W / 2) * 0.3;
      const sunY = HORIZON - 8;
      const R = 150;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, HORIZON);
      ctx.clip();
      const sg = ctx.createLinearGradient(0, sunY - R, 0, sunY);
      sg.addColorStop(0, mix(A.c1, '#ffffff', 0.35));
      sg.addColorStop(0.55, mix(A.c1, B.c1, 0.5));
      sg.addColorStop(1, B.c2);
      ctx.fillStyle = sg;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(sunX, sunY, R, Math.PI, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0a0418';
      for (let i = 0; i < 7; i++) {
        const yy = sunY - 12 - i * 16 - ((t * 10) % 16);
        if (yy < sunY - R * 0.7) continue;
        ctx.fillRect(sunX - R, yy, R * 2, 3 + i * 0.6);
      }
      ctx.restore();
      // skyline
      if (wts.backdrop.skyline) ctx.drawImage(this.skyline(S, A, B, tx), 0, HORIZON - 160, W, 160);
    }

    // perspective grid floor
    const ga = hasMedia ? wts.backdrop.gridOverImage : 1;
    if (ga > 0.01) {
      ctx.save();
      ctx.globalAlpha = ga;
      ctx.globalCompositeOperation = 'lighter';
      const vpX = W / 2;
      ctx.lineWidth = 2;
      for (let i = -14; i <= 14; i++) {
        const xTop = vpX + i * 22;
        const xBot = vpX + i * 150;
        ctx.strokeStyle = rgba(xBot < tx ? A.c1 : B.c1, 0.28);
        ctx.beginPath();
        ctx.moveTo(xTop, HORIZON);
        ctx.lineTo(xBot, H);
        ctx.stroke();
      }
      for (let k = 0; k < 18; k++) {
        const z = (k + this.gridPhase) / 18;
        const y = HORIZON + (H - HORIZON) * Math.pow(z, 2.3);
        const a = clamp(z * 1.3, 0, 1) * 0.5;
        ctx.lineWidth = 1 + z * 2.5;
        ctx.strokeStyle = rgba(A.c1, a);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(tx, y);
        ctx.stroke();
        ctx.strokeStyle = rgba(B.c1, a);
        ctx.beginPath();
        ctx.moveTo(tx, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      // horizon glow line
      ctx.globalAlpha = ga * 0.9;
      ctx.fillStyle = rgba(mix(A.c1, B.c1, 0.5), 0.8);
      ctx.fillRect(0, HORIZON - 1, W, 2);
      ctx.restore();
    }

    // territory wall: glowing divider with pixel data streams
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const wall = ctx.createLinearGradient(tx - 24, 0, tx + 24, 0);
    wall.addColorStop(0, rgba(A.c1, 0));
    wall.addColorStop(0.45, rgba(A.c1, 0.22));
    wall.addColorStop(0.55, rgba(B.c1, 0.22));
    wall.addColorStop(1, rgba(B.c1, 0));
    ctx.fillStyle = wall;
    ctx.fillRect(tx - 24, 280, 48, H - 280);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(tx - 1, 280, 2, H - 280);
    for (let i = 0; i < 18; i++) {
      const y = 280 + ((i * 97 + t * (120 + (i % 5) * 40)) % (H - 280));
      ctx.fillStyle = i % 2 ? rgba(A.c1, 0.8) : rgba(B.c1, 0.8);
      ctx.fillRect(tx - 3 + (i % 3) * 2, y, 4, 4 + (i % 4) * 3);
    }
    ctx.restore();
  }
}
