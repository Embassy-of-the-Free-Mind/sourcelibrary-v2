#!/usr/bin/env bash
# setup-venv.sh — the vLLM 0.29.0 environment for yig_leaf_worker.py on a Blackwell (sm_120) card, CPU-only install.
# PRIOR ART: the #4523 L4 boxes' setup.sh (ops, never committed: vllm==0.29.0 + the model repo's seqpos plugin) and
# gex45's /root/jobs/tib-gutter-6871/vv (vLLM 0.31.0: V2 model runner rejects the DRY processor, then hung after
# warm-up with V1 forced, #6871). Same wheel set as the L4 run, resolved for this box on 2026-10-26 (job yig-vllm-6871):
#   vllm 0.29.0 · torch 2.13.0+cu132 (arch list includes sm_120) · transformers 5.20.2 · flashinfer-python 0.6.18 ·
#   triton 3.7.1 · vllm-paddleocr-seqpos 0.1.0 @ BDRC/tibetan-ocr 50506eb6 · driver 595.91.07 (CUDA 13.2)
# Run the worker with VLLM_USE_FLASHINFER_SAMPLER=0 OCR_VLLM_IMAGE_TOKEN_POSITIONS=sequential.
#   bash setup-venv.sh /root/jobs/<job>/venv
set -euo pipefail
V=${1:?venv path}
REV=50506eb6d8ed8738df86b448f6f6cdc688de29ea
uv venv -p python3.12 "$V"
uv pip install -p "$V/bin/python" "vllm==0.29.0" --torch-backend=auto
uv pip install -p "$V/bin/python" requests numpy \
  "vllm_paddleocr_seqpos @ git+https://huggingface.co/BDRC/tibetan-ocr@$REV#subdirectory=vllm_paddleocr_seqpos"
"$V/bin/python" -c "import torch, vllm; print(vllm.__version__, torch.__version__, torch.cuda.get_arch_list())"
