#!/usr/bin/env bash
# after-gpu.sh: the steps after gpu-queue task 50-zh-guarded-read (#6871 row 3). Run from the repo root on a box with
# agy signed in and ssh to gex45. Resumable: re-run it after a quota stop or a crash and it continues.
# PRIOR ART: none for this lane; it chains this directory's flash.py and scripts/workers/paddle-zh-guarded-lane.mjs.
#   1. pull the per-book JSONLs + run.json from gex45 (refuses while the task has not written finished.json,
#      unless PARTIAL=1);
#   2. flash.py over every FLASH-routed page ($0, agy; ≈ 130 pages/h at 2 parallel);
#   3. the writer, DRY RUN, over everything: counts + a report of what it would write and what it holds.
# It never runs the writer with --apply; the apply command is printed at the end.
#   JOB_SCRATCH=/data/scratch/sl/jobs/<job> bash scripts/gpu/zh-guarded-read-6871/after-gpu.sh
set -euo pipefail
GPU=root@65.108.136.89; SRC=/root/jobs/gpu-queue/50-zh-guarded-read
D=${JOB_SCRATCH:?set JOB_SCRATCH}/zh-guarded-read; ENVF=${ENVF:-/data/scratch/sl/sourcelibrary/.env.production.local}
mkdir -p "$D"
if ! ssh "$GPU" "test -f $SRC/finished.json" && [ "${PARTIAL:-0}" != 1 ]; then
  echo "GPU task not finished: $(ssh "$GPU" "tail -1 $SRC/drive.log")"; exit 4
fi
rsync -a "$GPU:$SRC/books/" "$D/books/"; scp -q "$GPU:$SRC/run.json" "$D/run.json"
scp -q "$GPU:$SRC/finished.json" "$D/finished.json" 2>/dev/null || true
echo "books: $(ls "$D/books" | wc -l) of 190"
python3 scripts/gpu/zh-guarded-read-6871/flash.py --books "$D/books" --out "$D/flash" || { rc=$?; [ $rc = 3 ] && echo "agy quota stop: re-run later, it resumes"; exit $rc; }
node --env-file="$ENVF" scripts/workers/paddle-zh-guarded-lane.mjs --books "$D/books" --run "$D/run.json" --flash "$D/flash/flash.jsonl" \
  --report "$D/dryrun-all.jsonl" | grep -v '^DOWNSTREAM' | tail -3
gzip -f "$D/dryrun-all.jsonl"
echo "APPLY (Derek's call, #6871): node --env-file=.env.production.local scripts/workers/paddle-zh-guarded-lane.mjs --books $D/books --run $D/run.json --flash $D/flash/flash.jsonl --report $D/apply.jsonl --apply"
