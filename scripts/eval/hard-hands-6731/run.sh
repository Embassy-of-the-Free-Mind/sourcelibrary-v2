#!/bin/bash
# PRIOR ART: scripts/eval/g4-hard-6707/run.sh (#6707) — the same run-cli-arm.py call per panel with the quota
# sleep/resume rule; this one takes the arm and panels as arguments, sleeps to the QUOTED reset ("Resets in 18h23m")
# rather than a fixed hour, and runs 2 image calls in parallel (another job shares the account, #6731 brief).
#   run.sh <ARM> <model> <panel>...      panels: greek rashi memo-<ARM> smoke
set -u
ARM=$1; MODEL=$2; shift 2
S=${JOB_SCRATCH:-/mnt/HC_Volume_105839809/jobs/hardhands-6731}/hh
W=/mnt/HC_Volume_105839809/worktrees/job-hardhands-6731
cd $W
quota=0
for P in "$@"; do
  while true; do
    echo "== $(date -u +%FT%TZ) $ARM start $P"
    python3 scripts/eval/run-cli-arm.py --job hardhands-6731 --model $MODEL --kind ocr --arm $ARM-$P \
      --requests $S/req/$P.jsonl --out $S/raw/$ARM-$P.jsonl --parallel 2 --print-timeout 300 --workdir $S/cli-ws
    rc=$?; echo "== $(date -u +%FT%TZ) $ARM $P exit $rc"
    if [ $rc = 3 ]; then
      quota=$((quota+1)); echo "QUOTA event $quota at $(date -u +%FT%TZ) on $ARM $P"
      [ $quota -gt 3 ] && { echo "STOP: quota a 4th time"; echo quota-stop > $S/DONE-$ARM; exit 3; }
      # sleep to the quoted reset (+2 min), else 60 min
      secs=$(tail -c 2000 $S/raw/QUOTA.txt | grep -o 'Resets in [0-9hms]*' | tail -1 | python3 -c "
import sys,re
m=re.search(r'(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?', sys.stdin.read().replace('Resets in ',''))
print((int(m.group(1) or 0)*3600+int(m.group(2) or 0)*60+int(m.group(3) or 0)+120) if m and m.group(0) else 3600)")
      echo "sleeping $secs s"; sleep $secs; continue
    fi
    break
  done
done
echo ok > $S/DONE-$ARM
