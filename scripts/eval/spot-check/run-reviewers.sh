#!/usr/bin/env bash
# PRIOR ART: .claude/skills/shelf-overview/SKILL.md step 3 (reviewers as Agent-tool subagents of an interactive
# session) — this runs the SAME prompt as headless `claude -p` calls so no session pays to orchestrate them.
# Measured 2026-10-07 (#6174): $0.15–0.20/page vs ~$1.10 all-in; verdicts agree with the session-run reviews
# as well as two script runs agree with each other (scripts/eval/experiments/2026-10-07-script-run-reviewers-6174.md).
#
# Usage: scripts/eval/spot-check/run-reviewers.sh <packets_dir> <out_dir> [addendum]
#   addendum: OVERVIEW-ADDENDUM.md (default) or CURATION-ADDENDUM.md
# Writes <out_dir>/reviews/<packet>.json (the reviewer's output) and <out_dir>/meta/<packet>[.retry].json
# (`claude -p` result: total_cost_usd, num_turns, session_id). One parallel call per packet; keep packets ≤ 6.
# A call that ends without writing its file (a headless reviewer that stops to ask a question: 1 in 12 on the
# first run) is retried once. Run from the repo root. Cost of the run: python3 scripts/eval/spot-check/run-cost.py <out_dir>
set -u
PACKETS="$(cd "$1" && pwd)"; mkdir -p "$2"; OUT="$(cd "$2" && pwd)"; ADD="${3:-OVERVIEW-ADDENDUM.md}"
REPO="$(git rev-parse --show-toplevel)"
mkdir -p "$OUT/reviews" "$OUT/meta"
review() {  # $1 packet path, $2 meta suffix
  local s; s=$(basename "$1" .json)
  printf '%s' "Your instructions are the full text of two files, read in this order and followed exactly (skip the leading \`<!-- … -->\` comments): 1. \`$REPO/scripts/eval/spot-check/REVIEWER.md\` 2. \`$REPO/scripts/eval/spot-check/$ADD\`.
The taxonomy is at \`$REPO/.claude/docs/page-error-taxonomy.md\`.
PACKET_FILE: \`$1\`
OUTPUT_FILE: \`$OUT/reviews/$s.json\`" | (cd "$REPO" && claude -p --model opus --output-format json \
      --allowedTools "Read" "Write" "Bash(curl:*)" "Bash(mkdir:*)" "Bash(ls:*)" "Bash(python3:*)") \
    > "$OUT/meta/$s$2.json" 2> "$OUT/meta/$s$2.err"
}
for p in "$PACKETS"/*.json; do
  ( s=$(basename "$p" .json)
    review "$p" ""
    [ -s "$OUT/reviews/$s.json" ] || review "$p" ".retry"
    if [ -s "$OUT/reviews/$s.json" ]; then echo "$s ok"; else echo "$s FAILED (see meta/$s*.json)"; fi >> "$OUT/meta/done.log" ) &
done
wait
echo ALL_DONE >> "$OUT/meta/done.log"
cat "$OUT/meta/done.log"
