#!/usr/bin/env bash
# Pull the latest code and restart the game, keeping your settings.
#   bash TiktokApps/arcade/deploy/update.sh
# Your /etc/arena/*.env files, tuned weights, hall of fame and recordings stay.
set -euo pipefail
REPO_DIR=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO_DIR"
git pull --ff-only
sudo rsync -a --delete --exclude node_modules --exclude arcade/config/weights.json --exclude arcade/data --exclude arcade/recordings "$REPO_DIR/" /opt/arena/
sudo cp /opt/arena/arcade/deploy/arena-server.service /opt/arena/arcade/deploy/arena-broadcast.service /etc/systemd/system/
sudo chown -R arena:arena /opt/arena
sudo -u arena bash -c 'cd /opt/arena/arcade && npm ci --omit=dev --no-audit --no-fund'
sudo systemctl daemon-reload
sudo systemctl restart arena-server
sleep 3
echo "Updated to $(git log --oneline -1)"
curl -s localhost:3000/api/health; echo
