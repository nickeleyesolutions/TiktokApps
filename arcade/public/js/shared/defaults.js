// Default "weights" (every tunable number in the game) plus the slider schema
// the director panel builds itself from. The server seeds config/weights.json
// from this file; the stage uses it directly in offline demo mode.
//
// Rule: if a number changes how the game plays or looks, it lives here,
// so it can be tuned live without touching code.

export const RESOLUTIONS = ['auto', 720, 1080, 1440, 2160];

export const THEMES = {
  'azure-inferno': { label: 'Azure vs Inferno', A: { name: 'AZURE', c1: '#3ae4ff', c2: '#2a5cff' }, B: { name: 'INFERNO', c1: '#ff3d5e', c2: '#ff9d1c' } },
  'heaven-hell': { label: 'Heaven vs Hell', A: { name: 'HEAVEN', c1: '#ffe37a', c2: '#7fd8ff' }, B: { name: 'HELL', c1: '#ff2a2a', c2: '#8b10ff' } },
  'red-blue': { label: 'Blue vs Red', A: { name: 'BLUE', c1: '#4aa8ff', c2: '#1f3dff' }, B: { name: 'RED', c1: '#ff4848', c2: '#ff1f8e' } },
  'cats-dogs': { label: 'Cats vs Dogs', A: { name: 'CATS', c1: '#ff7ae0', c2: '#9b5cff' }, B: { name: 'DOGS', c1: '#7dff6a', c2: '#18c4a0' } },
  'synth-acid': { label: 'Synth vs Acid', A: { name: 'SYNTH', c1: '#c77dff', c2: '#5a18ff' }, B: { name: 'ACID', c1: '#c6ff3a', c2: '#2dffb0' } },
};

export const DEFAULT_WEIGHTS = {
  render: {
    // Canvas render height class: 'auto' matches the browser/OBS source size.
    // 720 = 720x1280, 1080 = 1080x1920, 1440 = 1440x2560 (supersample), 2160 = 4K portrait.
    resolution: 'auto',
    fps: 60,
  },
  theme: 'azure-inferno',
  teamNames: { A: '', B: '' }, // optional overrides for the theme's names
  post: {
    enabled: true,
    bloom: 0.6,
    scanlines: 0.16,
    scanlinePitch: 4, // in design px (1 = one pixel of a 720p stream). Keep >= 3 so the encoder does not smear it.
    aberration: 0.35,
    vignette: 0.55,
    curvature: 0,
    pixelate: 0, // 0 = off, else virtual pixel size in design px (2-4 = neo-pixel look)
    hitGlitch: 0.6,
  },
  backdrop: {
    asset: '', // file name in public/assets (jpg/png/webp/mp4/webm). Empty = procedural.
    dim: 0.55,
    gridOverImage: 0.45,
    gridSpeed: 1,
    skyline: true,
  },
  atb: { baseSeconds: 4, hastePerStack: 0.04, lungeTime: 0.22 },
  combat: {
    coreHp: 6000,
    unitHp: 30,
    unitDamage: 6,
    coreFocus: 0.5, // share of unit attacks aimed at the enemy core instead of enemy units
    boltSpeed: 1500,
    maxSlots: 12,
    respawnCooldown: 3,
  },
  seekers: { speed: 900, turn: 7, ignition: 0.18, damage: 4, maxActive: 700, smoke: true },
  stacks: { max: 99, decaySeconds: 4, braveryPerStack: 0.05, barrageMax: 8, barrageEvery: 1.6 },
  stagger: { fillPerCorePct: 4, likeFill: 0.02, durationSeconds: 20, damageMul: 3, immuneSeconds: 6 },
  mana: { likesPerCast: 500, meteors: 8, meteorDamage: 45 },
  limit: { fillPerCorePct: 2.5, comboFill: 12, readySeconds: 15, triggerTier: 2, damagePct: 12, hits: 12 },
  execution: {
    gatePct: 5,
    windowSeconds: 30,
    finisherTier: 4,
    minTier: 2, // each Second Wind lowers the finisher requirement by one tier, down to this
    secondWindPct: 20,
    maxSecondWinds: 2, // after this many, the gate collapses on its own when the timer runs out
    reviveHpPct: 40,
  },
  gifts: {
    // damage per gift = count * powerScale * coins^exponent (sublinear so big gifts stay strong without one-shotting everything)
    powerScale: 12,
    exponent: 0.8,
    tier2: 10, // coin thresholds for tiers 2/3/4 (tier 1 is everything below tier2)
    tier3: 100,
    tier4: 1000,
    comboThresholds: [10, 25, 50, 99],
    happyHourMul: 2,
    happyHourSeconds: 60,
    eliteSeconds: 30,
    overrides: {}, // e.g. { "Rose": 1, "Galaxy": 4 } forces a gift name into a tier
  },
  npc: { enabled: true, minA: 3, minB: 6, checkSeconds: 3, perCheck: 2, hp: 14, damage: 4 },
  chat: { joinA: ['a', '1', 'left'], joinB: ['b', '2', 'right'], allowSwitch: false, rallyCooldown: 2 },
  boss: { hp: 1800, seconds: 60, fireEvery: 2.2 },
  guide: { enabled: true, everySeconds: 12, showSeconds: 4 },
  round: { intermissionSeconds: 8 },
  audio: { master: 0.6, tts: true, ttsMinGapSeconds: 3 },
  hud: { safeZones: false, feed: true, damageNumbers: true, names: true },
  owners: { usernames: [], allowModerators: true, trustAnchor: true, prefix: '!' },
  dev: { autoHotReload: false },
};

