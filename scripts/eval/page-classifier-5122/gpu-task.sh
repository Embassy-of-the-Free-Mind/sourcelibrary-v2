#!/usr/bin/env bash
# timeout: 4h
# issue: 5122
# Pre-read page classifier pilot (#5122), VLM arm: Qwen3-VL-8B-Instruct-FP8 zero-shot over the labelled manifest
# ($JOB/manifest-final.jsonl, ~3.9K page images already fetched to $JOB/img). Read only: writes files under $JOB.
# Queued to run in the gap between tib-gutter chunks (gpu-queue.sh runs it under /root/gpu.lock). Stops its server.
set -uo pipefail
J=/root/jobs/page-classifier-5122; VL=/root/bench/vl; C=/root/jobs/page-classifier-5122/code
cd "$J"; mkdir -p vlm
nvidia-smi --query-gpu=memory.used --format=csv,noheader
VLLM_USE_DEEP_GEMM=0 nohup "$VL/bin/vllm" serve Qwen/Qwen3-VL-8B-Instruct-FP8 --served-model-name m --port 8000 --host 127.0.0.1 \
  --gpu-memory-utilization 0.6 --max-model-len 6144 --limit-mm-per-prompt '{"image":1,"video":0}' --max-num-seqs 16 \
  > vlm/serve.log 2>&1 < /dev/null &
PID=$!; trap 'kill $PID 2>/dev/null; sleep 10; kill -9 $PID 2>/dev/null; pkill -f "vllm serve Qwen/Qwen3-VL-8B" ; true' EXIT
for i in $(seq 1 120); do curl -sf http://127.0.0.1:8000/v1/models >/dev/null && break; kill -0 $PID || { tail -20 vlm/serve.log; exit 3; }; sleep 5; done
nvidia-smi --query-gpu=memory.used --format=csv,noheader > vlm/vram-up.txt
"$VL/bin/python" -I "$C/vlm-classify.py" manifest-final.jsonl img vlm/qwen3vl8b.jsonl 16
echo "done: $(wc -l < vlm/qwen3vl8b.jsonl) rows"
# second arm, after the server is gone: SigLIP2-so400m (384 px) on the card, full page + 2x2 tile mean (~4 GB, minutes)
kill $PID 2>/dev/null; sleep 15; pkill -f "vllm serve Qwen/Qwen3-VL-8B"; sleep 5
DEVICE=cuda TILES=1 "$VL/bin/python" -I "$C/featurize.py" manifest-final.jsonl img feat-so400m-tiles.npz google/siglip2-so400m-patch14-384
