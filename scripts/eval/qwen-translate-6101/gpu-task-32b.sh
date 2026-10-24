#!/bin/bash
# timeout: 4h
# issue: 6101
# PRIOR ART: scripts/gpu/gex45-bench-6871/card.sh (vLLM serve → timed pass → stop, peak VRAM sampling, under /root/gpu.lock)
# — copied in shape; this serves three Qwen text models and keeps their translations for the #6101 judge.
# Queue with: gpu-queue.sh add gpu-task.sh 63-qwen-translate-6101  (the runner holds /root/gpu.lock and cds to its out dir)
# Run 1 (07:01Z): 14B ran; 32B/27B did not start — `hf download --revision` writes no refs/main, so HF_HUB_OFFLINE
# finds no snapshot (fixed by writing refs/main), and the hybrid 27B OOMed in vLLM's cudagraph profile sized for
# 256 sequences (--max-num-seqs 16, the client's concurrency, and the estimate off). The rerun skips arms with DONE.
# Inputs in /root/jobs/qwen-translate-6101: eval.jsonl (57 stored-source prompts), thru.jsonl (40 P1s prompts × 3 seeds).
set -u
J=/root/jobs/qwen-translate-6101; VL=/root/bench/vl
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
LOG=$J/gpu.log; echo "$(date -u +%FT%TZ) start" >> $LOG
serve() {  # $1 tag, $2 model id, rest: extra flags
  local tag=$1 model=$2; shift 2
  $VL/bin/vllm serve "$model" --served-model-name m --host 127.0.0.1 --port 8000 --seed 6101 \
    --gpu-memory-utilization ${UTIL:-0.92} --max-model-len ${MML:-12288} "$@" > $J/serve-$tag.log 2>&1 &
  SPID=$!
  for i in $(seq 1 180); do
    curl -sf http://127.0.0.1:8000/health >/dev/null && return 0
    kill -0 $SPID 2>/dev/null || return 1
    sleep 5
  done; return 1
}
stop() { kill $SPID 2>/dev/null; sleep 5; pkill -f "[v]llm serve" ; sleep 10; }
run_arm() {  # $1 tag, $2 model, rest: extra flags
  local tag=$1 model=$2; shift 2
  [ -f $J/out-$tag/DONE ] && return 0
  mkdir -p $J/out-$tag
  if ! serve $tag "$model" "$@"; then
    echo "$(date -u +%FT%TZ) $tag: serve failed with default KV; retry fp8 KV" >> $LOG; stop
    serve $tag "$model" "$@" --kv-cache-dtype fp8 || { echo "$(date -u +%FT%TZ) $tag: SERVE FAILED" >> $LOG; stop; return 1; }
    echo fp8 > $J/out-$tag/kv
  fi
  ( while true; do nvidia-smi --query-gpu=memory.used,power.draw,utilization.gpu --format=csv,noheader,nounits; sleep 2; done ) > $J/out-$tag/smi.csv &
  local MON=$!
  echo "$(date -u +%FT%TZ) $tag eval: $(python3 $J/client.py $J/eval.jsonl $J/out-$tag/eval.jsonl --concurrency 16 --max-model-len ${MML:-12288} | tail -1)" >> $LOG
  echo "$(date -u +%FT%TZ) $tag thru: $(python3 $J/client.py $J/thru.jsonl $J/out-$tag/thru.jsonl --concurrency 16 --max-model-len ${MML:-12288} | tail -1)" >> $LOG
  kill $MON; grep -c . $J/out-$tag/eval.jsonl > /dev/null && touch $J/out-$tag/DONE
  stop
}
# 32B only (#6101 run 2): 19.3 GB of AWQ weights left cuBLAS no room at util 0.92. Ladder, first that serves wins,
# recorded in out-q1-*/settings: fp8 KV + util 0.95 + 2,048-token prefill chunks; then also eager; then 8,192 context.
T=q1-qwen3-32b-awq; M=Qwen/Qwen3-32B-AWQ; mkdir -p $J/out-$T
for step in "0.95 12288 --max-num-batched-tokens 2048" "0.95 12288 --max-num-batched-tokens 2048 --enforce-eager" "0.95 8192 --max-num-batched-tokens 2048 --enforce-eager"; do
  [ -f $J/out-$T/DONE ] && break
  set -- $step; export UTIL=$1 MML=$2; shift 2
  echo "util $UTIL mml $MML $* kv fp8" > $J/out-$T/settings
  run_arm $T $M --max-num-seqs 16 --kv-cache-dtype fp8 "$@"
done
echo "$(date -u +%FT%TZ) end" >> $LOG
nvidia-smi --query-gpu=memory.used --format=csv,noheader
