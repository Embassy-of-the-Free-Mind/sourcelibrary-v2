#!/usr/bin/env bash
# timeout: 8h
# issue: 5924
# backlog-task.sh — PREPARED, NOT QUEUED: gpu-queue task 21-latin-<century>, one 8-hour slice of a Latin backlog read on
# the GEX45 (#5924; Derek's inbox note 2026-10-18). OUTPUT GOES TO FILES ONLY: one jsonl per manifest chunk in this
# task's cwd (/root/jobs/gpu-queue/<name>/out/). Nothing here writes to `pages` or any store; applying the text is a
# separate, guarded step that does not exist yet.
#
# PRIOR ART: scripts/eval/latin-bakeoff-5924/drive.sh (serve → read → stop for one engine, the GLM-OCR serve flags) and
# queue-task.sh (runs inside the gpu-queue lock). Resumable: a chunk with out/<chunk>.jsonl.done is skipped, so the
# same task can be queued again for the next slice. At the measured 1,734 pages/h one slice reads ≈ 13K pages; the
# 1500s backlog (≈ 2.21M pages) is ≈ 53 GPU-days of slices.
#
# To queue (a human decision, see the #5924 DECISION line):
#   CENTURY=1500s; M=/root/jobs/latin-backlog-$CENTURY/manifest
#   node --env-file=/root/sourcelibrary/.env.production.local /root/jobs/latin-bakeoff-5924/tree/scripts/eval/latin-bakeoff-5924/backlog-manifest.mjs --century $CENTURY --out $M
#   sed "s#^MANIFEST=.*#MANIFEST=$M#" /root/jobs/latin-bakeoff-5924/code/backlog-task.sh > /tmp/21-latin-$CENTURY.sh
#   /root/bin/gpu-queue.sh add /tmp/21-latin-$CENTURY.sh 21-latin-$CENTURY
set -uo pipefail
MANIFEST=/root/jobs/latin-backlog-1500s/manifest
CODE=/root/jobs/latin-bakeoff-5924/code; VL=/root/bench/vl; PORT=8011
MODE=${MODE:-glm}; MODEL=${MODEL:-zai-org/GLM-OCR}
export VLLM_USE_FLASHINFER_SAMPLER=0 HF_HUB_OFFLINE=1
deadline=$(( $(date +%s) + 7*3600 + 1800 ))          # stop taking chunks 30 min before the queue's 8 h timeout
mkdir -p out img; log() { echo "$(date -u +%FT%TZ) $*" >> task.log; }
stop() { [ -n "${SP:-}" ] && { pkill -TERM -P "$SP" 2>/dev/null; kill "$SP" 2>/dev/null; sleep 8; pkill -9 -f -- "--served-model-name m --port $PORT" 2>/dev/null; }; rm -rf img; log "stopped; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader)"; }
trap stop EXIT
[ -d "$MANIFEST" ] || { log "no manifest at $MANIFEST"; exit 2; }
nohup "$VL/bin/vllm" serve "$MODEL" --served-model-name m --port $PORT --host 127.0.0.1 --gpu-memory-utilization 0.6 \
  --max-model-len 16384 --limit-mm-per-prompt '{"image":1}' --speculative-config '{"method":"mtp","num_speculative_tokens":1}' \
  > serve.log 2>&1 < /dev/null & SP=$!
for i in $(seq 1 120); do curl -sf http://127.0.0.1:$PORT/v1/models >/dev/null && break; kill -0 $SP 2>/dev/null || { log "server died"; exit 3; }; sleep 5; done
log "server up ($MODE $MODEL)"
for ch in "$MANIFEST"/chunk-*.tsv; do
  name=$(basename "$ch" .tsv); [ -e "out/$name.jsonl.done" ] && continue
  [ "$(date +%s)" -ge "$deadline" ] && { log "slice deadline; next chunk $name"; break; }
  rm -rf img; "$VL/bin/python" "$CODE/fetch-chunk.py" "$ch" img --parallel 8 >> task.log 2>&1
  [ -f img/_fetch-errors.tsv ] && mv img/_fetch-errors.tsv "out/$name.fetch-errors.tsv"
  timeout 3h "$VL/bin/python" "$CODE/read.py" "$MODE" img "out/$name.jsonl" --url http://127.0.0.1:$PORT/v1 --clients 16 --max-tokens 6000 >> task.log 2>&1 \
    && touch "out/$name.jsonl.done"; log "$name: $(tr -d '\n ' < out/$name.jsonl.run.json 2>/dev/null)"
done
