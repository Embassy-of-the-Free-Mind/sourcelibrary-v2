#!/bin/bash
# PRIOR ART: scripts/eval/benchmark/syriac-retest/run-kraken-syriac-retest.sh — same Kraken invocation (Sophro Mhiro,
# default segmenter, -d horizontal-rl, --base-dir R) on the same 40 published-GT pages; it varies the MODEL, this
# varies only the IMAGE (#5250 arms), so it reuses the command line verbatim and adds the arm images + a gutter crop.
#
# Syriac stratum of #5250, on Hetzner CPU. Usage (from /root/pp5250):
#   bash code/syriac-run.sh prep     # arm images -> syriac/img/<arm>/<slug>.jpg (+ gutter halves)
#   bash code/syriac-run.sh run [P]  # every (arm, page) job, P parallel Kraken processes (default 3), resumable
# Arms: none, none-repeat (A/A noise floor, first 30 pages), otsu, sauvola, clahe, deskew, upscale2x,
#       gutter (the lane's findGutter cut, read right half then left; a page with no gutter scores as its
#       `none` read, since Kraken on CPU is deterministic — the A/A arm checks that),
#       pagecrop (pagecrop.py: each page cut from the NATIVE capture, spreads split at the fold, then the 2400 px cap;
#       added 2026-09-29 before any read because the lane's gutter test finds no gutter on this set — see pagecrop.py).
set -u
# Paths default to Hetzner; override W/SRC/K/MODEL/PY/GT to run elsewhere. 2026-09-29: three parallel Kraken
# processes OOM-killed on Hetzner (15 GB, shared with the production workers), so the reads ran on the laptop with
# the same kraken==7.1 and the same sophro-mhiro.mlmodel (md5 bd9f13a9067b971e5cab9c2fe3354ca3); prep ran on Hetzner.
W=${W:-/root/pp5250}; S=${S:-$W/syriac}; SRC=${SRC:-/root/ocr-bench/images/syriac-gt}; GT=${GT:-/root/ocr-bench/syriac-retest}
K=${K:-/root/bench2-kraken/venv/bin/kraken}; MODEL=${MODEL:-/root/ocr-bench/syriac-retest/models/sophro-mhiro.mlmodel}
PY=${PY:-/root/tibetan-ocr-app/venv/bin/python}
T=$S/timings.jsonl
# Round 2 (#5250, 2026-09-29) reuses this driver with env overrides instead of a copy:
#   S=<out dir>  ARMS="<whole-capture arms>"  CROPS=0 (no gutter/pagecrop)  DARK_ARMS="<arms run on jerusalem36 only>"
#   KOPTS="<global kraken options, e.g. -d cuda:0>"
ARMS=${ARMS:-none otsu sauvola clahe deskew upscale2x}; CROPS=${CROPS:-1}; DARK_ARMS=${DARK_ARMS:-}; KOPTS=${KOPTS:-}
mkdir -p $S/img $S/out
case ${1:-} in
prep)
  for img in $SRC/*.jpg; do
    slug=$(basename $img .jpg)
    for arm in $ARMS $DARK_ARMS; do
      case " $DARK_ARMS " in *" $arm "*) [ "${slug#jerusalem36-}" = "$slug" ] && continue ;; esac
      mkdir -p $S/img/$arm
      [ -s $S/img/$arm/$slug.jpg ] || echo "{\"slug\":\"$slug\",\"meta\":$($PY $W/code/preprocess.py $arm $img $S/img/$arm/$slug.jpg)}" >> $S/prep-meta.jsonl
    done
  done
  if [ "$CROPS" = 1 ]; then
    $PY $W/code/gutter.py $S/img/none $S/img/gutter >> $S/prep-meta.jsonl
    $PY $W/code/pagecrop.py $GT/gt-manifest.json $GT/gt $S/img/pagecrop >> $S/prep-meta.jsonl
  fi
  ;;
run)
  P=${2:-3}
  jobs=$S/jobs.txt; : > $jobs
  i=0
  for img in $S/img/none/*.jpg; do
    slug=$(basename $img .jpg)
    for arm in $ARMS $DARK_ARMS; do [ -f $S/img/$arm/$slug.jpg ] && echo "$arm $S/img/$arm/$slug.jpg $slug" >> $jobs; done
    [ $i -lt 30 ] && echo "none-repeat $S/img/none/$slug.jpg $slug" >> $jobs
    for half in R L; do
      [ -f $S/img/gutter/$slug.$half.jpg ] && echo "gutter.$half $S/img/gutter/$slug.$half.jpg $slug"  >> $jobs
      [ -f $S/img/pagecrop/$slug.$half.jpg ] && echo "pagecrop.$half $S/img/pagecrop/$slug.$half.jpg $slug"  >> $jobs
    done
    i=$((i+1))
  done
  export K MODEL S T TIMEOUT KOPTS
  xargs -P $P -L 1 bash -c '
    arm=$0; img=$1; slug=$2; mkdir -p $S/out/$arm; o=$S/out/$arm/$slug.txt
    [ -s $o ] && exit 0
    t0=$(date +%s)
    ${TIMEOUT:-timeout} 1200 nice -n 10 $K $KOPTS -i $img $o segment -bl -d horizontal-rl ocr -m $MODEL --base-dir R > $S/out/$arm/$slug.log 2>&1
    rc=$?
    echo "{\"arm\":\"$arm\",\"slug\":\"$slug\",\"rc\":$rc,\"secs\":$(( $(date +%s) - t0 )),\"chars\":$(wc -c < $o 2>/dev/null || echo 0)}" >> $T' < $jobs
  echo "{\"done\":\"$(date -Is)\"}" >> $T
  ;;
*) echo "usage: $0 prep|run [P]"; exit 2 ;;
esac
