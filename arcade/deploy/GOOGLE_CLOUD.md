# Running Arcade Arena on Google Cloud

The VM does everything: it listens to your TikTok room, renders the game in a
headless Chrome, and streams the video to TikTok. Your home Wi-Fi only carries
your phone's director page, so a spotty connection cannot drop the stream.

```
TikTok room events --> [VM] game server --> Chrome on a virtual display
                                              |
                              ffmpeg (video + game audio) --> TikTok RTMP
```

Tested in a 4 vCPU Ubuntu 24.04 sandbox with a real live room:
720x1280 rendered at about 50 fps and encoded at a steady 30 fps with game
audio. At 1080x1920 the encoder held 30 fps but the game lowered its internal
resolution to keep up, so use 8 vCPUs for 1080p.

## 1. Create the project and VM (you)

In the Google Cloud console, or with the `gcloud` CLI in Cloud Shell:

```bash
gcloud projects create arcade-arena-live --name="Arcade Arena"
```
```bash
gcloud config set project arcade-arena-live
```
Link a billing account to the project (console: Billing > Link a billing account), then:
```bash
gcloud services enable compute.googleapis.com
```
```bash
gcloud compute instances create arena \
  --zone=us-central1-a \
  --machine-type=e2-standard-8 \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB
```

- `e2-standard-8` (8 vCPU) for 1080p. `e2-standard-4` is enough for 720p.
- Pick the zone closest to you. Check current prices in the console's
  pricing calculator; streaming also uses outbound bandwidth (about 2.7 GB
  per hour at 6000 kbps, about 1.4 GB per hour at 3200 kbps).
- No firewall changes are needed. The director is reached through an SSH
  tunnel (step 4), so nothing is exposed to the internet.

## 2. Put the code on the VM

The repository is private, so clone it with a GitHub token (a fine-grained
personal access token with read access to `nickeleyesolutions/TiktokApps`):

```bash
gcloud compute ssh arena --zone=us-central1-a
```
```bash
git clone -b claude/confident-pascal-8nd2c3 https://github.com/nickeleyesolutions/TiktokApps.git
```
(username: your GitHub name, password: the token)

```bash
sudo bash TiktokApps/arcade/deploy/gcp-setup.sh
```

The setup script installs Node 22, Google Chrome, Xvfb, PulseAudio and ffmpeg,
creates an `arena` user, copies the code to `/opt/arena`, and starts the game
server as a service.

## 3. Your settings (you, on the VM only)

```bash
sudo nano /etc/arena/arena.env
```
- `TIKTOK_USERNAME`: your username without the @. The server keeps checking and connects as soon as you go live.
- `DIRECTOR_KEY`: any long random string.

```bash
sudo systemctl restart arena-server
```

```bash
sudo nano /etc/arena/stream.env
```
- `RTMP_URL` and `STREAM_KEY`: from TikTok. On desktop, TikTok's Go LIVE
  page or LIVE Studio shows a Server URL and Stream Key when your account can
  stream with a key. Access depends on TikTok's eligibility rules for your
  account [verify in your TikTok account]. Some guides say the key can change
  each session [verify]: if so, update this file before each stream.
- 720p on a 4 vCPU VM: set `RES_W=720`, `RES_H=1280`, `VBITRATE=3200k`.

Never paste the stream key into chat, GitHub, or a screenshot.

## 4. Go live

1. Start the LIVE on TikTok (stream key mode), then on the VM:
   ```bash
   sudo systemctl enable --now arena-broadcast
   ```
2. Open the director from your laptop through a tunnel:
   ```bash
   gcloud compute ssh arena --zone=us-central1-a -- -L 3000:localhost:3000
   ```
   then browse to `http://localhost:3000/director?key=YOUR_DIRECTOR_KEY`.
3. Health check at any time:
   ```bash
   curl -s localhost:3000/api/health
   ```
   `bridge.status` should be `connected` and `stage.fps` 28 or higher.

Stop streaming:
```bash
sudo systemctl stop arena-broadcast
```
Logs:
```bash
journalctl -u arena-server -u arena-broadcast -f
```

## Rendering modes

`RENDER_MODE=cpu` (default) turns WebGL off in Chrome and uses the CPU bloom
and scanline fallback. Software WebGL stalls on every frame on GPU-less VMs
(measured 20 fps vs 50 to 60 fps without it). You lose the WebGL-only
effects: CRT curvature, chromatic aberration, the dimension shader field and
the prism sheen. Hypercubes, orbit rings, cages, bloom and everything else stay.

`RENDER_MODE=gpu` is for a VM with an NVIDIA GPU and drivers (for example a
G2 machine). It is untested here; try it only after the CPU setup works.

## What I need from you

1. The VM created and `gcp-setup.sh` run (steps 1 and 2). Tell me if any command errors and paste the error text (not keys).
2. Your TikTok username, so I can point a live test at your room when you go live (`npm run live-test -- yourname 60`).
3. Whether TikTok shows you a Server URL and Stream Key. If it does not, the fallback is OBS on your computer pointed at the VM's stage, which still sends video over your home connection.
