#!/usr/bin/env bash
# drive.sh — the GPU arms of the #6871 item 3 bake-off, run ON gex45, one /root/gpu.lock hold per arm.
#
# PRIOR ART: gex45 /root/jobs/gpu-bench-6871/code/card.sh (job gpu-bench-6871: lock / serve / stop, and the serve
# flags per engine, copied) — it measures speed and keeps 80 characters per page; this keeps the full text for
# score.py. scripts/gpu/paddle-zh-box.sh `arm` is called unchanged for Paddle, as card.sh does.
#
#   nohup drive.sh [arm ...] > drive.out 2>&1 &      arms: paddle glm mineru qwen3vl qwen25vl (default: all)
# Env: J (/root/jobs/zh-bakeoff-6871), UTIL (0.6), LOCK_WAIT (300). An arm whose lock wait times out is retried
# after the others. Outputs: $J/out/<ARM>.jsonl (+ .run.json), $J/drive.log.
set -uo pipefail
J=${J:-/root/jobs/zh-bakeoff-6871}; VL=/root/bench/vl; UTIL=${UTIL:-0.6}; IMG=$J/in
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
log() { echo "$(date -u +%FT%TZ) [$ARM] $*" >> "$J/drive.log"; }
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; }
SPID=
sample() { nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader,nounits -lms 1000 > "$1" 2>/dev/null & SPID=$!; }
unsample() { [ -n "$SPID" ] && kill "$SPID" 2>/dev/null; SPID=; }
stop_server() {
  local p; p=$(cat "$J/serve.pid" 2>/dev/null)
  [ -n "$p" ] && { pkill -TERM -P "$p" 2>/dev/null; kill "$p" 2>/dev/null; sleep 8; pkill -KILL -P "$p" 2>/dev/null; kill -9 "$p" 2>/dev/null; }
  for i in $(seq 1 30); do [ "$(gpu_mib)" -lt 600 ] && break; sleep 2; done
  if [ "$(gpu_mib)" -ge 600 ]; then  # the engine is a grandchild: stop THIS job's servers by their unique args
    pkill -f -- '--served-model-name m --port 8010'; pkill -f '[p]addlex_genai_server.*--port 8118'; sleep 10
    pkill -9 -f -- '--served-model-name m --port 8010'; pkill -9 -f '[p]addlex_genai_server.*--port 8118'; sleep 3
  fi
  rm -f "$J/serve.pid"
}
serve() {  # serve <model> <args...>
  local model=$1; shift; local t0; t0=$(date +%s)
  nohup "$VL/bin/vllm" serve "$model" --served-model-name m --port 8010 --host 127.0.0.1 --gpu-memory-utilization "$UTIL" \
    --max-model-len "${MAXLEN:-16384}" "$@" > "$J/serve-$ARM.log" 2>&1 < /dev/null &
  echo $! > "$J/serve.pid"
  for i in $(seq 1 120); do
    curl -sf http://127.0.0.1:8010/v1/models >/dev/null 2>&1 && { log "up after $(( $(date +%s) - t0 )) s"; return 0; }
    kill -0 "$(cat "$J/serve.pid")" 2>/dev/null || break; sleep 5
  done
  log "did not start: $(grep -E 'Error' "$J/serve-$ARM.log" | tail -2 | cut -c1-300 | tr '\n' ' ')"; return 1
}
vlm() {  # vlm <out arm> <mode> <max tokens> <model> <vllm args...>
  local o=$1 mode=$2 mt=$3 model=$4; shift 4
  serve "$model" "$@" || { stop_server; return 0; }
  sample "$J/vram-$o.csv"
  timeout 1080 "$VL/bin/python" "$J/code/read.py" "$mode" "$IMG" "$J/out/$o.jsonl" --url http://127.0.0.1:8010/v1 \
    --max-tokens "$mt" --clients 16 >> "$J/read-$o.log" 2>&1
  unsample; log "$o: $(tr -d '\n ' < "$J/out/$o.jsonl.run.json" 2>/dev/null) peak $(cut -d, -f1 "$J/vram-$o.csv" | sort -n | tail -1) MiB"
  stop_server
}
paddle() {
  awk -F'\t' '{print $1"\t1\t'"$IMG"'/"$1".jpg"}' "$J/pages.tsv" > "$J/paddle-manifest.tsv"
  PATH=/root/pz/srv/bin:$PATH nohup /root/pz/srv/bin/paddlex_genai_server --model_name PaddleOCR-VL-1.6-0.9B --backend vllm \
    --port 8118 > "$J/serve-paddle.log" 2>&1 < /dev/null &
  echo $! > "$J/serve.pid"
  for i in $(seq 1 120); do curl -sf http://127.0.0.1:8118/v1/models >/dev/null 2>&1 && break; sleep 5; done
  for L in 0 1; do
    local name=zhbake6871-l$L; rm -rf "/root/pz/arms/$name"
    sample "$J/vram-P$L.csv"
    PV_WORK=/root/pz BACKEND=server CLIENTS=8 LAYOUT=$L timeout 900 \
      bash /root/pz/code/paddle-zh-box.sh arm "$name" "$J/paddle-manifest.tsv" >> "$J/paddle.log" 2>&1
    unsample
    cp "/root/pz/arms/$name/arm-run.json" "$J/out/P$L.jsonl.run.json" 2>/dev/null
    /root/pz/venv/bin/python - "/root/pz/arms/$name/out" "$J/out/P$L.jsonl" <<'PY'
import json, os, sys
d, o = sys.argv[1:]
with open(o, 'w') as f:
    for pid in sorted(os.listdir(d)):
        t = os.path.join(d, pid, '1.txt'); e = os.path.join(d, pid, '1.err')
        row = {'page_id': pid, 'text': open(t).read()} if os.path.exists(t) else {'page_id': pid, 'text': '', 'error': open(e).read()[:300] if os.path.exists(e) else 'missing'}
        f.write(json.dumps(row, ensure_ascii=False) + '\n')
PY
    log "P$L: $(tr -d '\n ' < "$J/out/P$L.jsonl.run.json" 2>/dev/null) peak $(cut -d, -f1 "$J/vram-P$L.csv" | sort -n | tail -1) MiB"
  done
  stop_server
}
run_arm() {
  case $ARM in
    paddle)   paddle ;;
    glm)      vlm G glm 4500 zai-org/GLM-OCR --limit-mm-per-prompt '{"image":1}' --speculative-config '{"method":"mtp","num_speculative_tokens":1}' ;;
    mineru)   VLLM_USE_V2_MODEL_RUNNER=0 MAXLEN=8192 vlm M mineru 0 opendatalab/MinerU2.5-Pro-2605-1.2B --logits-processors mineru_vl_utils:MinerULogitsProcessor ;;
    # the FP8 build picks DeepGEMM, whose SM120 kernels need nvcc 13 (the box has 12.9): use the CUTLASS path.
    # At util 0.6 the 8B FP8 weights leave 1.27 GiB of KV = 9,216 tokens: ~5.2K image + 3,500 out.
    qwen3vl)  VLLM_USE_DEEP_GEMM=0 MAXLEN=9216 vlm Q3 generic 3500 Qwen/Qwen3-VL-8B-Instruct-FP8 --limit-mm-per-prompt '{"image":1,"video":0}' --max-num-seqs 8 ;;
    qwen25vl) MAXLEN=12288 vlm Q2 generic 4500 Qwen/Qwen2.5-VL-7B-Instruct-AWQ --limit-mm-per-prompt '{"image":1,"video":0}' --max-num-seqs 8 ;;
    *) log "unknown arm" ;;
  esac
}
mkdir -p "$J/out"
ARMS=${*:-paddle glm mineru qwen3vl qwen25vl}
for round in $(seq 1 20); do
  left=()
  for ARM in $ARMS; do
    exec 9>/root/gpu.lock
    if ! flock -w "${LOCK_WAIT:-300}" 9; then log "lock busy after ${LOCK_WAIT:-300} s"; left+=("$ARM"); exec 9>&-; continue; fi
    log "lock taken; GPU $(gpu_mib) MiB"
    run_arm; stop_server
    log "released; GPU $(gpu_mib) MiB"
    exec 9>&-; sleep 60
  done
  [ ${#left[@]} = 0 ] && break
  ARMS="${left[*]}"
done
echo "DRIVE-END $(date -u +%FT%TZ)" >> "$J/drive.log"
