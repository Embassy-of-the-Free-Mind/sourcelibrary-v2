#!/bin/bash
# timeout: 2h15m
# issue: 7119
# PRIOR ART: gex45 /root/gpu-queue/done/10-mongol-synth-train.sh (#5664: train then infer, every process exits when its
# stage ends so no model is left on the card) — same shape; this trains Kraken (ketos 7.1.1, VGSL) line models for
# Whish MS 147 from edition-anchored lines, three nested training sizes for the learning curve, then reads the
# held-out lines. Files only, under /root/jobs/whish147-kraken; nothing touches Mongo.
# Queue: cp gpu-task.sh /tmp/x.sh && /root/bin/gpu-queue.sh add /tmp/x.sh 071-whish147-kraken-v2
# v1 (07-whish147-kraken) read the raw grey line strips in `path` mode: ketos then runs its legacy centre-line normaliser
# on every line on the CPU (the card sat at 0%), and both small arms collapsed to one output string. v2 (this file)
# trains from precompiled binary datasets of contrast-normalised strips (normalize.py; `ketos compile -f path
# --force-type baseline`, which also turns the centre-line normaliser off), the 881-line arm first.
set -uo pipefail
J=/root/jobs/whish147-kraken; cd "$J"; G=${GPU_OUT:-gpu2}; source /root/bench/kraken/bin/activate
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$J/logs/gpu-task.log"; }
SPEC="[1,64,0,1 Cr3,13,32 Do0.1,2 Mp2,2 Cr3,13,32 Do0.1,2 Mp2,2 Cr3,9,64 Do0.1,2 Mp2,2 Cr3,9,64 Do0.1,2 S1(1x0)1,3 Lbx200 Do0.1,2 Lbx200 Do0.1,2 Lbx200 Do]"
echo "$J/ds/val.arrow" > "$J/ds/val.arrow.list"
arm() {  # arm <split> <epochs>
  [ -f "$J/$G/$1/DONE" ] && return 0
  rm -rf "$J/$G/$1"; mkdir -p "$J/$G/$1"
  log "train $1 start; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) MiB"
  ketos -d cuda:0 --workers 4 --threads 4 -s 147 train -f binary "$J/ds/$1.arrow" -e "$J/ds/val.arrow.list" -s "$SPEC" -B 4 \
    -N $2 -q fixed -o "$J/$G/$1" -u NFC > "$J/logs/$G-train-$1.log" 2>&1
  log "train $1 rc=$? $(ls $J/$G/$1 | grep -c ckpt) checkpoints"; touch "$J/$G/$1/DONE"
}
arm all 100
arm n300 150
arm n100 200
log "end; GPU $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) MiB"
