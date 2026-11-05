// Object-pooled projectiles.
//   kind 1 = homing seeker: launches at an angle, coasts for `ignition`
//            seconds, then steers toward its target with a turn rate that
//            tightens over time (so it always lands, never orbits forever).
//   kind 2 = bolt: fast, nearly straight laser from a unit's ATB attack.
// The stage passes a `battle` with targetInfo(target), retarget(src) and
// onProjectileHit(p) so this file knows nothing about game rules.
import { W, H, rand } from './util.js';

const TRAIL = 10;

export class Projectiles {
  constructor() {
    this.list = [];
    this.free = [];
    this.maxActive = 700;
  }

  clear() {
    for (const o of this.list) this.free.push(o);
    this.list.length = 0;
  }

  alloc() {
    if (this.list.length >= this.maxActive) return null;
    const o = this.free.pop() || { tr: new Float32Array(TRAIL * 2) };
    o.ti = 0;
    o.tc = 0;
    this.list.push(o);
    return o;
  }

  seeker(x, y, angle, target, dmg, src, color, opt = {}) {
    const o = this.alloc();
    if (!o) return null;
    const sp = opt.launch != null ? opt.launch : rand(220, 380);
    o.kind = 1;
    o.x = x;
    o.y = y;
    o.vx = Math.cos(angle) * sp;
    o.vy = Math.sin(angle) * sp;
    o.age = -(opt.delay || 0);
    o.target = target;
    o.dmg = dmg;
    o.src = src;
    o.color = color;
    o.speed = opt.speed || 900;
    o.turn = opt.turn || 7;
    o.ign = opt.ignition != null ? opt.ignition : 0.18;
    o.size = opt.size || 1;
    o.life = 6;
    o.smokeT = 0;
    return o;
  }

  bolt(x, y, tx, ty, target, dmg, src, color, speed = 1500) {
    const o = this.alloc();
    if (!o) return null;
    const d = Math.hypot(tx - x, ty - y) || 1;
    o.kind = 2;
    o.x = x;
    o.y = y;
    o.vx = ((tx - x) / d) * speed;
    o.vy = ((ty - y) / d) * speed;
    o.speed = speed;
    o.age = 0;
    o.target = target;
    o.dmg = dmg;
    o.src = src;
    o.color = color;
    o.size = 1;
    o.life = 1.5;
    return o;
  }

  kill(i) {
    const o = this.list[i];
    this.free.push(o);
    this.list[i] = this.list[this.list.length - 1];
    this.list.pop();
  }

  update(dt, battle, fx, smoke) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      if (i >= L.length) continue; // list was cleared by a hit (round ended)
      const o = L[i];
      o.age += dt;
      if (o.age < 0) continue; // queued for a staggered launch
      o.life -= dt;
      let info = battle.targetInfo(o.target);
      if (!info.alive) {
        o.target = battle.retarget(o.src);
        info = o.target ? battle.targetInfo(o.target) : null;
        if (!info || !info.alive) {
          this.kill(i);
          continue;
        }
      }
      const dx = info.x - o.x;
      const dy = info.y - o.y;
      const d = Math.hypot(dx, dy) || 1;
      if (o.kind === 1) {
        if (o.age < o.ign) {
          const k = Math.exp(-3.5 * dt);
          o.vx *= k;
          o.vy *= k;
        } else {
          const k = 1 - Math.exp(-o.turn * dt * (1 + (o.age - o.ign) * 2));
          o.vx += ((dx / d) * o.speed - o.vx) * k;
          o.vy += ((dy / d) * o.speed - o.vy) * k;
          if (smoke && fx && (o.smokeT -= dt) <= 0) {
            o.smokeT = 0.05;
            if (L.length < 220) fx.smoke(o.x, o.y, 4, 0.4);
          }
        }
      } else {
        // bolts track lightly so moving units still get hit
        const k = 1 - Math.exp(-10 * dt);
        o.vx += ((dx / d) * o.speed - o.vx) * k;
        o.vy += ((dy / d) * o.speed - o.vy) * k;
      }
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.tr[o.ti * 2] = o.x;
      o.tr[o.ti * 2 + 1] = o.y;
      o.ti = (o.ti + 1) % TRAIL;
      if (o.tc < TRAIL) o.tc++;
      if (d < info.r + 6) {
        battle.onProjectileHit(o);
        if (L[i] === o) this.kill(i);
        continue;
      }
      if (o.life <= 0 || o.x < -200 || o.x > W + 200 || o.y < -300 || o.y > H + 200) this.kill(i);
    }
  }

  draw(ctx) {
    const paths = new Map();
    const heads = [];
    for (const o of this.list) {
      if (o.age < 0 || o.tc < 2) continue;
      let p = paths.get(o.color);
      if (!p) paths.set(o.color, (p = { seek: new Path2D(), bolt: new Path2D() }));
      const path = o.kind === 1 ? p.seek : p.bolt;
      const n = o.kind === 1 ? o.tc : Math.min(o.tc, 4);
      let idx = (o.ti - n + TRAIL) % TRAIL;
      path.moveTo(o.tr[idx * 2], o.tr[idx * 2 + 1]);
      for (let k = 1; k < n; k++) {
        idx = (idx + 1) % TRAIL;
        path.lineTo(o.tr[idx * 2], o.tr[idx * 2 + 1]);
      }
      heads.push(o);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [color, p] of paths) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 6;
      ctx.stroke(p.seek);
      ctx.lineWidth = 9;
      ctx.stroke(p.bolt);
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 2;
      ctx.stroke(p.seek);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke(p.bolt);
    }
    ctx.globalAlpha = 1;
    const outer = new Map();
    const inner = new Path2D();
    for (const o of heads) {
      const s = o.kind === 1 ? 4 * o.size : 5;
      let p = outer.get(o.color);
      if (!p) outer.set(o.color, (p = new Path2D()));
      p.rect(o.x - s, o.y - s, s * 2, s * 2);
      inner.rect(o.x - s / 2, o.y - s / 2, s, s);
    }
    for (const [color, p] of outer) {
      ctx.fillStyle = color;
      ctx.fill(p);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fill(inner);
    ctx.restore();
  }
}

