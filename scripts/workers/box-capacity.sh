#!/usr/bin/env bash
# PRIOR ART: scripts/workers/job-where.sh — live headroom (load, free memory, Claude limits) to place ONE
#   job; it does not report the fixed size of each disk, volume or GPU, or what fills them.
#
# What each job box HAS: cores, memory, every disk and how full it is, the GPU, and the biggest folders on
# each disk. Run from the laptop (the only machine that reaches all four). Paste the result into the
# "Capacity" table in JOB-HOSTS.md when it moves.
#
#   scripts/workers/box-capacity.sh            # all four boxes
#   scripts/workers/box-capacity.sh main       # one box
#
# Why (2026-10-26): cloudlayer's 492 GB scratch volume was at 98% and main's 150 GB root at 85% on the same
# morning, and nobody had the sizes written down: dispatchers read "free disk" as one number per box.
set -u
BOXES=${SL_JOB_BOXES:-"main=root@46.224.122.120 cloudlayer=root@46.224.208.175 l7a=root@167.233.32.250 gex45=root@65.108.136.89"}
probe='
printf "cpu: %s x %s | " "$(nproc)" "$(lscpu | sed -n "s/^Model name: *//p" | head -1)"
free -g | awk "/Mem/{printf \"ram: %s GB | \", \$2} /Swap/{printf \"swap: %s GB\n\", \$2}"
command -v nvidia-smi >/dev/null && nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | sed "s/^/gpu: /"
df -P -x tmpfs -x devtmpfs -x overlay -x squashfs -x efivarfs | awk "NR>1 && \$6 !~ \"^/(boot|sys|run|snap)\" {print \$6}" | while read -r m; do
  df -h --output=size,avail,pcent "$m" | tail -1 | awk -v m="$m" "{printf \"disk %s: %s, %s free (%s used) | biggest: \", m, \$1, \$2, \$3}"
  timeout 120 du -xsh "${m%/}"/* "${m%/}"/.[a-z]* 2>/dev/null | sort -rh | head -4 | awk "{printf \"%s %s; \", \$2, \$1}"; echo
done'
for pair in $BOXES; do
  name=${pair%%=*}; host=${pair#*=}
  [ $# -gt 0 ] && [[ " $* " != *" $name "* ]] && continue
  echo "== $name ($host)"
  ssh -o ConnectTimeout=10 -o BatchMode=yes "$host" "$probe" 2>/dev/null || echo "   did not answer"
done
