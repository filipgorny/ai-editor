#!/bin/sh
# Watcher deweloperski: rekompiluje i restartuje serwis Go ${SERVICE} na każdą
# zmianę pliku .go w repo (montowanym pod /src). Używany przez services/Dockerfile.dev.
set -eu

if [ -z "${SERVICE:-}" ]; then
  echo "dev-watch: brak zmiennej SERVICE (np. SERVICE=gateway)" >&2
  exit 1
fi

# CompileDaemon pilnuje /src i na zmianę .go robi build wybranego serwisu, a potem
# restartuje świeżą binarkę (-graceful-kill wysyła SIGTERM staremu procesowi).
# Pomijamy ciężkie nie-Go katalogi, żeby nie zarzynać inotify.
exec CompileDaemon \
  -log-prefix=false \
  -graceful-kill=true \
  -directory=/src \
  -exclude-dir=.git \
  -exclude-dir=node_modules \
  -exclude-dir=apps \
  -exclude-dir=out \
  -build="go build -buildvcs=false -o /tmp/svc ./services/${SERVICE}/cmd/${SERVICE}" \
  -command="/tmp/svc"
