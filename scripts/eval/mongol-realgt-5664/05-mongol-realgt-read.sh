#!/bin/bash
# timeout: 4h
# issue: 5664
#
# PRIOR ART: scripts/eval/mongol-synth-5664/10-mongol-synth-train.sh (its stage 3 is this read, on the frozen sets);
# train.py --stage infer is reused unchanged.
# 05-mongol-realgt-read (#5664): the synthetic-trained adapter (10-mongol-synth-train/adapter-final) reads every
# column of the leaves where a catalogued Kanjur text starts or ends, plus the leaves of four published
# transliterations. The reads are used ONLY to locate and verify alignments of known text (titles, colophons,
# transliterated prose) to real columns; they are not ground truth. Files only; nothing touches Mongo.
#   in:  /root/jobs/mongol-realgt-5664/readset/{columns.jsonl,img/}   (15,264 columns, set=realgt)
#   out: /root/jobs/mongol-realgt-5664/reads-realgt.jsonl              (resumable: ids already read are skipped)
set -uo pipefail
J=/root/jobs/mongol-synth-5664; R=/root/jobs/mongol-realgt-5664
AD=/root/jobs/gpu-queue/10-mongol-synth-train/adapter-final
Q=$PWD   # the queue task dir: logs go here
source "$J/venv/bin/activate"
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True HF_HUB_OFFLINE=1
cd "$J"   # unsloth's compiled cache lives here
echo "start $(date -u +%FT%TZ)"
python train.py --stage infer --adapter "$AD" --data "$R/empty" --eval "$R/readset" --out "$R" --heldout 0 --sets realgt --tag realgt > "$Q/infer.log" 2>&1
echo "infer rc=$? $(date -u +%T) $(wc -l < "$R/reads-realgt.jsonl" 2>/dev/null) reads of $(wc -l < "$R/readset/columns.jsonl")"
nvidia-smi --query-gpu=memory.used --format=csv,noheader
echo "end $(date -u +%FT%TZ)"
