#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 24.04 VM. Run as root from the repo:
#   sudo bash deploy/gcp-setup.sh
# Installs Node 22, Chrome, Xvfb, PulseAudio, ffmpeg; creates the `arena` user;
# copies this checkout to /opt/arena; installs the two systemd services.
set -euo pipefail
REPO_DIR=$(cd "$(dirname "$0")/../.." && pwd)

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y curl git rsync ca-certificates xvfb pulseaudio ffmpeg fonts-dejavu-core
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v google-chrome >/dev/null; then
  curl -fsSLo /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  DEBIAN_FRONTEND=noninteractive apt-get install -y /tmp/chrome.deb
fi

id arena >/dev/null 2>&1 || useradd --system --create-home --uid 1500 --shell /usr/sbin/nologin arena
mkdir -p /opt/arena /etc/arena /run/user/1500
rsync -a --delete --exclude node_modules "$REPO_DIR/" /opt/arena/ 2>/dev/null || cp -a "$REPO_DIR/." /opt/arena/
chown -R arena:arena /opt/arena /run/user/1500
sudo -u arena bash -c 'cd /opt/arena/arcade && npm ci --omit=dev'

[ -f /etc/arena/arena.env ] || cp /opt/arena/arcade/deploy/arena.env.example /etc/arena/arena.env
[ -f /etc/arena/stream.env ] || cp /opt/arena/arcade/deploy/stream.env.example /etc/arena/stream.env
chmod 600 /etc/arena/*.env
chown arena:arena /etc/arena/*.env

# keep the runtime dir for PulseAudio across reboots
echo 'd /run/user/1500 0700 arena arena -' > /etc/tmpfiles.d/arena.conf
cp /opt/arena/arcade/deploy/arena-server.service /opt/arena/arcade/deploy/arena-broadcast.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now arena-server
echo
echo "Game server is running. Next:"
echo "  1) edit /etc/arena/arena.env (TIKTOK_USERNAME, DIRECTOR_KEY) then: systemctl restart arena-server"
echo "  2) edit /etc/arena/stream.env (RTMP_URL, STREAM_KEY from TikTok)"
echo "  3) systemctl enable --now arena-broadcast      # starts streaming"
echo "  4) check: curl -s localhost:3000/api/health"
