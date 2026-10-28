#!/bin/sh
set -eu
cd /workspace
node scripts/preview.mjs stop || true

# Music API. Real backend when USER_TOKEN is set; otherwise the fixture server
# (captured responses only — never the production data path).
if ! curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8787/health; then
  if [ -n "${USER_TOKEN:-}" ]; then
    (cd backend && npm start) >>/tmp/music-api.log 2>&1 &
  else
    node scripts/fixture-api.mjs >>/tmp/music-api.log 2>&1 &
  fi
  i=0
  while [ "$i" -lt 25 ]; do
    if curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8787/health; then
      break
    fi
    i=$((i + 1))
    sleep 0.1
  done
fi

if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &
