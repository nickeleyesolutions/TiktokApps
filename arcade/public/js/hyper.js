// The "fifth dimension" layer that sits between the arcade backdrop and the
// battle. Two parts:
//
// 1. HyperCube: an N-dimensional cube (N = 4 tesseract, N = 5 penteract),
//    rotated in planes that involve the extra axes, then perspective-projected
//    one dimension at a time down to 3D and finally to the screen. Edges are
//    colored by the axis they run along, so the 4th and 5th axes read as
//    their own colors while the shape folds through itself.
//    Math is written from scratch; references for the technique are listed in
//    CLAUDE.md (tsherif/tesseract-explorer, ecuber/tesseract, Tesserxel docs).
//
// 2. HyperField: a small WebGL2 fragment shader rendered at low resolution
//    and drawn additively over the backdrop. Each dimension level fades in
//    one more layer: aurora curtains (D2), hyperspace streaks (D3),
//    kaleidoscope sacred geometry (D4), and a folded fractal lattice with
//    thin-film style iridescence (D5, folding idea from Knighty's
//    kaleidoscopic IFS). Low resolution keeps it soft, cheap, and friendly to
//    the stream encoder.
import { hexToRgb } from './util.js';

export class HyperCube {
  constructor(n = 4) {
    this.setDim(n);
  }

  setDim(n) {
    if (n === this.n) return;
    this.n = n;
    const count = 1 << n;
    this.verts = [];
    for (let i = 0; i < count; i++) {
      const v = new Float64Array(n);
      for (let k = 0; k < n; k++) v[k] = i & (1 << k) ? 1 : -1;
      this.verts.push(v);
    }
    this.edges = [];
    for (let i = 0; i < count; i++) for (let k = 0; k < n; k++) {
      const j = i ^ (1 << k);
      if (j > i) this.edges.push([i, j, k]);
    }
    // rotate in every plane that touches an extra axis, plus one 3D spin
    this.planes = [[0, 2]];
    for (let a = 0; a < n; a++) for (let b = Math.max(a + 1, 3); b < n; b++) this.planes.push([a, b]);
    this.speeds = this.planes.map((_, i) => 0.11 + 0.05 * ((i * 7) % 5));
    this.px = new Float64Array(count);
    this.py = new Float64Array(count);
    this.pw = new Float64Array(count);
    this.tmp = new Float64Array(n);
  }

  project(time, cx, cy, scale, spin = 1) {
    const n = this.n;
    const cs = this.planes.map((_, p) => Math.cos(time * this.speeds[p] * spin));
    const sn = this.planes.map((_, p) => Math.sin(time * this.speeds[p] * spin));
    const v = this.tmp;
    for (let i = 0; i < this.verts.length; i++) {
      v.set(this.verts[i]);
      for (let p = 0; p < this.planes.length; p++) {
        const [a, b] = this.planes[p];
        const xa = v[a];
        const xb = v[b];
        v[a] = xa * cs[p] - xb * sn[p];
        v[b] = xa * sn[p] + xb * cs[p];
      }
      // perspective from N-D down to 3-D, one axis at a time
      let depth = 0;
      for (let k = n - 1; k >= 3; k--) {
        const f = 3.4 / (3.4 - v[k]);
        for (let j = 0; j < k; j++) v[j] *= f;
        depth += v[k];
      }
      const f3 = 4.5 / (4.5 - v[2]);
      this.px[i] = cx + v[0] * f3 * scale;
      this.py[i] = cy + v[1] * f3 * scale;
      this.pw[i] = depth;
    }
  }

