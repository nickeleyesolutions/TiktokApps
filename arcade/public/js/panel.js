// Control panel UI shared by /director (phone/laptop, via Socket.IO) and the
// in-stage drawer (press ~ or the gear; used by the offline demo).
// It only talks to an `api` object, so it does not care where events go.
//
// api = {
//   weights(): object, patch(path, value), mock({kind, team, gift, n}),
//   cmd({type, team}), chaos(level), assets(): Promise<string[]>,
//   enableAudio?(), resetWeights?()
// }
import { SCHEMA, THEMES, RESOLUTIONS } from './shared/defaults.js';
import { MOCK_GIFTS } from './shared/mock.js';
import { getPath } from './shared/objpath.js';

const CSS = `
.ap{--bg:#0b0a16;--card:#14122a;--line:#2a2650;--txt:#ecebff;--dim:#9c98c8;--a:#3ae4ff;--b:#ff3d5e;--gold:#ffd34a;
  font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--txt);background:var(--bg);}
.ap *{box-sizing:border-box}
.ap h3{font:600 11px/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin:14px 0 8px}
.ap .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 10px 12px;margin:0 0 10px}
.ap .row{display:flex;flex-wrap:wrap;gap:6px}
.ap button{appearance:none;border:1px solid var(--line);background:#1d1a3a;color:var(--txt);border-radius:8px;padding:9px 10px;
  font:600 12px/1.1 system-ui,sans-serif;cursor:pointer;min-height:38px;flex:1 1 auto;touch-action:manipulation}
.ap button:active{transform:translateY(1px)}
.ap button.a{border-color:rgba(58,228,255,.5);color:#bff6ff}
.ap button.b{border-color:rgba(255,61,94,.5);color:#ffc7d1}
.ap button.g{border-color:rgba(255,211,74,.55);color:#fff1c2}
.ap button.on{background:#2d2860;border-color:#8a84ff}
.ap .seg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.ap .seg button{border:0;border-radius:0;flex:1}
.ap details{border-top:1px solid var(--line);padding:6px 0}
.ap summary{cursor:pointer;font-weight:600;padding:6px 0;color:var(--txt)}
.ap label.rng{display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:center;margin:8px 0}
.ap label.rng input{grid-column:1/3;width:100%}
.ap output{font:12px ui-monospace,Menlo,monospace;color:var(--gold)}
.ap label.tg{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0}
.ap select,.ap input[type=text]{width:100%;background:#0f0d22;color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:8px}
.ap .grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.ap .note{color:var(--dim);font-size:12px;margin:6px 0 0}
`;

function el(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of [].concat(kids)) if (k) e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
  return e;
}

