// LAYER 2: the battle. Owns all game rules and draws cores, units, boss,
// meteors, projectiles and world-space cinematics.
//
// Cadence (Final Fantasy ATB style):
//   - every unit fills an ATB gauge; when full it lunges and fires a bolt
//   - gifts add team STACKS (haste / bravery / barrage) that decay over time
//   - damage taken fills the STAGGER gauge (full = 3x damage taken) and the
//     LIMIT gauge (full = next tier-2+ gift triggers a Limit Break cinematic)
//   - a core can never drop below the EXECUTION GATE (5%) from normal damage.
//     The gate opens a timed window where only a finisher-tier gift ends the
//     round (Grand Summon). Defenders can answer with their own finisher-tier
//     gift (Phoenix Revive). If time runs out: Second Wind heal, and the
//     finisher requirement drops one tier so rounds still end on quiet days.
//
// Every gift effect is deterministic: a gift of a given size always does the
// same thing. Randomness is only cosmetic (launch angles, particles).
import { W, TAU, clamp, rand, damp, easeOutBack, cleanName, speakable, fmt, rgba } from './util.js';
import { avatarImage, pixelAvatar, unitSprite } from './sprites.js';
import { HyperCube, axisColors } from './hyper.js';
import { Randonaut } from './randonaut.js';
import { Crowd } from './crowd.js';

// Dimension ladder. Index = level - 1.
export const DIMENSIONS = [
  { name: 'ARCADE', roman: 'I', perk: '' },
  { name: 'AURORA', roman: 'II', perk: 'GIFT VOLLEYS +25% SEEKERS' },
  { name: 'TESSERACT', roman: 'III', perk: 'ALL GIFTS +10% POWER' },
  { name: 'KALEIDOSCOPE', roman: 'IV', perk: 'ALL TURNS +15% SPEED' },
  { name: 'FIFTH DIMENSION', roman: 'V', perk: 'ALL GIFTS +25% POWER' },
];
const DIM_GIFT = [1, 1, 1.1, 1.1, 1.25];
const DIM_ATB = [1, 1, 1, 1.15, 1.15];

// Rift race types, played in this order (deterministic rotation).
export const RIFTS = [
  { kind: 'like', title: 'LIKE STORM', unit: 'LIKES', reward: 'hyper', rewardName: 'HYPERDRIVE', rewardText: 'TURNS x1.6', min: 150, max: 6000 },
  { kind: 'gift', title: 'GIFT RUSH', unit: 'GIFTS', reward: 'prism', rewardName: 'PRISM SHIELD', rewardText: 'BASE TAKES -30% DMG', min: 5, max: 300 },
  { kind: 'chat', title: 'UNITY CALL', unit: 'MESSAGES', reward: 'swarm', rewardName: 'SWARM', rewardText: '+15 BARRAGE +15 HASTE', min: 12, max: 400 },
  { kind: 'coin', title: 'COIN SURGE', unit: 'COINS', reward: 'phase', rewardName: 'PHASE SHIFT', rewardText: 'GIFTS x1.5', min: 100, max: 30000 },
];
const nice = (v) => {
  const m = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.max(1, v))) - 1));
  return Math.max(1, Math.round(v / m) * m);
};

// Unit classes. Every viewer gets one from a hash of their id (so it is the
// same every visit), and can switch by typing the class word in chat.
// Classes only shape free actions (turn speed, bolts, healing); gifts are
// unaffected. Numbers live in weights.classes.
export const CLASSES = {
  knight: { name: 'KNIGHT', color: '#9fc8ff', words: ['knight', 'tank', 'shield'], icon: ['.XXX.', 'XXXXX', 'XX.XX', 'XXXXX', '.XXX.', '..X..'] },
  mage: { name: 'MAGE', color: '#c48bff', words: ['mage', 'wizard', 'magic'], icon: ['..X..', '.XXX.', 'XXXXX', '.X.X.', 'X...X', '.....'] },
  ranger: { name: 'RANGER', color: '#7dff9a', words: ['ranger', 'archer', 'bow'], icon: ['...XX', '..X.X', '.X.X.', 'X.X..', '.X...', 'X....'] },
  cleric: { name: 'CLERIC', color: '#fff2a8', words: ['cleric', 'healer', 'heal', 'priest'], icon: ['..X..', '..X..', 'XXXXX', '..X..', '..X..', '..X..'] },
  rogue: { name: 'ROGUE', color: '#ff9f4a', words: ['rogue', 'assassin', 'ninja', 'dagger'], icon: ['....X', '...X.', '..X..', 'XX...', '.X...', 'X.X..'] },
};
export const CLASS_IDS = Object.keys(CLASSES);
const CLASS_WORD = new Map();
for (const id of CLASS_IDS) for (const wd of CLASSES[id].words) CLASS_WORD.set(wd, id);
function hashId(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function classFor(id) {
  return CLASS_IDS[hashId(String(id)) % CLASS_IDS.length];
}

// small cached badge per class and render scale
const CHIPS = new Map();
function classChip(id, S) {
  const k = id + '|' + S;
  let c = CHIPS.get(k);
  if (c !== undefined) return c;
  if (typeof document === 'undefined') return null;
  c = document.createElement('canvas');
  c.width = c.height = Math.ceil(16 * S);
  const x = c.getContext('2d');
  x.scale(S, S);
  const cl = CLASSES[id];
  x.fillStyle = '#05030c';
  x.beginPath();
  x.arc(8, 8, 8, 0, TAU);
  x.fill();
  x.strokeStyle = cl.color;
  x.lineWidth = 1.5;
  x.beginPath();
  x.arc(8, 8, 7, 0, TAU);
  x.stroke();
  x.fillStyle = cl.color;
  const px = 1.6;
  const ox = 8 - (5 * px) / 2;
  const oy = 8 - (6 * px) / 2;
  cl.icon.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] === 'X') x.fillRect(ox + i * px, oy + j * px, px, px);
  });
  CHIPS.set(k, c);
  return c;
}

export const UNIT_R = 24;
// Stacks go to x99 for the show, but their effect has a soft cap so a long
// gift streak cannot make one side untouchable: 30 stacks ~ half of the max.
export const soft = (n) => n / (1 + n / 30);
export const ELITE_R = 31;
const CORE_POS = { A: { x: 92, y: 620 }, B: { x: W - 92, y: 620 } };
const COLS = [196, 272];
// Commander turrets sit in an arc above each core: rank 1 in the middle.
const CMD_POS = [
  { x: 92, y: 498 },
  { x: 40, y: 528 },
  { x: 144, y: 528 },
];
const CMD_RANK_MUL = [1.5, 1, 0.75];
export function commanderPos(team, i) {
  const p = CMD_POS[i];
  return { x: team === 'A' ? p.x : W - p.x, y: p.y };
}

// Orbital Strike satellite (X = panel, W = hull, E = lens).
const SATELLITE = ['XX.........XX', 'XXX.......XXX', 'XXXX.WWW.XXXX', 'XXXXWWWWWXXXX', 'XXXX.WEW.XXXX', 'XXX..WWW..XXX', '.....W.W.....', '....WW.WW....'];
const INFO = { x: 0, y: 0, r: 0, alive: false };

export function slotPos(team, i) {
  const col = i % 2;
  const row = (i / 2) | 0;
  return { x: team === 'A' ? COLS[col] : W - COLS[col], y: 372 + row * 82 + (col ? 41 : 0) };
}

// Procedural pixel leviathan for the Grand Summon (1 = body, 2 = belly, 3 = eye).
function buildWhale() {
  const Wm = 34;
  const Hm = 15;
  const m = [];
  for (let y = 0; y < Hm; y++) {
    const row = [];
    for (let x = 0; x < Wm; x++) {
      const bx = (x - 21) / 13;
      const by = (y - 7.5) / 6;
      let v = 0;
      if (bx * bx + by * by <= 1) v = by > 0.3 ? 2 : 1;
      if (!v && x >= 3 && x <= 10 && Math.abs(y - 7.5) <= 1.3) v = 1;
      const fy = Math.abs(y - 7.5);
      if (!v && x <= 4 && fy <= 5 && Math.abs(fy - (4.6 - x)) < 1.0) v = 1;
      if (!v && x >= 17 && x <= 21 && y >= 12 && y <= 14 && x - 17 >= y - 12) v = 1;
      row.push(v);
    }
    m.push(row);
  }
  m[6][29] = 3;
  return m;
}
const WHALE = buildWhale();

export class Battle {
  constructor(env) {
    this.env = env;
    this.fx = env.fx;
    this.proj = env.proj;
    this.sfx = env.sfx;
    this.voice = env.voice;
    this.users = new Map();
    this.round = 1;
    this.time = 0;
    this.hitstop = 0;
    this.lastHitstop = -9;
    this.trauma = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.flash = 0;
    this.aberr = 0;
    this.glitch = 0;
    this.cine = null;
    this.cineQueue = [];
    this.banners = [];
    this.bannerQ = [];
    this.feed = [];
    this.happyHour = 0;
    this.boss = null;
    this.meteors = [];
    this.beam = null;
    this.phase = 'battle';
    this.victory = null;
    this.pendingGifts = [];
    this.territory = 0;
    this.territoryX = W / 2;
    this.npcSeq = 1;
    this.npcTimer = 1;
    this.guideT = 0;
    this.viewers = 0;
    this.teams = { A: this.makeTeam('A'), B: this.makeTeam('B') };
    this.commanders = { A: [], B: [] };
    this.cmdT = 0;
    this.bountyT = 20;
    this.asc = { energy: 0, level: 1, shown: 1, shift: 0 };
    this.rift = { phase: 'idle', t: this.w.rifts.firstDelay, idx: 0, type: null, goal: 0, prog: { A: 0, B: 0 }, winner: null };
    this.act = { like: 0, gift: 0, chat: 0, coin: 0 }; // counts this second
    this.rate = { like: 0, gift: 0, chat: 0, coin: 0 }; // smoothed per-second rates
    this.rateT = 1;
    this.cages = { A: new HyperCube(4), B: new HyperCube(4) };
    this.rando = new Randonaut(this);
    this.rando.schedule();
    this.legendHit = { like: 0, chat: 0, side: 0, share: 0, follow: 0, gift: 0, cls: 0 };
    this.welcome = null; // { name, t }
    this.welcomeT = 0;
    this.classCount = {};
    this.crowd = new Crowd(this);
  }

  get w() {
    return this.env.weights();
  }

  col(k) {
    return this.env.theme()[k];
  }

  makeTeam(key) {
    const hp = this.w.combat.coreHp;
    return {
      key,
      dir: key === 'A' ? 1 : -1, // direction toward the enemy
      enemy: key === 'A' ? 'B' : 'A',
      core: { ...CORE_POS[key], r: 58, hp, max: hp, ghost: hp, flash: 0, ang: 0 },
      units: [],
      reserve: [],
      slots: new Array(12).fill(null),
      stacks: { haste: 0, bravery: 0, barrage: 0 },
      decay: 0,
      stagger: 0,
      staggerTime: 0,
      staggerImmune: 0,
      mana: 0,
      limit: 0,
      limitReady: 0,
      gate: { active: false, t: 0, winds: 0, tier: this.w.execution.finisherTier, lastSec: 99 },
      executing: false,
      barrageT: 1,
      wins: 0,
      bounty: null,
      buffs: { hyper: 0, prism: 0, phase: 0 },
    };
  }

  // ------------------------------------------------------------------ users
  ensureUser(u) {
    let r = this.users.get(u.id);
    if (!r) {
      r = { id: u.id, uid: u.uid, name: this.safeName(u.name || u.uid), avatar: u.avatar || '', team: null, damage: 0, rd: 0, coins: 0, unit: null, lastRally: -9, koAt: -99, sub: !!u.isSub, follower: !!u.isFollower, cls: classFor(u.id), clsAt: -99 };
      this.users.set(u.id, r);
      if (this.users.size > 6000) this.pruneUsers();
    } else {
      if (u.avatar && !r.avatar) r.avatar = u.avatar;
      if (u.isSub) r.sub = true;
      if (u.isFollower) r.follower = true;
    }
    return r;
  }

  // moderation: display names with blocked words never reach the screen or the announcer
  safeName(name) {
    const m = this.w.moderation || {};
    const n = cleanName(name);
    const low = n.toLowerCase().replace(/[^a-z]/g, '');
    return (m.blockedWords || []).some((wd) => wd && low.includes(String(wd).toLowerCase())) ? m.replaceName || 'VIEWER' : n;
  }

  pruneUsers() {
    let n = 0;
    for (const [id, r] of this.users) {
      if (!r.unit && r.coins === 0) {
        this.users.delete(id);
        if (++n > 1500) break;
      }
    }
  }

  underdog() {
    const a = this.teams.A;
    const b = this.teams.B;
    const ra = a.core.hp / a.core.max;
    const rb = b.core.hp / b.core.max;
    if (Math.abs(ra - rb) > 0.02) return ra < rb ? 'A' : 'B';
    return a.units.length + a.reserve.length <= b.units.length + b.reserve.length ? 'A' : 'B';
  }

  topDamage(key) {
    let best = null;
    for (const r of this.users.values()) if (r.team === key && r.rd > 0 && (!best || r.rd > best.rd)) best = r;
    return best;
  }

  // ---------------------------------------------------------------- classes
  clsStat(rec, k) {
    const w = this.w;
    if (!rec || !w.classes.enabled) return 1;
    const c = w.classes[rec.cls];
    return c && c[k] != null ? c[k] : 1;
  }

