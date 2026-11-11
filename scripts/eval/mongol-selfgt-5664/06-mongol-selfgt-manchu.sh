#!/bin/bash
# timeout: 30m
# issue: 5664
#
# PRIOR ART: 05-mongol-realgt-read.sh (same queue, same word crops' columns); scripts/eval/mongol-selfgt-5664/manchu_read.py.
# 06-mongol-selfgt-manchu (#5664, job mongol-selfgt-5664): the Manchu OCR LoRA mic7ch/manchu-ocr-llama-mix-v2
# (checkpoint-19000, Llama-3.2-11B-Vision 4-bit) reads 100 real Manchu test words (sanity) and 2,474 Kanjur word
# crops (+300 flipped as a control). Files only, nothing touches Mongo.
set -uo pipefail
S=/root/jobs/mongol-selfgt-5664; Q=$PWD
cd $S && source /root/jobs/mongol-synth-5664/venv/bin/activate
export HF_HUB_OFFLINE=1 PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
echo "start $(date -u +%FT%TZ)"
rm -f reads-manchu.jsonl
python manchu_read.py words-realgt manchu-list.txt reads-manchu.jsonl > "$Q/manchu.log" 2>&1
echo "manchu rc=$? $(date -u +%T) $(wc -l < reads-manchu.jsonl) reads"
nvidia-smi --query-gpu=memory.used --format=csv,noheader
echo "end $(date -u +%FT%TZ)"
