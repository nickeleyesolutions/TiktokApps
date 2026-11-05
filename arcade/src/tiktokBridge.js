// Connection manager for tiktok-live-connector (v2.x).
// Emits ('raw', kind, payload) for every event the game cares about and
// ('status', {...}) whenever the connection state changes.
//
// Reconnects with exponential backoff + jitter, so a dropped WebSocket does
// not end the show. The game state lives in the stage page, so a reconnect
// never resets the match.
import { EventEmitter } from 'node:events';
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';

const EVENTS = [
  ['chat', WebcastEvent.CHAT],
  ['gift', WebcastEvent.GIFT],
  ['like', WebcastEvent.LIKE],
  ['share', WebcastEvent.SHARE],
  ['follow', WebcastEvent.FOLLOW],
  ['member', WebcastEvent.MEMBER],
  ['roomUser', WebcastEvent.ROOM_USER],
  ['streamEnd', WebcastEvent.STREAM_END],
];

export class TikTokBridge extends EventEmitter {
  constructor({ signApiKey } = {}) {
    super();
    this.signApiKey = signApiKey || undefined;
    this.conn = null;
    this.username = '';
    this.wanted = false;
    this.attempt = 0;
    this.timer = null;
    this.state = { status: 'idle', username: '', roomId: '', error: '', attempt: 0 };
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('status', this.state);
  }

  async connect(username) {
    await this.disconnect();
    this.username = String(username || '').replace(/^@/, '').trim();
    if (!this.username) return;
    this.wanted = true;
    this.attempt = 0;
    this.open();
  }

  async open() {
    if (!this.wanted) return;
    this.setState({ status: 'connecting', username: this.username, error: '', attempt: this.attempt });
    const conn = new TikTokLiveConnection(this.username, {
      signApiKey: this.signApiKey,
      processInitialData: false, // do not replay old chat as new joins
      enableExtendedGiftInfo: false,
    });
    this.conn = conn;
    for (const [kind, ev] of EVENTS) conn.on(ev, (data) => this.emit('raw', kind, data));
    conn.on(ControlEvent.DISCONNECTED, () => {
      if (this.conn !== conn) return;
      this.setState({ status: 'disconnected' });
      this.scheduleReconnect();
    });
    conn.on(ControlEvent.ERROR, (err) => {
      const msg = (err && (err.info || (err.exception && err.exception.message))) || String(err);
      this.setState({ error: String(msg).slice(0, 200) });
    });
    try {
      const st = await conn.connect();
      if (this.conn !== conn) return;
      this.attempt = 0;
      this.setState({ status: 'connected', roomId: st && st.roomId ? String(st.roomId) : '', error: '' });
      console.log(`[tiktok] connected to @${this.username} room ${this.state.roomId}`);
    } catch (e) {
      if (this.conn !== conn) return;
      const offline = e && /offline|not live|UserOffline/i.test(String(e.name) + String(e.message));
      this.setState({ status: offline ? 'waiting-for-live' : 'error', error: String((e && e.message) || e).slice(0, 200) });
      console.warn(`[tiktok] connect failed (@${this.username}):`, this.state.error);
      this.scheduleReconnect(offline ? 30000 : 0);
    }
  }

  scheduleReconnect(minDelay = 0) {
    if (!this.wanted || this.timer) return;
    this.attempt++;
    const base = Math.min(60000, 2000 * Math.pow(2, this.attempt - 1));
    const delay = Math.max(minDelay, base) * (0.7 + Math.random() * 0.6);
    this.setState({ status: this.state.status === 'waiting-for-live' ? 'waiting-for-live' : 'reconnecting', attempt: this.attempt, retryInMs: Math.round(delay) });
    this.timer = setTimeout(() => {
      this.timer = null;
      this.open();
    }, delay);
  }

  async disconnect() {
    this.wanted = false;
    clearTimeout(this.timer);
    this.timer = null;
    const c = this.conn;
    this.conn = null;
    if (c) {
      try {
        await c.disconnect();
      } catch {
        /* already closed */
      }
    }
    this.setState({ status: 'idle', roomId: '', error: '', attempt: 0 });
  }
}