  setClass(rec, id) {
    const w = this.w;
    if (!w.classes.enabled || !w.classes.byChat || !CLASSES[id]) return false;
    if (rec.cls === id && (!rec.unit || rec.unit.cls === id)) return false;
    if (this.time - rec.clsAt < w.classes.switchCooldown) return false;
    rec.cls = id;
    rec.clsAt = this.time;
    const u = rec.unit;
    if (u && u.alive) {
      const ratio = u.hp / u.max;
      u.cls = id;
      u.max = w.combat.unitHp * (rec.sub ? w.subs.hpMul : 1) * this.clsStat(rec, 'hp');
      u.hp = Math.max(1, u.max * ratio);
      u.hits = 0;
      u.pop = 1;
      u.label = 3;
      if (u.slot >= 0) {
        this.fx.ring(u.x, u.y, CLASSES[id].color, 6, 46, 0.5, 3);
        this.fx.text(u.x, u.y - 44, CLASSES[id].name, CLASSES[id].color, 13, true);
      }
    }
    this.classCount[id] = (this.classCount[id] || 0) + 1;
    this.legendHit.cls = 1;
    return true;
  }

  // ------------------------------------------------------------------ units
  maxSlots() {
    return clamp(Math.round(this.w.combat.maxSlots), 2, 12);
  }

  freeSlot(t, evictNpc) {
    const max = this.maxSlots();
    for (let i = 0; i < max; i++) if (!t.slots[i]) return i;
    if (evictNpc) {
      for (let i = max - 1; i >= 0; i--) {
        const u = t.slots[i];
        if (u && u.npc) {
          this.despawn(u, true, false);
          return i;
        }
      }
    }
    return -1;
  }

  spawnUnit(key, rec, npc = false) {
    const t = this.teams[key];
    const w = this.w;
    const u = {
      id: npc ? 'npc' + this.npcSeq : rec.id,
      rec: npc ? null : rec,
      npc,
      team: key,
      name: npc ? 'DRONE-' + String(this.npcSeq % 100).padStart(2, '0') : rec.name,
      hp: npc ? w.npc.hp : w.combat.unitHp * (rec && rec.sub ? w.subs.hpMul : 1) * this.clsStat(rec, 'hp'),
      max: npc ? w.npc.hp : w.combat.unitHp * (rec && rec.sub ? w.subs.hpMul : 1) * this.clsStat(rec, 'hp'),
      cls: npc || !w.classes.enabled ? null : rec.cls,
      hits: 0,
      pop: 0,
      atb: rand(0, 0.6),
      elite: 0,
      shield: 0,
      flash: 0,
      lunge: 0,
      x: key === 'A' ? -40 : W + 40,
      y: 600,
      slot: -1,
      alive: true,
      label: npc ? 0 : 3.5,
      focus: rand(0, 1),
      bossAcc: 0,
      turretT: 1,
      sprite: null,
      spriteKey: '',
      spin: rand(0, TAU),
    };
    if (npc) this.npcSeq++;
    const slot = this.freeSlot(t, !npc);
    if (slot < 0) {
      if (npc) return null;
      t.reserve.push(u);
    } else {
      this.place(t, u, slot);
    }
    if (rec) rec.unit = u;
    return u;
  }

  place(t, u, slot) {
    u.slot = slot;
    t.slots[slot] = u;
    t.units.push(u);
    const p = slotPos(t.key, slot);
    if (this.w.units.roam) {
      // appear inside the team's zone (with the warp ring) instead of walking in
      u.x = t.key === 'A' ? 170 + Math.random() * 150 : W - 170 - Math.random() * 150;
      u.y = 380 + Math.random() * 440;
    } else if (u.x < 0 || u.x > W) u.y = p.y;
    u.pop = 1;
    this.fx.ring(this.w.units.roam ? u.x : p.x, this.w.units.roam ? u.y : p.y, this.col(t.key).c1, 4, 42, 0.45, 3);
    if (!u.npc) this.sfx.play('join');
  }

  despawn(u, silent, refill = true) {
    const t = this.teams[u.team];
    const slot = u.slot;
    u.alive = false;
    if (slot >= 0 && t.slots[slot] === u) t.slots[slot] = null;
    let i = t.units.indexOf(u);
    if (i >= 0) t.units.splice(i, 1);
    i = t.reserve.indexOf(u);
    if (i >= 0) t.reserve.splice(i, 1);
    if (u.rec && u.rec.unit === u) u.rec.unit = null;
    if (!silent) this.fx.explosion(u.x, u.y, u.npc ? '#ff2a4a' : this.col(u.team).c1, 0.8);
    u.slot = -1;
    if (refill && slot >= 0 && slot < this.maxSlots() && t.reserve.length) this.place(t, t.reserve.shift(), slot);
  }

  koUnit(u, src) {
    if (!u.alive) return;
    if (u.rec) u.rec.koAt = this.time;
    const owner = this.teams[u.team];
    if (owner.bounty === u) {
      owner.bounty = null;
      if (src && (src.team === 'A' || src.team === 'B') && src.team !== u.team) this.claimBounty(this.teams[src.team], u, src);
    }
    this.sfx.play('ko');
    if (!u.npc && this.time - (this.lastKoPop || -9) > 0.25) {
      this.lastKoPop = this.time;
      this.fx.text(u.x, u.y - 8, 'KO', '#ff2a4a', 18, true);
    }
    this.despawn(u, false);
    if (src && src.rec) {
      const r = src.rec;
      r.kills = (r.kills || 0) + 1;
      r.chain = this.time - (r.lastKill ?? -99) <= this.w.callouts.window ? (r.chain || 1) + 1 : 1;
      r.lastKill = this.time;
      if (this.w.callouts.enabled && r.chain >= 2) this.killCallout(r, src.team, r.chain);
    }
  }

