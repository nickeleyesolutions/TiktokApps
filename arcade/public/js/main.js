// Stage entry point (the page OBS / TikTok LIVE Studio captures).
//
// Render pipeline per frame:
//   world canvas (2D):  Layer 1 backdrop  ->  Layer 2 battle
//   post canvas (WebGL): world -> bloom / CRT / aberration / grading
//   hud canvas (2D):    Layer 3 HUD, drawn crisp on top
//
// Resolution: all game logic uses 720x1280 design units. The canvases are
// sized to render.resolution ('auto' = whatever size OBS gives the page), so
// switching 720p / 1080p / 1440p / 4K never touches game code.
//
// Modes:
//   server mode  - Socket.IO present: events come from the server (TikTok,
//                  mock crowd, replays); weights are live from the director.
//   demo mode    - no server (or ?demo): a local mock crowd drives the game.
// URL params: ?res=720|1080|1440|2160|auto  ?obs (hide UI chrome)  ?demo  ?safe
import { W, H, clamp } from './util.js';
import { DEFAULT_WEIGHTS, THEMES } from './shared/defaults.js';
import { deepMerge, clone, setPath } from './shared/objpath.js';
import { createNormalizer } from './shared/normalizer.js';
import { MockDriver } from './shared/mock.js';
import { Sfx, Voice } from './audio.js';
import { FX } from './fx.js';
import { Projectiles } from './seekers.js';
import { Backdrop } from './backdrop.js';
import { PostFX } from './post.js';
import { Battle } from './combat.js';
import { HUD } from './hud.js';
import { buildPanel } from './panel.js';
import { setServerMode } from './sprites.js';

const params = new URLSearchParams(location.search);
const serverMode = typeof window.io === 'function' && !params.has('demo');
const obsMode = params.has('obs');
setServerMode(serverMode);

let weights = clone(DEFAULT_WEIGHTS);
const urlRes = params.get('res');
const urlSafe = params.has('safe');
let hall = [];
let theme = buildTheme();

function buildTheme() {
  const base = THEMES[weights.theme] || THEMES['azure-inferno'];
  const A = { ...base.A };
  const B = { ...base.B };
  if (weights.teamNames && weights.teamNames.A) A.name = String(weights.teamNames.A).toUpperCase().slice(0, 14);
  if (weights.teamNames && weights.teamNames.B) B.name = String(weights.teamNames.B).toUpperCase().slice(0, 14);
  return { A, B };
}

const stage = document.getElementById('stage');
const postCanvas = document.getElementById('post');
const hudCanvas = document.getElementById('hud');
const world = document.createElement('canvas');
world.id = 'world';
stage.insertBefore(world, postCanvas);
const wctx = world.getContext('2d', { alpha: false });
const hctx = hudCanvas.getContext('2d');
const post = new PostFX(postCanvas);

const sfx = new Sfx();
const voice = new Voice();
const fx = new FX();
const proj = new Projectiles();
const backdrop = new Backdrop();
const hud = new HUD();
const env = {
  weights: () => weights,
  theme: () => theme,
  fx,
  proj,
  sfx,
  voice,
  onHall: null,
};
const battle = new Battle(env);

let S = 1;
function layout() {
  // Fit inside the body's content box (OBS: the whole source; pages with a
  // side gutter or safe-area padding: the padded area).
  const cs = getComputedStyle(document.body);
  const vw = Math.max(1, document.body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) || window.innerWidth;
  const vh = Math.max(1, document.body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) || window.innerHeight;
  const scale = Math.min(vw / W, vh / H);
  const cssW = Math.max(1, Math.floor(W * scale));
  const cssH = Math.max(1, Math.floor(H * scale));
  stage.style.width = cssW + 'px';
  stage.style.height = cssH + 'px';
  const res = urlRes || weights.render.resolution;
  let pxW = res === 'auto' || !res ? Math.round(cssW * (window.devicePixelRatio || 1)) : Number(res);
  pxW = clamp(pxW || 720, 360, 2160);
  const pxH = Math.round((pxW * H) / W);
  if (world.width !== pxW || world.height !== pxH) {
    world.width = hudCanvas.width = pxW;
    world.height = hudCanvas.height = pxH;
  }
  S = pxW / W;
}
window.addEventListener('resize', layout);

