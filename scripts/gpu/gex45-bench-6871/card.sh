#!/usr/bin/env bash
# card.sh — one arm of the GEX45 capability card (#6871), run ON gex45: take /root/gpu.lock, load ONE model,
# time it on the fixed input set, stop it, release. Speed and VRAM only.
#
# PRIOR ART: scripts/gpu/ocr-bakeoff-r3-5660/run.sh (serve → drive → stop per arm, the GLM/dots/MinerU serve
# flags) and scripts/gpu/paddle-zh-box.sh `arm` (the Paddle fleet recipe, called unchanged here). Those drive a
# rented pod from Hetzner; this runs on the owned box under the shared-GPU lock rule of #6871.
#
#   card.sh <arm>        e.g. card.sh glm-ocr      (BESIDE=0 skips the 0.38-util "beside a neighbour" pass)
# Env: J (/root/jobs/gpu-bench-6871), UTIL (0.85), LOCK_WAIT (300 s), BESIDE_UTIL (0.38), FULL=0 (beside pass only),
#      ARM_TAG (suffix for the arm's result dir, e.g. @b32 for a re-run at BESIDE_UTIL=0.32).
set -uo pipefail
J=${J:-/root/jobs/gpu-bench-6871}; C=$J/code; VL=/root/bench/vl
UTIL=${UTIL:-0.85}; ARM=$1
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
log() { echo "$(date -u +%FT%TZ) [$ARM] $*" >> "$J/card.log"; }
exec 9>/root/gpu.lock
flock -w "${LOCK_WAIT:-300}" 9 || { log "lock busy after ${LOCK_WAIT:-300} s — not run"; exit 75; }
log "lock taken; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader)"
R=$J/arms/$ARM${ARM_TAG:-}; mkdir -p "$R"
SPID=
sample() { nvidia-smi --query-gpu=memory.used,utilization.gpu,power.draw --format=csv,noheader,nounits -lms 500 > "$1" 2>/dev/null & SPID=$!; }
unsample() { [ -n "$SPID" ] && kill "$SPID" 2>/dev/null; SPID=; }
stop_server() {
  local p; p=$(cat "$R/serve.pid" 2>/dev/null)
  [ -n "$p" ] && { pkill -TERM -P "$p" 2>/dev/null; kill "$p" 2>/dev/null; sleep 8; pkill -KILL -P "$p" 2>/dev/null; kill -9 "$p" 2>/dev/null; }
  for i in $(seq 1 30); do [ "$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits)" -lt 600 ] && break; sleep 2; done
  # a server's engine is a grandchild: if VRAM is still held, stop THIS card's servers by their unique args
  if [ "$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits)" -ge 600 ]; then
    pkill -f -- '--served-model-name m --port 8000'; pkill -f '[p]addlex_genai_server'; sleep 10
    pkill -9 -f -- '--served-model-name m --port 8000'; pkill -9 -f '[p]addlex_genai_server'; pkill -9 -f 'VLLM::EngineCore'; sleep 3
  fi
  rm -f "$R/serve.pid"
}
trap 'unsample; stop_server; log "exit; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader)"' EXIT

serve() {  # serve <tag> <util> <model> <args...>
  local tag=$1 u=$2 model=$3; shift 3
  local t0; t0=$(date +%s)
  nohup "$VL/bin/vllm" serve "$model" --served-model-name m --port 8000 --host 127.0.0.1 --gpu-memory-utilization "$u" \
    --max-model-len "${MAXLEN:-16384}" "$@" > "$R/serve-$tag.log" 2>&1 < /dev/null &
  echo $! > "$R/serve.pid"
  for i in $(seq 1 120); do
    curl -sf http://127.0.0.1:8000/v1/models >/dev/null 2>&1 && { log "$tag up after $(( $(date +%s) - t0 )) s at util $u"; echo $(( $(date +%s) - t0 )) > "$R/load-secs-$tag"; return 0; }
    kill -0 "$(cat "$R/serve.pid")" 2>/dev/null || break
    sleep 5
  done
  log "$tag did not start: $(grep -E 'Error|error' "$R/serve-$tag.log" | tail -2 | cut -c1-300 | tr '\n' ' ')"
  stop_server; return 1
}

