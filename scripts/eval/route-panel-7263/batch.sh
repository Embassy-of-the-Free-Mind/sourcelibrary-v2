#!/usr/bin/env bash
# PRIOR ART: none for a stop-rule driver; scripts/eval/router-confirm/confirm.mjs runs fixed n in one pass.
# One cell's batches under the stop rule: outcomes -> look -> read the active arms to the next look -> judge -> look.
# usage: batch.sh <cell>. Exits 0 when every pair is decided, 3 on an agy quota stop, 4 on a low quota, 5 on the judge's pace guard.
set -uo pipefail
C=$1; H=$(cd "$(dirname "$0")" && pwd); O=${JOB_SCRATCH}/panel
N="node --env-file=/root/sourcelibrary/.env.production.local"
PAIRS=$(node -e "import('$H/lib.mjs').then(m=>console.log(JSON.stringify(m.CELLS['$C'].pairs)))")
HOME_AGY=$(node -e "import('$H/lib.mjs').then(m=>console.log(m.CELLS['$C'].agy_home))")
MIN_WEEKLY=${MIN_WEEKLY:-0.12}; MIN_5H=${MIN_5H:-0.08}
stuck=0; prev=""
while true; do
  $N "$H/judge.mjs" outcomes --cell="$C"
  L=$(python3 "$H/look.py" "$O/$C" "$PAIRS"); echo "$(date -u +%FT%TZ) $L"
  S=$(echo "$L" | tail -1); UPTO=$(echo "$S" | python3 -c "import json,sys;print(json.load(sys.stdin)['next_upto'])")
  ARMS=$(echo "$S" | python3 -c "import json,sys;print(' '.join(a for a in json.load(sys.stdin)['active'] if a!='stored'))")
  [ "$UPTO" = 0 ] && { echo "ALL DECIDED"; exit 0; }
  [ "$S" = "$prev" ] && stuck=$((stuck+1)) || stuck=0; prev=$S
  [ $stuck -ge 3 ] && { echo "STUCK at $S"; exit 6; }
  Q=$(AGY_HOME=$HOME_AGY agy -p /quota --output-format json --model gemini-3.8-flash-low 2>/dev/null | python3 -c "import json,sys;g=json.load(sys.stdin)['command']['data']['groups'][0]['buckets'];d={b['window']:b['remaining_fraction'] for b in g};print(d['weekly'],d['5h'])")
  echo "quota weekly/5h $Q"
  python3 -c "import sys;w,h=map(float,'$Q'.split());sys.exit(0 if w>=$MIN_WEEKLY and h>=$MIN_5H else 1)" || { echo "LOW QUOTA $Q"; exit 4; }
  $N "$H/arms.mjs" retry-killed --cell="$C"
  rc=0; pids=()
  for a in $ARMS; do $N "$H/arms.mjs" run --cell="$C" --arm="$a" --upto="$UPTO" --conc="${ARM_CONC:-1}" & pids+=($!); done
  for p in "${pids[@]}"; do wait "$p" || rc=$?; done
  # a read the box killed is re-read once before anything is judged (Amendment 1)
  if [ $rc != 3 ] && $N "$H/arms.mjs" retry-killed --cell="$C" | grep -qv ': 0 keys'; then
    pids=(); for a in $ARMS; do $N "$H/arms.mjs" run --cell="$C" --arm="$a" --upto="$UPTO" --conc=1 & pids+=($!); done
    for p in "${pids[@]}"; do wait "$p" || rc=$?; done
  fi
  [ $rc = 3 ] && { echo "AGY QUOTA STOP"; exit 3; }
  $N "$H/judge.mjs" main --cell="$C" --upto="$UPTO" --conc=3 || { echo "JUDGE STOP"; exit 5; }
done
