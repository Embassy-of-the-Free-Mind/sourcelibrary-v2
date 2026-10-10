#!/bin/bash
# The on-box half of embed-models-6172-scw.sh (#6172): run under `idle-poweroff.sh run --`, so the box powers
# itself off (provider API) when this exits. Embeds pools A and T with Qwen3-Embedding 0.6B, 4B and 8B (bf16,
# torch sdpa) via scripts/eval/embed-models/qwen-embed.py, records pages/s per model, writes /root/pz/run.end,
# then waits (≤ 30 min) for the Hetzner driver to pull and touch /root/pz/pulled.
set -u
cd /root/pz
mkdir -p out
P=/root/pz/venv/bin/python
for M in ${MODELS:-0.6B 4B 8B}; do
  arm=qwen3-$(echo "$M" | tr 'A-Z' 'a-z')
  bt=16384; [ "$M" = 8B ] && bt=8192
  $P code/qwen-embed.py --backend torch --model Qwen/Qwen3-Embedding-$M --arm $arm --out out --gold-dir gold --selftest > out/selftest-$arm.log 2>&1
  $P code/qwen-embed.py --backend torch --model Qwen/Qwen3-Embedding-$M --arm $arm --out out --gold-dir gold \
    --pool-a in/pool.jsonl --pool-t in/pool-t.jsonl --batch-tokens $bt > out/run-$arm.log 2>&1
  echo "$arm rc=$?" >> out/models.done
  nvidia-smi --query-gpu=name,memory.used --format=csv,noheader >> out/models.done
done
touch run.end
for i in $(seq 1 90); do [ -f pulled ] && break; sleep 20; done
