#!/usr/bin/env bash
# timeout: 1h
# issue: 6101
# PRIOR ART: gex45 gpu-queue tasks 50-zh-guarded-read (server start/stop by pid) and scripts/gpu/paddle-vl-box.sh (restart a worker that exits 3); runner scripts/gpu/paddle-zh-run.py unchanged.
# The frame read with the NATIVE backend wedged: from ~23:45Z on 2026-10-22, every freshly started PaddleOCR-VL native
# process hangs in its first decode step (GPU 0 %, one core spinning in _C_ops.embedding; GPU itself healthy, venv
# unchanged, no Xid), while the one long-lived worker read all 1,457 left leaves. The genai vLLM-server backend works
# (one leaf: 198 vs 198 Han characters vs the native read, similarity 0.995). So P1 is read here through the server
# (`paddle-zh-run.py --backend server`, layout off, same leaves, 90 s per leaf): first the shared 198 (p1s, to measure
# the backend against native P1), then every frame leaf (p1s-frame). Server started first, stopped by its own pid.
# 068: the same server recipe on the 285-page failure set (p1s-fail), so the woodblock frame arm is server-read throughout.
set -uo pipefail
J=/root/jobs/paddle-split-6101
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; }
stop_server() {
  [ -n "${SP:-}" ] && { pkill -TERM -P "$SP" 2>/dev/null; kill "$SP" 2>/dev/null; }
  sleep 8; pkill -9 -f "[p]addlex_genai_server.*--port 8118"; sleep 3
  for i in $(seq 1 30); do [ "$(gpu_mib)" -lt 600 ] && break; sleep 2; done
  echo "$(date -u +%FT%TZ) server stopped, GPU $(gpu_mib) MiB"
}
trap stop_server EXIT
PATH=/root/pz/srv/bin:$PATH nohup /root/pz/srv/bin/paddlex_genai_server --model_name PaddleOCR-VL-1.6-0.9B --backend vllm --port 8118 > "$J/serve-066.log" 2>&1 < /dev/null &
SP=$!
for i in $(seq 1 120); do curl -sf http://127.0.0.1:8118/v1/models >/dev/null 2>&1 && break; sleep 5; done
curl -sf http://127.0.0.1:8118/v1/models >/dev/null || { echo "genai server did not come up"; tail -20 "$J/serve-066.log"; exit 1; }
echo "$(date -u +%FT%TZ) server up, GPU $(gpu_mib) MiB"
run_arm() {
  local arm=$1 man=$2 root=$J/$1 W=4
  mkdir -p "$root"; ln -sfn "$J/leaves" "$root/leaves"
  echo "$(date -u +%FT%TZ) $arm start ($(wc -l < "$J/$man") leaves, server, $W clients)"; local s=$(date +%s)
  local pids=(); for w in $(seq 0 $((W - 1))); do
    ( while :; do
        /root/pz/venv/bin/python /root/pz/code/paddle-zh-run.py --manifest "$J/$man" --root "$root" --worker $w --workers $W \
          --page-timeout 90 --layout 0 --backend server --prefetch 2 >> "$root/worker-$w.log" 2>&1
        rc=$?; echo "$(date -u +%FT%TZ) $arm worker $w rc=$rc" >> "$root/restarts.log"; [ $rc -eq 3 ] || break
      done ) & pids+=($!)
  done
  wait "${pids[@]}"   # NOT a bare wait: the genai server is also a child of this shell (066 hung there)
  echo "$(date -u +%FT%TZ) $arm done in $(( $(date +%s) - s ))s: $(find "$root/out" -name '*.txt' | wc -l) txt, $(find "$root/out" -name '*.err' | wc -l) err; GPU $(gpu_mib) MiB"
}
run_arm p1s-fail manifest-fail.tsv
echo "$(date -u +%FT%TZ) all done"
