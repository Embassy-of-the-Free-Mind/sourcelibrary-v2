#!/usr/bin/env bash
# timeout: 12h
# issue: 5924
# PRIOR ART: scripts/eval/latin-distill-6871/70-latin-distill.sh (serve / stop by pid / read_arm, copied; the student
# served the same way) and scripts/eval/latin-bakeoff-5924/drive.sh `glm` (stock GLM-OCR arm G's serve flags, MTP
# speculative decoding included; read.py glm mode, 6,000 tokens, 16 clients, copied unchanged).
# gpu-queue task 79-latin-gpu25 (#5924, GPU arm of the Latin repair census): do 25 spread pages predict whether a book
# can go to GPU OCR? Three reads, files only, under /root/jobs/gpu-queue/79-latin-gpu25/out/:
#   GS  stock GLM-OCR   on the 1,348 spread pages (54 books x 25, two duplicate page numbers dropped)
#   DS  distilled GLM-OCR (#6871 run/merged) on the same pages
#   GW  stock GLM-OCR   on the 20 whole books (10,274 pages)
# Images were fetched ahead (code/fetch-chunk.py, 2,400 px cap) into in-spread/ and in-whole/. Every server is stopped
# by its own pid; read.py resumes, so a re-add after a timeout continues where it stopped.
set -uo pipefail
J=/root/jobs/gpu-queue/79-latin-gpu25; VL=/root/bench/vl
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
cd "$J"; mkdir -p out
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$J/task-progress.log"; }
gpu_mib() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; }
SP=
serve() {  # serve <model> <name> <extra vllm args...>
  local model=$1 name=$2; shift 2
  nohup "$VL/bin/vllm" serve "$model" --served-model-name m --port 8010 --host 127.0.0.1 --gpu-memory-utilization 0.6 \
    --max-model-len 16384 --limit-mm-per-prompt '{"image":1}' "$@" > "$J/serve-$name.log" 2>&1 < /dev/null &
  SP=$!
  for i in $(seq 1 120); do curl -sf http://127.0.0.1:8010/v1/models >/dev/null 2>&1 && { log "serve $name up"; return 0; }; kill -0 $SP 2>/dev/null || break; sleep 5; done
  log "serve $name did not start: $(grep -E 'Error' "$J/serve-$name.log" | tail -2 | cut -c1-300 | tr '\n' ' ')"; return 1
}
stop() {
  [ -n "$SP" ] && { pkill -TERM -P "$SP" 2>/dev/null; kill "$SP" 2>/dev/null; }
  for i in $(seq 1 30); do [ "$(gpu_mib)" -lt 600 ] && break; sleep 2; done
  [ "$(gpu_mib)" -ge 600 ] && [ -n "$SP" ] && { pkill -KILL -P "$SP" 2>/dev/null; kill -9 "$SP" 2>/dev/null; sleep 5; }
  SP=
}
read_arm() {  # read_arm <arm> <img dir> <timeout s>
  timeout "$3" "$VL/bin/python" "$J/code/read.py" glm "$2" "$J/out/$1.jsonl" --url http://127.0.0.1:8010/v1 --max-tokens 6000 --clients 16 >> "$J/read-$1.log" 2>&1
  log "$1: $(tr -d '\n ' < "$J/out/$1.jsonl.run.json" 2>/dev/null)"
}
trap stop EXIT
log "start; GPU $(gpu_mib) MiB; images spread $(ls in-spread | grep -c jpg) whole $(ls in-whole | grep -c jpg)"
serve zai-org/GLM-OCR stock --speculative-config '{"method":"mtp","num_speculative_tokens":1}' && { read_arm GS in-spread 5400; read_arm GW in-whole 27000; }
stop
serve /root/jobs/latin-distill-6871/run/merged student && read_arm DS in-spread 5400
stop
log "done; GPU $(gpu_mib) MiB"
