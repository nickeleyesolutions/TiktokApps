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
import { Sfx, Voice, Music } from './audio.js';
import { FX } from './fx.js';
import { Projectiles } from './seekers.js';
import { Backdrop } from './backdrop.js';
import { PostFX } from './post.js';
import { Battle } from './combat.js';
import { HUD } from './hud.js';
import { buildPanel } from './panel.js';
import { setServerMode } from './sprites.js';
import { TEXT } from './textcache.js';
import { HyperField, HyperCube, axisColors } from './hyper.js';

const params = new URLSearchParams(location.search);
const serverMode = typeof window.io === 'function' && !params.has('demo');
const obsMode = params.has('obs');
// ?lite: no WebGL (CPU bloom + scanlines instead). For capture apps with a
// built-in browser (TikTok LIVE Studio Link source) or machines without a GPU.
const liteMode = params.has('lite');
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
const post = liteMode ? { ok: false } : new PostFX(postCanvas);

const sfx = new Sfx();
const voice = new Voice();
const music = new Music(sfx);
const fx = new FX();
const proj = new Projectiles();
const backdrop = new Backdrop();
const field = liteMode ? { ok: false } : new HyperField(270, 480);
const skyCube = new HyperCube(4);
let fieldCanvas = null;
let fieldFrame = 0;
let beat = 0;
const hud = new HUD();
const env = {
  weights: () => weights,
  theme: () => theme,
  fx,
  proj,
  sfx,
  voice,
  onHall: null,
  quality: () => quality.level,
};
const battle = new Battle(env);

// Auto quality. Level 0 = full. 1 = fewer particles, no smoke. 2 = render
// resolution down a step, dimension field off. 3 = 720 render, no post FX
// (matters on GPU-less cloud VMs where WebGL runs in software). Steps down after 3 s under 85% of
// the target frame rate, back up after 12 s above 97%.
const quality = { level: 0, low: 0, high: 0 };
function autoQuality(dt) {
  if (!weights.render.autoQuality || document.hidden) {
    if (quality.level && !weights.render.autoQuality) setQuality(0);
    return;
  }
  const target = weights.render.fps || 60;
  const inst = 1 / Math.max(1e-3, dt);
  if (inst < target * 0.85) {
    quality.low += dt;
    quality.high = 0;
  } else if (inst > target * 0.97) {
    quality.high += dt;
    quality.low = Math.max(0, quality.low - dt);
  }
  if (quality.low > 3 && quality.level < 3) setQuality(quality.level + 1);
  else if (quality.high > 12 && quality.level > 0) setQuality(quality.level - 1);
}
function setQuality(level) {
  quality.level = level;
  quality.low = quality.high = 0;
  fx.max = level >= 1 ? 1800 : 3500;
  layout();
}

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
  if (quality.level >= 2) pxW = Math.min(pxW, quality.level >= 3 ? 720 : Math.max(720, Math.round(pxW * 0.67)));
  const pxH = Math.round((pxW * H) / W);
  if (world.width !== pxW || world.height !== pxH) {
    world.width = hudCanvas.width = pxW;
    world.height = hudCanvas.height = pxH;
  }
  S = pxW / W;
  TEXT.setScale(S);
}
window.addEventListener('resize', layout);

