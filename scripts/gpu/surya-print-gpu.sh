#!/usr/bin/env bash
# timeout: 6h
# issue: 95
# PRIOR ART: scripts/gpu/gpu-print-gpu.sh (#6871: the LightOnOCR print lane's gpu-queue task — serve, read the lane's
# manifest, record the run, stop; same shape, another engine) and scripts/eval/sanskrit-gex45-7243/drive.sh `surya` (the
# Surya 2 vLLM flags and the surya_ocr call the #7243 tests measured; copied, so the lane reads as the tests read).
# This is the GPU half of scripts/workers/gpu-print-lane.mjs --lang sa (Sanskrit printed Devanagari, v3 #95).
#
# Not queued directly: scripts/gpu/gpu-print-gpu.sh hands over to this file when the lane dir's `lang` file says sa, so
# the ocr-filler's gpu-print task (plan, read, apply) runs the Sanskrit lane unchanged.
# Reads $LANE_DIR/manifest.tsv pages not yet back → $LANE_DIR/out/<bid>/<pn>.json|.err, writes $LANE_DIR/runs/<run>.json.
# Stops between batches at the deadline; the next chunk resumes. Nothing here writes to Mongo:
# `gpu-print-lane.mjs apply --apply` judges and writes the pages.
set -uo pipefail
LANE_DIR=${LANE_DIR:?LANE_DIR is required}; VL=/root/bench/vl; SU=/root/bench/surya; CODE=${CODE_DIR:-/root/sourcelibrary}
# util 0.6: the confirmation run's setting (task 152-sanskrit-confirm-7243: 15.3 GB peak, 2,535 pages/h on 50 pages).
UTIL=${UTIL:-0.6}; HOURS=${HOURS:-5}; PORT=8010; BATCH=${BATCH:-200}; MODEL=datalab-to/surya-ocr-2
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
RUN=su-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$LANE_DIR/runs" "$LANE_DIR/out" "$LANE_DIR/tmp"
# a batch holds up to $BATCH page images until it is read: refuse to start on a nearly full disk (a recorded skip, rc 75)
free_g=$(df -BG --output=avail "$LANE_DIR" | tail -1 | tr -dc 0-9)
[ "${free_g:-0}" -lt 5 ] && { echo "OCR-FILLER-SKIP ${free_g}G free under $LANE_DIR < 5G"; exit 75; }
rm -rf "$LANE_DIR"/tmp/b* 2>/dev/null   # a batch dir left by a killed chunk
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1; }
echo "$(date -u +%FT%TZ) $RUN start; GPU $(gpu_mib) MiB; disk ${free_g}G"
SPID=
serve() {  # serve [extra vllm args...]
  nohup "$VL/bin/vllm" serve "$MODEL" --served-model-name "$MODEL" --port $PORT --host 127.0.0.1 \
    --gpu-memory-utilization "$UTIL" --max-model-len 18000 --dtype bfloat16 --max-num-seqs 16 --enable-prefix-caching \
    --mm-processor-kwargs '{"min_pixels": 3136, "max_pixels": 6291456}' "$@" > "$LANE_DIR/runs/$RUN.serve.log" 2>&1 < /dev/null &
  SPID=$!
  for i in $(seq 1 120); do curl -sf http://127.0.0.1:$PORT/v1/models >/dev/null 2>&1 && return 0; kill -0 $SPID 2>/dev/null || break; sleep 5; done
  return 1
}
stop() { [ -n "$SPID" ] && { kill "$SPID" 2>/dev/null; sleep 8; kill -9 "$SPID" 2>/dev/null; }; pkill -f -- "--port $PORT" 2>/dev/null; sleep 3; }
trap stop EXIT
MTP=1
serve --speculative-config '{"method":"mtp","num_speculative_tokens":2}' || { echo "retry without MTP"; stop; MTP=0; serve; } \
  || { echo "vLLM did not start"; tail -5 "$LANE_DIR/runs/$RUN.serve.log"; exit 1; }
SNAPDIR=$(ls -d /root/.cache/huggingface/hub/models--datalab-to--surya-ocr-2/snapshots/* 2>/dev/null | head -1)
"$SU/bin/python" - "$LANE_DIR/runs/$RUN.json" "$SNAPDIR" "$UTIL" "$MTP" "$VL/bin/python" <<'PY'
import json, os, re, socket, subprocess, sys
from importlib import metadata
out, snapdir, util, mtp, vlpy = sys.argv[1:6]
gpu = subprocess.run(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'], capture_output=True, text=True).stdout.strip()
vllm = subprocess.run([vlpy, '-c', 'import vllm; print(vllm.__version__)'], capture_output=True, text=True).stdout.strip() or None
try: surya = metadata.version('surya-ocr')
except Exception: surya = None  # noqa: BLE001
# the licence as the served snapshot's model card states it (front matter `license:` / `license_name:`), never typed here
licence = None
card = os.path.join(snapdir, 'README.md') if snapdir else ''
if card and os.path.exists(card):
    head = open(card, encoding='utf-8', errors='replace').read(4000)
    m = re.search(r'^license_name:\s*(.+)$', head, re.M) or re.search(r'^license:\s*(.+)$', head, re.M)
    licence = m.group(1).strip().strip('"\'') if m else None
json.dump({'run': os.path.basename(out)[:-5], 'host': socket.gethostname(), 'gpu': gpu, 'vllm_version': vllm, 'surya_version': surya,
           'weights_revision': f'hf:datalab-to/surya-ocr-2@{os.path.basename(snapdir)}' if snapdir else None, 'licence': licence,
           'util': float(util), 'dtype': 'bfloat16', 'mtp': mtp == '1'}, open(out, 'w'), indent=1)
PY
"$SU/bin/python" "$CODE/scripts/gpu/surya-print-read.py" "$LANE_DIR" --surya "$SU/bin/surya_ocr" --url http://127.0.0.1:$PORT/v1 \
  --batch "$BATCH" --deadline $(( $(date +%s) + HOURS * 3600 )) ${LIMIT:+--limit $LIMIT}; rc=$?
echo "$(date -u +%FT%TZ) $RUN end rc=$rc"
exit $rc
