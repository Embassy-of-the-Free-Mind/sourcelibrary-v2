#!/bin/bash
# Disk alarm for every job box, every mounted disk (#5534, #6223). Every 15 min from cron. Pages ntfy when the
# level changes (ok → high → critical and back), and REPEATS every 2 h while the level is critical.
#
# Why: on 2026-10-01 the 150 GB root disk hit 100% and headless jobs died at worktree checkout
# with "No space left on device" and no log line. The disk check in pipeline-health-alert.mjs
# (#5539) runs once a day at 07:00 and emails; the disk filled within hours. This is the fast path.
# Why the repeat (#6223): on 2026-10-07 the disk sat at 100% for hours after ONE page at the 85%
# crossing; every later run logged level=high prev=high and stayed silent while ~10 jobs ran.
#
# Every mount, not just / (2026-10-26): cloudlayer's 492 GB /data/scratch volume reached 98% (9.8 GB free)
# with no page, because this script watched only / and was not installed on cloudlayer or l7a at all.
# Each real mount (no tmpfs, overlay, efivars, /boot) gets its own level and state file. A non-root page
# names the mount's largest folders, since the steward's runbook only covers /root.
# DISK_ALARM_MOUNT=/ restricts it to one mount (the old behaviour).
#
# Channel: ntfy topic sourcelibrary-uptime, the same one scripts/uptime-monitor.mjs pages on.
# Install (Hetzner crontab, beside the uptime monitor):
#   */15 * * * * /root/sourcelibrary/scripts/workers/disk-alarm.sh >> /var/log/sourcelibrary/disk-alarm.log 2>&1
# Test that it fires: DISK_ALARM_PCT=1 DISK_ALARM_STATE=/tmp/disk-alarm-test scripts/workers/disk-alarm.sh
set -u
PCT_LIMIT=${DISK_ALARM_PCT:-85}
PCT_CRIT=${DISK_ALARM_CRIT_PCT:-95}
REPEAT_SEC=${DISK_ALARM_REPEAT_SEC:-7200}
STATE=${DISK_ALARM_STATE:-/var/lib/sourcelibrary/disk-alarm.state}
TOPIC=${DISK_ALARM_TOPIC:-https://ntfy.sh/sourcelibrary-uptime}
MOUNTS=${DISK_ALARM_MOUNT:-$(df -P -x tmpfs -x devtmpfs -x overlay -x squashfs -x efivarfs 2>/dev/null | awk 'NR>1 && $6 !~ "^/(boot|sys|run|snap)" {print $6}')}
mkdir -p "$(dirname "$STATE")"
now=$(date -u +%FT%TZ); epoch=$(date +%s)
case "$(hostname)" in clawdbot) DEF_BOX=Hetzner ;; earthai-live) DEF_BOX=cloudlayer ;; earthai-l7a) DEF_BOX=l7a ;; *) DEF_BOX=$(hostname) ;; esac
BOX=${DISK_ALARM_BOX:-$DEF_BOX}  # gex45-1 runs this too (#5660)

check() {
  local MOUNT=$1 st=$STATE
  # / keeps the original state file so an upgrade does not re-page; other mounts get their own.
  [ "$MOUNT" != / ] && st="$STATE.$(printf '%s' "$MOUNT" | tr -c 'A-Za-z0-9' '_')"
  local used level prev="" last_paged="" free page="" title prio msg runbook what
  used=$(df --output=pcent "$MOUNT" 2>/dev/null | tail -1 | tr -dc '0-9')
  if [ -z "$used" ]; then
    # An unreadable check is UNKNOWN, never clear: page once for it too.
    level=unknown
  else
    level=ok
    [ "$used" -ge "$PCT_LIMIT" ] && level=high
    [ "$used" -ge "$PCT_CRIT" ] && level=critical
  fi
  # State is "<level> <epoch of last page>"; a pre-#6223 state file holds the level alone.
  [ -f "$st" ] && read -r prev last_paged < "$st"
  prev=${prev:-ok}; last_paged=${last_paged:-0}
  free=$(df -h --output=avail "$MOUNT" 2>/dev/null | tail -1 | tr -d ' ')
  echo "$now $MOUNT used=${used:-?}% free=${free:-?} level=$level prev=$prev limit=$PCT_LIMIT%/$PCT_CRIT%"

  [ "$level" != "$prev" ] && page=change
  [ "$level" = critical ] && [ "$prev" = critical ] && [ $((epoch - last_paged)) -ge "$REPEAT_SEC" ] && page=repeat
  [ -z "$page" ] && return 0

  if [ "$MOUNT" = / ]; then
    what="Root disk"
    runbook="Runbook #6223: scripts/workers/disk-steward.sh --apply moves idle /root folders to the volume /mnt/HC_Volume_105839809 and reaps merged worktrees."
  else
    what="Disk $MOUNT"
    runbook="Largest: $(timeout 120 du -xsh "$MOUNT"/* 2>/dev/null | sort -rh | head -3 | awk '{printf "%s %s; ", $2, $1}')No steward runs here: free space by hand (#6223)."
  fi
  # What grew. On 2026-10-27 the root pages said "run disk-steward", which could not help: the 27 GB were agy's
  # orphaned .tmp files, not idle folders. Name the three directories (three levels deep) with the most bytes in
  # files over 20 MB written in the last 6 h, so the page points at the cause. Bounded; only at high or critical.
  grew=""
  if [ "$level" = high ] || [ "$level" = critical ]; then
    grew=$(timeout 90 find "$MOUNT" -xdev -type f -mmin -360 -size +20M -printf '%s %h\n' 2>/dev/null \
      | awk '{ n = split($2, p, "/"); d = ""; for (i = 2; i <= n && i <= 4; i++) d = d "/" p[i]; s[d] += $1; c[d]++ }
             END { for (d in s) printf "%d %s %d\n", s[d], d, c[d] }' \
      | sort -rn | head -3 | awk '{ printf "%s%s %.1f GB (%d files)", (NR > 1 ? "; " : ""), $2, $1 / 1073741824, $3 }')
    [ -n "$grew" ] && grew=" Written in the last 6 h: ${grew}."
  fi
  case "$level" in
    critical) title="$BOX $MOUNT ${used}% full — jobs about to die"; prio=urgent; msg="$what at ${used}% (${free} free). Jobs die silently when it fills.${grew} ${runbook}" ;;
    high)     title="$BOX $MOUNT ${used}% full"; prio=high; msg="$what at ${used}% (${free} free, alarm at ${PCT_LIMIT}%).${grew} ${runbook}" ;;
    unknown)  title="$BOX disk check UNKNOWN ($MOUNT)"; prio=high; msg="df could not read ${MOUNT}. Treat as not-clear until checked (#5534)." ;;
    ok)       title="$BOX $MOUNT disk recovered: ${used}%"; prio=low; msg="$what back under ${PCT_LIMIT}% (${free} free)." ;;
  esac
  [ "$page" = repeat ] && title="STILL: $title"
  if NTFY_SRC=disk-alarm.sh "$(dirname "$0")/ntfy-send.sh" "$TOPIC" "$title" "$prio" floppy_disk "$msg"; then
    echo "$level $epoch" > "$st"; echo "$now paged ($page): $title"
  else
    echo "$now ntfy send FAILED; state left at $prev so the next run retries"
  fi
}

for m in $MOUNTS; do check "$m"; done
