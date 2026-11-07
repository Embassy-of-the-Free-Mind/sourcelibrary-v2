#!/usr/bin/env bash
# rebuild packets for pages now ready, judge them; repeat until every sample page has a verdict or the judge stops
J=/root/jobs/euro-gpu-e3e5-7567/e5; R=/root/worktrees/job-euro-gpu-e3e5-7567
for i in $(seq 1 200); do
  [ -f $J/judge-final ] && FINAL=1 python3 $R/scripts/eval/euro-gpu-correct-7567/e5-judge-packets.py $J || python3 $R/scripts/eval/euro-gpu-correct-7567/e5-judge-packets.py $J
  node $R/scripts/eval/ocr-per-call-7522/judge.mjs --scratch=$J/judge-run --jobs=4; rc=$?
  [ $rc -eq 3 ] && { echo "judge stopped (usage limit) at $(date -u)"; exit 3; }
  n=$(ls $J/judge-run/judge/out 2>/dev/null | wc -l)
  [ $n -ge $(wc -l < $J/judge-sample.txt) ] && { echo "all judged"; exit 0; }
  [ -f $J/judge-final ] && [ $n -ge $(ls $J/judge-run/judge/packets | wc -l) ] && { echo "final pass done: $n"; exit 0; }
  sleep 120
done
