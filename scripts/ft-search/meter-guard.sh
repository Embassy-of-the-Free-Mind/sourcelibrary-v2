#!/bin/sh
# PRIOR ART: none in the repo — the batch-2 guard lived in a scratch dir and failed open on a blank reading.
# Stop a running ft-search batch before it eats an account (#7598). Reads the meter every 2 minutes;
# touches <dir>/STOP and kills the runner when the account passes either cap, or when its meter cannot be
# read at all (an expired climits token reads as nothing, and nothing must not mean "fine").
#
#   nohup scripts/ft-search/meter-guard.sh <dir> team@sourcelibrary.org 85 20 >/dev/null 2>&1 & disown
#   args: <batch dir> <account email> <5-hour cap %> <weekly cap %>
#
# ONE meter reader for all guards: `climits json` (every account) is cached in $FT_METER_CACHE
# (default ~/.cache/ft-meter.json). A guard reads the cache; when it is older than FT_METER_TTL seconds (150) the
# first guard to take the mkdir lock refreshes it and the others just read what is there. Two or three guards
# plus the menubar app each polling the usage endpoint got it to answer 429 for 30+ minutes (2026-10-29).
# A cache older than FT_METER_MAX_AGE (600 s) is not a reading: the guard counts it as blind.
DIR=$1; EMAIL=$2; CAP5=${3:-85}; CAPW=${4:-20}
CACHE=${FT_METER_CACHE:-$HOME/.cache/ft-meter.json}
TTL=${FT_METER_TTL:-150}; MAX_AGE=${FT_METER_MAX_AGE:-600}
LOCK="$CACHE.lock"
cd "$DIR" || exit 1
mkdir -p "$(dirname "$CACHE")"

age_of() { python3 -c "import os,sys,time;print(int(time.time()-os.path.getmtime(sys.argv[1])))" "$1" 2>/dev/null || echo 999999; }

refresh_cache() {
  # mkdir is atomic on macOS and Linux (macOS has no flock). A lock left by a dead guard is cleared after 2 minutes.
  [ -d "$LOCK" ] && [ "$(age_of "$LOCK")" -gt 120 ] && rmdir "$LOCK" 2>/dev/null
  mkdir "$LOCK" 2>/dev/null || return 0   # another guard is refreshing: just read the cache
  new=$(climits json 2>/dev/null)
  # Keep the old cache when the endpoint says nothing: a blank or error body must not replace a good reading.
  if [ -n "$new" ] && printf '%s' "$new" | python3 -c "import json,sys;json.load(sys.stdin)" 2>/dev/null; then
    printf '%s' "$new" > "$CACHE.tmp.$$" && mv "$CACHE.tmp.$$" "$CACHE"
  fi
  rmdir "$LOCK" 2>/dev/null
}

read_meter() {
  if [ ! -s "$CACHE" ] || [ "$(age_of "$CACHE")" -ge "$TTL" ]; then refresh_cache; fi
  [ -s "$CACHE" ] && [ "$(age_of "$CACHE")" -lt "$MAX_AGE" ] || return 0   # too old to trust: prints nothing
  EMAIL="$EMAIL" python3 -c "import json,os,sys;d=[a for a in json.load(open(sys.argv[1])) if a.get('email')==os.environ['EMAIL'] and a.get('ok')][0];l={x['key']:x['percent'] for x in d['limits']};print(l['session:all'],l['weekly_all:all'])" "$CACHE" 2>/dev/null
}

stop() { touch STOP; echo "$1" >> meter.log; pkill -f "run-batch.sh $DIR"; pkill -f "search-one.sh"; exit "$2"; }
blind=0
while true; do
  m=$(read_meter)
  n=$(grep -l verdict ./*.json 2>/dev/null | wc -l | tr -d ' ')
  echo "$(date -u +%H:%M:%S) 5h=${m% *} week=${m#* } done=$n" >> meter.log
  if [ -z "$m" ]; then
    # A blank reading happens; BLIND_MAX (default 5, ten minutes) in a row means the meter is gone.
    blind=$((blind + 1)); [ "$blind" -ge "${BLIND_MAX:-5}" ] && stop "METER BLIND $(date -u +%H:%M:%S): re-login with climits add $EMAIL" 1
  else
    blind=0; s=${m% *}; w=${m#* }
    if [ "$s" -ge "$CAP5" ] || [ "$w" -ge "$CAPW" ]; then stop "STOPPED 5h=$s week=$w" 0; fi
  fi
  grep -q BATCHDONE progress.log 2>/dev/null && exit 0
  sleep 120
done
