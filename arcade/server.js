// Arcade Arena server: Express + Socket.IO hub between
//   TikTok (or the mock crowd / a replay)  ->  the stage page (OBS browser source)
//   the director page (phone/laptop)       ->  the stage page
//
// Usage:
//   node server.js                         # offline: use the director's test bench / chaos crowd
//   node server.js --user someone_live     # piggyback a live room (or your own)
//   node server.js --record                # record every event to recordings/*.jsonl
//   node server.js --replay recordings/x.jsonl [--speed 2] [--loop]
//
// Env: PORT, TIKTOK_USERNAME, SIGN_API_KEY (Euler Stream key, optional),
//      DIRECTOR_KEY (if set, /director must be opened with ?key=...), AVATAR_HOSTS
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { WeightsStore } from './src/weightsStore.js';
import { TikTokBridge } from './src/tiktokBridge.js';
import { Recorder, Replayer, listRecordings } from './src/recorder.js';
import { createAvatarHandler } from './src/avatarProxy.js';
import { Broadcaster } from './src/broadcaster.js';
import { createNormalizer } from './public/js/shared/normalizer.js';
import { MockDriver } from './public/js/shared/mock.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const PORT = Number(process.env.PORT || arg('--port') || 3000);
const DIRECTOR_KEY = process.env.DIRECTOR_KEY || '';
const REC_DIR = path.join(ROOT, 'recordings');
const ASSET_DIR = path.join(ROOT, 'public', 'assets');
const HALL_FILE = path.join(ROOT, 'data', 'hall.json');

const weights = new WeightsStore(path.join(ROOT, 'config', 'weights.json'));
let VERSION = 'dev';
try {
  VERSION = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
} catch {
  /* written by deploy/update.sh */
}
// BROADCAST=1 (cloud VM): the director's Go live panel can start the stream.
const broadcaster = process.env.BROADCAST === '1' ? new Broadcaster({ root: ROOT, port: PORT }) : null;
const bridge = new TikTokBridge({ signApiKey: process.env.SIGN_API_KEY });
const recorder = new Recorder(REC_DIR);
const normLive = createNormalizer();
const normMock = createNormalizer();

let hall = [];
try {
  hall = JSON.parse(fs.readFileSync(HALL_FILE, 'utf8'));
} catch {
  hall = [];
}

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
app.use('/fonts', express.static(path.join(ROOT, 'node_modules', '@fontsource')));
app.get('/avatar', createAvatarHandler(path.join(ROOT, 'data', 'avatar-cache')));
app.get('/api/assets', (_req, res) => {
  let files = [];
  try {
    files = fs.readdirSync(ASSET_DIR).filter((f) => /\.(png|jpe?g|webp|gif|mp4|webm)$/i.test(f));
  } catch {
    /* no assets yet */
  }
  res.json(files);
});
app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    version: VERSION,
    bridge: bridge.state,
    recording: recorder.active,
    broadcast: broadcaster ? { status: broadcaster.state.status, fps: broadcaster.state.fps, bitrate: broadcaster.state.bitrate, speed: broadcaster.state.speed, res: broadcaster.state.res } : 'disabled',
    stage: lastStatus ? { fps: lastStatus.fps, res: lastStatus.res, cpuMs: lastStatus.perf && lastStatus.perf.total, quality: lastStatus.quality, round: lastStatus.round, dimension: lastStatus.dimension } : null,
  })
);

const server = http.createServer(app);
const io = new Server(server, { serveClient: true });

// ---------------------------------------------------------------- event bus
let lastStatus = null;
const replayer = new Replayer((evt) => publish(evt, 'replay'));

function publish(evt, source) {
  if (!evt) return;
  if (evt.type === 'chat' && handleOwnerCommand(evt)) return;
  if (source !== 'replay') recorder.write(evt);
  queueStage(evt);
  io.to('director').emit('feed', summarize(evt, source));
}

// Batch events to the stage at ~30 Hz. Busy rooms can send hundreds of
// events a second; one packet per tick is far cheaper than one per event.
// Likes from the same viewer inside one packet are merged.
let stageQueue = [];
let flushTimer = null;
function queueStage(evt) {
  if (evt.type === 'like') {
    const prev = stageQueue.find((e) => e.type === 'like' && e.user.id === evt.user.id);
    if (prev) {
      prev.count += evt.count;
      return;
    }
    evt = { ...evt };
  }
  stageQueue.push(evt);
  if (!flushTimer) flushTimer = setTimeout(flushStage, 33);
}
function flushStage() {
  flushTimer = null;
  if (!stageQueue.length) return;
  io.to('stage').emit('evts', stageQueue);
  stageQueue = [];
}

