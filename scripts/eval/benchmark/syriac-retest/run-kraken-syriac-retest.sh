#!/bin/bash
# PRIOR ART: run-cpu-engines.sh (scratch, Hetzner) — ran Kraken with default left-to-right lines; this driver sets -d horizontal-rl / --base-dir R and runs one process per arm under timeout (#4746 retest).
# Syriac retest (2026-09-16): Beth Mardutho / omnisyr Kraken models with the RIGHT-TO-LEFT options set
# (-d horizontal-rl for segmentation, --base-dir R for recognition) so line direction is a setting, not a
# post-hoc reversal. One process per ARM (run five in parallel); every page under `timeout`; a failed page
# is a row in kraken-timings.jsonl, never a wait.
#   usage: run-kraken-syriac-retest.sh <arm>   arm ∈ sophro-segmonto sophro-defaultseg qoruyo-estrangela qoruyo-eastern omnisyr
#   sets, in order: syriac-gt (40 published-GT MS pages) → syriac (28 sealed) → print-loop (8 pages of loop-heavy printed books)
ARM=$1
K=/root/bench2-kraken/venv/bin/kraken
M=/root/ocr-bench/syriac-retest/models
ROOT=/root/ocr-bench/images
PL=/root/ocr-bench/syriac-retest/print-loop
T=/root/ocr-bench/syriac-retest/kraken-timings.jsonl
case $ARM in
  sophro-segmonto)   MODEL=$M/sophro-mhiro.mlmodel;      SEG=$M/sophro-seg-1col.mlmodel ;;
  sophro-defaultseg) MODEL=$M/sophro-mhiro.mlmodel;      SEG=- ;;
  qoruyo-estrangela) MODEL=$M/qoruyo-estrangela.mlmodel; SEG=- ;;
  qoruyo-eastern)    MODEL=$M/qoruyo-eastern.mlmodel;    SEG=- ;;
  omnisyr)           MODEL=$M/omnisyr.mlmodel;           SEG=- ;;
  *) echo "unknown arm $ARM"; exit 2 ;;
esac
ALL="syriac-gt:$ROOT/syriac-gt syriac:$ROOT/syriac print-loop:$PL"
for setdir in ${SETS:-$ALL}; do
  IFS=: read -r set dir <<< "$setdir"
  out=$dir/out/$ARM; mkdir -p "$out"
  for img in "$dir"/*.jpg; do
    slug=$(basename "$img" .jpg); o="$out/$slug.txt"
    [ -s "$o" ] && continue
    t0=$(date +%s)
    if [ "$SEG" = "-" ]; then
      timeout 900 nice -n 10 $K -i "$img" "$o" segment -bl -d horizontal-rl ocr -m "$MODEL" --base-dir R > "$out/$slug.log" 2>&1
    else
      timeout 900 nice -n 10 $K -i "$img" "$o" segment -bl -i "$SEG" -d horizontal-rl ocr -m "$MODEL" --base-dir R > "$out/$slug.log" 2>&1
    fi
    rc=$?
    echo "{\"set\":\"$set\",\"engine\":\"$ARM\",\"slug\":\"$slug\",\"rc\":$rc,\"secs\":$(( $(date +%s) - t0 )),\"chars\":$(wc -c < "$o" 2>/dev/null || echo 0)}" >> $T
  done
  echo "DONE $ARM $set $(date -Is)" >> $T
done
echo "ARM-DONE $ARM $(date -Is)" >> $T
