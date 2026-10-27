#!/bin/bash
# PRIOR ART: run-pass.sh / run-volume.sh (the #6560 volume pass: read, ya-btags check, net-worse gate, apply). They gate on
# pages WORSE on balance; Derek's rule of 2026-10-26 (#6740) gates on severe errors INTRODUCED, per batch of at most
# 1,000 pages, and adds the Derge guard. This drives one batch through that rule, reusing their tools unchanged.
#   severity-batch.sh <READ_DIR> <seed> [--apply]
# READ_DIR holds cli-ocr.mjs read --correct-prompt output (or kept reads rebuilt into that shape), with ws-<id>/<id>.jpg.
#   1. dry apply (guards: 25% cap, END sentinel, Latin letters, draft unchanged) + ya-btags emit -> sealed Opus leaf check
#   2. Derge guard (derge-guard-allow.mjs): refuse a page whose correction lowers Derge identity by > 0.01 where a parallel exists
#   3. audit: 10 seeded pages of the allowed changed set; tiled span judge with severity labels, a second judge on every
#      severe draft-win (confirm-req), the whole-page judge on draft and correction (page-req); leafcheck severity-gate
#   4. --apply, only when the gate passes: cli-ocr.mjs apply --apply --only=ALLOWED (writePageText, run id cli-ocr-<stamp>,
#      revert-run.mjs --run-id undoes it), translation_stale marked with lane tib-correct-6560.
# Exit 0 = done (applied, or gate printed); 3 = a Claude quota stop (re-run to resume); 4 = gate failed, nothing written.
set -uo pipefail
D=$(cd "$1" && pwd); SEED=$2; APPLY=${3:-}
REPO=$(cd "$(dirname "$0")/../../../.." && pwd); P=$REPO/scripts/eval/tibetan-correct-6560/pass
ENV=${ENV_FILE:-/root/sourcelibrary/.env.production.local}
REASON=${REASON:-"#6740 Gemini 3.8 Flash low correction of the Yigdzin read (image + draft), under Derek's severity rule: guards, Derge guard, 10-page severity audit per batch"}
A=$D/sev-$SEED; mkdir -p "$A"; cd "$REPO"
claude_arm() {  # claude_arm <req> <out> <arm>
  [ -s "$1" ] || { touch "$2"; return 0; }
  python3 scripts/eval/replicate-6547/run-claude-arm.py --requests "$1" --out "$2" --arm "$3" --model opus --parallel 2 --timeout 900 >> "$A/opus.log" 2>&1
  [ $? = 3 ] && { echo "QUOTA (claude) at $3"; exit 3; }; return 0
}
# 1. guards + ya-btags
rm -f "$A/yat-emit.jsonl"
node --env-file="$ENV" scripts/batch/cli-ocr.mjs apply --out="$D" --reason="$REASON" --emit-yatags="$A/yat-emit.jsonl" > "$A/dry.log" 2>&1 || { tail -5 "$A/dry.log"; exit 1; }
touch "$A/yat-emit.jsonl"
node $P/leafcheck.mjs yatags-req --emit="$A/yat-emit.jsonl" --req="$A/yat-req.jsonl" --key="$A/yat-key.json" || exit 1
claude_arm "$A/yat-req.jsonl" "$A/yat-out.jsonl" "sev-yatags-$SEED"
node $P/leafcheck.mjs yatags-verdicts --key="$A/yat-key.json" --replies="$A/yat-out.jsonl" --out="$A/yat-verdicts.jsonl" > "$A/yat-summary.json" || exit 1
# 2. Derge guard
[ -s "$A/allowed.json" ] || node --env-file="$ENV" $P/derge-guard-allow.mjs --dir="$D" --out="$A/allowed.json" > "$A/derge.log" 2>&1 || { tail -5 "$A/derge.log"; exit 1; }
# 3. audit
if [ ! -s "$A/gate.json" ]; then
  node --env-file="$ENV" $P/leafcheck.mjs audit-req --dir="$D" --verdicts="$A/yat-verdicts.jsonl" --only="$A/allowed.json" --n=10 --seed="$SEED" \
    --severity --req="$A/req.jsonl" --key="$A/key.json" || exit 1
  node $P/leafcheck.mjs tiles-req --req="$A/req.jsonl" --tiles-dir="$A/tiles" --out="$A/tiles-req.jsonl" || exit 1
  node $P/leafcheck.mjs page-req --key="$A/key.json" --dir="$D" --req="$A/page-req.jsonl" || exit 1
  claude_arm "$A/tiles-req.jsonl" "$A/tiles-out.jsonl" "sev-span-$SEED"
  claude_arm "$A/page-req.jsonl" "$A/page-out.jsonl" "sev-page-$SEED"
  node $P/leafcheck.mjs audit-score --key="$A/key.json" --replies="$A/tiles-out.jsonl" --out="$A/span1.json" > /dev/null || exit 1
  node --env-file="$ENV" $P/leafcheck.mjs confirm-req --key="$A/key.json" --replies="$A/tiles-out.jsonl" --dir="$D" --req="$A/confirm-req0.jsonl" --ckey="$A/confirm-key.json" || exit 1
  node $P/leafcheck.mjs tiles-req --req="$A/confirm-req0.jsonl" --tiles-dir="$A/tiles" --out="$A/confirm-req.jsonl" || exit 1
  claude_arm "$A/confirm-req.jsonl" "$A/confirm-out.jsonl" "sev-confirm-$SEED"
  node $P/leafcheck.mjs audit-score --key="$A/key.json" --replies="$A/tiles-out.jsonl" --confirm-key="$A/confirm-key.json" --confirm-replies="$A/confirm-out.jsonl" --out="$A/span.json" > "$A/span.log" || exit 1
  node $P/leafcheck.mjs severity-gate --span="$A/span.json" --page-replies="$A/page-out.jsonl" --out="$A/gate.json" > "$A/gate.log" || exit 1
fi
head -1 "$A/gate.log"
PASS=$(python3 -c "import json; print('yes' if json.load(open('$A/gate.json'))['pass'] else 'no')")
[ "$PASS" = yes ] || { echo "gate failed: nothing written ($A/gate.log)"; exit 4; }
[ "$APPLY" = --apply ] || exit 0
# 4. apply
node --env-file="$ENV" scripts/batch/cli-ocr.mjs apply --apply --out="$D" --reason="$REASON" --only="$A/allowed.json" \
  --yatags-verdicts="$A/yat-verdicts.jsonl" --mark-stale=tib-correct-6560 > "$A/apply.log" 2>&1 || { tail -5 "$A/apply.log"; exit 1; }
tail -2 "$A/apply.log"
