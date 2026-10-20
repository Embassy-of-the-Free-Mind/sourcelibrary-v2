#!/usr/bin/env bash
# timeout: 24h
# issue: 6871
# Row 4 full read (round 2 PASSED, r2/PREREGISTRATION.md): Yigdzin 1 whole-page reads of the 5,132 guttered Tibetan
# pages to FILES (full/), on HF: the vLLM arm crashed (V2 runner) and then deadlocked after warm-up with
# VLLM_USE_V2_MODEL_RUNNER=0, so the prereg's HF path applies. ~2.5 min/page ≈ 9 GPU-days: this task stops at its
# 24 h timeout and is re-queued under a new name (80-tib-gutter-full-b, -c …) until full/ holds every page — resumable, so other
# gated tests can run between chunks. Applying the reads (#4523 write rule, revisions first) is a decision for Derek.
set -uo pipefail
J=/root/jobs/tib-gutter-6871; cd "$J"
export OMP_NUM_THREADS=8
/root/jobs/mongol-synth-5664/venv/bin/python yig_page.py --manifest full.jsonl --out full --mode page
echo "full: $(ls full | grep -c '\.txt$') txt, $(ls full | grep -c '\.err$') err of $(wc -l < full.jsonl)"