  // colors: one per axis. Two passes: wide faint glow, thin bright line.
  draw(ctx, colors, alpha, width = 2) {
    const paths = colors.map(() => new Path2D());
    for (const [i, j, k] of this.edges) {
      const p = paths[k % paths.length];
      p.moveTo(this.px[i], this.py[i]);
      p.lineTo(this.px[j], this.py[j]);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let k = 0; k < paths.length; k++) {
      ctx.strokeStyle = colors[k];
      ctx.globalAlpha = alpha * 0.25;
      ctx.lineWidth = width * 4;
      ctx.stroke(paths[k]);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.stroke(paths[k]);
    }
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = alpha;
    const dots = new Path2D();
    for (let i = 0; i < this.verts.length; i++) {
      const s = 2 + Math.max(0, this.pw[i]) * 1.2;
      dots.rect(this.px[i] - s / 2, this.py[i] - s / 2, s, s);
    }
    ctx.fill(dots);
    ctx.restore();
  }
}

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime, uDim, uEnergy, uSplit, uBeat;
uniform vec3 uA, uB;
in vec2 vUv;
out vec4 o;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
// cosine palette: cheap stand-in for thin-film interference colors
vec3 irid(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
vec3 team(vec2 uv) { return mix(uA, uB, smoothstep(uSplit - 0.03, uSplit + 0.03, uv.x)); }

void main() {
  vec2 uv = vUv;
  vec2 p = (uv - vec2(0.5, 0.66)) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime;
  vec3 col = vec3(0.0);

  float d2 = clamp(uDim - 1.0, 0.0, 1.0);
  if (d2 > 0.0) {
    float wave = fbm(vec2(uv.x * 2.6 + t * 0.04, t * 0.07));
    float y = uv.y - 0.62 - wave * 0.22;
    float band = smoothstep(0.0, 0.12, y) * smoothstep(0.3, 0.05, y);
    float folds = 0.55 + 0.45 * sin(uv.x * 55.0 + fbm(uv * 3.5 + t * 0.08) * 9.0);
    col += team(uv) * band * folds * 0.6 * d2;
  }

  float d3 = clamp(uDim - 2.0, 0.0, 1.0);
  if (d3 > 0.0) {
    float r = length(p);
    float a = atan(p.y, p.x);
    float lane = floor(a * 38.0);
    float z = fract(r * 1.4 - t * (0.35 + uEnergy * 0.9) + hash(vec2(lane, 3.0)));
    float streak = smoothstep(0.86, 1.0, z) * smoothstep(0.06, 0.45, r) * step(0.45, hash(vec2(lane, 7.0)));
    col += mix(team(uv), vec3(1.0), 0.35) * streak * 0.7 * d3;
  }

  float d4 = clamp(uDim - 3.0, 0.0, 1.0);
  if (d4 > 0.0) {
    float r = length(p);
    float a = atan(p.y, p.x) + t * 0.04;
    float seg = 6.28318 / 8.0;
    a = abs(mod(a, seg) - seg * 0.5);
    vec2 q = vec2(cos(a), sin(a)) * r;
    float rings = smoothstep(0.9, 1.0, abs(sin(r * 20.0 - t * 1.1)));
    float spokes = smoothstep(0.012, 0.0, abs(q.y - 0.015)) * 0.8;
    float petals = smoothstep(0.02, 0.0, abs(length(q - vec2(0.22, 0.0)) - 0.12));
    col += irid(r * 1.4 - t * 0.08) * (rings + spokes + petals) * smoothstep(0.8, 0.12, r) * 0.5 * d4 * (0.4 + 0.6 * smoothstep(0.3, 0.6, uv.y));
  }

  // keep the busiest layers in the sky so the battlefield stays readable
  float sky = 0.15 + 0.85 * smoothstep(0.38, 0.72, uv.y);
  float d5 = clamp(uDim - 4.0, 0.0, 1.0);
  if (d5 > 0.0) {
    vec2 q = p * 1.7;
    float s = 1.0, acc = 0.0;
    for (int i = 0; i < 6; i++) {
      q = abs(q) - vec2(0.56, 0.34);
      float c = cos(t * 0.09 + float(i) * 0.7), sn = sin(t * 0.09 + float(i) * 0.7);
      q = mat2(c, -sn, sn, c) * q;
      q *= 1.36;
      s *= 1.36;
      acc += exp(-abs(q.x) * 14.0) / s * 3.0; // thin filaments, not blobs
    }
    col += irid(acc * 0.55 + t * 0.06) * clamp(acc, 0.0, 1.0) * 0.26 * d5 * sky;
  }

  col *= 0.85 + 0.3 * uBeat;
  col = col / (1.0 + col * 0.9); // soft cap: layers can stack without blowing out
  o = vec4(col, 1.0);
}`;

export class HyperField {
  constructor(w = 270, h = 480) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ok = false;
    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) return;
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      this.prog = p;
    } catch (e) {
      console.warn('[hyper] shader failed, dimension field disabled:', e.message);
      return;
    }
    gl.useProgram(this.prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['uRes', 'uTime', 'uDim', 'uEnergy', 'uSplit', 'uBeat', 'uA', 'uB']) this.u[n] = gl.getUniformLocation(this.prog, n);
    this.ok = true;
  }

  render(p) {
    if (!this.ok) return null;
    const gl = this.gl;
    const u = this.u;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uTime, p.time);
    gl.uniform1f(u.uDim, p.dim);
    gl.uniform1f(u.uEnergy, p.energy);
    gl.uniform1f(u.uSplit, p.split);
    gl.uniform1f(u.uBeat, p.beat);
    const a = hexToRgb(p.a);
    const b = hexToRgb(p.b);
    gl.uniform3f(u.uA, a[0] / 255, a[1] / 255, a[2] / 255);
    gl.uniform3f(u.uB, b[0] / 255, b[1] / 255, b[2] / 255);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}

// Axis colors for the hypercubes: team colors for x/y, then the "new"
// dimensions get colors that never appear elsewhere in the game.
export function axisColors(A, B) {
  return [A.c1, B.c1, '#ffffff', '#ffd34a', '#d36bff'];
}

