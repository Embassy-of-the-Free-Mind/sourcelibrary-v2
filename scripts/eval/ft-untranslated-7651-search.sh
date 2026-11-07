#!/bin/sh
# PRIOR ART: scripts/ft-search/search-one.sh + run-batch.sh (#7598) — same lean claude -p per book, but those
# pin Sonnet and give no Read tool; #7651 needs Read for page images and a second model for the re-judge pass.
#
# Search every id in <dir>/ids.txt with one unprimed claude -p each, P in parallel (<= 8, the #7651 cap).
# Resumable: a book whose JSON already holds a verdict (and not a usage-limit message) is skipped.
# Touch <dir>/STOP to stop launching new books.
#
#   MODEL=sonnet scripts/eval/ft-untranslated-7651-search.sh <dir> [parallel=6]
if [ "$1" = "--one" ]; then
  id=$2
  [ -f STOP ] && exit 0
  [ -s "$id.json" ] && grep -q verdict "$id.json" && ! grep -q "hit your" "$id.json" && exit 0
  claude -p "$(cat "$id.prompt")" --model "${MODEL:-sonnet}" --strict-mcp-config --setting-sources local \
    --disable-slash-commands --no-session-persistence --tools WebSearch WebFetch Bash Read \
    --allowedTools "WebSearch" "WebFetch" "Bash(curl:*)" "Read" \
    --system-prompt "You are a careful bibliographic researcher. Use the tools to search and verify, then answer exactly in the requested JSON." \
    --output-format json > "$id.json" 2> "$id.err"
  echo "$(date -u +%H:%M:%S) $id $?" >> progress.log
  exit 0
fi
SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
DIR=$1; P=${2:-6}
cd "$DIR" || exit 1
[ -f STOP ] && { echo "STOP file present in $DIR; remove it to run"; exit 1; }
export MODEL
xargs -P "$P" -n1 "$SELF" --one < ids.txt
echo BATCHDONE >> progress.log