function applyWeights(w) {
  weights = deepMerge(clone(DEFAULT_WEIGHTS), w || {});
  if (urlSafe) weights.hud.safeZones = true;
  theme = buildTheme();
  voice.enabled = !!weights.audio.tts;
  voice.minGap = weights.audio.ttsMinGapSeconds * 1000;
  voice.configure({ style: weights.audio.voice, pitch: weights.audio.voicePitch, rate: weights.audio.voiceRate });
  sfx.setVolume(weights.audio.master);
  setSoundtrack(weights.audio.soundtrack);
  music.on = !!weights.audio.music && (!soundtrack.el || weights.audio.layerChiptune);
  music.vol = weights.audio.musicVolume;
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
  // After a server update, open game screens (LIVE Studio, OBS, the cloud
  // broadcaster) reload themselves with the new code, keeping the match.
  let seenVersion = null;
  socket.on('version', (v) => {
    if (seenVersion && v && v !== seenVersion) hotReload();
    seenVersion = v;
  });
  socket.on('evts', (list) => Array.isArray(list) && list.forEach(onEvent));
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
      else if (m.kind === 'subjoin' && team) mock.join(team, m.n || 1, { sub: true });
      else if (m.kind === 'chat') mock.chat(team, m.text || '');
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
let musicT = 0;

// Soundtrack: a plain looping <audio> element (the browser decodes MP3 with
// next to no CPU). Ducks under cinematics, rests on the victory screen.
const soundtrack = { el: null, name: '' };
function setSoundtrack(name) {
  if (!serverMode) name = '';
  if (name === soundtrack.name) return;
  soundtrack.name = name;
  if (soundtrack.el) {
    soundtrack.el.pause();
    soundtrack.el.removeAttribute('src');
    soundtrack.el.load();
    soundtrack.el = null;
  }
  if (!name) return;
  const a = new Audio('/assets/' + encodeURIComponent(name));
  a.loop = true;
  a.preload = 'auto';
  a.volume = 0;
  soundtrack.el = a;
  a.play().catch(() => {}); // retried below until the capture app allows sound
}
function updateSoundtrack(dt) {
  const a = soundtrack.el;
  if (!a) return;
  if (a.paused && (soundtrackRetry -= dt) <= 0) {
    soundtrackRetry = 2;
    a.play().catch(() => {});
  }
  const target = weights.audio.soundtrackVolume * weights.audio.master * (battle.phase === 'victory' ? 0.6 : battle.cine ? 0.45 : 1);
  a.volume = clamp(a.volume + (target - a.volume) * Math.min(1, dt * 3), 0, 1);
}
let soundtrackRetry = 0;
let audioRetry = 1;

// Dimension layer: shader field + floating hypercube, between backdrop and battle.
function drawHyper() {
  const dim = battle.asc.shown;
  const hw = weights.hyper;
  if (dim > 1.02 && hw.intensity > 0 && field.ok && quality.level < 2) {
    // the field animates slowly, so 30 Hz is plenty (halves its GPU cost)
    if ((fieldFrame++ & 1) === 0 || !fieldCanvas) {
      fieldCanvas = field.render({ time, dim, energy: Math.min(1, battle.asc.energy / 10000), split: battle.territoryX / W, beat, a: theme.A.c1, b: theme.B.c1 });
    }
    if (fieldCanvas) {
      wctx.save();
      wctx.globalCompositeOperation = 'lighter';
      wctx.globalAlpha = Math.min(1, dim - 1) * hw.intensity * (dim > 4 ? 1 - (dim - 4) * 0.25 : 1);
      wctx.drawImage(fieldCanvas, 0, 0, W, H);
      wctx.restore();
    }
  }
  if (hw.cubes && dim > 2.3) {
    skyCube.setDim(dim > 4.5 ? 5 : 4);
    skyCube.project(time, W / 2, 352, 58 + (dim - 3) * 12 + beat * 4, 1 + (dim - 3) * 0.25);
    skyCube.draw(wctx, axisColors(theme.A, theme.B), Math.min(1, dim - 2.3) * 0.75, 2);
  }
}

// CPU fallback for machines without WebGL (GPU-less cloud VMs run Chrome with
// --disable-webgl, because software WebGL stalls on every frame upload). Keeps
// the core look: a quarter-res blurred bloom added back, plus scanlines.
const lite = { a: null, b: null, scan: null, scanKey: '' };
function liteCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}
function litePost() {
  const p = weights.post;
  // glow without filters: shrink to 1/4, then 1/16, and stretch back additively
  // (bilinear upscaling of a tiny image is a cheap, soft blur)
  const w4 = Math.round(world.width / 4);
  if (!lite.a || lite.a.width !== w4) {
    lite.a = liteCanvas(w4, Math.round(world.height / 4));
    lite.b = liteCanvas(Math.round(world.width / 16), Math.round(world.height / 16));
  }
  const ac = lite.a.getContext('2d');
  const bc = lite.b.getContext('2d');
  ac.globalCompositeOperation = 'copy';
  ac.drawImage(world, 0, 0, lite.a.width, lite.a.height);
  bc.globalCompositeOperation = 'copy';
  bc.drawImage(lite.a, 0, 0, lite.b.width, lite.b.height);
  wctx.setTransform(1, 0, 0, 1, 0, 0);
  wctx.globalCompositeOperation = 'lighter';
  wctx.globalAlpha = Math.min(1, p.bloom * 0.35 * (1 + beat * 0.2));
  wctx.drawImage(lite.a, 0, 0, world.width, world.height);
  wctx.globalAlpha = Math.min(1, p.bloom * 0.45);
  wctx.drawImage(lite.b, 0, 0, world.width, world.height);
  wctx.globalAlpha = 1;
  wctx.globalCompositeOperation = 'source-over';
  if (p.scanlines > 0) {
    const pitch = Math.max(2, Math.round(p.scanlinePitch * S));
    const key = pitch + '|' + world.width;
    if (lite.scanKey !== key) {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = pitch;
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(0,0,0,1)';
      g.fillRect(0, 0, 1, Math.max(1, Math.round(pitch / 2)));
      lite.scan = wctx.createPattern(c, 'repeat');
      lite.scanKey = key;
    }
    wctx.globalAlpha = p.scanlines * 0.9;
    wctx.fillStyle = lite.scan;
    wctx.fillRect(0, 0, world.width, world.height);
    wctx.globalAlpha = 1;
  }
  if (battle.flash > 0) {
    wctx.fillStyle = `rgba(255,255,255,${battle.flash * 0.5})`;
    wctx.fillRect(0, 0, world.width, world.height);
  }
}

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
    bloom: p.bloom * (1 + beat * 0.18 * Math.min(1, (battle.asc.shown - 1) / 2) + (battle.asc.shown - 1) * 0.03),
    scanlines: p.scanlines,
    scanlinePitch: p.scanlinePitch * S,
    aberration: p.aberration * (1 + battle.aberr * 2 + (battle.asc.shown - 1) * 0.12),
    warp: battle.asc.shift,
    prism: Math.max(0, battle.asc.shown - 2) / 3 * weights.hyper.prism,
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
  autoQuality(dt);
  // capture apps (LIVE Studio Link source, OBS) may start the page muted;
  // keep asking for sound until the browser allows it
  updateSoundtrack(dt);
  if (!sfx.ready && (audioRetry -= dt) <= 0) {
    audioRetry = 2;
    sfx.ensure();
  }
  if ((musicT -= dt) <= 0) {
    musicT = 0.25;
    const A = battle.teams.A;
    const B = battle.teams.B;
    const level = battle.phase === 'victory' ? -1 : A.gate.active || B.gate.active ? 2 : A.staggerTime > 0 || B.staggerTime > 0 || battle.happyHour > 0 || battle.boss ? 1 : 0;
    music.setLevel(level, battle.cine ? 0.45 : 1, battle.asc.level);
  }
  let t0 = performance.now();
  battle.update(dt);
  let t1 = performance.now();
  mark('update', t1 - t0);

  wctx.setTransform(S, 0, 0, S, 0, 0);
  wctx.globalAlpha = 1;
  wctx.globalCompositeOperation = 'source-over';
  backdrop.draw(wctx, time, dt, battle, weights, theme, S);
  beat = music.pulse();
  drawHyper();
  t0 = performance.now();
  mark('backdrop', t0 - t1);
  wctx.save();
  wctx.translate(battle.shakeX, battle.shakeY);
  battle.drawWorld(wctx, S, time);
  wctx.restore();
  t1 = performance.now();
  mark('world', t1 - t0);

  let postOn = weights.post.enabled && post.ok && quality.level < 3;
  if (postOn) postOn = post.render(world, postParams());
  t0 = performance.now();
  mark('post', t0 - t1);
  if (!postOn && weights.post.enabled) litePost();
  if (postOn !== postWasOn) {
    postWasOn = postOn;
    postCanvas.style.visibility = postOn ? 'visible' : 'hidden';
    world.style.visibility = postOn ? 'hidden' : 'visible';
  }

  hctx.setTransform(1, 0, 0, 1, 0, 0);
  hctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
  hctx.setTransform(S, 0, 0, S, 0, 0);
  hud.draw(hctx, battle, { theme, w: weights, time, dt, hall, demo: !serverMode && !obsMode, S });
  mark('hud', performance.now() - t0);
}

