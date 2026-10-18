#!/usr/bin/env bash
# gpu-screener-6742: one model loaded under /root/gpu.lock (taken by the caller), three arms, then stop.
set -u
J=/root/jobs/gpu-screener-6742; cd $J
M=Qwen/Qwen3-14B-AWQ; NAME=qwen3-14b-awq
log(){ echo "$(date -u +%FT%TZ) $*" >> $J/drive.log; }
nvidia-smi --query-gpu=memory.used --format=csv >> $J/drive.log
export VLLM_USE_FLASHINFER_SAMPLER=0 PATH=/root/pz/srv/bin:$PATH
log "serve $M"
/root/pz/srv/bin/vllm serve $M --served-model-name $NAME --host 127.0.0.1 --port 8000 --gpu-memory-utilization 0.6 \
  --max-model-len 16384 --reasoning-parser qwen3 --seed 6742 > $J/server.log 2>&1 &
SP=$!
for i in $(seq 1 120); do curl -sf http://127.0.0.1:8000/health >/dev/null && break; kill -0 $SP 2>/dev/null || { log "server died"; break; }; sleep 5; done
if curl -sf http://127.0.0.1:8000/health >/dev/null; then
  log "server up"; nvidia-smi --query-gpu=memory.used --format=csv,noheader >> $J/drive.log
  for arm in ${ARMS:-P S R}; do
    case $arm in
      P) a="--think=1 --conc=8 --seed=6742" ;;
      S) a="--think=0 --conc=16 --seed=6742" ;;
      R) a="--think=1 --conc=8 --seed=6743" ;;
    esac
    log "arm $arm start"
    node $J/local-screener.mjs run --prompts=$J/prompts.jsonl --out=$J/arm-$arm.jsonl --model=$NAME $a >> $J/arm-$arm.log 2>&1
    log "arm $arm done: $(tail -1 $J/arm-$arm.log)"
  done
fi
kill $SP 2>/dev/null; sleep 10; pkill -f "vllm serve $M" ; sleep 5
log "stopped; $(nvidia-smi --query-gpu=memory.used --format=csv,noheader)"
touch $J/DONE
