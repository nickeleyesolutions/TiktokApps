// Avatars and unit sprites.
// - Real TikTok avatars load through the server's /avatar proxy (same origin,
//   so the canvas never gets tainted and WebGL post-processing keeps working).
// - Anyone without an avatar (mock viewers, NPC drones, failed loads) gets a
//   procedural 8x8 pixel helmet seeded from their name.
// - Each unit is pre-rendered once into a small canvas at the current render
//   scale, so drawing 24 units per frame is a cheap drawImage each.
import { TAU, hash32, mulberry32, rgba } from './util.js';

const images = new Map();
let serverMode = false;
export function setServerMode(v) {
  serverMode = !!v;
}

export function avatarImage(url, onReady) {
  if (!url || !serverMode) return null;
  let e = images.get(url);
  if (!e) {
    const img = new Image();
    img.decoding = 'async';
    e = { img, ok: false, failed: false, cbs: [] };
    img.onload = () => {
      e.ok = true;
      for (const f of e.cbs) f();
      e.cbs.length = 0;
    };
    img.onerror = () => {
      e.failed = true;
      e.cbs.length = 0;
    };
    img.src = '/avatar?u=' + encodeURIComponent(url);
    images.set(url, e);
    if (images.size > 1500) images.delete(images.keys().next().value);
  }
  if (!e.ok && !e.failed && onReady) e.cbs.push(onReady);
  return e.ok ? e.img : null;
}

const pixCache = new Map();
export function pixelAvatar(seed, c1, c2, npc) {
  const key = seed + '|' + c1 + '|' + c2 + (npc ? '|n' : '');
  let cv = pixCache.get(key);
  if (cv) return cv;
  const N = 8;
  cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const rnd = mulberry32(hash32(seed));
  g.fillStyle = npc ? '#16060c' : '#0a0e22';
  g.fillRect(0, 0, N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N / 2; x++) {
      // denser in the middle rows gives a helmet-like silhouette
      const dens = y === 0 || y === N - 1 ? 0.25 : 0.55;
      if (rnd() < dens) {
        const r = rnd();
        g.fillStyle = r < 0.65 ? c1 : r < 0.9 ? c2 : '#ffffff';
        g.fillRect(x, y, 1, 1);
        g.fillRect(N - 1 - x, y, 1, 1);
      }
    }
  }
  if (npc) {
    g.fillStyle = '#000';
    g.fillRect(1, 3, 6, 2);
    g.fillStyle = '#ff2a4a';
    g.fillRect(2, 3, 1, 1);
    g.fillRect(5, 3, 1, 1);
  } else {
    g.fillStyle = '#05060f';
    g.fillRect(2, 3, 4, 1);
    g.fillStyle = '#ffffff';
    g.fillRect(2, 3, 1, 1);
    g.fillRect(5, 3, 1, 1);
  }
  pixCache.set(key, cv);
  if (pixCache.size > 3000) pixCache.delete(pixCache.keys().next().value);
  return cv;
}

// Renders a circular unit badge. r is in design units, S is the render scale.
export function unitSprite({ r, S, img, pix, ring, accent, elite, npc, sub, follower }) {
  const pad = 12;
  const half = r + pad;
  const size = Math.max(4, Math.ceil(half * 2 * S));
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.scale(S, S);
  const c = half;

  const halo = g.createRadialGradient(c, c, r * 0.5, c, c, half);
  halo.addColorStop(0, rgba(ring, elite ? 0.55 : 0.32));
  halo.addColorStop(1, rgba(ring, 0));
  g.fillStyle = halo;
  g.beginPath();
  g.arc(c, c, half, 0, TAU);
  g.fill();

  g.save();
  g.beginPath();
  g.arc(c, c, r - 1.5, 0, TAU);
  g.clip();
  g.fillStyle = '#05060f';
  g.fill();
  if (img) {
    g.drawImage(img, c - r, c - r, r * 2, r * 2);
  } else if (pix) {
    g.imageSmoothingEnabled = false;
    const s = (r - 1.5) * 1.6;
    g.drawImage(pix, c - s / 2, c - s / 2, s, s);
  }
  // glassy top highlight
  const gl = g.createLinearGradient(0, c - r, 0, c);
  gl.addColorStop(0, 'rgba(255,255,255,0.22)');
  gl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gl;
  g.fillRect(c - r, c - r, r * 2, r);
  g.restore();

  g.lineWidth = elite ? 4 : 3;
  g.strokeStyle = npc ? '#ff2a4a' : ring;
  g.beginPath();
  g.arc(c, c, r - 1, 0, TAU);
  g.stroke();
  if (npc) {
    g.setLineDash([3, 4]);
    g.strokeStyle = rgba('#ff2a4a', 0.6);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(c, c, r + 3, 0, TAU);
    g.stroke();
    g.setLineDash([]);
  }
  if (sub || follower) {
    g.strokeStyle = sub ? '#ffffff' : accent;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(c, c, r - 4.5, 0, TAU);
    g.stroke();
  }
  if (elite) {
    g.strokeStyle = '#ffd34a';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(c, c, r + 4, 0, TAU);
    g.stroke();
  }
  return cv;
}
