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
#   paddle-zh-box.sh loop       the FLEET mode: setup + collect once, then read every manifest the driver drops in
#                               queue/ (oldest first; queue/<name>.tsv → queue/<name>.done when every row has a
#                               .txt or .err), and exit when the queue has been empty for QUEUE_IDLE_MIN (30) or
#                               queue/FINISH exists. Run it under idle-poweroff.sh run -- so the box powers off then.
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
      # the installer shells out to `paddlex` (so the venv goes on PATH) and builds flash-attn from source,
      # which fails on the GPU OS image (no nvcc, measured 2026-10-02) — so its failure is expected and the
      # prebuilt flash-attn wheel for the torch it installed (2.8, cu12, cxx11 ABI, py3.12) goes in after
      PATH="$W/srv/bin:$PATH" "$W/srv/bin/paddleocr" install_genai_server_deps vllm >> "$W/setup.log" 2>&1 || log "install_genai_server_deps vllm: non-zero (flash-attn source build); installing the prebuilt wheel"
      "$W/srv/bin/pip" install -q "https://github.com/Dao-AILab/flash-attention/releases/download/v2.8.3/flash_attn-2.8.3+cu12torch2.8cxx11abiTRUE-cp312-cp312-linux_x86_64.whl" >> "$W/setup.log" 2>&1 || log "flash-attn wheel FAILED"
    fi
    log "server venv: $("$W/srv/bin/python" -c 'import vllm,flash_attn;print("vllm",vllm.__version__,"flash_attn",flash_attn.__version__)' 2>&1 | tail -1)"
  fi
}

serve() {
  [ "$BACKEND" = server ] || return 0
  if ! curl -sf http://127.0.0.1:8118/v1/models >/dev/null 2>&1; then
    PATH="$W/srv/bin:$PATH" nohup "$W/srv/bin/paddlex_genai_server" --model_name "${VL_MODEL:-PaddleOCR-VL-1.6-0.9B}" --backend vllm --port 8118 ${SERVER_ARGS:-} > "$W/server.log" 2>&1 &
    for i in $(seq 1 120); do curl -sf http://127.0.0.1:8118/v1/models >/dev/null 2>&1 && break; sleep 5; done
  fi
  curl -sf http://127.0.0.1:8118/v1/models >/dev/null && log "genai server up: $(curl -s http://127.0.0.1:8118/v1/models | head -c 200)" || { log "genai server did NOT come up"; tail -20 "$W/server.log" | tee -a "$W/box.log"; return 1; }
}

infer() {
  serve
  local M=${1:-$W/manifest.tsv}
  local t0; t0=$(date +%s)
  local deadline=$(( t0 + INFER_HOURS * 3600 ))
  log "infer start: $(basename "$M") backend=$BACKEND runners=$WORKERS max_side=${MAX_SIDE:-0} layout=${LAYOUT:-1} prefetch=${PREFETCH:-4}, deadline $(date -u -d @$deadline +%FT%TZ), $(wc -l < "$M") rows"
  local pids=()
  for i in $(seq 0 $((WORKERS - 1))); do
    ( while [ "$(date +%s)" -lt "$deadline" ]; do
        "$W/venv/bin/python" "$HERE/paddle-zh-run.py" --manifest "$M" --root "$W" --worker "$i" --workers "$WORKERS" \
          --deadline "$deadline" --page-timeout "${PAGE_TIMEOUT:-90}" --max-side "${MAX_SIDE:-0}" --layout "${LAYOUT:-1}" \
          --backend "$BACKEND" --prefetch "${PREFETCH:-4}" >> "$W/worker-$i.log" 2>&1 && break
        echo "$(date -u +%FT%TZ) worker $i exited $? — restarting" >> "$W/box.log"
      done ) &
    pids+=($!)
  done
  # wait for the RUNNERS only: a bare `wait` also waits on the genai server when serve() started it from this shell,
  # and never returns (g01, #5660, 2026-10-06: the queue loop sat on chunk 1 for an hour)
  wait "${pids[@]}" || true
  echo $(( $(date +%s) - t0 )) > "$W/infer-secs"
  log "infer done in $(cat "$W/infer-secs") s"
}

