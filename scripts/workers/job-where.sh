#!/usr/bin/env bash
# Which job box is emptiest? Run from the LAPTOP: it is the only machine that reaches all three (#6358, #6076).
# Asks each box for `claude-job.sh where` and names the one to start the next job on.
#
#   scripts/workers/job-where.sh
#   SL_JOB_BOXES="main=root@46.224.122.120 cloudlayer=root@46.224.208.175" scripts/workers/job-where.sh
#
# Why: on 2026-10-09 the main box sat at load 17 on 16 cores with its root disk 86% full while cloudlayer
# ran no jobs at all. Nothing told a dispatching session where there was room.
# A box is skipped when it is not ready (no Claude login, no gh login, no env file), has under 4 GB of
# memory or 15 GB of job disk free, or does not answer. The rest are ranked by load per core, then live jobs.
set -u
BOXES=${SL_JOB_BOXES:-"main=root@46.224.122.120 cloudlayer=root@46.224.208.175 l7a=root@167.233.32.250"}
MIN_MEM_MB=${MIN_MEM_MB:-4096}; MIN_DISK_GB=${MIN_DISK_GB:-15}
best=""; bestscore=""; bestssh=""
printf '%-11s %-6s %-9s %-9s %-9s %-5s %s\n' box load/core mem-free job-disk root-disk jobs verdict
for b in $BOXES; do
  label=${b%%=*}; target=${b#*=}
  line=$(ssh -o BatchMode=yes -o ConnectTimeout=8 "$target" /root/bin/claude-job.sh where 2>/dev/null | grep -m1 '^host=')
  if [ -z "$line" ]; then printf '%-11s %s\n' "$label" "no answer (ssh failed, or the wrapper there has no \`where\` yet)"; continue; fi
  cores=1 load1=0 mem_free_mb=0 job_disk_free_gb=0 root_free_gb=0 live_jobs=0 ready=no
  for kv in $line; do case "$kv" in cores=*|load1=*|mem_free_mb=*|job_disk_free_gb=*|root_free_gb=*|live_jobs=*|ready=*) eval "${kv%%=*}='${kv#*=}'" ;; esac; done
  per=$(awk -v l="$load1" -v c="$cores" 'BEGIN{printf "%.2f", l/c}')
  verdict=ok
  [ "$ready" = yes ] || verdict="skip: $ready"
  [ "$verdict" = ok ] && [ "$mem_free_mb" -lt "$MIN_MEM_MB" ] && verdict="skip: memory"
  [ "$verdict" = ok ] && [ "$job_disk_free_gb" -lt "$MIN_DISK_GB" ] && verdict="skip: disk"
  printf '%-11s %-6s %-9s %-9s %-9s %-5s %s\n' "$label" "$per" "$((mem_free_mb/1024))G" "${job_disk_free_gb}G" "${root_free_gb}G" "$live_jobs" "$verdict"
  [ "$verdict" = ok ] || continue
  score=$(awk -v p="$per" -v j="$live_jobs" 'BEGIN{printf "%.3f", p + j/100}')
  if [ -z "$best" ] || awk -v a="$score" -v b="$bestscore" 'BEGIN{exit !(a<b)}'; then best=$label; bestscore=$score; bestssh=$target; fi
done
if [ -n "$best" ]; then
  echo; echo "emptiest: $best"
  echo "  scp <brief.txt> $bestssh:/tmp/ && ssh $bestssh /root/bin/claude-job.sh start <name> /tmp/<brief.txt>"
else echo; echo "no box has room; do not start a job"; exit 1; fi
