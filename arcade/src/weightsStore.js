// Live weights: config/weights.json merged over the shared defaults.
// - patch() comes from the director sliders and chat commands
// - edits to the JSON file on disk (by you or by Claude Code) are picked up
//   automatically and pushed to the stage without a reload
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DEFAULT_WEIGHTS } from '../public/js/shared/defaults.js';
import { deepMerge, setPath, clone } from '../public/js/shared/objpath.js';

export class WeightsStore extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.lastWritten = '';
    this.data = deepMerge(clone(DEFAULT_WEIGHTS), this.read());
    this.save();
    fs.watchFile(this.file, { interval: 500 }, () => this.onDiskChange());
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn('[weights] could not parse', this.file, '-', e.message);
      return {};
    }
  }

  patch(p, value) {
    if (!setPath(this.data, p, value)) return;
    this.scheduleSave();
    this.emit('change', this.data, 'patch');
  }

  reset() {
    this.data = clone(DEFAULT_WEIGHTS);
    this.scheduleSave();
    this.emit('change', this.data, 'reset');
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 300);
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const txt = JSON.stringify(this.data, null, 2) + '\n';
    this.lastWritten = txt;
    fs.writeFileSync(this.file, txt);
  }

  onDiskChange() {
    let txt;
    try {
      txt = fs.readFileSync(this.file, 'utf8');
    } catch {
      return;
    }
    if (txt === this.lastWritten) return;
    try {
      const obj = JSON.parse(txt);
      this.data = deepMerge(clone(DEFAULT_WEIGHTS), obj);
      this.lastWritten = txt;
      console.log('[weights] reloaded from disk');
      this.emit('change', this.data, 'file');
    } catch (e) {
      console.warn('[weights] ignoring invalid JSON edit:', e.message);
    }
  }
}
