#!/usr/bin/env bash
# Dev-only helper: navigate with headless Firefox and evaluate a JS expression.
# Usage: scripts/eval.sh <url> <js-expression> [wait-seconds]
set -u
URL="$1"
SCRIPT="$2"
WAIT="${3:-10}"
PORT="${4:-4457}"
FIREFOX="/snap/firefox/current/usr/lib/firefox/firefox"

geckodriver --port "$PORT" >/tmp/geckodriver-eval.log 2>&1 &
GECKO_PID=$!
sleep 2

RESP=$(curl -s -X POST "http://localhost:$PORT/session" -H 'Content-Type: application/json' \
  -d "{\"capabilities\":{\"alwaysMatch\":{\"browserName\":\"firefox\",\"moz:firefoxOptions\":{\"binary\":\"$FIREFOX\",\"args\":[\"-headless\",\"--width=1280\",\"--height=720\"]}}}}")
ID=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('value',{}).get('sessionId',''))" 2>/dev/null)
if [ -z "$ID" ]; then
  echo "failed to start session: $RESP"
  kill "$GECKO_PID" 2>/dev/null
  exit 1
fi

curl -s -X POST "http://localhost:$PORT/session/$ID/url" -H 'Content-Type: application/json' -d "{\"url\":\"$URL\"}" >/dev/null
sleep "$WAIT"

python3 - "$PORT" "$ID" "$SCRIPT" <<'PY'
import json, sys, urllib.request
port, sid, script = sys.argv[1], sys.argv[2], sys.argv[3]
body = json.dumps({"script": script, "args": []}).encode()
req = urllib.request.Request(f"http://localhost:{port}/session/{sid}/execute/sync", data=body, headers={"Content-Type": "application/json"})
try:
    print(urllib.request.urlopen(req).read().decode())
except Exception as exc:
    print("eval failed:", exc)
PY

curl -s -X DELETE "http://localhost:$PORT/session/$ID" >/dev/null
kill "$GECKO_PID" 2>/dev/null