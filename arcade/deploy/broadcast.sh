#!/usr/bin/env bash
# Headless broadcast for a cloud VM (no monitor, no OBS):
#   Xvfb virtual display -> Chrome kiosk showing the stage -> PulseAudio null
#   sink for game audio -> ffmpeg (x264 + AAC) -> RTMP (TikTok stream key)
#
# Required env (see deploy/stream.env.example):
#   RTMP_URL    TikTok "Server URL", e.g. rtmp://push-rtmp-xx.tiktokcdn.com/game/
#   STREAM_KEY  TikTok "Stream key" (treat as a password; may change per session)
# Optional: RES_W RES_H FPS VBITRATE ABITRATE STAGE_URL DISPLAY_NUM CHROME
set -euo pipefail
: "${RTMP_URL:?RTMP_URL is not set}"
: "${STREAM_KEY:?STREAM_KEY is not set}"
RES_W=${RES_W:-1080}
RES_H=${RES_H:-1920}
FPS=${FPS:-30}
VBITRATE=${VBITRATE:-6000k}
ABITRATE=${ABITRATE:-160k}
STAGE_URL=${STAGE_URL:-http://localhost:3000/?obs}
DISPLAY_NUM=${DISPLAY_NUM:-99}
CHROME=${CHROME:-google-chrome}
X264_PRESET=${X264_PRESET:-veryfast} # superfast/ultrafast use less CPU, look a bit softer
PROFILE=${PROFILE:-/tmp/arena-chrome-$$}
rm -rf "$PROFILE"
# RENDER_MODE=cpu (default, any VM): WebGL off, CPU bloom/scanlines fallback.
#   Software WebGL stalls on every frame; measured 20 fps vs 60 fps without it.
# RENDER_MODE=gpu (VM with an NVIDIA GPU + drivers): full WebGL effects. Untested here.
RENDER_MODE=${RENDER_MODE:-cpu}
if [[ $RENDER_MODE == gpu ]]; then GL_FLAGS=(--use-gl=angle --use-angle=vulkan --enable-features=Vulkan --ignore-gpu-blocklist --enable-gpu-rasterization)
else GL_FLAGS=(--disable-gpu --disable-webgl); fi
export DISPLAY=:$DISPLAY_NUM

cleanup() { kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT INT TERM

Xvfb ":$DISPLAY_NUM" -screen 0 "${RES_W}x${RES_H}x24" -nolisten tcp &
sleep 1

# audio: a virtual speaker Chrome plays into; ffmpeg records its monitor
pulseaudio --check 2>/dev/null || pulseaudio --start --exit-idle-time=-1 --disallow-exit 2>/dev/null || pulseaudio -D --system=false --exit-idle-time=-1 2>/dev/null || true
pactl load-module module-null-sink sink_name=arena sink_properties=device.description=arena >/dev/null 2>&1 || true
pactl set-default-sink arena 2>/dev/null || true

"$CHROME" --kiosk --no-first-run --no-default-browser-check --noerrdialogs --disable-infobars \
  --autoplay-policy=no-user-gesture-required --disable-features=Translate,MediaRouter,CalculateNativeWinOcclusion \
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling \
  --window-position=0,0 --window-size="${RES_W},${RES_H}" --user-data-dir="$PROFILE" \
  "${GL_FLAGS[@]}" --no-sandbox \
  "${STAGE_URL}$( [[ $STAGE_URL == *\?* ]] && echo '&' || echo '?' )res=${RES_W}" >/dev/null 2>&1 &
sleep 8

GOP=$((FPS * 2))
BUF=$(( ${VBITRATE%k} * 2 ))k
AUDIO_IN=(-f lavfi -i anullsrc=r=44100:cl=stereo)
pactl list short sources 2>/dev/null | grep -q arena.monitor && AUDIO_IN=(-thread_queue_size 1024 -f pulse -i arena.monitor)

exec ffmpeg -hide_banner -loglevel warning -stats \
  -thread_queue_size 1024 -f x11grab -draw_mouse 0 -framerate "$FPS" -video_size "${RES_W}x${RES_H}" -i ":$DISPLAY_NUM" \
  "${AUDIO_IN[@]}" \
  -c:v libx264 -preset "$X264_PRESET" -tune zerolatency -pix_fmt yuv420p \
  -b:v "$VBITRATE" -maxrate "$VBITRATE" -bufsize "$BUF" -g "$GOP" -keyint_min "$GOP" -sc_threshold 0 \
  -c:a aac -b:a "$ABITRATE" -ar 44100 -ac 2 \
  -f flv "${RTMP_URL%/}/${STREAM_KEY}"
