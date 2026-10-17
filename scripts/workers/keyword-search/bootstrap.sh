#!/usr/bin/env bash
# Bootstrap the keyword page service (#6852) on the box that serves it: install → pull|build → start →
# first delta → cron. Re-running skips what is done (an installed index, a present env file, a cron line).
#
#   setsid nohup systemd-run --scope --quiet --unit=keyword-search-bootstrap --slice=sourcelibrary.slice \
#     bash <checkout>/scripts/workers/keyword-search/bootstrap.sh <checkout> \
#     >> /data/keyword-search/logs/bootstrap.log 2>&1 < /dev/null &
#
#   <checkout>   a checkout of the branch that carries this directory (the app files are copied from it)
#   --rebuild    pull and build a new index even if one is installed (the service keeps serving the old
#                one until the new one is renamed into place; then it restarts)
#   --next <job-name> <brief-file>   start that headless job at the end, done or failed (claude-job.sh)
#
# The pull streams into the build (pull-pages.mjs --stdout | build_index.py --stdin), so the box needs disk
# for the index (~16 GB, plus merge headroom) and not for ~13 GB of shards beside it. A short pipe (under
# MIN_PAGES) is a failed pull and is not installed.
# Done marker: $ROOT/bootstrap.done (one JSON line). Failure: $ROOT/bootstrap.failed.
#
# PRIOR ART: scripts/workers/vector-search/bootstrap.sh — the same chain (pull → build → start → check →
# delta → next job) for the page-vector service on l7a. This one has no recall step (the parity eval is
# scripts/eval/keyword-lane-parity/, run from a checkout) and installs its own cron line.
set -uo pipefail
CHECKOUT=${1:?usage: bootstrap.sh <checkout> [--rebuild] [--next <job> <brief>]}
shift
ROOT=${KEYWORD_SEARCH_ROOT:-/data/keyword-search}
APP=$ROOT/app
SRC=$CHECKOUT/scripts/workers/keyword-search
ENVF=/root/sourcelibrary/.env.production.local
LOCAL_PORT=3461
MIN_PAGES=${MIN_PAGES:-8000000}
MIN_FREE_GB=${MIN_FREE_GB:-28}
REBUILD=0; NEXT_JOB=""; NEXT_BRIEF=""
while [ $# -gt 0 ]; do
  case "$1" in
    --rebuild) REBUILD=1 ;;
    --next) NEXT_JOB=$2; NEXT_BRIEF=$3; shift 2 ;;
  esac
  shift
done
step() { echo "$(date -u +%FT%TZ) == $*"; }
# Returns 0 with no --next: as the last command, a bare `[ -n "" ] && …` made a clean run exit 1.
next_job() { [ -z "$NEXT_JOB" ] && return 0; step "starting $NEXT_JOB"; HOME=/root /root/bin/claude-job.sh start "$NEXT_JOB" "$NEXT_BRIEF"; }
die() { step "FAILED: $*"; echo "{\"failed\":\"$*\",\"at\":\"$(date -u +%FT%TZ)\"}" > "$ROOT/bootstrap.failed"; next_job; exit 1; }
T0=$(date +%s)
mkdir -p "$APP" "$ROOT/logs"
rm -f "$ROOT/bootstrap.done" "$ROOT/bootstrap.failed"

