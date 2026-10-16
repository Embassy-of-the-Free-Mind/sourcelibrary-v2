#!/usr/bin/env bash
# Bootstrap the page-vector service on l7a (#6821): pull → build → start → recall check → phase 2.
# Every step is resumable: re-running skips what is done (pull checkpoints, index/state.json).
#
#   setsid nohup systemd-run --scope --quiet --unit=vector-search-bootstrap --slice=sourcelibrary.slice \
#     bash /data/vector-search/app/bootstrap.sh >> /data/vector-search/logs/bootstrap.log 2>&1 < /dev/null &
#
#   --rebuild   move the old shards and index aside first (a full re-pull; ~23 GB + ~7 GB of disk while both exist)
#   --no-phase2 do not start the phase-2 Claude job at the end
#
# Done marker: /data/vector-search/bootstrap.done (one line of JSON: rows, minutes, recall file).
# Memory: the build holds only the 8-bit index (~7 GB), and the service is stopped while it runs,
# so the two ~7 GB copies never share the 14 GB slice.
#
# PRIOR ART: sourcelibrary-atlas scripts/local-corpus/run-pull-embeddings.sh — the retry loop around the
# pull; nightly.sh there chains pull → build for a laptop. This adds the service start, the recall
# check and the hand-off to the next headless job.
set -uo pipefail
ROOT=${VECTOR_SEARCH_ROOT:-/data/vector-search}
APP=$ROOT/app
ENVF=/root/sourcelibrary/.env.production.local
DONE=$ROOT/bootstrap.done
PHASE2=1
for a in "$@"; do case "$a" in --no-phase2) PHASE2=0 ;; --rebuild) REBUILD=1 ;; esac; done
step() { echo "$(date -u +%FT%TZ) == $*"; }
die() { step "FAILED: $*"; echo "{\"failed\":\"$*\",\"at\":\"$(date -u +%FT%TZ)\"}" > "$ROOT/bootstrap.failed"; exit 1; }
slice_mem() { systemctl show sourcelibrary.slice -p MemoryCurrent --value | awk '{printf "%.1f GB", $1/1e9}'; }
T0=$(date +%s)
rm -f "$DONE" "$ROOT/bootstrap.failed"
mkdir -p "$ROOT/logs"

if [ "${REBUILD:-0}" = 1 ]; then
  old="$ROOT/old-$(date -u +%Y%m%dT%H%M)"; step "rebuild: moving shards/ and index/ to $old"
  mkdir -p "$old"; mv "$ROOT/shards" "$ROOT/index" "$old/" 2>/dev/null || true
fi

step "1/5 pull (slice memory $(slice_mem), disk free $(df -h --output=avail "$ROOT" | tail -1))"
for attempt in $(seq 1 10); do
  node --env-file="$ENVF" "$APP/pull-embeddings.mjs" --workers 4 --batch 5000 && break
  [ "$attempt" = 10 ] && die "pull failed 10 times"
  step "pull attempt $attempt failed; retry in 60 s"; sleep 60
done

if [ ! -f "$ROOT/index/state.json" ]; then
  step "2/5 build (stopping the service first so two indexes never share the slice; slice memory $(slice_mem))"
  systemctl stop vector-search 2>/dev/null || true
  node "$APP/build-hnsw.mjs" --threads 8 || die "build failed"
else
  step "2/5 build: index/state.json exists, skipping"
fi

step "3/5 start the service"
systemctl restart vector-search || die "systemctl restart vector-search failed"
for i in $(seq 1 90); do
  curl -sf -m 5 http://127.0.0.1:3459/health > "$ROOT/logs/health-bootstrap.json" && break
  [ "$i" = 90 ] && die "service not healthy after 15 min (journalctl -u vector-search)"
  sleep 10
done
step "health: $(cat "$ROOT/logs/health-bootstrap.json")"

RECALL="$ROOT/logs/recall-$(date -u +%Y%m%d).json"
step "4/5 recall check (before any delta: a delta re-embeds rows the shards still hold the old vector of)"
node "$APP/recall-eval.mjs" --n 50 --k 45 --out "$RECALL" || step "recall check failed (phase 2 re-runs it)"

step "5/5 first delta (catches up from the pull's start; not saved — the nightly --save does that)"
node --env-file="$ENVF" "$APP/sync-delta.mjs" --count-check || step "delta/count check exited $? (see above)"

ROWS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ROOT/index/state.json','utf8')).rows)")
echo "{\"rows\":$ROWS,\"minutes\":$(( ($(date +%s) - T0) / 60 )),\"recall\":\"$RECALL\",\"at\":\"$(date -u +%FT%TZ)\"}" > "$DONE"
step "done: $(cat "$DONE")"

if [ "$PHASE2" = 1 ]; then
  step "starting phase 2"
  HOME=/root /root/bin/claude-job.sh start vector-search-2 /root/claude-jobs/vector-search-2.txt
fi
