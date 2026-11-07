// Auto messages for the TikTok chat.
//
// Two layers:
//   1. Suggestions (always on, free): every message the bot would post is
//      shown in the director with a Copy button, so the host can paste it
//      into the LIVE chat by hand.
//   2. Chat bot (opt-in): posts the same messages into the room from a
//      second TikTok account through tiktok-live-connector's sendMessage.
//      Needs, on the server only (never in the repo):
//        SIGN_API_KEY           Euler Stream key on a plan that allows sending
//        CHATBOT_SESSIONID      the bot account's `sessionid` cookie
//        CHATBOT_TT_TARGET_IDC  the bot account's `tt-target-idc` cookie
//      The connector's own source says sending "requires an API key & a paid
//      plan, as it uses cloud managed services" (node_modules/tiktok-live-connector,
//      sendRoomChatFromEulerRoute), and it forwards the session cookie to the
//      sign server to do it. Use a secondary account for this, not your main one.
//
// Messages are spaced at least MIN_GAP_MS apart whatever the weights say, and
// the same text is never repeated within REPEAT_MS.
import { EventEmitter } from 'node:events';
import { TikTokLiveConnection } from 'tiktok-live-connector';

const MIN_GAP_MS = 45000;
const REPEAT_MS = 10 * 60 * 1000;
const MAX_LEN = 150;
const fmt = (n) => (n >= 10000 ? Math.round(n / 1000) + 'K' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(Math.round(n)));

export function buildMessages(status, w) {
  const out = [];
  const add = (text, prio = 1) => out.push({ text: text.slice(0, MAX_LEN), prio });
  const s = status || {};
  const A = s.A || {};
  const B = s.B || {};
  // live moments first
  for (const [t, other] of [[A, B], [B, A]]) {
    if (t.gate) add(`${t.name} is down to the last 5%! A big gift for ${other.name} lands the FINAL BLOW. ${t.name} fans can gift to revive!`, 3);
  }
  const poll = s.crowd && s.crowd.poll;
  if (poll) add(`CROWD VOTE (${poll.t}s): type ${poll.opts.map((o) => o[0]).join(', ')} to choose what happens next!`, 3);
  if (s.boss) add('BOSS INVASION! Both teams: tap like and gift to take it down.', 2);
  if (s.happyHour) add(`HAPPY HOUR for ${s.happyHour}s: every gift hits ${w.gifts.happyHourMul}x harder!`, 2);
  if (A.underdog || B.underdog) {
    const u = A.underdog ? A : B;
    add(`${u.name} is the underdog: gifts for ${u.name} get +${Math.round((w.underdog.mul - 1) * 100)}% power right now.`, 2);
  }
  // room goals
  if (s.crowd && s.crowd.goals && w.goals && w.goals.enabled) {
    for (const [k, have, need] of s.crowd.goals) {
      const left = Math.max(1, need - have);
      if (k === 'like') add(`Room goal: ${fmt(left)} more likes unlocks HYPERDRIVE for both teams. Keep tapping!`);
      if (k === 'follow') add(`Follow goal: ${left} more follows starts HAPPY HOUR (gifts ${w.gifts.happyHourMul}x).`);
      if (k === 'share') add(`Share goal: ${left} more shares gives every unit a shield.`);
    }
  }
  // evergreen rules
  add('Welcome to ARCADE ARENA! Tap LIKE to fire heart missiles. Type A or B to pick a side.');
  if (w.classes && w.classes.enabled && w.classes.byChat) add('Pick a class: type KNIGHT (tank), MAGE (3 shots), RANGER (fast), CLERIC (heals) or ROGUE (crits).');
  add('Any gift powers up your team: small gifts launch seekers, bigger ones call storms and summons.');
  add(`Share the LIVE for a 10s shield. Follow for team haste. Every ${fmt(w.mana.likesPerCast)} likes casts a meteor shower.`);
  if (s.dimension && s.dimension < 5) add(`Dimension ${s.dimension} of 5: likes, gifts and shares charge the next dimension for everyone.`);
  return out;
}