vlm_arm() {  # vlm_arm <mode> <max_tokens> <items> <model> <vllm args...>
  local mode=$1 mt=$2 items=$3 model=$4; shift 4
  for pass in full beside; do
    # "beside" = what a 0.6-util neighbour leaves: 24,467 − 15,278 MiB (gpu-screener-6742's measured 0.6) = 9,189 MiB.
    # vLLM's util budget undercounts the process's real footprint, so the verdict is on the measured peak, not on u.
    local u=$UTIL; [ $pass = beside ] && { [ "${BESIDE:-1}" = 1 ] || continue; u=${BESIDE_UTIL:-0.38}; }
    [ $pass = full ] && [ "${FULL:-1}" = 0 ] && continue
    if serve "$pass" "$u" "$model" "$@"; then
      sample "$R/vram-$pass.csv"
      timeout 600 "$VL/bin/python" "$C/vlm-bench.py" "$mode" "$items" "$R/$pass" --max-tokens "$mt" --clients "${CLIENTS:-16}" ${LIMIT:+--limit $LIMIT} >> "$R/bench.log" 2>&1
      unsample
      grep -m1 -E 'KV cache|GPU KV cache size' "$R/serve-$pass.log" > "$R/kv-$pass.txt" 2>/dev/null
      log "$pass: $(cat "$R/$pass/run.json" 2>/dev/null | tr -d '\n ') peak $(cut -d, -f1 "$R/vram-$pass.csv" | sort -n | tail -1) MiB"
    else
      echo "{\"not_run\": \"server did not start at util $u\"}" > "$R/$pass.notrun.json"
    fi
    stop_server
  done
}

embed_arm() {  # embed_arm <text|image> <model> <src>
  sample "$R/vram-full.csv"
  timeout 600 "$VL/bin/python" "$C/embed-bench.py" "$1" "$2" "$3" "$R/run.json" --max-len "${EMB_LEN:-1024}" ${EMB_BATCH:+--batch $EMB_BATCH} >> "$R/bench.log" 2>&1
  unsample
  log "$(tr -d '\n ' < "$R/run.json" 2>/dev/null) peak $(cut -d, -f1 "$R/vram-full.csv" | sort -n | tail -1) MiB"
}

