#!/usr/bin/env bash
# PRIOR ART: scripts/batch/claude-translate.mjs (the production Opus translation read stage, used unchanged) and
# scripts/eval/route-judge-6740 (paired arms on the same pages). This only runs claude-translate twice per shard.
#
# Both arms of the T10 note-rule test (v3#44): the live translation prompt (arm A) and the same prompt plus the note
# rule (arm B, draw.mjs NOTE_RULE through --instructions-file). Opus through the Claude CLI on the subscription, one page
# per call, fresh reads, kept-read copies to R2 off. READ stage only: no page or book is written.
#   scripts/eval/error-zoo/t10-note-test/translate-arms.sh RUN_DIR [smoke]
set -u
RUN="$1"; MODE="${2:-all}"
cd "$(dirname "$0")/../../../.."
ENVF=/root/sourcelibrary/.env.production.local
CHECKED="eval only, no write: T10 specimens and clean audit pages whose OCR an Opus audit reader judged against the image (error-zoo labels, v3#44)"
read_arm() {  # $1 ids file, $2 out dir, $3 extra args
  CANDIDATE_READS=off node --env-file="$ENVF" scripts/batch/claude-translate.mjs read --page-ids-file="$1" --out="$2" \
    --model=opus --per-call=1 --fresh --job=t10-note-test-8632 --ocr-checked="$CHECKED" $3
}
if [ "$MODE" = smoke ]; then
  node -e 'const f=process.argv[1];require("fs").writeFileSync(f+"/smoke.json",JSON.stringify(require(f+"/shard-0.json").slice(0,1)))' "$RUN"
  read_arm "$RUN/smoke.json" "$RUN/smoke-A" ""
  exit $?
fi
for k in 0 1 2 3; do
  ( read_arm "$RUN/shard-$k.json" "$RUN/A/s$k" "" > "$RUN/A-s$k.log" 2>&1
    read_arm "$RUN/shard-$k.json" "$RUN/B/s$k" "--instructions-file=$RUN/instructions-B.json" > "$RUN/B-s$k.log" 2>&1 ) &
done
wait
echo "done: $(ls "$RUN"/A/s*/*.meta.json 2>/dev/null | wc -l) A reads, $(ls "$RUN"/B/s*/*.meta.json 2>/dev/null | wc -l) B reads"
