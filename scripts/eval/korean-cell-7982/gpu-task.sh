#!/usr/bin/env bash
# timeout: 2h
# issue: 7982
# PRIOR ART: scripts/eval/sanskrit-gex45-7243/drive.sh (serve → read every page → stop, one engine at a time; its PV arm =
# PaddleOCR-VL-1.6 through the genai server and /root/pz/code/paddle-zh-box.sh arm with layout off, the zh lane's P0
# setting; its Q arm = Qwen3-VL-8B-Instruct-FP8 on /root/bench/vl vLLM; both copied, the Q prompt replaced by read.py
# mode `kore`). scripts/eval/latin-paired-6740/gpu-task.sh (one hand-queued gpu-queue task over a study's image folder).
#
# gpu-task.sh — the two GPU arms of the #7982 Korean cell test (scripts/eval/experiments/2026-11-03-korean-ocr-cell-7982.md),
# one hand-queued gpu-queue task. Nothing here writes to Mongo or calls agy.
#   K=/root/jobs/korean-ocr-cell-7982/kc-7982 CODE_DIR=<checkout> bash gpu-task.sh [PV] [Q]
set -uo pipefail
K=${K:-/root/jobs/korean-ocr-cell-7982/kc-7982}
C=${CODE_DIR:-/root/worktrees/job-korean-ocr-cell-7982}/scripts/eval/korean-cell-7982
J=$K/gpu; IMG=$J/in; VL=/root/bench/vl; UTIL=${UTIL:-0.6}
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
mkdir -p "$J/out"
log() { echo "$(date -u +%FT%TZ) [$ARM] $*" | tee -a "$J/drive.log"; }
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; }
stop_server() {
  local p; p=$(cat "$J/serve.pid" 2>/dev/null)
  [ -n "$p" ] && { pkill -TERM -P "$p" 2>/dev/null; kill "$p" 2>/dev/null; sleep 8; pkill -KILL -P "$p" 2>/dev/null; kill -9 "$p" 2>/dev/null; }
  for i in $(seq 1 30); do [ "$(gpu_mib)" -lt 600 ] && break; sleep 2; done
  if [ "$(gpu_mib)" -ge 600 ]; then
    pkill -f -- '--port 8010'; pkill -f '[p]addlex_genai_server.*--port 8118'; sleep 10
    pkill -9 -f -- '--port 8010'; pkill -9 -f '[p]addlex_genai_server.*--port 8118'; sleep 3
  fi
  rm -f "$J/serve.pid"
}
trap stop_server EXIT
paddle_vl() {
  ls "$IMG" | sed 's/\.jpg$//' | awk '{print $1"\t1\t'"$IMG"'/"$1".jpg"}' > "$J/paddle-manifest.tsv"
  PATH=/root/pz/srv/bin:$PATH nohup /root/pz/srv/bin/paddlex_genai_server --model_name PaddleOCR-VL-1.6-0.9B --backend vllm --port 8118 > "$J/serve-PV.log" 2>&1 < /dev/null &
  echo $! > "$J/serve.pid"
  for i in $(seq 1 120); do curl -sf http://127.0.0.1:8118/v1/models >/dev/null 2>&1 && break; sleep 5; done
  local name=korean7982-pv t0; rm -rf "/root/pz/arms/$name"; t0=$(date +%s)
  PV_WORK=/root/pz BACKEND=server CLIENTS=8 LAYOUT=0 timeout 1800 bash /root/pz/code/paddle-zh-box.sh arm "$name" "$J/paddle-manifest.tsv" >> "$J/paddle.log" 2>&1
  cp "/root/pz/arms/$name/arm-run.json" "$J/out/PV.jsonl.run.json" 2>/dev/null
  /root/pz/venv/bin/python - "/root/pz/arms/$name/out" "$J/out/PV.jsonl" <<'PY'
import json, os, sys
d, o = sys.argv[1:]
with open(o, 'w') as f:
    for pid in sorted(os.listdir(d)):
        t = os.path.join(d, pid, '1.txt'); e = os.path.join(d, pid, '1.err')
        row = {'page_id': pid, 'text': open(t).read()} if os.path.exists(t) else {'page_id': pid, 'text': '', 'error': open(e).read()[:300] if os.path.exists(e) else 'missing'}
        f.write(json.dumps(row, ensure_ascii=False) + '\n')
PY
  log "PV wall $(( $(date +%s) - t0 )) s, $(wc -l < "$J/out/PV.jsonl") rows"; stop_server
}
qwen() {
  local t0; t0=$(date +%s)
  VLLM_USE_DEEP_GEMM=0 nohup "$VL/bin/vllm" serve Qwen/Qwen3-VL-8B-Instruct-FP8 --served-model-name m --port 8010 --host 127.0.0.1 \
    --gpu-memory-utilization "$UTIL" --max-model-len 16384 --limit-mm-per-prompt '{"image":1,"video":0}' --max-num-seqs 8 > "$J/serve-Q.log" 2>&1 < /dev/null &
  echo $! > "$J/serve.pid"
  for i in $(seq 1 120); do curl -sf http://127.0.0.1:8010/v1/models >/dev/null 2>&1 && break; kill -0 "$(cat "$J/serve.pid")" 2>/dev/null || break; sleep 5; done
  curl -sf http://127.0.0.1:8010/v1/models >/dev/null || { log "did not start: $(grep -E 'Error' "$J/serve-Q.log" | tail -2 | cut -c1-300)"; stop_server; return 1; }
  log "up after $(( $(date +%s) - t0 )) s, GPU $(gpu_mib) MiB"
  timeout 2400 "$VL/bin/python" "$C/read.py" kore "$IMG" "$J/out/Q.jsonl" --url http://127.0.0.1:8010/v1 --max-tokens 6000 --clients 8 >> "$J/read-Q.log" 2>&1
  log "Q $(tr -d '\n ' < "$J/out/Q.jsonl.run.json" 2>/dev/null)"; stop_server
}
for ARM in ${*:-PV Q}; do
  log "start; GPU $(gpu_mib) MiB"
  case $ARM in PV) paddle_vl ;; Q) qwen ;; *) log "unknown arm" ;; esac
done
ARM=all; log "end; GPU $(gpu_mib) MiB"
[ -s "$J/out/PV.jsonl" ] && [ -s "$J/out/Q.jsonl" ]
