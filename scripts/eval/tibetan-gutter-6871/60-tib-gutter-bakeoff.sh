#!/usr/bin/env bash
# timeout: 5h
# issue: 6871
# Row 4 bake-off: Yigdzin 1 (BDRC/tibetan-ocr @50506eb6, HF, sequential, greedy, DRY) on 30 of the 5,132 pages the
# leaf worker refused as guttered. Two arms: whole page, and the page cut into 3 horizontal bands. Reads to files only.
# References (line anchors, by eye) are fixed in scripts/eval/tibetan-gutter-6871/ before any read is looked at.
set -euo pipefail
J=/root/jobs/tib-gutter-6871; PY=/root/jobs/mongol-synth-5664/venv/bin/python
export OMP_NUM_THREADS=8
cd "$J"
$PY yig_page.py --manifest todo30.jsonl --out arm-page --mode page
$PY yig_page.py --manifest todo30.jsonl --out arm-bands --mode bands --bands 3
ls arm-page/*.txt arm-bands/*.txt | wc -l
