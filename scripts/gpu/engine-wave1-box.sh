#!/usr/bin/env bash
# engine-wave1-box.sh — the GPU half of #6011 wave 1: DeepSeek-OCR, Qwen3-VL-8B-Instruct and Chandra OCR 2,
# each served by vLLM in turn on one rented Scaleway GPU, over the same bench images as the API arms.
#
# PRIOR ART: scripts/gpu/paddle-vl-box.sh (same setup/infer/collect split, output file = checkpoint,
# run under idle-poweroff.sh). That box runs PaddleOCR in process; these three are vLLM-served models,
# so each phase is serve → read (engine-wave1-run.py) → stop. vLLM recipe: VLLM_USE_FLASHINFER_SAMPLER=0
# on the Scaleway GPU OS image (2026-10-04, #5660).
#
#   engine-wave1-box.sh setup     uv venv + latest vllm + chandra-ocr (no deps) + hf_transfer; prefetch the three models
#   engine-wave1-box.sh run       the three engines in turn (an engine whose server will not start is logged and skipped)
#   engine-wave1-box.sh all       setup, run, collect, touch DONE
# Under idle-poweroff.sh:  idle-poweroff.sh run -- bash -c 'engine-wave1-box.sh all; sleep 1500'
set -uo pipefail
W=${EW1_WORK:-/root/ew1}
HERE=$(cd "$(dirname "$0")" && pwd)
PY="$W/venv/bin/python"
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_ENABLE_HF_TRANSFER=1
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$W/box.log"; }

setup() {
  mkdir -p "$W"
  command -v uv >/dev/null || { curl -LsSf https://astral.sh/uv/install.sh | sh >> "$W/setup.log" 2>&1; }
  export PATH="$HOME/.local/bin:$PATH"
  [ -x "$PY" ] || uv venv -p 3.12 "$W/venv" >> "$W/setup.log" 2>&1
  # pinned to the version wave 1 measured (gpu-box.json); VLLM_VERSION overrides (#6011 wave 2)
  VIRTUAL_ENV="$W/venv" uv pip install "vllm==${VLLM_VERSION:-0.31.0}" --torch-backend auto >> "$W/setup.log" 2>&1
  VIRTUAL_ENV="$W/venv" uv pip install hf_transfer requests markdownify beautifulsoup4 pydantic-settings python-dotenv filetype >> "$W/setup.log" 2>&1
  VIRTUAL_ENV="$W/venv" uv pip install --no-deps chandra-ocr==0.2.0 >> "$W/setup.log" 2>&1
  log "setup ok: $($PY -c 'import vllm,torch;print("vllm",vllm.__version__,"torch",torch.__version__)' 2>&1 | tail -1) $(nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader)"
  for m in deepseek-ai/DeepSeek-OCR Qwen/Qwen3-VL-8B-Instruct datalab-to/chandra-ocr-2; do
    "$W/venv/bin/hf" download "$m" >> "$W/setup.log" 2>&1 || "$W/venv/bin/huggingface-cli" download "$m" >> "$W/setup.log" 2>&1 || log "prefetch $m failed"
  done
  log "prefetch done: $(du -sh ~/.cache/huggingface 2>/dev/null | cut -f1)"
}

serve() {   # $1 engine
  local args envs=()
  case $1 in
    deepseek-ocr-plain) args=(deepseek-ai/DeepSeek-OCR --no-enable-prefix-caching --mm-processor-cache-gb 0) ;;
    # vLLM 0.31's V2 model runner rejects DeepSeek's n-gram processor and the plain serve hits a Triton bug;
    # wave 1 read DeepSeek on the V1 runner by hand (gpu-box.json notes). Encoded here for wave 2.
    deepseek-ocr) envs=(VLLM_USE_V2_MODEL_RUNNER=0 TRITON_ALLOW_NON_CONSTEXPR_GLOBALS=1); args=(deepseek-ai/DeepSeek-OCR --logits_processors vllm.model_executor.models.deepseek_ocr:NGramPerReqLogitsProcessor --no-enable-prefix-caching --mm-processor-cache-gb 0) ;;
    qwen3-vl-8b)  args=(Qwen/Qwen3-VL-8B-Instruct --max-model-len 16384 --limit-mm-per-prompt '{"image":1}') ;;
    chandra-ocr-2) args=(datalab-to/chandra-ocr-2 --max-model-len 18000 --dtype bfloat16 --mm-processor-kwargs '{"min_pixels": 3136, "max_pixels": 6291456}') ;;
  esac
  nohup env "${envs[@]}" "$W/venv/bin/vllm" serve "${args[@]}" --served-model-name m --gpu-memory-utilization 0.88 --port 8000 > "$W/serve-$1.log" 2>&1 &
  echo $! > "$W/serve.pid"
  for i in $(seq 1 180); do
    curl -fs http://127.0.0.1:8000/v1/models >/dev/null 2>&1 && { log "$1 serving after $((i*5)) s"; return 0; }
    kill -0 "$(cat "$W/serve.pid")" 2>/dev/null || break
    sleep 5
  done
  log "$1: server did not start — tail: $(tail -3 "$W/serve-$1.log" | tr '\n' ' ' | cut -c1-400)"
  return 1
}