// Per-stage CPU cost (ms, exponential moving average). Shown in the director.
const perf = { update: 0, backdrop: 0, world: 0, post: 0, hud: 0 };
function mark(k, ms) {
  perf[k] += (ms - perf[k]) * 0.05;
}
function perfSummary() {
  const o = {};
  let total = 0;
  for (const k in perf) {
    o[k] = Math.round(perf[k] * 100) / 100;
    total += perf[k];
  }
  o.total = Math.round(total * 100) / 100;
  return o;
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
  music.start();
  if (serverMode) {
    setInterval(() => {
      socket.emit('status', { ...battle.status(), fps: Math.round(fps), res: `${world.width}x${world.height}`, post: !!postWasOn, audio: sfx.ready, perf: perfSummary(), quality: quality.level });
    }, 500);
  } else {
    // Offline demo: start with a small crowd so the arena is alive.
    mock.join('A', 6);
    mock.join('B', 4);
    mock.chaos(params.get('chaos') || 'medium');
  }
  last = performance.now();
  requestAnimationFrame(frame);
  window.__arena = { battle, weights: () => weights, api, fps: () => fps, perf: perfSummary, dbg: { hud, hctx, wctx, backdrop, fx, proj, S: () => S, theme: () => theme, hall: () => hall, soundtrack, music } };
}

boot();
