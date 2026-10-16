#!/bin/bash
# PRIOR ART: cli-queue-6293/syriac/part1.sh — the same run-cli-arm.py call per panel, with the quota sleep/resume rule of Amendment 4.
# G4L on the six panels, Amendment 4.1 (#6707). Quota: sleep 60 min (or quoted reset), resume, at most 3 times.
cd /mnt/HC_Volume_105839809/worktrees/job-g4-hard2-6707
S=/mnt/HC_Volume_105839809/jobs/g4-hard2-6707; Q=/mnt/HC_Volume_105839809/jobs/g4-hard-6707/req
E=/mnt/HC_Volume_105839809/jobs/syriac-pareto-6295/cli-export
export JOB_SCRATCH=$S TMPDIR=$S/tmp; mkdir -p $TMPDIR
quota=0
for p in syr-ms syr-print zh-ms greek zh-print tib; do
  extra=""; [ $p = syr-print ] && extra="--prompt-file $E/ocr-prompt.txt"
  while true; do
    echo "== $(date -u +%FT%TZ) start $p" 
    python3 scripts/eval/run-cli-arm.py --job g4-hard2-6707 --model gemini-4-argon-low --kind ocr --arm G4L-$p \
      --requests $Q/$p.jsonl --out $S/raw/G4L-$p.raw.jsonl --parallel 3 --print-timeout 300 --workdir $S/cli-ws $extra
    rc=$?; echo "== $(date -u +%FT%TZ) $p exit $rc"
    if [ $rc = 3 ]; then
      quota=$((quota+1)); echo "QUOTA event $quota at $(date -u +%FT%TZ) on $p"
      [ $quota -gt 3 ] && { echo "STOP: quota a 4th time"; echo stop > $S/DONE; exit 3; }
      sleep 3600; continue
    fi
    break
  done
done
echo ok > $S/DONE
