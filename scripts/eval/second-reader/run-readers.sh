#!/usr/bin/env bash
# PRIOR ART: ../spot-check/run-reviewers.sh (headless `claude -p` reviewers, run from the repo root with the repo
# readable — fine for a shelf overview, but here the earlier Opus reviews of nearby books and the planted-error key
# must be out of reach) and ../../batch/cli-ocr.mjs (the `agy -p … --add-dir` call for Gemini through the CLI).
# This runs each packet in a SEALED folder holding only the brief, the addendum, the taxonomy, the packet and its
# images, with the folder as the working directory, and keeps the transcript so `second-reader.mjs collect` can
# audit what the reader opened. The seal is enforced by the CLI (--restricted: Read and Write only, confined to the
# folder). Claude readers only: Gemini readers run through scripts/eval/run-cli-arm.py, the #6338 pilot's tested path
# (plan mode, one page per call, nudge on a denied tool), via `second-reader.mjs cli-requests` / `cli-assemble`.
#
# Usage: scripts/eval/second-reader/run-readers.sh <run_dir> <name> claude <model> [read|adjudicate] [parallel]
#   read:       packets  = <run>/packets/*.json          → <run>/readers/<name>/reviews/<packet>.json
#   adjudicate: chunks   = <run>/adjudication/chunks/*.json → <run>/adjudication/<name>/reviews/<chunk>.json
#   parallel:   claude calls at once (default 4).
# A call that ends without writing its file is retried once. Then run:
#   node scripts/eval/second-reader/second-reader.mjs collect --run <run_dir> --reader <name> [--role adjudicate]
set -u
RUN="$(cd "$1" && pwd)"; NAME="$2"; ENGINE="$3"; MODEL="$4"; ROLE="${5:-read}"; PAR="${6:-4}"
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"
SEALROOT="${SEALROOT:-${TMPDIR:-/tmp}/second-reader-sealed}/$(basename "$RUN")/$NAME"
if [ "$ROLE" = adjudicate ]; then SRC="$RUN/adjudication/chunks"; OUT="$RUN/adjudication/$NAME"; BRIEFS="ADJUDICATOR.md"; KEYWORD=ITEMS_FILE
else SRC="$RUN/packets"; OUT="$RUN/readers/$NAME"; BRIEFS="REVIEWER.md CALIBRATION-ADDENDUM.md"; KEYWORD=PACKET_FILE; fi
mkdir -p "$OUT/reviews" "$OUT/meta"
case "$ENGINE" in
  claude) VERSION="$(claude --version 2>/dev/null)"
    # `--allowedTools` only PRE-APPROVES tools; it does not remove Bash (the first real run used Bash 36 times and the
    # MCP servers 6). `--restricted --tools Read Write --strict-mcp-config` removes them and confines Read/Write to the
    # working directory: checked 2026-10-08, a Read of a path outside the folder is refused and Bash does not exist.
    claude --help 2>&1 | grep -q -- '--restricted' || { echo "this claude CLI has no --restricted: refusing to run an unsealed reader" >&2; exit 2; };;
  agy) echo "Gemini readers run through scripts/eval/run-cli-arm.py: second-reader.mjs cli-requests, then run-cli-arm.py, then cli-assemble (RUNBOOK step 4)" >&2; exit 2;;
  *) echo "engine must be claude" >&2; exit 2;;
esac
printf '{"name":"%s","engine":"%s","model":"%s","role":"%s","cli_version":"%s","started":"%s"}\n' "$NAME" "$ENGINE" "$MODEL" "$ROLE" "$VERSION" "$(date -u +%FT%TZ)" > "$OUT/meta/run.json"

seal() {  # $1 packet → prints the sealed folder
  local p="$1" s d; s=$(basename "$p" .json); d="$SEALROOT/$s"
  rm -rf "$d"; mkdir -p "$d/images"
  cp "$HERE/../spot-check/REVIEWER.md" "$HERE/CALIBRATION-ADDENDUM.md" "$HERE/ADJUDICATOR.md" "$d/"
  cp "$REPO/.claude/docs/page-error-taxonomy.md" "$d/"
  cp "$p" "$d/packet.json"
  # Only this packet's images.
  node -e 'const x=require(process.argv[1]);const fs=require("fs");const s=new Set();const walk=(o)=>{if(o&&typeof o==="object"){for(const[k,v]of Object.entries(o)){if(k==="image_file"&&typeof v==="string")s.add(v);else walk(v)}}};walk(x);for(const f of s)process.stdout.write(f+"\n")' "$d/packet.json" \
    | while read -r f; do [ -n "$f" ] && cp "$RUN/$f" "$d/$f"; done
  # Every image the packet names must be in the folder (a missing trailing newline once dropped the last one).
  local want have; want=$(grep -o '"image_file": *"[^"]*"' "$d/packet.json" | sort -u | wc -l); have=$(ls "$d/images" | wc -l)
  [ "$want" -eq "$have" ] || echo "WARNING $s: packet names $want images, sealed folder has $have" >&2
  echo "$d"
}

prompt() {
  local briefs="" n=1 b
  for b in $BRIEFS; do briefs="$briefs $n. \`$b\`"; n=$((n+1)); done
  printf '%s' "Your instructions are the full text of these files in this folder, read in this order and followed exactly (skip the leading \`<!-- … -->\` comments):$briefs.
The error taxonomy is \`page-error-taxonomy.md\` in this folder. Work only inside this folder.
$KEYWORD: \`packet.json\`
OUTPUT_FILE: \`review.json\`"
}

one() {  # $1 packet, $2 suffix
  local p="$1" s d t0; s=$(basename "$p" .json); d=$(seal "$p"); t0=$(date +%s)
  if [ "$ENGINE" = claude ]; then
    prompt | (cd "$d" && claude -p --model "$MODEL" --restricted --tools Read Write --allowedTools Read Write --strict-mcp-config \
      --output-format stream-json --verbose) > "$OUT/meta/$s$2.jsonl" 2> "$OUT/meta/$s$2.err"
  fi
  echo "{\"packet\":\"$s\",\"seconds\":$(( $(date +%s) - t0 ))}" > "$OUT/meta/$s$2.time.json"
  [ -s "$d/review.json" ] && cp "$d/review.json" "$OUT/reviews/$s.json"
}

run_packet() {
  local p="$1" s; s=$(basename "$p" .json)
  [ -s "$OUT/reviews/$s.json" ] && { echo "$s already done" >> "$OUT/meta/done.log"; return; }
  one "$p" ""
  [ -s "$OUT/reviews/$s.json" ] || one "$p" ".retry"
  if [ -s "$OUT/reviews/$s.json" ]; then echo "$s ok"; else echo "$s FAILED (collect may recover it from the transcript)"; fi >> "$OUT/meta/done.log"
}

i=0
for p in "$SRC"/*.json; do
  run_packet "$p" &
  i=$((i+1)); if [ "$i" -ge "$PAR" ]; then wait -n; i=$((i-1)); fi
done
wait
echo ALL_DONE >> "$OUT/meta/done.log"
cat "$OUT/meta/done.log"
