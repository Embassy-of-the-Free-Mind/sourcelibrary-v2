#!/usr/bin/env bash
# PRIOR ART: scripts/eval/spot-check/run-reviewers.sh — the same claude -p call, but it always appends an addendum
# (OVERVIEW/CURATION) and launches every packet at once. #7947 passes REVIEWER.md (or SECOND-READER.md) alone,
# verbatim, and caps parallelism under the box's pace guard (a job session holds one of its slots).
#
# Usage: scripts/eval/latin-strata-7947/run-reviews.sh <brief.md> <packets_dir> <out_dir> [parallel=3]
# Writes <out_dir>/reviews/<packet>.json and <out_dir>/meta/<packet>[.retry].json. Skips a packet whose review
# exists, so a re-run resumes. A call that ends without its file is retried once.
set -u
BRIEF="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
PACKETS="$(cd "$2" && pwd)"; mkdir -p "$3"; OUT="$(cd "$3" && pwd)"; PAR="${4:-3}"
REPO="$(git rev-parse --show-toplevel)"
mkdir -p "$OUT/reviews" "$OUT/meta"
export BRIEF OUT REPO
one() {
  local p="$1" s; s=$(basename "$p" .json)
  [ -s "$OUT/reviews/$s.json" ] && { echo "$s skip"; return; }
  for suf in "" ".retry"; do
    printf '%s' "Your instructions are the full text of \`$BRIEF\`, read and followed exactly (skip the leading \`<!-- … -->\` comment).
The taxonomy is at \`$REPO/.claude/docs/page-error-taxonomy.md\`.
PACKET_FILE: \`$p\`
OUTPUT_FILE: \`$OUT/reviews/$s.json\`" | (cd "$REPO" && timeout 3600 claude -p --model opus --output-format json \
        --allowedTools "Read" "Write" "Bash(curl:*)" "Bash(mkdir:*)" "Bash(ls:*)" "Bash(python3:*)" "Bash(sips:*)" "Bash(convert:*)") \
      > "$OUT/meta/$s$suf.json" 2> "$OUT/meta/$s$suf.err"
    [ -s "$OUT/reviews/$s.json" ] && break
  done
  if [ -s "$OUT/reviews/$s.json" ]; then echo "$s ok"; else echo "$s FAILED"; fi
}
export -f one
ls "$PACKETS"/*.json | xargs -P "$PAR" -I{} bash -c 'one "$@"' _ {} >> "$OUT/meta/done.log" 2>&1
echo ALL_DONE >> "$OUT/meta/done.log"
cat "$OUT/meta/done.log"
