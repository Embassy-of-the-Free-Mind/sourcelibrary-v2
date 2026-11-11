#!/usr/bin/env bash
# PRIOR ART: scripts/eval/run-cli-arm.py — drives a CLI model over packets for an OCR/translation ARM; this is a
# 20-line loop that sends classification batches to `claude -p` (haiku, the job's own subscription quota) and keeps
# the raw reply next to the batch. Used by classify-unclassed.py between its `rules` and `merge` modes.
# Usage: run-batches.sh <dir-with-prompt.txt-and-batches/> [model]
set -u
D="$1"; MODEL="${2:-haiku}"
for f in "$D"/batches/*.json "$D"/calib/*.json; do
  [ -e "$f" ] || continue
  case "$f" in *.out.json) continue;; esac
  out="${f%.json}.out.json"
  [ -s "$out" ] && continue
  { cat "$D/prompt.txt"; cat "$f"; } | timeout 300 claude -p --model "$MODEL" --output-format json > "$out.tmp" 2> "$out.err" \
    && python3 -I -c 'import json,sys; j=json.load(open(sys.argv[1])); open(sys.argv[2],"w").write(j.get("result",""))' "$out.tmp" "$out" \
    && rm -f "$out.tmp" || echo "failed: $f"
  sleep 1
done
echo done
