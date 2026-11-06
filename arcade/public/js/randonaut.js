// Randonaut events: surprise anomalies that appear at random times and
// random coordinates on the battlefield, loosely inspired by randonauting
// (set an intention, let a random generator pick a point, go see what is
// there). Chat steers the theme by typing an intention word.
//
// Kinds:
//   ATTRACTOR  a power well at a random point. Both teams race with LIKES to
//              claim it; the claimer gets a reward drawn at random.
//   VOID       a dead zone that swallows every projectile that enters it.
//   ANOMALY    a short global mutation themed by the winning intention:
//              FIRE meteor rain, ICE freezes one side's turns, STORM random
//              lightning, LIGHT heals and shields everyone, VOID slows time.
//
// Compliance line: randomness only touches free actions (time, likes, chat).
// Gifts are never part of a random draw; gift effects stay fixed.
import { W, TAU, clamp, rgba } from './util.js';

const KINDS = [
  ['attractor', 0.4],
  ['void', 0.25],
  ['anomaly', 0.35],
];
export const INTENTIONS = {
  fire: { label: 'FIRE', color: '#ff9d1c', text: 'METEOR RAIN ON BOTH SIDES' },
  ice: { label: 'ICE', color: '#9ff6ff', text: 'ONE SIDE FROZEN' },
  storm: { label: 'STORM', color: '#ffe37a', text: 'LIGHTNING EVERYWHERE' },
  light: { label: 'LIGHT', color: '#ffffff', text: 'EVERYONE HEALED + SHIELDED' },
  void: { label: 'VOID', color: '#d36bff', text: 'TIME SLOWS DOWN' },
};
const REWARDS = [
  { id: 'meteor', label: 'METEOR SHOWER' },
  { id: 'haste', label: '+20 HASTE' },
  { id: 'bravery', label: '+20 BRAVERY' },
  { id: 'heal', label: 'BASE HEALED 8%' },
  { id: 'limit', label: '+40 LIMIT' },
  { id: 'drones', label: '3 ALLIED DRONES' },
];

// Cryptographic randomness (Web Crypto in browsers and Node 19+).
// A quantum or other external entropy source can be plugged in via env.entropy().
export function cryptoRandom() {
  const c = globalThis.crypto;
  if (c && c.getRandomValues) {
    const a = new Uint32Array(1);
    c.getRandomValues(a);
    return a[0] / 4294967296;
  }
  return Math.random();
}

export class Randonaut {
  constructor(battle) {
    this.b = battle;
    this.phase = 'idle';
    this.t = 0;
    this.next = 40;
    this.ev = null;
    this.votes = []; // { word, t }
    this.time = 0;
  }

  get w() {
    return this.b.w.randonaut;
  }

  rng() {
    const e = this.b.env.entropy;
    const v = e ? e() : null;
    return typeof v === 'number' && v >= 0 && v < 1 ? v : cryptoRandom();
  }

  pick(list) {
    let r = this.rng() * list.reduce((s, [, wgt]) => s + wgt, 0);
    for (const [k, wgt] of list) if ((r -= wgt) <= 0) return k;
    return list[0][0];
  }

