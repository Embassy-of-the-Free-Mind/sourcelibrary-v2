#!/usr/bin/env bash
# score.sh — score every arm of the #60 test with kanjur_align.py, unchanged, against the matching index, plus the
# shuffle (chance) control on arm A per index. The noise controls are run once per index beside this (see the record).
# PRIOR ART: scripts/eval/tibetan-nyingma-reference/run.sh (same scorer and controls, one arm, one index).
# Usage: J=/root/jobs/tib-halfleaf-60 bash score.sh   (indexes and scorer under $J/ref, copied from the main box)
set -euo pipefail
J=${J:-/root/jobs/tib-halfleaf-60}; A=$J/ref/tibetan-eval/kanjur_align.py; O=$J/scores; mkdir -p "$O"
# the 1 October Kangyur run used etext-index-full.pkl: re-scoring its 100 bl-kanjur pages reproduces 100/100 stored identities
declare -A IX=([kangyur]=$J/ref/tibetan-eval/etext-index-full.pkl [nyingma]=$J/ref/nyingma-ref/gpb-index.pkl)
# each scorer holds its index in RAM (the Derge one is several GB once unpickled): at most 4 at a time
run() { while [ "$(jobs -rp | wc -l)" -ge 4 ]; do wait -n; done; "$@" & }
for f in "$J"/score-in/*-kangyur.jsonl "$J"/score-in/*-nyingma.jsonl; do
  b=$(basename "$f" .jsonl); set=${b##*-}
  [ -s "$O/$b.jsonl" ] && continue
  run python3 -I "$A" score --index "${IX[$set]}" --pages "$f" --out "$O/$b.jsonl"
done
for set in kangyur nyingma; do
  [ -s "$O/chance-A-$set.jsonl" ] || run python3 -I "$A" score --index "${IX[$set]}" --pages "$J/score-in/A-$set.jsonl" --control-shuffle --out "$O/chance-A-$set.jsonl"
done
wait
echo done > "$O/done.txt"
