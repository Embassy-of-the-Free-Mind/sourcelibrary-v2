#!/usr/bin/env bash
# timeout: 6h
# issue: 7567
# PRIOR ART: scripts/eval/euro-gpu-correct-7567/results-e5/e5-gpu-task*.sh (#7567 E5: the arm-c drafts of 2,500 pages as
# one gpu-queue task, one engine at a time; this is that task over the production lane dir) and its drive.sh (the vLLM
# serve / read.py / stop recipe, used unchanged: LightOnOCR-3-1B, UTIL 0.6, 16 clients, 6,000 tokens);
# scripts/batch/pero-draft.py (#7263: PERO on a folder of page images, the JSON the corrector takes);
# scripts/gpu/paddle-zh-queue-task.sh (a filler task over a lane dir). None of them drafts the arm-c plan.
#
# euro-draft-task.sh — the GPU drafts of the #7567 arm-c lane (cli-ocr-lane.mjs armc), one ocr-filler chunk.
#   1. `cli-ocr-lane.mjs armc-fetch`: the page images of planned pages with no draft, staged per language.
#   2. la: PERO-OCR (pero-draft.py --device=gpu: the model's config.ini on the card, as E5 drafted; PERO_DEVICE=cpu runs
#      the TEST's CPU config, which differs only in USE_CPU, at ~15 s a page when the box is loaded).
#      it: LightOnOCR-3-1B served by vLLM for the chunk and stopped after (drive.sh arm LO).
#   3. `cli-ocr-lane.mjs armc-collect`: one draft file a page in $LANE_DIR/drafts/<book>/<page>.json.
# Nothing here writes to Mongo or calls agy: the correction and the write are the lane's cron run.
#   LANE_DIR=/root/jobs/euro-armc-7567 CODE_DIR=/root/sourcelibrary ENV_FILE=… MAX_PAGES=1500 bash euro-draft-task.sh
set -uo pipefail
L=${LANE_DIR:-/root/jobs/euro-armc-7567}
CODE_DIR=${CODE_DIR:-/root/sourcelibrary}
ENV_FILE=${ENV_FILE:-/root/sourcelibrary/.env.production.local}
MAX=${MAX_PAGES:-1500}
LANE="$CODE_DIR/scripts/batch/cli-ocr-lane.mjs"
lane() { node --no-warnings --env-file="$ENV_FILE" "$LANE" "$@" --lane-dir="$L"; }
ts=$(date -u +%Y%m%dT%H%M%SZ); W=$L/work/$ts; mkdir -p "$W"
read -r before _ < <(lane armc-left)
echo "$(date -u +%FT%TZ) start: ${before} pages left; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) MiB"
# a stage left by a killed chunk is fetched again (the images are kept by book); start clean
rm -rf "$L/stage"
lane armc-fetch --max-pages="$MAX" || exit 1
if ls "$L/stage/la"/*.jpg >/dev/null 2>&1; then
  python3 "$CODE_DIR/scripts/batch/pero-draft.py" "$L/stage/la" "$W/pero.json" --threads="${PERO_THREADS:-12}" --device="${PERO_DEVICE:-gpu}" &&
  lane armc-collect --engine=pero --engine-out="$W/pero.json" --stage-dir="$L/stage/la"
fi
if ls "$L/stage/it"/*.jpg >/dev/null 2>&1; then
  printf '{"version":"vllm %s","served":"--gpu-memory-utilization 0.6 --max-model-len 16384 --limit-mm-per-prompt {\\"image\\":1} --mm-processor-cache-gb 0 --no-enable-prefix-caching","read":"scripts/eval/euro-gpu-correct-7567/read.py lighton (temperature 0.2, top_p 0.9, max_tokens 6000; #7567 E1/E5 recipe)"}\n' \
    "$(/root/bench/vl/bin/python -c 'import vllm;print(vllm.__version__)' 2>/dev/null)" > "$W/out-LO.engine.json"
  mkdir -p "$W/out"
  J=$W C="$CODE_DIR/scripts/eval/euro-gpu-correct-7567" IMG="$L/stage/it" UTIL=${UTIL:-0.6} bash "$CODE_DIR/scripts/eval/euro-gpu-correct-7567/drive.sh" LO
  cp "$W/out-LO.engine.json" "$W/out/LO.jsonl.engine.json"
  [ -s "$W/out/LO.jsonl" ] && lane armc-collect --engine=lightonocr --engine-out="$W/out/LO.jsonl" --stage-dir="$L/stage/it"
fi
gzip -f "$W"/*.json "$W"/out/*.jsonl 2>/dev/null
read -r after _ < <(lane armc-left)
echo "$(date -u +%FT%TZ) end: ${after} pages left; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) MiB"
# a chunk that drafted nothing failed (the filler disables the route after three in a row)
[ "${after:-0}" -lt "${before:-0}" ] || { echo "no page drafted this chunk"; exit 1; }