step "1/6 install app files and the Python venv (disk free $(df -h --output=avail "$ROOT" | tail -1 | tr -d ' '))"
cp "$SRC"/*.mjs "$SRC"/*.py "$SRC"/requirements.txt "$SRC"/crontab "$APP"/ || die "copy from $SRC failed"
if [ ! -x "$ROOT/venv/bin/python" ]; then
  python3 -m venv "$ROOT/venv" 2>/dev/null || { apt-get install -y -q python3-venv >/dev/null && python3 -m venv "$ROOT/venv"; } || die "python3 -m venv failed"
fi
"$ROOT/venv/bin/pip" install -q -r "$APP/requirements.txt" || die "pip install failed"
( cd "$APP" && "$ROOT/venv/bin/python" test_engine.py > "$ROOT/logs/test_engine.log" 2>&1 ) || die "test_engine.py failed (see $ROOT/logs/test_engine.log)"
node -e "require('/root/sourcelibrary/node_modules/mongodb')" 2>/dev/null || die "no mongodb driver under /root/sourcelibrary/node_modules (lib.mjs reads it from there)"
if [ ! -f /etc/keyword-search.env ]; then
  ( umask 077; printf 'KEYWORD_SEARCH_TOKEN=%s\nKEYWORD_SEARCH_HOST=127.0.0.1\nKEYWORD_SEARCH_PORT=3460\nKEYWORD_SEARCH_LOCAL_PORT=%s\n' "$(openssl rand -hex 32)" "$LOCAL_PORT" > /etc/keyword-search.env )
  step "wrote /etc/keyword-search.env (public listener on 127.0.0.1 until the TLS proxy, #6843)"
fi
cp "$CHECKOUT/infrastructure/systemd/search.slice" "$CHECKOUT/infrastructure/systemd/search-services.slice" "$CHECKOUT/infrastructure/systemd/keyword-search.service" /etc/systemd/system/ && systemctl daemon-reload || die "unit install failed"

if [ "$REBUILD" = 1 ] || [ ! -f "$ROOT/index/meta.json" ]; then
  FREE=$(df --output=avail -BG "$ROOT" | tail -1 | tr -dc 0-9)
  [ "$FREE" -ge "$MIN_FREE_GB" ] || die "only ${FREE} GB free at $ROOT; the build needs ${MIN_FREE_GB} GB (index ~16 GB + merges)"
  step "2/6 pull | build (${FREE} GB free)"
  ok=0
  for attempt in 1 2 3; do
    STARTED=$(date -u +%FT%TZ)
    if ( cd "$APP" && nice -n 5 node --env-file="$ENVF" pull-pages.mjs --stdout --workers 8 2>> "$ROOT/logs/pull.log" \
         | KEYWORD_SEARCH_ROOT=$ROOT nice -n 5 "$ROOT/venv/bin/python" build_index.py --stdin --pull-started-at "$STARTED" --threads 4 --heap-gb 2 --min-pages "$MIN_PAGES" ); then
      ok=1; break
    fi
    step "pull|build attempt $attempt failed; retry in 120 s"; sleep 120
  done
  [ "$ok" = 1 ] || die "pull|build failed 3 times (see $ROOT/logs/pull.log)"
else
  step "2/6 an index is installed ($ROOT/index); skipping the build (--rebuild to replace it)"
fi

step "3/6 (re)start the service"
systemctl enable keyword-search >/dev/null 2>&1
systemctl restart keyword-search || die "systemctl restart keyword-search failed"
for i in $(seq 1 60); do
  curl -sf -m 5 "http://127.0.0.1:$LOCAL_PORT/health" > "$ROOT/logs/health-bootstrap.json" && break
  [ "$i" = 60 ] && die "service not healthy after 5 min (journalctl -u keyword-search; $ROOT/logs/server.log)"
  sleep 5
done
step "health: $(cat "$ROOT/logs/health-bootstrap.json")"

step "4/6 first delta: catches up from the pull's start and posts the live-book set"
( cd "$APP" && node --env-file="$ENVF" sync-delta.mjs ) >> "$ROOT/logs/delta.log" 2>&1 || die "first delta failed (see $ROOT/logs/delta.log)"
tail -1 "$ROOT/logs/delta.log"

step "5/6 cron (backed up first; appended once)"
if ! crontab -l 2>/dev/null | grep -q 'keyword-search/app/sync-delta.mjs'; then
  crontab -l > "/root/crontab.bak-$(date -u +%Y%m%dT%H%M)" 2>/dev/null || true
  ( crontab -l 2>/dev/null; grep -v '^#' "$APP/crontab" | grep -v '^\s*$' ) | crontab - || die "crontab install failed"
  step "cron installed: $(crontab -l | grep -c 'keyword-search') line(s)"
else
  step "cron line already present"
fi

step "6/6 smoke"
SMOKE=$(curl -s -m 10 -X POST "http://127.0.0.1:$LOCAL_PORT/lane" -d '{"query":"prima materia","k":25,"rollup":{"terms":["prima","materia"]}}' \
  | python3 -c 'import sys,json; r=json.load(sys.stdin); print(json.dumps({"main":len(r["main"]),"counts":len(r["counts"] or []),"extra":len(r["extra"]),"server_ms":r["server_ms"]}))') || die "smoke query failed"
step "smoke: $SMOKE"
PAGES=$(python3 -c "import json;print(json.load(open('$ROOT/state.json'))['pages'])")
echo "{\"pages\":$PAGES,\"minutes\":$(( ($(date +%s) - T0) / 60 )),\"smoke\":$SMOKE,\"at\":\"$(date -u +%FT%TZ)\"}" > "$ROOT/bootstrap.done"
step "done: $(cat "$ROOT/bootstrap.done")"
next_job
