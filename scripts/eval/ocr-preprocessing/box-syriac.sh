#!/bin/bash
# PRIOR ART: tibetan-gpu.sh `run` (job.sh) — same wrapper discipline. #5250, 2026-09-29: the laptop slept twice mid-run
# and Hetzner OOM-killed three Kraken processes, so the Syriac reads run on sl-mitra-1's CPU next to the Yigdzin job.
# This is the ONE poweroff path for the box: idle-poweroff.sh run -- box-syriac.sh. It runs the Syriac arms, then waits
# for the Tibetan job's job.exit, then leaves 25 min for the Hetzner pull. (The Tibetan job's own wrapper is killed
# so it cannot power off mid-Syriac; its job keeps running.)
cd /root/pp5250
export W=/root/pp5250 K=/root/kvenv/bin/kraken MODEL=/root/pp5250/models/sophro-mhiro.mlmodel OMP_NUM_THREADS=2
bash code/syriac-run.sh run ${P:-3} > syriac/run.out 2>&1
echo "syriac-exit=$? $(date -u +%FT%TZ)" > /root/pp5250/syriac.exit
until [ -f /root/pp5250/job.exit ]; do sleep 60; done
sleep 1500
