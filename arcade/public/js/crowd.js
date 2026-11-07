// Audience hooks that belong to the whole room, not one team:
//   - POLLS: the room votes in chat on what happens next (majority wins,
//     ties go to the first option shown). Nothing is drawn at random.
//   - ROOM GOALS: shared like / follow / share ladders. Each step unlocks a
//     reward for both teams, so everyone has a reason to tap, follow, share.
//   - HYPE: a 0..1 meter from recent activity, used for visuals and callouts.
// Numbers live in weights.polls and weights.goals.
import { clamp } from './util.js';

// Vote words are single words that do not collide with join words (a, b, 1, 2),
// class words or randonaut intention words.
export const POLL_OPTIONS = [
  { id: 'boss', word: 'BOSS', title: 'BOSS INVASION', color: '#ff2a4a' },
  { id: 'rain', word: 'RAIN', title: 'METEOR RAIN', color: '#ff9fd0' },
  { id: 'party', word: 'PARTY', title: 'HAPPY HOUR', color: '#ff5fa8' },
  { id: 'rift', word: 'RIFT', title: 'RIFT NOW', color: '#d36bff' },
  { id: 'warp', word: 'WARP', title: 'ANOMALY', color: '#7df9ff' },
  { id: 'rally', word: 'RALLY', title: 'FULL RALLY', color: '#7dff9a' },
];

export class Crowd {
  constructor(b) {
    this.b = b;
    this.poll = null; // { opts, votes:{id:n}, voters:Set, t, dur }
    this.pollT = b.w.polls.firstDelay;
    this.pollIdx = 0;
    this.result = null; // { opt, t } shown briefly after a poll
    this.goals = { like: 0, follow: 0, share: 0 };
    this.step = { like: 0, follow: 0, share: 0 };
    this.flash = { like: 0, follow: 0, share: 0 };
    this.hype = 0;
    this.hypeRaw = 0;
  }

  get w() {
    return this.b.w;
  }

  // ---- goals
  goalTarget(kind) {
    const g = this.w.goals[kind];
    const n = this.step[kind];
    const ladder = g.ladder;
    if (n < ladder.length) return ladder[n];
    return ladder[ladder.length - 1] + (n - ladder.length + 1) * g.after;
  }

  goalBase(kind) {
    return this.step[kind] === 0 ? 0 : this.goalTarget2(kind, this.step[kind] - 1);
  }

  goalTarget2(kind, n) {
    const g = this.w.goals[kind];
    const ladder = g.ladder;
    if (n < ladder.length) return ladder[n];
    return ladder[ladder.length - 1] + (n - ladder.length + 1) * g.after;
  }

  add(kind, n) {
    if (!this.w.goals.enabled) return;
    this.goals[kind] += n;
    this.hypeRaw += kind === 'like' ? n * 0.02 : 1.5;
    let guard = 0;
    while (this.goals[kind] >= this.goalTarget(kind) && guard++ < 5) {
      this.step[kind]++;
      this.reward(kind);
    }
  }

  reward(kind) {
    const b = this.b;
    const w = this.w;
    const g = w.goals[kind];
    this.flash[kind] = 1;
    if (b.phase !== 'battle') return;
    b.addEnergy(g.energy);
    if (kind === 'like') {
      for (const k of ['A', 'B']) b.teams[k].buffs.hyper = Math.max(b.teams[k].buffs.hyper || 0, g.seconds);
      b.banner('ROOM GOAL', `${this.goalTarget2('like', this.step.like - 1).toLocaleString()} LIKES: HYPERDRIVE`, '#ff5fa8', { prio: 2, dur: 2.2 });
      b.voice.say('Room goal reached! Hyperdrive for everyone!', 2);
    } else if (kind === 'follow') {
      b.happyHour = Math.max(b.happyHour, g.seconds);
      b.banner('FOLLOW GOAL', `HAPPY HOUR ${g.seconds}s: ${w.gifts.happyHourMul}X GIFTS`, '#7dff9a', { prio: 3, dur: 2.4 });
      b.voice.say(`Follow goal reached! Happy hour, gifts hit ${w.gifts.happyHourMul} times harder!`, 3);
    } else {
      for (const k of ['A', 'B']) for (const u of b.teams[k].units) u.shield = Math.max(u.shield, g.seconds);
      b.banner('SHARE GOAL', `SHIELDS FOR EVERY UNIT ${g.seconds}s`, '#9ff6ff', { prio: 2, dur: 2.2 });
      b.voice.say('Share goal reached! Shields up!', 2);
    }
    b.sfx.play('ascend');
    b.pushFeed(`ROOM GOAL: ${kind.toUpperCase()} x${this.step[kind]}`, '#ffd34a', 2);
  }