function summarize(e, source) {
  const who = e.user ? e.user.uid || e.user.name : '';
  switch (e.type) {
    case 'chat':
      return { source, text: `${who}: ${e.text}` };
    case 'gift':
      if (!e.delta) return { source, text: `${who} ended a ${e.gift.name} streak at x${e.total}`, quiet: e.total < 10 };
      return { source, text: `${who} sent ${e.gift.name} x${e.delta}${e.end ? '' : ' (streak ' + e.total + ')'} [${e.gift.coins} coins]`, big: e.gift.coins >= 100 };
    case 'like':
      return { source, text: `${who} +${e.count} likes` };
    case 'viewers':
      return { source, text: `viewers: ${e.count}`, quiet: true };
    default:
      return { source, text: `${e.type} ${who}` };
  }
}

bridge.on('raw', (kind, raw) => {
  try {
    publish(normLive.normalize(kind, raw), 'live');
  } catch (e) {
    console.warn('[tiktok] could not normalize', kind, e.message);
  }
});
bridge.on('status', (st) => io.to('director').emit('bridge', st));
if (broadcaster) broadcaster.on('status', (st) => io.to('director').emit('broadcast', { available: true, ...st }));

const mock = new MockDriver((kind, raw) => publish(normMock.normalize(kind, raw), 'mock'));

// ------------------------------------------------------ owner chat commands
// Type these in your own TikTok chat (or as a moderator): !hh, !boss, !stagger b,
// !limit a, !gate b, !reset, !heal a, !meteor a, !theme heaven-hell, !set atb.baseSeconds 3, !say text
function teamArg(a) {
  const s = String(a || '').toLowerCase();
  return s === 'a' || s === 'left' || s === '1' ? 'A' : s === 'b' || s === 'right' || s === '2' ? 'B' : null;
}

function isOwner(user) {
  const o = weights.data.owners || {};
  const list = (o.usernames || []).map((u) => String(u).toLowerCase().replace(/^@/, ''));
  if (user.uid && list.includes(String(user.uid).toLowerCase())) return true;
  if (o.allowModerators && user.isMod) return true;
  if (o.trustAnchor && user.isAnchor) return true;
  return false;
}

function handleOwnerCommand(evt) {
  const prefix = (weights.data.owners && weights.data.owners.prefix) || '!';
  if (!evt.text.startsWith(prefix) || !isOwner(evt.user)) return false;
  const [cmdRaw, ...rest] = evt.text.slice(prefix.length).trim().split(/\s+/);
  const cmd = String(cmdRaw || '').toLowerCase();
  const team = teamArg(rest[0]);
  const stage = (c) => io.to('stage').emit('cmd', c);
  switch (cmd) {
    case 'hh':
    case 'happyhour':
      stage({ type: 'happyHour' });
      break;
    case 'boss':
      stage({ type: 'boss' });
      break;
    case 'stagger':
      if (team) stage({ type: 'forceStagger', team });
      break;
    case 'limit':
      if (team) stage({ type: 'fillLimit', team });
      break;
    case 'gate':
      if (team) stage({ type: 'forceGate', team });
      break;
    case 'meteor':
      if (team) stage({ type: 'meteor', team });
      break;
    case 'heal':
      if (team) stage({ type: 'heal', team });
      break;
    case 'reset':
      stage({ type: 'resetRound' });
      break;
    case 'rift':
      stage({ type: 'openRift', kind: ['like', 'gift', 'chat', 'coin'].includes(rest[0]) ? rest[0] : 'like' });
      break;
    case 'anomaly':
      stage({ type: 'randonaut', kind: ['attractor', 'void', 'anomaly'].includes(rest[0]) ? rest[0] : null });
      break;
    case 'ascend':
      stage({ type: 'ascend', delta: Number(rest[0]) || 1 });
      break;
    case 'theme':
      if (rest[0]) weights.patch('theme', rest[0]);
      break;
    case 'set': {
      const [p, v] = rest;
      if (!p || v === undefined) break;
      const num = Number(v);
      weights.patch(p, v === 'true' ? true : v === 'false' ? false : Number.isFinite(num) ? num : v);
      break;
    }
    case 'say':
      stage({ type: 'announce', text: rest.join(' ').slice(0, 120) });
      break;
    default:
      return false;
  }
  console.log(`[owner] ${evt.user.uid}: ${evt.text}`);
  return true;
}

// ------------------------------------------------------------ socket roles
weights.on('change', (data) => io.emit('weights', data));

