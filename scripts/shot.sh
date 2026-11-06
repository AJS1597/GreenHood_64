#!/usr/bin/env bash
# Dev-only helper: screenshot a URL with headless Firefox via geckodriver.
# Usage: scripts/shot.sh <url> <output.png> [wait-seconds]
set -u
URL="$1"
OUT="$2"
WAIT="${3:-10}"
PORT="${4:-4446}"
FIREFOX="/snap/firefox/current/usr/lib/firefox/firefox"

geckodriver --port "$PORT" >/tmp/geckodriver.log 2>&1 &
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

curl -s "http://localhost:$PORT/session/$ID/screenshot" | python3 -c "import sys,json,base64;d=json.load(sys.stdin);open('$OUT','wb').write(base64.b64decode(d['value']))"
echo "saved $OUT"

ERRORS=$(curl -s -X POST "http://localhost:$PORT/session/$ID/execute/sync" -H 'Content-Type: application/json' \
  -d '{"script":"return JSON.stringify(window.__ghErrors || []);","args":[]}' | python3 -c "import sys,json;print(json.load(sys.stdin).get('value',''))" 2>/dev/null)
echo "page errors: $ERRORS"

curl -s -X DELETE "http://localhost:$PORT/session/$ID" >/dev/null
kill "$GECKO_PID" 2>/dev/null
