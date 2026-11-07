#!/bin/bash
# PRIOR ART: run-volume.sh (read -> ya-btags leaf check -> apply; it has no Derge step) and run-pass.sh (the #6560 gated
# pass, which stops on a pre-write audit). Wave 2 (#6740, 2026-10-27) applied Derek's 23:15Z rule with uncommitted glue;
# this is that apply for one volume, so wave 3 (#7263) and later waves run the same steps.
# Apply one volume already read by `run-volume.sh <book> --no-apply`, under the 23:15Z rule (#6740):
#   every cli-ocr.mjs apply guard (line count, 25% cap, ya-btags without a leaf check, Latin, the rest), and the Derge
#   guard (derge-guard.mjs): a page whose correction lowers its Derge identity by more than 0.01, where the draft has a
#   parallel (identity >= 0.85), keeps the draft. translation_stale (lane tib-correct-6560) where English exists.
#   apply-volume.sh <book_id> [--dry]     env: TIB_P1 (an OpenPecha P000001 checkout), JOB_SCRATCH, ENV_FILE
# Writes $D/derge-*.{jsonl,json}, $D.apply.log and $D.run-id (the run id: revert-run.mjs --run-id <id> undoes it).
set -uo pipefail
B=$1; DRY=${2:-}
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
ENV=${ENV_FILE:-/root/sourcelibrary/.env.production.local}
P=$REPO/scripts/eval/tibetan-correct-6560/pass
D=$JOB_SCRATCH/vol/$B
MODEL=${MODEL:-gemini-3.8-flash-low}
REASON=${REASON:-"#6560 ${MODEL/gemini-3.8-flash-low/Gemini 3.8 Flash low} correction of the Yigdzin read (image + draft, #6560 CORR request); Derek 2026-10-26 23:15Z rule: guards pass, ya-btags changes kept only where Opus saw them on the leaf, Derge identity not lowered by > 0.01"}
: "${TIB_P1:?TIB_P1 must name an OpenPecha P000001 checkout}"
[ -s "$D/yat-verdicts.jsonl" ] || touch "$D/yat-verdicts.jsonl"
cd "$REPO"
if [ ! -s "$D/derge-only.json" ]; then
  node --env-file="$ENV" $P/derge-guard.mjs rows --dir="$D" --verdicts="$D/yat-verdicts.jsonl" --drafts="$D/derge-drafts.jsonl" --out="$D/derge-rows.jsonl" || exit 1
  python3 scripts/eval/route-judge-6740/tib-derge.py locate --p1 "$TIB_P1" "$D/derge-drafts.jsonl" "$D/derge-located.jsonl" 2> "$D.derge-locate.log" || exit 1
  node $P/derge-guard.mjs score-in --rows="$D/derge-rows.jsonl" --located="$D/derge-located.jsonl" --out="$D/derge-in.jsonl" || exit 1
  python3 scripts/eval/route-judge-6740/tib-derge.py score --p1 "$TIB_P1" "$D/derge-in.jsonl" "$D/derge-scores.json" || exit 1
  node $P/derge-guard.mjs only --dir="$D" --scores="$D/derge-scores.json" --out="$D/derge-only.json" --refused="$D/derge-refused.json" | tee "$D.derge-summary.json" || exit 1
fi
APPLY=--apply; [ "$DRY" = --dry ] && APPLY=
node --env-file="$ENV" scripts/batch/cli-ocr.mjs apply $APPLY --out="$D" --reason="$REASON" --yatags-verdicts="$D/yat-verdicts.jsonl" \
  --only="$D/derge-only.json" ${APPLY:+--mark-stale=tib-correct-6560} > "$D.apply${DRY:+-dry}.log" 2>&1 || exit 1
tail -2 "$D.apply${DRY:+-dry}.log"
[ -n "$APPLY" ] && grep -o 'run cli-ocr-[0-9-]*' "$D.apply.log" | tail -1 | cut -d' ' -f2 > "$D.run-id"
exit 0
