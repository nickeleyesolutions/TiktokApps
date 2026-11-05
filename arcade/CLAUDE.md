# Arcade Arena: notes for Claude Code

A neo-arcade, Final Fantasy ATB-style battle game for TikTok LIVE. Left team vs
right team. Viewers join by typing in chat, gifts launch homing seekers and
trigger big moments, and a whale-tier gift lands the final blow.

## Run

```bash
npm install
npm start                      # http://localhost:3000 (stage) and /director
npm run check                  # unit tests + 20 min headless battle simulation
npm run build:demo             # dist/arena-demo.html, single file, offline demo
node server.js --user NAME     # connect to a live room on start
node server.js --record        # write every event to recordings/*.jsonl
node server.js --replay recordings/FILE.jsonl --speed 2 --loop
```

Env: `PORT`, `TIKTOK_USERNAME`, `SIGN_API_KEY` (Euler Stream key, optional),
`DIRECTOR_KEY` (locks /director and stage controls behind `?key=`),
`AVATAR_HOSTS` (extra TikTok image CDN hosts for the avatar proxy).

## Architecture

```
TikTok (tiktok-live-connector) --+
mock crowd / test bench ---------+--> normalizer --> server bus --> stage (OBS)
replay file ---------------------+                       ^             |
director (phone) --- cmd / weights / mock ----------------+    status <-+
```

- `server.js`: Express + Socket.IO hub, owner chat commands, record/replay, hall of fame.
- `src/tiktokBridge.js`: connection manager, exponential backoff + jitter reconnect.
- `src/weightsStore.js`: `config/weights.json` merged over defaults. Edits on disk hot-apply.
- `src/avatarProxy.js`: same-origin avatar proxy + cache (see "Hard rules").
- `src/recorder.js`: JSONL record and replay of normalized events.
- `public/js/shared/`: code that runs in both Node and the browser.
  - `defaults.js`: every tunable number (`DEFAULT_WEIGHTS`), director slider `SCHEMA`, `THEMES`.
  - `normalizer.js`: raw TikTok payloads to small game events (gift streak math lives here).
  - `mock.js`: payload builders in the connector's real shape + chaos crowd.
- `public/js/` (stage):
  - `main.js`: boot, render loop, resolution, socket vs offline demo mode, hot reload.
  - `backdrop.js`: LAYER 1. Procedural synthwave or a file from `public/assets/`.
  - `hyper.js`: LAYER 1.5, the dimension layer. `HyperCube` (N-D cube: tesseract, penteract) and `HyperField` (low-res WebGL2 shader: aurora, hyperspace, kaleidoscope, fractal lattice). Fades in by dimension level.
  - `combat.js`: LAYER 2 and all game rules (`Battle`). Draws cores, units, boss, cinematics.
  - `seekers.js`: pooled homing seekers and bolts. Knows nothing about rules.
  - `fx.js`: pooled particles, rings, lightning, slashes, damage numbers.
  - `post.js`: WebGL2 pass over layers 1+2: bloom, scanlines, aberration, vignette, curvature, pixelate, glitch, grading.
  - `hud.js`: LAYER 3 on its own canvas so text stays sharp.
  - `audio.js`: procedural Web Audio SFX, chiptune `Music` loop (intensity follows the battle), Web Speech announcer.
  - `textcache.js`: cached text sprites for HUD labels, names and damage numbers.
  - `panel.js`: control UI shared by `/director` and the in-stage drawer (`~` key or gear).

Normalized events (the only shapes `Battle.handle` sees):
`chat {user,text}`, `gift {user,gift:{id,name,coins,streakable},delta,total,end}`,
`like {user,count}`, `share {user}`, `follow {user}`, `viewers {count}`.
`user = {id, uid, name, avatar, isMod, isSub, isFollower, isAnchor}`.

## Resolution policy (decided)

All game code uses fixed **720 x 1280 design units** (`W`, `H` in `util.js`).
The canvases are scaled by `S = renderWidth / 720`. `render.resolution` is a
toggle: `auto` (match the OBS source), 720, 1080, 1440 (supersample), 2160.
Stream output resolution is an OBS setting, separate from this.

So 720p vs 1080p never touches game code. Rules that keep it that way:
- Never hardcode pixel sizes in output pixels. Multiply by `S` only at draw setup.
- Post-processing sizes (scanline pitch, pixelate) are in design units, scaled by `S` in `main.js`.
- Sprites are cached per `S`; the cache key includes `S`.

