#!/bin/bash
# PRIOR ART: scripts/workers/disk-alarm.sh — same state-file and repeat pattern, but it reads df, not GitHub; nothing in
# scripts/workers, scripts/maintenance or the box crontabs watched the Actions queue (searched "queued", "runs?status").
#
# CI-queue alarm (#239). Pages ntfy sourcelibrary-uptime (High) when the oldest QUEUED work in this repo's Actions is older
# than CI_QUEUE_MAX_MIN (60): a queued run, or a queued job inside a run already in progress (a matrix shard or a second
# job waiting for a runner). Repeats at most every CI_QUEUE_REPEAT_SEC (3 h) while it stays so; one low page when it clears.
#
# Why: on 2026-11-13 PR test runs sat queued for ~5 hours on the self-hosted `sl` runners and nobody noticed; auto-merge
# just waited. A queued run produces no failure, so nothing else here would ever page for it.
#
# Not counted: runs in `pending` (held by a concurrency group behind a live run of the same group) and `waiting`
# (environment approval); both wait by design.
#
# Cron (l7a, infrastructure/l7a-crontab; gh is logged in there):
#   */15 * * * * f=/data/scratch/sl/sourcelibrary/scripts/workers/ci-queue-alarm.sh; [ -x $f ] && $f >> /data/scratch/sl/logs/ci-queue-alarm.log 2>&1
# Try it: scripts/workers/ci-queue-alarm.sh --dry-run            (prints what it would page, sends nothing, keeps state)
#         CI_QUEUE_MAX_MIN=1 scripts/workers/ci-queue-alarm.sh --dry-run   (forces the stale path when anything is queued)
set -u
DRY=0
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; -h|--help) sed -n 2,20p "$0"; exit 0 ;; *) echo "unknown arg $a" >&2; exit 2 ;; esac; done
REPO=${CI_QUEUE_REPO:-Embassy-of-the-Free-Mind/sourcelibrary-v3}
MAX_MIN=${CI_QUEUE_MAX_MIN:-60}
REPEAT_SEC=${CI_QUEUE_REPEAT_SEC:-10800}
STATE=${CI_QUEUE_STATE:-/var/lib/sourcelibrary/ci-queue-alarm.state}
TOPIC=${CI_QUEUE_TOPIC:-https://ntfy.sh/sourcelibrary-uptime}
now=$(date -u +%FT%TZ); epoch=$(date +%s)

# One line per queued item: "<epoch queued since>\t<workflow name>\t<branch>\t<what>".
# gh prints an API error body on stdout, so each answer goes through a temp file and is kept only on success.
items=$(mktemp); one=$(mktemp); trap 'rm -f "$items" "$one"' EXIT
ok=1
gh api --paginate "repos/$REPO/actions/runs?status=queued&per_page=100" \
  --jq '.workflow_runs[] | [((.run_started_at // .created_at) | fromdateiso8601), .name, .head_branch, "run \(.id)"] | @tsv' \
  > "$one" && cat "$one" >> "$items" || ok=0
if [ $ok = 1 ]; then
  ids=$(gh api --paginate "repos/$REPO/actions/runs?status=in_progress&per_page=100" \
    --jq '.workflow_runs[] | [.id, .name, .head_branch] | @tsv') || { ok=0; ids=""; }
  while IFS=$'\t' read -r id name branch; do
    [ -n "$id" ] || continue
    gh api "repos/$REPO/actions/runs/$id/jobs?filter=latest&per_page=100" \
      --jq ".jobs[] | select(.status == \"queued\") | [(.created_at | fromdateiso8601), \"$name\", \"$branch\", \"job \" + .name] | @tsv" \
      > "$one" && cat "$one" >> "$items" || ok=0
  done <<< "$ids"
fi

count=$(grep -c . "$items")
oldest=$(sort -n "$items" | head -1)
if [ $ok = 0 ]; then
  level=unknown; age=?
elif [ -z "$oldest" ]; then
  level=ok; age=0
else
  age=$(( (epoch - ${oldest%%$'\t'*}) / 60 ))
  level=ok; [ "$age" -ge "$MAX_MIN" ] && level=stale
fi
o_name=$(printf '%s' "$oldest" | cut -f2); o_branch=$(printf '%s' "$oldest" | cut -f3); o_what=$(printf '%s' "$oldest" | cut -f4)

prev=ok; last_paged=0; before_blip=ok
[ -f "$STATE" ] && read -r prev last_paged before_blip < "$STATE"
prev=${prev:-ok}; last_paged=${last_paged:-0}
echo "$now queued=$count oldest_min=$age level=$level prev=$prev${oldest:+ oldest=\"$o_name\" $o_branch $o_what}"

# One unreadable run is usually a GitHub blip: record it as unknown1 and page only if the next run (15 min) fails too.
if [ "$level" = unknown ] && [ "$prev" != unknown ] && [ "$prev" != unknown1 ]; then
  [ $DRY = 1 ] || { mkdir -p "$(dirname "$STATE")"; echo "unknown1 $last_paged $prev" > "$STATE"; }
  echo "$now unreadable once; pages if the next run is unreadable too"; exit 0
fi
if [ "$prev" = unknown1 ] && [ "$level" != unknown ]; then
  # The blip passed. Carry the level that held before it, so a stale queue is neither re-paged nor lost.
  prev=${before_blip:-ok}
  [ $DRY = 1 ] || echo "$prev $last_paged" > "$STATE"
fi
page=""
[ "$level" != "$prev" ] && page=change
[ "$level" = stale ] && [ "$prev" = stale ] && [ $((epoch - last_paged)) -ge "$REPEAT_SEC" ] && page=repeat
[ -z "$page" ] && exit 0

case "$level" in
  stale)   runners=$(gh api "repos/$REPO/actions/runners?per_page=100" --jq '[.runners[] | select(.status == "online")] as $on
             | "\($on | length) of \(.total_count) runners online, \([$on[] | select(.busy)] | length) busy; offline: \([.runners[] | select(.status != "online") | .name] | join(", ") | if . == "" then "none" else . end)"' 2>/dev/null || echo "runner list unreadable")
           title="CI queue stuck: $count queued, oldest ${age} min"; prio=high
           msg="Oldest queued: \"$o_name\" on $o_branch ($o_what), waiting ${age} min (alarm at ${MAX_MIN}). $count queued runs/jobs in $REPO. Self-hosted runners: $runners." ;;
  unknown) title="CI queue check UNKNOWN"; prio=high
           msg="gh api could not list $REPO's Actions runs from $(hostname). Treat as not-clear until checked (#239)." ;;
  ok)      [ "$prev" = unknown ] && { title="CI queue check readable again"; } || title="CI queue moving again"; prio=low
           msg="$count queued now$( [ "$count" -gt 0 ] && echo ", oldest ${age} min" )." ;;
esac
[ "$page" = repeat ] && title="STILL: $title"
if [ $DRY = 1 ]; then
  echo "$now DRY RUN, would page ($page, $prio): $title — $msg"
  exit 0
fi
mkdir -p "$(dirname "$STATE")"
if NTFY_SRC=ci-queue-alarm.sh "$(dirname "$0")/ntfy-send.sh" "$TOPIC" "$title" "$prio" hourglass "$msg"; then
  echo "$level $epoch" > "$STATE"; echo "$now paged ($page): $title"
else
  echo "$now ntfy send FAILED; state left at $prev so the next run retries"
fi
