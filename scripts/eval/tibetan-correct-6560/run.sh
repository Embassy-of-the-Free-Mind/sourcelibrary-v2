#!/bin/bash
# #6560 arms, $0: Gemini 3.1 Pro through `agy -p` (run-cli-arm.py from branch job-cli-ocr-fix-6523c @5fa9ae0b:
# sentinels + tool gate) and Opus through `claude -p` (run-claude-arm.py from branch job-replicate-6547 @6a5227f5:
# --restricted, Read only). Copies of both live in $JOB_SCRATCH/runner (SOURCE_SHA records the commits).
# One page per call. One Claude call and one Gemini call in flight at a time (2 total; the box runs other jobs).
#   usage: run.sh [LIMIT]       (LIMIT applies to redo/corr; corr-anchor gets min(LIMIT,10)); resumable
set -u
cd "$JOB_SCRATCH"
L=${1:+--limit $1}
LA=${1:+--limit $(( $1 < 10 ? 2 : 10 ))}
R=$JOB_SCRATCH/runner/eval/run-cli-arm.py
C=$JOB_SCRATCH/runner/eval/run-claude-arm.py
mkdir -p out
( for a in redo corr corr-anchor; do lim=$L; [ $a = corr-anchor ] && lim=$LA
    python3 $C --requests req/$a.jsonl --out out/opus-$a.jsonl --arm tib-opus-$a --model opus --parallel 1 --timeout 600 $lim; done; echo CLAUDE_DONE ) &
for a in redo corr corr-anchor; do lim=$L; [ $a = corr-anchor ] && lim=$LA
  python3 $R --requests req/$a.jsonl --out out/pro-$a.jsonl --arm tib-pro-$a --model gemini-3.1-pro-high --job tib-correct-6560 --kind ocr --parallel 1 --tool-gate --print-timeout 300 $lim || { echo AGY_EXIT $?; break; }
done
wait; echo ALL_DONE