export class ChatBot extends EventEmitter {
  constructor({ env = process.env } = {}) {
    super();
    this.cfg = {
      signApiKey: env.SIGN_API_KEY || '',
      sessionId: env.CHATBOT_SESSIONID || '',
      ttTargetIdc: env.CHATBOT_TT_TARGET_IDC || '',
    };
    this.conn = null;
    this.room = '';
    this.lastSent = 0;
    this.lastSuggest = 0;
    this.sent = new Map(); // text -> time
    this.idx = 0;
    this.blockedUntil = 0;
    this.connecting = false;
    this.state = { configured: this.configured, status: this.configured ? 'idle' : 'not configured', error: '', sent: 0, suggestion: '', lastText: '' };
  }

  get configured() {
    return !!(this.cfg.signApiKey && this.cfg.sessionId && this.cfg.ttTargetIdc);
  }

  setState(p) {
    this.state = { ...this.state, ...p };
    this.emit('status', this.state);
  }

  pick(status, w, any = false) {
    const list = buildMessages(status, w);
    if (any) return list[this.idx++ % list.length];
    const now = Date.now();
    for (const [t, at] of this.sent) if (now - at > REPEAT_MS) this.sent.delete(t);
    const fresh = list.filter((m) => !this.sent.has(m.text));
    const pool = fresh.length ? fresh : list;
    const top = Math.max(...pool.map((m) => m.prio));
    const hot = pool.filter((m) => m.prio === top);
    // rotate inside the top priority so evergreen tips take turns
    return hot[this.idx++ % hot.length];
  }

  nextSuggestion(status, w) {
    const m = this.pick(status, w, true);
    this.lastSuggest = Date.now();
    if (m) this.setState({ suggestion: m.text });
  }

  // Called every few seconds by the server with the stage's latest status.
  async tick(status, w, room) {
    const now = Date.now();
    const bot = (w && w.bot) || {};
    const gap = Math.max(MIN_GAP_MS, (bot.chatEverySeconds || 75) * 1000);
    // suggestion for the director, refreshed every 20 s
    if (now - this.lastSuggest > 20000) {
      this.lastSuggest = now;
      const m = this.pick(status, w);
      if (m) this.setState({ suggestion: m.text });
    }
    const want = !!bot.chat && this.configured && !!room;
    if (!want) {
      if (this.conn) await this.stop();
      if (!this.configured && this.state.status !== 'not configured') this.setState({ status: 'not configured' });
      else if (this.configured && !bot.chat && this.state.status !== 'off') this.setState({ status: 'off' });
      return;
    }
    if (now < this.blockedUntil) return;
    if (!this.conn || this.room !== room) return this.start(room);
    if (this.state.status !== 'connected' || now - this.lastSent < gap) return;
    const m = this.pick(status, w);
    if (m) await this.send(m.text);
  }

  async start(room) {
    if (this.connecting) return;
    this.connecting = true;
    await this.stop();
    this.room = room;
    this.setState({ status: 'connecting', error: '' });
    try {
      const conn = new TikTokLiveConnection(room, {
        signApiKey: this.cfg.signApiKey,
        authenticateWs: true,
        processInitialData: false,
        session: { cookie: { type: 'cookie', value: { sessionId: this.cfg.sessionId, ttTargetIdc: this.cfg.ttTargetIdc } } },
      });
      conn.on('error', () => {});
      this.conn = conn;
      await conn.connect();
      this.setState({ status: 'connected' });
      // first post a little after joining, not instantly
      this.lastSent = Date.now() - MIN_GAP_MS + 15000;
    } catch (e) {
      this.fail(e);
    } finally {
      this.connecting = false;
    }
  }

  async send(text) {
    try {
      await this.conn.sendMessage(text);
      this.lastSent = Date.now();
      this.sent.set(text, this.lastSent);
      this.setState({ sent: this.state.sent + 1, lastText: text, error: '' });
    } catch (e) {
      this.lastSent = Date.now();
      this.fail(e);
    }
  }

  fail(e) {
    const msg = String((e && e.message) || e).slice(0, 200);
    const paid = /paid plan|premium|permission|401|403/i.test(msg);
    // back off: 10 min if the plan does not allow sending, else 2 min
    this.blockedUntil = Date.now() + (paid ? 600000 : 120000);
    this.setState({ status: paid ? 'needs a paid sign plan' : 'error', error: msg });
    this.stop();
  }

  async stop() {
    const c = this.conn;
    this.conn = null;
    if (c) {
      try {
        await c.disconnect();
      } catch {
        /* already closed */
      }
    }
    if (this.state.status === 'connected' || this.state.status === 'connecting') this.setState({ status: 'idle' });
  }
}
