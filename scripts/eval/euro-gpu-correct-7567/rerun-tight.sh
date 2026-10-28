#!/usr/bin/env bash
# rerun-tight.sh — #7567 E1, second pass. The first pass (drive.sh G D CH LO IP S at util 0.365, 16 clients) ran beside the
# Tibetan re-read (tib-gemini-ocr-6871, 14.5 GB at util 0.6, outside the queue) and five of six servers hit a CUDA OOM:
# vLLM's budget left < 0.5 GB for activation spikes. Here each arm runs alone under /root/gpu.lock with ~1 GB of headroom
# and the gex45 card's tight flags; read.py keeps every page already read and retries only the error rows, so pages/hour
# of a resumed arm comes from this pass (`*.run.json` is overwritten by the pass that read the most pages, see the record).
# PRIOR ART: drive.sh in this directory (the arms, unchanged); scripts/gpu/gex45-bench-6871/card.sh (the *-tight recipes).
set -uo pipefail
J=${J:-/root/jobs/euro-gpu-correct-7567/e1}; IMG=${IMG:-/root/jobs/euro-gpu-correct-7567/img}
exec 9>/root/gpu.lock; flock -w 1800 9 || { echo "gpu.lock busy"; exit 1; }
run() { local arm=$1; shift; env J="$J" IMG="$IMG" "$@" bash "$J/code/drive.sh" "$arm"; }
for a in ${*:-G LO IP D S CH}; do
  case $a in
    G)  run G  UTIL=0.33 MAXLEN=12000 CLIENTS=8 G_TIGHT="--max-num-seqs 8" ;;
    LO) run LO UTIL=0.30 MAXLEN=12000 CLIENTS=8 LO_TIGHT="--max-num-seqs 8" ;;
    IP) run IP UTIL=0.34 MAXLEN=14000 CLIENTS=8 IP_TIGHT="--max-num-seqs 8 --max-num-batched-tokens 8192 --enforce-eager" ;;
    D)  run D  UTIL=0.35 MAXLEN=12000 CLIENTS=8 D_TIGHT="--max-num-seqs 8 --max-num-batched-tokens 4096 --mm-processor-kwargs {\"max_pixels\":1605632}" ;;
    S)  run S  UTIL=0.34 MAXLEN=14000 S_SEQS=8 S_MAXPX=2508800 ;;
    CH) run CH UTIL=0.365 MAXLEN=12000 CLIENTS=6 CH_TIGHT="--max-num-seqs 4 --max-num-batched-tokens 4096 --enforce-eager --kv-cache-dtype fp8" ;;
  esac
done
echo "RERUN-END $(date -u +%FT%TZ)" >> "$J/drive.log"
