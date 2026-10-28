#!/usr/bin/env bash
# Build and (re)start the server in the background. Token is read from USER_TOKEN env at runtime.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -n "${USER_TOKEN:-}" ] || { echo "USER_TOKEN is not set" >&2; exit 1; }
npm run build --silent
if [ -f server.pid ] && kill -0 "$(cat server.pid)" 2>/dev/null; then kill "$(cat server.pid)"; sleep 1; fi
nohup node dist/index.js > server.log 2>&1 &
echo $! > server.pid
echo "started PID $(cat server.pid); logs: server.log"
