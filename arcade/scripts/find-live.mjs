// npm run find-live [-- name1 name2 ...]
// Finds creators that are live right now (TikTok room status 2), most viewers
// first. Useful for piggyback testing. With no names, reads scripts/live-candidates.txt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TikTokLiveConnection } from 'tiktok-live-connector';

const here = path.dirname(fileURLToPath(import.meta.url));
let names = process.argv.slice(2);
if (!names.length) names = fs.readFileSync(path.join(here, 'live-candidates.txt'), 'utf8').split(/\s+/).filter((n) => n && !n.startsWith('#'));
const timeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
const live = [];
async function check(n) {
  try {
    const c = new TikTokLiveConnection(n, {});
    const id = await timeout(c.fetchRoomId(), 12000);
    const info = await timeout(c.fetchRoomInfo(id), 12000);
    const d = info.data || {};
    if (d.status === 2) live.push({ n, viewers: d.user_count || 0, title: d.title || '' });
  } catch {
    /* not live or not found */
  }
}
for (let i = 0; i < names.length; i += 8) await Promise.all(names.slice(i, i + 8).map(check));
live.sort((a, b) => b.viewers - a.viewers);
for (const r of live) console.log(`LIVE @${r.n}  ${r.viewers} viewers  ${JSON.stringify(r.title.slice(0, 50))}`);
console.log(`checked ${names.length}, live ${live.length}`);
process.exit(0);
