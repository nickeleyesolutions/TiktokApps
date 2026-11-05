// Pooled visual effects: pixel particles, shock rings, lightning, slashes,
// and floating damage numbers. Particles are drawn as squares, not circles,
// for the arcade look; the post-processing bloom makes them glow.
import { TAU, rand } from './util.js';

const SPARK = 0;
const SMOKE = 1;
const DEBRIS = 2;

export class FX {
  constructor() {
    this.p = [];
    this.free = [];
    this.max = 3500;
    this.texts = [];
    this.rings = [];
    this.zaps = [];
    this.slashes = [];
  }

  clear() {
    for (const o of this.p) this.free.push(o);
    this.p.length = 0;
    this.texts.length = 0;
    this.rings.length = 0;
    this.zaps.length = 0;
    this.slashes.length = 0;
  }

  particle(x, y, vx, vy, life, size, color, kind = SPARK, drag = 4, grav = 0) {
    if (this.p.length >= this.max) return;
    const o = this.free.pop() || {};
    o.x = x;
    o.y = y;
    o.vx = vx;
    o.vy = vy;
    o.life = life;
    o.max = life;
    o.size = size;
    o.color = color;
    o.kind = kind;
    o.drag = drag;
    o.grav = grav;
    this.p.push(o);
  }

  burst(x, y, color, n = 12, speed = 260, size = 4, life = 0.5) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const s = speed * rand(0.25, 1);
      this.particle(x, y, Math.cos(a) * s, Math.sin(a) * s, life * rand(0.6, 1.25), size * rand(0.6, 1.3), color, SPARK, 4);
    }
  }

  smoke(x, y, size = 6, life = 0.6) {
    this.particle(x, y, rand(-15, 15), rand(-30, -5), life, size, '#3a3550', SMOKE, 2);
  }

  explosion(x, y, color, scale = 1) {
    this.burst(x, y, '#ffffff', Math.round(6 * scale), 200 * scale, 3, 0.25);
    this.burst(x, y, color, Math.round(14 * scale), 320 * scale, 4.5, 0.55);
    for (let i = 0; i < 6 * scale; i++) {
      const a = rand(0, TAU);
      const s = rand(80, 260) * scale;
      this.particle(x, y, Math.cos(a) * s, Math.sin(a) * s - 120, rand(0.5, 0.9), rand(3, 6), color, DEBRIS, 1.5, 700);
    }
    for (let i = 0; i < 3 * scale; i++) this.smoke(x + rand(-10, 10), y + rand(-10, 10), rand(8, 14) * scale, rand(0.5, 0.9));
    this.ring(x, y, color, 6, 46 * scale, 0.35, 4);
  }

  ring(x, y, color, r0, r1, life, width = 4) {
    if (this.rings.length > 200) return;
    this.rings.push({ x, y, color, r0, r1, life, max: life, width });
  }

  text(x, y, str, color, size = 16, crit = false) {
    if (this.texts.length > 160) this.texts.shift();
    this.texts.push({ x: x + rand(-8, 8), y, str, color, size, crit, life: crit ? 1.1 : 0.8, max: crit ? 1.1 : 0.8, vy: crit ? -70 : -55 });
  }

  jagged(x1, y1, x2, y2, segs = 10, amp = 26) {
    const pts = [x1, y1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const off = rand(-amp, amp) * Math.sin(t * Math.PI);
      pts.push(x1 + dx * t + nx * off, y1 + dy * t + ny * off);
    }
    pts.push(x2, y2);
    return pts;
  }

  zap(x1, y1, x2, y2, color, life = 0.3) {
    if (this.zaps.length > 80) return;
    this.zaps.push({ x1, y1, x2, y2, color, life, max: life, pts: this.jagged(x1, y1, x2, y2), regen: 0 });
  }

  slash(x1, y1, x2, y2, color, life = 0.22) {
    this.slashes.push({ x1, y1, x2, y2, color, life, max: life });
  }

  update(dt) {
    const p = this.p;
    for (let i = p.length - 1; i >= 0; i--) {
      const o = p[i];
      o.life -= dt;
      if (o.life <= 0) {
        this.free.push(o);
        p[i] = p[p.length - 1];
        p.pop();
        continue;
      }
      const k = Math.exp(-o.drag * dt);
      o.vx *= k;
      o.vy = o.vy * k + o.grav * dt;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (o.kind === SMOKE) o.size += dt * 10;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) if ((this.rings[i].life -= dt) <= 0) this.rings.splice(i, 1);
    for (let i = this.zaps.length - 1; i >= 0; i--) {
      const z = this.zaps[i];
      z.life -= dt;
      z.regen -= dt;
      if (z.regen <= 0) {
        z.regen = 0.05;
        z.pts = this.jagged(z.x1, z.y1, z.x2, z.y2);
      }
      if (z.life <= 0) this.zaps.splice(i, 1);
    }
    for (let i = this.slashes.length - 1; i >= 0; i--) if ((this.slashes[i].life -= dt) <= 0) this.slashes.splice(i, 1);
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= Math.exp(-3 * dt);
      if (t.life <= 0) this.texts.splice(i, 1);
    }
  }

  drawWorld(ctx) {
    ctx.save();
    // smoke first, normal blending
    for (const o of this.p) {
      if (o.kind !== SMOKE) continue;
      ctx.globalAlpha = 0.35 * (o.life / o.max);
      ctx.fillStyle = o.color;
      ctx.fillRect(o.x - o.size / 2, o.y - o.size / 2, o.size, o.size);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const o of this.p) {
      if (o.kind === SMOKE) continue;
      ctx.globalAlpha = Math.min(1, (o.life / o.max) * 1.4);
      ctx.fillStyle = o.color;
      const s = o.size;
      ctx.fillRect(o.x - s / 2, o.y - s / 2, s, s);
    }
    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(0.5, r.width * (1 - t));
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - t, 3)), 0, TAU);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const z of this.zaps) {
      const a = z.life / z.max;
      ctx.beginPath();
      ctx.moveTo(z.pts[0], z.pts[1]);
      for (let i = 2; i < z.pts.length; i += 2) ctx.lineTo(z.pts[i], z.pts[i + 1]);
      ctx.globalAlpha = 0.5 * a;
      ctx.strokeStyle = z.color;
      ctx.lineWidth = 9;
      ctx.stroke();
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    for (const s of this.slashes) {
      const a = s.life / s.max;
      ctx.globalAlpha = a;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 14 * a;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4 * a;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawTexts(ctx, font) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const t of this.texts) {
      const a = Math.min(1, (t.life / t.max) * 2);
      const pop = t.crit ? 1 + Math.max(0, (t.life - t.max + 0.15) / 0.15) * 0.6 : 1;
      ctx.globalAlpha = a;
      ctx.font = `${Math.round(t.size * pop)}px ${font}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#05030c';
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.restore();
  }
}
