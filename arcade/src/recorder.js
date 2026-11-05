// Record normalized events to JSONL and replay them later (offline testing,
// spotty Wi-Fi, or re-running a great gift war while tuning visuals).
import fs from 'node:fs';
import path from 'node:path';

export class Recorder {
  constructor(dir) {
    this.dir = dir;
    this.stream = null;
    this.file = '';
    this.count = 0;
  }

  get active() {
    return !!this.stream;
  }

  start(label = 'session') {
    this.stop();
    fs.mkdirSync(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safe = String(label).replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'session';
    this.file = path.join(this.dir, `${stamp}_${safe}.jsonl`);
    this.stream = fs.createWriteStream(this.file, { flags: 'a' });
    this.t0 = Date.now();
    this.count = 0;
    console.log('[record] writing', this.file);
  }

  write(evt) {
    if (!this.stream) return;
    this.stream.write(JSON.stringify({ t: Date.now() - this.t0, e: evt }) + '\n');
    this.count++;
  }

  stop() {
    if (this.stream) this.stream.end();
    this.stream = null;
  }
}

export class Replayer {
  constructor(publish) {
    this.publish = publish;
    this.timer = null;
    this.file = '';
    this.active = false;
  }

  play(file, { speed = 1, loop = false } = {}) {
    this.stop();
    const lines = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((x) => x && x.e);
    if (!lines.length) return 0;
    this.file = file;
    this.active = true;
    let i = 0;
    const step = () => {
      if (!this.active) return;
      this.publish(lines[i].e);
      i++;
      if (i >= lines.length) {
        if (!loop) return this.stop();
        i = 0;
        this.timer = setTimeout(step, 1000);
        return;
      }
      const wait = Math.max(0, (lines[i].t - lines[i - 1].t) / Math.max(0.1, speed));
      this.timer = setTimeout(step, wait);
    };
    step();
    return lines.length;
  }

  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

export function listRecordings(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size }))
      .sort((a, b) => (a.name < b.name ? 1 : -1));
  } catch {
    return [];
  }
}
