#!/usr/bin/env bash
# timeout: 4h
# issue: 7567
# #7567 E5 GPU drafts (job euro-gpu-e3e5-7567): second pass: LightOnOCR + CHURRO after their HF caches were re-downloaded (the first pass found them deleted).
# la PERO-OCR (GPU), en+it LightOnOCR-3-1B, de CHURRO-3B (fp8, as E2's arm c), fr Surya 2. One engine at a time.
# Writes /root/jobs/euro-gpu-e3e5-7567/out/*.jsonl. Nothing here writes to Mongo.
set -uo pipefail
J=/root/jobs/euro-gpu-e3e5-7567; export J UTIL=0.6
echo "$(date -u +%FT%TZ) start; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) MiB"
mkdir -p $J/out $J/pero/out-xml
# PERO (not vLLM): parse-folder on the GPU config
if [ ! -s $J/out/PERO.jsonl ]; then
  date +%s > $J/pero/t0
  ( cd $J/pero/model/* 2>/dev/null || cd $J/pero/model; $J/pero/venv/bin/python -m pero_ocr.user_scripts.parse_folder -c config.ini --device gpu -s \
      -i $J/e5/img-la --output-xml-path $J/pero/out-xml ) > $J/pero/run.log 2>&1
  $J/pero/venv/bin/python $J/code/pero-collect.py $J/pero/out-xml $J/out/PERO.jsonl $J/pero/t0
fi
IMG=$J/e5/img-enit bash $J/code/drive.sh LO
IMG=$J/e5/img-de bash $J/code/drive.sh CH8

echo "$(date -u +%FT%TZ) end; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) MiB"
