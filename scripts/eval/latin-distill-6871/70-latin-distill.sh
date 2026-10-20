#!/usr/bin/env bash
# timeout: 8h
# issue: 6871
# Latin print distillation (PREREGISTRATION.md, scripts/eval/latin-distill-6871): LoRA-train GLM-OCR on 2,000 stored
# flash-preview reads, merge, then read the 99 frozen #5924 leaves with the student (D) and stock GLM-OCR (G2, the same
# serve flags: no speculative decoding, since the merged checkpoint has no MTP layer), plus the 100 val pages (Dval).
# Files only. Every server is stopped by its own pid before the task ends.
set -uo pipefail
J=/root/jobs/latin-distill-6871; B=/root/jobs/latin-bakeoff-5924; VL=/root/bench/vl; PY=/root/jobs/mongol-synth-5664/venv/bin/python
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1 OMP_NUM_THREADS=8
cd "$J"; mkdir -p out valin
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$J/task-progress.log"; }
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; }

log "train"
$PY train.py --train train.jsonl --val val.jsonl --img img --out run || { log "train failed rc=$?"; exit 3; }

for id in $(python3 -c "import json;[print(json.loads(l)['id']) for l in open('val.jsonl')]"); do [ -e "img/$id.jpg" ] && ln -sf "$J/img/$id.jpg" "valin/$id.jpg"; done

SP=
serve() {  # serve <model>
  nohup "$VL/bin/vllm" serve "$1" --served-model-name m --port 8010 --host 127.0.0.1 --gpu-memory-utilization 0.6 \
    --max-model-len 16384 --limit-mm-per-prompt '{"image":1}' > "$J/serve-$2.log" 2>&1 < /dev/null &
  SP=$!
  for i in $(seq 1 120); do curl -sf http://127.0.0.1:8010/v1/models >/dev/null 2>&1 && return 0; kill -0 $SP 2>/dev/null || break; sleep 5; done
  log "serve $2 did not start"; return 1
}
stop() {
  [ -n "$SP" ] && { pkill -TERM -P "$SP" 2>/dev/null; kill "$SP" 2>/dev/null; }
  for i in $(seq 1 30); do [ "$(gpu_mib)" -lt 600 ] && break; sleep 2; done
  [ "$(gpu_mib)" -ge 600 ] && { pkill -KILL -P "$SP" 2>/dev/null; kill -9 "$SP" 2>/dev/null; sleep 5; }
  SP=
}
read_arm() {  # read_arm <arm> <img dir>
  timeout 2400 "$VL/bin/python" "$B/code/read.py" glm "$2" "$J/out/$1.jsonl" --url http://127.0.0.1:8010/v1 --max-tokens 6000 --clients 16 >> "$J/read-$1.log" 2>&1
  log "$1: $(tr -d '\n ' < "$J/out/$1.jsonl.run.json" 2>/dev/null)"
}
trap stop EXIT

log "serve student"
serve "$J/run/merged" D && { read_arm D "$B/in"; read_arm Dval "$J/valin"; }
stop
log "serve stock GLM-OCR (G2 control)"
serve zai-org/GLM-OCR G2 && read_arm G2 "$B/in"
stop
log "done; GPU $(gpu_mib) MiB"
