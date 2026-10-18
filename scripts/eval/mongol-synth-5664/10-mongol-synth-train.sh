#!/bin/bash
# timeout: 10h
# issue: 5664
#
# PRIOR ART: scripts/gpu/gex45-bench-6871/card.sh and the zh-bakeoff-6871 drive.sh (GPU holds run inside a Claude
# session); this is the first task written for /root/bin/gpu-queue.sh, which outlives the session.
# 10-mongol-synth-train (#5664, #6871 row 6): LoRA on Qwen2.5-VL-7B (Unsloth 4-bit) from 80K synthetic Kanjur-style
# columns, then inference on the frozen real columns. Queued with /root/bin/gpu-queue.sh, which runs it under
# /root/gpu.lock with cwd /root/jobs/gpu-queue/10-mongol-synth-train/ (= $OUT). Every python process exits when its
# stage ends, so no model is left on the card. Writes files only; nothing touches Mongo or any production store.
#
# Stages (each resumable: reads skip ids already written, training resumes from the newest checkpoint):
#   1 base   untrained model on the 30 meaning columns + 50 synthetic held-out   -> reads-base.jsonl
#   2 train  until TRAIN_HOURS or MAX_STEPS, checkpoint every 500 steps          -> ckpt/, adapter-final/, train-stats.json
#   3 infer  adapter on all frozen sets (30 meaning + 577 name-unit columns) + 400 held-out -> reads-lora.jsonl
# Results: /root/jobs/gpu-queue/10-mongol-synth-train/{reads-base,reads-lora}.jsonl; scored by judge.mjs (see the
# preregistration, scripts/eval/experiments/2026-10-18-mongol-synth-prereg-5664.md).
set -uo pipefail
J=/root/jobs/mongol-synth-5664
OUT=$PWD
TRAIN_HOURS=${TRAIN_HOURS:-8.3}
MAX_STEPS=${MAX_STEPS:-6000}   # smoke test: 4.3 s/step at batch 16 (48 px images); ~5 s at 84 px -> ~6K steps in 8.3 h
source "$J/venv/bin/activate"
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True HF_HUB_OFFLINE=1
cd "$J"   # unsloth writes its compiled cache to the cwd
echo "start $(date -u +%FT%TZ) out=$OUT hours=$TRAIN_HOURS max_steps=$MAX_STEPS"

python train.py --stage base --data data --eval eval --out "$OUT" --sets meaning,synth-heldout --heldout 50 > "$OUT/base.log" 2>&1
echo "base rc=$? $(date -u +%T) $(wc -l < "$OUT/reads-base.jsonl" 2>/dev/null) reads"

python train.py --stage train --data data --eval eval --out "$OUT" --hours "$TRAIN_HOURS" --max-steps "$MAX_STEPS" --save-every 500 > "$OUT/train.log" 2>&1
echo "train rc=$? $(date -u +%T)"

ad="$OUT/adapter-final"
[ -f "$ad/adapter_config.json" ] || ad=$(ls -d "$OUT"/ckpt/checkpoint-* 2>/dev/null | sort -t- -k2 -n | tail -1)
if [ -n "$ad" ]; then
  python train.py --stage infer --adapter "$ad" --data data --eval eval --out "$OUT" --heldout 400 --tag lora > "$OUT/infer.log" 2>&1
  echo "infer rc=$? adapter=$ad $(date -u +%T) $(wc -l < "$OUT/reads-lora.jsonl" 2>/dev/null) reads"
else
  echo "no adapter or checkpoint: nothing to read"
fi
nvidia-smi --query-gpu=memory.used --format=csv,noheader
echo "end $(date -u +%FT%TZ)"
