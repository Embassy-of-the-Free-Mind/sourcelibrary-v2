#!/usr/bin/env bash
# agy.sh — B2 and B2r (agy Gemini 3.8 Flash low, $0) over the fresh draw (#6871 row 3). Run from the repo root on a box with agy.
# PRIOR ART: scripts/eval/run-cli-arm.py (the runner, unchanged); requests.jsonl = {uid, image} per drawn page, prompt.txt = read.py PROMPT of zh-residue-bakeoff-6871.
cd scripts/eval
for arm in B2 B2r; do
  python3 run-cli-arm.py --requests $JOB_SCRATCH/requests.jsonl --out $JOB_SCRATCH/$arm.jsonl --arm $arm --model gemini-3.8-flash-low     --job zh-confirm-6871 --kind ocr --parallel 2 --prompt-file $JOB_SCRATCH/prompt.txt --workdir $JOB_SCRATCH/agyws-$arm
  echo "$arm rc=$? $(date -u +%FT%TZ)"
done
echo AGY-END
