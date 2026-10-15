#!/bin/bash
# #6560 Flash low correction pass, one Kangyur volume: read -> ya-btags leaf check (Opus) -> apply.
#   run-volume.sh <book_id> [--no-apply]      resumable: every stage skips what it has already done
# Exit 0 = applied (or read + checked with --no-apply); 3 = a quota stop (state is on disk, re-run to resume).
# Needs: agy and claude signed in on this box; $JOB_SCRATCH; the env file below. $0 calls only (subscription CLIs).
set -uo pipefail
B=$1; NOAPPLY=${2:-}
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
ENV=${ENV_FILE:-/root/sourcelibrary/.env.production.local}
D=$JOB_SCRATCH/vol/$B; mkdir -p "$D"
P=$REPO/scripts/eval/tibetan-correct-6560
LANE=tib-correct-6560
REASON="#6560 Gemini 3.8 Flash low correction of the Yigdzin read (image + draft), ya-btags changes kept only where Opus saw them on the leaf"
cd "$REPO"
[ -s "$D.ids.json" ] || node --env-file="$ENV" $P/pass/volume-ids.mjs book --book="$B" --out="$D.ids.json" || exit 1
# 1. read: Flash low, the #6560 CORR prompt, 2 in flight (cli-ocr sleeps through a quota window and goes on)
node --env-file="$ENV" scripts/batch/cli-ocr.mjs read --page-ids-file="$D.ids.json" --out="$D" --model=gemini-3.8-flash-low \
  --correct-prompt=$P/corr-prompt.txt --lane=$LANE --concurrency=2 --job=tib-flash-pass-6560 >> "$D.read.log" 2>&1 || exit 1
# 2. which pages hold a ya-btags change (dry run, no verdicts: every such page is emitted)
rm -f "$D/yat-emit.jsonl"
node --env-file="$ENV" scripts/batch/cli-ocr.mjs apply --out="$D" --reason="$REASON" --emit-yatags="$D/yat-emit.jsonl" > "$D.dry.log" 2>&1 || exit 1
touch "$D/yat-emit.jsonl"
node $P/pass/leafcheck.mjs yatags-req --emit="$D/yat-emit.jsonl" --req="$D/yat-req.jsonl" --key="$D/yat-key.json" || exit 1
# 3. the leaf check: sealed Opus, image open, A/B blind
if [ -s "$D/yat-req.jsonl" ]; then
  python3 scripts/eval/replicate-6547/run-claude-arm.py --requests "$D/yat-req.jsonl" --out "$D/yat-out.jsonl" --arm "tib-yatags-$B" \
    --model opus --parallel 1 --timeout 600 >> "$D.opus.log" 2>&1
  rc=$?; [ $rc = 3 ] && { echo "QUOTA (claude) on $B"; exit 3; }
fi
touch "$D/yat-out.jsonl"
node $P/pass/leafcheck.mjs yatags-verdicts --key="$D/yat-key.json" --replies="$D/yat-out.jsonl" --out="$D/yat-verdicts.jsonl" | tee "$D.yat-summary.json" || exit 1
[ "$NOAPPLY" = --no-apply ] && exit 0
# 4. apply: guard on, translations flagged stale for re-translation (not withheld)
node --env-file="$ENV" scripts/batch/cli-ocr.mjs apply --apply --out="$D" --reason="$REASON" --yatags-verdicts="$D/yat-verdicts.jsonl" \
  --mark-stale=$LANE > "$D.apply.log" 2>&1 || exit 1
tail -3 "$D.apply.log"
