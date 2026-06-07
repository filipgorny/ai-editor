#!/usr/bin/env bash
# rebuild-and-start.sh — rebuild and run the whole stack:
#   1) rebuild + (re)start all Go services in Docker (dev compose, hot-reload)
#   2) rebuild the frontend (Electron app)
#   3) start the frontend
#
# Usage: ./rebuild-and-start.sh
set -euo pipefail

# Always run from the repo root, wherever the script is invoked from.
cd "$(dirname "$0")"

APP="@ai-architect/assistant-app"

echo "▶ 1/3  Rebuilding & starting Go services (Docker, dev compose)…"
# --no-cache only applies to `build`, not `up`, so build first, then start.
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.dev.yaml"
$COMPOSE build --no-cache
$COMPOSE up -d

# Wait for the gateway to be reachable so the app's auto-scan on startup hits a live backend
# (in dev the Go services compile on first run, which takes a moment after --no-cache).
GATEWAY_PORT="${GATEWAY_PORT:-50061}"
echo "⏳ Waiting for the gateway on :${GATEWAY_PORT} …"

for i in $(seq 1 180); do
  if (exec 3<>"/dev/tcp/127.0.0.1/${GATEWAY_PORT}") 2>/dev/null; then
    exec 3>&- 3<&-
    echo "✓ Gateway is up."
    break
  fi

  if [ "$i" -eq 180 ]; then
    echo "⚠ Gateway still not reachable after 180s — starting the app anyway."
  fi

  sleep 1
done

echo "▶ 2/3  Rebuilding the frontend…"
pnpm --filter "$APP" build

echo "▶ 3/3  (Re)starting the frontend…"
# If the app is already running, kill it first so we start fresh. Scope the match to THIS
# repo's app (its built output + the electron-vite preview) so we don't touch other apps.
APP_DIR="$(pwd)/apps/ai-assistant-app"
pkill -f "$APP_DIR/out" 2>/dev/null || true
pkill -f "electron-vite preview" 2>/dev/null || true
sleep 1

exec pnpm --filter "$APP" start