  // ----------------------------------------------------------- intentions
  onChat(text) {
    const words = String(text || '').toLowerCase().replace(/#/g, ' ').split(/\s+/);
    for (const w of words) if (INTENTIONS[w]) this.votes.push({ word: w, t: this.time });
    if (this.votes.length > 400) this.votes.splice(0, 100);
  }

  tally() {
    const out = {};
    for (const v of this.votes) if (this.time - v.t < 45) out[v.word] = (out[v.word] || 0) + 1;
    return out;
  }

  leadingIntention() {
    let best = null;
    let n = 0;
    for (const [k, c] of Object.entries(this.tally())) if (c > n) [best, n] = [k, c];
    return n >= 3 ? { word: best, votes: n } : null;
  }

  // ------------------------------------------------------------- lifecycle
  schedule() {
    const w = this.w;
    // exponential gap with a floor: unpredictable, but never back to back
    this.next = Math.max(w.minSeconds, -Math.log(1 - this.rng() * 0.999) * w.meanSeconds);
  }

  spawn(kind) {
    const w = this.w;
    kind = kind || this.pick(KINDS);
    const lead = this.leadingIntention();
    let theme = lead ? lead.word : Object.keys(INTENTIONS)[Math.floor(this.rng() * 5)];
    const ev = {
      kind,
      theme,
      votes: lead ? lead.votes : 0,
      x: 150 + this.rng() * 420,
      y: 400 + this.rng() * 400,
      claim: { A: 0, B: 0 },
      life: w.lifeSeconds,
      tick: 0,
      frozen: null,
    };
    if (kind === 'anomaly' && theme === 'ice') ev.frozen = this.rng() < 0.5 ? 'A' : 'B';
    this.ev = ev;
    this.phase = 'scan';
    this.t = 2.6;
    this.votes.length = 0;
    this.b.sfx.play('siren');
  }

  update(dt) {
    this.time += dt;
    const b = this.b;
    if (!this.w.enabled) {
      this.phase = 'idle';
      this.ev = null;
      return;
    }
    const busy = b.phase !== 'battle' || b.cine || b.teams.A.gate.active || b.teams.B.gate.active;
    if (this.phase === 'idle') {
      if (busy) return;
      if ((this.next -= dt) <= 0) this.spawn();
      return;
    }
    this.t -= dt;
    if (this.phase === 'scan') {
      if (this.t <= 0) this.activate();
      return;
    }
    if (this.phase === 'live') {
      const ev = this.ev;
      ev.life -= dt;
      this.tickLive(ev, dt);
      if (ev.life <= 0 || b.phase !== 'battle') this.end(null);
    }
  }

  activate() {
    const b = this.b;
    const ev = this.ev;
    this.phase = 'live';
    const it = INTENTIONS[ev.theme];
    if (ev.kind === 'attractor') {
      b.banner('ATTRACTOR', `TAP LIKES TO CLAIM IT (${this.w.claimLikes})`, '#ffd34a', { prio: 2 });
      b.voice.say('An attractor appeared! Tap likes to claim it!', 2);
    } else if (ev.kind === 'void') {
      b.banner('VOID', 'IT SWALLOWS EVERY SHOT', '#d36bff', { prio: 2 });
    } else {
      b.banner(`ANOMALY: ${it.label}`, ev.votes ? `CHAT INTENTION x${ev.votes}: ${it.text}` : it.text, it.color, { prio: 2, dur: 2.4 });
      b.voice.say(`Anomaly. ${it.label.toLowerCase()}!`, 2);
      if (ev.theme === 'light') {
        for (const k of ['A', 'B'])
          for (const u of b.teams[k].units) {
            u.hp = Math.min(u.max, u.hp + u.max * 0.5);
            u.shield = Math.max(u.shield, 5);
          }
      }
      if (ev.theme === 'ice') b.banner('FROZEN', `${b.col(ev.frozen).name} TURNS STOPPED`, '#9ff6ff', { side: ev.frozen, small: true });
    }
    b.sfx.play('ascend');
    b.aberr = 1.2;
  }

  tickLive(ev, dt) {
    const b = this.b;
    if (ev.kind === 'void') {
      b.proj.absorb(ev.x, ev.y, 80, b.fx);
      return;
    }
    if (ev.kind !== 'anomaly') return;
    ev.tick -= dt;
    if (ev.theme === 'fire' && ev.tick <= 0) {
      ev.tick = 1.4;
      for (const k of ['A', 'B']) b.castMeteorSmall(b.teams[k], 2);
    } else if (ev.theme === 'storm' && ev.tick <= 0) {
      ev.tick = 1.2;
      for (const k of ['A', 'B']) {
        const us = b.teams[k].units;
        if (!us.length) continue;
        const u = us[Math.floor(this.rng() * us.length)];
        b.fx.zap(u.x + (this.rng() - 0.5) * 80, 260, u.x, u.y, '#ffe37a', 0.35);
        b.damageUnit(u, 10, { team: 'boss', kind: 'anomaly' });
      }
      b.sfx.play('boom', 1);
    }
  }

  // world-time multiplier (VOID anomaly) and per-team turn freeze (ICE)
  timeScale() {
    const ev = this.ev;
    return this.phase === 'live' && ev.kind === 'anomaly' && ev.theme === 'void' ? 0.55 : 1;
  }

  frozen(team) {
    const ev = this.ev;
    return this.phase === 'live' && ev.kind === 'anomaly' && ev.theme === 'ice' && ev.frozen === team && ev.life > this.w.lifeSeconds - 7;
  }

  // likes count toward claiming an attractor (and double during nothing else)
  onLike(team, count) {
    const ev = this.ev;
    if (this.phase !== 'live' || ev.kind !== 'attractor' || !(team === 'A' || team === 'B')) return;
    ev.claim[team] += count;
    if (ev.claim[team] >= this.w.claimLikes) this.end(team);
  }

  end(winner) {
    const b = this.b;
    const ev = this.ev;
    if (ev && ev.kind === 'attractor') {
      if (winner) {
        const reward = REWARDS[Math.floor(this.rng() * REWARDS.length)];
        this.applyReward(b.teams[winner], reward, ev);
        b.banner('ATTRACTOR CLAIMED', `${b.col(winner).name}: ${reward.label}`, b.col(winner).c1, { side: winner, prio: 2 });
        b.voice.say(`${b.col(winner).name} claims the attractor!`, 2);
      } else b.banner('ATTRACTOR FADED', 'NOBODY CLAIMED IT', '#9c98c8', { small: true });
    }
    this.phase = 'idle';
    this.ev = null;
    this.schedule();
  }

  applyReward(t, reward, ev) {
    const b = this.b;
    b.fx.ring(ev.x, ev.y, '#ffd34a', 10, 160, 0.7, 6);
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * TAU;
      b.fx.particle(ev.x, ev.y, Math.cos(a) * 200 + (t.core.x - ev.x), Math.sin(a) * 200 + (t.core.y - ev.y), 0.9, 5, i % 2 ? '#ffd34a' : b.col(t.key).c1, 0, 2);
    }
    switch (reward.id) {
      case 'meteor':
        b.castMeteor(t);
        break;
      case 'haste':
        b.addStack(t, 'haste', 20);
        break;
      case 'bravery':
        b.addStack(t, 'bravery', 20);
        break;
      case 'heal':
        t.core.hp = Math.min(t.core.max, t.core.hp + t.core.max * 0.08);
        break;
      case 'limit':
        b.addLimit(t, 40);
        break;
      case 'drones':
        for (let i = 0; i < 3; i++) b.spawnUnit(t.key, null, true);
        break;
    }
    b.sfx.play('limit');
  }

