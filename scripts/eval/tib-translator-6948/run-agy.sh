#!/bin/bash
# PRIOR ART: scripts/eval/g4-xl-6750/run.sh — the same loop (screen between passes, ≤ 500 agy calls per UTC day for the
# job, quota sleep to the quoted reset, at most 3 times); here the arm and model are arguments and each arm has its own
# directory under $JOB_SCRATCH. #6948.
#   bash scripts/eval/tib-translator-6948/run-agy.sh G4L gemini-4-argon-low
cd "$(dirname "$0")/../../.."
ARM=$1; MODEL=$2; JOB=${JOB:-tib-translator-6948}; CAP=500  # JOB=tib-stored-6948 for the stored-English run
S=$JOB_SCRATCH/$ARM; mkdir -p $S; cp -n $JOB_SCRATCH/req.jsonl $S/req.jsonl
export TMPDIR=$JOB_SCRATCH/tmp; mkdir -p $TMPDIR
calls_today() { python3 -c "
import json,datetime
d=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d'); n=0
for l in open('/var/log/sourcelibrary/agy-calls.jsonl'):
    if '\"$JOB\"' in l and l.startswith('{\"ts\": \"'+d): n+=1
print(n)"; }
quota=0
while true; do
  node scripts/eval/tib-translator-6948/screen.mjs $S $ARM || exit 1
  todo=$(wc -l < $S/req-todo.jsonl)
  [ "$todo" = 0 ] && break
  used=$(calls_today); room=$(( (CAP - used) / 2 ))
  if [ $room -le 0 ]; then
    secs=$(( $(date -u -d 'tomorrow 00:01' +%s) - $(date -u +%s) ))
    echo "== $(date -u +%FT%TZ) day cap: $used calls today; sleeping ${secs}s"; sleep $secs; continue
  fi
  n=$(( todo < room ? todo : room )); [ $n -gt 40 ] && n=40
  echo "== $(date -u +%FT%TZ) $ARM batch of $n ($todo to do, $used calls today)"
  python3 scripts/eval/run-cli-arm.py --job $JOB --model $MODEL --kind translate --arm $ARM \
    --requests $S/req-todo.jsonl --out $S/raw.jsonl --parallel 2 --print-timeout 300 --attempts 2 --limit $n --workdir $S/cli-ws
  rc=$?
  if [ $rc = 3 ]; then
    quota=$((quota + 1)); echo "QUOTA event $quota at $(date -u +%FT%TZ)"; tail -5 $S/QUOTA.txt
    [ $quota -gt 3 ] && { echo "STOP: quota a 4th time"; echo quota > $S/RUN-DONE; exit 3; }
    w=$(tail -20 $S/QUOTA.txt | grep -oiE '([0-9]+h)?[0-9]+m([0-9]+s)?' | tail -1)
    secs=3600
    if [ -n "$w" ]; then h=$(echo $w | grep -oE '[0-9]+h' | tr -d h); m=$(echo $w | grep -oE '[0-9]+m' | tr -d m); secs=$(( ${h:-0}*3600 + ${m:-0}*60 + 120 )); fi
    echo "sleeping ${secs}s"; sleep $secs; continue
  fi
done
node scripts/eval/tib-translator-6948/screen.mjs $S $ARM
echo "== $(date -u +%FT%TZ) $ARM done: $(wc -l < $S/$ARM.jsonl) clean, $(cat $S/failed.jsonl 2>/dev/null | wc -l) failed"
echo ok > $S/RUN-DONE
