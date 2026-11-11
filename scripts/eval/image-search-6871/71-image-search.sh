#!/usr/bin/env bash
# timeout: 3h
# issue: 6871
# CLIP-B/32 vs SigLIP2-base vs SigLIP2-so400m, text→image over a 15,000-page pool (PREREGISTRATION.md,
# scripts/eval/image-search-6871). Files only; each model is deleted and the CUDA cache emptied before the next.
set -uo pipefail
J=/root/jobs/image-search-6871; PY=/root/jobs/mongol-synth-5664/venv/bin/python
export HF_HUB_OFFLINE=1 OMP_NUM_THREADS=8
cd "$J"
$PY fetch.py pool.jsonl img   # resumable: completes the pool if the background fetch has not
$PY embed.py --pool pool.jsonl --img img --queries queries.json --out out
