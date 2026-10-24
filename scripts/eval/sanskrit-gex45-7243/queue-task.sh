#!/usr/bin/env bash
# timeout: 4h
# issue: 7243
# PRIOR ART: scripts/eval/latin-bakeoff-5924/queue-task.sh (a gpu-queue task that calls the bake-off driver under the
# runner's lock). gpu-queue task 151-sanskrit-7243: every GPU arm of the #7243 Sanskrit test, then the card is empty.
# Reads only /root/jobs/gpu-sanskrit-7243/in, writes only /root/jobs/gpu-sanskrit-7243/{out,drive.log}. No Mongo.
set -uo pipefail
J=/root/jobs/gpu-sanskrit-7243
echo "$(date -u +%FT%TZ) [queue] start; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) MiB" >> "$J/drive.log"
bash "$J/code/drive.sh" > "$J/drive.out" 2>&1
echo "$(date -u +%FT%TZ) [queue] end; outputs: $(ls $J/out/*.jsonl 2>/dev/null | xargs -n1 basename | tr '\n' ' ')" >> "$J/drive.log"
touch "$J/GPU-DONE"
