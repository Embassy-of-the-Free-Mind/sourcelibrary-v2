#!/usr/bin/env bash
# paddle-vl-box.sh — the GPU half of a PaddleOCR-VL run (#5547 step 4; recipe of #4743/#4925).
# Runs ON a rented Scaleway L4 (Ubuntu Noble GPU OS image: NVIDIA driver present, no Python venv).
#
# PRIOR ART: scripts/gpu/ndl-koten-box.sh (#4925 NDL lane — same setup/infer/collect split, the
# output-file-is-the-checkpoint rule, run under idle-poweroff.sh). NDL ships a docker image; Paddle is
# a pip install, so setup is a venv, and the reader is scripts/gpu/paddle-vl-run.py.
#
#   paddle-vl-box.sh setup     venv + paddlepaddle-gpu 3.2.1 + paddleocr[doc-parser] 3.7.0 / paddlex 3.7.2
#                               (the 2026-09-18 versions; falls back to the latest if a pin is gone, and says so)
#   paddle-vl-box.sh infer     WORKERS (default 3) runners over manifest.tsv until INFER_HOURS (default 3) elapse
#   paddle-vl-box.sh collect   box.json: versions, GPU, wall seconds, pages out, s/page
#   paddle-vl-box.sh all       the three in order, then touch DONE
# Run it under idle-poweroff.sh so the box stops itself when the job ends:
#   idle-poweroff.sh run -- bash -c 'paddle-vl-box.sh all; sleep 1500'   (25 min to pull the outputs)
set -euo pipefail
W=${PV_WORK:-/root/pv}
WORKERS=${WORKERS:-2}
INFER_HOURS=${INFER_HOURS:-3}
HERE=$(cd "$(dirname "$0")" && pwd)
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$W/box.log"; }

setup() {
  if [ ! -x "$W/venv/bin/python" ]; then
    apt-get -qq update >/dev/null 2>&1 || true
    apt-get -qq install -y python3-venv libgl1 libglib2.0-0 >/dev/null 2>&1 || true
    python3 -m venv "$W/venv"
  fi
  local P="$W/venv/bin/pip"
  $P install -q --upgrade pip >> "$W/setup.log" 2>&1
  $P install -q paddlepaddle-gpu==3.2.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu126/ >> "$W/setup.log" 2>&1 \
    || { log "pin paddlepaddle-gpu==3.2.1 failed; installing latest cu126"; $P install -q paddlepaddle-gpu -i https://www.paddlepaddle.org.cn/packages/stable/cu126/ >> "$W/setup.log" 2>&1; }
  $P install -q "paddleocr[doc-parser]==3.7.0" "paddlex==3.7.2" >> "$W/setup.log" 2>&1 \
    || { log "pin paddleocr 3.7.0 / paddlex 3.7.2 failed; installing latest"; $P install -q "paddleocr[doc-parser]" >> "$W/setup.log" 2>&1; }
  log "setup ok: $($W/venv/bin/python -c 'import paddle,paddleocr,paddlex;print("paddle",paddle.__version__,"paddleocr",paddleocr.__version__,"paddlex",paddlex.__version__)') $(nvidia-smi --query-gpu=name,driver_version --format=csv,noheader)"
}

infer() {
  local t0; t0=$(date +%s)
  local deadline=$(( t0 + INFER_HOURS * 3600 ))
  log "infer start: $WORKERS workers, deadline $(date -u -d @$deadline +%FT%TZ), $(wc -l < "$W/manifest.tsv") manifest rows"
  # A runner exits 3 when a page wedges the pipeline (see paddle-vl-run.py); restart it until the deadline.
  # WORKERS: 2 is the L4's limit (each runner holds ~10.5 GB; a third OOMs at load, measured 2026-10-01).
  for i in $(seq 0 $((WORKERS - 1))); do
    ( while [ "$(date +%s)" -lt "$deadline" ]; do
        "$W/venv/bin/python" "$HERE/paddle-vl-run.py" --manifest "$W/manifest.tsv" --root "$W" --worker "$i" --workers "$WORKERS" --deadline "$deadline" --page-timeout "${PAGE_TIMEOUT:-90}" >> "$W/worker-$i.log" 2>&1 && break
        echo "$(date -u +%FT%TZ) worker $i exited $? — restarting" >> "$W/box.log"
      done ) &
  done
  wait || true
  echo $(( $(date +%s) - t0 )) > "$W/infer-secs"
  log "infer done in $(cat "$W/infer-secs") s"
}

collect() {
  cat "$W"/timings-*.jsonl > "$W/timings.jsonl" 2>/dev/null || true
  "$W/venv/bin/python" - "$W" "$WORKERS" <<'PY'
import json, os, socket, subprocess, sys
w, workers = sys.argv[1], int(sys.argv[2])
secs = int(open(f'{w}/infer-secs').read()) if os.path.exists(f'{w}/infer-secs') else None
n = sum(1 for d, _, fs in os.walk(f'{w}/out') for f in fs if f.endswith('.txt'))
import paddle, paddleocr, paddlex
gpu = subprocess.run(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'], capture_output=True, text=True).stdout.strip()
json.dump({'host': socket.gethostname(), 'gpu': gpu, 'workers': workers, 'paddle_version': paddle.__version__, 'paddleocr_version': paddleocr.__version__,
           'paddlex_version': paddlex.__version__, 'vl_model': 'PaddleOCRVL() default pipeline', 'pages_out': n, 'infer_secs': secs,
           'wall_secs_per_page': round(secs / n, 2) if n and secs else None}, open(f'{w}/box.json', 'w'), indent=1)
PY
  log "collect: $(tr -d '\n ' < "$W/box.json")"
}

case ${1:-} in
  setup) setup ;; infer) infer ;; collect) collect ;;
  all) setup; infer; collect; touch "$W/DONE"; log DONE ;;
  *) echo "usage: $0 setup|infer|collect|all"; exit 1 ;;
esac
