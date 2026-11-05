// npm run check
// 1) unit tests for the event normalizer (gift streak math)
// 2) a fast-forward headless battle driven by the mock crowd, asserting the
//    game rules hold (no NaN, execution gate never skipped, rounds finish)
// Runs in plain Node: the battle logic has no DOM dependency outside drawing.
import assert from 'node:assert/strict';
import { createNormalizer } from '../public/js/shared/normalizer.js';
import { DEFAULT_WEIGHTS } from '../public/js/shared/defaults.js';
import { clone, deepMerge, setPath, getPath } from '../public/js/shared/objpath.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log('  ok  ' + name);
};

console.log('normalizer');
test('streak gifts emit only new gifts, end marker has delta 0', () => {
  const n = createNormalizer();
  const user = { userId: '1', displayId: 'kat', nickname: 'Kat' };
  const g = (rc, end) => n.normalize('gift', { user, giftId: '5655', repeatCount: rc, repeatEnd: end ? 1 : 0, groupId: 'g1', gift: { name: 'Rose', diamondCount: 1, type: 1 } });
  const a = g(1, false);
  assert.equal(a.delta, 1);
  assert.equal(g(1, false), null, 'duplicate in-progress event is ignored');
  const c = g(4, false);
  assert.equal(c.delta, 3);
  assert.equal(c.total, 4);
  const end = g(4, true);
  assert.equal(end.delta, 0);
  assert.equal(end.end, true);
  assert.equal(end.total, 4);
});
test('single streakable gift (sent once) counts once', () => {
  const n = createNormalizer();
  const user = { userId: '2', displayId: 'z' };
  const first = n.normalize('gift', { user, giftId: '1', repeatCount: 1, repeatEnd: false, groupId: 'x', gift: { name: 'Rose', diamondCount: 1, type: 1 } });
  const last = n.normalize('gift', { user, giftId: '1', repeatCount: 1, repeatEnd: true, groupId: 'x', gift: { name: 'Rose', diamondCount: 1, type: 1 } });
  assert.equal(first.delta + last.delta, 1);
});
test('joining mid-streak counts the whole streak once', () => {
  const n = createNormalizer();
  const e = n.normalize('gift', { user: { userId: '3' }, giftId: '1', repeatCount: 12, repeatEnd: true, groupId: 'q', gift: { name: 'Rose', diamondCount: 1, type: 1 } });
  assert.equal(e.delta, 12);
});
test('non-streak gifts use repeatCount once', () => {
  const n = createNormalizer();
  const e = n.normalize('gift', { user: { userId: '4' }, giftId: '9', repeatCount: 1, repeatEnd: true, gift: { name: 'Galaxy', diamondCount: 1000, type: 2 } });
  assert.equal(e.delta, 1);
  assert.equal(e.gift.coins, 1000);
  assert.equal(e.gift.streakable, false);
});
test('user fields: displayId, avatar, identity flags', () => {
  const n = createNormalizer();
  const e = n.normalize('chat', { content: 'a', user: { userId: '7', displayId: 'neo', nickname: 'Neo', avatarThumb: { urlList: ['https://p16-sign.tiktokcdn-us.com/x.webp'] } }, userIdentity: { isModeratorOfAnchor: true } });
  assert.equal(e.user.uid, 'neo');
  assert.equal(e.user.name, 'Neo');
  assert.equal(e.user.isMod, true);
  assert.match(e.user.avatar, /tiktokcdn/);
  assert.equal(e.text, 'a');
});
test('README-style field names are accepted too', () => {
  const n = createNormalizer();
  const e = n.normalize('chat', { comment: 'b', user: { uniqueId: 'old', profilePictureUrl: 'https://x.tiktokcdn.com/a.jpg' } });
  assert.equal(e.user.uid, 'old');
  assert.equal(e.text, 'b');
});
test('setPath refuses prototype keys', () => {
  const o = {};
  assert.equal(setPath(o, '__proto__.x', 1), false);
  assert.equal({}.x, undefined);
  setPath(o, 'a.b', 2);
  assert.equal(getPath(o, 'a.b'), 2);
});

