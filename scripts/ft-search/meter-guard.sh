#!/bin/sh
# PRIOR ART: none in the repo — the batch-2 guard lived in a scratch dir and failed open on a blank reading.
# Stop a running ft-search batch before it eats an account (#7598). Reads `climits json` every 2 minutes;
# touches <dir>/STOP and kills the runner when the account passes either cap, or when its meter cannot be
# read at all (an expired climits token reads as nothing, and nothing must not mean "fine").
#
#   nohup scripts/ft-search/meter-guard.sh <dir> team@sourcelibrary.org 85 20 >/dev/null 2>&1 & disown
#   args: <batch dir> <account email> <5-hour cap %> <weekly cap %>
DIR=$1; EMAIL=$2; CAP5=${3:-85}; CAPW=${4:-20}
cd "$DIR" || exit 1
stop() { touch STOP; echo "$1" >> meter.log; pkill -f "run-batch.sh $DIR"; pkill -f "search-one.sh"; exit "$2"; }
blind=0
while true; do
  m=$(climits json 2>/dev/null | EMAIL="$EMAIL" python3 -c "import json,os,sys;d=[a for a in json.load(sys.stdin) if a.get('email')==os.environ['EMAIL'] and a.get('ok')][0];l={x['key']:x['percent'] for x in d['limits']};print(l['session:all'],l['weekly_all:all'])" 2>/dev/null)
  n=$(grep -l verdict ./*.json 2>/dev/null | wc -l | tr -d ' ')
  echo "$(date -u +%H:%M:%S) 5h=${m% *} week=${m#* } done=$n" >> meter.log
  if [ -z "$m" ]; then
    # One blank reading happens; two in a row means the meter is gone.
    blind=$((blind + 1)); [ "$blind" -ge 2 ] && stop "METER BLIND $(date -u +%H:%M:%S): re-login with climits add $EMAIL" 1
  else
    blind=0; s=${m% *}; w=${m#* }
    if [ "$s" -ge "$CAP5" ] || [ "$w" -ge "$CAPW" ]; then stop "STOPPED 5h=$s week=$w" 0; fi
  fi
  grep -q BATCHDONE progress.log 2>/dev/null && exit 0
  sleep 120
done
