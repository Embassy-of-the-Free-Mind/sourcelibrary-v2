#!/usr/bin/env bash
# timeout: 1h
# issue: 6101
# PRIOR ART: gex45 gpu-queue tasks 50-zh-guarded-read (server start/stop by pid) and scripts/gpu/paddle-vl-box.sh (restart a worker that exits 3); runner scripts/gpu/paddle-zh-run.py unchanged.
# Completes arm p2 (layout on) of 05-paddle-split-6101: its worker 1 (the LEFT leaves) timed out on its first leaf and then
# hit a MemoryError reloading the layout pipeline beside worker 0, so it stopped. Worker 0's right leaves are done; this
# runs worker 1 of 2 ALONE (same manifest split, same settings), retrying a crash up to 3 times. Files only.
set -uo pipefail
J=/root/jobs/paddle-split-6101; root=$J/p2
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; }
echo "$(date -u +%FT%TZ) p2 worker 1 start, GPU $(gpu_mib) MiB"; s=$(date +%s); tries=0
while :; do
  /root/pz/venv/bin/python /root/pz/code/paddle-zh-run.py --manifest "$J/manifest-shared.tsv" --root "$root" --worker 1 --workers 2 \
    --page-timeout 90 --layout 1 --prefetch 2 >> "$root/worker-1b.log" 2>&1
  rc=$?; echo "$(date -u +%FT%TZ) p2 worker 1 rc=$rc" >> "$root/restarts.log"
  [ $rc -eq 0 ] && break; [ $rc -eq 3 ] && continue
  tries=$((tries + 1)); [ $tries -ge 3 ] && break; sleep 20
done
for i in $(seq 1 30); do [ "$(gpu_mib)" -lt 600 ] && break; sleep 2; done
echo "$(date -u +%FT%TZ) p2 done in $(( $(date +%s) - s ))s: $(find "$root/out" -name '*.txt' | wc -l) txt, $(find "$root/out" -name '*.err' | wc -l) err; GPU $(gpu_mib) MiB"
