#!/usr/bin/env bash
# drive.sh — the GPU arms of the #7243 Sanskrit test (PREREG.md), run ON gex45 inside a gpu-queue task (the runner holds
# /root/gpu.lock). One engine at a time: serve → read every page → stop, so the card is empty between arms.
#
# PRIOR ART: scripts/eval/latin-bakeoff-5924/drive.sh (serve/stop/sample, the Paddle fleet-recipe arm and the vLLM flags;
# copied). Arms here: PV PaddleOCR-VL-1.6 (layout off), Q Qwen3-VL-8B-FP8 (the zh bake-off flags), D dots.ocr, P5 PP-OCRv5
# Devanagari, C Chandra OCR 2 (wave-2 recipe), S Surya 2 (its vLLM flags, served here instead of its docker spawn).
#   bash drive.sh [arm ...]      (default: PV Q D P5 C S)      Outputs: $J/out/<ARM>.jsonl (+ .run.json), $J/drive.log
set -uo pipefail
J=${J:-/root/jobs/gpu-sanskrit-7243}; VL=/root/bench/vl; SU=/root/bench/surya; UTIL=${UTIL:-0.85}; IMG=$J/in; C=$J/code
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
log() { echo "$(date -u +%FT%TZ) [$ARM] $*" >> "$J/drive.log"; }
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; }
SPID=
sample() { nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader,nounits -lms 1000 > "$1" 2>/dev/null & SPID=$!; }
unsample() { [ -n "$SPID" ] && kill "$SPID" 2>/dev/null; SPID=; }
peak() { cut -d, -f1 "$J/vram-$1.csv" 2>/dev/null | sort -n | tail -1; }
stop_server() {
  local p; p=$(cat "$J/serve.pid" 2>/dev/null)
  [ -n "$p" ] && { pkill -TERM -P "$p" 2>/dev/null; kill "$p" 2>/dev/null; sleep 8; pkill -KILL -P "$p" 2>/dev/null; kill -9 "$p" 2>/dev/null; }
  for i in $(seq 1 30); do [ "$(gpu_mib)" -lt 600 ] && break; sleep 2; done
  if [ "$(gpu_mib)" -ge 600 ]; then
    pkill -f -- '--port 8010'; pkill -f '[p]addlex_genai_server.*--port 8118'; sleep 10
    pkill -9 -f -- '--port 8010'; pkill -9 -f '[p]addlex_genai_server.*--port 8118'; sleep 3
  fi
  rm -f "$J/serve.pid"
}
serve() {  # serve <model> <served name> <args...>
  local model=$1 name=$2; shift 2; local t0; t0=$(date +%s)
  nohup "$VL/bin/vllm" serve "$model" --served-model-name "$name" --port 8010 --host 127.0.0.1 --gpu-memory-utilization "$UTIL" \
    --max-model-len "${MAXLEN:-16384}" "$@" > "$J/serve-$ARM.log" 2>&1 < /dev/null &
  echo $! > "$J/serve.pid"
  for i in $(seq 1 120); do
    curl -sf http://127.0.0.1:8010/v1/models >/dev/null 2>&1 && { log "up after $(( $(date +%s) - t0 )) s"; return 0; }
    kill -0 "$(cat "$J/serve.pid")" 2>/dev/null || break; sleep 5
  done
  log "did not start: $(grep -E 'Error' "$J/serve-$ARM.log" | tail -2 | cut -c1-300 | tr '\n' ' ')"; stop_server; return 1
}
vlm() {  # vlm <mode> <max tokens> <model> <vllm args...>
  local mode=$1 mt=$2 model=$3; shift 3
  serve "$model" m "$@" || return 0
  sample "$J/vram-$ARM.csv"
  timeout 2400 "$VL/bin/python" "$C/read.py" "$mode" "$IMG" "$J/out/$ARM.jsonl" --url http://127.0.0.1:8010/v1 --max-tokens "$mt" --clients 16 >> "$J/read-$ARM.log" 2>&1
  unsample; log "$(tr -d '\n ' < "$J/out/$ARM.jsonl.run.json" 2>/dev/null) peak $(peak $ARM) MiB"; stop_server
}
paddle_vl() {
  ls "$IMG" | sed 's/\.jpg$//' | awk '{print $1"\t1\t'"$IMG"'/"$1".jpg"}' > "$J/paddle-manifest.tsv"
  PATH=/root/pz/srv/bin:$PATH nohup /root/pz/srv/bin/paddlex_genai_server --model_name PaddleOCR-VL-1.6-0.9B --backend vllm --port 8118 > "$J/serve-PV.log" 2>&1 < /dev/null &
  echo $! > "$J/serve.pid"
  for i in $(seq 1 120); do curl -sf http://127.0.0.1:8118/v1/models >/dev/null 2>&1 && break; sleep 5; done
  local name=sanskrit7243-pv; rm -rf "/root/pz/arms/$name"; sample "$J/vram-PV.csv"; local t0; t0=$(date +%s)
  PV_WORK=/root/pz BACKEND=server CLIENTS=8 LAYOUT=0 timeout 1800 bash /root/pz/code/paddle-zh-box.sh arm "$name" "$J/paddle-manifest.tsv" >> "$J/paddle.log" 2>&1
  unsample; cp "/root/pz/arms/$name/arm-run.json" "$J/out/PV.jsonl.run.json" 2>/dev/null
  /root/pz/venv/bin/python - "/root/pz/arms/$name/out" "$J/out/PV.jsonl" <<'PY'
import json, os, sys
d, o = sys.argv[1:]
with open(o, 'w') as f:
    for pid in sorted(os.listdir(d)):
        t = os.path.join(d, pid, '1.txt'); e = os.path.join(d, pid, '1.err')
        row = {'page_id': pid, 'text': open(t).read()} if os.path.exists(t) else {'page_id': pid, 'text': '', 'error': open(e).read()[:300] if os.path.exists(e) else 'missing'}
        f.write(json.dumps(row, ensure_ascii=False) + '\n')
PY
  log "PV wall $(( $(date +%s) - t0 )) s $(tr -d '\n ' < "$J/out/PV.jsonl.run.json" 2>/dev/null | cut -c1-300) peak $(peak PV) MiB"; stop_server
}
surya() {
  local args=(--dtype bfloat16 --max-num-seqs 16 --enable-prefix-caching --mm-processor-kwargs '{"min_pixels": 3136, "max_pixels": 6291456}')
  MAXLEN=18000 serve datalab-to/surya-ocr-2 datalab-to/surya-ocr-2 "${args[@]}" --speculative-config '{"method":"mtp","num_speculative_tokens":2}' \
    || { log "retry without MTP"; MAXLEN=18000 serve datalab-to/surya-ocr-2 datalab-to/surya-ocr-2 "${args[@]}" || return 0; }
  sample "$J/vram-S.csv"; local t0; t0=$(date +%s); rm -rf "$J/surya-out"
  SURYA_INFERENCE_URL=http://127.0.0.1:8010/v1 SURYA_INFERENCE_BACKEND=vllm timeout 2400 "$SU/bin/surya_ocr" "$IMG" --output_dir "$J/surya-out" >> "$J/read-S.log" 2>&1
  local w=$(( $(date +%s) - t0 )); unsample
  "$SU/bin/python" "$C/surya-collect.py" "$J/surya-out" "$J/out/S.jsonl" >> "$J/read-S.log" 2>&1
  echo "{\"wall_secs\": $w, \"pages_per_hour\": $(( $(ls "$IMG" | wc -l) * 3600 / (w > 0 ? w : 1) ))}" > "$J/out/S.jsonl.run.json"
  log "S wall $w s peak $(peak S) MiB $(wc -l < "$J/out/S.jsonl" 2>/dev/null) rows"; stop_server
}
run_arm() {
  case $ARM in
    PV) paddle_vl ;;
    Q)  VLLM_USE_DEEP_GEMM=0 vlm deva 6000 Qwen/Qwen3-VL-8B-Instruct-FP8 --limit-mm-per-prompt '{"image":1,"video":0}' --max-num-seqs 8 ;;
    D)  vlm dotsocr 8000 dots-studio/dots.ocr --trust-remote-code --limit-mm-per-prompt '{"image":1,"video":0}' ;;
    P5) sample "$J/vram-P5.csv"; timeout 2400 /root/pz/venv/bin/python "$C/p5.py" "$IMG" "$J/out/P5.jsonl" --device gpu:0 >> "$J/read-P5.log" 2>&1
        unsample; log "$(tr -d '\n ' < "$J/out/P5.jsonl.run.json" 2>/dev/null) peak $(peak P5) MiB" ;;
    C)  MAXLEN=18000 serve datalab-to/chandra-ocr-2 m --dtype bfloat16 --mm-processor-kwargs '{"min_pixels": 3136, "max_pixels": 6291456}' || return 0
        sample "$J/vram-C.csv"
        VLLM_API_BASE=http://127.0.0.1:8010/v1 VLLM_MODEL_NAME=m timeout 2400 "$SU/bin/python" "$C/chandra-arm.py" "$IMG" "$J/out/C.jsonl" --workers 8 >> "$J/read-C.log" 2>&1
        unsample; log "$(tr -d '\n ' < "$J/out/C.jsonl.run.json" 2>/dev/null) peak $(peak C) MiB"; stop_server ;;
    S)  surya ;;
    *)  log "unknown arm" ;;
  esac
}
mkdir -p "$J/out"
for ARM in ${*:-PV Q D P5 C S}; do log "start; GPU $(gpu_mib) MiB"; run_arm; stop_server; done
ARM=all; log "DRIVE-END GPU $(gpu_mib) MiB"