stop_serve() { local p; p=$(cat "$W/serve.pid" 2>/dev/null) && kill "$p" 2>/dev/null; sleep 10; kill -9 "$p" 2>/dev/null; sleep 5; true; }

run() {
  for e in ${ENGINES:-deepseek-ocr qwen3-vl-8b chandra-ocr-2}; do
    local t0 up=0; t0=$(date +%s)
    if serve "$e"; then up=1
    elif [ "$e" = deepseek-ocr ]; then
      stop_serve; log "deepseek-ocr: retry without the n-gram logits processor"
      serve deepseek-ocr-plain && up=1
    fi
    if [ $up = 1 ]; then
      for pass in 1 2; do
        "$PY" "$HERE/engine-wave1-run.py" --engine "$e" --bench "$W/bench" --out "$W/out" --workers "${WORKERS:-16}" >> "$W/run-$e.log" 2>&1 && break
        log "$e pass $pass exited $? — retrying the pages without output"
      done
    fi
    stop_serve
    log "$e phase done in $(( $(date +%s) - t0 )) s, outputs: $(find "$W/out/$e" -name '*.txt' 2>/dev/null | wc -l)"
  done
}

collect() {
  "$PY" - "$W" <<'PY'
import json, os, subprocess, sys
w = sys.argv[1]
import vllm
gpu = subprocess.run(['nvidia-smi', '--query-gpu=name,driver_version', '--format=csv,noheader'], capture_output=True, text=True).stdout.strip()
out = {'gpu': gpu, 'vllm': vllm.__version__, 'engines': {}}
for e in ('deepseek-ocr', 'qwen3-vl-8b', 'chandra-ocr-2'):
    d = os.path.join(w, 'out', e)
    runs = [json.loads(l) for l in open(os.path.join(d, '_run.json'))] if os.path.exists(os.path.join(d, '_run.json')) else []
    n = sum(1 for _, _, fs in os.walk(d) for f in fs if f.endswith('.txt'))
    out['engines'][e] = {'pages_out': n, 'runs': runs, 'infer_wall_secs': sum(r['wall_secs'] for r in runs)}
json.dump(out, open(os.path.join(w, 'box.json'), 'w'), indent=1)
PY
  log "collect: $(tr -d '\n ' < "$W/box.json" | cut -c1-600)"
}

case ${1:-} in
  setup) setup ;; run) run ;; collect) collect ;;
  run1) ENGINES="$2" run; collect ;;   # one engine again on a box already set up (#6011 wave 2: DeepSeek after a failed start)
  all) setup; run; collect; touch "$W/DONE"; log DONE ;;
  *) echo "usage: $0 setup|run|collect|all"; exit 1 ;;
esac
