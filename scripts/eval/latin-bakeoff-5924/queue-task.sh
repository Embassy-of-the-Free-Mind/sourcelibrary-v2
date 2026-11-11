#!/usr/bin/env bash
# timeout: 2h
# issue: 5924
# PRIOR ART: scripts/eval/zh-residue-bakeoff-6871/drive.sh (lock holds from a Claude session; this runs inside the gpu-queue runner instead, see /root/bin/gpu-queue.sh).
# gpu-queue task 20-latin-mineru-olmocr (#5924 Latin bake-off, prereg Amendment 4): the two GPU arms that waited behind
# Mongolian (GPU priority 1, Derek 2026-10-18), then the scorer over every arm. Runs under the queue's /root/gpu.lock.
# Results: /root/jobs/latin-bakeoff-5924/results.txt (table) and results.json.
set -uo pipefail
J=/root/jobs/latin-bakeoff-5924
echo "$(date -u +%FT%TZ) [queue] start" >> "$J/drive.log"
NOLOCK=1 bash "$J/code/drive.sh" mineru olmocr > "$J/drive3.out" 2>&1
[ "$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits)" -lt 600 ] || echo "$(date -u +%FT%TZ) [queue] WARNING GPU not empty after the arms" >> "$J/drive.log"
cd "$J/tree/scripts/eval/latin-bakeoff-5924" && node score.mjs "$J/out" --out "$J/results.json" > "$J/results.txt" 2>&1
node score.mjs "$J/out" --fold-f --out "$J/results-posthoc-fold-f.json" > "$J/results-posthoc-fold-f.txt" 2>&1
echo "$(date -u +%FT%TZ) [queue] scored: $(ls $J/out/*.jsonl | xargs -n1 basename | tr '\n' ' ')" >> "$J/drive.log"
