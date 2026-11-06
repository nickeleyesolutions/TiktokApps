#!/usr/bin/env bash
# Rehearse the whole broadcast on this VM without touching TikTok:
# a local RTMP receiver stands in for TikTok, broadcast.sh streams to it for
# 25 s, then the script reports the game's fps, the encoder's fps and whether
# game audio was captured.
#   bash TiktokApps/arcade/deploy/selftest.sh          # 1080x1920
#   RES=720 bash TiktokApps/arcade/deploy/selftest.sh  # 720x1280
set -uo pipefail
RES=${RES:-1080}
if [ "$RES" = 720 ]; then W=720; H=1280; BR=3200k; else W=1080; H=1920; BR=6000k; fi
OUT=$(mktemp -d)
chmod 777 "$OUT"
echo "== Self-test ${W}x${H} on $(nproc) vCPU ($(. /etc/os-release; echo "$PRETTY_NAME"))"
curl -fs localhost:3000/api/health >/dev/null || { echo "Game server is not answering on port 3000: sudo systemctl status arena-server"; exit 1; }
ffmpeg -hide_banner -loglevel error -y -listen 1 -timeout 40000000 -i rtmp://127.0.0.1:1935/test/selftest -c copy "$OUT/out.flv" >/dev/null 2>&1 &
RECV=$!
sleep 1
sudo -u arena env XDG_RUNTIME_DIR=/run/user/1500 RTMP_URL=rtmp://127.0.0.1:1935/test STREAM_KEY=selftest RES_W=$W RES_H=$H VBITRATE=$BR \
  timeout 30 /opt/arena/arcade/deploy/broadcast.sh > "$OUT/broadcast.log" 2>&1 &
BC=$!
sleep 24
STAGE=$(curl -s localhost:3000/api/health | python3 -c 'import sys,json; s=json.load(sys.stdin).get("stage") or {}; print(s.get("fps", 0), "fps at", s.get("res", "?"), "- quality level", s.get("quality", "?"), "(0 = full)")' 2>/dev/null)
wait $BC 2>/dev/null
wait $RECV 2>/dev/null
ENC=$(tr '\r' '\n' < "$OUT/broadcast.log" | grep -oE 'fps= *[0-9]+' | tail -1)
VID=$(ffprobe -v error -select_streams v -show_entries stream=width,height -of csv=p=0 "$OUT/out.flv" 2>/dev/null)
VOL=$(ffmpeg -hide_banner -i "$OUT/out.flv" -af volumedetect -vn -f null - 2>&1 | grep -oE 'max_volume: [-0-9.]+ dB')
echo "game:    $STAGE"
echo "encoder: ${ENC:-no output}   video: ${VID:-none}"
echo "audio:   ${VOL:-none}  (silence is about -91 dB)"
if [ -n "$VID" ] && [ -n "$ENC" ]; then echo "RESULT: broadcast pipeline works"; else echo "RESULT: failed, last log lines:"; tail -5 "$OUT/broadcast.log"; fi
rm -rf "$OUT"
