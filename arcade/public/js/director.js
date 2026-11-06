// /director page: live status, TikTok connection, record/replay, and the
// shared control panel. Open it on your phone while the stage runs in OBS.
import { buildPanel } from './panel.js';
import { DEFAULT_WEIGHTS } from './shared/defaults.js';
import { deepMerge, clone } from './shared/objpath.js';

const $ = (id) => document.getElementById(id);
const key = new URLSearchParams(location.search).get('key') || '';
const socket = window.io({ query: { role: 'director', key } });
let weights = clone(DEFAULT_WEIGHTS);

const api = {
  weights: () => weights,
  patch: (path, value) => socket.emit('weights:patch', { path, value }),
  mock: (m) => socket.emit('mock', m),
  cmd: (c) => socket.emit('cmd', c),
  chaos: (lvl) => socket.emit('chaos', lvl),
  assets: () => fetch('/api/assets').then((r) => r.json()).catch(() => []),
  resetWeights: () => socket.emit('weights:reset'),
};
const panel = buildPanel($('panel'), api);

socket.on('connect', () => {
  $('conn').textContent = 'connected';
  $('conn').className = 'pill ok';
});
socket.on('disconnect', () => {
  $('conn').textContent = 'offline';
  $('conn').className = 'pill bad';
});
socket.on('denied', (msg) => {
  $('conn').textContent = msg;
  $('conn').className = 'pill bad';
});
socket.on('weights', (w) => {
  weights = deepMerge(clone(DEFAULT_WEIGHTS), w);
  panel.refresh(weights);
});

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function teamHtml(t, color) {
  const pct = Math.max(0, Math.min(100, (t.hp / t.max) * 100));
  const flags = [t.staggered ? 'STAGGER' : '', t.limitReady ? 'LIMIT' : '', t.gate ? `GATE ${t.gate}s (tier ${t.gateTier})` : ''].filter(Boolean).join(' ');
  return `<b style="color:${color}">${esc(t.name)}</b> ${t.wins ? '&#9733;' + t.wins : ''}
    <div class="bar"><i style="width:${pct}%;background:${color}"></i></div>
    HP ${t.hp.toLocaleString()} &middot; units ${t.units}${t.reserve ? '+' + t.reserve : ''} (npc ${t.npc})<br>
    stg ${t.stagger} &middot; lmt ${t.limit} &middot; mana ${t.mana}<br>
    H${t.stacks.haste} B${t.stacks.bravery} G${t.stacks.barrage} ${flags ? '<span style="color:#ffd34a">' + flags + '</span>' : ''}`;
}

socket.on('status', (s) => {
  $('tA').innerHTML = teamHtml(s.A, '#3ae4ff');
  $('tB').innerHTML = teamHtml(s.B, '#ff3d5e');
  $('meta').textContent = `D${s.dimension || 1} (${s.energy || 0} energy)${s.rift && s.rift.phase ? ' | rift ' + s.rift.type + ' ' + s.rift.phase + ' ' + s.rift.A + '/' + s.rift.B + ' of ' + s.rift.goal : s.rift ? ' | next rift ' + s.rift.next + 's' : ''} | round ${s.round} ${s.phase}${s.cine ? ' [' + s.cine + ']' : ''} | ${s.fps} fps @ ${s.res} | post ${s.post ? 'on' : 'off'} | sound ${s.audio ? 'on' : 'off (click the stage once)'} | seekers ${s.proj} | particles ${s.parts}${s.perf ? ' | cpu ' + s.perf.total + ' ms (battle ' + s.perf.world + ', hud ' + s.perf.hud + ')' : ''}${s.quality ? ' | auto-quality ' + s.quality : ''}${s.happyHour ? ' | happy hour ' + s.happyHour + 's' : ''}${s.boss ? ' | boss ' + s.boss.hp : ''}`;
});

socket.on('bridge', (b) => {
  const extra = b.error ? ` | ${b.error}` : '';
  $('bridge').textContent = `${b.status}${b.username ? ' @' + b.username : ''}${b.roomId ? ' room ' + b.roomId : ''}${b.retryInMs ? ' | retry in ' + Math.round(b.retryInMs / 1000) + 's' : ''}${extra}`;
  if (b.username && !$('user').value) $('user').value = b.username;
});
$('connect').onclick = () => socket.emit('bridge:connect', $('user').value);

socket.on('broadcast', (b) => {
  $('bcast').style.display = b.available ? 'block' : 'none';
  if (!b.available) return;
  const since = b.since && b.status !== 'off' ? ` | ${Math.round((Date.now() - b.since) / 60000)} min` : '';
  $('bStatus').textContent = `${b.status}${b.res ? ' ' + b.res : ''}${b.fps ? ' | ' + b.fps + ' fps' : ''}${b.bitrate ? ' | ' + b.bitrate : ''}${b.speed ? ' | speed ' + b.speed : ''}${since}${b.error ? ' | ' + b.error : ''}`;
  $('bStatus').style.color = b.status === 'live' ? '#7dff9a' : b.status === 'off' ? '' : '#ffd34a';
});
$('bStart').onclick = () => {
  socket.emit('broadcast:start', { url: $('bUrl').value, key: $('bKey').value, res: $('bRes').value });
  $('bKey').value = '';
};
$('bStop').onclick = () => confirm('Stop the stream?') && socket.emit('broadcast:stop');
$('disconnect').onclick = () => socket.emit('bridge:disconnect');

socket.on('recordings', (r) => {
  const sel = $('recList');
  const cur = sel.value;
  sel.innerHTML = r.list.length ? r.list.map((f) => `<option value="${esc(f.name)}">${esc(f.name)} (${Math.round(f.size / 1024)} KB)</option>`).join('') : '<option value="">no recordings yet</option>';
  if (cur) sel.value = cur;
  $('recMeta').textContent = `${r.recording ? 'RECORDING to ' + r.file : 'not recording'}${r.replaying ? ' | replaying' : ''}`;
});
$('recStart').onclick = () => socket.emit('record:start');
$('recStop').onclick = () => socket.emit('record:stop');
$('replay').onclick = () => socket.emit('replay:play', { name: $('recList').value, speed: Number($('recSpeed').value) });
$('replayStop').onclick = () => socket.emit('replay:stop');

const feed = $('feed');
socket.on('feed', (f) => {
  if (f.quiet) return;
  const d = document.createElement('div');
  d.textContent = `[${f.source}] ${f.text}`;
  if (f.big) d.className = 'big';
  feed.prepend(d);
  while (feed.childNodes.length > 120) feed.lastChild.remove();
});

socket.on('code:changed', (file) => {
  $('codeMsg').textContent = `Code changed: ${file}`;
  $('code').classList.add('show');
});
$('codeBtn').onclick = () => {
  socket.emit('cmd', { type: 'hotReload' });
  $('code').classList.remove('show');
};