function applyWeights(w) {
  weights = deepMerge(clone(DEFAULT_WEIGHTS), w || {});
  if (urlSafe) weights.hud.safeZones = true;
  theme = buildTheme();
  voice.enabled = !!weights.audio.tts;
  voice.minGap = weights.audio.ttsMinGapSeconds * 1000;
  sfx.setVolume(weights.audio.master);
  backdrop.setAsset(weights.backdrop.asset, serverMode);
  layout();
  if (panel) panel.refresh(weights);
}

// ---------------------------------------------------------------- input
function onEvent(e) {
  if (e) battle.handle(e);
}

const SNAP = 'arena:snapshot';
function hotReload() {
  try {
    localStorage.setItem(SNAP, JSON.stringify({ t: Date.now(), state: battle.serialize() }));
  } catch {
    /* storage blocked: reload anyway */
  }
  location.reload();
}

function onCommand(c) {
  if (!c) return;
  if (c.type === 'hotReload') return hotReload();
  battle.command(c);
}

let api;
let socket = null;
let mock = null;
if (serverMode) {
  socket = window.io({ query: { role: 'stage', key: params.get('key') || '' } });
  socket.on('weights', applyWeights);
  socket.on('evt', onEvent);
  socket.on('cmd', onCommand);
  socket.on('hall', (h) => (hall = Array.isArray(h) ? h : []));
  env.onHall = (entry) => socket.emit('hall:add', entry);
  api = {
    weights: () => weights,
    patch: (path, value) => socket.emit('weights:patch', { path, value }),
    mock: (m) => socket.emit('mock', m),
    cmd: (c) => socket.emit('cmd', c),
    chaos: (lvl) => socket.emit('chaos', lvl),
    assets: () => fetch('/api/assets').then((r) => r.json()).catch(() => []),
    enableAudio: () => sfx.ensure(),
  };
} else {
  const norm = createNormalizer();
  mock = new MockDriver((kind, raw) => onEvent(norm.normalize(kind, raw)));
  env.onHall = (entry) => {
    hall.unshift({ ...entry, ts: Date.now() });
    hall = hall.slice(0, 20);
  };
  api = {
    weights: () => weights,
    patch: (path, value) => {
      const next = clone(weights);
      setPath(next, path, value);
      applyWeights(next);
    },
    mock: (m) => {
      const team = m.team === 'A' || m.team === 'B' ? m.team : null;
      if (m.kind === 'join' && team) mock.join(team, m.n || 1);
      else if (m.kind === 'likes') mock.likes(team, m.n || 100);
      else if (m.kind === 'share') mock.share(team);
      else if (m.kind === 'follow') mock.follow(team);
      else if (m.kind === 'gift') mock.gift(m.gift, team, m.n || 1);
    },
    cmd: onCommand,
    chaos: (lvl) => mock.chaos(lvl),
    assets: null,
    enableAudio: () => sfx.ensure(),
  };
}

// ------------------------------------------------- in-stage director drawer
let panel = null;
const drawer = document.createElement('div');
drawer.id = 'drawer';
drawer.hidden = true;
document.body.appendChild(drawer);
const gear = document.createElement('button');
gear.id = 'gear';
gear.type = 'button';
gear.setAttribute('aria-label', 'Open director panel');
gear.textContent = '⚙';
if (!obsMode) document.body.appendChild(gear);
function toggleDrawer(force) {
  const open = force != null ? force : drawer.hidden;
  drawer.hidden = !open;
  if (open && !panel) {
    panel = buildPanel(drawer, api);
    if (mock) panel.setChaos(mock.level);
  }
  sfx.ensure();
}
gear.addEventListener('click', () => toggleDrawer());
window.addEventListener('keydown', (e) => {
  if (e.key === '`' || e.key === '~') toggleDrawer();
  sfx.ensure();
});
window.addEventListener('pointerdown', () => sfx.ensure(), { passive: true });

