// Starts / stops deploy/broadcast.sh from the director's "Go live" panel.
// TikTok issues a new stream key every LIVE session, so the key is entered
// per session in the director (over the SSH tunnel) and kept in memory only:
// never written to disk, never logged (ffmpeg output is redacted).
//
// Enabled only when the server runs with BROADCAST=1 (the cloud VM).
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';

const RES = {
  720: { w: 720, h: 1280, bitrate: '3200k' },
  1080: { w: 1080, h: 1920, bitrate: '6000k' },
};

export class Broadcaster extends EventEmitter {
  constructor({ root, port }) {
    super();
    this.script = path.join(root, 'deploy', 'broadcast.sh');
    this.port = port;
    this.proc = null;
    this.wanted = false;
    this.opts = null;
    this.retry = 0;
    this.timer = null;
    this.state = { status: 'off', res: '', fps: 0, bitrate: '', speed: '', error: '', since: 0 };
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('status', this.state);
  }

  start({ url, key, res } = {}) {
    url = String(url || '').trim();
    key = String(key || '').trim();
    const r = RES[Number(res)] || RES[1080];
    if (!/^rtmps?:\/\/[^\s]+$/i.test(url)) return this.set({ status: 'off', error: 'Server URL must start with rtmp:// or rtmps://' });
    if (!key || /\s/.test(key)) return this.set({ status: 'off', error: 'Stream key is empty or has spaces' });
    this.stop(true);
    this.opts = { url, key, r };
    this.wanted = true;
    this.retry = 0;
    this.spawn();
  }

  redact(s) {
    const k = this.opts && this.opts.key;
    return k ? String(s).split(k).join('***') : String(s);
  }

  spawn() {
    const { url, key, r } = this.opts;
    const env = {
      ...process.env,
      RTMP_URL: url,
      STREAM_KEY: key,
      RES_W: String(r.w),
      RES_H: String(r.h),
      FPS: '30',
      VBITRATE: process.env.VBITRATE || r.bitrate,
      STAGE_URL: `http://localhost:${this.port}/?obs`,
    };
    this.set({ status: 'starting', res: `${r.w}x${r.h}`, error: '', fps: 0, since: Date.now() });
    const p = spawn('bash', [this.script], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    this.proc = p;
    let buf = '';
    p.stderr.on('data', (d) => {
      if (this.proc !== p) return; // late output after Stop
      buf = (buf + d.toString()).slice(-4000);
      const lines = buf.split(/[\r\n]/);
      const stat = [...lines].reverse().find((l) => /frame=\s*\d+/.test(l));
      if (stat) {
        const m = /fps=\s*([\d.]+).*bitrate=\s*(\S+).*speed=\s*(\S+)/.exec(stat);
        if (m) this.set({ status: 'live', fps: Number(m[1]), bitrate: m[2], speed: m[3] });
      }
      const err = lines.find((l) => /error|failed|refused|denied|not found/i.test(l) && !/xkbcomp|update header/i.test(l));
      if (err) this.set({ error: this.redact(err).slice(0, 200) });
    });
    p.on('exit', (code) => {
      if (this.proc !== p) return;
      this.proc = null;
      if (!this.wanted) return this.set({ status: 'off', fps: 0 });
      // keep trying: a dropped RTMP connection should not end the show
      this.retry++;
      const wait = Math.min(30000, 3000 * this.retry);
      this.set({ status: 'reconnecting', fps: 0, error: this.state.error || `exited with code ${code}` });
      this.timer = setTimeout(() => this.wanted && this.spawn(), wait);
    });
  }

  stop(quiet = false) {
    this.wanted = false;
    clearTimeout(this.timer);
    const p = this.proc;
    this.proc = null;
    if (p) p.kill('SIGTERM');
    if (!quiet) {
      this.opts = null; // forget the key
      this.set({ status: 'off', fps: 0, bitrate: '', speed: '', error: '', res: '' });
    }
  }
}
