#!/usr/bin/env bash
# timeout: 3h
# issue: 6871
# Row 4, round 2 (r2/PREREGISTRATION.md): Yigdzin page-mode on 30 fresh guttered Tibetan pages, vLLM (V) and HF (H).
# Files only. vLLM's engine is torn down when its python exits; HF frees on exit.
set -uo pipefail
J=/root/jobs/tib-gutter-6871; cd "$J"
export OMP_NUM_THREADS=8 OCR_VLLM_IMAGE_TOKEN_POSITIONS=sequential VLLM_USE_FLASHINFER_SAMPLER=0
vv/bin/python yig_vllm.py --manifest r2-todo30.jsonl --out r2-V --mode page || echo "V failed rc=$?"
/root/jobs/mongol-synth-5664/venv/bin/python yig_page.py --manifest r2-todo30.jsonl --out r2-H --mode page
python3 parity.py r2-H r2-V 0.95; echo "parity rc=$?"