# a benchmark arm (#5600 step 3): <name> <manifest> — the runners over a bench manifest into arms/<name>/,
# wall-clocked from the first runner's model load to the last page (arm.json: pages, wall, load secs, config)
arm() {
  local name=$1 M=$2 R=$W/arms/$1
  mkdir -p "$R"; ln -sfn "$W/bench/img" "$R/img"
  serve
  local t0; t0=$(date +%s.%N)
  # a runner exits 3 on a wedged page (its .err is written); restart it like infer does, at most 5 times,
  # so one slow page does not halve an arm's runners (measured 2026-10-02: a fresh pod's first page compiles
  # kernels for > 90 s, and the un-restarted runner took half the throughput set with it)
  for i in $(seq 0 $((WORKERS - 1))); do
    ( for k in 1 2 3 4 5 6; do
        "$W/venv/bin/python" "$HERE/paddle-zh-run.py" --manifest "$M" --root "$R" --worker "$i" --workers "$WORKERS" \
          --page-timeout "${PAGE_TIMEOUT:-90}" --max-side "${MAX_SIDE:-0}" --layout "${LAYOUT:-1}" --backend "$BACKEND" \
          --prefetch "${PREFETCH:-4}" --page-batch "${PAGE_BATCH:-1}" >> "$R/worker-$i.log" 2>&1 && break
        [ $? = 3 ] || break
        echo "$(date -u +%FT%TZ) arm $name worker $i exited 3 — restart $k" >> "$W/box.log"
      done ) &
  done
  wait || true
  local t1; t1=$(date +%s.%N)
  "$W/venv/bin/python" - "$R" "$t0" "$t1" "$name" "$BACKEND" "$WORKERS" "${MAX_SIDE:-0}" "${LAYOUT:-1}" "${PAGE_BATCH:-1}" <<'PY'
import json, glob, sys
r, t0, t1, name, backend, workers, max_side, layout, pb = sys.argv[1:]
T = [json.loads(l) for f in glob.glob(f'{r}/timings-*.jsonl') for l in open(f) if l.strip()]
loads = [x['secs'] for x in T if x.get('event') == 'loaded']
pages = [x for x in T if 'bid' in x and 'error' not in x]
errs = [x for x in T if 'bid' in x and 'error' in x]
wall = float(t1) - float(t0)
json.dump({'arm': name, 'backend': backend, 'workers': int(workers), 'max_side': int(max_side), 'layout': int(layout), 'page_batch': int(pb),
           'pages': len(pages), 'errors': len(errs), 'wall_secs': round(wall, 1), 'load_secs_max': max(loads) if loads else None,
           'wall_secs_after_load': round(wall - (max(loads) if loads else 0), 1)}, open(f'{r}/arm-run.json', 'w'), indent=1)
print(open(f'{r}/arm-run.json').read())
PY
}

loop() {
  mkdir -p "$W/queue"
  # serve before the first collect: on a fresh box the VL weights arrive with the server, and a box.json written
  # before them names no weights hash (every page applied from it said `not_recorded`, f05, 2026-10-02)
  setup; serve; collect
  local idle_since; idle_since=$(date +%s)
  while [ ! -e "$W/queue/FINISH" ]; do
    local next; next=$(ls -1tr "$W"/queue/*.tsv 2>/dev/null | head -1 || true)
    if [ -z "$next" ]; then
      [ $(( $(date +%s) - idle_since )) -ge $(( ${QUEUE_IDLE_MIN:-30} * 60 )) ] && { log "queue empty ${QUEUE_IDLE_MIN:-30} min — exiting"; break; }
      sleep 20; continue
    fi
    # a retry chunk (the fleet's wave 3): the runner skips a page that has an .err, so move each row's aside
    case $next in *-w3.tsv) while IFS=$'\t' read -r b p _; do if [ -e "$W/out/$b/$p.err" ]; then mv "$W/out/$b/$p.err" "$W/out/$b/$p.err.1"; fi; done < "$next"; log "retry chunk $(basename "$next"): .err moved aside" ;; esac
    INFER_HOURS=${INFER_HOURS:-24} infer "$next"
    mv "$next" "${next%.tsv}.done"; log "chunk $(basename "$next") done"; collect
    idle_since=$(date +%s)
  done
  collect
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
           'vllm_version': (subprocess.run([f'{w}/srv/bin/python', '-c', 'import vllm; print(vllm.__version__)'], capture_output=True, text=True).stdout.strip() or None) if backend == 'server' and os.path.exists(f'{w}/srv/bin/python') else None,
           'weights_sha256': h.hexdigest() if wf else None, 'pages_out': n, 'pages_err': e, 'infer_secs': secs,
           'wall_secs_per_page': round(secs / n, 2) if n and secs else None}, open(f'{w}/box.json', 'w'), indent=1)
PY
  log "collect: $(tr -d '\n ' < "$W/box.json" | head -c 600)"
}

case ${1:-} in
  setup) setup ;; serve) serve ;; infer) infer "${2:-}" ;; collect) collect ;;
  all) setup; infer; collect; touch "$W/DONE"; log DONE ;;
  loop) loop; touch "$W/DONE"; log DONE ;;
  arm) arm "$2" "$3" ;;
  *) echo "usage: $0 setup|serve|infer|collect|all|loop"; exit 1 ;;
esac
