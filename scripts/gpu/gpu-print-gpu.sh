#!/usr/bin/env bash
# timeout: 6h
# issue: 6871
# PRIOR ART: scripts/gpu/paddle-print-gpu.sh (#6101: the Paddle print lane's gpu-queue task — serve, read the lane's
# manifest, record the run, stop) and scripts/eval/print1800-gpu-6871/drive.sh (the LightOnOCR vLLM flags the #6871
# eval measured; copied). This is the GPU half of scripts/workers/gpu-print-lane.mjs (1800+ English print, #6871).
#
# Queued by scripts/gpu/ocr-filler.sh (kind gpu-print) or by hand: gpu-queue.sh add scripts/gpu/gpu-print-gpu.sh NN-gpu-print
# Reads $LANE_DIR/manifest.tsv pages not yet back → $LANE_DIR/out/<bid>/<pn>.json|.err, writes $LANE_DIR/runs/<run>.json.
# Stops between pages at the deadline (inside the queue timeout); the next chunk resumes. Nothing here writes to Mongo:
# scripts/workers/gpu-print-lane.mjs apply --apply writes the pages.
set -uo pipefail
LANE_DIR=${LANE_DIR:-/root/jobs/gpu-print-6871}; VL=/root/bench/vl; CODE=${CODE_DIR:-/root/sourcelibrary}
UTIL=${UTIL:-0.6}; HOURS=${HOURS:-5}; PORT=8010
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
RUN=lo-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$LANE_DIR/runs" "$LANE_DIR/out"
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1; }
echo "$(date -u +%FT%TZ) $RUN start; GPU $(gpu_mib) MiB"
nohup "$VL/bin/vllm" serve lightonai/LightOnOCR-3-1B --served-model-name m --port $PORT --host 127.0.0.1 \
  --gpu-memory-utilization "$UTIL" --max-model-len 16384 --limit-mm-per-prompt '{"image":1}' --mm-processor-cache-gb 0 \
  --no-enable-prefix-caching > "$LANE_DIR/runs/$RUN.serve.log" 2>&1 < /dev/null &
SPID=$!
stop() { kill "$SPID" 2>/dev/null; sleep 8; kill -9 "$SPID" 2>/dev/null; pkill -f -- "--port $PORT" 2>/dev/null; sleep 3; }
trap stop EXIT
for i in $(seq 1 120); do curl -sf http://127.0.0.1:$PORT/v1/models >/dev/null 2>&1 && break; kill -0 $SPID 2>/dev/null || break; sleep 5; done
curl -sf http://127.0.0.1:$PORT/v1/models >/dev/null 2>&1 || { echo "vLLM did not start"; tail -5 "$LANE_DIR/runs/$RUN.serve.log"; exit 1; }
SNAP=$(ls -d /root/.cache/huggingface/hub/models--lightonai--LightOnOCR-3-1B/snapshots/* 2>/dev/null | head -1 | xargs -r basename)
"$VL/bin/python" - "$LANE_DIR/runs/$RUN.json" "$SNAP" <<'PY'
import json, socket, subprocess, sys
import vllm
gpu = subprocess.run(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'], capture_output=True, text=True).stdout.strip()
json.dump({'run': sys.argv[1].rsplit('/', 1)[1][:-5], 'host': socket.gethostname(), 'gpu': gpu, 'vllm_version': vllm.__version__,
           'weights_revision': f'hf:lightonai/LightOnOCR-3-1B@{sys.argv[2]}' if sys.argv[2] else None, 'util': None}, open(sys.argv[1], 'w'), indent=1)
PY
"$VL/bin/python" "$CODE/scripts/gpu/gpu-print-read.py" "$LANE_DIR" --url http://127.0.0.1:$PORT/v1 --clients 16 \
  --deadline $(( $(date +%s) + HOURS * 3600 )) ${LIMIT:+--limit $LIMIT}
echo "$(date -u +%FT%TZ) $RUN end"
