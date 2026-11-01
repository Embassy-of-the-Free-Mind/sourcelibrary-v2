#!/usr/bin/env bash
# timeout: 1h
# issue: 6740
# PRIOR ART: scripts/eval/queue-routes-7853/gpu-task.sh (#7853: the arm-c GPU drafts as one hand-queued gpu-queue task
# over a study's image folder; its PERO half, unchanged) and through it scripts/batch/pero-draft.py (#7263: PERO-OCR on a
# folder, the JSON the corrector takes; the engine the live Latin first-read lane drafts with).
#
# gpu-task.sh — the PERO drafts of arms 1 and 2 for the Latin first-read paired test
# (scripts/eval/experiments/2026-11-01-latin-first-read-paired-6740.md), one hand-queued gpu-queue task, ahead of the
# production filler. Nothing here writes to Mongo or calls agy.
#   Q=/root/jobs/latin-paired-6740/lp-6740 CODE_DIR=<checkout> bash gpu-task.sh
set -uo pipefail
Q=${Q:-/root/jobs/latin-paired-6740/lp-6740}
CODE_DIR=${CODE_DIR:-/root/worktrees/job-latin-paired-6740}
G=$Q/gpu
echo "$(date -u +%FT%TZ) start; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) MiB; pero $(ls "$G/img" 2>/dev/null | wc -l) pages"
if ls "$G/img"/*.jpg >/dev/null 2>&1 && [ ! -s "$G/pero.json" ]; then
  python3 "$CODE_DIR/scripts/batch/pero-draft.py" "$G/img" "$G/pero.json" --threads="${PERO_THREADS:-12}" --device="${PERO_DEVICE:-gpu}" > "$G/pero.log" 2>&1
  echo "$(date -u +%FT%TZ) PERO exit $?; $(tail -1 "$G/pero.log")"
fi
echo "$(date -u +%FT%TZ) end; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) MiB"
[ -s "$G/pero.json" ]