IMG=$J/img; TX=$J/texts.jsonl
case $ARM in
  glm-ocr)        vlm_arm glm 4500 "$IMG" zai-org/GLM-OCR --limit-mm-per-prompt '{"image":1}' --speculative-config '{"method":"mtp","num_speculative_tokens":1}' ;;
  dots-ocr)       vlm_arm dots 8000 "$IMG" dots-studio/dots.ocr --trust-remote-code --limit-mm-per-prompt '{"image":1}' ;;
  # vLLM 0.31 V2 runner rejects mineru_vl_utils' n-gram logits processor (as DeepSeek-OCR in #6011): V1 runner
  mineru25-pro)   VLLM_USE_V2_MODEL_RUNNER=0 MAXLEN=8192 vlm_arm mineru 0 "$IMG" opendatalab/MinerU2.5-Pro-2605-1.2B --logits-processors mineru_vl_utils:MinerULogitsProcessor ;;
  olmocr2-fp8)    MAXLEN=12000 vlm_arm olmocr 4500 "$IMG" allenai/olmOCR-2-7B-1025-FP8 --limit-mm-per-prompt '{"image":1}' ;;
  qwen25vl7b-awq) vlm_arm generic 4500 "$IMG" Qwen/Qwen2.5-VL-7B-Instruct-AWQ --limit-mm-per-prompt '{"image":1}' ;;
  # does a 7B VLM fit beside a 0.6 neighbour with a smaller profile (8 sequences, 8K context)?
  # (vLLM profiles a video, then one image, at the model's max feature size: 6.7 GiB weights + that profile leave
  #  no KV room at 0.38 — so cap the image at ~2K visual tokens, 1.6 MP, which also lowers what the model sees)
  qwen25vl7b-awq-tight) UTIL=0.38 BESIDE=0 MAXLEN=8192 vlm_arm generic 4500 "$IMG" Qwen/Qwen2.5-VL-7B-Instruct-AWQ --limit-mm-per-prompt '{"image":1,"video":0}' --max-num-seqs 8 \
                          --max-num-batched-tokens 4096 --mm-processor-kwargs '{"max_pixels": 1605632}' ;;
  dots-ocr-tight) UTIL=0.38 BESIDE=0 MAXLEN=10240 vlm_arm dots 7500 "$IMG" dots-studio/dots.ocr --trust-remote-code --limit-mm-per-prompt '{"image":1,"video":0}' \
                    --max-num-seqs 8 --max-num-batched-tokens 4096 --mm-processor-kwargs '{"max_pixels": 1605632}' ;;
  olmocr2-fp8-tight)    UTIL=0.38 BESIDE=0 MAXLEN=8192 vlm_arm olmocr 4500 "$IMG" allenai/olmOCR-2-7B-1025-FP8 --limit-mm-per-prompt '{"image":1,"video":0}' --max-num-seqs 8 ;;
  # #6871 row A (inbox 2026-10-18T01:40Z): image-free vs image-conditioned token likelihood of the stored OCR, one server
  ll-qwen25vl7b-awq)
    if serve full "$UTIL" Qwen/Qwen2.5-VL-7B-Instruct-AWQ --limit-mm-per-prompt '{"image":1,"video":0}'; then
      for m in ll-img ll-text; do
        sample "$R/vram-$m.csv"
        timeout 600 "$VL/bin/python" "$C/vlm-bench.py" $m "$IMG" "$R/$m" --texts "$J/ocr.jsonl" --clients 16 >> "$R/bench.log" 2>&1
        unsample
        log "$m: $(tr -d '\n ' < "$R/$m/run.json" 2>/dev/null) peak $(cut -d, -f1 "$R/vram-$m.csv" | sort -n | tail -1) MiB"
      done
    fi ;;
  qwen3-8b-awq)   head -n 400 "$TX" > "$R/texts.jsonl"; CLIENTS=32 vlm_arm llm 512 "$R/texts.jsonl" Qwen/Qwen3-8B-AWQ ;;
  qwen3-14b-awq)  head -n 400 "$TX" > "$R/texts.jsonl"; CLIENTS=32 vlm_arm llm 512 "$R/texts.jsonl" Qwen/Qwen3-14B-AWQ ;;
  bge-m3)         embed_arm text BAAI/bge-m3 "$TX" ;;
  qwen3-emb-0.6b) embed_arm text Qwen/Qwen3-Embedding-0.6B "$TX" ;;
  qwen3-emb-4b)   embed_arm text Qwen/Qwen3-Embedding-4B "$TX" ;;
  # 42 % of translated pages run past 1,024 tokens: the same three at 2,048 (whole page for ~90 %)
  bge-m3-2k)         EMB_LEN=2048 embed_arm text BAAI/bge-m3 "$TX" ;;
  qwen3-emb-0.6b-2k) EMB_LEN=2048 embed_arm text Qwen/Qwen3-Embedding-0.6B "$TX" ;;
  qwen3-emb-4b-2k)   EMB_LEN=2048 EMB_BATCH=8 embed_arm text Qwen/Qwen3-Embedding-4B "$TX" ;;
  siglip2-base)   embed_arm image google/siglip2-base-patch16-224 "$IMG" ;;
  siglip2-so400m) embed_arm image google/siglip2-so400m-patch14-384 "$IMG" ;;
  clip-b32)       embed_arm image openai/clip-vit-base-patch32 "$IMG" ;;
  paddle-vl)      # the #5660 fleet recipe, unchanged: PaddleOCR-VL-1.6 genai server (vLLM 0.10.2) + 8 runners; layout off (fleet), then on
    awk -F'\t' '{print $1"__"$2"__"$3"\t"1"\t'"$IMG"'/"$1"__"$2"__"$3".jpg"}' "$J/pages.tsv" > "$R/manifest.tsv"
    # start the genai server HERE: when paddle-zh-box.sh `arm` starts it, its bare `wait` waits on the server
    # and never returns (the trap its `infer` documents; hit 2026-10-18, #6871)
    PATH=/root/pz/srv/bin:$PATH nohup /root/pz/srv/bin/paddlex_genai_server --model_name PaddleOCR-VL-1.6-0.9B --backend vllm --port 8118 ${PADDLE_SERVER_ARGS:-} > "$R/serve-paddle.log" 2>&1 < /dev/null &
    echo $! > "$R/serve.pid"
    for i in $(seq 1 120); do curl -sf http://127.0.0.1:8118/v1/models >/dev/null 2>&1 && break; sleep 5; done
    for L in ${LAYOUTS:-0 1}; do
      rm -rf "/root/pz/arms/gex45bench-l$L"
      sample "$R/vram-l$L.csv"
      PV_WORK=/root/pz BACKEND=server CLIENTS=8 LAYOUT=$L timeout 900 bash /root/pz/code/paddle-zh-box.sh arm "gex45bench-l$L" "$R/manifest.tsv" >> "$R/bench.log" 2>&1
      unsample
      cp "/root/pz/arms/gex45bench-l$L/arm-run.json" "$R/run-l$L.json" 2>/dev/null
      log "layout=$L: $(tr -d '\n ' < "$R/run-l$L.json" 2>/dev/null) peak $(cut -d, -f1 "$R/vram-l$L.csv" | sort -n | tail -1) MiB"
    done
    ;;
  *) log "unknown arm"; exit 2 ;;
esac
