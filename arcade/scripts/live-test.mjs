// npm run live-test -- <username> [seconds]
// Checks the room is really live, connects, runs every event through the
// game's normalizer, prints counts and samples, and saves a recording you can
// replay offline (node server.js --replay recordings/<file>).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';
import { createNormalizer } from '../public/js/shared/normalizer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const user = String(process.argv[2] || '').replace(/^@/, '');
const seconds = Number(process.argv[3] || 60);
if (!user) {
  console.log('usage: npm run live-test -- <username> [seconds]');
  process.exit(1);
}
const conn = new TikTokLiveConnection(user, { processInitialData: false, signApiKey: process.env.SIGN_API_KEY || undefined });
const norm = createNormalizer();
const counts = {};
const samples = {};
fs.mkdirSync(path.join(ROOT, 'recordings'), { recursive: true });
const file = path.join(ROOT, 'recordings', `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}_${user}_livetest.jsonl`);
const out = fs.createWriteStream(file);
const t0 = Date.now();
for (const [kind, ev] of [['chat', WebcastEvent.CHAT], ['gift', WebcastEvent.GIFT], ['like', WebcastEvent.LIKE], ['share', WebcastEvent.SHARE], ['follow', WebcastEvent.FOLLOW], ['member', WebcastEvent.MEMBER], ['roomUser', WebcastEvent.ROOM_USER]]) {
  conn.on(ev, (raw) => {
    const e = norm.normalize(kind, raw);
    if (!e) return;
    counts[e.type] = (counts[e.type] || 0) + 1;
    out.write(JSON.stringify({ t: Date.now() - t0, e }) + '\n');
    const s = (samples[e.type] ||= []);
    if (s.length < 3) {
      if (e.type === 'gift') s.push(`${e.user.uid}: ${e.gift.name} (${e.gift.coins} coins) x${e.delta} streak=${e.gift.streakable} end=${e.end}`);
      else if (e.type === 'chat') s.push(`${e.user.uid}: ${e.text}`);
      else if (e.type === 'like') s.push(`${e.user.uid}: +${e.count}`);
      else if (e.type === 'viewers') s.push(`viewers ${e.count}`);
      else s.push(`${e.user && e.user.uid}`);
    }
  });
}
conn.on(ControlEvent.DISCONNECTED, () => console.log('[live-test] disconnected'));
try {
  const st = await conn.connect();
  const info = st.roomInfo && (st.roomInfo.data || st.roomInfo);
  if (info && info.status !== undefined && info.status !== 2) throw new Error(`room ${st.roomId} is not live (status ${info.status})`);
  if (info && info.message === 'room not started') throw new Error(`room ${st.roomId} not started`);
  console.log(`[live-test] connected to @${user} room ${st.roomId}${info && info.title ? ' "' + info.title + '"' : ''}${info && info.user_count != null ? ', ' + info.user_count + ' viewers' : ''}. Listening ${seconds}s...`);
} catch (e) {
  console.log(`[live-test] could not connect to @${user}: ${e.message}`);
  process.exit(2);
}
const tick = setInterval(() => process.stdout.write(`\r[live-test] ${Math.round((Date.now() - t0) / 1000)}s ${JSON.stringify(counts)}   `), 2000);
setTimeout(async () => {
  clearInterval(tick);
  console.log('\n\n[live-test] events by type:', JSON.stringify(counts));
  for (const [k, s] of Object.entries(samples)) console.log(`  ${k}: ${s.join(' | ')}`);
  console.log(`\n[live-test] saved ${path.relative(ROOT, file)} (replay: node server.js --replay ${path.relative(ROOT, file)})`);
  out.end();
  try {
    await conn.disconnect();
  } catch {}
  process.exit(Object.keys(counts).length ? 0 : 3);
}, seconds * 1000);
