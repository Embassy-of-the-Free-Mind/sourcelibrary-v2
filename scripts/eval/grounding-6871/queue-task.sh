#!/usr/bin/env bash
# timeout: 4h
# issue: 6871
#
# PRIOR ART: hold.sh (this folder; the same serve → score → stop, bounded to 18 min per lock hold). Those holds
# scored 928 of 2,219 items, then a 10 h gpu-queue task took the lock; this finishes the run inside the queue.
# 213 of those 928 rows were dropped (main.pre-split-fix.jsonl keeps them): their page is split from a spread and was
# scored against the whole spread (build-set.mjs now picks the image with getPageSource), so they are scored again.
# 50-grounding-6871 (#6871 row A; 50- per the inbox note of 2026-10-18T05:43Z: Mongolian 10-, Latin 20-, then this): image vs no-image likelihood of stored OCR reads, Qwen2.5-VL-7B AWQ.
#   1. main pass, the remaining items (ll-score.py resumes: items already in main.jsonl are skipped)
#   2. noise floor: the 300 seeded pages again with a FRESH server (rerun.jsonl), then at a 1,200 px cap (res1200.jsonl)
#   3. score.py (preregistered) → results.json; explore.py (not preregistered) → explore.json
# Each hold.sh stops its vLLM server on exit; the card is back at ~2 MiB when this ends. Files only, no Mongo.
set -uo pipefail
J=/root/jobs/grounding-6871; PY=/root/bench/vl/bin/python
NOLOCK=1 SECS=9000 bash $J/code/hold.sh $J/main.jsonl
NOLOCK=1 SECS=1800 bash $J/code/hold.sh $J/rerun.jsonl --only $J/code/noise-ids.txt
NOLOCK=1 SECS=1800 bash $J/code/hold.sh $J/res1200.jsonl --only $J/code/noise-ids.txt --cap 1200
$PY $J/code/score.py $J/code/items.jsonl $J/main.jsonl --rerun $J/rerun.jsonl --res2 $J/res1200.jsonl --out $J/results.json > /dev/null
$PY $J/code/explore.py $J/code/items.jsonl $J/main.jsonl --out $J/explore.json > /dev/null
echo "rows: main $(wc -l < $J/main.jsonl) rerun $(wc -l < $J/rerun.jsonl) res1200 $(wc -l < $J/res1200.jsonl)"
nvidia-smi --query-gpu=memory.used --format=csv,noheader
