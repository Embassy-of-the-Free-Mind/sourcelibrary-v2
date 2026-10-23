#!/usr/bin/env bash
# timeout: 24h
# issue: 6101
# PRIOR ART: scripts/eval/paddle-split-6101/067-paddle-split-6101-server.sh (#7184 — the genai vLLM server started
# first and stopped by its own pid, 4 runner clients, layout off, 90 s per leaf, a worker that exits 3 restarted;
# copied) and the zh-guarded-read-6871 driver (run.json: versions, weights sha256, host, GPU). The runner is
# scripts/gpu/paddle-zh-run.py with the crop-box manifest column.
#
# The GPU half of the Paddle split-leaf print lane (#6101): read every leaf in $J/manifest.tsv that has no output yet
# (out/<bid>/<pn>-<side>.txt|.err is the checkpoint), then stop. A gpu-queue task (gex45, flock /root/gpu.lock):
#   cp scripts/gpu/paddle-print-gpu.sh /tmp/x.sh && /root/bin/gpu-queue.sh add /tmp/x.sh 64-paddle-print-6101-a
# It re-reads the manifest while prep is still appending to it, then lists the short leaves (recheck) and reads them
# again at 1,200 px on the same server (RECHECK=0 skips; CODE_DIR is the checkout with paddle-print-lane.mjs).
# Each run stops itself after DEADLINE_H hours (default 22, inside the 24 h timeout) so the card is never held past a
# chunk; queue the next chunk (-b, -c …) under a new name until `paddle-print-lane.mjs status` shows no leaf missing.
# Nothing here writes to Mongo: `paddle-print-lane.mjs apply` does, on the CPU side.
set -uo pipefail
J=${LANE_DIR:-/root/jobs/paddle-print-6101}
MANIFEST=${MANIFEST:-$J/manifest.tsv}   # the canary sets its own subset
ROOT=${ROOT:-$J}                       # the short-leaf recheck reads into $J/recheck
MAX_SIDE=${MAX_SIDE:-0}                # the recheck reads at 1200
NAME=${GPU_TASK_NAME:-$(basename "$PWD")}
W=${CLIENTS:-4}
DEADLINE=$(( $(date +%s) + ${DEADLINE_H:-22} * 3600 ))
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; }
stop_server() {
  [ -n "${SP:-}" ] && { pkill -TERM -P "$SP" 2>/dev/null; kill "$SP" 2>/dev/null; }
  sleep 8; pkill -9 -f "[p]addlex_genai_server.*--port 8118"; sleep 3
  for i in $(seq 1 30); do [ "$(gpu_mib)" -lt 600 ] && break; sleep 2; done
  echo "$(date -u +%FT%TZ) server stopped, GPU $(gpu_mib) MiB"
}
trap stop_server EXIT
[ -s "$MANIFEST" ] || { echo "no manifest at $MANIFEST"; exit 1; }
[ -f "$J/code/paddle-zh-run.py" ] || { echo "no runner at $J/code/paddle-zh-run.py (copy scripts/gpu/paddle-zh-run.py there)"; exit 1; }
mkdir -p "$J/runs" "$J/gpu/$NAME"

# provenance for every page this run reads: versions, weights hash, host, GPU, serving (read by ocrField)
WF=/root/.paddlex/official_models/PaddleOCR-VL-1.6/model.safetensors
read -r PV POV PXV < <(/root/pz/venv/bin/python -c 'import paddle, paddleocr, paddlex; print(paddle.__version__, paddleocr.__version__, paddlex.__version__)' 2>/dev/null)
VV=$(/root/pz/srv/bin/python -c 'import vllm; print(vllm.__version__)' 2>/dev/null)
cat > "$J/runs/$NAME.json" <<EOF
{"run": "$NAME", "issue": 6101, "host": "$(hostname)", "gpu": "$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)",
 "backend": "server", "workers": $W, "layout": 0, "vllm_version": "$VV",
 "paddle_version": "$PV", "paddleocr_version": "$POV", "paddlex_version": "$PXV",
 "weights_files": ["PaddleOCR-VL-1.6/model.safetensors"], "weights_sha256": "$(sha256sum "$WF" | cut -d' ' -f1)",
 "started_at": "$(date -u +%FT%TZ)", "root": "$ROOT", "max_side": $MAX_SIDE, "manifest": "$MANIFEST", "manifest_lines": $(wc -l < "$MANIFEST")}
EOF

PATH=/root/pz/srv/bin:$PATH nohup /root/pz/srv/bin/paddlex_genai_server --model_name PaddleOCR-VL-1.6-0.9B --backend vllm --port 8118 > "$J/gpu/$NAME/serve.log" 2>&1 < /dev/null &
SP=$!
for i in $(seq 1 120); do curl -sf http://127.0.0.1:8118/v1/models >/dev/null 2>&1 && break; sleep 5; done
curl -sf http://127.0.0.1:8118/v1/models >/dev/null || { echo "genai server did not come up"; tail -20 "$J/gpu/$NAME/serve.log"; exit 1; }
echo "$(date -u +%FT%TZ) server up, GPU $(gpu_mib) MiB; $(wc -l < "$MANIFEST") leaves in the manifest, $W clients"
read_pass() {   # <manifest> <root> <max side>: W clients over the leaves of <manifest> with no output under <root> yet
  local man=$1 root=$2 side=$3 pids=() w
  mkdir -p "$root"
  for w in $(seq 0 $((W - 1))); do
    ( while :; do
        /root/pz/venv/bin/python "$J/code/paddle-zh-run.py" --manifest "$man" --root "$root" --max-side "$side" --worker $w --workers $W \
          --page-timeout 90 --layout 0 --backend server --prefetch 3 --deadline "$DEADLINE" >> "$J/gpu/$NAME/worker-$w.log" 2>&1
        rc=$?; echo "$(date -u +%FT%TZ) worker $w rc=$rc ($man)" >> "$J/gpu/$NAME/restarts.log"; [ $rc -eq 3 ] || break
      done ) & pids+=($!)
  done
  wait "${pids[@]}"   # NOT a bare wait: the genai server is also a child of this shell (#7184 066 hung there)
}
s=$(date +%s)
# prep may still be appending to the manifest: read it again until a pass starts with no new lines
prev=-1
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  n=$(wc -l < "$MANIFEST"); [ "$n" = "$prev" ] && break; prev=$n
  echo "$(date -u +%FT%TZ) pass over $n manifest lines"
  read_pass "$MANIFEST" "$ROOT" "$MAX_SIDE"
done
# the short-leaf recheck (paddle-print-lane.mjs recheck lists leaves under 60 characters) on the same server
if [ "${RECHECK:-1}" = 1 ] && [ "$ROOT" = "$J" ] && [ "$(date +%s)" -lt "$DEADLINE" ]; then
  node "${CODE_DIR:-/root/sourcelibrary}/scripts/workers/paddle-print-lane.mjs" recheck --dir "$J" 2>&1 | tail -1
  [ -s "$J/recheck/manifest.tsv" ] && read_pass "$J/recheck/manifest.tsv" "$J/recheck" 1200
fi
echo "$(date -u +%FT%TZ) done in $(( $(date +%s) - s ))s: $(find "$ROOT/out" -name '*.txt' | wc -l) txt, $(find "$ROOT/out" -name '*.err' | wc -l) err in all runs; GPU $(gpu_mib) MiB"