// ----------------------------------------------------------------- frame
let last = performance.now();
let time = 0;
let frames = 0;
let fpsT = 0;
let fps = 0;
let postWasOn = null;

function postParams() {
  const p = weights.post;
  const A = battle.teams.A;
  const B = battle.teams.B;
  let tint = [1, 1, 1];
  let tintAmt = 0;
  const staggered = A.staggerTime > 0 || B.staggerTime > 0;
  if (A.gate.active || B.gate.active) {
    tint = [1, 0.25, 0.3];
    tintAmt = 0.1 + 0.06 * Math.sin(time * 9);
  } else if (battle.cine && battle.cine.type === 'summon') {
    tint = [0.55, 0.65, 1];
    tintAmt = 0.12;
  } else if (staggered) {
    tint = [1, 0.85, 0.35];
    tintAmt = 0.08;
  } else if (battle.happyHour > 0) {
    tint = [1, 0.5, 0.8];
    tintAmt = 0.05;
  }
  return {
    time,
    bloom: p.bloom,
    scanlines: p.scanlines,
    scanlinePitch: p.scanlinePitch * S,
    aberration: p.aberration * (1 + battle.aberr * 2),
    vignette: p.vignette,
    curvature: p.curvature,
    pixelate: p.pixelate > 0 ? Math.max(2, p.pixelate * S) : 0,
    glitch: p.hitGlitch * battle.glitch,
    flash: battle.flash * 0.6,
    tint,
    tintAmt,
    saturation: 1.05 + (staggered ? 0.2 : 0),
  };
}

function frame(now) {
  requestAnimationFrame(frame);
  const cap = 1000 / (weights.render.fps || 60) - 2;
  if (now - last < cap) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frames++;
  fpsT += dt;
  if (fpsT >= 1) {
    fps = frames / fpsT;
    frames = 0;
    fpsT = 0;
  }
  time += dt;
  battle.update(dt);

  wctx.setTransform(S, 0, 0, S, 0, 0);
  wctx.globalAlpha = 1;
  wctx.globalCompositeOperation = 'source-over';
  backdrop.draw(wctx, time, dt, battle, weights, theme);
  wctx.save();
  wctx.translate(battle.shakeX, battle.shakeY);
  battle.drawWorld(wctx, S, time);
  wctx.restore();

  let postOn = weights.post.enabled && post.ok;
  if (postOn) postOn = post.render(world, postParams());
  if (postOn !== postWasOn) {
    postWasOn = postOn;
    postCanvas.style.visibility = postOn ? 'visible' : 'hidden';
    world.style.visibility = postOn ? 'hidden' : 'visible';
  }

  hctx.setTransform(1, 0, 0, 1, 0, 0);
  hctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
  hctx.setTransform(S, 0, 0, S, 0, 0);
  hud.draw(hctx, battle, { theme, w: weights, time, dt, hall, demo: !serverMode && !obsMode, S });
}

async function boot() {
  applyWeights(weights);
  try {
    const raw = localStorage.getItem(SNAP);
    if (raw) {
      localStorage.removeItem(SNAP);
      const snap = JSON.parse(raw);
      if (Date.now() - snap.t < 60000) battle.restore(snap.state);
    }
  } catch {
    /* no snapshot */
  }
  if (document.fonts && document.fonts.load) {
    await Promise.race([
      Promise.all([document.fonts.load('16px "Press Start 2P"'), document.fonts.load('900 20px Orbitron'), document.fonts.load('700 20px Orbitron')]).catch(() => {}),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  }
  sfx.ensure();
  if (serverMode) {
    setInterval(() => {
      socket.emit('status', { ...battle.status(), fps: Math.round(fps), res: `${world.width}x${world.height}`, post: !!postWasOn, audio: sfx.ready });
    }, 500);
  } else {
    // Offline demo: start with a small crowd so the arena is alive.
    mock.join('A', 6);
    mock.join('B', 4);
    mock.chaos(params.get('chaos') || 'low');
  }
  last = performance.now();
  requestAnimationFrame(frame);
  window.__arena = { battle, weights: () => weights, api, fps: () => fps };
}

boot();
