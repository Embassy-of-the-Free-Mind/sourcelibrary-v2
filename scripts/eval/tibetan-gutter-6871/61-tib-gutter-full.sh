#!/usr/bin/env bash
# timeout: 48h
# issue: 6871
# Row 4 full read, queued only after 60-tib-gutter-bakeoff PASSED its prereg: Yigdzin 1 whole-page reads of all
# 5,132 guttered Tibetan pages, to FILES (full/). Applying them is a separate decision (#4523 write rule).
# 1. vLLM reader on the 30 bake-off pages; must match the HF reads (median syllable ratio >= 0.95), else fall back.
# 2. the 5,132 pages with vLLM (or HF if vLLM failed parity). Resumable: a page with a .txt is skipped.
set -uo pipefail
J=/root/jobs/tib-gutter-6871; cd "$J"
export OMP_NUM_THREADS=8 OCR_VLLM_IMAGE_TOKEN_POSITIONS=sequential VLLM_USE_FLASHINFER_SAMPLER=0 VLLM_USE_V2_MODEL_RUNNER=0
ARM=${ARM:-page}   # set from the bake-off verdict
if vv/bin/python yig_vllm.py --manifest todo30.jsonl --out arm-vllm --mode "$ARM" && vv/bin/python parity.py "arm-$ARM" arm-vllm 0.95; then
  echo "vLLM parity ok: full run under vLLM"
  vv/bin/python yig_vllm.py --manifest full.jsonl --out full --mode "$ARM"
else
  echo "vLLM failed or missed parity: full run under HF (slow, resumable)"
  /root/jobs/mongol-synth-5664/venv/bin/python yig_page.py --manifest full.jsonl --out full --mode "$ARM"
fi
echo "full: $(ls full | grep -c '\.txt$') txt, $(ls full | grep -c '\.err$') err"
