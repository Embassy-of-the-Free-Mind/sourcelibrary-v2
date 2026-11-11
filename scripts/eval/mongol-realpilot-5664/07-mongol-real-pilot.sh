#!/bin/bash
# timeout: 3h
# issue: 5664
#
# PRIOR ART: scripts/eval/mongol-synth-5664/10-mongol-synth-train.sh (same queue, same trainer, stages in one task)
# and scripts/eval/mongol-realgt-5664/05-mongol-realgt-read.sh. train.py and build_train.py are #6960's, unchanged.
# 07-mongol-real-pilot (#5664, #6871 row 6): does fine-tuning on the 516 real Kanjur columns fix the reader?
# Preregistered in scripts/eval/experiments/2026-10-19-mongol-real-pilot-prereg-5664.md (committed before this ran).
# Every python process exits when its stage ends, so no model is left on the card. Files only; nothing touches
# Mongo or any production store. The labels (CC BY-NC-ND) and the adapter trained on them stay on gex45.
#
#   0 build   pilot_build.py: filtered mix + realeval + leakage guard (exit 1 = leakage: nothing trains)
#   1 a-read  adapter-final unchanged on v23 + meaning 30 (arm a, same harness)       -> reads-a-reread.jsonl
#   2 smoke   25 steps from adapter-final on 400 mix rows; loss at step 25 must be < 3.0 (a fresh LoRA logs 4.5),
#             else retry loading the adapter as the base (unsloth loader, is_trainable) and gate again
#   3 train   arm b: 900 steps (or 1.75 h), lr 1e-4 cosine, warmup 30, batch 8 x 2       -> adapter-final/
#   4 read    arm b on v23 + meaning 30 + real-train + real-title + 400 synthetic held-out -> reads-pilot.jsonl
#   5 score   score_pilot.py -> cer.json (scores only)
set -uo pipefail
J=/root/jobs/mongol-synth-5664; R=/root/jobs/mongol-realgt-5664; P=/root/jobs/mongol-realpilot-5664
C=$P/code; RUN=$P/run
AD=/root/jobs/gpu-queue/10-mongol-synth-train/adapter-final
OUT=$PWD
STEPS=${STEPS:-900}; HOURS=${HOURS:-1.75}
source "$J/venv/bin/activate"
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True HF_HUB_OFFLINE=1
cd "$J"   # unsloth's compiled cache lives here
echo "start $(date -u +%FT%TZ) out=$OUT steps=$STEPS hours=$HOURS"

rm -rf "$RUN"
python "$C/pilot_build.py" --realgt "$R" --synth "$J" --code "$C" --out "$RUN" --real-share 0.4 --rows 14400 > "$OUT/build.log" 2>&1
rc=$?; echo "build rc=$rc $(tail -1 "$OUT/build.log" | cut -c1-400)"
[ $rc -eq 0 ] || { echo "LEAKAGE GUARD or build failed: not training"; exit 3; }
cp "$RUN/leakage.json" "$RUN/build-stats.json" "$OUT/"

python "$C/train.py" --stage infer --adapter "$AD" --data "$J/data" --eval "$RUN/realeval" --out "$OUT" --heldout 0 \
  --sets meaning,real-prose --tag a-reread > "$OUT/a-read.log" 2>&1
echo "a-read rc=$? $(date -u +%T) $(wc -l < "$OUT/reads-a-reread.jsonl" 2>/dev/null) reads"

mkdir -p "$RUN/smoke"; head -400 "$RUN/traindata/labels.jsonl" > "$RUN/smoke/labels.jsonl"
gate() {   # $1 = smoke out dir: first logged loss < 3.0 means training continued from the synthetic adapter
  python - "$1/train-stats.json" <<'EOF'
import json, sys
try:
    s = json.load(open(sys.argv[1])); l = s['loss_log'][0]['loss']
except Exception as e:
    print('gate: no stats', e); sys.exit(1)
print('gate: loss at step', s['loss_log'][0]['step'], '=', round(l, 3)); sys.exit(0 if l < 3.0 else 1)
EOF
}
MODE=init
python "$C/train.py" --stage train --init-adapter "$AD" --data "$RUN/smoke" --eval "$RUN/realeval" --out "$OUT/smoke-init" \
  --max-steps 25 --warmup 5 --lr 1e-4 --save-every 1000 > "$OUT/smoke-init.log" 2>&1
echo "smoke-init rc=$? $(date -u +%T) $(grep -m1 'Trainable parameters' "$OUT/smoke-init.log" | tr -s ' ')"
if ! gate "$OUT/smoke-init"; then
  MODE=base
  python "$C/train.py" --stage train --base "$AD" --data "$RUN/smoke" --eval "$RUN/realeval" --out "$OUT/smoke-base" \
    --max-steps 25 --warmup 5 --lr 1e-4 --save-every 1000 > "$OUT/smoke-base.log" 2>&1
  echo "smoke-base rc=$? $(date -u +%T) $(grep -m1 'Trainable parameters' "$OUT/smoke-base.log" | tr -s ' ')"
  gate "$OUT/smoke-base" || { echo "neither load path continues the adapter: not training"; exit 4; }
fi
rm -rf "$OUT"/smoke-*/ckpt "$OUT"/smoke-*/adapter-final
echo "mode=$MODE"
if [ $MODE = init ]; then LOAD=(--init-adapter "$AD"); else LOAD=(--base "$AD"); fi

python "$C/train.py" --stage train "${LOAD[@]}" --data "$RUN/traindata" --eval "$RUN/realeval" --out "$OUT" \
  --max-steps "$STEPS" --hours "$HOURS" --warmup 30 --lr 1e-4 --save-every 300 > "$OUT/train.log" 2>&1
echo "train rc=$? $(date -u +%T)"

ad="$OUT/adapter-final"
[ -f "$ad/adapter_config.json" ] || ad=$(ls -d "$OUT"/ckpt/checkpoint-* 2>/dev/null | sort -t- -k2 -n | tail -1)
if [ -n "$ad" ]; then
  python "$C/train.py" --stage infer --adapter "$ad" --data "$J/data" --eval "$RUN/realeval" --out "$OUT" --heldout 400 \
    --sets meaning,real-prose,real-train,real-title,synth-heldout --tag pilot > "$OUT/infer.log" 2>&1
  echo "infer rc=$? adapter=$ad $(date -u +%T) $(wc -l < "$OUT/reads-pilot.jsonl" 2>/dev/null) reads"
else
  echo "no adapter or checkpoint: nothing to read"
fi
python "$C/score_pilot.py" --refs "$RUN/realeval/refs.jsonl" --pairs "$R/body-pairs.jsonl" "$OUT/reads-a-reread.jsonl" \
  $( [ -f "$OUT/reads-pilot.jsonl" ] && echo "$OUT/reads-pilot.jsonl" ) > "$OUT/cer.json" 2> "$OUT/score.log"
echo "score rc=$?"; python -c "import json;d=json.load(open('$OUT/cer.json'));print({k:v.get('v23_all') for k,v in d.items()})"
nvidia-smi --query-gpu=memory.used --format=csv,noheader
echo "end $(date -u +%FT%TZ)"
