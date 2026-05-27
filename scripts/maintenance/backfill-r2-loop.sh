#!/usr/bin/env bash
# R2 backfill loop — runs the per-provider archivers in a polite cycle.
#
# Designed to run continuously on a Mac (LaunchAgent or manual `nohup` start).
# Each archiver processes up to LIMIT pages then exits; the loop sleeps
# CYCLE_SLEEP seconds and re-runs. The archivers query
# `archived_photo: { $exists: false }` so they're idempotent — re-running is
# safe and stops once the gap is closed.
#
# Survives:
#   - terminal close      (nohup / LaunchAgent)
#   - laptop sleep        (caffeinate -i)
#   - process crash       (loop restarts)
#   - upstream 429s       (workers retry with backoff)
#
# Doesn't survive:
#   - machine reboot      (install as LaunchAgent — see PROVIDERS_LAUNCH_AGENT.md)
#   - network disconnect  (workers will crash; loop will restart them)
#
# Usage (manual):
#   set -a; source .env.production.local; set +a
#   nohup bash scripts/maintenance/backfill-r2-loop.sh > /tmp/sl-backfill/loop.log 2>&1 &
#
# Usage (LaunchAgent): see scripts/maintenance/launchd/README.md
#
# Tunable env:
#   BACKFILL_LIMIT       pages per archiver invocation (default 2000)
#   BACKFILL_CONCURRENCY parallel workers inside each archiver (default 2)
#   BACKFILL_CYCLE_SLEEP seconds between cycles (default 30)
#   BACKFILL_PROVIDERS   space-separated list (default: harvard gallica erara mdz)

set -u

LIMIT="${BACKFILL_LIMIT:-2000}"
CONCURRENCY="${BACKFILL_CONCURRENCY:-2}"
CYCLE_SLEEP="${BACKFILL_CYCLE_SLEEP:-30}"
PROVIDERS="${BACKFILL_PROVIDERS:-harvard gallica erara mdz}"
LOG_DIR="${BACKFILL_LOG_DIR:-/tmp/sl-backfill}"
LOCK_DIR="${BACKFILL_LOCK_DIR:-/tmp/sl-backfill}"

mkdir -p "$LOG_DIR" "$LOCK_DIR"

if [[ -z "${MONGODB_URI:-}" ]]; then
  echo "ERROR: MONGODB_URI not set. Source .env.production.local first." >&2
  exit 1
fi

# Map provider name → command. Keep in sync with backfill-r2-status.mjs.
# Note: no OS-level flock — runs are serialized within this loop and the
# archivers' queries (`archived_photo: { $exists: false }`) are idempotent so
# accidental overlap with another instance produces duplicate work, not data
# corruption. macOS doesn't ship flock anyway.
run_provider() {
  local provider="$1"
  local log="$LOG_DIR/$provider.log"
  case "$provider" in
    harvard)
      node scripts/workers/archive-harvard.mjs --limit=$LIMIT --concurrency=$CONCURRENCY >> "$log" 2>&1
      ;;
    gallica)
      node scripts/workers/archive-gallica.mjs --limit=$LIMIT >> "$log" 2>&1
      ;;
    erara)
      node scripts/workers/archive-erara.mjs --limit=$LIMIT >> "$log" 2>&1
      ;;
    mdz)
      npx tsx scripts/maintenance/archive-images-fast.ts --source=mdz --limit=$LIMIT --concurrency=$CONCURRENCY >> "$log" 2>&1
      ;;
    ia)
      node scripts/workers/archive-bulk.mjs --limit=$LIMIT --concurrency=$CONCURRENCY >> "$log" 2>&1
      ;;
    *)
      echo "[loop] unknown provider: $provider" >&2
      return 1
      ;;
  esac
}

# Use caffeinate -i to prevent idle sleep while we're working.
# `-i` = prevent idle sleep, but allow the display to sleep. The wrapper
# inherits caffeinate's protection so child node processes are covered too.
if [[ -z "${BACKFILL_NO_CAFFEINATE:-}" && "$(uname)" == "Darwin" ]] && ! pgrep -f "caffeinate -i .*backfill-r2-loop" > /dev/null; then
  echo "[loop] re-execing under caffeinate"
  exec caffeinate -i bash "$0" "$@"
fi

echo "[loop] starting — providers=[$PROVIDERS] limit=$LIMIT concurrency=$CONCURRENCY cycle=${CYCLE_SLEEP}s log=$LOG_DIR/"
trap 'echo "[loop] SIGTERM received, exiting cleanly"; exit 0' TERM
trap 'echo "[loop] SIGINT received, exiting cleanly"; exit 0' INT

while true; do
  cycle_started=$(date -u +%FT%TZ)
  echo "[loop] cycle start $cycle_started"
  for provider in $PROVIDERS; do
    echo "[loop] [$provider] running …"
    if run_provider "$provider"; then
      echo "[loop] [$provider] cycle complete"
    else
      echo "[loop] [$provider] cycle FAILED with exit $? (will retry next cycle)"
    fi
  done
  echo "[loop] cycle done; sleeping ${CYCLE_SLEEP}s"
  sleep "$CYCLE_SLEEP"
done
