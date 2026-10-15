#!/bin/bash
# PRIOR ART: scripts/eval/g4-hard-6707/run.sh — the same run-cli-arm.py loop with the quota sleep/resume rule; this adds
# the #6750 brief's per-UTC-day call cap and the chatter screen (screen.mjs) between passes.
# #6750: C4L = gemini-4-argon-low on the 365 xl pages, the units prompt byte for byte, 2 in flight, ≤ 500 agy calls per
# UTC day for this job. Quota (exit 3): sleep to the quoted reset (60 min if none), resume, at most 3 times.
#   bash scripts/eval/g4-xl-6750/run.sh [LIMIT]     LIMIT = stop after this many pages read in total (the smoke: 5)
cd "$(dirname "$0")/../../.."
S=${JOB_SCRATCH:-/mnt/HC_Volume_105839809/jobs/g4-xl-6750}; JOB=g4-xl-6750; CAP=500
export TMPDIR=$S/tmp; mkdir -p $TMPDIR
LIMIT=${1:-}
calls_today() { python3 -c "
import json,datetime
d=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d'); n=0
for l in open('/var/log/sourcelibrary/agy-calls.jsonl'):
    if '\"$JOB\"' in l and l.startswith('{\"ts\": \"'+d): n+=1
print(n)"; }
quota=0
while true; do
  node scripts/eval/g4-xl-6750/screen.mjs $S || exit 1
  todo=$(wc -l < $S/req-todo.jsonl)
  [ "$todo" = 0 ] && break
  if [ -n "$LIMIT" ]; then
    got=$(wc -l < $S/C4L.jsonl); left=$((LIMIT - got)); [ $left -le 0 ] && break
  else left=40; fi
  used=$(calls_today); room=$(( (CAP - used) / 2 ))   # each page may take 2 attempts
  if [ $room -le 0 ]; then
    secs=$(( $(date -u -d 'tomorrow 00:01' +%s) - $(date -u +%s) ))
    echo "== $(date -u +%FT%TZ) day cap: $used calls today; sleeping ${secs}s to the UTC day"; sleep $secs; continue
  fi
  n=$(( left < room ? left : room )); [ $n -gt 40 ] && n=40
  echo "== $(date -u +%FT%TZ) batch of $n ($todo to do, $used calls today)"
  python3 scripts/eval/run-cli-arm.py --job $JOB --model gemini-4-argon-low --kind translate --arm C4L \
    --requests $S/req-todo.jsonl --out $S/raw.jsonl --parallel 2 --print-timeout 300 --attempts 2 --limit $n --workdir $S/cli-ws
  rc=$?
  if [ $rc = 3 ]; then
    quota=$((quota + 1)); echo "QUOTA event $quota at $(date -u +%FT%TZ)"; tail -5 $S/QUOTA.txt
    [ $quota -gt 3 ] && { echo "STOP: quota a 4th time"; echo quota > $S/RUN-DONE; exit 3; }
    # a quoted reset ("resets in 2h13m" / "after 1h5m") if agy gave one, else an hour
    w=$(tail -20 $S/QUOTA.txt | grep -oiE '([0-9]+h)?[0-9]+m([0-9]+s)?' | tail -1)
    secs=3600
    if [ -n "$w" ]; then h=$(echo $w | grep -oE '[0-9]+h' | tr -d h); m=$(echo $w | grep -oE '[0-9]+m' | tr -d m); secs=$(( ${h:-0}*3600 + ${m:-0}*60 + 120 )); fi
    echo "sleeping ${secs}s"; sleep $secs; continue
  fi
done
node scripts/eval/g4-xl-6750/screen.mjs $S
echo "== $(date -u +%FT%TZ) done: $(wc -l < $S/C4L.jsonl) clean, $(cat $S/failed.jsonl 2>/dev/null | wc -l) failed"
echo ok > $S/RUN-DONE
