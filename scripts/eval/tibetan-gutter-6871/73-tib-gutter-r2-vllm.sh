#!/usr/bin/env bash
# timeout: 1h
# issue: 6871
# Row 4 round 2, arm V re-run: 72 crashed V at start-up (vLLM 0.31's V2 model runner rejects a custom logits
# processor: "DRYLogitsProcessor is not a subclass of …"), the known fix is VLLM_USE_V2_MODEL_RUNNER=0. Arm unchanged.
set -uo pipefail
J=/root/jobs/tib-gutter-6871; cd "$J"
export OMP_NUM_THREADS=8 OCR_VLLM_IMAGE_TOKEN_POSITIONS=sequential VLLM_USE_FLASHINFER_SAMPLER=0 VLLM_USE_V2_MODEL_RUNNER=0
vv/bin/python yig_vllm.py --manifest r2-todo30.jsonl --out r2-V --mode page
python3 parity.py r2-H r2-V 0.95; echo "parity rc=$?"
