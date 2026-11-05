// Cached text sprites. Outlined canvas text (strokeText + fillText) is one of
// the most expensive things the HUD does; names, labels and damage numbers
// repeat constantly, so each unique string is rasterized once at the current
// render scale and then drawn with a single drawImage.
export class TextCache {
  constructor(max = 600) {
    this.max = max;
    this.map = new Map();
    this.S = 1;
    this.scratch = null; // created on first use (keeps the module importable in Node)
  }

  setScale(S) {
    if (S !== this.S) {
      this.S = S;
      this.map.clear();
    }
  }

  // font: full CSS font string at design size. outline in design px.
  get(str, font, size, color, outline, outlineColor) {
    const key = str + '\u0001' + font + '\u0001' + color + '\u0001' + outline + '\u0001' + outlineColor;
    let e = this.map.get(key);
    if (e) {
      // refresh LRU position
      this.map.delete(key);
      this.map.set(key, e);
      return e;
    }
    const S = this.S;
    const m = this.scratch || (this.scratch = document.createElement('canvas').getContext('2d'));
    m.font = font;
    const w = Math.ceil(m.measureText(str).width + outline * 2 + 4);
    const h = Math.ceil(size * 1.35 + outline * 2 + 2);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w * S));
    cv.height = Math.max(1, Math.ceil(h * S));
    const g = cv.getContext('2d');
    g.scale(S, S);
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (outline > 0) {
      g.lineJoin = 'round';
      g.lineWidth = outline;
      g.strokeStyle = outlineColor;
      g.strokeText(str, w / 2, h / 2);
    }
    g.fillStyle = color;
    g.fillText(str, w / 2, h / 2);
    e = { cv, w, h };
    this.map.set(key, e);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return e;
  }

  // Draw centered at (x, y), optionally scaled; align 'left'|'right' shifts the anchor.
  draw(ctx, str, x, y, font, size, color, outline = 0, outlineColor = '#05030c', align = 'center', scale = 1) {
    const e = this.get(str, font, size, color, outline, outlineColor);
    const w = e.w * scale;
    const h = e.h * scale;
    const pad = (outline + 2) * scale;
    const dx = align === 'left' ? x - pad : align === 'right' ? x - w + pad : x - w / 2;
    ctx.drawImage(e.cv, dx, y - h / 2, w, h);
    return e.w - (outline + 2) * 2;
  }
}

export const TEXT = new TextCache();