// Slider/toggle schema for the director. type: range | toggle | select
export const SCHEMA = [
  { group: 'Look', path: 'post.enabled', label: 'Post FX (CRT/bloom)', type: 'toggle' },
  { group: 'Look', path: 'post.bloom', label: 'Bloom', min: 0, max: 1.5, step: 0.05 },
  { group: 'Look', path: 'post.scanlines', label: 'Scanlines', min: 0, max: 0.6, step: 0.02 },
  { group: 'Look', path: 'post.scanlinePitch', label: 'Scanline pitch', min: 2, max: 8, step: 1 },
  { group: 'Look', path: 'post.aberration', label: 'Chromatic aberration', min: 0, max: 1.5, step: 0.05 },
  { group: 'Look', path: 'post.vignette', label: 'Vignette', min: 0, max: 1, step: 0.05 },
  { group: 'Look', path: 'post.curvature', label: 'CRT curvature', min: 0, max: 1, step: 0.05 },
  { group: 'Look', path: 'post.pixelate', label: 'Pixelate (0 = off)', min: 0, max: 6, step: 1 },
  { group: 'Look', path: 'post.hitGlitch', label: 'Glitch on big hits', min: 0, max: 1.5, step: 0.05 },
  { group: 'Look', path: 'backdrop.dim', label: 'Backdrop image dim', min: 0, max: 0.95, step: 0.05 },
  { group: 'Look', path: 'backdrop.gridOverImage', label: 'Grid over image', min: 0, max: 1, step: 0.05 },
  { group: 'Look', path: 'backdrop.gridSpeed', label: 'Grid speed', min: 0, max: 4, step: 0.1 },
  { group: 'Look', path: 'backdrop.skyline', label: 'Pixel skyline', type: 'toggle' },
  { group: 'Look', path: 'hud.safeZones', label: 'Show TikTok UI zones (approx.)', type: 'toggle' },
  { group: 'Look', path: 'hud.damageNumbers', label: 'Damage numbers', type: 'toggle' },
  { group: 'Look', path: 'hud.names', label: 'Name labels', type: 'toggle' },

  { group: 'Cadence', path: 'atb.baseSeconds', label: 'ATB fill time (s)', min: 1, max: 10, step: 0.1 },
  { group: 'Cadence', path: 'atb.hastePerStack', label: 'Haste per stack', min: 0, max: 0.15, step: 0.005 },
  { group: 'Cadence', path: 'combat.coreHp', label: 'Core HP', min: 1000, max: 40000, step: 500 },
  { group: 'Cadence', path: 'combat.unitHp', label: 'Unit HP', min: 5, max: 200, step: 1 },
  { group: 'Cadence', path: 'combat.unitDamage', label: 'Unit attack damage', min: 1, max: 60, step: 1 },
  { group: 'Cadence', path: 'combat.coreFocus', label: 'Core focus (vs units)', min: 0, max: 1, step: 0.05 },
  { group: 'Cadence', path: 'combat.maxSlots', label: 'Party slots per side', min: 2, max: 12, step: 1 },
  { group: 'Cadence', path: 'stacks.decaySeconds', label: 'Stack decay (s)', min: 1, max: 20, step: 0.5 },
  { group: 'Cadence', path: 'stacks.braveryPerStack', label: 'Bravery dmg per stack', min: 0, max: 0.2, step: 0.01 },

  { group: 'Seekers', path: 'seekers.speed', label: 'Seeker speed', min: 200, max: 2000, step: 25 },
  { group: 'Seekers', path: 'seekers.turn', label: 'Seeker turn rate', min: 1, max: 20, step: 0.5 },
  { group: 'Seekers', path: 'seekers.ignition', label: 'Ignition delay (s)', min: 0, max: 0.8, step: 0.02 },
  { group: 'Seekers', path: 'seekers.damage', label: 'Barrage seeker damage', min: 1, max: 40, step: 1 },
  { group: 'Seekers', path: 'seekers.maxActive', label: 'Max seekers on screen', min: 50, max: 2000, step: 50 },
  { group: 'Seekers', path: 'seekers.smoke', label: 'Smoke trails', type: 'toggle' },
  { group: 'Seekers', path: 'stacks.barrageMax', label: 'Barrage volley cap', min: 1, max: 20, step: 1 },

  { group: 'Gifts', path: 'gifts.powerScale', label: 'Gift power scale', min: 1, max: 60, step: 1 },
  { group: 'Gifts', path: 'gifts.exponent', label: 'Gift power curve', min: 0.5, max: 1, step: 0.01 },
  { group: 'Gifts', path: 'gifts.tier2', label: 'Tier 2 at (coins)', min: 2, max: 99, step: 1 },
  { group: 'Gifts', path: 'gifts.tier3', label: 'Tier 3 at (coins)', min: 50, max: 999, step: 1 },
  { group: 'Gifts', path: 'gifts.tier4', label: 'Tier 4 at (coins)', min: 200, max: 30000, step: 50 },
  { group: 'Gifts', path: 'gifts.happyHourMul', label: 'Happy hour multiplier', min: 1, max: 5, step: 0.5 },
  { group: 'Gifts', path: 'gifts.eliteSeconds', label: 'Surge elite time (s)', min: 5, max: 120, step: 5 },
  { group: 'Gifts', path: 'mana.likesPerCast', label: 'Likes per meteor cast', min: 50, max: 5000, step: 50 },

  { group: 'Stagger & Limit', path: 'stagger.fillPerCorePct', label: 'Stagger fill per 1% core dmg', min: 0, max: 20, step: 0.5 },
  { group: 'Stagger & Limit', path: 'stagger.likeFill', label: 'Stagger fill per enemy like', min: 0, max: 0.5, step: 0.01 },
  { group: 'Stagger & Limit', path: 'stagger.durationSeconds', label: 'Stagger time (s)', min: 3, max: 60, step: 1 },
  { group: 'Stagger & Limit', path: 'stagger.damageMul', label: 'Stagger damage x', min: 1, max: 6, step: 0.25 },
  { group: 'Stagger & Limit', path: 'limit.fillPerCorePct', label: 'Limit fill per 1% core dmg', min: 0, max: 20, step: 0.5 },
  { group: 'Stagger & Limit', path: 'limit.readySeconds', label: 'Limit ready window (s)', min: 5, max: 60, step: 1 },
  { group: 'Stagger & Limit', path: 'limit.triggerTier', label: 'Limit trigger gift tier', min: 1, max: 4, step: 1 },
  { group: 'Stagger & Limit', path: 'limit.damagePct', label: 'Limit dmg (% enemy core)', min: 1, max: 40, step: 1 },

  { group: 'Execution gate', path: 'execution.gatePct', label: 'Gate opens at HP %', min: 1, max: 25, step: 1 },
  { group: 'Execution gate', path: 'execution.windowSeconds', label: 'Window (s)', min: 5, max: 90, step: 1 },
  { group: 'Execution gate', path: 'execution.finisherTier', label: 'Finisher gift tier', min: 2, max: 4, step: 1 },
  { group: 'Execution gate', path: 'execution.secondWindPct', label: 'Second wind heal %', min: 5, max: 60, step: 1 },
  { group: 'Execution gate', path: 'execution.maxSecondWinds', label: 'Max second winds', min: 0, max: 6, step: 1 },
  { group: 'Execution gate', path: 'execution.reviveHpPct', label: 'Defender revive %', min: 10, max: 80, step: 1 },

  { group: 'Devil side NPCs', path: 'npc.enabled', label: 'Auto-spawner on', type: 'toggle' },
  { group: 'Devil side NPCs', path: 'npc.minA', label: 'Min units left side', min: 0, max: 12, step: 1 },
  { group: 'Devil side NPCs', path: 'npc.minB', label: 'Min units right side', min: 0, max: 12, step: 1 },
  { group: 'Devil side NPCs', path: 'npc.checkSeconds', label: 'Check every (s)', min: 1, max: 15, step: 0.5 },
  { group: 'Devil side NPCs', path: 'npc.perCheck', label: 'Spawn per check', min: 1, max: 6, step: 1 },
  { group: 'Devil side NPCs', path: 'npc.hp', label: 'NPC HP', min: 2, max: 100, step: 1 },

  { group: 'Stream', path: 'guide.enabled', label: 'Transient gift guide', type: 'toggle' },
  { group: 'Stream', path: 'guide.everySeconds', label: 'Guide every (s)', min: 6, max: 60, step: 1 },
  { group: 'Stream', path: 'guide.showSeconds', label: 'Guide visible (s)', min: 2, max: 10, step: 1 },
  { group: 'Stream', path: 'audio.master', label: 'Volume', min: 0, max: 1, step: 0.05 },
  { group: 'Stream', path: 'audio.tts', label: 'TTS announcer', type: 'toggle' },
  { group: 'Stream', path: 'round.intermissionSeconds', label: 'Victory screen (s)', min: 3, max: 30, step: 1 },
  { group: 'Stream', path: 'dev.autoHotReload', label: 'Auto hot-reload on code edit', type: 'toggle' },
];
