#!/usr/bin/env bash
# timeout: 12h
# issue: 6871
# task.sh: gpu-queue task 50-zh-guarded-read on gex45. Guarded production Paddle over the held Chinese table + mixed
# residue (27,048 pages), to files only (#6871 row 3, job zh-guarded-read-6871).
# PRIOR ART: scripts/eval/zh-confirm-6871/paddle.sh (server first, the P0 settings, stop by unique args; copied).
# The work is drive.py. Code and manifest are staged in /root/jobs/zh-guarded-read-6871/ (code/, manifest.tsv).
#
#   queue:   /root/bin/gpu-queue.sh add /root/jobs/zh-guarded-read-6871/code/task.sh 50-zh-guarded-read
#   smoke:   OUT=/root/jobs/zh-guarded-read-6871/smoke LIMIT_BOOKS=2 flock -w 300 /root/gpu.lock bash task.sh
# Resumable: re-queue under a new name (e.g. 51-zh-guarded-read-resume) with the same OUT and it skips finished books.
# Nothing here talks to Mongo.
set -uo pipefail
J=/root/jobs/zh-guarded-read-6871
OUT=${OUT:-/root/jobs/gpu-queue/50-zh-guarded-read}
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; }
stop_server() {
  [ -n "${SP:-}" ] && { pkill -TERM -P "$SP" 2>/dev/null; kill "$SP" 2>/dev/null; }
  sleep 8; pkill -9 -f "[p]addlex_genai_server.*--port 8118"; sleep 3
  for i in $(seq 1 30); do [ "$(gpu_mib)" -lt 600 ] && break; sleep 2; done
  echo "$(date -u +%FT%TZ) server stopped, GPU $(gpu_mib) MiB"
}
trap stop_server EXIT
mkdir -p "$OUT"
echo "$(date -u +%FT%TZ) start, GPU $(gpu_mib) MiB, out $OUT"
PATH=/root/pz/srv/bin:$PATH nohup /root/pz/srv/bin/paddlex_genai_server --model_name PaddleOCR-VL-1.6-0.9B --backend vllm --port 8118 > "$OUT/serve-paddle.log" 2>&1 < /dev/null &
SP=$!
for i in $(seq 1 120); do curl -sf http://127.0.0.1:8118/v1/models >/dev/null 2>&1 && break; sleep 5; done
curl -sf http://127.0.0.1:8118/v1/models >/dev/null || { echo "genai server did not come up"; tail -20 "$OUT/serve-paddle.log"; exit 1; }
echo "$(date -u +%FT%TZ) server up, GPU $(gpu_mib) MiB"
/root/pz/venv/bin/python "$J/code/drive.py" --manifest "$J/manifest.tsv" --out "$OUT" --code "$J/code" \
  --chunk "${CHUNK:-600}" --clients "${CLIENTS:-8}" ${LIMIT_BOOKS:+--limit-books $LIMIT_BOOKS}
rc=$?
echo "$(date -u +%FT%TZ) drive.py rc=$rc"
exit $rc
