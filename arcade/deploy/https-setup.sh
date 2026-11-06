#!/usr/bin/env bash
# Give the game a public HTTPS address so LIVE Studio (Link source), OBS or
# Streamlabs (Browser source), or a phone can load it:
#   https://<your-ip-with-dashes>.sslip.io/?obs        game screen (read-only)
#   https://<your-ip-with-dashes>.sslip.io/director?key=YOURKEY
# sslip.io is a free DNS name that points at your IP; Caddy gets a real
# Let's Encrypt certificate for it automatically.
# Needs ports 80 and 443 open: VM > Edit > tick "Allow HTTP" and "Allow HTTPS".
#   sudo bash TiktokApps/arcade/deploy/https-setup.sh
set -euo pipefail
IP=${IP:-$(curl -fs -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip || true)}
[ -n "$IP" ] || { echo "Could not read this VM's external IP; run with IP=1.2.3.4"; exit 1; }
HOST=${HOST:-${IP//./-}.sslip.io}
if ! command -v caddy >/dev/null; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
fi
cat > /etc/caddy/Caddyfile <<CADDY
${HOST}${TLS_SUFFIX:-} {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
CADDY
systemctl restart caddy 2>/dev/null || caddy reload --config /etc/caddy/Caddyfile
echo
echo "Game screen (for LIVE Studio / OBS / phone):  https://${HOST}/?obs"
echo "Light mode for LIVE Studio's built-in browser: https://${HOST}/?obs&lite"
echo "Director:                                      https://${HOST}/director?key=YOUR_DIRECTOR_KEY"
echo "If the page does not load in a minute: VM > Edit > tick Allow HTTP + Allow HTTPS, and keep the VM's IP static."
