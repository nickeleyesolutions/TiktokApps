// Same-origin avatar proxy with memory + disk cache.
//
// Why: drawing a cross-origin image without CORS headers "taints" a canvas,
// and a tainted canvas can no longer be uploaded to WebGL, which would break
// the post-processing layer. Serving avatars from our own origin avoids that,
// and caching keeps working if TikTok's signed URLs expire mid-stream.
//
// Only https URLs on known TikTok image CDNs are fetched (no open proxy).
// Add hosts with AVATAR_HOSTS=host1,host2 if TikTok serves from new domains.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// seen in real LIVE payloads: p16/p19-common-sign.tiktokcdn(-us|-eu).com, sf16-passport-sg.ibytedtos.com
const DEFAULT_HOSTS = ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'ibyteimg.com', 'byteimg.com', 'ibytedtos.com', 'muscdn.com'];

export function createAvatarHandler(cacheDir) {
  const hosts = (process.env.AVATAR_HOSTS ? process.env.AVATAR_HOSTS.split(',') : DEFAULT_HOSTS).map((h) => h.trim()).filter(Boolean);
  const mem = new Map(); // key -> { buf, type }
  fs.mkdirSync(cacheDir, { recursive: true });

  const remember = (key, entry) => {
    mem.set(key, entry);
    if (mem.size > 800) mem.delete(mem.keys().next().value);
  };

  return async function avatar(req, res) {
    let url;
    try {
      url = new URL(String(req.query.u || ''));
    } catch {
      return res.status(400).end();
    }
    const okHost = hosts.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));
    if (url.protocol !== 'https:' || !okHost) return res.status(403).end();

    const key = crypto.createHash('sha1').update(url.href).digest('hex');
    const send = (e) => {
      res.set('Content-Type', e.type);
      res.set('Cache-Control', 'public, max-age=86400');
      res.end(e.buf);
    };

    const hit = mem.get(key);
    if (hit) return send(hit);

    const file = path.join(cacheDir, key);
    try {
      const meta = JSON.parse(fs.readFileSync(file + '.json', 'utf8'));
      const e = { buf: fs.readFileSync(file), type: meta.type };
      remember(key, e);
      return send(e);
    } catch {
      /* not cached on disk */
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(url.href, { signal: ctrl.signal, redirect: 'error' });
      clearTimeout(timer);
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !type.startsWith('image/')) return res.status(502).end();
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 2 * 1024 * 1024) return res.status(413).end();
      const e = { buf, type };
      remember(key, e);
      fs.writeFile(file, buf, () => {});
      fs.writeFile(file + '.json', JSON.stringify({ type }), () => {});
      send(e);
    } catch {
      res.status(504).end();
    }
  };
}
