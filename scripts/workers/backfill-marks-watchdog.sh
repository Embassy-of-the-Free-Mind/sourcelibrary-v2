#!/usr/bin/env bash
# Keeps the display-mark backfill running (#4406). Every 10 min from cron, on gex45.
# PRIOR ART: scripts/maintenance/gpu-lease-watchdog.mjs stops rented GPUs when output stops; this restarts
# local shards. scripts/workers/disk-alarm.sh is where the ntfy pattern comes from.
#
# Does nothing without $OUT/go, so the line can sit in crontab until a person or job has checked the spend.
# Honours finished-<i>-of-<n>.txt and stopped-<i>-of-<n>.txt: a shard that hit its budget stays stopped.
# Restarts a shard that is dead, or whose progress file has not moved in 30 min, and pages when one has.
# Restarting is safe: finished books are listed in done-<i>-of-<n>.txt and a repeat read skips by tag.
set -u
OUT=${1:?usage: backfill-marks-watchdog.sh OUT_DIR [SHARDS] [CONCURRENCY]}
SHARDS=${2:-14}
CONCURRENCY=${3:-3}
BUDGET=${BACKFILL_BUDGET_USD:-30}
REPO=/root/sourcelibrary
SCRIPT=scripts/maintenance/backfill-display-marks.mjs
TOPIC=https://ntfy.sh/sourcelibrary-uptime
STALE_MIN=30

page() { # title, priority, message; at most one an hour per title
  local stamp="$OUT/paged-$(echo "$1" | tr -c 'a-z0-9' '-')"
  [ -n "$(find "$stamp" -mmin -60 2>/dev/null)" ] && return 0
  NTFY_SRC=backfill-marks-watchdog.sh "$REPO/scripts/workers/ntfy-send.sh" "$TOPIC" "$1" "$2" warning "$3" && touch "$stamp"
}

[ -f "$OUT/go" ] || exit 0
cd "$REPO" || exit 1

finished=0 stopped=0 restarted=()
for ((i = 0; i < SHARDS; i++)); do
  tag="$i-of-$SHARDS"
  if [ -f "$OUT/finished-$tag.txt" ]; then finished=$((finished + 1)); continue; fi
  if [ -f "$OUT/stopped-$tag.txt" ]; then stopped=$((stopped + 1)); continue; fi

  # Anchored on node: unanchored, this matches any shell whose command line quotes the pattern, and then kills it.
  pid=$(pgrep -f "^node .*$SCRIPT .*--shard=$i/$SHARDS( |\$)" | head -1)
  # The progress file is the heartbeat; before its first write, the log the shard opened at start.
  beat="$OUT/progress-$tag.json"
  [ -f "$beat" ] || beat="$OUT/shard-$i.log"
  stale=""
  [ -f "$beat" ] && [ -z "$(find "$beat" -mmin -$STALE_MIN)" ] && stale=1
  [ -n "$pid" ] && [ -z "$stale" ] && continue

  [ -n "$pid" ] && kill "$pid" && sleep 5
  systemd-run --quiet --scope --slice=sourcelibrary.slice -- \
    nohup node --env-file=.env.production.local "$SCRIPT" --apply "--out=$OUT" "--shard=$i/$SHARDS" \
    "--budget-usd=$BUDGET" "--concurrency=$CONCURRENCY" >> "$OUT/shard-$i.log" 2>&1 &
  disown
  [ -n "$stale" ] && restarted+=("$i")
done

[ ${#restarted[@]} -gt 0 ] && page "backfill marks stalled" 4 "No output for ${STALE_MIN}+ min on shard(s) ${restarted[*]}, restarted. Check: node --env-file=$REPO/.env.production.local $REPO/$SCRIPT --out=$OUT --status (#4406)"
# These two are states, not events: once each, or they would page hourly for ever.
[ "$stopped" -gt 0 ] && [ ! -f "$OUT/paged-backfill-marks-budget-stop-" ] && page "backfill marks budget stop" 4 "$stopped of $SHARDS shards hit the \$$BUDGET budget and stayed stopped (#4406)"
[ "$finished" -eq "$SHARDS" ] && [ ! -f "$OUT/paged-backfill-marks-finished-" ] && page "backfill marks finished" 3 "All $SHARDS shards finished. Check: $SCRIPT --out=$OUT --status (#4406)"
exit 0