  // ------------------------------------------------------------------ draw
  drawWorld(ctx, th, time) {
    const ev = this.ev;
    if (!ev) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (this.phase === 'scan') {
      // quantum lock: crosshair sweeping in from the edges onto the point
      const k = 1 - clamp(this.t / 2.6, 0, 1);
      const sx = ev.x + Math.sin(time * 9) * (1 - k) * 220;
      const sy = ev.y + Math.cos(time * 7) * (1 - k) * 160;
      ctx.strokeStyle = rgba('#7df9ff', 0.4 + 0.5 * k);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
      ctx.moveTo(sx, 340);
      ctx.lineTo(sx, 900);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, 18 + (1 - k) * 40, 0, TAU);
      ctx.stroke();
    } else if (this.phase === 'live') {
      const pulse = 0.5 + 0.5 * Math.sin(time * 5);
      if (ev.kind === 'attractor') {
        for (let i = 0; i < 4; i++) {
          ctx.strokeStyle = rgba('#ffd34a', 0.7 - i * 0.15);
          ctx.lineWidth = 3 - i * 0.5;
          ctx.beginPath();
          ctx.arc(ev.x, ev.y, 18 + i * 14 + pulse * 6, time * (i % 2 ? -1 : 1), time * (i % 2 ? -1 : 1) + TAU * 0.7);
          ctx.stroke();
        }
        // claim arcs per team
        for (const k of ['A', 'B']) {
          const p = clamp(ev.claim[k] / this.w.claimLikes, 0, 1);
          if (p <= 0) continue;
          ctx.strokeStyle = th[k].c1;
          ctx.lineWidth = 6;
          ctx.beginPath();
          const start = k === 'A' ? Math.PI / 2 : -Math.PI / 2;
          ctx.arc(ev.x, ev.y, 62, start, start + Math.PI * p);
          ctx.stroke();
        }
      } else if (ev.kind === 'void') {
        ctx.globalCompositeOperation = 'source-over';
        const g = ctx.createRadialGradient(ev.x, ev.y, 10, ev.x, ev.y, 84);
        g.addColorStop(0, 'rgba(0,0,0,0.95)');
        g.addColorStop(0.75, 'rgba(20,0,40,0.8)');
        g.addColorStop(1, 'rgba(211,107,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ev.x, ev.y, 84, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba('#d36bff', 0.5 + pulse * 0.4);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ev.x, ev.y, 80, 0, TAU);
        ctx.stroke();
      } else if (ev.theme === 'ice' && ev.frozen) {
        const t = this.b.teams[ev.frozen];
        ctx.strokeStyle = rgba('#9ff6ff', 0.6);
        ctx.lineWidth = 2;
        for (const u of t.units) {
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i * TAU) / 6;
            const px = u.x + Math.cos(a) * 30;
            const py = u.y + Math.sin(a) * 30;
            if (i) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  status() {
    if (this.phase === 'idle') return { next: Math.ceil(this.next), votes: this.tally() };
    const ev = this.ev;
    return { phase: this.phase, kind: ev.kind, theme: ev.theme, x: Math.round(ev.x), y: Math.round(ev.y), claim: { ...ev.claim }, life: Math.ceil(ev.life) };
  }
}

