#!/usr/bin/env bash
# hold.sh — one short GPU hold on gex45 for #6871 row A: take /root/gpu.lock, serve Qwen2.5-VL-7B AWQ, run ll-score.py
# for at most SECS seconds (it resumes where the last hold stopped), stop the model, release. Run ON gex45.
#
# PRIOR ART: scripts/gpu/gex45-bench-6871/card.sh `ll-qwen25vl7b-awq` (same server flags; serve → drive → stop under
# the lock). This one bounds the hold to ~20 min (#6871 shared-GPU rule) and turns prefix caching off, so a re-run is
# a real second pass and not a cache hit.
#
#   hold.sh <out.jsonl> [--cap 2400] [--only ids.txt] [--limit N]     env: SECS (1080), UTIL (0.85)
set -uo pipefail
J=/root/jobs/grounding-6871; VL=/root/bench/vl; OUT=$1; shift
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
log() { echo "$(date -u +%FT%TZ) $*" >> "$J/hold.log"; }
exec 9>/root/gpu.lock
flock -w 300 9 || { log "lock busy after 300 s — not run"; exit 75; }
log "lock taken for $OUT $*; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader)"
stop() {
  [ -n "${SP:-}" ] && { pkill -TERM -P "$SP" 2>/dev/null; kill "$SP" 2>/dev/null; sleep 8; pkill -KILL -P "$SP" 2>/dev/null; kill -9 "$SP" 2>/dev/null; }
  for i in $(seq 1 30); do [ "$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits)" -lt 600 ] && break; sleep 2; done
  if [ "$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits)" -ge 600 ]; then
    pkill -f -- '--served-model-name m --port 8000'; sleep 10; pkill -9 -f -- '--served-model-name m --port 8000'; sleep 3
  fi
  log "released; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader)"
}
trap stop EXIT
nohup "$VL/bin/vllm" serve Qwen/Qwen2.5-VL-7B-Instruct-AWQ --served-model-name m --port 8000 --host 127.0.0.1 \
  --gpu-memory-utilization "${UTIL:-0.85}" --max-model-len 16384 --limit-mm-per-prompt '{"image":1,"video":0}' \
  --no-enable-prefix-caching > "$J/serve.log" 2>&1 < /dev/null &
SP=$!
for i in $(seq 1 120); do curl -sf http://127.0.0.1:8000/v1/models >/dev/null 2>&1 && break; kill -0 $SP 2>/dev/null || break; sleep 5; done
curl -sf http://127.0.0.1:8000/v1/models >/dev/null || { log "server did not start: $(grep -i error "$J/serve.log" | tail -2 | cut -c1-300)"; exit 1; }
log "server up"
t0=$(date +%s)
timeout "${SECS:-1080}" "$VL/bin/python" "$J/code/ll-score.py" score "$J/code/items.jsonl" "$J/img" "$OUT" "$@" >> "$J/score.log" 2>&1
log "scored for $(( $(date +%s) - t0 )) s: $(wc -l < "$OUT") rows in $OUT"
