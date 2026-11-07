#!/usr/bin/env bash
# timeout: 9h
# issue: 6871
# PRIOR ART: scripts/eval/image-search-6871/71-image-search.sh (the eval task: same venv, offline HF, files only).
#
# SigLIP2-so400m to FILES on gex45 (#6871 row 8, approved by Derek 2026-10-21): (a) re-embed the ~152K gallery crops,
# then (b) the 100K archived-master page pilot that measures fetch, decode and GPU throughput, R2 read volume and disk
# per 1M vectors. Inputs are built beforehand on the CPU (build-manifests.mjs → $J/crops.jsonl, $J/pilot.jsonl).
# Every shard is a checkpoint, so re-queue this script under a new name to resume after a timeout. Torch is capped at
# 0.6 of the card; the python process exits at the end of each phase, so the card goes back to idle. Nothing here
# writes to Mongo, Supabase or the vector service.
#   cp scripts/gpu/siglip2-6871/6455-siglip2-so400m-6871.sh /tmp/x.sh && /root/bin/gpu-queue.sh add /tmp/x.sh 6455-siglip2-so400m-6871
set -uo pipefail
J=/root/jobs/siglip2-6871; PY=/root/jobs/mongol-synth-5664/venv/bin/python
export HF_HUB_OFFLINE=1 OMP_NUM_THREADS=4
DEADLINE=$(( $(date +%s) + 8 * 3600 + 30 * 60 ))   # stop between shards, inside the 9 h timeout
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1; }
echo "$(date -u +%FT%TZ) start; card $(gpu_mib) MiB; disk $(df -h / | awk 'NR==2{print $4}') free"
for phase in crops pilot; do
  free_g=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
  [ "${free_g:-0}" -lt 15 ] && { echo "root disk ${free_g}G free < 15G: stopping before $phase"; exit 3; }
  "$PY" "$J/code/embed-shards.py" --manifest "$J/$phase.jsonl" --out "$J/out/$phase" --deadline "$DEADLINE"; rc=$?
  echo "$(date -u +%FT%TZ) $phase exit $rc; card $(gpu_mib) MiB"
  [ $rc -eq 75 ] && { incomplete=1; break; }   # deadline: shards left, re-queue under a new name to resume
  [ $rc -ne 0 ] && exit 4
done
"$PY" "$J/code/summarize.py" "$J/out/crops" "$J/out/pilot" | tee "$J/summary.json"
du -sh "$J/out/crops" "$J/out/pilot"
echo "$(date -u +%FT%TZ) end; card $(gpu_mib) MiB"
[ -n "${incomplete:-}" ] && { echo "incomplete: shards left (see manifest.json)"; exit 75; }
exit 0
