#!/bin/bash
# PRIOR ART: box-r2.sh (round 2, sl-mitra-1 GPU) and box-syriac.sh (round 1) — same one-wrapper discipline. Round 3 of
# #5250 is CPU-only on Hetzner beside the production Syriac lane: ONE Kraken worker (P=1), nice 10 (inside syriac-run.sh),
# 3 BLAS threads, no GPU, no Gemini. Detached with nohup+setsid; progress is the timings file; r3.exit marks the end.
#
# usage (on Hetzner, after `syriac-draw-r3.py` has written /root/ocr-bench/syriac-r3 + images/syriac-r3):
#   nohup setsid bash /root/pp5250r3/code/start-r3.sh > /root/pp5250r3/start.out 2>&1 &
cd /root/pp5250r3 || exit 2
export W=/root/pp5250r3 S=/root/pp5250r3/syriac SRC=/root/ocr-bench/images/syriac-r3 GT=/root/ocr-bench/syriac-r3
export ARMS="none unsharp denoise flatten" DARK_ARMS=sauvola CROPS=0 REPEAT_PER_SET=15
export OMP_NUM_THREADS=3 MKL_NUM_THREADS=3
mkdir -p syriac
echo "start $(date -u +%FT%TZ)" > r3.start
bash code/syriac-run.sh prep > syriac/prep.out 2>&1
echo "prep-exit=$? $(date -u +%FT%TZ)" >> r3.start
bash code/syriac-run.sh run 1 > syriac/run.out 2>&1
echo "exit=$? $(date -u +%FT%TZ)" > r3.exit