// Control messages (test bench, director buttons, live connect, record/replay).
// Directors always get them; the stage's own drawer gets them too unless a
// DIRECTOR_KEY is set and the stage URL lacks ?key=...
function attachControls(socket) {
  socket.on('weights:patch', ({ path: p, value } = {}) => typeof p === 'string' && weights.patch(p, value));
  socket.on('weights:reset', () => weights.reset());
  socket.on('cmd', (c) => c && typeof c.type === 'string' && io.to('stage').emit('cmd', c));
  socket.on('mock', (m = {}) => {
    const team = m.team === 'A' || m.team === 'B' ? m.team : null;
    const n = Math.max(1, Math.min(200, Number(m.n) || 1));
    if (m.kind === 'join' && team) mock.join(team, n);
    else if (m.kind === 'subjoin' && team) mock.join(team, n, { sub: true });
    else if (m.kind === 'likes') mock.likes(team, Math.min(20000, Number(m.n) || 100));
    else if (m.kind === 'share') mock.share(team);
    else if (m.kind === 'follow') mock.follow(team);
    else if (m.kind === 'gift') mock.gift(String(m.gift), team, n);
    else if (m.kind === 'chat') mock.chat(team, String(m.text || '').slice(0, 120));
  });
  socket.on('chaos', (level) => mock.chaos(String(level)));
  socket.on('broadcast:start', (o = {}) => broadcaster && broadcaster.start(o));
  socket.on('broadcast:stop', () => broadcaster && broadcaster.stop());
  socket.on('bridge:connect', (u) => bridge.connect(String(u || '')));
  socket.on('bridge:disconnect', () => bridge.disconnect());
  const sendRec = () => io.to('director').emit('recordings', { list: listRecordings(REC_DIR), recording: recorder.active, file: path.basename(recorder.file || ''), replaying: replayer.active });
  socket.on('record:start', () => {
    recorder.start(bridge.username || 'mock');
    sendRec();
  });
  socket.on('record:stop', () => {
    recorder.stop();
    sendRec();
  });
  socket.on('replay:play', ({ name, speed, loop } = {}) => {
    const file = path.join(REC_DIR, path.basename(String(name || '')));
    if (fs.existsSync(file)) replayer.play(file, { speed: Number(speed) || 1, loop: !!loop });
    sendRec();
  });
  socket.on('replay:stop', () => {
    replayer.stop();
    sendRec();
  });
}

io.on('connection', (socket) => {
  const role = String(socket.handshake.query.role || 'stage');
  if (role === 'director') {
    if (DIRECTOR_KEY && socket.handshake.query.key !== DIRECTOR_KEY) {
      socket.emit('denied', 'Wrong or missing director key');
      return socket.disconnect(true);
    }
    socket.join('director');
    socket.emit('weights', weights.data);
    socket.emit('bridge', bridge.state);
    socket.emit('broadcast', broadcaster ? { available: true, ...broadcaster.state } : { available: false });
    socket.emit('recordings', { list: listRecordings(REC_DIR), recording: recorder.active, file: path.basename(recorder.file || ''), replaying: replayer.active });
    if (lastStatus) socket.emit('status', lastStatus);

    attachControls(socket);
  } else {
    socket.join('stage');
    if (!DIRECTOR_KEY || socket.handshake.query.key === DIRECTOR_KEY) attachControls(socket);
    socket.emit('weights', weights.data);
    socket.emit('hall', hall);
    socket.on('status', (s) => {
      lastStatus = s;
      io.to('director').emit('status', s);
    });
    socket.on('hall:add', (entry) => {
      if (!entry || typeof entry !== 'object') return;
      hall.unshift({ name: String(entry.name || '').slice(0, 24), team: entry.team === 'B' ? 'B' : 'A', round: Number(entry.round) || 0, gift: String(entry.gift || '').slice(0, 30), ts: Date.now() });
      hall = hall.slice(0, 20);
      fs.mkdirSync(path.dirname(HALL_FILE), { recursive: true });
      fs.writeFile(HALL_FILE, JSON.stringify(hall, null, 2), () => {});
      io.to('stage').emit('hall', hall);
    });
  }
});

// Tell directors (and optionally the stage) when front-end code changes, so
// Claude Code edits can go live with a state-preserving hot reload.
let codeTimer = null;
try {
  fs.watch(path.join(ROOT, 'public', 'js'), { recursive: true }, (_ev, file) => {
    clearTimeout(codeTimer);
    codeTimer = setTimeout(() => {
      io.to('director').emit('code:changed', String(file || ''));
      if (weights.data.dev && weights.data.dev.autoHotReload) io.to('stage').emit('cmd', { type: 'hotReload' });
    }, 400);
  });
} catch (e) {
  console.warn('[watch] code watcher unavailable:', e.message);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Arcade Arena running`);
  console.log(`  Stage (OBS browser source): http://localhost:${PORT}/`);
  console.log(`  Director (phone/laptop):    http://localhost:${PORT}/director${DIRECTOR_KEY ? '?key=YOUR_KEY' : ''}\n`);
  if (args.includes('--record')) recorder.start(arg('--user') || 'session');
  const replay = arg('--replay');
  if (replay) {
    const n = replayer.play(path.resolve(replay), { speed: Number(arg('--speed')) || 1, loop: args.includes('--loop') });
    console.log(`[replay] ${n} events from ${replay}`);
  }
  const user = arg('--user') || process.env.TIKTOK_USERNAME;
  if (user) bridge.connect(user);
});

const shutdown = async () => {
  if (broadcaster) broadcaster.stop(true);
  recorder.stop();
  mock.stop();
  await bridge.disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
