#!/usr/bin/env bash
# timeout: 2h
# issue: 7853
# PRIOR ART: scripts/gpu/euro-draft-task.sh (#7567: the arm-c GPU drafts as one gpu-queue task, PERO then LightOnOCR,
# one engine at a time; this is that task over this study's two image folders, not a lane dir) and through it
# scripts/eval/euro-gpu-correct-7567/drive.sh (LO: LightOnOCR-3-1B served by vLLM for the chunk, read.py, stopped after;
# UTIL 0.6) and scripts/batch/pero-draft.py (#7263: PERO-OCR on a folder, the JSON the corrector takes).
#
# gpu-task.sh — arm 2's GPU drafts for #7853 (scripts/eval/experiments/2026-10-31-queue-routes-7853.md), one hand-queued
# gpu-queue task, ahead of the production filler (Derek 2026-10-31). Nothing here writes to Mongo or calls agy.
#   Q=/root/jobs/queue-routes-7853/qr-7853 CODE_DIR=<checkout> bash gpu-task.sh
set -uo pipefail
Q=${Q:-/root/jobs/queue-routes-7853/qr-7853}
CODE_DIR=${CODE_DIR:-/root/worktrees/job-queue-routes-7853}
G=$Q/gpu; mkdir -p "$G/out"
echo "$(date -u +%FT%TZ) start; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) MiB; pero $(ls "$G/img-pero" 2>/dev/null | wc -l), lo $(ls "$G/img-lo" 2>/dev/null | wc -l) pages"
if ls "$G/img-pero"/*.jpg >/dev/null 2>&1 && [ ! -s "$G/pero.json" ]; then
  python3 "$CODE_DIR/scripts/batch/pero-draft.py" "$G/img-pero" "$G/pero.json" --threads="${PERO_THREADS:-12}" --device="${PERO_DEVICE:-gpu}" > "$G/pero.log" 2>&1
  echo "$(date -u +%FT%TZ) PERO exit $?; $(tail -1 "$G/pero.log")"
fi
if ls "$G/img-lo"/*.jpg >/dev/null 2>&1 && [ ! -s "$G/out/LO.jsonl" ]; then
  printf '{"version":"vllm %s","served":"--gpu-memory-utilization 0.6 --max-model-len 16384 --limit-mm-per-prompt {\\"image\\":1} --mm-processor-cache-gb 0 --no-enable-prefix-caching","read":"scripts/eval/euro-gpu-correct-7567/read.py lighton (temperature 0.2, top_p 0.9, max_tokens 6000; #7567 E1/E5 recipe)"}\n' \
    "$(/root/bench/vl/bin/python -c 'import vllm;print(vllm.__version__)' 2>/dev/null)" > "$G/out/LO.jsonl.engine.json"
  J=$G C="$CODE_DIR/scripts/eval/euro-gpu-correct-7567" IMG="$G/img-lo" UTIL=${UTIL:-0.6} bash "$CODE_DIR/scripts/eval/euro-gpu-correct-7567/drive.sh" LO
  echo "$(date -u +%FT%TZ) LO rows $(wc -l < "$G/out/LO.jsonl" 2>/dev/null)"
fi
echo "$(date -u +%FT%TZ) end; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) MiB"
[ -s "$G/pero.json" ] || [ -s "$G/out/LO.jsonl" ]
