#!/usr/bin/env bash
# PRIOR ART: the 2026-10-14 Maya runs (scripts/eval/results/paired-translate-maya-6559), which ran these two runners by hand.
# Both judges over one packet, both A/B orders: agy gemini-3.8-flash-high and a sealed claude -p opus, side by side.
#   run-judges.sh PACKET_DIR
set -u
P=$1; H=$(cd "$(dirname "$0")" && pwd); EVAL=$H/../..
for o in "" "-swap"; do
  python3 "$EVAL/run-cli-arm.py" --requests "$P/requests$o.jsonl" --out "$P/judge-gemini$o.jsonl" --arm gemini-judge-florentine-6865 \
    --model gemini-3.8-flash-high --job florentine-compare-6865 --kind judge --parallel 2 >> "$P/gemini.log" 2>&1
done &
for o in "" "-swap"; do python3 "$H/claude-judge.py" "$P/requests$o.jsonl" "$P/judge-claude$o.jsonl" 2 >> "$P/claude.log" 2>&1; done &
wait