Recommended starting setup: OBS canvas and output 1080x1920, 30 fps, about
6000 kbps; stage at `resolution: 1440` for supersampled edges if the GPU has
headroom. Weak upload: output 720x1280 at 30 fps, about 3200 kbps. Sources for
these numbers are under "Research notes".

## Game rules (current)

- **Join**: chat `a`/`b` (configurable). Units fill 12 slots per side, extra viewers queue as reserve. Any later chat = small "rally" (ATB boost).
- **ATB**: each unit fills a gauge (`atb.baseSeconds`), lunges, fires a bolt. `combat.coreFocus` splits bolts between the enemy core and enemy units.
- **Stacks** (team-wide, x99, decay over time, soft-capped via `soft()` in `combat.js`): haste (ATB speed), bravery (damage), barrage (core turret seekers).
- **Gift tiers** by coin value (`gifts.tier2/3/4`, name overrides in `gifts.overrides`):
  1. Seekers volley + bravery + barrage
  2. Surge: gifter's unit becomes elite (turret ring) + haste + bigger volley
  3. Storm: lightning on every enemy unit + core hit
  4. Grand Summon: 6 s pixel-leviathan cinematic + beam
  Damage = `count * powerScale * coins^exponent` (sublinear).
- **Combos**: streak totals crossing `gifts.comboThresholds` fire a shockwave that wipes NPCs.
- **Likes**: fill team mana; every `mana.likesPerCast` casts a meteor shower. Enemy likes also build your stagger.
- **Shares**: 10 s shield on the sharer's unit + barrage. **Follows**: haste.
- **Stagger**: fills from damage taken. Full = `stagger.damageMul` damage taken for `stagger.durationSeconds`.
- **Limit**: fills from damage taken + combos. Full = next tier >= `limit.triggerTier` gift plays a Limit Break.
- **Execution gate**: normal damage cannot take a core below `execution.gatePct`. Gate window: chip damage only, a gift of tier >= gate tier from the attackers executes (round ends, executioner enters the Hall of Fame). Defenders answering with the same tier get Phoenix Revive. Timer out = Second Wind heal, finisher tier drops by one (down to `minTier`); after `maxSecondWinds` the gate collapses by itself so rounds always end.
- **NPC spawner** ("devil side"): keeps at least `npc.minA` / `npc.minB` units per side.
- **Commanders**: the top 3 session gifters per team sit above their core as crowned turrets (`commanders.*`). Losing the #1 seat triggers a "NEW COMMANDER" callout, which is the whale-vs-whale hook.
- **Underdog bonus**: a team behind by `underdog.gapPct` HP points gets `underdog.mul` gift power (badge in the stack row).
- **Bounties**: every `bounty.everySeconds` each side's top damage dealer is marked; whoever KOs them pays their team limit + bravery.
- **First gift bonus**: a viewer's first gift of the session gets `firstGift.mul`.
- **Subscribers** (`isSub`): unit HP x `subs.hpMul`, ATB x `subs.atbMul`, inner white ring.
- **Summon variants**: tier-4 gifts below `gifts.orbitalCoins` play the Leviathan, at or above it the Orbital Strike.
- **Dimensions (evolution)**: shared energy from coins, likes, shares, joins and rift wins climbs D1 ARCADE, D2 AURORA (+25% seekers per volley), D3 TESSERACT (+10% gift power, tesseract cages around the cores), D4 KALEIDOSCOPE (+15% turn speed, orbit rings on units), D5 FIFTH DIMENSION (+25% gift power, 5D penteract). Energy drains (`ascension.decayPerSec` x level), so the room must keep feeding it; a level drops below 85% of its threshold. Each level-up plays a screen fold (post `uWarp`) and a callout. HUD: the center hex shows the level, its ring shows progress.
- **Rifts (countdown buffs)**: every `rifts.everySeconds` (never during a gate or cinematic) a rift warns for `warnSeconds`, then both teams race for `durationSeconds`. Types rotate in order: LIKE STORM (likes, HYPERDRIVE turns x1.6), GIFT RUSH (gift count, PRISM SHIELD base -30% damage + unit shields), UNITY CALL (chat messages, SWARM +15 barrage +15 haste), COIN SURGE (coins, PHASE SHIFT gifts x1.5). First team to the goal wins the buff for `buffSeconds`; nobody reaching it = rift collapses. Goals scale to the room's recent per-second rates (`goalScale`, with per-type floors and caps), so small and big rooms both get winnable races.
- **Rotating guide card** (`guide.oracle`): always on screen, flips to a new "GIVE x / UNLOCK y" card every `guide.cardSeconds` and moves between three safe slots every two cards. Live state (gate open, limit ready, rift running, underdog) jumps the queue every other card. Turning `guide.oracle` off restores the old transient guide.
- **Music**: procedural chiptune; D3+ adds a pad, each dimension adds tempo, kick drums drive a beat pulse used by bloom and the hyperfield; speeds up and adds layers during stagger / happy hour / boss (level 1) and the execution gate (level 2), ducks under cinematics, stops on the victory screen.
- **Boss invasion**, **happy hour**: director buttons or owner chat commands.