// ------------------------------------------------------ headless simulation
console.log('\nheadless battle (fast-forward)');
const timers = [];
let now = 0;
let seq = 0;
globalThis.setTimeout = (fn, ms = 0) => {
  const t = { id: ++seq, at: now + ms, fn };
  timers.push(t);
  return t.id;
};
globalThis.clearTimeout = (id) => {
  const i = timers.findIndex((t) => t.id === id);
  if (i >= 0) timers.splice(i, 1);
};
globalThis.setInterval = (fn, ms) => {
  const id = ++seq;
  const tick = () => {
    fn();
    const t = { id, at: now + ms, fn: tick };
    timers.push(t);
  };
  timers.push({ id, at: now + ms, fn: tick });
  return id;
};
globalThis.clearInterval = (id) => {
  for (let i = timers.length - 1; i >= 0; i--) if (timers[i].id === id) timers.splice(i, 1);
};
globalThis.performance = globalThis.performance || { now: () => now };

const { MockDriver } = await import('../public/js/shared/mock.js');
const { FX } = await import('../public/js/fx.js');
const { Projectiles } = await import('../public/js/seekers.js');
const { Battle } = await import('../public/js/combat.js');
const { THEMES } = await import('../public/js/shared/defaults.js');

const weights = deepMerge(clone(DEFAULT_WEIGHTS), {});
const theme = THEMES['azure-inferno'];
const env = {
  weights: () => weights,
  theme: () => theme,
  fx: new FX(),
  proj: new Projectiles(),
  sfx: { play() {}, ready: false },
  voice: { say() {} },
  onHall: () => {},
};
const battle = new Battle(env);
const norm = createNormalizer();
let events = 0;
const mock = new MockDriver((kind, raw) => {
  const e = norm.normalize(kind, raw);
  if (e) {
    events++;
    battle.handle(e);
  }
});
mock.join('A', 6);
mock.join('B', 6);
mock.chaos('medium');

const step = 1 / 60;
const minutes = 20;
let rounds = 0;
let lastRound = battle.round;
let worstMs = 0;
let totalMs = 0;
let frames = 0;
let gateOpens = 0;
const wasGate = { A: false, B: false };
for (let f = 0; f < minutes * 60 * 60; f++) {
  now += step * 1000;
  timers.sort((a, b) => a.at - b.at);
  while (timers.length && timers[0].at <= now) timers.shift().fn();
  const t0 = process.hrtime.bigint();
  battle.update(step);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  totalMs += ms;
  frames++;
  if (ms > worstMs) worstMs = ms;
  if (battle.round !== lastRound) {
    rounds++;
    lastRound = battle.round;
  }
  for (const k of ['A', 'B']) {
    const t = battle.teams[k];
    const c = t.core;
    assert.ok(Number.isFinite(c.hp), `core ${k} hp is not finite`);
    for (const u of t.units) assert.ok(Number.isFinite(u.hp) && Number.isFinite(u.x) && Number.isFinite(u.y), `unit ${u.name} has NaN`);
    if (battle.phase === 'battle' && !t.executing) {
      const gateHp = (c.max * weights.execution.gatePct) / 100;
      if (t.gate.active) assert.ok(c.hp >= 1, `core ${k} died inside the gate without an execution`);
      else assert.ok(c.hp >= gateHp - 1e-6, `core ${k} fell below the gate (${c.hp}) without opening it`);
    }
    if (t.gate.active && !wasGate[k]) gateOpens++;
    wasGate[k] = t.gate.active;
  }
  assert.ok(env.proj.list.length <= weights.seekers.maxActive);
  assert.ok(env.fx.p.length <= env.fx.max);
}
mock.stop();
console.log(`  ok  ${minutes} simulated minutes, ${events} events, ${rounds} rounds finished, ${gateOpens} execution gates opened`);
console.log(`  ok  battle.update: avg ${(totalMs / frames).toFixed(3)} ms, worst ${worstMs.toFixed(2)} ms per frame (budget at 60 fps: 16.7 ms)`);
assert.ok(rounds >= 1, 'expected at least one finished round');
passed += 2;
console.log(`\n${passed} checks passed`);
