// LAYER 3: HUD on its own canvas, drawn after post-processing so text stays
// sharp. Layout (design units, 720 x 1280 portrait):
//   0-96     left clear for TikTok's own header (host pill, viewer count)
//   96-122   Hall of Fame ribbon (executioners)
//   128-240  team plates, HP bars, stagger / mana / limit gauges
//   244-262  stack badges and unit counts
//   266-356  status pills, event feed, transient gift guide
//   360-900  battlefield
//   900+     mostly covered by TikTok chat + buttons on phones: decoration only
import { W, H, TAU, clamp, rgba, fmt, roundRectPath, easeOutBack, cleanName } from './util.js';
import { avatarImage, pixelAvatar, unitSprite } from './sprites.js';
import { UNIT_R, ELITE_R, commanderPos, DIMENSIONS, CLASSES, CLASS_IDS } from './combat.js';
import { INTENTIONS } from './randonaut.js';

// Places the rotating guide card can sit. All avoid the TikTok header, the
// lower-left chat zone and the right-hand buttons (approximate, see drawSafeZones).
const ORACLE_SLOTS = [
  { x: 360, y: 324, w: 560 },
  { x: 222, y: 840, w: 264 },
];

// Legend panel: bottom right, clear of TikTok's chat (left) and buttons (right edge).
const LEGEND = { x: 432, y: 892, w: 200 };
const LEGEND_ROWS = [
  ['like', 'LIKE', 'ATTACK', '#ff5fa8'],
  ['chat', 'CHAT', 'JOIN IN', '#ffffff'],
  ['side', 'A/B', 'PICK SIDE', '#7df9ff'],
  ['share', 'SHARE', 'SHIELD', '#9ff6ff'],
  ['follow', 'FOLLOW', 'HASTE', '#7dff9a'],
  ['gift', 'GIFT', 'POWER UP', '#ffd34a'],
  ['cls', 'MAGE', 'CLASS', '#c48bff'],
];
// legend rows that double as room-goal meters
const GOAL_ROW = { like: 'like', share: 'share', follow: 'follow' };

// 7x6 pixel icons for the legend (X = filled)
const ICONS = {
  like: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  chat: ['XXXXXXX', 'X.....X', 'X.X.X.X', 'X.....X', 'XXXXXXX', '.X.....'],
  side: ['XX...XX', 'X.X.X.X', 'XXX.XX.', 'X.X.X.X', 'X.X.XX.', '.......'],
  share: ['....XX.', '...XXXX', 'XXXXXX.', 'X...XX.', 'X......', 'XXXXX..'],
  follow: ['...X...', '...X...', 'XXXXXXX', '...X...', '...X...', '.......'],
  gift: ['.X...X.', 'XXXXXXX', 'X..X..X', 'XXXXXXX', 'X..X..X', 'XXXXXXX'],
};
function icon(ctx, name, x, y, px, color) {
  const rows = ICONS[name] || (CLASSES[name] && CLASSES[name].icon);
  if (!rows) return;
  ctx.fillStyle = color;
  for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) if (rows[j][i] === 'X') ctx.fillRect(x + i * px, y + j * px, px, px);
}

// thin-film style hue sweep used for holographic edges
function holo(ctx, x0, x1, time, a = 1) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  for (let i = 0; i <= 4; i++) g.addColorStop(i / 4, `hsla(${(time * 70 + i * 80) % 360},100%,68%,${a})`);
  return g;
}
import { TEXT } from './textcache.js';

export const PIX = '"Press Start 2P", monospace';
export const ORB = 'Orbitron, "Arial Black", Impact, sans-serif';