Owner chat commands (owners list, moderators, or the host): `!hh`, `!boss`,
`!stagger a|b`, `!limit a|b`, `!gate a|b`, `!meteor a|b`, `!heal a|b`,
`!reset`, `!theme ID`, `!set path value`, `!say text`.

## Hard rules

1. **Gift effects stay deterministic.** A gift of a given size always does the same thing. Randomness is cosmetic only (angles, particles). No wheels, mystery boxes or odds, and no words like bet, jackpot, raffle or lottery on screen. Reason: TikTok's gambling rules (see research notes).
2. **Never draw a cross-origin image** into the world canvas. Load avatars through `/avatar?u=` only. A tainted canvas makes `texImage2D` throw and kills post-processing.
3. **Never drop gift value.** If the seeker pool is full, apply the damage directly (see `volley`). Streak-end events (`delta === 0`) must not trigger effects.
4. **Every new tunable goes in `DEFAULT_WEIGHTS`** and, if a person would tune it live, in `SCHEMA`.
5. **Keep the HUD readable on a phone**: key text >= 14 design px, nothing important below y = 860 (TikTok chat covers the lower left on phones; zones in `hud.js` are eyeballed, check on a real phone).
6. **Compression-friendly visuals**: avoid 1 px scanlines, grain, dither and full-screen noise. Encoders discard fine detail first at streaming bitrates (general video-encoding behavior, not a TikTok-specific source).
7. **No off-platform links, QR codes or payment handles** on the canvas.
8. Perf budget: game JS < 5 ms/frame at the extreme crowd setting (700 seekers, 3,500 particles). The director shows live per-stage CPU ms (update, backdrop, battle, post, HUD); `window.__arena.perf()` returns the same. Measured in headless Chromium at 1080: 6.4 ms before the second-pass optimizations, 4.2 ms after.
9. Keep draw calls batched: particles and seeker heads go into one Path2D per color (and alpha step); repeated text goes through `TEXT` (textcache.js). Text that changes every frame (HP numbers, stack counts) passes `live: true` so it does not churn the cache.
10. The stage receives events in ~30 Hz packets (`evts`); likes from the same viewer are merged per packet. Handle both `evt` and `evts`.
11. Auto quality (`render.autoQuality`) steps down particles, smoke, then render resolution when the frame rate drops, and steps back up when it recovers. Turn it off when benchmarking in headless browsers (software rendering reads as slow).

## Recipes

**Add a gift effect**: add a branch in `Battle.onGift` (or a name override tier),
reuse `volley`, `storm`, `queueCine`, `banner(text, sub, color, {side, prio})`.
Add any new numbers to `DEFAULT_WEIGHTS`/`SCHEMA`. Add a test-bench button in
`panel.js` if it needs a new mock. Run `npm run check`.

**Live edit during a stream**: edit code, then press "Hot reload stage" in the
director (or set `dev.autoHotReload`). The stage snapshots HP, roster, stacks
and gauges to localStorage and restores them after the reload. Weight edits in
`config/weights.json` apply instantly with no reload.

**Add a rift type**: append to `RIFTS` in `combat.js` (`kind`, `title`, `unit`, `reward`, `rewardName`, `rewardText`, `min`, `max`), feed it with `riftProgress(team, kind, amount)` from the relevant event handler, and apply the reward in `riftEnd`. Keep the race deterministic (a goal, never odds).

**Add a dimension layer**: shader layers live in `hyper.js` `FS`, gated by `uDim`. Keep busy layers above the horizon (`sky` mask) and under the soft cap; check D5 readability with units on screen.