  killCallout(rec, team, n) {
    const names = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'MULTI KILL'];
    const text = n >= 5 ? 'RAMPAGE' : names[n];
    if (!text || !(team === 'A' || team === 'B')) return;
    this.banner(text, cleanName(rec.name, 14).toUpperCase(), n >= 4 ? '#ff2a4a' : '#ffd34a', { side: team, prio: n >= 4 ? 2 : 1, dur: 1.4 });
    this.sfx.play('streak', n);
    this.voice.say(`${text.toLowerCase()}! ${speakable(rec.name)}`, n >= 4 ? 2 : 1);
  }

  join(rec, key) {
    const w = this.w;
    if (rec.team && rec.team !== key && !w.chat.allowSwitch) key = rec.team;
    if (rec.unit && rec.unit.alive) {
      if (rec.unit.team === key) {
        this.rally(rec);
        return rec.unit;
      }
      this.despawn(rec.unit, false);
    }
    rec.team = key;
    if (this.time - rec.koAt < w.combat.respawnCooldown) return null;
    return this.spawnUnit(key, rec, false);
  }

  rally(rec) {
    const u = rec.unit;
    if (!u || !u.alive || this.time - rec.lastRally < this.w.chat.rallyCooldown) return;
    rec.lastRally = this.time;
    u.atb = Math.min(1, u.atb + 0.12);
    u.hp = Math.min(u.max, u.hp + 2);
    u.label = 2;
  }

  // ------------------------------------------------------------- targeting
  pickTarget(t, u) {
    const e = this.teams[t.enemy];
    if (this.boss && this.boss.hp > 0) {
      u.bossAcc += 0.5;
      if (u.bossAcc >= 1) {
        u.bossAcc -= 1;
        return { kind: 'boss' };
      }
    }
    u.focus += this.w.combat.coreFocus;
    if (u.focus >= 1 || e.units.length === 0) {
      if (u.focus >= 1) u.focus -= 1;
      return { kind: 'core', team: e.key };
    }
    let best = null;
    let bs = 1e9;
    const hunter = u.cls === 'ranger';
    for (const v of e.units) {
      const s = hunter ? v.hp : Math.abs(v.y - u.y) + v.hp * 2;
      if (s < bs) {
        bs = s;
        best = v;
      }
    }
    return best ? { kind: 'unit', ref: best } : { kind: 'core', team: e.key };
  }

  retarget(src) {
    if (this.phase !== 'battle' || !src) return null;
    if (src.team === 'boss') {
      const all = this.teams.A.units.concat(this.teams.B.units);
      return all.length ? { kind: 'unit', ref: all[(Math.random() * all.length) | 0] } : null;
    }
    const t = this.teams[src.team];
    if (!t) return null;
    const e = this.teams[t.enemy];
    if (e.units.length && Math.random() < 0.5) return { kind: 'unit', ref: e.units[(Math.random() * e.units.length) | 0] };
    return { kind: 'core', team: e.key };
  }

  targetInfo(tg) {
    INFO.alive = false;
    if (!tg) return INFO;
    if (tg.kind === 'unit') {
      const u = tg.ref;
      if (u.alive && u.slot >= 0) {
        INFO.x = u.x;
        INFO.y = u.y;
        INFO.r = u.elite > 0 ? ELITE_R : UNIT_R;
        INFO.alive = true;
      }
    } else if (tg.kind === 'core') {
      const c = this.teams[tg.team].core;
      if (this.phase === 'battle') {
        INFO.x = c.x;
        INFO.y = c.y;
        INFO.r = c.r * 0.7;
        INFO.alive = true;
      }
    } else if (tg.kind === 'boss') {
      const b = this.boss;
      if (b && b.hp > 0) {
        INFO.x = b.x;
        INFO.y = b.y;
        INFO.r = b.r * 0.8;
        INFO.alive = true;
      }
    }
    return INFO;
  }

  onProjectileHit(o) {
    this.hit(o.target, o.dmg, o.src);
    if (o.kind === 1) {
      this.fx.burst(o.x, o.y, o.color, 6, 170, 3, 0.3);
      this.fx.ring(o.x, o.y, o.color, 2, 18, 0.2, 2);
      this.sfx.play('hit');
    } else {
      this.fx.burst(o.x, o.y, o.color, 4, 120, 3, 0.2);
    }
  }

  // ---------------------------------------------------------------- damage
  credit(src, dmg) {
    if (src && src.rec) {
      src.rec.damage += dmg;
      src.rec.rd += dmg;
    }
  }

  hit(tg, dmg, src) {
    if (!tg || this.phase !== 'battle') return;
    if (tg.kind === 'unit') this.damageUnit(tg.ref, dmg, src);
    else if (tg.kind === 'core') this.damageCore(this.teams[tg.team], dmg, src);
    else if (tg.kind === 'boss') this.damageBoss(dmg, src);
  }

  damageUnit(u, dmg, src) {
    if (!u.alive) return;
    const t = this.teams[u.team];
    if (u.shield > 0) {
      dmg *= 0.15;
      this.fx.ring(u.x, u.y, '#9ff6ff', UNIT_R, UNIT_R + 10, 0.2, 2);
    }
    if (t.staggerTime > 0) dmg *= this.w.stagger.damageMul;
    if (u.cls === 'knight') dmg *= 1 - this.w.classes.knight.armor;
    u.hp -= dmg;
    u.flash = 0.1;
    this.credit(src, dmg);
    if (this.w.hud.damageNumbers && dmg >= 5 && src && src.kind !== 'bolt' && src.kind !== 'turret' && src.kind !== 'boss' && src.kind !== 'commander') this.fx.text(u.x, u.y - 30, String(Math.round(dmg)), '#ffffff', 12);
    if (u.hp <= 0) this.koUnit(u, src);
  }

  damageCore(def, amt, src) {
    if (this.phase !== 'battle' || amt <= 0 || def.executing) return;
    const w = this.w;
    const c = def.core;
    const crit = def.staggerTime > 0;
    if (crit) amt *= w.stagger.damageMul;
    if (def.buffs.prism > 0) amt *= 1 - w.rifts.prismReduce;
    if (def.gate.active) {
      if (src.finisher) return this.execute(def, src);
      if (c.hp > 1) c.hp = Math.max(1, c.hp - 1); // chip damage only
      c.flash = 0.06;
      if (w.hud.damageNumbers && Math.random() < 0.25) this.fx.text(c.x + rand(-30, 30), c.y - 74, '1', '#ff8080', 12);
      return;
    }
    const gateHp = (c.max * w.execution.gatePct) / 100;
    const before = c.hp;
    let after = c.hp - amt;
    if (after <= gateHp) {
      if (src.finisher) {
        c.hp = Math.max(0, after);
        this.credit(src, before - c.hp);
        return this.execute(def, src);
      }
      after = gateHp;
    }
    c.hp = after;
    const dealt = before - after;
    this.credit(src, dealt);
    c.flash = 0.12;
    const pct = (dealt / c.max) * 100;
    if (def.staggerTime <= 0 && def.staggerImmune <= 0) {
      def.stagger += pct * w.stagger.fillPerCorePct;
      if (def.stagger >= 100) this.triggerStagger(def);
    }
    this.addLimit(def, pct * w.limit.fillPerCorePct);
    if (w.hud.damageNumbers && (dealt >= 15 || (crit && dealt >= 5))) {
      const big = dealt >= c.max * 0.02;
      this.fx.text(c.x + rand(-26, 26), c.y - 76, fmt(dealt), crit ? '#ffd34a' : big ? '#ffffff' : '#ffd6e0', big ? 22 : crit ? 18 : 14, big || crit);
    }
    if (dealt >= c.max * 0.03) this.bigHit(0.35, dealt >= c.max * 0.08);
    if (after <= gateHp + 1e-6) this.openGate(def);
  }

  damageBoss(dmg, src) {
    const b = this.boss;
    if (!b || b.hp <= 0) return;
    b.hp -= dmg;
    b.flash = 0.1;
    if (src.team === 'A' || src.team === 'B') b.credit[src.team] += dmg;
    this.credit(src, dmg);
    if (this.w.hud.damageNumbers && dmg >= 1) this.fx.text(b.x + rand(-30, 30), b.y - 80, String(Math.round(dmg)), '#e6b3ff', 13);
    if (b.hp <= 0) this.bossDefeated(src.team === 'B' ? 'B' : 'A');
  }

  bigHit(trauma, stop) {
    this.trauma = Math.min(1, this.trauma + trauma);
    if (stop && this.time - this.lastHitstop > 0.3) {
      this.lastHitstop = this.time;
      this.hitstop = 0.07;
      this.aberr = 1;
      this.glitch = 0.7;
    }
  }

  // ----------------------------------------------------------- big moments
  triggerStagger(t) {
    const w = this.w;
    t.stagger = 100;
    t.staggerTime = w.stagger.durationSeconds;
    this.banner('STAGGERED!', `${w.stagger.damageMul}X DAMAGE TAKEN`, '#ffd34a', { side: t.key });
    this.sfx.play('stagger');
    this.voice.say(`${this.col(t.key).name} is staggered! ${w.stagger.damageMul} times damage!`, 2);
    this.trauma = Math.min(1, this.trauma + 0.5);
  }

  addLimit(t, amount) {
    if (t.limitReady > 0 || amount <= 0) return;
    t.limit += amount;
    if (t.limit >= 100) this.limitReadyNow(t);
  }

  limitReadyNow(t) {
    const w = this.w;
    t.limit = 100;
    t.limitReady = w.limit.readySeconds;
    this.banner('LIMIT READY', `${this.coinsForTier(w.limit.triggerTier)}+ COIN GIFT = LIMIT BREAK`, this.col(t.key).c1, { side: t.key });
    this.sfx.play('ready');
    this.voice.say(`${this.col(t.key).name} limit break ready!`, 1);
  }

  coinsForTier(tier) {
    const g = this.w.gifts;
    return tier >= 4 ? g.tier4 : tier === 3 ? g.tier3 : tier === 2 ? g.tier2 : 1;
  }

  tierOf(gift) {
    const g = this.w.gifts;
    const o = g.overrides && g.overrides[gift.name];
    if (o) return clamp(Number(o) | 0, 1, 4);
    const c = gift.coins || 1;
    return c >= g.tier4 ? 4 : c >= g.tier3 ? 3 : c >= g.tier2 ? 2 : 1;
  }

  openGate(def) {
    if (def.gate.active || def.executing) return;
    const w = this.w;
    def.gate.active = true;
    def.gate.t = w.execution.windowSeconds;
    def.gate.lastSec = 99;
    this.banner('FINAL BLOW READY', `${this.col(def.key).name} IS OPEN: ${fmt(this.coinsForTier(def.gate.tier))}+ COIN GIFT EXECUTES`, '#ff2a4a', { dur: 2.4, prio: 3 });
    this.sfx.play('siren');
    this.voice.say(`${this.col(def.key).name} is at ${w.execution.gatePct} percent. Final blow ready!`, 2);
  }

  gateExpired(def) {
    const w = this.w;
    const g = def.gate;
    g.active = false;
    if (g.winds >= w.execution.maxSecondWinds) {
      const att = this.teams[def.enemy];
      this.execute(def, { team: att.key, rec: this.topDamage(att.key), kind: 'collapse', gift: 'COLLAPSE' });
      return;
    }
    g.winds++;
    g.tier = Math.max(w.execution.minTier, g.tier - 1);
    def.core.hp = Math.max(def.core.hp, (def.core.max * w.execution.secondWindPct) / 100);
    this.fx.ring(def.core.x, def.core.y, '#7dff9a', 20, 160, 0.8, 6);
    this.banner('SECOND WIND', `NEXT FINISHER: ${this.coinsForTier(g.tier)}+ COINS`, '#7dff9a', { side: def.key });
    this.voice.say(`${this.col(def.key).name} gets a second wind!`, 2);
  }

  phoenix(t, rec) {
    const w = this.w;
    t.gate.active = false;
    t.gate.tier = w.execution.finisherTier;
    t.gate.winds = 0;
    t.core.hp = Math.max(t.core.hp, (t.core.max * w.execution.reviveHpPct) / 100);
    t.core.ghost = t.core.hp;
    this.fx.ring(t.core.x, t.core.y, '#ffd34a', 20, 220, 1, 8);
    this.fx.burst(t.core.x, t.core.y, '#ffd34a', 60, 500, 6, 1);
    this.flash = 0.4;
    this.banner('PHOENIX REVIVE', cleanName(rec.name, 16).toUpperCase(), '#ffd34a', { side: t.key, dur: 3, prio: 3 });
    this.sfx.play('limit');
    this.voice.say(`${speakable(rec.name)} revives ${this.col(t.key).name}!`, 3);
  }

  execute(def, src) {
    if (this.phase !== 'battle' || def.executing) return;
    def.executing = true;
    def.gate.active = false;
    if (this.cine && this.cine.type === 'summon' && this.cine.climaxed) {
      this.finishRound(def, src);
      return;
    }
    this.queueCine({ type: 'summon', dur: 6, climaxAt: 4, team: src.team, rec: src.rec || null, gift: src.gift || '', mode: 'execute', def: def.key, variant: src.variant || 'leviathan' });
  }

  finishRound(def, src) {
    const w = this.w;
    const winner = this.teams[def.enemy];
    def.core.hp = 0;
    def.core.ghost = 0;
    const c = this.col(def.key);
    for (let i = 0; i < 4; i++) this.fx.explosion(def.core.x + rand(-40, 40), def.core.y + rand(-40, 40), i % 2 ? c.c1 : '#ffffff', 2.2);
    for (let i = 0; i < 90; i++) {
      const a = rand(0, TAU);
      const s = rand(150, 700);
      this.fx.particle(def.core.x, def.core.y, Math.cos(a) * s, Math.sin(a) * s - 200, rand(0.8, 1.6), rand(5, 11), i % 3 ? c.c1 : c.c2, 2, 1.2, 900);
    }
    this.flash = 0.8;
    this.trauma = 1;
    this.aberr = 1.5;
    winner.wins++;
    this.phase = 'victory';
    this.proj.clear();
    this.meteors.length = 0;
    this.cineQueue.length = 0;
    const exec = src.rec || null;
    const top = [...this.users.values()].filter((r) => r.coins > 0).sort((a, b) => b.coins - a.coins).slice(0, 3);
    this.victory = { winner: winner.key, exec, mvp: this.topDamage(winner.key), top, gift: src.gift || '', t: w.round.intermissionSeconds, sprite: null };
    this.sfx.play('victory');
    this.voice.say(`${this.col(winner.key).name} wins!${exec ? ' Executioner, ' + speakable(exec.name) + '!' : ''}`, 3);
    if (exec && this.env.onHall) this.env.onHall({ name: exec.name, team: winner.key, round: this.round, gift: src.gift || '' });
  }

  resetRound(manual = false) {
    const w = this.w;
    this.round++;
    this.phase = 'battle';
    this.victory = null;
    this.boss = null;
    this.happyHour = 0;
    this.beam = null;
    this.cine = null;
    this.cineQueue.length = 0;
    this.meteors.length = 0;
    this.proj.clear();
    for (const k of ['A', 'B']) {
      const t = this.teams[k];
      const c = t.core;
      c.max = w.combat.coreHp;
      c.hp = c.ghost = c.max;
      t.stagger = t.staggerTime = t.staggerImmune = 0;
      t.mana = t.limit = t.limitReady = 0;
      t.stacks.haste = t.stacks.bravery = t.stacks.barrage = 0;
      t.gate = { active: false, t: 0, winds: 0, tier: w.execution.finisherTier, lastSec: 99 };
      t.executing = false;
      t.bounty = null;
      t.buffs = { hyper: 0, prism: 0, phase: 0 };
      for (const u of t.units.concat(t.reserve)) {
        if (u.npc) this.despawn(u, true, false);
        else {
          u.hp = u.max;
          u.atb = rand(0, 0.5);
        }
      }
      // compact reserve into free slots
      for (let i = 0; i < this.maxSlots() && t.reserve.length; i++) if (!t.slots[i]) this.place(t, t.reserve.shift(), i);
    }
    for (const r of this.users.values()) r.rd = 0;
    this.banner(`ROUND ${this.round}`, 'FIGHT!', '#ffffff', { dur: 2.2, prio: 3 });
    this.voice.say(`Round ${this.round}. Fight!`, manual ? 3 : 2);
    const pending = this.pendingGifts.splice(0);
    pending.forEach((e, i) => setTimeout(() => this.onGift(e), 600 + i * 250));
  }

  // ------------------------------------------------------------- abilities
  addStack(t, k, n) {
    t.stacks[k] = Math.min(this.w.stacks.max, t.stacks[k] + n);
  }

  volley(t, x, y, n, dmg, src, spacing = 0.04, colorOverride = null) {
    const w = this.w;
    const e = this.teams[t.enemy];
    const color = colorOverride || this.col(t.key).c1;
    for (let i = 0; i < n; i++) {
      let target;
      if (this.boss && i % 3 === 0) target = { kind: 'boss' };
      else if (e.units.length && i % 2 === 1) target = { kind: 'unit', ref: e.units[(i * 7 + this.npcSeq) % e.units.length] };
      else target = { kind: 'core', team: e.key };
      const ang = -Math.PI / 2 - t.dir * rand(0.05, 0.95) + rand(-0.2, 0.2);
      const o = this.proj.seeker(x + rand(-6, 6), y - 10, ang, target, dmg, src, color, {
        delay: i * spacing,
        speed: w.seekers.speed * rand(0.9, 1.1),
        turn: w.seekers.turn,
        ignition: w.seekers.ignition,
      });
      // Pool full: never drop a gifter's damage, apply it directly instead.
      if (!o && src.kind !== 'turret') this.hit(target, dmg, src);
    }
    if (n > 0) this.sfx.play('launch');
  }

  storm(t, power, src) {
    const e = this.teams[t.enemy];
    const color = this.col(t.key).c1;
    const targets = e.units.slice(0, 12);
    const share = targets.length ? (power * 0.4) / targets.length : 0;
    for (const u of targets) {
      this.fx.zap(u.x + rand(-40, 40), 260, u.x, u.y, color, 0.4);
      this.damageUnit(u, share, src);
    }
    this.fx.zap(e.core.x + rand(-20, 20), 250, e.core.x, e.core.y, '#ffffff', 0.5);
    this.fx.explosion(e.core.x, e.core.y, color, 1.6);
    this.damageCore(e, power * (targets.length ? 0.6 : 1), src);
    this.addLimit(t, 15);
    this.banner('STORM', cleanName(src.rec.name, 16).toUpperCase(), color, { side: t.key, small: true });
    this.sfx.play('boom', 2);
    this.bigHit(0.5, true);
  }

  comboBurst(t, rec, th, src) {
    const e = this.teams[t.enemy];
    const o = rec.unit && rec.unit.alive ? rec.unit : t.core;
    this.banner(`COMBO x${th}`, cleanName(rec.name, 16).toUpperCase(), '#ffd34a', { prio: th >= 50 ? 3 : th >= 25 ? 2 : 1 });
    this.fx.ring(o.x, o.y, '#ffd34a', 10, 420, 0.7, 8);
    this.fx.ring(o.x, o.y, this.col(t.key).c1, 10, 300, 0.5, 5);
    for (const u of e.units.slice()) {
      if (u.npc) this.koUnit(u, src);
      else this.damageUnit(u, 8 + th, src);
    }
    this.addLimit(t, this.w.limit.comboFill);
    this.bigHit(0.5, true);
    this.voice.say(`${speakable(rec.name)}, combo ${th}!`, 1);
  }

  castMeteor(t) {
    const e = this.teams[t.enemy];
    const w = this.w;
    for (let i = 0; i < w.mana.meteors; i++) {
      const u = e.units.length && i % 2 ? e.units[i % e.units.length] : null;
      const tx = u ? u.x : e.core.x + rand(-30, 30);
      const ty = u ? u.y : e.core.y + rand(-30, 30);
      this.meteors.push({ sx: tx - t.dir * 240, sy: 140, tx, ty, t: 0, dur: 0.6, delay: i * 0.16, team: t.key, onCore: !u, dmg: w.mana.meteorDamage });
    }
    this.banner('METEOR', 'LIKES UNLEASHED', '#ff5fa8', { side: t.key, small: true });
    this.sfx.play('meteor');
  }

  castMeteorSmall(t, n) {
    const e = this.teams[t.enemy];
    for (let i = 0; i < n; i++) {
      const u = e.units.length ? e.units[Math.floor(Math.random() * e.units.length)] : null;
      const tx = u ? u.x : e.core.x;
      const ty = u ? u.y : e.core.y;
      this.meteors.push({ sx: tx - t.dir * 240, sy: 140, tx, ty, t: 0, dur: 0.6, delay: i * 0.2, team: t.key, onCore: !u, dmg: this.w.mana.meteorDamage * 0.6 });
    }
    this.sfx.play('meteor');
  }

  startLimit(t, rec) {
    const w = this.w;
    const e = this.teams[t.enemy];
    t.limitReady = 0;
    t.limit = 0;
    const hits = clamp(Math.round(w.limit.hits), 3, 30);
    this.queueCine({ type: 'limit', dur: 3.2, team: t.key, rec, hits, dmg: (e.core.max * w.limit.damagePct) / 100 / hits, def: e.key });
  }

  limitHit(c) {
    const e = this.teams[c.def];
    const color = this.col(c.team).c1;
    const src = { team: c.team, rec: c.rec, kind: 'limit' };
    let x = e.core.x;
    let y = e.core.y;
    if (c.done % 2 === 0 && e.units.length) {
      const u = e.units[c.done % e.units.length];
      x = u.x;
      y = u.y;
      this.damageUnit(u, 12, src);
    }
    const a = rand(0, Math.PI);
    this.fx.slash(x - Math.cos(a) * 90, y - Math.sin(a) * 90, x + Math.cos(a) * 90, y + Math.sin(a) * 90, color, 0.25);
    this.fx.explosion(x, y, color, 0.9);
    this.damageCore(e, c.dmg, src);
    this.sfx.play('slash');
    this.trauma = Math.min(1, this.trauma + 0.15);
  }

  spawnBoss() {
    if (this.boss || this.phase !== 'battle') return;
    const w = this.w;
    this.boss = { x: W / 2, y: 640, r: 66, hp: w.boss.hp, max: w.boss.hp, t: w.boss.seconds, fireT: 2, ang: 0, flash: 0, enter: 0, credit: { A: 0, B: 0 } };
    this.banner('BOSS INVASION', 'BOTH TEAMS: TAKE IT DOWN', '#c77dff', { dur: 2.5, prio: 3 });
    this.sfx.play('siren');
    this.voice.say('Boss invasion! Both teams, take it down!', 2);
  }

  bossDefeated(key) {
    const b = this.boss;
    const t = this.teams[key];
    this.boss = null;
    this.fx.explosion(b.x, b.y, '#c77dff', 3);
    this.fx.explosion(b.x, b.y, '#ffffff', 1.5);
    this.addStack(t, 'bravery', 15);
    this.addStack(t, 'haste', 10);
    t.core.hp = Math.min(t.core.max, t.core.hp + t.core.max * 0.1);
    this.banner('BOSS SLAIN', `${this.col(key).name} +15 BRAVERY +10 HASTE`, '#c77dff', { dur: 2.5 });
    this.sfx.play('boom', 3);
    this.bigHit(0.8, true);
    this.voice.say(`${this.col(key).name} slays the boss!`, 2);
  }

  // -------------------------------------------------------------- cinematics
  queueCine(c) {
    c.t = 0;
    c.climaxed = false;
    c.done = 0;
    if (!this.cine) this.startCine(c);
    else if (this.cineQueue.length < 6) this.cineQueue.push(c);
  }

  startCine(c) {
    this.cine = c;
    for (const b of this.banners) if (b.prio < 3) b.t = Math.max(b.t, b.dur - 0.12);
    const name = c.rec ? speakable(c.rec.name) : 'the crowd';
    if (c.type === 'limit') {
      this.sfx.play('limit');
      this.voice.say(`${name}. Limit break!`, 3);
    } else if (c.type === 'summon') {
      this.sfx.play('summon');
      this.voice.say(c.mode === 'execute' ? `${name} lands the final blow!` : `Grand summon by ${name}!`, 3);
    }
  }

  whalePos(c) {
    const p = clamp(c.t / c.climaxAt, 0, 1);
    const e = 1 - Math.pow(1 - p, 2);
    const dir = this.teams[c.team] ? this.teams[c.team].dir : 1;
    const x0 = dir > 0 ? -300 : W + 300;
    const x1 = dir > 0 ? W * 0.42 : W * 0.58;
    let x = x0 + (x1 - x0) * e;
    if (c.t > c.climaxAt) x = x1 + dir * (c.t - c.climaxAt) * 260;
    return { x, y: 470 + Math.sin(c.t * 2.2) * 16, dir };
  }

  summonClimax(c) {
    const def = this.teams[c.def];
    const color = this.col(c.team).c1;
    if (c.variant === 'orbital') {
      this.beam = { x1: def.core.x, y1: -60, x2: def.core.x, y2: def.core.y, t: 1.1, max: 1.1, color, wide: 1.6 };
    } else {
      const wp = this.whalePos(c);
      this.beam = { x1: wp.x + wp.dir * 200, y1: wp.y - 10, x2: def.core.x, y2: def.core.y, t: 0.9, max: 0.9, color };
    }
    this.flash = 0.7;
    this.trauma = 1;
    this.aberr = 1.6;
    this.glitch = 1;
    this.fx.explosion(def.core.x, def.core.y, '#ffffff', 3);
    this.fx.explosion(def.core.x, def.core.y, color, 2.5);
    this.sfx.play('beam');
    this.sfx.play('boom', 3);
    const src = { team: c.team, rec: c.rec, kind: 'summon', gift: c.gift, finisher: true };
    for (const u of def.units.slice()) this.damageUnit(u, 25, src);
    if (c.mode === 'execute') this.finishRound(def, src);
    else this.damageCore(def, c.power, src);
  }

  updateCinematic(dt) {
    const c = this.cine;
    if (!c) return;
    c.t += dt;
    if (c.type === 'limit') {
      const span = 1.6 / c.hits;
      while (c.t >= 1.0 && c.done < c.hits && c.done < Math.floor((c.t - 1.0) / span) + 1) {
        c.done++;
        this.limitHit(c);
      }
    } else if (c.type === 'summon') {
      if (!c.climaxed && c.t >= c.climaxAt) {
        c.climaxed = true;
        this.summonClimax(c);
      }
      if (c.t > 0.6 && c.t < c.climaxAt && c.variant === 'orbital') {
        this.trauma = Math.max(this.trauma, 0.12 + (c.t / c.climaxAt) * 0.2);
        this.aberr = Math.max(this.aberr, (c.t / c.climaxAt) * 0.8);
      } else if (c.t > 0.6 && c.t < c.climaxAt) {
        this.trauma = Math.max(this.trauma, 0.22);
        this.aberr = Math.max(this.aberr, (c.t / c.climaxAt) * 0.8);
        const wp = this.whalePos(c);
        const col = this.col(c.team).c1;
        for (let i = 0; i < 3; i++) this.fx.particle(wp.x - wp.dir * 200 + rand(-20, 20), wp.y + rand(-40, 40), -wp.dir * rand(60, 200), rand(-40, 40), rand(0.4, 0.9), rand(3, 7), i ? col : '#ffffff', 0, 2);
      }
    }
    if (c.t >= c.dur) {
      this.cine = this.cineQueue.shift() || null;
      if (this.cine) this.startCine(this.cine);
    }
  }

  // ------------------------------------------------------------ announcers
  // One banner per zone (left / center / right). Higher priority replaces
  // lower; lower waits briefly in a queue; flavor banners (prio 1) are simply
  // dropped when the zone is busy. Only prio 3 shows during cinematics.
  banner(text, sub, color, opt = {}) {
    const anchor = opt.side || 'C';
    const prio = opt.prio || (opt.small ? 1 : 2);
    if (this.cine && prio < 3) return;
    const b = { text, sub, color, anchor, prio, t: 0, dur: opt.dur || (prio === 1 ? 1.3 : 1.9), small: prio === 1, wait: 0 };
    const cur = this.banners.find((x) => x.anchor === anchor);
    if (!cur) {
      this.banners.push(b);
      return;
    }
    if (prio >= cur.prio) {
      cur.t = Math.max(cur.t, cur.dur - 0.12);
      this.bannerQ.unshift(b);
    } else if (prio > 1) {
      this.bannerQ.push(b);
    }
    this.bannerQ.sort((x, y) => y.prio - x.prio);
    if (this.bannerQ.length > 6) this.bannerQ.length = 6;
  }

  updateBanners(dt) {
    for (let i = this.banners.length - 1; i >= 0; i--) {
      const b = this.banners[i];
      if ((b.t += dt) > b.dur) this.banners.splice(i, 1);
    }
    for (let i = this.bannerQ.length - 1; i >= 0; i--) {
      const q = this.bannerQ[i];
      q.wait += dt;
      if (q.wait > (q.prio >= 3 ? 6 : 2.5)) this.bannerQ.splice(i, 1);
    }
    for (const anchor of ['A', 'B', 'C']) {
      if (this.banners.some((b) => b.anchor === anchor)) continue;
      const i = this.bannerQ.findIndex((q) => q.anchor === anchor && (!this.cine || q.prio >= 3));
      if (i >= 0) this.banners.push(this.bannerQ.splice(i, 1)[0]);
    }
  }

  pushFeed(text, color, tier = 1) {
    this.feed.push({ text, color, tier, t: 0 });
    if (this.feed.length > 4) this.feed.shift();
  }

  // ---------------------------------------------------------------- events
  handle(e) {
    if (!e || !e.type) return;
    switch (e.type) {
      case 'chat':
        return this.onChat(e);
      case 'gift':
        return this.onGift(e);
      case 'like':
        return this.onLike(e);
      case 'share':
        return this.onShare(e);
      case 'follow':
        return this.onFollow(e);
      case 'viewers':
        this.viewers = e.count;
        return;
      case 'member':
        if (this.w.welcome.enabled && this.time - this.welcomeT >= this.w.welcome.everySeconds) {
          this.welcomeT = this.time;
          this.welcome = { name: cleanName(e.user.name || e.user.uid, 14), t: 0 };
        }
        return;
    }
  }

  onChat(e) {
    const rec = this.ensureUser(e.user);
    const w = this.w;
    const first = (String(e.text || '').trim().toLowerCase().split(/\s+/)[0] || '').replace(/[^a-z0-9]/g, '');
    this.act.chat++;
    let key = null;
    if (w.chat.joinA.includes(first)) key = 'A';
    else if (w.chat.joinB.includes(first)) key = 'B';
    if (key && !rec.team) this.addEnergy(w.ascension.perJoin);
    const clsWord = CLASS_WORD.get(first);
    this.rando.onChat(e.text);
    const voted = this.crowd.onChat(rec, first);
    this.legendHit[key ? 'side' : 'chat'] = 1;
    // any message enlists a newcomer on the underdog side (typing A/B picks a side instead)
    if (!key && !rec.team && w.chat.autoJoinAny && this.phase === 'battle') {
      this.addEnergy(w.ascension.perJoin);
      this.join(rec, this.underdog());
    }
    const team = rec.team || key;
    if (team) this.riftProgress(team, 'chat', 1);
    if (clsWord && !voted) {
      if (!rec.team && this.phase === 'battle') this.join(rec, this.underdog());
      this.setClass(rec, clsWord);
      if (!rec.unit && rec.team && this.phase === 'battle') this.join(rec, rec.team);
    }
    if (key) return this.join(rec, key);
    if (rec.unit && rec.unit.alive) this.rally(rec);
  }

  onLike(e) {
    const w = this.w;
    const rec = this.ensureUser(e.user);
    if (!rec.team && w.likes.autoJoin && this.phase === 'battle') this.join(rec, this.underdog());
    const key = rec.team || this.underdog();
    const t = this.teams[key];
    const enemy = this.teams[t.enemy];
    t.mana += e.count;
    this.legendHit.like = 1;
    this.rando.onLike(key, e.count);
    // LIKE = ATTACK: heart missiles from the liker toward the enemy
    if (w.likes.attack && this.phase === 'battle' && !this.cine) {
      const n = Math.min(w.likes.maxMissiles, Math.ceil(e.count / w.likes.perMissile));
      const u = rec.unit && rec.unit.alive && rec.unit.slot >= 0 ? rec.unit : null;
      const src = { team: key, rec, kind: 'like' };
      this.volley(t, u ? u.x : t.core.x, u ? u.y : t.core.y, n, (e.count * w.likes.damagePerLike) / n, src, 0.05, '#ff5fa8');
    }
    this.act.like += e.count;
    this.crowd.add('like', e.count);
    this.addEnergy(e.count * w.ascension.perLike);
    this.riftProgress(key, 'like', e.count);
    if (this.phase === 'battle' && enemy.staggerTime <= 0 && enemy.staggerImmune <= 0) {
      enemy.stagger += e.count * w.stagger.likeFill;
      if (enemy.stagger >= 100) this.triggerStagger(enemy);
    }
    const o = rec.unit && rec.unit.alive ? rec.unit : t.core;
    if (this.fx.p.length < 2500) for (let i = 0; i < Math.min(4, e.count); i++) this.fx.particle(o.x + rand(-14, 14), o.y + 10, rand(-30, 30), rand(-160, -90), 0.8, 4, '#ff5fa8', 0, 1.5);
    while (t.mana >= w.mana.likesPerCast && this.phase === 'battle') {
      t.mana -= w.mana.likesPerCast;
      this.castMeteor(t);
    }
  }

  ensureFighter(rec) {
    if (!rec.team) rec.team = this.underdog();
    if (!rec.unit || !rec.unit.alive) {
      rec.koAt = -99;
      this.spawnUnit(rec.team, rec, false);
    }
    return rec.unit;
  }

  onShare(e) {
    const rec = this.ensureUser(e.user);
    this.addEnergy(this.w.ascension.perShare);
    this.legendHit.share = 1;
    this.crowd.add('share', 1);
    const u = this.ensureFighter(rec);
    const t = this.teams[rec.team];
    if (u) {
      u.shield = 10;
      u.label = 3;
      this.fx.ring(u.x, u.y, '#9ff6ff', 10, 60, 0.5, 4);
    }
    this.addStack(t, 'barrage', 2);
    this.pushFeed(`${rec.name} SHARED > SHIELD`, '#9ff6ff');
    this.sfx.play('shield');
    this.voice.say(`Thanks for the share, ${speakable(rec.name)}!`, 1);
  }

  onFollow(e) {
    const rec = this.ensureUser(e.user);
    if (!rec.followed) this.crowd.add('follow', 1);
    rec.followed = true;
    rec.follower = true;
    this.legendHit.follow = 1;
    const key = rec.team || this.underdog();
    this.addStack(this.teams[key], 'haste', 2);
    if (rec.unit) rec.unit.spriteKey = '';
    this.pushFeed(`${rec.name} FOLLOWED > +HASTE`, '#7dff9a');
  }

  onGift(e) {
    const w = this.w;
    if (!e.delta || e.delta <= 0) return; // streak-end marker, nothing new was sent
    const rec = this.ensureUser(e.user);
    this.legendHit.gift = 1;
    if (this.phase !== 'battle') {
      if (this.pendingGifts.length < 50) this.pendingGifts.push(e);
      return;
    }
    this.ensureFighter(rec);
    const key = rec.team;
    const t = this.teams[key];
    const e2 = this.teams[t.enemy];
    const coins = Math.max(1, e.gift.coins);
    const n = e.delta;
    rec.coins += coins * n;
    const tier = this.tierOf(e.gift);
    let mul = this.happyHour > 0 ? w.gifts.happyHourMul : 1;
    const under = this.underdogMul(key);
    mul *= under;
    mul *= DIM_GIFT[this.asc.level - 1];
    if (t.buffs.phase > 0) mul *= w.rifts.phaseMul;
    this.act.gift += n;
    this.act.coin += coins * n;
    this.addEnergy(coins * n * w.ascension.perCoin);
    this.riftProgress(key, 'gift', n);
    this.riftProgress(key, 'coin', coins * n);
    if (w.firstGift.enabled && !rec.gifted) {
      mul *= w.firstGift.mul;
      this.banner('FIRST GIFT', `${cleanName(rec.name, 14).toUpperCase()} +${Math.round((w.firstGift.mul - 1) * 100)}%`, '#7dff9a', { side: key, small: true });
    }
    rec.gifted = true;
    const power = n * w.gifts.powerScale * Math.pow(coins, w.gifts.exponent) * mul;
    const variant = coins >= w.gifts.orbitalCoins ? 'orbital' : 'leviathan';
    const src = { team: key, rec, kind: 'gift', tier, gift: e.gift.name, coins, variant, finisher: tier >= e2.gate.tier };
    this.pushFeed(`${rec.name} > ${e.gift.name.toUpperCase()} x${n}`, this.col(key).c1, tier);
    this.sfx.play('coin');
    const unit = rec.unit && rec.unit.alive && rec.unit.slot >= 0 ? rec.unit : null;
    if (unit) unit.label = 3;
    const ox = unit ? unit.x : t.core.x;
    const oy = unit ? unit.y : t.core.y;

    // Whale wars: a finisher-tier gift during a gate window decides it.
    if (e2.gate.active && !e2.executing && tier >= e2.gate.tier) {
      this.execute(e2, src);
      return;
    }
    if (t.gate.active && tier >= t.gate.tier) this.phoenix(t, rec);
    if (t.limitReady > 0 && tier >= w.limit.triggerTier) this.startLimit(t, rec);

    if (tier === 1) {
      const cnt = clamp(Math.ceil(3 * n * (this.asc.level >= 2 ? 1.25 : 1)), 3, 40);
      this.volley(t, ox, oy, cnt, power / cnt, src, 0.035);
      this.addStack(t, 'bravery', n);
      this.addStack(t, 'barrage', n);
    } else if (tier === 2) {
      if (unit) {
        unit.elite = w.gifts.eliteSeconds;
        unit.hp = unit.max;
        unit.shield = Math.max(unit.shield, 3);
        unit.spriteKey = '';
      }
      this.addStack(t, 'haste', 5 * n);
      const cnt = clamp(Math.ceil(8 * n * (this.asc.level >= 2 ? 1.25 : 1)), 8, 54);
      this.volley(t, ox, oy, cnt, power / cnt, src, 0.03);
      this.banner('SURGE', cleanName(rec.name, 16).toUpperCase(), this.col(key).c1, { side: key, small: true });
    } else if (tier === 3) {
      this.storm(t, power, src);
    } else {
      this.queueCine({ type: 'summon', dur: 6, climaxAt: 4, team: key, rec, gift: e.gift.name, mode: 'damage', power, def: e2.key, variant });
    }

    if (e.gift.streakable) {
      const prev = e.total - n;
      for (const th of w.gifts.comboThresholds) if (prev < th && e.total >= th) this.comboBurst(t, rec, th, src);
    }
  }

  command(c) {
    const w = this.w;
    const t = c.team ? this.teams[c.team] : null;
    switch (c.type) {
      case 'forceStagger':
        if (t) {
          t.staggerImmune = 0;
          this.triggerStagger(t);
        }
        break;
      case 'fillLimit':
        if (t) {
          t.limitReady = 0;
          t.limit = 0;
          this.addLimit(t, 100);
        }
        break;
      case 'forceGate':
        if (t && this.phase === 'battle' && !t.executing) {
          t.core.hp = (t.core.max * w.execution.gatePct) / 100;
          this.openGate(t);
        }
        break;
      case 'heal':
        if (t) t.core.hp = t.core.max;
        break;
      case 'randonaut':
        if (this.phase === 'battle') this.rando.spawn(['attractor', 'void', 'anomaly'].includes(c.kind) ? c.kind : null);
        break;
      case 'openRift':
        if (this.phase === 'battle') {
          const i = RIFTS.findIndex((r) => r.kind === c.kind);
          if (i >= 0) this.rift.idx = i;
          this.riftIncoming();
        }
        break;
      case 'ascend': {
        const th = w.ascension.thresholds;
        const lvl = clamp(this.asc.level + (Number(c.delta) || 1), 1, 5);
        this.asc.energy = th[lvl - 1] + (lvl < 5 ? (th[lvl] - th[lvl - 1]) * 0.3 : 500);
        if (lvl > this.asc.level) this.levelUp(lvl);
        else this.asc.level = lvl;
        break;
      }
      case 'setHp':
        if (t && this.phase === 'battle' && !t.gate.active) t.core.hp = Math.max(t.core.max * (w.execution.gatePct / 100 + 0.01), (t.core.max * clamp(Number(c.pct) || 50, 1, 100)) / 100);
        break;
      case 'meteor':
        if (t && this.phase === 'battle') this.castMeteor(t);
        break;
      case 'happyHour':
        this.happyHour = w.gifts.happyHourSeconds;
        this.banner('HAPPY HOUR', `${w.gifts.happyHourMul}X GIFT POWER`, '#ff5fa8', { dur: 2.5, prio: 3 });
        this.voice.say(`Happy hour! Gifts hit ${w.gifts.happyHourMul} times harder!`, 3);
        break;
      case 'boss':
        this.spawnBoss();
        break;
      case 'poll':
        // a rift that is only counting down steps aside; a running one finishes first
        if (this.rift.phase === 'incoming') {
          this.rift.phase = 'idle';
          this.rift.t = 20;
        }
        if (!this.crowd.poll && this.phase === 'battle') {
          if (this.crowd.canPoll()) {
            this.crowd.openPoll();
            this.crowd.pollT = w.polls.everySeconds;
          } else this.crowd.pollT = 0;
        }
        break;
      case 'resetRound':
        this.resetRound(true);
        break;
      case 'announce':
        if (c.text) {
          this.banner(String(c.text).toUpperCase().slice(0, 28), '', '#ffffff', { dur: 3, prio: 3 });
          this.voice.say(String(c.text), 3);
        }
        break;
    }
  }

  // ---------------------------------------------------------------- update
  update(dtReal) {
    const w = this.w;
    this.updateCinematic(dtReal);
    let dt = dtReal * (this.cine ? 0.18 : 1) * this.rando.timeScale();
    if (this.hitstop > 0) {
      this.hitstop -= dtReal;
      dt = 0;
    }
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dtReal * 1.6);
    const sh = this.trauma * this.trauma * 16;
    this.shakeX = rand(-sh, sh);
    this.shakeY = rand(-sh, sh);
    this.flash = Math.max(0, this.flash - dtReal * 2.5);
    this.aberr = Math.max(0, this.aberr - dtReal * 2);
    this.glitch = Math.max(0, this.glitch - dtReal * 2.5);
    this.updateBanners(dtReal);
    for (const f of this.feed) f.t += dtReal;
    if (this.beam && (this.beam.t -= dtReal) <= 0) this.beam = null;
    this.guideT += dtReal;
    this.proj.maxActive = w.seekers.maxActive;

    if (this.phase === 'victory') {
      if (!this.cine) {
        this.victory.t -= dtReal;
        if (this.victory.t <= 0) this.resetRound();
      }
      this.fx.update(dt || dtReal * 0.2);
      return;
    }

    if (this.happyHour > 0) this.happyHour -= dt;
    for (const k of ['A', 'B']) this.updateTeam(this.teams[k], dt);
    if (this.boss) this.updateBoss(dt);
    this.updateMeteors(dt);
    this.updateCommanders(dt);
    this.updateBounties(dt);
    this.updateAscension(dt);
    this.updateRift(dt);
    this.rando.update(dt);
    this.crowd.update(dt);
    for (const k in this.legendHit) this.legendHit[k] = Math.max(0, this.legendHit[k] - dtReal * 2);
    if (this.welcome && (this.welcome.t += dtReal) > 3.5) this.welcome = null;

    if (w.npc.enabled && (this.npcTimer -= dt) <= 0) {
      this.npcTimer = w.npc.checkSeconds;
      for (const k of ['A', 'B']) {
        const t = this.teams[k];
        const min = Math.min(this.maxSlots(), k === 'A' ? w.npc.minA : w.npc.minB);
        const need = Math.min(w.npc.perCheck, min - t.units.length);
        for (let i = 0; i < need; i++) this.spawnUnit(k, null, true);
      }
    }

    const ra = this.teams.A.core.hp / this.teams.A.core.max;
    const rb = this.teams.B.core.hp / this.teams.B.core.max;
    this.territory += (clamp(ra - rb, -1, 1) - this.territory) * damp(1.5, dt);
    this.territoryX = W / 2 + this.territory * 150;

    this.proj.update(dt, this, this.fx, w.seekers.smoke && !(this.env.quality && this.env.quality() >= 1));
    this.fx.update(dt);
  }

  updateTeam(t, dt) {
    const w = this.w;
    const c = t.core;
    c.ghost = c.ghost > c.hp ? Math.max(c.hp, c.ghost - Math.max(c.max * 0.02, (c.ghost - c.hp) * 2.5) * dt) : c.hp;
    c.flash = Math.max(0, c.flash - dt * 4);
    c.ang += dt * (0.6 + t.stacks.haste * 0.02);
    if ((t.decay += dt) >= w.stacks.decaySeconds) {
      t.decay = 0;
      for (const k of ['haste', 'bravery', 'barrage']) if (t.stacks[k] > 0) t.stacks[k] = Math.max(0, t.stacks[k] - Math.max(1, Math.ceil(t.stacks[k] * 0.06)));
    }
    if (t.staggerTime > 0) {
      t.staggerTime -= dt;
      t.stagger = (100 * Math.max(0, t.staggerTime)) / w.stagger.durationSeconds;
      if (t.staggerTime <= 0) {
        t.staggerTime = 0;
        t.stagger = 0;
        t.staggerImmune = w.stagger.immuneSeconds;
      }
    } else if (t.staggerImmune > 0) t.staggerImmune -= dt;
    for (const k in t.buffs) if (t.buffs[k] > 0) t.buffs[k] = Math.max(0, t.buffs[k] - dt);
    if (t.limitReady > 0 && (t.limitReady -= dt) <= 0) {
      t.limitReady = 0;
      t.limit = 60;
    }
    if (t.gate.active) {
      t.gate.t -= dt;
      const sec = Math.ceil(t.gate.t);
      if (sec !== t.gate.lastSec) {
        t.gate.lastSec = sec;
        if (sec <= 10) this.sfx.play('siren');
      }
      if (t.gate.t <= 0) this.gateExpired(t);
    }
    if (t.stacks.barrage > 0 && !this.cine) {
      if ((t.barrageT -= dt) <= 0) {
        t.barrageT = w.stacks.barrageEvery;
        const n = Math.min(t.stacks.barrage, w.stacks.barrageMax);
        this.volley(t, c.x, c.y - 30, n, w.seekers.damage, { team: t.key, kind: 'turret' }, 0.06);
      }
    }
    for (let i = t.units.length - 1; i >= 0; i--) {
      const u = t.units[i];
      if (u) this.updateUnit(t, u, dt);
    }
  }

  updateUnit(t, u, dt) {
    const w = this.w;
    if (w.units.roam) this.roam(t, u, dt);
    else {
      const p = slotPos(t.key, u.slot);
      const k = damp(6, dt);
      u.x += (p.x - u.x) * k;
      u.y += (p.y - u.y) * k;
    }
    u.flash = Math.max(0, u.flash - dt);
    if (u.pop > 0) u.pop = Math.max(0, u.pop - dt * 2.5);
    u.label -= dt;
    u.spin += dt * (u.elite > 0 ? 4 : 1);
    if (u.shield > 0) u.shield -= dt;
    if (u.lunge > 0) u.lunge = Math.max(0, u.lunge - dt / w.atb.lungeTime);
    if (u.elite > 0) {
      u.elite -= dt;
      if (u.elite <= 0) u.spriteKey = '';
      else if ((u.turretT -= dt) <= 0) {
        u.turretT = 1.0;
        this.volley(t, u.x, u.y, 2, w.seekers.damage * 1.5, { team: t.key, rec: u.rec, kind: 'elite' }, 0.08);
      }
    }
    if (this.cine || this.rando.frozen(t.key)) return; // turn bars pause during cinematics and ICE
    const cw = u.cls ? w.classes[u.cls] : null;
    const haste = (1 + soft(t.stacks.haste) * w.atb.hastePerStack + (u.elite > 0 ? 0.35 : 0)) * (u.rec && u.rec.sub ? w.subs.atbMul : 1) * DIM_ATB[this.asc.level - 1] * (t.buffs.hyper > 0 ? w.rifts.hyperMul : 1) * (cw ? cw.atb : 1);
    u.atb += (dt * haste) / Math.max(0.5, w.atb.baseSeconds);
    if (u.atb >= 1) {
      u.atb = 0;
      const target = this.pickTarget(t, u);
      if (!target) return;
      u.lunge = 1;
      u.hits++;
      let dmg = (u.npc ? w.npc.damage : w.combat.unitDamage) * (1 + soft(t.stacks.bravery) * w.stacks.braveryPerStack) * (u.elite > 0 ? 1.8 : 1) * (cw ? cw.dmg : 1);
      const src = { team: t.key, rec: u.rec, kind: 'bolt' };
      const ccol = u.cls ? CLASSES[u.cls].color : this.col(t.key).c1;
      if (u.cls === 'mage') {
        // three arcane seekers instead of one bolt
        this.volley(t, u.x, u.y, cw.shots, dmg / cw.shots, { team: t.key, rec: u.rec, kind: 'turret' }, 0.06, ccol);
        this.sfx.play('laser');
        return;
      }
      if (u.cls === 'cleric') this.clericHeal(t, u, cw);
      if (u.cls === 'rogue' && u.hits % cw.every === 0) {
        dmg *= cw.crit;
        if (u.slot >= 0) this.fx.text(u.x, u.y - 40, 'BACKSTAB', ccol, 11, true);
      }
      const info = this.targetInfo(target);
      if (info.alive) this.proj.bolt(u.x + t.dir * 22, u.y, info.x, info.y, target, dmg, src, u.cls === 'rogue' || u.cls === 'ranger' ? ccol : this.col(t.key).c1, w.combat.boltSpeed * (u.cls === 'ranger' ? 1.35 : 1));
      this.sfx.play('laser');
    }
  }

  clericHeal(t, u, cw) {
    let best = null;
    for (const v of t.units) if (v.alive && v.slot >= 0 && v.hp < v.max && (!best || v.hp / v.max < best.hp / best.max)) best = v;
    if (!best) return;
    best.hp = Math.min(best.max, best.hp + cw.heal);
    this.fx.ring(best.x, best.y, '#7dff9a', 4, 30, 0.35, 2);
    if (this.fx.p.length < 2500) for (let i = 0; i < 4; i++) this.fx.particle(best.x + rand(-10, 10), best.y + 6, rand(-14, 14), rand(-90, -50), 0.7, 3, '#b9ffc8', 0, 1);
  }

  // Avatars float around their own half: each picks a wander point in its
  // team's zone (behind the territory line), drifts there, keeps clear of
  // teammates, then picks a new point. Cosmetic only; combat is unchanged.
  roam(t, u, dt) {
    const w = this.w.units;
    // each side keeps a roomy zone; the territory line only nudges it
    const line = clamp(this.territoryX, 320, 400);
    const minX = t.key === 'A' ? 160 : line + 40;
    const maxX = t.key === 'A' ? line - 40 : W - 160;
    if (u.wx == null || (u.wt -= dt) <= 0 || Math.hypot(u.wx - u.x, u.wy - u.y) < 10) {
      u.wx = minX + Math.random() * Math.max(20, maxX - minX);
      u.wy = 360 + Math.random() * 470;
      u.wt = 3 + Math.random() * 4;
    }
    u.wx = clamp(u.wx, minX, Math.max(minX, maxX));
    let ax = u.wx - u.x;
    let ay = u.wy - u.y;
    const d = Math.hypot(ax, ay) || 1;
    const sp = w.roamSpeed * (1 + Math.min(4, d / 120)); // hurry back when far away
    let vx = (ax / d) * sp;
    let vy = (ay / d) * sp;
    for (const o of t.units) {
      if (o === u) continue;
      const dx = u.x - o.x;
      const dy = u.y - o.y;
      const dd = dx * dx + dy * dy;
      if (dd < 64 * 64 && dd > 0.01) {
        const f = (64 * 64 - dd) / (64 * 64);
        const l = Math.sqrt(dd);
        vx += (dx / l) * 140 * f;
        vy += (dy / l) * 140 * f;
      }
    }
    const k = damp(3, dt);
    u.vx = (u.vx || 0) + (vx - (u.vx || 0)) * k;
    u.vy = (u.vy || 0) + (vy - (u.vy || 0)) * k;
    u.x = clamp(u.x + u.vx * dt, t.key === 'A' ? 120 : minX - 30, t.key === 'A' ? maxX + 30 : W - 120);
    u.y = clamp(u.y + u.vy * dt + Math.sin(this.time * 2 + u.spin) * 6 * dt, 340, 860);
  }

  updateBoss(dt) {
    const b = this.boss;
    const w = this.w;
    b.enter = Math.min(1, b.enter + dt);
    b.t -= dt;
    b.ang += dt;
    b.flash = Math.max(0, b.flash - dt);
    b.y = 640 + Math.sin(this.time * 1.5) * 14;
    if ((b.fireT -= dt) <= 0) {
      b.fireT = w.boss.fireEvery;
      for (const k of ['A', 'B']) {
        const t = this.teams[k];
        for (let i = 0; i < Math.min(3, t.units.length); i++) {
          const u = t.units[(Math.random() * t.units.length) | 0];
          this.proj.seeker(b.x, b.y, -Math.PI / 2 + rand(-1, 1), { kind: 'unit', ref: u }, 6, { team: 'boss', kind: 'boss' }, '#c77dff', { delay: i * 0.08, speed: 700, turn: 6, ignition: 0.2 });
        }
      }
    }
    if (b.t <= 0) {
      this.boss = null;
      this.banner('BOSS ESCAPED', '', '#c77dff');
    }
  }

  updateMeteors(dt) {
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      if (m.delay > 0) {
        m.delay -= dt;
        continue;
      }
      m.t += dt;
      const p = Math.min(1, m.t / m.dur);
      const e = p * p;
      m.x = m.sx + (m.tx - m.sx) * e;
      m.y = m.sy + (m.ty - m.sy) * e;
      if (this.fx.p.length < 3000) {
        this.fx.particle(m.x + rand(-6, 6), m.y + rand(-6, 6), rand(-40, 40), rand(-60, -20), 0.4, rand(4, 8), Math.random() < 0.5 ? '#ff9d1c' : '#ffd34a', 0, 2);
      }
      if (p >= 1) {
        this.meteors.splice(i, 1);
        const e2 = this.teams[this.teams[m.team].enemy];
        const src = { team: m.team, kind: 'meteor' };
        this.fx.explosion(m.tx, m.ty, '#ff9d1c', 1.3);
        this.sfx.play('boom', 1);
        this.trauma = Math.min(1, this.trauma + 0.12);
        for (const u of e2.units.slice()) if (Math.hypot(u.x - m.tx, u.y - m.ty) < 70) this.damageUnit(u, m.dmg * 0.6, src);
        this.damageCore(e2, m.onCore ? m.dmg : m.dmg * 0.4, src);
      }
    }
  }

  // ---------------------------------------------------------------- render
  drawWorld(ctx, S, time) {
    const th = this.env.theme();
    for (const k of ['A', 'B']) this.drawCore(ctx, this.teams[k], th[k], time);
    this.drawRiftPortal(ctx, th, time);
    if (this.boss) this.drawBoss(ctx, time);
    for (const k of ['A', 'B']) this.drawCommanders(ctx, k, th[k], S, time);
    if (this.w.hyper.orbits && this.asc.shown > 3.2) this.drawOrbits(ctx, th, time);
    for (const k of ['A', 'B']) {
      const t = this.teams[k];
      for (const u of t.units) this.drawUnit(ctx, t, u, th[k], S, time);
    }
    this.drawMeteors(ctx);
    this.rando.drawWorld(ctx, th, time);
    this.proj.draw(ctx);
    this.fx.drawWorld(ctx);
    if (this.cine) this.drawCineWorld(ctx, S, th);
    if (this.beam) this.drawBeam(ctx);
  }

  drawCore(ctx, t, col, time) {
    const c = t.core;
    const ratio = c.hp / c.max;
    const jx = c.flash > 0 ? rand(-3, 3) : 0;
    const x = c.x + jx;
    const y = c.y;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(x, y, 10, x, y, c.r * 2.2);
    glow.addColorStop(0, rgba(col.c1, 0.45));
    glow.addColorStop(1, rgba(col.c1, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - c.r * 2.2, y - c.r * 2.2, c.r * 4.4, c.r * 4.4);
    ctx.restore();

    const hex = (r, a, stroke, width) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = a + (i * TAU) / 6;
        const px = x + Math.cos(ang) * r;
        const py = y + Math.sin(ang) * r;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    ctx.fillStyle = 'rgba(5,4,14,0.85)';
    ctx.beginPath();
    ctx.arc(x, y, c.r * 0.92, 0, TAU);
    ctx.fill();
    hex(c.r, c.ang, col.c1, 4);
    hex(c.r * 0.72, -c.ang * 1.4, col.c2, 3);
    if (this.w.hyper.cubes && this.asc.shown > 2.5) {
      // D3+: each core sits inside its own rotating tesseract cage
      const cage = this.cages[t.key];
      cage.project(time * (1 + t.stacks.haste * 0.01) + (t.key === 'B' ? 7 : 0), x, y, c.r * 0.62, 1);
      cage.draw(ctx, [col.c1, col.c2, '#ffffff', '#d36bff'], Math.min(1, this.asc.shown - 2.5) * 0.7, 1.5);
    }
    // crystal
    const cr = c.r * 0.46;
    const g = ctx.createLinearGradient(x, y - cr, x, y + cr);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, col.c1);
    g.addColorStop(1, col.c2);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y - cr * 1.25);
    ctx.lineTo(x + cr * 0.75, y);
    ctx.lineTo(x, y + cr * 1.25);
    ctx.lineTo(x - cr * 0.75, y);
    ctx.closePath();
    ctx.fill();
    // cracks as HP drops
    const cracks = ratio < 0.25 ? 5 : ratio < 0.5 ? 3 : ratio < 0.75 ? 1 : 0;
    if (cracks) {
      ctx.strokeStyle = 'rgba(10,6,20,0.9)';
      ctx.lineWidth = 2;
      for (let i = 0; i < cracks; i++) {
        const a = i * 2.1 + 0.4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * cr * 0.5, y + Math.sin(a) * cr * 0.6);
        ctx.lineTo(x + Math.cos(a + 0.3) * cr * 0.9, y + Math.sin(a + 0.3) * cr * 1.1);
        ctx.stroke();
      }
    }
    if (t.staggerTime > 0) {
      ctx.setLineDash([8, 8]);
      ctx.lineDashOffset = -time * 40;
      ctx.strokeStyle = '#ffd34a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, c.r + 12, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (t.gate.active) {
      const a = 0.5 + 0.5 * Math.sin(time * 10);
      ctx.strokeStyle = rgba('#ff2a4a', 0.5 + a * 0.5);
      ctx.lineWidth = 5;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(x, y, c.r + 18, i * (TAU / 4) + time, i * (TAU / 4) + time + 0.9);
        ctx.stroke();
      }
    }
    if (c.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${c.flash * 3})`;
      ctx.beginPath();
      ctx.arc(x, y, c.r * 0.9, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawUnit(ctx, t, u, col, S, time) {
    const r = u.elite > 0 ? ELITE_R : UNIT_R;
    const rec = u.rec;
    const img = rec ? avatarImage(rec.avatar) : null;
    const key = S + '|' + r + '|' + (u.elite > 0) + '|' + !!(rec && rec.sub) + '|' + !!(rec && rec.follower) + '|' + (img ? 1 : 0) + '|' + col.c1;
    if (u.spriteKey !== key) {
      u.sprite = unitSprite({ r, S, img, pix: pixelAvatar(u.npc ? u.name : rec.id, col.c1, col.c2, u.npc), ring: col.c1, accent: col.c2, elite: u.elite > 0, npc: u.npc, sub: rec && rec.sub, follower: rec && rec.follower });
      u.spriteKey = key;
    }
    const lunge = u.lunge > 0 ? Math.sin(Math.PI * (1 - u.lunge)) * 26 * t.dir : 0;
    const x = u.x + lunge;
    const y = u.y;
    // ground shadow + team glow on the floor
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + r + 4, r * 0.85, r * 0.22, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = rgba(u.cls ? CLASSES[u.cls].color : col.c1, 0.16);
    ctx.beginPath();
    ctx.ellipse(x, y + r + 4, r * 1.15, r * 0.32, 0, 0, TAU);
    ctx.fill();
    const pop = u.pop > 0 ? easeOutBack(1 - u.pop) : 1;
    const size = (u.sprite.width / S) * pop;
    ctx.drawImage(u.sprite, x - size / 2, y - size / 2, size, size);
    if (u.cls) {
      const chip = classChip(u.cls, S);
      if (chip) ctx.drawImage(chip, x + r * 0.62 - 8, y - r * 0.62 - 8, 16, 16);
    }
    if (u.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${u.flash * 6})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    if (u.elite > 0) {
      ctx.fillStyle = '#ffd34a';
      for (let i = 0; i < 6; i++) {
        const a = u.spin + (i * TAU) / 6;
        ctx.fillRect(x + Math.cos(a) * (r + 9) - 3, y + Math.sin(a) * (r + 9) - 3, 6, 6);
      }
    }
    if (u.shield > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba('#9ff6ff', 0.5 + 0.3 * Math.sin(time * 8));
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6 + time * 0.8;
        const px = x + Math.cos(a) * (r + 7);
        const py = y + Math.sin(a) * (r + 7);
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    if (t.bounty === u) {
      ctx.save();
      ctx.strokeStyle = Math.sin(time * 10) > 0 ? '#ff2a4a' : '#ffd34a';
      ctx.lineWidth = 3;
      const R = r + 12;
      const a0 = time * 2;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(x, y, R, a0 + (i * TAU) / 4, a0 + (i * TAU) / 4 + 0.7);
        ctx.stroke();
      }
      ctx.restore();
    }
    const bw = 40;
    const bx = x - bw / 2;
    const by = y + r + 5;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, 9);
    const hr = clamp(u.hp / u.max, 0, 1);
    ctx.fillStyle = hr > 0.5 ? '#7dff9a' : hr > 0.25 ? '#ffd34a' : '#ff4a5a';
    ctx.fillRect(bx, by, bw * hr, 3);
    ctx.fillStyle = u.atb > 0.9 ? '#ffffff' : col.c1;
    ctx.fillRect(bx, by + 4, bw * clamp(u.atb, 0, 1), 3);
  }

  drawBoss(ctx, time) {
    const b = this.boss;
    const x = b.x;
    const y = b.y;
    const s = b.enter;
    ctx.save();
    ctx.globalAlpha = s;
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(x, y, 10, x, y, b.r * 2);
    glow.addColorStop(0, 'rgba(199,125,255,0.5)');
    glow.addColorStop(1, 'rgba(199,125,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - b.r * 2, y - b.r * 2, b.r * 4, b.r * 4);
    ctx.globalCompositeOperation = 'source-over';
    // pixel eye-beast: 11x9 grid
    const P = 11;
    const rows = ['...XXXXX...', '..XXXXXXX..', '.XXXXXXXXX.', 'XXXWWWWWXXX', 'XXWWWEEWWXX', 'XXXWWWWWXXX', '.XXXXXXXXX.', '.X.X.X.X.X.', 'X.X.X.X.X.X'];
    const ox = x - (rows[0].length * P) / 2;
    const oy = y - (rows.length * P) / 2;
    const look = Math.sin(time * 1.3) * 1.5;
    for (let j = 0; j < rows.length; j++) {
      for (let i = 0; i < rows[j].length; i++) {
        const ch = rows[j][i];
        if (ch === '.') continue;
        ctx.fillStyle = b.flash > 0 ? '#ffffff' : ch === 'X' ? (j > 6 ? '#7a2cff' : '#c77dff') : ch === 'W' ? '#f4e8ff' : '#120018';
        const dx = ch === 'E' ? look : 0;
        ctx.fillRect(ox + i * P + dx, oy + j * P + (j > 6 ? Math.sin(time * 6 + i) * 2 : 0), P - 1, P - 1);
      }
    }
    ctx.restore();
  }

  drawMeteors(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.meteors) {
      if (m.delay > 0 || m.x == null) continue;
      ctx.fillStyle = '#ffd34a';
      ctx.fillRect(m.x - 9, m.y - 9, 18, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(m.x - 4, m.y - 4, 8, 8);
    }
    ctx.restore();
  }

  drawBeam(ctx) {
    const b = this.beam;
    const a = b.t / b.max;
    const wob = Math.sin(this.time * 80) * 3;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const wide = b.wide || 1;
    ctx.strokeStyle = rgba(b.color, 0.6 * a);
    ctx.lineWidth = (70 * a + wob) * wide;
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.lineWidth = 22 * a * wide;
    ctx.stroke();
    ctx.restore();
  }

  drawCineWorld(ctx, S, th) {
    const c = this.cine;
    const fadeIn = clamp(c.t / 0.25, 0, 1);
    const fadeOut = clamp((c.dur - c.t) / 0.4, 0, 1);
    const a = Math.min(fadeIn, fadeOut);
    const col = th[c.team] || th.A;
    ctx.save();
    ctx.fillStyle = `rgba(2,1,8,${(c.type === 'summon' ? 0.72 : 0.6) * a})`;
    ctx.fillRect(-40, -40, W + 80, 1360);
    if (c.type === 'limit') {
      ctx.globalCompositeOperation = 'lighter';
      const cx = W / 2;
      const cy = 600;
      for (let i = 0; i < 48; i++) {
        const ang = (i / 48) * TAU + c.t * 0.4;
        const r0 = 150 + ((i * 37) % 60);
        ctx.strokeStyle = rgba(i % 3 ? col.c1 : '#ffffff', 0.35 * a);
        ctx.lineWidth = 2 + (i % 4);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        ctx.lineTo(cx + Math.cos(ang) * 900, cy + Math.sin(ang) * 900);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      if (!c.sprite || c.spriteS !== S) {
        const rec = c.rec;
        c.sprite = unitSprite({ r: 96, S, img: rec ? avatarImage(rec.avatar) : null, pix: pixelAvatar(rec ? rec.id : 'crowd', col.c1, col.c2, false), ring: col.c1, accent: col.c2, elite: true });
        c.spriteS = S;
      }
      const sc = easeOutBack(clamp(c.t / 0.5, 0, 1)) * (1 + Math.max(0, c.t - 1) * 0.04);
      const size = (c.sprite.width / S) * sc;
      ctx.globalAlpha = a;
      ctx.drawImage(c.sprite, cx - size / 2, cy - size / 2, size, size);
    } else if (c.type === 'summon' && c.variant === 'orbital') {
      this.drawOrbital(ctx, c, col);
    } else if (c.type === 'summon') {
      const wp = this.whalePos(c);
      const P = 13;
      const m = WHALE;
      const wW = m[0].length * P;
      const wH = m.length * P;
      const glowA = 0.5 + 0.5 * clamp((c.t - 3.2) / 0.8, 0, 1);
      ctx.globalAlpha = Math.max(a, c.t < c.dur - 0.4 ? 1 : a);
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(wp.x, wp.y, 20, wp.x, wp.y, wW * 0.8);
      halo.addColorStop(0, rgba(col.c1, 0.35 * glowA));
      halo.addColorStop(1, rgba(col.c1, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(wp.x - wW, wp.y - wW, wW * 2, wW * 2);
      ctx.globalCompositeOperation = 'source-over';
      for (let j = 0; j < m.length; j++) {
        for (let i = 0; i < m[j].length; i++) {
          const v = m[j][i];
          if (!v) continue;
          const ii = wp.dir > 0 ? i : m[j].length - 1 - i;
          const px = wp.x - wW / 2 + ii * P;
          const py = wp.y - wH / 2 + j * P + Math.sin(c.t * 4 + i * 0.35) * 3;
          ctx.fillStyle = v === 3 ? '#ffffff' : v === 2 ? rgba('#ffffff', 0.85) : col.c1;
          ctx.fillRect(px, py, P - 1, P - 1);
        }
      }
      if (c.t > 3.3 && c.t < c.climaxAt) {
        const mx = wp.x + wp.dir * (wW / 2 + 10);
        const k = (c.t - 3.3) / (c.climaxAt - 3.3);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba('#ffffff', 0.9);
        ctx.beginPath();
        ctx.arc(mx, wp.y, 8 + k * 30, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ rivalries
  underdogMul(key) {
    const u = this.w.underdog;
    if (!u || !u.enabled) return 1;
    const t = this.teams[key];
    const e = this.teams[t.enemy];
    const gap = (e.core.hp / e.core.max - t.core.hp / t.core.max) * 100;
    return gap >= u.gapPct ? u.mul : 1;
  }

  // Top 3 session gifters per team become commander turrets. Recomputed once
  // a second; taking the #1 seat from someone triggers a callout.
  updateCommanders(dt) {
    const w = this.w;
    if (!w.commanders.enabled) {
      this.commanders.A.length = this.commanders.B.length = 0;
      return;
    }
    if ((this.cmdT -= dt) <= 0) {
      this.cmdT = 1;
      const ranked = { A: [], B: [] };
      for (const r of this.users.values()) if (r.coins > 0 && (r.team === 'A' || r.team === 'B')) ranked[r.team].push(r);
      for (const k of ['A', 'B']) {
        const top = ranked[k].sort((a, b) => b.coins - a.coins).slice(0, 3);
        const prev = this.commanders[k];
        const prevTop = prev[0] && prev[0].rec;
        this.commanders[k] = top.map((rec, i) => {
          const old = prev.find((c) => c.rec === rec);
          return { rec, i, fireT: old ? old.fireT : 1 + i * 0.4, sprite: old ? old.sprite : null, spriteKey: old ? old.spriteKey : '', pop: old ? old.pop : 1 };
        });
        const nowTop = top[0];
        if (nowTop && prevTop && nowTop !== prevTop) {
          this.banner('COMMANDER', `${cleanName(nowTop.name, 14).toUpperCase()} TAKES #1`, '#ffd34a', { side: k });
          this.voice.say(`${speakable(nowTop.name)} takes command of ${this.col(k).name}!`, 2);
          this.sfx.play('ready');
        }
      }
    }
    if (this.cine) return;
    for (const k of ['A', 'B']) {
      const t = this.teams[k];
      for (const c of this.commanders[k]) {
        c.pop = Math.max(0, c.pop - dt * 3);
        if ((c.fireT -= dt) > 0) continue;
        c.fireT = w.commanders.fireEvery * (1 + c.i * 0.3);
        const p = commanderPos(k, c.i);
        this.volley(t, p.x, p.y, 2, w.seekers.damage * w.commanders.damage * CMD_RANK_MUL[c.i], { team: k, rec: c.rec, kind: 'commander' }, 0.1);
        c.pop = 1;
      }
    }
  }

  // Every so often each team's best damage dealer becomes a bounty target.
  updateBounties(dt) {
    const w = this.w;
    if (!w.bounty.enabled || (this.bountyT -= dt) > 0) return;
    this.bountyT = w.bounty.everySeconds;
    for (const k of ['A', 'B']) {
      const t = this.teams[k];
      if (t.bounty && t.bounty.alive) continue;
      let ace = null;
      for (const u of t.units) if (!u.npc && u.rec && u.rec.rd > 0 && (!ace || u.rec.rd > ace.rec.rd)) ace = u;
      t.bounty = ace;
      if (ace) {
        ace.label = 4;
        this.banner('BOUNTY', `${cleanName(ace.name, 14).toUpperCase()} IS MARKED`, '#ff2a4a', { side: k, small: true });
      }
    }
  }

  claimBounty(t, victim, src) {
    const w = this.w;
    this.addLimit(t, w.bounty.limitReward);
    this.addStack(t, 'bravery', w.bounty.braveryReward);
    this.fx.ring(victim.x, victim.y, '#ffd34a', 10, 120, 0.6, 6);
    this.banner('BOUNTY CLAIMED', src.rec ? cleanName(src.rec.name, 14).toUpperCase() : this.col(t.key).name, '#ffd34a', { side: t.key });
    this.voice.say(`Bounty claimed on ${speakable(victim.name)}!`, 1);
    this.sfx.play('coin');
  }

  drawCommanders(ctx, k, col, S, time) {
    for (const c of this.commanders[k]) {
      const p = commanderPos(k, c.i);
      const r = c.i === 0 ? 20 : 16;
      const img = avatarImage(c.rec.avatar);
      const key = S + '|' + r + '|' + (img ? 1 : 0) + '|' + col.c1;
      if (c.spriteKey !== key) {
        c.sprite = unitSprite({ r, S, img, pix: pixelAvatar(c.rec.id, col.c1, col.c2, false), ring: '#ffd34a', accent: col.c1, elite: true });
        c.spriteKey = key;
      }
      const sc = 1 + c.pop * 0.15;
      const size = (c.sprite.width / S) * sc;
      const bob = Math.sin(time * 2 + c.i) * 3;
      ctx.drawImage(c.sprite, p.x - size / 2, p.y - size / 2 + bob, size, size);
      // pixel crown, bigger for rank 1
      const cw = c.i === 0 ? 4 : 3;
      const cy = p.y - r - 10 + bob;
      ctx.fillStyle = c.i === 0 ? '#ffd34a' : c.i === 1 ? '#e6e6f0' : '#e09a5a';
      ctx.fillRect(p.x - cw * 2.5, cy + cw, cw * 5, cw * 1.5);
      ctx.fillRect(p.x - cw * 2.5, cy, cw, cw);
      ctx.fillRect(p.x - cw / 2, cy - cw / 2, cw, cw);
      ctx.fillRect(p.x + cw * 1.5, cy, cw, cw);
    }
  }

  drawOrbital(ctx, c, col) {
    const def = this.teams[c.def];
    const tx = def.core.x;
    const ty = def.core.y;
    const pin = clamp(c.t / 1.0, 0, 1);
    const sx = tx;
    const sy = -80 + 330 * (1 - Math.pow(1 - pin, 3)) + Math.sin(c.t * 2) * 6; // settles below the HUD bars
    const P = 9;
    const ox = sx - (SATELLITE[0].length * P) / 2;
    const oy = sy - (SATELLITE.length * P) / 2;
    for (let j = 0; j < SATELLITE.length; j++) {
      for (let i = 0; i < SATELLITE[j].length; i++) {
        const ch = SATELLITE[j][i];
        if (ch === '.') continue;
        ctx.fillStyle = ch === 'X' ? col.c2 : ch === 'E' ? '#ffffff' : '#d8d6ff';
        ctx.fillRect(ox + i * P, oy + j * P, P - 1, P - 1);
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (c.t > 0.6 && c.t < c.climaxAt) {
      // targeting reticle closing on the enemy core
      const k = clamp((c.t - 0.6) / (c.climaxAt - 0.6), 0, 1);
      const R = 220 - 160 * k;
      ctx.strokeStyle = rgba(col.c1, 0.5 + 0.5 * k);
      ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        const a = c.t * (1.5 + k * 4) + (i * TAU) / 4;
        ctx.beginPath();
        ctx.arc(tx, ty, R, a, a + 0.9);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(tx - R - 20, ty);
      ctx.lineTo(tx - R * 0.4, ty);
      ctx.moveTo(tx + R * 0.4, ty);
      ctx.lineTo(tx + R + 20, ty);
      ctx.moveTo(tx, ty - R - 20);
      ctx.lineTo(tx, ty - R * 0.4);
      ctx.moveTo(tx, ty + R * 0.4);
      ctx.lineTo(tx, ty + R + 20);
      ctx.stroke();
      // thin guide laser
      ctx.strokeStyle = rgba(col.c1, 0.25 + 0.4 * k);
      ctx.lineWidth = 1 + k * 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy + 30);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      if (c.t > 3.2) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(sx, sy + 34, 6 + (c.t - 3.2) * 30, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ dimensions
  addEnergy(x) {
    if (!this.w.ascension.enabled || !(x > 0)) return;
    this.asc.energy += x;
  }

  levelUp(lvl) {
    this.asc.level = lvl;
    this.asc.shift = 1;
    const d = DIMENSIONS[lvl - 1];
    this.banner(`DIMENSION ${d.roman}`, d.perk ? `${d.name}: ${d.perk}` : d.name, '#d36bff', { prio: 3, dur: 2.6 });
    this.voice.say(`Dimension ${lvl}. ${d.name.toLowerCase()} unlocked!`, 3);
    this.sfx.play('ascend');
    this.flash = Math.max(this.flash, 0.45);
    this.aberr = 1.6;
    this.glitch = 0.8;
  }

  updateAscension(dt) {
    const w = this.w.ascension;
    const a = this.asc;
    a.shift = Math.max(0, a.shift - dt * 0.6);
    a.shown += (a.level - a.shown) * damp(1.2, dt);
    if (!w.enabled) {
      a.level = 1;
      return;
    }
    a.energy = Math.max(0, a.energy - w.decayPerSec * a.level * dt);
    const th = w.thresholds;
    if (a.level < 5 && a.energy >= th[a.level]) this.levelUp(a.level + 1);
    else if (a.level > 1 && a.energy < th[a.level - 1] * 0.85) {
      a.level--;
      this.banner(`DIMENSION ${DIMENSIONS[a.level - 1].roman}`, 'ENERGY FADING: FEED THE RIFT', '#9c98c8', { small: true });
    }
    // smoothed activity rates (for adaptive rift goals)
    if ((this.rateT -= dt) <= 0) {
      this.rateT = 1;
      for (const k in this.act) {
        this.rate[k] += (this.act[k] - this.rate[k]) * 0.08;
        this.act[k] = 0;
      }
    }
  }

  // Progress (0..1) toward the next dimension, for the HUD ring.
  ascProgress() {
    const th = this.w.ascension.thresholds;
    const a = this.asc;
    if (a.level >= 5) return 1;
    return clamp((a.energy - th[a.level - 1]) / (th[a.level] - th[a.level - 1]), 0, 1);
  }

  // ------------------------------------------------------------------ rifts
  riftIncoming() {
    const w = this.w.rifts;
    const r = this.rift;
    const type = RIFTS[r.idx % RIFTS.length];
    r.idx++;
    // goal: what one team would make in the race at the room's recent pace
    const perTeam = (this.rate[type.kind] * w.durationSeconds) / 2;
    r.goal = nice(clamp(perTeam * w.goalScale, type.min, type.max));
    r.type = type;
    r.phase = 'incoming';
    r.t = w.warnSeconds;
    r.prog = { A: 0, B: 0 };
    r.winner = null;
    r.lastSec = 99;
    this.sfx.play('siren');
    this.voice.say(`A rift is opening. ${type.title.toLowerCase()}! First team to ${r.goal} ${type.unit.toLowerCase()} unlocks ${type.rewardName.toLowerCase()}!`, 2);
  }

  riftProgress(team, kind, amount) {
    const r = this.rift;
    if (r.phase !== 'active' || r.type.kind !== kind || !(team === 'A' || team === 'B')) return;
    r.prog[team] += amount;
    if (r.prog[team] >= r.goal) this.riftEnd(team);
  }

  riftEnd(winner) {
    const w = this.w;
    const r = this.rift;
    r.phase = 'result';
    r.t = 4;
    r.winner = winner;
    if (!winner) {
      this.banner('RIFT COLLAPSED', 'NOBODY REACHED THE GOAL', '#9c98c8', { small: true });
      return;
    }
    const t = this.teams[winner];
    const secs = w.rifts.buffSeconds;
    const type = r.type;
    if (type.reward === 'hyper') t.buffs.hyper = secs;
    else if (type.reward === 'prism') {
      t.buffs.prism = secs;
      for (const u of t.units) u.shield = Math.max(u.shield, 15);
    } else if (type.reward === 'phase') t.buffs.phase = secs;
    else if (type.reward === 'swarm') {
      this.addStack(t, 'barrage', 15);
      this.addStack(t, 'haste', 15);
    }
    this.addEnergy(w.ascension.riftReward);
    const color = this.col(winner).c1;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU;
      this.fx.particle(W / 2, 600, Math.cos(a) * 300 + (t.core.x - W / 2) * 1.5, Math.sin(a) * 300, 0.9, 6, i % 2 ? color : '#ffffff', 0, 2.5);
    }
    this.fx.ring(t.core.x, t.core.y, color, 20, 200, 0.8, 8);
    this.banner(`${type.rewardName}`, `${this.col(winner).name}: ${type.rewardText}`, color, { side: winner, prio: 2, dur: 2.4 });
    this.voice.say(`${this.col(winner).name} unlocks ${type.rewardName.toLowerCase()}!`, 2);
    this.sfx.play('limit');
  }

  updateRift(dt) {
    const w = this.w.rifts;
    const r = this.rift;
    if (!w.enabled) {
      r.phase = 'idle';
      r.t = Math.max(r.t, 5);
      return;
    }
    const gate = this.teams.A.gate.active || this.teams.B.gate.active;
    if (r.phase === 'idle' && (gate || this.cine || this.crowd.poll)) return; // never start on top of a finisher or a vote
    r.t -= dt;
    if (r.phase === 'idle' && r.t <= 0) this.riftIncoming();
    else if (r.phase === 'incoming') {
      const sec = Math.ceil(r.t);
      if (sec !== r.lastSec && sec <= 3 && sec > 0) this.sfx.play('ready');
      r.lastSec = sec;
      if (r.t <= 0) {
        r.phase = 'active';
        r.t = w.durationSeconds;
        this.sfx.play('stagger');
      }
    } else if (r.phase === 'active' && r.t <= 0) this.riftEnd(null);
    else if (r.phase === 'result' && r.t <= 0) {
      r.phase = 'idle';
      r.t = w.everySeconds;
    }
  }

  drawRiftPortal(ctx, th, time) {
    const r = this.rift;
    if (r.phase === 'idle') return;
    const grow = r.phase === 'incoming' ? 1 - r.t / this.w.rifts.warnSeconds : r.phase === 'result' ? r.t / 4 : 1;
    const R = 30 + 60 * clamp(grow, 0, 1);
    const cx = W / 2;
    const cy = 600;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const sides = 5 + (i % 3);
      const rr = R * (1 - i * 0.16);
      const rot = time * (i % 2 ? -0.8 : 0.6) * (1 + i * 0.3);
      ctx.strokeStyle = `hsla(${(time * 60 + i * 50) % 360},100%,65%,${0.65 - i * 0.08})`;
      ctx.lineWidth = 3 - i * 0.4;
      ctx.beginPath();
      for (let k = 0; k <= sides; k++) {
        const a = rot + (k * TAU) / sides;
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr * 0.92;
        if (k) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    const core = ctx.createRadialGradient(cx, cy, 2, cx, cy, R);
    core.addColorStop(0, 'rgba(255,255,255,0.55)');
    core.addColorStop(0.4, 'rgba(211,107,255,0.25)');
    core.addColorStop(1, 'rgba(211,107,255,0)');
    ctx.fillStyle = core;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
    // inflowing motes from both armies
    if (r.phase === 'active' && this.fx.p.length < 2400) {
      for (const k of ['A', 'B']) {
        const a = Math.random() * TAU;
        const d = R * 2.2;
        this.fx.particle(cx + Math.cos(a) * d, cy + Math.sin(a) * d, -Math.cos(a) * d * 1.6, -Math.sin(a) * d * 1.6, 0.45, 3, th[k].c1, 0, 0.5);
      }
    }
  }

  // D4+: units get a tilted orbit ring, the "seen from another axis" look.
  drawOrbits(ctx, th, time) {
    const a = clamp(this.asc.shown - 3.2, 0, 1) * 0.55;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.5;
    for (const k of ['A', 'B']) {
      const p = new Path2D();
      for (const u of this.teams[k].units) {
        const r = (u.elite > 0 ? ELITE_R : UNIT_R) + 9;
        p.moveTo(u.x + r, u.y);
        p.ellipse(u.x, u.y, r, r * 0.32, Math.sin(time * 0.7 + u.spin) * 0.6, 0, TAU);
      }
      ctx.strokeStyle = th[k].c1;
      ctx.globalAlpha = a;
      ctx.stroke(p);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------- persistence
  serialize() {
    const team = (t) => ({ hp: t.core.hp, wins: t.wins, stacks: { ...t.stacks }, stagger: t.stagger, mana: t.mana, limit: t.limit, gate: { ...t.gate } });
    const users = [];
    for (const r of this.users.values()) {
      if (!r.team && !r.coins) continue;
      users.push({ id: r.id, uid: r.uid, name: r.name, avatar: r.avatar, team: r.team, damage: r.damage, rd: r.rd, coins: r.coins, sub: r.sub, follower: r.follower, cls: r.cls, alive: !!(r.unit && r.unit.alive), hp: r.unit ? r.unit.hp : 0, elite: r.unit ? r.unit.elite : 0 });
      if (users.length > 400) break;
    }
    return { round: this.round, A: team(this.teams.A), B: team(this.teams.B), users, crowd: this.crowd.serialize() };
  }

  restore(s) {
    if (!s || !s.A) return;
    this.round = s.round || 1;
    this.crowd.restore(s.crowd);
    for (const k of ['A', 'B']) {
      const t = this.teams[k];
      const d = s[k];
      t.core.hp = t.core.ghost = Math.min(t.core.max, d.hp);
      t.wins = d.wins || 0;
      Object.assign(t.stacks, d.stacks || {});
      t.stagger = d.stagger || 0;
      t.mana = d.mana || 0;
      t.limit = Math.min(99, d.limit || 0);
      if (d.gate) Object.assign(t.gate, d.gate);
    }
    for (const u of s.users || []) {
      const rec = this.ensureUser({ id: u.id, uid: u.uid, name: u.name, avatar: u.avatar, isSub: u.sub, isFollower: u.follower });
      Object.assign(rec, { team: u.team, damage: u.damage || 0, rd: u.rd || 0, coins: u.coins || 0 });
      if (u.cls && CLASSES[u.cls]) rec.cls = u.cls;
      if (u.alive && u.team) {
        const unit = this.spawnUnit(u.team, rec, false);
        if (unit) {
          unit.hp = u.hp || unit.max;
          unit.elite = u.elite || 0;
        }
      }
    }
  }

  status() {
    const s = (t) => ({
      name: this.col(t.key).name,
      hp: Math.round(t.core.hp),
      max: t.core.max,
      units: t.units.length,
      reserve: t.reserve.length,
      npc: t.units.filter((u) => u.npc).length,
      stagger: Math.round(t.stagger),
      staggered: t.staggerTime > 0,
      limit: Math.round(t.limit),
      limitReady: t.limitReady > 0,
      mana: Math.round(t.mana),
      gate: t.gate.active ? Math.ceil(t.gate.t) : 0,
      gateTier: t.gate.tier,
      stacks: { ...t.stacks },
      wins: t.wins,
      underdog: this.underdogMul(t.key) > 1,
      commanders: this.commanders[t.key].map((c) => ({ name: c.rec.name, coins: c.rec.coins })),
      bounty: t.bounty ? t.bounty.name : null,
      buffs: { hyper: Math.ceil(t.buffs.hyper), prism: Math.ceil(t.buffs.prism), phase: Math.ceil(t.buffs.phase) },
    });
    return {
      round: this.round,
      phase: this.phase,
      A: s(this.teams.A),
      B: s(this.teams.B),
      proj: this.proj.list.length,
      parts: this.fx.p.length,
      users: this.users.size,
      happyHour: Math.max(0, Math.ceil(this.happyHour)),
      boss: this.boss ? { hp: Math.round(this.boss.hp), t: Math.ceil(this.boss.t) } : null,
      cine: this.cine ? this.cine.type : null,
      crowd: this.crowd.status(),
      classes: this.classCount,
      dimension: this.asc.level,
      randonaut: this.rando.status(),
      energy: Math.round(this.asc.energy),
      rift: this.rift.phase === 'idle' ? { next: Math.ceil(this.rift.t) } : { phase: this.rift.phase, type: this.rift.type && this.rift.type.title, goal: this.rift.goal, A: Math.round(this.rift.prog.A), B: Math.round(this.rift.prog.B), t: Math.ceil(this.rift.t) },
    };
  }
}
