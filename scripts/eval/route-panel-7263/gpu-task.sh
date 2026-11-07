#!/usr/bin/env bash
# timeout: 2h
# issue: 7263
# PRIOR ART: scripts/eval/queue-routes-7853/gpu-task.sh (PERO on one image folder, as one hand-queued gpu-queue task);
# this is its PERO half over the panel's folder. Nothing here writes to Mongo or calls agy.
set -uo pipefail
G=/root/jobs/route-panel-1-7263/panel/latin/gpu
CODE_DIR=/root/worktrees/job-route-panel-1-7263
echo "$(date -u +%FT%TZ) start; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) MiB; $(ls "$G/img" | wc -l) pages"
SECS0=$(date +%s)
python3 "$CODE_DIR/scripts/batch/pero-draft.py" "$G/img" "$G/pero.json" --threads="${PERO_THREADS:-12}" --device="${PERO_DEVICE:-gpu}" > "$G/pero.log" 2>&1
echo "exit $? seconds $(( $(date +%s) - SECS0 )) device ${PERO_DEVICE:-gpu}" | tee "$G/pero.done"
[ -s "$G/pero.json" ]