export function buildPanel(root, api) {
  if (!document.getElementById('ap-css')) document.head.appendChild(el('style', { id: 'ap-css', text: CSS }));
  root.classList.add('ap');
  root.innerHTML = '';
  const controls = [];
  let giftTeam = 'A';

  const btn = (label, fn, cls = '') => el('button', { class: cls, type: 'button', onclick: fn, text: label });
  const card = (title, kids) => {
    root.appendChild(el('h3', { text: title }));
    root.appendChild(el('div', { class: 'card' }, kids));
  };

  // --- test bench
  const teamSeg = el('div', { class: 'seg' });
  const teamBtns = ['A', 'B', 'ANY'].map((t) =>
    btn(t === 'ANY' ? 'Any (auto-assign)' : `Team ${t}`, () => {
      giftTeam = t === 'ANY' ? null : t;
      teamBtns.forEach((b, i) => b.classList.toggle('on', ['A', 'B', 'ANY'][i] === t));
    }, t === 'A' ? 'a on' : t === 'B' ? 'b' : '')
  );
  teamBtns.forEach((b) => teamSeg.appendChild(b));
  const gifts = el('div', { class: 'grid2' });
  for (const g of MOCK_GIFTS) {
    gifts.appendChild(btn(`${g.name} (${g.coins.toLocaleString('en-US')})`, () => api.mock({ kind: 'gift', gift: g.key, team: giftTeam, n: 1 }), g.coins >= 1000 ? 'g' : ''));
    if (g.key === 'rose') gifts.appendChild(btn('Rose x25 streak', () => api.mock({ kind: 'gift', gift: 'rose', team: giftTeam, n: 25 }), 'g'));
    if (g.key === 'finger') gifts.appendChild(btn('Finger Heart x10', () => api.mock({ kind: 'gift', gift: 'finger', team: giftTeam, n: 10 })));
  }
  card('Test bench', [
    el('div', { class: 'row' }, [
      btn('Join A x1', () => api.mock({ kind: 'join', team: 'A', n: 1 }), 'a'),
      btn('Join A x10', () => api.mock({ kind: 'join', team: 'A', n: 10 }), 'a'),
      btn('Join B x1', () => api.mock({ kind: 'join', team: 'B', n: 1 }), 'b'),
      btn('Join B x10', () => api.mock({ kind: 'join', team: 'B', n: 10 }), 'b'),
      btn('Subscriber joins A', () => api.mock({ kind: 'subjoin', team: 'A', n: 1 }), 'a'),
      btn('Subscriber joins B', () => api.mock({ kind: 'subjoin', team: 'B', n: 1 }), 'b'),
    ]),
    el('p', { class: 'note', text: 'Likes, shares and gifts below come from:' }),
    teamSeg,
    el('div', { class: 'row', style: 'margin-top:6px' }, [
      btn('+100 likes', () => api.mock({ kind: 'likes', team: giftTeam, n: 100 })),
      btn('+500 likes', () => api.mock({ kind: 'likes', team: giftTeam, n: 500 })),
      btn('Share', () => api.mock({ kind: 'share', team: giftTeam })),
      btn('Follow', () => api.mock({ kind: 'follow', team: giftTeam })),
    ]),
    el('p', { class: 'note', text: 'Gifts (coin values approximate, simulation only):' }),
    gifts,
  ]);

  // --- crowd
  const chaosSeg = el('div', { class: 'seg' });
  const chaosBtns = [
    ['off', 'Off'],
    ['low', 'Low 10'],
    ['medium', 'Med 100'],
    ['extreme', 'Max 1000'],
  ].map(([lvl, label]) =>
    btn(label, () => {
      api.chaos(lvl);
      setChaos(lvl);
    })
  );
  chaosBtns.forEach((b) => chaosSeg.appendChild(b));
  const setChaos = (lvl) => chaosBtns.forEach((b, i) => b.classList.toggle('on', ['off', 'low', 'medium', 'extreme'][i] === lvl));
  setChaos('off');
  card('Crowd simulator', [chaosSeg, el('p', { class: 'note', text: 'Fake viewers join, tap likes, chat and gift on their own.' })]);

  // --- director
  const pair = (label, type) => [btn(`${label} A`, () => api.cmd({ type, team: 'A' }), 'a'), btn(`${label} B`, () => api.cmd({ type, team: 'B' }), 'b')];
  card('Director', [
    el('div', { class: 'grid2' }, [
      ...pair('Stagger', 'forceStagger'),
      ...pair('Limit ready', 'fillLimit'),
      ...pair('Exec gate', 'forceGate'),
      ...pair('Meteor', 'meteor'),
      ...pair('Heal', 'heal'),
      btn('Whale finisher test', () => {
        api.cmd({ type: 'forceGate', team: 'B' });
        setTimeout(() => api.mock({ kind: 'gift', gift: 'galaxy', team: 'A', n: 1 }), 1500);
      }, 'g'),
      btn('Randonaut: attractor', () => api.cmd({ type: 'randonaut', kind: 'attractor' })),
      btn('Randonaut: void', () => api.cmd({ type: 'randonaut', kind: 'void' })),
      btn('Randonaut: anomaly', () => api.cmd({ type: 'randonaut', kind: 'anomaly' })),
      btn('Chat votes FIRE x5', () => { for (let i = 0; i < 5; i++) api.mock({ kind: 'chat', team: null, text: 'fire' }); }),
      btn('Rift: like storm', () => api.cmd({ type: 'openRift', kind: 'like' })),
      btn('Rift: gift rush', () => api.cmd({ type: 'openRift', kind: 'gift' })),
      btn('Rift: unity call', () => api.cmd({ type: 'openRift', kind: 'chat' })),
      btn('Rift: coin surge', () => api.cmd({ type: 'openRift', kind: 'coin' })),
      btn('Dimension +1', () => api.cmd({ type: 'ascend', delta: 1 }), 'g'),
      btn('Dimension -1', () => api.cmd({ type: 'ascend', delta: -1 })),
      btn('Orbital strike test', () => api.mock({ kind: 'gift', gift: 'lion', team: 'A', n: 1 }), 'g'),
      btn('Underdog test', () => {
        api.cmd({ type: 'heal', team: 'B' });
        api.cmd({ type: 'setHp', team: 'A', pct: 40 });
      }),
      btn('Phoenix revive test', () => {
        api.cmd({ type: 'forceGate', team: 'B' });
        setTimeout(() => api.mock({ kind: 'gift', gift: 'galaxy', team: 'B', n: 1 }), 1500);
      }, 'g'),
      btn('Happy hour 2x', () => api.cmd({ type: 'happyHour' })),
      btn('Boss invasion', () => api.cmd({ type: 'boss' })),
      btn('Crowd vote now', () => api.cmd({ type: 'poll' })),
      btn('Reset round', () => api.cmd({ type: 'resetRound' })),
      btn('Hot reload stage', () => api.cmd({ type: 'hotReload' })),
    ]),
    el('p', { class: 'note', text: 'Hot reload keeps the match (HP, roster, stacks) and loads new code.' }),
  ]);

  // --- look
  const resSel = el('select', {}, RESOLUTIONS.map((r) => el('option', { value: String(r), text: r === 'auto' ? 'Auto (match OBS source)' : `${r} x ${Math.round((r * 16) / 9)}${r > 1080 ? ' (supersample)' : ''}` })));
  resSel.addEventListener('change', () => api.patch('render.resolution', resSel.value === 'auto' ? 'auto' : Number(resSel.value)));
  controls.push({ path: 'render.resolution', set: (v) => (resSel.value = String(v)) });
  const fpsSel = el('select', {}, [el('option', { value: '60', text: '60 fps' }), el('option', { value: '30', text: '30 fps' })]);
  fpsSel.addEventListener('change', () => api.patch('render.fps', Number(fpsSel.value)));
  controls.push({ path: 'render.fps', set: (v) => (fpsSel.value = String(v)) });
  const themeSel = el('select', {}, Object.entries(THEMES).map(([id, t]) => el('option', { value: id, text: t.label })));
  themeSel.addEventListener('change', () => api.patch('theme', themeSel.value));
  controls.push({ path: 'theme', set: (v) => (themeSel.value = v) });
  const bgSel = el('select', {}, [el('option', { value: '', text: 'Procedural synthwave' })]);
  bgSel.addEventListener('change', () => api.patch('backdrop.asset', bgSel.value));
  controls.push({ path: 'backdrop.asset', set: (v) => (bgSel.value = v || '') });
  const isAudio = (f) => /\.(mp3|m4a|aac|ogg|oga|wav)$/i.test(f);
  const trackSel = el('select', {}, [el('option', { value: '', text: 'Soundtrack: none (built-in chiptune)' })]);
  trackSel.addEventListener('change', () => api.patch('audio.soundtrack', trackSel.value));
  controls.push({ path: 'audio.soundtrack', set: (v) => (trackSel.value = v || '') });
  const loadAssets = () => {
    if (!api.assets) return;
    api.assets().then((list) => {
      for (const sel of [bgSel, trackSel]) while (sel.options.length > 1) sel.remove(1);
      for (const f of list) (isAudio(f) ? trackSel : bgSel).appendChild(el('option', { value: f, text: isAudio(f) ? `Soundtrack: ${f}` : f }));
      bgSel.value = getPath(api.weights(), 'backdrop.asset') || '';
      trackSel.value = getPath(api.weights(), 'audio.soundtrack') || '';
    });
  };
  loadAssets();
  const nameIn = (k) => {
    const i = el('input', { type: 'text', placeholder: `Team ${k} name (theme default)`, maxlength: '14' });
    i.addEventListener('change', () => api.patch(`teamNames.${k}`, i.value.trim()));
    controls.push({ path: `teamNames.${k}`, set: (v) => (i.value = v || '') });
    return i;
  };
  const lookKids = [
    el('div', { class: 'grid2' }, [resSel, fpsSel]),
    el('div', { style: 'height:6px' }),
    themeSel,
    el('div', { style: 'height:6px' }),
    bgSel,
    el('div', { style: 'height:6px' }),
    trackSel,
    el('p', { class: 'note', text: 'Drop jpg/png/webp/mp4/webm files in public/assets to list them here.' }),
    el('div', { class: 'grid2', style: 'margin-top:6px' }, [nameIn('A'), nameIn('B')]),
  ];
  if (api.enableAudio) lookKids.push(el('div', { class: 'row', style: 'margin-top:8px' }, [btn('Enable sound', () => api.enableAudio())]));
  card('Look', lookKids);

  // --- tuning groups from the schema
  root.appendChild(el('h3', { text: 'Live weights' }));
  const tune = el('div', { class: 'card' });
  root.appendChild(tune);
  const groups = new Map();
  for (const s of SCHEMA) {
    if (!groups.has(s.group)) {
      const d = el('details', {}, [el('summary', { text: s.group })]);
      if (s.group === 'Look') d.open = true;
      groups.set(s.group, d);
      tune.appendChild(d);
    }
    const box = groups.get(s.group);
    if (s.type === 'toggle') {
      const cb = el('input', { type: 'checkbox' });
      cb.addEventListener('change', () => api.patch(s.path, cb.checked));
      box.appendChild(el('label', { class: 'tg' }, [s.label, cb]));
      controls.push({ path: s.path, set: (v) => (cb.checked = !!v) });
    } else if (s.type === 'select') {
      const sel = el('select', {}, s.options.map((o) => el('option', { value: o, text: o })));
      sel.addEventListener('change', () => api.patch(s.path, sel.value));
      box.appendChild(el('label', { class: 'rng' }, [s.label, sel]));
      controls.push({ path: s.path, set: (v) => (sel.value = String(v)) });
    } else {
      const out = el('output');
      const r = el('input', { type: 'range', min: s.min, max: s.max, step: s.step });
      let pending = null;
      r.addEventListener('input', () => {
        out.textContent = r.value;
        clearTimeout(pending);
        pending = setTimeout(() => api.patch(s.path, Number(r.value)), 50);
      });
      box.appendChild(el('label', { class: 'rng' }, [s.label, out, r]));
      controls.push({
        path: s.path,
        set: (v) => {
          if (document.activeElement === r) return;
          r.value = v;
          out.textContent = v;
        },
      });
    }
  }
  if (api.resetWeights) tune.appendChild(el('div', { class: 'row', style: 'margin-top:8px' }, [btn('Reset all weights to defaults', () => confirm('Reset every weight to its default?') && api.resetWeights())]));

  function refresh(w) {
    for (const c of controls) {
      const v = getPath(w, c.path);
      if (v !== undefined) c.set(v);
    }
  }
  refresh(api.weights());
  return { refresh, setChaos, loadAssets };
}