**Top vs bottom layout later**: change `slotPos`, `CORE_POS` and the volley
launch angle in `combat.js`; seekers and FX are position-agnostic.

## Testing without going live

1. `npm run check` (rules + perf, no browser).
2. Test bench and chaos crowd in `/director` or the stage drawer.
3. Piggyback: enter any currently-live username in `/director`. Read-only.
4. `--record` a busy room once, then `--replay` it offline as often as needed.

## Research notes (sources, and what is unverified)

- TikTok LIVE stream specs: Restream, citing TikTok's guidelines, lists 1080p recommended (720p minimum) and 60 fps recommended for gaming: https://support.restream.io/en/articles/6721574-stream-to-tiktok . Streamlabs lists 1080p60 = 8000 kbps, 1080p30 = 6000, 720p60 = 4000, 720p30 = 3200, max 10 Mbps: https://support.streamlabs.com/hc/en-us/articles/24730653249947-How-to-Go-Live-on-TikTok-from-a-Desktop . Both are third-party pages; no official TikTok spec page was found.
- Resolution as a ranking factor: not documented. TikTok's recommendation-system explainer describes engagement-based prediction and ranking and does not mention resolution: https://www.tiktok.com/transparency/recommendation-system/ . Claims elsewhere that resolution affects LIVE ranking: [citation needed].
- Gambling: TikTok's Community Guidelines cover gambling under Regulated Commercial Activities: https://www.tiktok.com/community-guidelines/en/regulated-commercial-activities . The full current text was not reviewed here; check it before adding any new mechanic that involves chance.
- Connector behavior (streaks, `repeatEnd`, `giftType 1`, "not a production-ready API", Euler Stream signing): `node_modules/tiktok-live-connector/README.md` v2.5.0, repo https://github.com/zerodytrash/TikTok-Live-Connector . Note: its README examples use `uniqueId`/`comment`, but proto v3 payloads use `displayId`/`content`; the normalizer accepts both.
- Reference repos that exist on GitHub but were not reviewed: `k0d1r/tiktok-live-interactive-game`, `vamnguyen/tiktok-live-games`.
- Higher-dimension visuals (technique references only; no code copied, all math in `hyper.js` is our own):
  - Tesseract projection: https://github.com/tsherif/tesseract-explorer (MIT), https://github.com/ecuber/tesseract (describes the 4D to 3D to 2D double projection), Tesserxel 4D library docs: https://wxyhly-en.github.io/archives/tsxdev-four
  - N-dimensional cubes: https://github.com/EjayNg-AI/n-dim-hypercube (MIT)
  - Kaleidoscopic IFS folding (Knighty, 2010): https://blog.hvidtfeldts.net/index.php/2010/06/folding-space-ii-kaleidoscopic-fractals/ and the original thread https://www.fractalforums.com/sierpinski-gasket/kaleidoscopic-(escape-time-ifs)/
  - Thin-film iridescence (our shader uses a cheap cosine palette as a stand-in): https://www.alanzucconi.com/2017/10/27/carpaint-shader-thin-film-interference/ and https://belcour.github.io/blog/research/2017/05/01/brdf-thin-film.html
  - TikTok goal/ranking widgets for UI ideas: https://github.com/alexlobaza/TikTokStreamingToolkit (GPL-3.0: read for ideas only, do not copy code into this repo)
- Persistent on-screen gift guides: the user chose an always-on rotating card. Whether TikTok treats a static gift menu as clutter is unverified [citation needed]; the card is compact, moves and changes, which keeps it from being a fixed price list either way.
- Mock gift coin values in `shared/mock.js` (Rose 1, Galaxy 1000, Lion 29999, ...): [citation needed]. Real streams use each event's `diamondCount`.
- Unverified claims from earlier planning (treat as hypotheses): static gift menus get penalized as clutter; TikTok OCR-scans streams for QR codes; shares are the strongest LIVE ranking signal; unattended streams get flagged unless audio varies; OBS browser sources capture Web Speech audio. [citation needed] for each.

## Ideas backlog

- Use TikTok's own `roomUser` top-gifter ranks to seed commanders when joining mid-stream.
- `emote` and `questionNew` events as abilities.
- More summon variants keyed by gift name.
- Top vs bottom layout, theme-specific cinematics, more summons per gift name.
- Per-viewer cooldown display, MVP of the session card between rounds.
