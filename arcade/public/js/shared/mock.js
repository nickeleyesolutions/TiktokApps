// Mock TikTok traffic. Builds payloads in the same shape tiktok-live-connector
// emits (v2.x / proto v3 field names), so they go through the real normalizer.
// Runs on the server (director buttons, chaos crowd) and in the browser
// (offline demo). Uses only setTimeout/setInterval, no Node or DOM APIs.

// Coin values are approximate and only used for simulation. In a real stream
// the game reads each gift's diamondCount from the event itself.
export const MOCK_GIFTS = [
  { key: 'rose', id: 9001, name: 'Rose', coins: 1, streakable: true },
  { key: 'finger', id: 9002, name: 'Finger Heart', coins: 5, streakable: true },
  { key: 'doughnut', id: 9003, name: 'Doughnut', coins: 30, streakable: true },
  { key: 'hearts', id: 9004, name: 'Hand Hearts', coins: 100, streakable: true },
  { key: 'moneygun', id: 9005, name: 'Money Gun', coins: 500, streakable: false },
  { key: 'galaxy', id: 9006, name: 'Galaxy', coins: 1000, streakable: false },
  { key: 'whale', id: 9007, name: 'Whale Diving', coins: 2150, streakable: false },
  { key: 'lion', id: 9008, name: 'Lion', coins: 29999, streakable: false },
];

export const CHAOS = {
  low: { viewers: 10, tick: 500, actions: 1, likeMax: 8, giftRate: 0.05 },
  medium: { viewers: 100, tick: 200, actions: 2, likeMax: 15, giftRate: 0.06 },
  extreme: { viewers: 1000, tick: 100, actions: 4, likeMax: 25, giftRate: 0.08 },
};

const SYL = ['neo', 'kat', 'zen', 'rex', 'luna', 'vox', 'pix', 'byte', 'nova', 'jet', 'kai', 'mo', 'ray', 'ivy', 'ace', 'dex', 'sky', 'ash', 'fox', 'gem', 'zap', 'orb', 'lux', 'echo'];
const CHATTER = ['gg', 'lets gooo', 'lol', 'W', 'lfg', 'nooo', 'clutch', 'insane', 'go go go', 'who wins'];
// Weighted gift picker for the crowd simulator (most gifts are small).
const GIFT_WEIGHTS = [['rose', 60], ['finger', 15], ['doughnut', 12], ['hearts', 7], ['moneygun', 3], ['galaxy', 2], ['whale', 0.8], ['lion', 0.2]];