  // ---- polls
  onChat(rec, word) {
    const p = this.poll;
    if (!p || p.phase !== 'open' || !word) return false;
    const opt = p.opts.find((o) => o.word.toLowerCase() === word);
    if (!opt) return false;
    const prev = p.voters.get(rec.id);
    if (prev === opt.id) return true;
    if (prev) p.votes[prev]--;
    p.voters.set(rec.id, opt.id);
    p.votes[opt.id] = (p.votes[opt.id] || 0) + 1;
    p.bump[opt.id] = 1;
    this.b.legendHit.chat = 1;
    return true;
  }

  canPoll() {
    const b = this.b;
    if (b.phase !== 'battle' || b.cine || b.boss) return false;
    if (b.rift.phase !== 'idle') return false;
    if (b.teams.A.gate.active || b.teams.B.gate.active) return false;
    return true;
  }

  openPoll() {
    const w = this.w.polls;
    const pool = POLL_OPTIONS.filter((o) => (w.options || []).includes(o.id));
    if (pool.length < 2) return;
    const n = Math.min(3, pool.length);
    // rotate deterministically through the pool so every option gets airtime
    const opts = [];
    for (let i = 0; i < n; i++) opts.push(pool[(this.pollIdx + i) % pool.length]);
    this.pollIdx += 1;
    this.poll = { phase: 'open', opts, votes: {}, voters: new Map(), bump: {}, t: w.durationSeconds, dur: w.durationSeconds };
    this.b.banner('CROWD VOTE', `TYPE ${opts.map((o) => o.word).join(' / ')}`, '#ffd34a', { prio: 2, dur: 2.4 });
    this.b.voice.say(`Crowd vote! Type ${opts.map((o) => o.word.toLowerCase()).join(', or ')}!`, 2);
    this.b.sfx.play('ready');
  }

  closePoll() {
    const p = this.poll;
    let best = p.opts[0];
    for (const o of p.opts) if ((p.votes[o.id] || 0) > (p.votes[best.id] || 0)) best = o;
    const total = p.voters.size;
    this.poll = null;
    if (total < this.w.polls.minVotes) {
      this.result = { opt: null, t: 3 };
      return;
    }
    this.result = { opt: best, t: 3.5, votes: p.votes[best.id] || 0, total };
    this.apply(best);
  }

  apply(o) {
    const b = this.b;
    const w = this.w;
    b.banner(o.title, 'THE CROWD HAS SPOKEN', o.color, { prio: 3, dur: 2.2 });
    b.voice.say(`The crowd chose ${o.title.toLowerCase()}!`, 3);
    if (b.phase !== 'battle') return;
    switch (o.id) {
      case 'boss':
        b.spawnBoss();
        break;
      case 'rain':
        b.castMeteor(b.teams.A);
        b.castMeteor(b.teams.B);
        break;
      case 'party':
        b.happyHour = Math.max(b.happyHour, w.polls.partySeconds);
        break;
      case 'rift':
        b.command({ type: 'openRift' });
        break;
      case 'warp':
        b.rando.spawn('anomaly');
        break;
      case 'rally':
        for (const k of ['A', 'B']) for (const u of b.teams[k].units) u.atb = 1;
        break;
    }
  }

  update(dt) {
    const w = this.w;
    for (const k in this.flash) this.flash[k] = Math.max(0, this.flash[k] - dt * 0.8);
    this.hypeRaw *= Math.exp(-dt / 6);
    this.hype += (clamp(this.hypeRaw / 40, 0, 1) - this.hype) * Math.min(1, dt * 2);
    if (this.result && (this.result.t -= dt) <= 0) this.result = null;
    const p = this.poll;
    if (p) {
      for (const k in p.bump) p.bump[k] = Math.max(0, p.bump[k] - dt * 3);
      if ((p.t -= dt) <= 0) this.closePoll();
      return;
    }
    if (!w.polls.enabled) return;
    if ((this.pollT -= dt) <= 0) {
      if (this.canPoll()) {
        this.openPoll();
        this.pollT = w.polls.everySeconds;
      } else this.pollT = 5;
    }
  }

  serialize() {
    return { goals: this.goals, step: this.step, pollIdx: this.pollIdx };
  }

  restore(s) {
    if (!s) return;
    Object.assign(this.goals, s.goals || {});
    Object.assign(this.step, s.step || {});
    this.pollIdx = s.pollIdx || 0;
  }

  status() {
    const p = this.poll;
    return {
      poll: p ? { t: Math.ceil(p.t), opts: p.opts.map((o) => [o.word, p.votes[o.id] || 0]) } : null,
      goals: ['like', 'follow', 'share'].map((k) => [k, this.goals[k], this.goalTarget(k)]),
      hype: Math.round(this.hype * 100),
    };
  }
}
