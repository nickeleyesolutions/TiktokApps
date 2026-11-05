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
import { UNIT_R, ELITE_R, commanderPos } from './combat.js';
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
  }

  draw(ctx, b, o) {
    const { theme, w, time, dt, hall, demo } = o;
    ctx.save();
    ctx.translate(b.shakeX * 0.35, b.shakeY * 0.35);
    this.drawHall(ctx, hall, dt);
    this.drawPlates(ctx, b, theme, time);
    this.drawBars(ctx, b, theme, w, time);
    this.drawStacks(ctx, b, theme);
    if (w.hud.names) this.drawNames(ctx, b, time);
    this.drawCommanderLabels(ctx, b);
    b.fx.drawTexts(ctx, PIX);
    this.drawGates(ctx, b, w, time);
    this.drawTopPills(ctx, b, w, time);
    this.drawFeedOrGuide(ctx, b, theme, w, time);
    this.drawBanners(ctx, b, time);
    if (b.cine) this.drawCine(ctx, b, theme, time);
    if (b.phase === 'victory' && !b.cine) this.drawVictory(ctx, b, theme, o.S, time);
    ctx.restore();
    if (w.hud.safeZones) this.drawSafeZones(ctx);
    if (demo) txt(ctx, 'OFFLINE DEMO  ~ OR GEAR = DIRECTOR', W / 2, H - 18, 9, 'rgba(255,255,255,0.45)', { outline: 0 });
  }

  drawHall(ctx, hall, dt) {
    const y = 96;
    const h = 26;
    ctx.fillStyle = 'rgba(6,4,16,0.72)';
    ctx.fillRect(0, y, W, h);
    ctx.fillStyle = 'rgba(255,211,74,0.7)';
    ctx.fillRect(0, y, W, 2);
    ctx.fillRect(0, y + h - 2, W, 2);
    let s;
    if (!hall || !hall.length) s = 'HALL OF FAME  *  LAND THE FINAL BLOW TO GET CROWNED  *  ';
    else s = 'HALL OF FAME  *  ' + hall.slice(0, 8).map((e) => `R${e.round} ${cleanName(e.name, 14).toUpperCase()}`).join('  *  ') + '  *  ';
    const font = `11px ${PIX}`;
    const tw = textWidth(ctx, s, font);
    this.hallScroll = (this.hallScroll + dt * 50) % tw;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, W, h);
    ctx.clip();
    for (let x = -this.hallScroll; x < W; x += tw) TEXT.draw(ctx, s, x, y + h / 2 + 1, font, 11, '#ffd34a', 0, '', 'left');
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
    txt(ctx, 'VS', cx, cy - 4, 14, '#ffffff', { outline: 0 });
    txt(ctx, 'R' + b.round, cx, cy + 12, 8, '#ffd34a', { outline: 0 });
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
        txt(ctx, r.label, lx, yy + 4, 9, r.label === 'READY' || r.label === 'BRK!' ? '#ffffff' : 'rgba(255,255,255,0.75)', { align: right ? 'right' : 'left', outline: 0 });
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
      txt(ctx, label, ux + 16, y + 1, 10, '#ffffff', { align: 'left', outline: 3, live: true });
      x = right ? ux - 10 : ux + lw + 10;
      for (const [key, short, color] of defs) {
        const n = t.stacks[key];
        if (n <= 0) continue;
        const s = `${short}x${n}`;
        const bw = textWidth(ctx, s, `9px ${PIX}`) + 12;
        const bx = right ? x - bw : x;
        roundRectPath(ctx, bx, y - 8, bw, 17, 4);
        ctx.fillStyle = 'rgba(8,6,20,0.85)';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        txt(ctx, s, bx + bw / 2, y + 1, 9, color, { outline: 0, live: true });
        x = right ? bx - 6 : bx + bw + 6;
      }
      if (b.underdogMul(k) > 1) {
        const s = `UNDERDOG +${Math.round((b.w.underdog.mul - 1) * 100)}%`;
        const bw = textWidth(ctx, s, `9px ${PIX}`) + 12;
        const bx = right ? x - bw : x;
        roundRectPath(ctx, bx, y - 8, bw, 17, 4);
        ctx.fillStyle = 'rgba(125,255,154,0.18)';
        ctx.fill();
        ctx.strokeStyle = '#7dff9a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        txt(ctx, s, bx + bw / 2, y + 1, 9, '#7dff9a', { outline: 0 });
      }
    }
  }

  drawCommanderLabels(ctx, b) {
    for (const k of ['A', 'B']) {
      for (const c of b.commanders[k]) {
        const p = commanderPos(k, c.i);
        const r = c.i === 0 ? 20 : 16;
        txt(ctx, fmt(c.rec.coins), p.x, p.y + r + 9, 8, '#ffd34a', { outline: 3, live: true });
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
        txt(ctx, cleanName(u.name, 9).toUpperCase(), u.x, u.y + r + 20, 9, u.elite > 0 ? '#ffd34a' : '#ffffff', { outline: 3 });
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
      const s = fitText(ctx, f.text, 430, f.tier >= 3 ? 11 : 9);
      const tw = textWidth(ctx, s, `${f.tier >= 3 ? 11 : 9}px ${PIX}`) + 16;
      roundRectPath(ctx, W / 2 - tw / 2, y - 10, tw, 20, 6);
      ctx.fillStyle = 'rgba(6,4,16,0.7)';
      ctx.fill();
      txt(ctx, s, W / 2, y + 1, f.tier >= 3 ? 11 : 9, f.color, { outline: 0 });
      ctx.globalAlpha = 1;
      y += 22;
    }
  }

  drawBanners(ctx, b, time) {
    for (const bn of b.banners) {
      const p = bn.t / bn.dur;
      const sIn = easeOutBack(clamp(bn.t / 0.25, 0, 1));
      const a = clamp((bn.dur - bn.t) / 0.35, 0, 1);
      if (a <= 0) continue;
      const cx = bn.anchor === 'A' ? 190 : bn.anchor === 'B' ? W - 190 : W / 2;
      const cy = (bn.anchor === 'C' ? 650 : 378) - p * 10;
      const size = bn.small ? 26 : bn.anchor === 'C' ? 50 : 32;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(cx, cy);
      ctx.scale(sIn, sIn);
      const maxW = bn.anchor === 'C' ? 660 : 330;
      const t = fitText(ctx, bn.text, maxW, size, { orb: true });
      ctx.globalCompositeOperation = 'lighter';
      txt(ctx, t, 0, 0, size, bn.color, { orb: true, outline: size * 0.5, outlineColor: rgba(bn.color, 0.25) });
      ctx.globalCompositeOperation = 'source-over';
      txt(ctx, t, 0, 0, size, '#ffffff', { orb: true, outline: Math.max(3, size * 0.14), outlineColor: '#05030c' });
      ctx.globalAlpha = a * 0.92;
      txt(ctx, t, 0, 0, size, bn.color, { orb: true, outline: 0 });
      if (bn.sub) txt(ctx, fitText(ctx, bn.sub, maxW, 10), 0, size * 0.62 + 8, 10, '#ffffff', { outline: 3 });
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
