// Builds dist/arena-demo.html: one self-contained file with the whole stage
// bundled in, running in offline demo mode (local mock crowd, no server).
// Good for testing on a phone or sharing a preview. `npm run build:demo`
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({
  entryPoints: [path.join(ROOT, 'public/js/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['chrome100', 'safari15'],
  write: false,
  legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(ROOT, 'public/css/stage.css'), 'utf8');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Arcade Arena Demo</title>
<meta name="description" content="Offline demo of a neo-arcade left vs right battle game for TikTok LIVE.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Press+Start+2P&display=swap">
<style>
:root { color-scheme: dark; --bg: #000; --panel: #0b0a16; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #000; --panel: #0b0a16; } }
:root[data-theme="dark"] { --bg: #000; --panel: #0b0a16; }
${css}
</style>
</head>
<body>
<div id="stage"><canvas id="post"></canvas><canvas id="hud"></canvas></div>
<script>${js}</script>
</body>
</html>
`;
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const file = path.join(ROOT, 'dist/arena-demo.html');
fs.writeFileSync(file, html);
console.log(`wrote ${path.relative(ROOT, file)} (${Math.round(html.length / 1024)} KB)`);
