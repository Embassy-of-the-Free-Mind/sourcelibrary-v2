#!/usr/bin/env bash
# timeout: 5h
# issue: 5730
# PRIOR ART: scripts/eval/latin-distill-6871/70-latin-distill.sh (row D: the same train → merge → serve → read shape on
# this box; copied, with the Greek data, 3 epochs, a 4,096-token label cap, and the scorer run at the end).
# gpu-queue task 62-greek-ms-lora (#5730 burst 2, PREREGISTRATION.md in this directory). Expects, prepared before queueing:
#   $J/tree  = a checkout of this branch;  $J/data = {train,val,test}.jsonl (gunzipped from the tree);  $J/img = fetched images.
# Files only. Every server is stopped by its own pid before the task ends. Results: $J/results.txt and results.json.
set -uo pipefail
J=/root/jobs/greek-ms-lora-5730; T=$J/tree/scripts/eval/greek-ms-lora-5730
VL=/root/bench/vl; PY=/root/jobs/mongol-synth-5664/venv/bin/python
READ=$J/tree/scripts/eval/latin-bakeoff-5924/read.py; TRAIN=$J/tree/scripts/eval/latin-distill-6871/train.py
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1 OMP_NUM_THREADS=8
cd "$J"; mkdir -p out testin valin
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$J/task-progress.log"; }
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; }

log "label tokens"
$PY - <<'EOF' | tee -a "$J/task-progress.log"
import json
from transformers import AutoProcessor
tok = AutoProcessor.from_pretrained("zai-org/GLM-OCR").tokenizer
n = [len(tok("<think></think>\n" + json.loads(l)["text"], add_special_tokens=False)["input_ids"]) for l in open("data/train.jsonl")]
n.sort(); print(f"train labels: {len(n)}, median {n[len(n)//2]} tokens, max {n[-1]}, over 4096: {sum(x > 4096 for x in n)}")
EOF

log "train"
$PY "$TRAIN" --train data/train.jsonl --val data/val.jsonl --img img --out run --epochs 3 --max-label 4096 || { log "train failed rc=$?"; exit 3; }

for f in test val; do
  for id in $(python3 -c "import json;[print(json.loads(l)['id']) for l in open('data/$f.jsonl')]"); do [ -e "img/$id.jpg" ] && ln -sf "$J/img/$id.jpg" "${f}in/$id.jpg"; done
done

SP=
serve() {  # serve <model> <tag>
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
  timeout 3000 "$VL/bin/python" "$READ" glm "$2" "$J/out/$1.jsonl" --url http://127.0.0.1:8010/v1 --max-tokens 6000 --clients 16 >> "$J/read-$1.log" 2>&1
  log "$1: $(tr -d '\n ' < "$J/out/$1.jsonl.run.json" 2>/dev/null)"
}
trap stop EXIT

log "serve trained (F)"
serve "$J/run/merged" F && { read_arm F "$J/testin"; read_arm Fval "$J/valin"; }
stop
log "serve stock GLM-OCR (G)"
serve zai-org/GLM-OCR G && read_arm G "$J/testin"
stop
log "GPU $(gpu_mib) MiB; scoring"

[ -e "$T/reads/L.jsonl.gz" ] && gunzip -c "$T/reads/L.jsonl.gz" > out/L.jsonl
node "$T/score.mjs" --test data/test.jsonl --reads out --out "$J/results.json" > "$J/results.txt" 2>&1
log "scored: $(head -1 "$J/results.txt")"
