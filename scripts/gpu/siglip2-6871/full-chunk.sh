#!/usr/bin/env bash
# timeout: 12h
# issue: 6871
# PRIOR ART: 6455-siglip2-so400m-6871.sh (this directory: the crops + 100K pilot task — same venv, offline HF, same
# shard checkpoints) — that one runs two fixed manifests; this is ONE chunk of the full page run, stamped per chunk by
# siglip2-requeue.sh, which is what queues it. Do not queue this file by hand: __CHUNK__ below is the placeholder.
#
# SigLIP2-so400m page vectors to FILES on gex45, full run (#6871 row 8; Derek approved 2026-10-21 and 2026-10-26).
# One chunk = $J/full/chunk-NNN.jsonl (1.5M rows ≈ 9.5 h at the measured 44 img/s) → $J/out/full/chunk-NNN/.
# Every 10K-row shard is a checkpoint: a chunk that hits the deadline exits 75 and siglip2-requeue.sh re-queues it under
# a new name, resuming at the first unfinished shard. Reads R2 straight over the S3 API (fetchlib.py; no Worker
# request), torch capped at 0.6 of the card, the python process exits at the end, nothing goes to Mongo/Supabase/vectors.
set -uo pipefail
CHUNK=__CHUNK__
J=/root/jobs/siglip2-6871; PY=/root/jobs/mongol-synth-5664/venv/bin/python
export HF_HUB_OFFLINE=1 OMP_NUM_THREADS=4
. "$J/r2.env"   # R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME only (chmod 600)
DEADLINE=$(( $(date +%s) + 11 * 3600 + 30 * 60 ))   # stop between shards, inside the 12 h timeout
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1; }
free_g=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
echo "$(date -u +%FT%TZ) start chunk $CHUNK; card $(gpu_mib) MiB; root disk ${free_g}G free"
[ "${free_g:-0}" -lt 30 ] && { echo "root disk ${free_g}G free < 30G: not starting chunk $CHUNK"; exit 3; }
"$PY" "$J/code-full/embed-shards.py" --manifest "$J/full/chunk-$CHUNK.jsonl" --out "$J/out/full/chunk-$CHUNK" \
  --procs 12 --workers 8 --deadline "$DEADLINE"; rc=$?
echo "$(date -u +%FT%TZ) chunk $CHUNK exit $rc; card $(gpu_mib) MiB"
"$PY" "$J/code-full/summarize.py" "$J/out/full/chunk-$CHUNK" | tee "$J/out/full/chunk-$CHUNK/summary.json"
exit $rc   # 75 = deadline with shards left (re-queued by siglip2-requeue.sh); 0 = chunk complete
