#!/usr/bin/env bash
# timeout: 4h
# issue: 6101
# PRIOR ART: gex45 gpu-queue tasks 50-zh-guarded-read (server start/stop by pid) and scripts/gpu/paddle-vl-box.sh (restart a worker that exits 3); runner scripts/gpu/paddle-zh-run.py unchanged.
# #6101 follow-up (PREREGISTRATION-paddle-split-6101.md): PaddleOCR-VL 1.6 on SPLIT leaves (NDL label strip cropped,
# right leaf then left). Arms: p1 = layout off, p2 = layout on, on the 198 shared pages; p1-fail = layout off on #6101's
# 285 every-page failures (descriptive). Native backend as P0, 2 workers, 90 s per leaf, paddle-zh-run.py unchanged
# (a wedged leaf exits 3 → restarted, it skips leaves with .txt/.err). Files only; nothing talks to Mongo.
set -uo pipefail
J=/root/jobs/paddle-split-6101
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; }
run_arm() {
  local arm=$1 layout=$2 man=$3 root=$J/$1
  mkdir -p "$root"; ln -sfn "$J/leaves" "$root/leaves"
  echo "$(date -u +%FT%TZ) $arm start (layout=$layout, $(wc -l < "$J/$man") leaves), GPU $(gpu_mib) MiB"
  local s=$(date +%s)
  for w in 0 1; do
    ( while :; do
        /root/pz/venv/bin/python /root/pz/code/paddle-zh-run.py --manifest "$J/$man" --root "$root" --worker $w --workers 2 \
          --page-timeout 90 --layout "$layout" --prefetch 2 >> "$root/worker-$w.log" 2>&1
        rc=$?; echo "$(date -u +%FT%TZ) $arm worker $w rc=$rc" >> "$root/restarts.log"; [ $rc -eq 3 ] || break
      done ) &
  done
  wait
  echo "$(date -u +%FT%TZ) $arm done in $(( $(date +%s) - s ))s: $(find "$root/out" -name '*.txt' | wc -l) txt, $(find "$root/out" -name '*.err' | wc -l) err; GPU $(gpu_mib) MiB"
}
run_arm p1 0 manifest-shared.tsv
run_arm p2 1 manifest-shared.tsv
run_arm p1-fail 0 manifest-fail.tsv
for i in $(seq 1 30); do [ "$(gpu_mib)" -lt 600 ] && break; sleep 2; done
echo "$(date -u +%FT%TZ) all arms done, GPU $(gpu_mib) MiB"