const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class MockDriver {
  constructor(emitRaw) {
    this.emitRaw = emitRaw; // (kind, rawPayload) => void
    this.viewers = [];
    this.seq = 0;
    this.group = 1;
    this.timers = new Set();
    this.level = 'off';
    this.interval = null;
  }

  mkViewer(team = null) {
    const name = pick(SYL) + pick(SYL) + (Math.random() < 0.6 ? Math.floor(Math.random() * 99) : '');
    const v = { id: String(7000000000000000 + ++this.seq), displayId: name + '_' + this.seq, nickname: name, team };
    this.viewers.push(v);
    if (this.viewers.length > 3000) this.viewers.splice(0, 500);
    return v;
  }

  rawUser(v) {
    return { userId: v.id, id: v.id, displayId: v.displayId, nickname: v.nickname, avatarThumb: { urlList: [] } };
  }

  later(ms, fn) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  // A viewer on `team` ('A' | 'B'), creating and joining one if needed. team null = anyone.
  viewerFor(team) {
    const pool = this.viewers.filter((v) => (team ? v.team === team : true));
    if (pool.length && Math.random() < 0.8) return pool[Math.floor(Math.random() * pool.length)];
    const v = this.mkViewer(team);
    if (team) this.emitRaw('chat', { user: this.rawUser(v), content: team === 'A' ? 'a' : 'b', userIdentity: {} });
    return v;
  }

  join(team, n = 1) {
    for (let i = 0; i < n; i++) {
      const v = this.mkViewer(team);
      this.later(i * 70, () => this.emitRaw('chat', { user: this.rawUser(v), content: team === 'A' ? 'a' : 'b', userIdentity: {} }));
    }
  }

  chat(team, text) {
    const v = this.viewerFor(team);
    this.emitRaw('chat', { user: this.rawUser(v), content: text, userIdentity: {} });
  }

  likes(team, count) {
    // TikTok batches likes per user; spread a big number over several viewers.
    let left = count;
    let i = 0;
    while (left > 0) {
      const n = Math.min(left, 15 + Math.floor(Math.random() * 35));
      left -= n;
      const v = this.viewerFor(team);
      this.later(i++ * 40, () => this.emitRaw('like', { user: this.rawUser(v), count: n, total: String(n) }));
    }
  }

  share(team) {
    const v = this.viewerFor(team);
    this.emitRaw('share', { user: this.rawUser(v), common: { displayText: { key: 'pm_mt_guidance_share' } } });
  }

  follow(team) {
    const v = this.viewerFor(team);
    this.emitRaw('follow', { user: this.rawUser(v), common: { displayText: { key: 'pm_main_follow_message' } } });
  }

  giftRaw(v, g, repeat, end, groupId) {
    return {
      user: this.rawUser(v),
      giftId: String(g.id),
      repeatCount: repeat,
      repeatEnd: end ? 1 : 0,
      groupId: String(groupId),
      gift: { id: String(g.id), name: g.name, diamondCount: g.coins, type: g.streakable ? 1 : 2 },
    };
  }

  // Send `count` of a gift. Streakable gifts arrive as a real-looking streak.
  gift(key, team = null, count = 1) {
    const g = MOCK_GIFTS.find((x) => x.key === key);
    if (!g) return;
    const v = this.viewerFor(team);
    const gid = ++this.group;
    if (g.streakable) {
      for (let i = 1; i <= count; i++) this.later((i - 1) * 110, () => this.emitRaw('gift', this.giftRaw(v, g, i, false, gid)));
      this.later(count * 110 + 300, () => this.emitRaw('gift', this.giftRaw(v, g, count, true, gid)));
    } else {
      for (let i = 0; i < count; i++) this.later(i * 450, () => this.emitRaw('gift', this.giftRaw(v, g, 1, true, gid * 100 + i)));
    }
  }

  chaos(level) {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.level = CHAOS[level] ? level : 'off';
    if (this.level === 'off') return;
    const cfg = CHAOS[this.level];
    this.interval = setInterval(() => this.chaosTick(cfg), cfg.tick);
  }

  chaosTick(cfg) {
    for (let k = 0; k < cfg.actions; k++) {
      const v = this.viewers.length < cfg.viewers && Math.random() < 0.5 ? this.mkViewer(null) : pick(this.viewers.length ? this.viewers : [this.mkViewer(null)]);
      const r = Math.random();
      if (!v.team && r < 0.55) {
        v.team = Math.random() < 0.55 ? 'A' : 'B';
        this.emitRaw('chat', { user: this.rawUser(v), content: v.team === 'A' ? 'a' : 'b', userIdentity: {} });
      } else if (r < 0.8) {
        const n = 1 + Math.floor(Math.random() * cfg.likeMax);
        this.emitRaw('like', { user: this.rawUser(v), count: n, total: String(n) });
      } else if (r < 0.8 + cfg.giftRate) {
        let roll = Math.random() * 100;
        let key = 'rose';
        for (const [gk, wgt] of GIFT_WEIGHTS) {
          if ((roll -= wgt) <= 0) {
            key = gk;
            break;
          }
        }
        const g = MOCK_GIFTS.find((x) => x.key === key);
        const count = g.streakable ? 1 + Math.floor(Math.pow(Math.random(), 3) * 30) : 1;
        this.gift(key, v.team, count);
      } else if (r < 0.9) {
        this.emitRaw('chat', { user: this.rawUser(v), content: pick(CHATTER), userIdentity: {} });
      } else if (r < 0.905) {
        this.emitRaw('share', { user: this.rawUser(v), common: { displayText: { key: 'share' } } });
      } else if (r < 0.91) {
        this.emitRaw('follow', { user: this.rawUser(v), common: { displayText: { key: 'follow' } } });
      }
    }
  }

  stop() {
    this.chaos('off');
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}
