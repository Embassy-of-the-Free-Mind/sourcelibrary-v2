#!/usr/bin/env bash
# drive.sh — the GPU arms of #7567 E1 (European-print draft screen), run ON gex45 inside a gpu-queue task (the runner
# holds /root/gpu.lock). One engine at a time: serve → read every page → stop, so the card is empty between arms.
# Arms: G GLM-OCR, D dots.ocr (anchors); CH CHURRO-3B, LO LightOnOCR-3-1B, IP Infinity-Parser2-Flash, S Surya 2 (new).
# PERO-OCR is not a vLLM model: pero-arm.sh runs it.
#   bash drive.sh [arm ...]      (default: G D CH LO IP S)   Outputs: $J/out/<ARM>.jsonl (+ .run.json), $J/drive.log
#
# PRIOR ART: scripts/eval/sanskrit-gex45-7243/drive.sh (this file, copied: serve/stop/sample, the dots and Surya 2 recipes).
# Its own prior art: scripts/eval/latin-bakeoff-5924/drive.sh (serve/stop/sample, the Paddle fleet-recipe arm and the vLLM flags;
# copied). Arms here: PV PaddleOCR-VL-1.6 (layout off), Q Qwen3-VL-8B-FP8 (the zh bake-off flags), D dots.ocr, P5 PP-OCRv5
# Devanagari, C Chandra OCR 2 (wave-2 recipe), S Surya 2 (its vLLM flags, served here instead of its docker spawn).
set -uo pipefail
J=${J:-/root/jobs/euro-gpu-correct-7567}; VL=/root/bench/vl; SU=/root/bench/surya; UTIL=${UTIL:-0.85}; IMG=${IMG:-$J/img}; C=$J/code
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
  timeout 2400 "$VL/bin/python" "$C/read.py" "$mode" "$IMG" "$J/out/$ARM.jsonl" --url http://127.0.0.1:8010/v1 --max-tokens "$mt" --clients "${CLIENTS:-16}" >> "$J/read-$ARM.log" 2>&1
  unsample; log "$(tr -d '\n ' < "$J/out/$ARM.jsonl.run.json" 2>/dev/null) peak $(peak $ARM) MiB"; stop_server
}
surya() {
  local args=(--dtype bfloat16 --max-num-seqs "${S_SEQS:-16}" --enable-prefix-caching --mm-processor-kwargs "{\"min_pixels\": 3136, \"max_pixels\": ${S_MAXPX:-6291456}}")
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
    # Beside another tenant (#7567 ran beside the Tibetan re-read's 14.5 GB) an arm can OOM at profiling or mid-run:
    # *_TIGHT add the gex45 card's "tight" flags (fewer sequences, capped pixels); read.py retries only the error rows.
    G)  vlm glm 6000 zai-org/GLM-OCR --limit-mm-per-prompt '{"image":1}' --speculative-config '{"method":"mtp","num_speculative_tokens":1}' ${G_TIGHT:-} ;;
    D)  vlm dotsocr 8000 dots-studio/dots.ocr --trust-remote-code --limit-mm-per-prompt '{"image":1,"video":0}' ${D_TIGHT:-} ;;
    # Qwen2.5-VL / Qwen3.5 at 2,400 px would spend 8-11K visual tokens a page: cap at ~2.5 MP, as the card's 7B "tight" runs did
    CH) MAXLEN=${MAXLEN:-20000} vlm churro 6000 stanford-oval/churro-3B --limit-mm-per-prompt '{"image":1,"video":0}' --mm-processor-kwargs '{"max_pixels": 2508800}' ${CH_TIGHT:-} ;;
    LO) vlm lighton 6000 lightonai/LightOnOCR-3-1B --limit-mm-per-prompt '{"image":1}' --mm-processor-cache-gb 0 --no-enable-prefix-caching ${LO_TIGHT:-} ;;
    IP) MAXLEN=${MAXLEN:-20000} vlm infinity 6000 infly/Infinity-Parser2-Flash --trust-remote-code --limit-mm-per-prompt '{"image":1,"video":0}' --mm-processor-kwargs '{"max_pixels": 2508800}' ${IP_TIGHT:-} ;;
    S)  surya ;;
    *)  log "unknown arm" ;;
  esac
}
mkdir -p "$J/out"
for ARM in ${*:-G D CH LO IP S}; do log "start; GPU $(gpu_mib) MiB"; run_arm; stop_server; done
ARM=all; log "DRIVE-END GPU $(gpu_mib) MiB"