// Text goes through the sprite cache unless opt.live (values that change
// every frame, like HP numbers, are cheaper to draw directly).
function txt(ctx, s, x, y, size, color, opt = {}) {
  const font = opt.orb ? `${opt.weight || 900} ${size}px ${ORB}` : `${size}px ${PIX}`;
  const outline = opt.outline === 0 ? 0 : opt.outline || Math.max(3, size * 0.28);
  const oc = opt.outlineColor || '#05030c';
  if (!opt.live) return TEXT.draw(ctx, String(s), x, y, font, size, color, outline, oc, opt.align || 'center');
  ctx.font = font;
  ctx.textAlign = opt.align || 'center';
  ctx.textBaseline = 'middle';
  if (outline) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = outline;
    ctx.strokeStyle = oc;
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

const fitMemo = new Map();
function fitText(ctx, s, maxW, size, opt = {}) {
  const font = opt.orb ? `${opt.weight || 900} ${size}px ${ORB}` : `${size}px ${PIX}`;
  const key = s + '|' + font + '|' + maxW;
  const hit = fitMemo.get(key);
  if (hit !== undefined) return hit;
  ctx.font = font;
  let t = s;
  while (t.length > 3 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  const out = t === s ? s : t.slice(0, -1) + '.';
  fitMemo.set(key, out);
  if (fitMemo.size > 800) fitMemo.delete(fitMemo.keys().next().value);
  return out;
}

const widthMemo = new Map();
function textWidth(ctx, s, font) {
  const key = s + '|' + font;
  let w = widthMemo.get(key);
  if (w === undefined) {
    ctx.font = font;
    w = ctx.measureText(s).width;
    widthMemo.set(key, w);
    if (widthMemo.size > 400) widthMemo.delete(widthMemo.keys().next().value);
  }
  return w;
}

function gauge(ctx, x, y, w, h, ratio, fill, alignRight, bg = 'rgba(8,6,20,0.8)') {
  ctx.fillStyle = bg;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  const fw = w * clamp(ratio, 0, 1);
  ctx.fillStyle = fill;
  if (alignRight) ctx.fillRect(x + w - fw, y, fw, h);
  else ctx.fillRect(x, y, fw, h);
}

export class HUD {
  constructor() {
    this.hallScroll = 0;
    this.guidePage = 0;
    this.lastGuideCycle = -1;
    this.or = { t: 0, card: null, n: 0, slot: 0, ctxTurn: 0 };
    this.bot = { t: 0, msg: null, n: 0, welcomeFor: null };
    this.ticker = { s: '', tw: 0 };
  }

  // ---- glass header: soft panel behind the plates so text sits on something
  drawGlass(ctx, th, time) {
    const g = ctx.createLinearGradient(0, 122, 0, 272);
    g.addColorStop(0, 'rgba(6,4,18,0.62)');
    g.addColorStop(0.75, 'rgba(6,4,18,0.38)');
    g.addColorStop(1, 'rgba(6,4,18,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 122, W, 150);
    const la = ctx.createLinearGradient(0, 0, W / 2, 0);
    la.addColorStop(0, rgba(th.A.c1, 0.9));
    la.addColorStop(1, rgba(th.A.c1, 0));
    ctx.fillStyle = la;
    ctx.fillRect(0, 123, W / 2, 2);
    const lb = ctx.createLinearGradient(W, 0, W / 2, 0);
    lb.addColorStop(0, rgba(th.B.c1, 0.9));
    lb.addColorStop(1, rgba(th.B.c1, 0));
    ctx.fillStyle = lb;
    ctx.fillRect(W / 2, 123, W / 2, 2);
    // a slow light sweep across the header
    const sx = ((time * 90) % (W + 400)) - 200;
    const sw = ctx.createLinearGradient(sx - 120, 0, sx + 120, 0);
    sw.addColorStop(0, 'rgba(255,255,255,0)');
    sw.addColorStop(0.5, 'rgba(255,255,255,0.05)');
    sw.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sw;
    ctx.fillRect(sx - 120, 125, 240, 120);
  }

  // ---- crowd vote panel (top slot). Returns true while visible.
  drawPoll(ctx, b, time) {
    const p = b.crowd && b.crowd.poll;
    if (!p || b.cine || b.phase !== 'battle') return false;
    const x = 80;
    const y = 280;
    const w = 560;
    const rowH = 30;
    const h = 40 + p.opts.length * rowH + 6;
    const intro = easeOutBack(clamp((p.dur - p.t) / 0.4, 0, 1));
    ctx.save();
    ctx.translate(W / 2, y + h / 2);
    ctx.scale(1, intro);
    ctx.translate(-W / 2, -(y + h / 2));
    roundRectPath(ctx, x, y, w, h, 12);
    ctx.fillStyle = 'rgba(8,4,22,0.86)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = p.t < 5 && Math.sin(time * 12) > 0 ? '#ffd34a' : holo(ctx, x, x + w, time);
    ctx.stroke();
    txt(ctx, 'CROWD VOTE', x + 16, y + 20, 16, '#ffd34a', { orb: true, align: 'left', outline: 0 });
    txt(ctx, `${Math.max(0, Math.ceil(p.t))}s`, x + w - 16, y + 20, 15, '#ffffff', { align: 'right', outline: 0, live: true });
    txt(ctx, 'TYPE ONE WORD IN CHAT', x + w / 2 + 30, y + 20, 10, 'rgba(255,255,255,0.7)', { outline: 0 });
    let total = 0;
    for (const o of p.opts) total += p.votes[o.id] || 0;
    let lead = null;
    for (const o of p.opts) if (!lead || (p.votes[o.id] || 0) > (p.votes[lead.id] || 0)) lead = o;
    p.opts.forEach((o, i) => {
      const ry = y + 40 + i * rowH;
      const n = p.votes[o.id] || 0;
      const r = total ? n / total : 0;
      const bump = p.bump[o.id] || 0;
      roundRectPath(ctx, x + 12, ry, w - 24, rowH - 6, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fill();
      if (r > 0) {
        roundRectPath(ctx, x + 12, ry, Math.max(12, (w - 24) * r), rowH - 6, 6);
        ctx.fillStyle = rgba(o.color, 0.28 + 0.3 * bump);
        ctx.fill();
      }
      if (lead === o && n > 0) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = rgba(o.color, 0.9);
        roundRectPath(ctx, x + 12, ry, w - 24, rowH - 6, 6);
        ctx.stroke();
      }
      txt(ctx, o.word, x + 24, ry + 12, 15, o.color, { align: 'left', outline: 0 });
      txt(ctx, '= ' + o.title, x + 24 + (o.word.length + 0.6) * 15, ry + 12, 12, '#ffffff', { align: 'left', outline: 0 });
      txt(ctx, String(n), x + w - 26, ry + 12, 14, '#ffffff', { align: 'right', outline: 0, live: true });
    });
    ctx.restore();
    return true;
  }

  // ---- host bot: a chat-style bubble above the legend with rotating tips,
  // welcomes and live calls to action. Free, needs no TikTok login.
  botLines(b, w) {
    const L = [];
    const cr = b.crowd;
    const g = w.goals;
    if (g && g.enabled && cr) {
      const left = cr.goalTarget('like') - cr.goals.like;
      L.push([`${fmt(Math.max(1, left))} MORE LIKES`, 'HYPERDRIVE FOR ALL', '#ff5fa8']);
      const fl = cr.goalTarget('follow') - cr.goals.follow;
      L.push([`${fl} MORE FOLLOWS`, 'UNLOCK HAPPY HOUR', '#7dff9a']);
      const sh = cr.goalTarget('share') - cr.goals.share;
      L.push([`${sh} MORE SHARES`, 'SHIELDS FOR EVERYONE', '#9ff6ff']);
    }
    if (w.classes.enabled && w.classes.byChat) {
      const id = CLASS_IDS[(this.bot.n >> 1) % CLASS_IDS.length];
      const tip = { knight: 'TANKY, TAKES LESS DMG', mage: 'FIRES 3 ARCANE SHOTS', ranger: 'FAST, HUNTS THE WEAK', cleric: 'HEALS YOUR TEAM', rogue: 'EVERY 3RD HIT CRITS' }[id];
      L.push([`TYPE ${CLASSES[id].name}`, tip, CLASSES[id].color]);
    }
    L.push(['TAP LIKE', 'HEART MISSILES FIRE', '#ff5fa8']);
    L.push([`TYPE ${w.chat.joinA[0].toUpperCase()} OR ${w.chat.joinB[0].toUpperCase()}`, 'PICK YOUR SIDE', '#ffffff']);
    const und = b.underdog();
    if (b.underdogMul(und) > 1) L.push([`HELP ${b.col(und).name}`, 'UNDERDOG POWER ON', '#7dff9a']);
    for (const k of ['A', 'B']) if (b.teams[k].gate.active) L.push(['FINAL BLOW READY', `${fmt(b.coinsForTier(b.teams[k].gate.tier))}+ ENDS IT`, '#ff2a4a']);
    if (w.polls.enabled && cr && !cr.poll && cr.pollT < 40) L.push(['CROWD VOTE SOON', `IN ${Math.max(1, Math.ceil(cr.pollT))}s`, '#ffd34a']);
    return L;
  }

  drawBot(ctx, b, w, time, dt) {
    if (!w.bot || !w.bot.onScreen) return;
    const o = this.bot;
    o.t += dt;
    const show = 7;
    // a new arrival gets greeted right away
    if (b.welcome && o.welcomeFor !== b.welcome && (!o.msg || o.t > 3)) {
      o.welcomeFor = b.welcome;
      o.msg = [`HI ${cleanName(b.welcome.name, 12).toUpperCase()}!`, 'TAP LIKE TO ATTACK', '#ffd34a'];
      o.t = 0;
    } else if (!o.msg ? o.t >= 2 : o.t >= Math.max(show + 1, w.bot.everySeconds)) {
      const lines = this.botLines(b, w);
      o.msg = lines[o.n++ % lines.length];
      o.t = 0;
    }
    if (!o.msg || o.t > show) return;
    const a = clamp(Math.min(o.t / 0.25, (show - o.t) / 0.4), 0, 1);
    const bw = LEGEND.w + 70;
    const x = LEGEND.x + LEGEND.w - bw;
    const y = LEGEND.y - 66;
    const bh = 54;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(0, (1 - a) * 10);
    roundRectPath(ctx, x, y, bw, bh, 10);
    ctx.fillStyle = 'rgba(10,6,26,0.9)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgba(o.msg[2], 0.8);
    ctx.stroke();
    // little tail toward the legend
    ctx.beginPath();
    ctx.moveTo(x + bw - 34, y + bh);
    ctx.lineTo(x + bw - 22, y + bh + 8);
    ctx.lineTo(x + bw - 18, y + bh);
    ctx.closePath();
    ctx.fillStyle = 'rgba(10,6,26,0.9)';
    ctx.fill();
    // bot face
    ctx.fillStyle = o.msg[2];
    ctx.fillRect(x + 9, y + 13, 18, 14);
    ctx.fillRect(x + 16, y + 8, 4, 5);
    ctx.fillStyle = '#05030c';
    const blink = Math.sin(time * 3) > 0.95;
    ctx.fillRect(x + 12, y + 17, 4, blink ? 1 : 4);
    ctx.fillRect(x + 20, y + 17, 4, blink ? 1 : 4);
    txt(ctx, 'BOT', x + 18, y + 40, 8, 'rgba(255,255,255,0.65)', { outline: 0 });
    const fitPx = (str, room, max) => Math.max(8, Math.min(max, Math.floor(room / Math.max(1, str.length))));
    const room = bw - 44;
    txt(ctx, o.msg[0], x + 38, y + 18, fitPx(o.msg[0], room, 14), '#ffffff', { outline: 0, align: 'left' });
    txt(ctx, o.msg[1], x + 38, y + 38, fitPx(o.msg[1], room, 12), o.msg[2], { outline: 0, align: 'left' });
    ctx.restore();
  }

  draw(ctx, b, o) {
    const { theme, w, time, dt, hall, demo } = o;
    ctx.save();
    ctx.translate(b.shakeX * 0.35, b.shakeY * 0.35);
    this.drawGlass(ctx, theme, time);
    this.drawHall(ctx, hall, dt, b, w);
    this.drawPlates(ctx, b, theme, time);
    this.drawBars(ctx, b, theme, w, time);
    this.drawStacks(ctx, b, theme);
    if (w.hud.names) this.drawNames(ctx, b, time);
    this.drawCommanderLabels(ctx, b);
    b.fx.drawTexts(ctx, PIX);
    this.drawGates(ctx, b, w, time);
    this.drawTopPills(ctx, b, w, time);
    const riftShown = this.drawRift(ctx, b, theme, time) || this.drawPoll(ctx, b, time);
    const oracleTop = w.guide.enabled && w.guide.oracle && b.phase === 'battle' ? this.drawOracle(ctx, b, w, time, dt, riftShown) : false;
    if (!(w.guide.enabled && w.guide.oracle)) this.drawFeedOrGuide(ctx, b, theme, w, time);
    else if (!riftShown && !oracleTop && !b.cine) this.drawFeed(ctx, b);
    this.drawBuffs(ctx, b, time);
    this.drawRandonaut(ctx, b, theme, time);
    if (w.legend.enabled && b.phase === 'battle' && !b.cine) this.drawLegend(ctx, b, w, time);
    if (b.phase === 'battle' && !b.cine) this.drawBot(ctx, b, w, time, dt);
    this.drawBanners(ctx, b, time);
    if (b.cine) this.drawCine(ctx, b, theme, time);
    if (b.phase === 'victory' && !b.cine) this.drawVictory(ctx, b, theme, o.S, time);
    ctx.restore();
    if (w.hud.safeZones) this.drawSafeZones(ctx);
    if (demo) txt(ctx, 'OFFLINE DEMO  ~ OR GEAR = DIRECTOR', W / 2, H - 18, 9, 'rgba(255,255,255,0.45)', { outline: 0 });
  }

  drawHall(ctx, hall, dt, b, w) {
    const y = 96;
    const h = 28;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(20,12,4,0.82)');
    g.addColorStop(1, 'rgba(6,4,16,0.82)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, W, h);
    ctx.fillStyle = 'rgba(255,211,74,0.75)';
    ctx.fillRect(0, y, W, 2);
    ctx.fillRect(0, y + h - 2, W, 2);
    const font = `12px ${PIX}`;
    const tk = this.ticker;
    // rebuild only when a lap ends, so the text sprite cache is not churned
    if (!tk.s || this.hallScroll + dt * 52 >= tk.tw) {
      let s = !hall || !hall.length ? 'HALL OF FAME  *  LAND THE FINAL BLOW TO GET CROWNED  *  ' : 'HALL OF FAME  *  ' + hall.slice(0, 8).map((e) => `R${e.round} ${cleanName(e.name, 14).toUpperCase()}`).join('  *  ') + '  *  ';
      if (b && w) {
        const tips = this.botLines(b, w).slice(0, 4).map((l) => `${l[0]} = ${l[1]}`);
        s += tips.join('  *  ') + '  *  ';
      }
      tk.s = s;
      tk.tw = textWidth(ctx, s, font);
      this.hallScroll = 0;
    }
    this.hallScroll = (this.hallScroll + dt * 52) % tk.tw;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, W, h);
    ctx.clip();
    for (let x = -this.hallScroll; x < W; x += tk.tw) TEXT.draw(ctx, tk.s, x, y + h / 2 + 1, font, 12, '#ffd34a', 0, '', 'left');
    ctx.restore();
  }

  drawPlates(ctx, b, th, time) {
    const y = 146;
    const A = th.A;
    const B = th.B;
    txt(ctx, fitText(ctx, A.name, 250, 26, { orb: true }), 20, y, 26, A.c1, { orb: true, align: 'left' });
    txt(ctx, fitText(ctx, B.name, 250, 26, { orb: true }), W - 20, y, 26, B.c1, { orb: true, align: 'right' });
    const wa = Math.min(260, textWidth(ctx, A.name, `900 26px ${ORB}`));
    const wb = Math.min(260, textWidth(ctx, B.name, `900 26px ${ORB}`));
    for (let i = 0; i < Math.min(5, b.teams.A.wins); i++) this.star(ctx, 20 + wa + 16 + i * 16, y, '#ffd34a');
    for (let i = 0; i < Math.min(5, b.teams.B.wins); i++) this.star(ctx, W - 20 - wb - 16 - i * 16, y, '#ffd34a');
    // VS hex
    const cx = W / 2;
    const cy = 168;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6 + TAU / 12;
      const px = cx + Math.cos(a) * 26;
      const py = cy + Math.sin(a) * 26;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(8,6,20,0.92)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(255,255,255,${0.6 + 0.3 * Math.sin(time * 3)})`;
    ctx.stroke();
    // dimension: roman numeral in the hex, progress to the next level as a ring
    const lvl = b.asc.level;
    const prog = b.ascProgress();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(cx, cy, 32, 0, TAU);
    ctx.stroke();
    if (prog > 0) {
      ctx.strokeStyle = holo(ctx, cx - 32, cx + 32, time);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, 32, -Math.PI / 2, -Math.PI / 2 + TAU * prog);
      ctx.stroke();
    }
    txt(ctx, 'VS', cx, cy - 11, 8, 'rgba(255,255,255,0.75)', { outline: 0 });
    txt(ctx, DIMENSIONS[lvl - 1].roman, cx, cy + 4, lvl >= 4 ? 15 : 16, lvl >= 3 ? '#e7b6ff' : '#ffffff', { orb: true, outline: 0 });
    txt(ctx, 'R' + b.round, cx, cy + 16, 7, '#ffd34a', { outline: 0 });
  }

  // ---- rift countdown / race panel (top band). Returns true while visible.
  drawRift(ctx, b, th, time) {
    const r = b.rift;
    if (r.phase === 'idle' || b.cine || b.phase !== 'battle') return false;
    const type = r.type;
    const y = 290;
    const h = 80;
    ctx.save();
    roundRectPath(ctx, 36, y, W - 72, h, 10);
    ctx.fillStyle = 'rgba(8,3,20,0.84)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = holo(ctx, 36, W - 36, time);
    ctx.stroke();
    if (r.phase === 'incoming') {
      const n = Math.max(0, Math.ceil(r.t));
      const pulse = 1 + 0.25 * Math.max(0, (r.t % 1) - 0.6) / 0.4;
      txt(ctx, 'RIFT OPENING', 70, y + 18, 9, '#e7b6ff', { outline: 0, align: 'left' });
      txt(ctx, type.title, 70, y + 42, 22, '#ffffff', { orb: true, outline: 0, align: 'left' });
      txt(ctx, `FIRST TO ${fmt(r.goal)} ${type.unit}: ${type.rewardName}`, 70, y + 66, 11, '#ffd34a', { outline: 0, align: 'left' });
      ctx.save();
      ctx.translate(W - 92, y + h / 2);
      ctx.scale(pulse, pulse);
      txt(ctx, String(n), 0, 2, 40, '#d36bff', { orb: true, outline: 4, outlineColor: '#ffffff' });
      ctx.restore();
    } else if (r.phase === 'active') {
      const secs = Math.max(0, Math.ceil(r.t));
      txt(ctx, `RIFT: ${type.title}`, W / 2, y + 15, 12, '#ffffff', { outline: 0 });
      txt(ctx, `0:${String(secs).padStart(2, '0')}`, W - 62, y + 15, 12, secs <= 5 ? '#ff2a4a' : '#e7b6ff', { outline: 0, live: true });
      for (const k of ['A', 'B']) {
        const right = k === 'B';
        const bx = right ? 372 : 56;
        const bw = 292;
        const p = Math.min(1, r.prog[k] / r.goal);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(bx, y + 30, bw, 14);
        ctx.fillStyle = th[k].c1;
        const fw = bw * p;
        ctx.fillRect(right ? bx + bw - fw : bx, y + 30, fw, 14);
        txt(ctx, `${fmt(Math.min(r.prog[k], r.goal))}/${fmt(r.goal)}`, right ? bx + bw - 6 : bx + 6, y + 38, 11, '#ffffff', { outline: 3, align: right ? 'right' : 'left', live: true });
      }
      const line = `FIRST TO ${fmt(r.goal)} ${type.unit}: ${type.rewardName}`;
      txt(ctx, line, W / 2, y + 62, Math.min(13, Math.floor(600 / line.length)), '#ffd34a', { outline: 0 });
    } else {
      const won = r.winner;
      txt(ctx, won ? `${type.rewardName} UNLOCKED` : 'RIFT COLLAPSED', W / 2, y + 32, 20, won ? th[won].c1 : '#9c98c8', { orb: true, outline: 0 });
      txt(ctx, won ? `${th[won].name}  ${type.rewardText}  ${Math.ceil(b.w.rifts.buffSeconds)}s` : 'NEXT RIFT SOON', W / 2, y + 58, 10, '#ffffff', { outline: 0 });
    }
    ctx.restore();
    return true;
  }

  // ---- rotating guide card: always on screen, moves between slots and flips
  // between cards. Live game state (gate, limit, rift, underdog) jumps the queue.
  oracleCards(b, w) {
    const g = w.gifts;
    const c = [];
    const add = (give, unlock, color) => c.push({ give, unlock, color });
    add(`TYPE ${w.chat.joinA[0].toUpperCase()} OR ${w.chat.joinB[0].toUpperCase()}`, 'JOIN A TEAM + RALLY', '#ffffff');
    add('ANY 1+ COIN GIFT', 'SEEKER VOLLEY + BRAVERY', '#9ff6ff');
    add(`${g.tier2}+ COINS`, 'SURGE: ELITE TURRET UNIT', '#6affb0');
    add(`${g.tier3}+ COINS`, 'LIGHTNING STORM', '#ffd34a');
    add(`${fmt(g.tier4)}+ COINS`, 'GRAND SUMMON', '#ff5fa8');
    add(`${fmt(g.orbitalCoins)}+ COINS`, 'ORBITAL STRIKE', '#d36bff');
    add(`${fmt(w.mana.likesPerCast)} LIKES`, 'METEOR SHOWER', '#ff9fd0');
    add('SHARE THE LIVE', '10s SHIELD + BARRAGE', '#9ff6ff');
    add('TAP LIKE', 'HEART MISSILES AT THE ENEMY', '#ff5fa8');
    if (w.randonaut.enabled) add('TYPE FIRE ICE STORM LIGHT VOID', 'STEER THE NEXT ANOMALY', '#d36bff');
    if (w.classes.enabled && w.classes.byChat) add('TYPE KNIGHT MAGE RANGER CLERIC OR ROGUE', 'CHOOSE YOUR CLASS', '#c48bff');
    if (w.goals.enabled && b.crowd) {
      const cr = b.crowd;
      add(`${fmt(Math.max(1, cr.goalTarget('like') - cr.goals.like))} MORE ROOM LIKES`, 'HYPERDRIVE FOR BOTH TEAMS', '#ff5fa8');
      add(`${Math.max(1, cr.goalTarget('follow') - cr.goals.follow)} MORE FOLLOWS`, `HAPPY HOUR: ${w.gifts.happyHourMul}X GIFTS`, '#7dff9a');
    }
    if (w.commanders.enabled) add('TOP 3 GIFTERS', 'COMMANDER TURRET + CROWN', '#ffd34a');
    if (w.ascension.enabled && b.asc.level < 5) {
      const need = w.ascension.thresholds[b.asc.level] - b.asc.energy;
      const next = DIMENSIONS[b.asc.level];
      add(`${fmt(Math.max(1, need))} MORE ENERGY`, `DIMENSION ${next.roman}: ${next.perk}`, '#e7b6ff');
    }
    return c;
  }

  oracleContext(b, w) {
    const c = [];
    for (const k of ['A', 'B']) {
      const t = b.teams[k];
      const name = b.col(k).name;
      const enemyName = b.col(t.enemy).name;
      if (t.gate.active) c.push({ give: `${fmt(b.coinsForTier(t.gate.tier))}+ FOR ${enemyName}`, unlock: `EXECUTE ${name}`, color: '#ff2a4a', hot: true });
      if (t.limitReady > 0) c.push({ give: `${fmt(b.coinsForTier(w.limit.triggerTier))}+ FOR ${name}`, unlock: 'LIMIT BREAK', color: b.col(k).c1, hot: true });
      if (b.underdogMul(k) > 1) c.push({ give: `GIFT ${name}`, unlock: `+${Math.round((w.underdog.mul - 1) * 100)}% UNDERDOG POWER`, color: '#7dff9a' });
    }
    const rv = b.rando;
    if (rv.phase === 'live' && rv.ev.kind === 'attractor') c.push({ give: 'TAP LIKES NOW', unlock: 'CLAIM THE ATTRACTOR', color: '#ffd34a', hot: true });
    const r = b.rift;
    if (r.phase === 'active') c.push({ give: `${r.type.unit} FOR YOUR TEAM`, unlock: `${r.type.rewardName}: ${r.type.rewardText}`, color: '#d36bff', hot: true });
    return c;
  }

  drawOracle(ctx, b, w, time, dt, riftShown) {
    const o = this.or;
    const dur = Math.max(2, w.guide.cardSeconds);
    o.t += dt;
    if (!o.card || o.t >= dur) {
      o.t = 0;
      o.n++;
      const ctxCards = this.oracleContext(b, w);
      if (ctxCards.length && o.n % 2 === 0) o.card = ctxCards[o.ctxTurn++ % ctxCards.length];
      else {
        const cards = this.oracleCards(b, w);
        o.base = (o.base || 0) + 1;
        o.card = cards[o.base % cards.length];
      }
      if (o.n % 2 === 0) o.slot = (o.slot + 1) % ORACLE_SLOTS.length;
    }
    let slot = o.slot;
    if (slot === 0 && (riftShown || b.cine || b.phase !== 'battle')) slot = 1;
    const s = ORACLE_SLOTS[slot];
    // flip in / flip out
    const flip = Math.min(o.t / 0.3, (dur - o.t) / 0.3, 1);
    const sy = Math.max(0.02, Math.sin((Math.max(0, flip) * Math.PI) / 2));
    const card = o.card;
    const hW = 74;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(1, sy);
    ctx.globalAlpha = Math.max(0, flip);
    roundRectPath(ctx, -s.w / 2, -hW / 2, s.w, hW, 9);
    ctx.fillStyle = 'rgba(6,3,18,0.8)';
    ctx.fill();
    ctx.lineWidth = card.hot ? 3 : 2;
    ctx.strokeStyle = card.hot && Math.sin(time * 10) > 0 ? card.color : holo(ctx, -s.w / 2, s.w / 2, time);
    ctx.stroke();
    // gem
    const gx = -s.w / 2 + 20;
    ctx.fillStyle = card.color;
    ctx.fillRect(gx - 4, -16, 8, 32);
    ctx.fillRect(gx - 9, -7, 18, 14);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(gx - 2, -8, 4, 5);
    const tx = -s.w / 2 + 38;
    const maxW = s.w - 50;
    // Press Start 2P is monospaced (1 em per character): shrink long lines to fit, never cut them
    const fit = (str, room, max) => Math.max(9, Math.min(max, Math.floor(room / Math.max(1, str.length))));
    const gs = fit(card.give, maxW - 4, 17);
    const us = fit(card.unlock, maxW - 4, 14);
    txt(ctx, 'GIVE', tx, -24, 9, 'rgba(255,255,255,0.6)', { outline: 0, align: 'left' });
    txt(ctx, card.give, tx, -8, gs, '#ffffff', { outline: 0, align: 'left' });
    txt(ctx, 'UNLOCKS', tx, 12, 9, 'rgba(255,255,255,0.6)', { outline: 0, align: 'left' });
    txt(ctx, card.unlock, tx, 27, us, card.color, { outline: 0, align: 'left' });
    ctx.restore();
    return slot === 0;
  }

  drawFeed(ctx, b) {
    let y = 312;
    for (let i = b.feed.length - 1; i >= Math.max(0, b.feed.length - 3); i--) {
      const f = b.feed[i];
      const a = clamp(1 - (f.t - 3.5) / 1, 0, 1);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      const s = fitText(ctx, f.text, 430, f.tier >= 3 ? 14 : 12);
      const tw = textWidth(ctx, s, `${f.tier >= 3 ? 14 : 12}px ${PIX}`) + 16;
      roundRectPath(ctx, W / 2 - tw / 2, y - 12, tw, 24, 6);
      ctx.fillStyle = 'rgba(6,4,16,0.7)';
      ctx.fill();
      txt(ctx, s, W / 2, y + 1, f.tier >= 3 ? 14 : 12, f.color, { outline: 0 });
      ctx.globalAlpha = 1;
      y += 26;
    }
  }

  // ---- legend: always-on "what do I do" panel. Rows flash when someone does it.
  drawLegend(ctx, b, w, time) {
    const L = LEGEND;
    const rowH = 26;
    const h = 22 + LEGEND_ROWS.length * rowH + 4;
    roundRectPath(ctx, L.x, L.y, L.w, h, 8);
    ctx.fillStyle = 'rgba(6,3,18,0.8)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = holo(ctx, L.x, L.x + L.w, time, 0.8);
    ctx.stroke();
    txt(ctx, 'HOW TO PLAY', L.x + L.w / 2, L.y + 13, 11, '#e7b6ff', { outline: 0 });
    const cr = b.crowd;
    const goals = w.goals && w.goals.enabled && cr;
    const clsId = CLASS_IDS[Math.floor(time / 2.2) % CLASS_IDS.length];
    LEGEND_ROWS.forEach(([key, verb, result, color], i) => {
      if (key === 'cls' && !(w.classes.enabled && w.classes.byChat)) return;
      const y = L.y + 26 + i * rowH;
      const hit = b.legendHit[key] || 0;
      if (key === 'cls') {
        verb = CLASSES[clsId].name;
        color = CLASSES[clsId].color;
      }
      if (hit > 0) {
        ctx.fillStyle = rgba(color, 0.25 * hit);
        ctx.fillRect(L.x + 3, y - 1, L.w - 6, rowH - 2);
      }
      icon(ctx, key === 'cls' ? clsId : key, L.x + 7, y + 3, 3, color);
      txt(ctx, verb, L.x + 32, y + 11, 11, color, { outline: 0, align: 'left' });
      txt(ctx, '=' + result, L.x + 32 + (verb.length + 0.4) * 11, y + 11, 11, '#ffffff', { outline: 0, align: 'left' });
      const gk = GOAL_ROW[key];
      if (goals && gk) {
        const base = cr.goalBase(gk);
        const tgt = cr.goalTarget(gk);
        const r = clamp((cr.goals[gk] - base) / Math.max(1, tgt - base), 0, 1);
        const fl = cr.flash[gk] || 0;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(L.x + 32, y + 20, L.w - 40, 3);
        ctx.fillStyle = fl > 0 && Math.sin(time * 20) > 0 ? '#ffffff' : color;
        ctx.fillRect(L.x + 32, y + 20, (L.w - 40) * r, 3);
      }
    });
  }

  // ---- randonaut readouts: quantum-lock coordinates, claim race, timers
  drawRandonaut(ctx, b, th, time) {
    const r = b.rando;
    const ev = r.ev;
    if (!ev || b.cine) return;
    if (r.phase === 'scan') {
      const jitter = (n) => String(Math.floor(n + (Math.random() - 0.5) * 400 * clamp(r.t / 2.6, 0, 1))).padStart(3, '0');
      txt(ctx, 'QUANTUM LOCK', ev.x, ev.y - 54, 10, '#7df9ff', { outline: 3 });
      txt(ctx, `X${jitter(ev.x)} Y${jitter(ev.y)}`, ev.x, ev.y - 36, 11, '#ffffff', { outline: 3, live: true });
      return;
    }
    if (r.phase !== 'live') return;
    const secs = Math.max(0, Math.ceil(ev.life));
    if (ev.kind === 'attractor') {
      txt(ctx, `ATTRACTOR ${secs}s`, ev.x, ev.y - 82, 10, '#ffd34a', { outline: 3, live: true });
      txt(ctx, `TAP LIKES TO CLAIM`, ev.x, ev.y - 66, 11, '#ffffff', { outline: 3 });
      txt(ctx, `${Math.min(ev.claim.A, b.w.randonaut.claimLikes)}`, ev.x - 30, ev.y + 82, 10, th.A.c1, { outline: 3, live: true });
      txt(ctx, `${Math.min(ev.claim.B, b.w.randonaut.claimLikes)}`, ev.x + 30, ev.y + 82, 10, th.B.c1, { outline: 3, live: true });
      txt(ctx, `/${b.w.randonaut.claimLikes}`, ev.x, ev.y + 98, 10, 'rgba(255,255,255,0.75)', { outline: 3 });
    } else if (ev.kind === 'void') {
      txt(ctx, `VOID ${secs}s`, ev.x, ev.y - 96, 10, '#d36bff', { outline: 3, live: true });
    } else {
      const it = INTENTIONS[ev.theme];
      const s = `ANOMALY: ${it.label} ${secs}s`;
      const pw = textWidth(ctx, s, `10px ${PIX}`) + 20;
      roundRectPath(ctx, W / 2 - pw / 2, 266, pw, 18, 9);
      ctx.fillStyle = rgba(it.color, 0.25 + 0.1 * Math.sin(time * 6));
      ctx.fill();
      txt(ctx, s, W / 2, 275.5, 10, it.color, { outline: 0, live: true });
    }
  }

  // ---- rift buffs with time left, under each team's stack row
  drawBuffs(ctx, b, time) {
    const defs = [
      ['hyper', 'HYPERDRIVE', '#7df9ff'],
      ['prism', 'PRISM', '#e7b6ff'],
      ['phase', 'PHASE x1.5', '#ff5fa8'],
    ];
    for (const k of ['A', 'B']) {
      const t = b.teams[k];
      const right = k === 'B';
      let x = right ? W - 20 : 20;
      for (const [key, label, color] of defs) {
        const secs = t.buffs[key];
        if (!(secs > 0)) continue;
        const s = `${label} ${Math.ceil(secs)}s`;
        const bw = textWidth(ctx, s, `11px ${PIX}`) + 14;
        const bx = right ? x - bw : x;
        roundRectPath(ctx, bx, 266, bw, 20, 9);
        ctx.fillStyle = 'rgba(8,3,20,0.85)';
        ctx.fill();
        ctx.strokeStyle = secs < 5 && Math.sin(time * 12) > 0 ? '#ffffff' : color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        txt(ctx, s, bx + bw / 2, 276.5, 11, color, { outline: 0, live: true });
        x = right ? bx - 6 : bx + bw + 6;
      }
    }
  }

  star(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x - 2, y - 6, 4, 12);
    ctx.fillRect(x - 6, y - 2, 12, 4);
    ctx.fillRect(x - 4, y - 4, 8, 8);
  }

  drawBars(ctx, b, th, w, time) {
    for (const k of ['A', 'B']) {
      const t = b.teams[k];
      const col = th[k];
      const right = k === 'B';
      const x = right ? 382 : 20;
      const bw = 318;
      const y = 166;
      const h = 26;
      const c = t.core;
      const ratio = c.hp / c.max;
      const ghost = c.ghost / c.max;
      // frame
      ctx.fillStyle = 'rgba(8,6,20,0.9)';
      ctx.fillRect(x - 3, y - 3, bw + 6, h + 6);
      ctx.fillStyle = rgba(col.c1, 0.5);
      ctx.fillRect(x - 3, y - 3, bw + 6, 2);
      // ghost (delayed damage)
      ctx.fillStyle = 'rgba(255,240,240,0.85)';
      const gw = bw * clamp(ghost, 0, 1);
      ctx.fillRect(right ? x + bw - gw : x, y, gw, h);
      // fill
      const danger = ratio < 0.25 && Math.sin(time * 12) > 0;
      const g = ctx.createLinearGradient(x, 0, x + bw, 0);
      g.addColorStop(right ? 1 : 0, col.c2);
      g.addColorStop(right ? 0 : 1, col.c1);
      ctx.fillStyle = danger ? '#ff2a4a' : g;
      const fw = bw * clamp(ratio, 0, 1);
      ctx.fillRect(right ? x + bw - fw : x, y, fw, h);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(right ? x + bw - fw : x, y + 2, fw, 6);
      // gate marker
      const gx = right ? x + bw - bw * (w.execution.gatePct / 100) : x + bw * (w.execution.gatePct / 100);
      ctx.fillStyle = '#ff2a4a';
      ctx.fillRect(gx - 1, y - 4, 3, h + 8);
      // ticks
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let i = 1; i < 10; i++) ctx.fillRect(x + (bw * i) / 10, y, 1, h);
      txt(ctx, fmt(c.hp), right ? x + bw - 8 : x + 8, y + h / 2 + 1, 13, '#ffffff', { align: right ? 'right' : 'left', live: true });

      // gauges
      const lx = right ? W - 20 : 20;
      const gx0 = right ? 382 : 78;
      const gw0 = 260;
      const rows = [
        { label: t.staggerTime > 0 ? 'BRK!' : 'BRK', ratio: t.stagger / 100, color: t.staggerTime > 0 ? (Math.sin(time * 14) > 0 ? '#fff3a0' : '#ffd34a') : '#ffb21a' },
        { label: 'MANA', ratio: t.mana / w.mana.likesPerCast, color: '#ff5fa8' },
        { label: t.limitReady > 0 ? 'READY' : 'LMT', ratio: t.limit / 100, color: t.limitReady > 0 ? `hsl(${(time * 360) % 360},100%,65%)` : `hsl(${(time * 90 + (right ? 180 : 0)) % 360},90%,60%)` },
      ];
      rows.forEach((r, i) => {
        const yy = 202 + i * 14;
        txt(ctx, r.label, lx, yy + 4, 10, r.label === 'READY' || r.label === 'BRK!' ? '#ffffff' : 'rgba(255,255,255,0.75)', { align: right ? 'right' : 'left', outline: 0 });
        gauge(ctx, gx0, yy, gw0, 8, r.ratio, r.color, right);
      });
    }
  }

  drawStacks(ctx, b, th) {
    const defs = [
      ['haste', 'HST', '#6affb0'],
      ['bravery', 'BRV', '#ff6a6a'],
      ['barrage', 'BRG', '#ffd34a'],
    ];
    for (const k of ['A', 'B']) {
      const t = b.teams[k];
      const right = k === 'B';
      let x = right ? W - 20 : 20;
      const y = 254;
      // unit count icon
      const units = t.units.length;
      const res = t.reserve.length;
      const label = units + (res ? ` +${res}` : '');
      const lw = textWidth(ctx, label, `10px ${PIX}`) + 18;
      const ux = right ? x - lw : x;
      ctx.fillStyle = th[k].c1;
      ctx.fillRect(ux + 2, y - 6, 6, 5);
      ctx.fillRect(ux, y, 10, 6);
      txt(ctx, label, ux + 16, y + 1, 12, '#ffffff', { align: 'left', outline: 3, live: true });
      x = right ? ux - 10 : ux + lw + 10;
      for (const [key, short, color] of defs) {
        const n = t.stacks[key];
        if (n <= 0) continue;
        const s = `${short}x${n}`;
        const bw = textWidth(ctx, s, `11px ${PIX}`) + 12;
        const bx = right ? x - bw : x;
        if (right ? bx < 384 : bx + bw > 336) break; // keep the middle clear
        roundRectPath(ctx, bx, y - 10, bw, 21, 4);
        ctx.fillStyle = 'rgba(8,6,20,0.85)';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        txt(ctx, s, bx + bw / 2, y + 1, 11, color, { outline: 0, live: true });
        x = right ? bx - 6 : bx + bw + 6;
      }
      if (b.underdogMul(k) > 1) {
        const s = `UNDERDOG +${Math.round((b.w.underdog.mul - 1) * 100)}%`;
        const bw = textWidth(ctx, s, `11px ${PIX}`) + 12;
        const bx = right ? x - bw : x;
        if (right ? bx < 384 : bx + bw > 336) continue; // no room left: skip this team's badge
        roundRectPath(ctx, bx, y - 10, bw, 21, 4);
        ctx.fillStyle = 'rgba(125,255,154,0.18)';
        ctx.fill();
        ctx.strokeStyle = '#7dff9a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        txt(ctx, s, bx + bw / 2, y + 1, 11, '#7dff9a', { outline: 0 });
      }
    }
  }

  drawCommanderLabels(ctx, b) {
    for (const k of ['A', 'B']) {
      for (const c of b.commanders[k]) {
        const p = commanderPos(k, c.i);
        const r = c.i === 0 ? 20 : 16;
        txt(ctx, fmt(c.rec.coins), p.x, p.y + r + 10, 10, '#ffd34a', { outline: 3, live: true });
      }
    }
  }

  drawNames(ctx, b, time) {
    for (const k of ['A', 'B']) {
      for (const u of b.teams[k].units) {
        const show = u.elite > 0 ? 1 : clamp(u.label, 0, 1);
        if (show <= 0 || u.npc) continue;
        const r = u.elite > 0 ? ELITE_R : UNIT_R;
        ctx.globalAlpha = show;
        txt(ctx, cleanName(u.name, 9).toUpperCase(), u.x, u.y + r + 21, 11, u.elite > 0 ? '#ffd34a' : '#ffffff', { outline: 3 });
        if (u.cls && u.label > 0.5) txt(ctx, CLASSES[u.cls].name, u.x, u.y + r + 34, 8, CLASSES[u.cls].color, { outline: 3 });
        ctx.globalAlpha = 1;
      }
    }
  }

  drawGates(ctx, b, w, time) {
    for (const k of ['A', 'B']) {
      const t = b.teams[k];
      if (!t.gate.active) continue;
      const cx = k === 'A' ? 190 : W - 190;
      const cy = 488;
      const pulse = 0.5 + 0.5 * Math.sin(time * 9);
      roundRectPath(ctx, cx - 150, cy - 64, 300, 132, 10);
      ctx.fillStyle = `rgba(30,0,8,${0.55 + pulse * 0.15})`;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(255,42,74,${0.6 + pulse * 0.4})`;
      ctx.stroke();
      txt(ctx, 'FINAL BLOW', cx, cy - 44, 22, '#ffffff', { orb: true, outlineColor: '#ff2a4a' });
      txt(ctx, String(Math.max(0, Math.ceil(t.gate.t))), cx, cy + 2, 50, pulse > 0.5 ? '#ff2a4a' : '#ffffff', { orb: true });
      const coins = b.coinsForTier(t.gate.tier);
      txt(ctx, `${fmt(coins)}+ COINS: EXECUTE`, cx, cy + 38, 11, '#ffd34a', { outline: 3 });
      txt(ctx, `DEFEND ${fmt(coins)}+: REVIVE`, cx, cy + 56, 9, 'rgba(255,255,255,0.8)', { outline: 3 });
    }
  }

  drawTopPills(ctx, b, w, time) {
    let y = 280;
    if (b.boss) {
      const bw = 300;
      const x = W / 2 - bw / 2;
      txt(ctx, `BOSS ${Math.ceil(b.boss.t)}s`, W / 2, y - 10, 9, '#c77dff', { outline: 3 });
      gauge(ctx, x, y, bw, 8, b.boss.hp / b.boss.max, '#c77dff', false);
      y += 22;
    }
    if (b.happyHour > 0) {
      const s = `HAPPY HOUR ${w.gifts.happyHourMul}X  ${Math.ceil(b.happyHour)}s`;
      const pw = textWidth(ctx, s, `10px ${PIX}`) + 20;
      roundRectPath(ctx, W / 2 - pw / 2, y - 9, pw, 19, 9);
      ctx.fillStyle = `rgba(255,95,168,${0.75 + 0.2 * Math.sin(time * 6)})`;
      ctx.fill();
      txt(ctx, s, W / 2, y + 1, 10, '#ffffff', { outline: 0 });
    }
  }

  drawFeedOrGuide(ctx, b, th, w, time) {
    const every = Math.max(4, w.guide.everySeconds);
    const cyc = Math.floor(b.guideT / every);
    const local = b.guideT - cyc * every;
    const showGuide = w.guide.enabled && local < w.guide.showSeconds && b.phase === 'battle' && !b.cine;
    if (b.cine) return;
    if (cyc !== this.lastGuideCycle) {
      this.lastGuideCycle = cyc;
      this.guidePage = cyc % 2;
    }
    if (showGuide) {
      const a = clamp(Math.min(local / 0.3, (w.guide.showSeconds - local) / 0.3), 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      const y = 300 + (1 - a) * -20;
      roundRectPath(ctx, 40, y, W - 80, 62, 8);
      ctx.fillStyle = 'rgba(6,4,16,0.82)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.stroke();
      if (this.guidePage === 0) {
        txt(ctx, `TYPE ${w.chat.joinA[0].toUpperCase()} OR ${w.chat.joinB[0].toUpperCase()} TO JOIN`, W / 2, y + 22, 15, '#ffffff', { outline: 0 });
        txt(ctx, 'TAP LIKES = METEOR   SHARE = SHIELD', W / 2, y + 45, 10, '#ff9fd0', { outline: 0 });
      } else {
        const g = w.gifts;
        const chips = [
          ['1+', 'SEEKERS', '#9ff6ff'],
          [`${g.tier2}+`, 'SURGE', '#6affb0'],
          [`${g.tier3}+`, 'STORM', '#ffd34a'],
          [`${fmt(g.tier4)}+`, 'SUMMON', '#ff5fa8'],
        ];
        const cw = (W - 100) / 4;
        chips.forEach(([c, name, color], i) => {
          const cx = 50 + cw * i + cw / 2;
          txt(ctx, c, cx, y + 20, 13, color, { outline: 0 });
          txt(ctx, name, cx, y + 43, 9, '#ffffff', { outline: 0 });
        });
      }
      ctx.restore();
      return;
    }
    if (!w.hud.feed) return;
    let y = 312;
    for (let i = b.feed.length - 1; i >= Math.max(0, b.feed.length - 3); i--) {
      const f = b.feed[i];
      const a = clamp(1 - (f.t - 3.5) / 1, 0, 1);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      const s = fitText(ctx, f.text, 430, f.tier >= 3 ? 14 : 12);
      const tw = textWidth(ctx, s, `${f.tier >= 3 ? 14 : 12}px ${PIX}`) + 16;
      roundRectPath(ctx, W / 2 - tw / 2, y - 12, tw, 24, 6);
      ctx.fillStyle = 'rgba(6,4,16,0.7)';
      ctx.fill();
      txt(ctx, s, W / 2, y + 1, f.tier >= 3 ? 14 : 12, f.color, { outline: 0 });
      ctx.globalAlpha = 1;
      y += 26;
    }
  }

  drawBanners(ctx, b, time) {
    for (const bn of b.banners) {
      const p = bn.t / bn.dur;
      const sIn = easeOutBack(clamp(bn.t / 0.25, 0, 1));
      const a = clamp((bn.dur - bn.t) / 0.35, 0, 1);
      if (a <= 0) continue;
      const cx = bn.anchor === 'A' ? 190 : bn.anchor === 'B' ? W - 190 : W / 2;
      const cy = (bn.anchor === 'C' ? 650 : 404) - p * 10;
      const size = bn.small ? 26 : bn.anchor === 'C' ? 50 : 32;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(cx, cy);
      ctx.scale(sIn, sIn);
      const maxW = bn.anchor === 'C' ? 660 : 330;
      const t = fitText(ctx, bn.text, maxW, size, { orb: true });
      if (!bn.small) {
        // light streak behind the title, sweeping out from the center
        const sw = maxW * 0.62 * clamp(bn.t / 0.35, 0, 1);
        const lg = ctx.createLinearGradient(-sw, 0, sw, 0);
        lg.addColorStop(0, rgba(bn.color, 0));
        lg.addColorStop(0.5, rgba(bn.color, 0.38));
        lg.addColorStop(1, rgba(bn.color, 0));
        ctx.fillStyle = lg;
        ctx.fillRect(-sw, -size * 0.42, sw * 2, size * 0.84);
        ctx.fillStyle = rgba('#ffffff', 0.5 * a);
        ctx.fillRect(-sw * 0.8, size * 0.5, sw * 1.6, 2);
      }
      ctx.globalCompositeOperation = 'lighter';
      txt(ctx, t, 0, 0, size, bn.color, { orb: true, outline: size * 0.5, outlineColor: rgba(bn.color, 0.25) });
      ctx.globalCompositeOperation = 'source-over';
      txt(ctx, t, 0, 0, size, '#ffffff', { orb: true, outline: Math.max(3, size * 0.14), outlineColor: '#05030c' });
      ctx.globalAlpha = a * 0.92;
      txt(ctx, t, 0, 0, size, bn.color, { orb: true, outline: 0 });
      if (bn.sub) {
        const ss = Math.max(10, Math.min(15, Math.floor(maxW / Math.max(1, bn.sub.length))));
        txt(ctx, bn.sub, 0, size * 0.62 + 12, ss, '#ffffff', { outline: 4 });
      }
      ctx.restore();
    }
  }

  drawCine(ctx, b, th, time) {
    const c = b.cine;
    const col = th[c.team] || th.A;
    const name = c.rec ? cleanName(c.rec.name, 16).toUpperCase() : 'THE CROWD';
    const a = clamp(Math.min(c.t / 0.25, (c.dur - c.t) / 0.4), 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    if (c.type === 'limit') {
      const s = easeOutBack(clamp((c.t - 0.15) / 0.35, 0, 1));
      ctx.translate(W / 2, 400);
      ctx.scale(s, s);
      txt(ctx, 'LIMIT BREAK', 0, 0, 54, col.c1, { orb: true, outline: 8, outlineColor: '#ffffff' });
      txt(ctx, `${name}  OMNI-STRIKE`, 0, 46, 13, '#ffffff', { outline: 4 });
      if (c.done > 0) txt(ctx, `${c.done} HIT${c.done > 1 ? 'S' : ''}`, 0, 330, 28, '#ffd34a', { orb: true });
    } else if (c.type === 'summon') {
      if (c.t < c.climaxAt) {
        const s = easeOutBack(clamp((c.t - 0.1) / 0.4, 0, 1));
        ctx.translate(W / 2, 330);
        ctx.scale(s, s);
        const title = c.mode === 'execute' ? 'FINAL BLOW' : c.variant === 'orbital' ? 'ORBITAL STRIKE' : 'GRAND SUMMON';
        txt(ctx, title, 0, 0, 48, col.c1, { orb: true, outline: 8, outlineColor: '#ffffff' });
        txt(ctx, name, 0, 44, 16, '#ffffff', { outline: 4 });
        if (c.gift) txt(ctx, String(c.gift).toUpperCase(), 0, 70, 10, '#ffd34a', { outline: 3 });
      } else if (c.mode === 'execute' || b.phase === 'victory') {
        const s = easeOutBack(clamp((c.t - c.climaxAt) / 0.3, 0, 1));
        ctx.translate(W / 2, 780);
        ctx.scale(s, s);
        txt(ctx, 'EXECUTED!', 0, 0, 62, '#ff2a4a', { orb: true, outline: 9, outlineColor: '#ffffff' });
      }
    }
    ctx.restore();
  }

  drawVictory(ctx, b, th, S, time) {
    const v = b.victory;
    const col = th[v.winner];
    const total = b.w.round.intermissionSeconds;
    const t = total - v.t;
    const a = clamp(t / 0.4, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(2,1,8,0.72)';
    ctx.fillRect(0, 0, W, H);
    // confetti: positions are a pure function of index and time (no state)
    const pal = [col.c1, col.c2 || col.c1, '#ffd34a', '#ffffff', '#ff5fa8'];
    for (let i = 0; i < 70; i++) {
      const sx = ((i * 97.3) % W) + Math.sin(t * 1.3 + i) * 22;
      const fall = 90 + ((i * 37) % 80);
      const sy = ((t * fall + (i * 53) % H) % (H + 40)) - 20;
      const rot = t * (2 + (i % 5)) + i;
      ctx.fillStyle = pal[i % pal.length];
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(rot);
      ctx.fillRect(-4, -2 * Math.abs(Math.cos(rot * 1.7)) - 1, 8, 4 * Math.abs(Math.cos(rot * 1.7)) + 2);
      ctx.restore();
    }
    txt(ctx, 'VICTORY', W / 2, 330, 18, '#ffffff', { outline: 4 });
    const s = easeOutBack(clamp(t / 0.5, 0, 1));
    ctx.save();
    ctx.translate(W / 2, 400);
    ctx.scale(s, s);
    txt(ctx, fitText(ctx, col.name, 640, 72, { orb: true }), 0, 0, 72, col.c1, { orb: true, outline: 10, outlineColor: '#ffffff' });
    ctx.restore();
    txt(ctx, `ROUND ${b.round}  WINS ${b.teams[v.winner].wins}`, W / 2, 462, 12, '#ffd34a', { outline: 3 });
    const exec = v.exec;
    if (exec) {
      if (!v.sprite || v.spriteS !== S) {
        v.sprite = unitSprite({ r: 70, S, img: avatarImage(exec.avatar), pix: pixelAvatar(exec.id, col.c1, col.c2, false), ring: '#ffd34a', accent: col.c1, elite: true });
        v.spriteS = S;
      }
      const size = v.sprite.width / S;
      const bob = Math.sin(time * 2) * 4;
      ctx.drawImage(v.sprite, W / 2 - size / 2, 600 - size / 2 + bob, size, size);
      txt(ctx, 'EXECUTIONER', W / 2, 510, 12, '#ff2a4a', { outline: 3 });
      txt(ctx, cleanName(exec.name, 16).toUpperCase(), W / 2, 700, 22, '#ffffff', { orb: true });
      if (v.gift) txt(ctx, String(v.gift).toUpperCase(), W / 2, 730, 10, '#ffd34a', { outline: 3 });
    }
    if (v.mvp && v.mvp !== exec) txt(ctx, `TOP DAMAGE  ${cleanName(v.mvp.name, 12).toUpperCase()}  ${fmt(v.mvp.rd)}`, W / 2, 762, 11, col.c1, { outline: 3 });
    if (v.top && v.top.length) {
      txt(ctx, 'TOP GIFTERS', W / 2, 786, 9, 'rgba(255,255,255,0.7)', { outline: 0 });
      v.top.forEach((r, i) => txt(ctx, `${i + 1}. ${cleanName(r.name, 12).toUpperCase()}  ${fmt(r.coins)}`, W / 2, 804 + i * 16, 10, i === 0 ? '#ffd34a' : '#ffffff', { outline: 3 }));
    }
    txt(ctx, `NEXT ROUND IN ${Math.max(0, Math.ceil(v.t))}`, W / 2, 866, 12, 'rgba(255,255,255,0.85)', { outline: 3 });
    ctx.restore();
  }

  // Approximate areas the TikTok app draws over on phones. Eyeballed, not
  // from an official spec: check against a real phone before relying on it.
  drawSafeZones(ctx) {
    const zones = [
      [0, 0, W, 96, 'HEADER (approx)'],
      [0, 860, 470, 330, 'CHAT (approx)'],
      [0, 1190, W, 90, 'COMMENT BAR / GIFTS (approx)'],
      [632, 640, 88, 550, 'BTNS'],
    ];
    ctx.save();
    for (const [x, y, w, h, label] of zones) {
      ctx.fillStyle = 'rgba(255,40,80,0.18)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(255,40,80,0.8)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      txt(ctx, label, x + w / 2, y + 16, 8, '#ff8aa8', { outline: 0 });
    }
    ctx.restore();
  }
}
