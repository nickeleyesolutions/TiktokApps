# Arcade Arena

Neo-arcade left vs right battle game for TikTok LIVE. Final Fantasy style turn
gauges, homing seeker missiles, stagger and limit break, and a whale-tier
"final blow" gift that ends the round on screen.

## Quick start

```bash
cd arcade
npm install
npm start
```

- Stage (add as an OBS Browser Source): `http://localhost:3000/`
  - Browser Source size: 1080 x 1920 (or 720 x 1280). Add `?obs` to hide the gear button.
  - Tick "Control audio via OBS" so the game sounds reach the stream.
- Director (open on your phone, same Wi-Fi or your server's IP): `http://localhost:3000/director`

No TikTok account needed to test: use the Test bench and the Crowd simulator in
the director, or press `~` on the stage. To test with real traffic, type any
live creator's username in Live source (read-only).

## Try it without installing anything

`npm run build:demo` writes `dist/arena-demo.html`, a single file that runs
the whole game in offline demo mode with a simulated crowd. Open it in any
browser, tap the gear for the test bench.

## Going live

1. Run the server on a machine with a stable upload (a cloud VM if your Wi-Fi drops).
2. In OBS: Browser Source `http://localhost:3000/?obs`, canvas and output 1080 x 1920 (720 x 1280 on weak upload), 30 fps.
3. Stream to TikTok with your stream key or LIVE Studio.
4. In the director, Live source: your own username. Add yourself under owners in `config/weights.json` (`owners.usernames`) to use `!` chat commands.

See `CLAUDE.md` for architecture, game rules, tuning and research notes.
