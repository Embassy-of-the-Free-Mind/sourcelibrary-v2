#!/usr/bin/env bash
# timeout: 2h
# issue: 6871
# PRIOR ART: scripts/gpu/paddle-zh-queue-task.sh (the gex45 gpu-queue Paddle task: genai vLLM server stopped by its own
# pid, N runner clients, exit-3 restart, run.json; copied, minus the Mongo half). It reads each page once, with the
# production settings; this reads the same ~260 pages four times under different settings and writes files only.
#
# Stage 2 (PREREG-print.md): the Chinese print lane's leaves (crops as the lane made them), two arms into $J/<arm>/out:
#   OFF  production print settings again (layout off, server): today's stack, to compare with the stored reads
#   ON   layout on: the flip, as stage 1's L arm flipped the Siku setting
# Queue: cp print-task.sh /tmp/psp.sh && /root/bin/gpu-queue.sh add /tmp/psp.sh 05-paddle-self-agree-print-6871
# Nothing is written to Mongo; no Gemini, nothing paid.
set -uo pipefail
J=${PSA_DIR:-/root/jobs/paddle-self-agree-6871/print}
CODE_DIR=${CODE_DIR:-/root/sourcelibrary}
RUNNER=$CODE_DIR/scripts/gpu/paddle-zh-run.py
W=${CLIENTS:-6}
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; }
stop_server() {
  [ -n "${SP:-}" ] || return 0
  pkill -TERM -P "$SP" 2>/dev/null; kill "$SP" 2>/dev/null; SP=
  sleep 8; pkill -9 -f "[p]addlex_genai_server.*--port 8118"; sleep 3
  for i in $(seq 1 30); do [ "$(gpu_mib)" -lt 600 ] && break; sleep 2; done
  echo "$(date -u +%FT%TZ) server stopped, GPU $(gpu_mib) MiB"
}
trap stop_server EXIT
[ -s "$J/manifest.tsv" ] || { echo "no manifest at $J/manifest.tsv (run the draw first)"; exit 1; }
[ -f "$RUNNER" ] || { echo "no runner at $RUNNER"; exit 1; }

WF=/root/.paddlex/official_models/PaddleOCR-VL-1.6/model.safetensors
cat > "$J/run.json" <<EOF
{"host": "$(hostname)", "gpu": "$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)", "code": "$(git -C "$CODE_DIR" rev-parse HEAD)",
 "vllm": "$(/root/pz/srv/bin/python -c 'import vllm; print(vllm.__version__)' 2>/dev/null)",
 "paddleocr": "$(/root/pz/venv/bin/python -c 'import paddleocr; print(paddleocr.__version__)' 2>/dev/null)",
 "weights_sha256": "$(sha256sum "$WF" | cut -d' ' -f1)", "started_at": "$(date -u +%FT%TZ)", "pages": $(wc -l < "$J/manifest.tsv"),
 "arms": {"OFF": "--layout 0", "ON": "--layout 1"}}
EOF
PATH=/root/pz/srv/bin:$PATH nohup /root/pz/srv/bin/paddlex_genai_server --model_name PaddleOCR-VL-1.6-0.9B --backend vllm --port 8118 > "$J/serve.log" 2>&1 < /dev/null &
SP=$!
for i in $(seq 1 120); do curl -sf http://127.0.0.1:8118/v1/models >/dev/null 2>&1 && break; sleep 5; done
curl -sf http://127.0.0.1:8118/v1/models >/dev/null || { echo "genai server did not come up"; tail -20 "$J/serve.log"; exit 1; }
echo "$(date -u +%FT%TZ) server up, GPU $(gpu_mib) MiB"

arm() {  # name, layout, max-side
  local A=$1 s=$(date +%s) pids=(); mkdir -p "$J/$A"
  for w in $(seq 0 $((W - 1))); do
    ( while :; do
        /root/pz/venv/bin/python "$RUNNER" --manifest "$J/manifest.tsv" --root "$J/$A" --worker $w --workers $W \
          --page-timeout 90 --layout "$2" --max-side "$3" --backend server --prefetch 3 >> "$J/$A/worker-$w.log" 2>&1
        rc=$?; [ $rc -eq 3 ] || break
      done ) & pids+=($!)
  done
  wait "${pids[@]}"   # not a bare wait: the server is a child of this shell too
  echo "$(date -u +%FT%TZ) arm $A in $(( $(date +%s) - s ))s: $(find "$J/$A/out" -name '*.txt' | wc -l) txt, $(find "$J/$A/out" -name '*.err' 2>/dev/null | wc -l) err"
}
arm OFF 0 0
arm ON 1 0
stop_server
