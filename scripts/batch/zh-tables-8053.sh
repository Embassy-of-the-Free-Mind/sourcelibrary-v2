#!/usr/bin/env bash
# zh-tables-8053.sh — the table-aware read for Siku 表 volumes (#8053, hole D).
#
# PRIOR ART: scripts/batch/claude-ocr.mjs (Opus CLI read, no draft) and
# scripts/batch/ocr-convergence/correct.mjs (Opus corrects a stored draft) are the two arms, reused
# unchanged; scripts/batch/cli-ocr.mjs apply is the writer (guards, revisions, --mark-stale).
# This file only records which arm a 表 page gets, as the 30-page blind cell test decided
# (scripts/eval/experiments/2026-11-04-zh-tables-cell-8053.md):
#   - page with no stored OCR      → Opus reads it from the image (read arm)
#   - page with a Paddle draft     → Opus corrects the draft with the image open (correct arm)
# Paddle alone (1/20 serve-grade) and flash (0/30) failed the cell test; do not use them on 表 pages.
#
# $0: both arms run on the Claude CLI subscription. Nothing here translates (the Siku lane is
# STOPPED, #7914).
#
# Usage:
#   scripts/batch/zh-tables-8053.sh read    <page-ids.json> <out-dir>
#   scripts/batch/zh-tables-8053.sh correct <set-dir>             # set-dir built by correct.mjs's set builder
# Run from the repo root on a box with .env.production.local; detach with nohup, it takes hours.
set -euo pipefail
ENV_FILE="${ENV_FILE:-/data/scratch/sl/sourcelibrary/.env.production.local}"
REASON="#8053 table-aware read: 表 page, routed lane (no-OCR page: Opus read; Paddle draft: Opus corrects it), gated by the 30-page blind cell test (25/30 serve_ok, 5/5 decoys caught)"
STALE="zh-tables-8053"
JOB="${JOB:-zh-complete-sets-8053-tables}"

case "${1:-}" in
  read)
    ids="$2"; out="$3"
    node --env-file="$ENV_FILE" scripts/batch/claude-ocr.mjs --page-ids-file="$ids" --reread \
      --out="$out" --model=opus --per-call=1 --concurrency=3 --job="$JOB"
    node --env-file="$ENV_FILE" scripts/batch/cli-ocr.mjs apply --out="$out" \
      --mark-stale="$STALE" --reason="$REASON" --apply
    echo READ-APPLY-DONE
    ;;
  correct)
    set_dir="$2"
    node --env-file="$ENV_FILE" scripts/batch/ocr-convergence/correct.mjs --set-dir="$set_dir" \
      --model=opus --per-call=1 --concurrency=3 --job="$JOB"
    node --env-file="$ENV_FILE" scripts/batch/cli-ocr.mjs apply --out="$set_dir/reads" \
      --mark-stale="$STALE" --reason="$REASON" --apply
    echo CORRECT-APPLY-DONE
    ;;
  *)
    sed -n '2,22p' "$0"; exit 2 ;;
esac
