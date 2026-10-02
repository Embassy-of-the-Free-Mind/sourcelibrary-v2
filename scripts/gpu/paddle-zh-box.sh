#!/usr/bin/env bash
# paddle-zh-box.sh — the GPU half of the #5600 Paddle Chinese lane, ON a rented Scaleway GPU.
#
# PRIOR ART: scripts/gpu/paddle-vl-box.sh (#5547 — setup/infer/collect for the pilot; its `setup` is
# called as is, so the lane installs exactly the #5547 stack). What this adds: the runner is
# paddle-zh-run.py (fetches its own images from R2), an optional genai server (BACKEND=server: the VL
# recognition model behind vLLM, CLIENTS pipeline runners batching into it), and `collect` hashes the
# weights the box loaded so a page can name them (ocr.engine.revision).
#
#   paddle-zh-box.sh setup      venv + the #5547 Paddle stack; SERVER=1 also installs the genai server deps
#   paddle-zh-box.sh infer      runners over manifest.tsv until INFER_HOURS elapse (restarted on exit 3)
#   paddle-zh-box.sh collect    box.json: versions, GPU, weights sha256, config, pages, s/page
#   paddle-zh-box.sh all        setup, infer, collect, touch DONE
# Env: PV_WORK (/root/pz), WORKERS (native runners, default 2: an L4 holds two), BACKEND (native|server),
#      CLIENTS (server-mode runners, default 8), MAX_SIDE (0), LAYOUT (1), PREFETCH (4), INFER_HOURS (6),
#      PAGE_TIMEOUT (90). Run under idle-poweroff.sh so the box powers itself off when the job ends.
set -euo pipefail
W=${PV_WORK:-/root/pz}
BACKEND=${BACKEND:-native}
WORKERS=${WORKERS:-2}
[ "$BACKEND" = server ] && WORKERS=${CLIENTS:-8}
INFER_HOURS=${INFER_HOURS:-6}
HERE=$(cd "$(dirname "$0")" && pwd)
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$W/box.log"; }

setup() {
  PV_WORK=$W bash "$HERE/paddle-vl-box.sh" setup
  if [ "${SERVER:-0}" = 1 ] || [ "$BACKEND" = server ]; then
    if [ ! -x "$W/srv/bin/paddleocr" ]; then
      python3 -m venv "$W/srv"
      "$W/srv/bin/pip" install -q --upgrade pip >> "$W/setup.log" 2>&1
      "$W/srv/bin/pip" install -q "paddleocr[doc-parser]==3.7.0" "paddlex==3.7.2" >> "$W/setup.log" 2>&1
      "$W/srv/bin/paddleocr" install_genai_server_deps vllm >> "$W/setup.log" 2>&1 || log "install_genai_server_deps vllm FAILED (see setup.log)"
    fi
    log "server venv: $("$W/srv/bin/python" -c 'import vllm;print("vllm",vllm.__version__)' 2>&1 | tail -1)"
  fi
}

serve() {
  [ "$BACKEND" = server ] || return 0
  if ! curl -sf http://127.0.0.1:8118/v1/models >/dev/null 2>&1; then
    nohup "$W/srv/bin/paddleocr" genai_server --model_name "${VL_MODEL:-PaddleOCR-VL-0.9B}" --backend vllm --port 8118 ${SERVER_ARGS:-} > "$W/server.log" 2>&1 &
    for i in $(seq 1 120); do curl -sf http://127.0.0.1:8118/v1/models >/dev/null 2>&1 && break; sleep 5; done
  fi
  curl -sf http://127.0.0.1:8118/v1/models >/dev/null && log "genai server up: $(curl -s http://127.0.0.1:8118/v1/models | head -c 200)" || { log "genai server did NOT come up"; tail -20 "$W/server.log" | tee -a "$W/box.log"; return 1; }
}

infer() {
  serve
  local t0; t0=$(date +%s)
  local deadline=$(( t0 + INFER_HOURS * 3600 ))
  log "infer start: backend=$BACKEND runners=$WORKERS max_side=${MAX_SIDE:-0} layout=${LAYOUT:-1} prefetch=${PREFETCH:-4}, deadline $(date -u -d @$deadline +%FT%TZ), $(wc -l < "$W/manifest.tsv") rows"
  for i in $(seq 0 $((WORKERS - 1))); do
    ( while [ "$(date +%s)" -lt "$deadline" ]; do
        "$W/venv/bin/python" "$HERE/paddle-zh-run.py" --manifest "$W/manifest.tsv" --root "$W" --worker "$i" --workers "$WORKERS" \
          --deadline "$deadline" --page-timeout "${PAGE_TIMEOUT:-90}" --max-side "${MAX_SIDE:-0}" --layout "${LAYOUT:-1}" \
          --backend "$BACKEND" --prefetch "${PREFETCH:-4}" >> "$W/worker-$i.log" 2>&1 && break
        echo "$(date -u +%FT%TZ) worker $i exited $? — restarting" >> "$W/box.log"
      done ) &
  done
  wait || true
  echo $(( $(date +%s) - t0 )) > "$W/infer-secs"
  log "infer done in $(cat "$W/infer-secs") s"
}

collect() {
  cat "$W"/timings-*.jsonl > "$W/timings.jsonl" 2>/dev/null || true
  "$W/venv/bin/python" - "$W" "$WORKERS" "$BACKEND" "${MAX_SIDE:-0}" "${LAYOUT:-1}" <<'PY'
import hashlib, json, os, socket, subprocess, sys, glob
w, workers, backend, max_side, layout = sys.argv[1], int(sys.argv[2]), sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
secs = int(open(f'{w}/infer-secs').read()) if os.path.exists(f'{w}/infer-secs') else None
n = sum(1 for d, _, fs in os.walk(f'{w}/out') for f in fs if f.endswith('.txt'))
e = sum(1 for d, _, fs in os.walk(f'{w}/out') for f in fs if f.endswith('.err'))
import paddle, paddleocr, paddlex
gpu = subprocess.run(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'], capture_output=True, text=True).stdout.strip()
# the VL weights the pipeline loaded (paddlex caches official models under ~/.paddlex/official_models)
wf = sorted(glob.glob(os.path.expanduser('~/.paddlex/official_models/PaddleOCR-VL*/**/*.safetensors'), recursive=True))
h = hashlib.sha256()
for f in wf:
    with open(f, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 22), b''): h.update(chunk)
json.dump({'host': socket.gethostname(), 'gpu': gpu, 'workers': workers, 'backend': backend, 'max_side': max_side, 'layout': layout,
           'paddle_version': paddle.__version__, 'paddleocr_version': paddleocr.__version__, 'paddlex_version': paddlex.__version__,
           'vl_model': 'PaddleOCRVL() default pipeline', 'weights_files': [os.path.relpath(f, os.path.expanduser('~/.paddlex/official_models')) for f in wf],
           'weights_sha256': h.hexdigest() if wf else None, 'pages_out': n, 'pages_err': e, 'infer_secs': secs,
           'wall_secs_per_page': round(secs / n, 2) if n and secs else None}, open(f'{w}/box.json', 'w'), indent=1)
PY
  log "collect: $(tr -d '\n ' < "$W/box.json" | head -c 600)"
}

case ${1:-} in
  setup) setup ;; serve) serve ;; infer) infer ;; collect) collect ;;
  all) setup; infer; collect; touch "$W/DONE"; log DONE ;;
  *) echo "usage: $0 setup|serve|infer|collect|all"; exit 1 ;;
esac
