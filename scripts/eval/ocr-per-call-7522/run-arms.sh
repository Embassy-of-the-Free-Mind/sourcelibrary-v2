#!/usr/bin/env bash
# #7522: the read arms, in order, each between two /quota readings; the "after" reading is taken 15 minutes after the
# arm ends (readings minutes apart jump and come back, PR #7498). Every agy call is fresh, kept reads off.
#   bash scripts/eval/ocr-per-call-7522/run-arms.sh OUTDIR [ARM ...]      ARM is NAME:PER_CALL[:IDS_FILE]
set -u
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../../.." && pwd)
OUT=$1; shift
ENVF=${ENVF:-/root/sourcelibrary/.env.production.local}
WAIT=${WAIT:-900}
for spec in "$@"; do
  IFS=: read -r arm per ids <<<"$spec"
  ids=${ids:-$HERE/page-ids.json}
  node "$REPO/scripts/eval/ocr-per-call-7522/quota.mjs" --file="$OUT/quota.jsonl" --label="$arm:before"
  echo "=== $arm per-call=$per $(date -u +%FT%TZ)"
  CANDIDATE_READS=off AGY_JOB=ocr-percall-7522-$arm node --env-file="$ENVF" "$REPO/scripts/batch/cli-ocr.mjs" read \
    --page-ids-file="$ids" --out="$OUT/$arm" --model=gemini-3.8-flash-low --fresh --per-call="$per" --concurrency=3 --job="ocr-percall-7522-$arm" --stop-on-quota
  echo "=== $arm exit $? $(date -u +%FT%TZ); waiting ${WAIT}s"
  node "$REPO/scripts/eval/ocr-per-call-7522/quota.mjs" --file="$OUT/quota.jsonl" --label="$arm:end"
  sleep "$WAIT"
  node "$REPO/scripts/eval/ocr-per-call-7522/quota.mjs" --file="$OUT/quota.jsonl" --label="$arm:after"
done
echo ALL-DONE
