#!/bin/bash
# Root-disk alarm for the Hetzner box (#5534, #6223). Every 15 min from cron. Pages ntfy when the
# level changes (ok → high → critical and back), and REPEATS every 2 h while the level is critical.
#
# Why: on 2026-10-01 the 150 GB root disk hit 100% and headless jobs died at worktree checkout
# with "No space left on device" and no log line. The disk check in pipeline-health-alert.mjs
# (#5539) runs once a day at 07:00 and emails; the disk filled within hours. This is the fast path.
# Why the repeat (#6223): on 2026-10-07 the disk sat at 100% for hours after ONE page at the 85%
# crossing; every later run logged level=high prev=high and stayed silent while ~10 jobs ran.
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
MOUNT=${DISK_ALARM_MOUNT:-/}
mkdir -p "$(dirname "$STATE")"
now=$(date -u +%FT%TZ); epoch=$(date +%s)

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
prev=""; last_paged=""
[ -f "$STATE" ] && read -r prev last_paged < "$STATE"
prev=${prev:-ok}; last_paged=${last_paged:-0}
free=$(df -h --output=avail "$MOUNT" 2>/dev/null | tail -1 | tr -d ' ')
echo "$now $MOUNT used=${used:-?}% free=${free:-?} level=$level prev=$prev limit=$PCT_LIMIT%/$PCT_CRIT%"

page=""
[ "$level" != "$prev" ] && page=change
[ "$level" = critical ] && [ "$prev" = critical ] && [ $((epoch - last_paged)) -ge "$REPEAT_SEC" ] && page=repeat
[ -z "$page" ] && exit 0

runbook="Runbook #6223: scripts/workers/disk-steward.sh --apply moves idle /root folders to the volume /mnt/HC_Volume_105839809 and reaps merged worktrees."
case "$level" in
  critical) title="Hetzner disk ${used}% full — jobs about to die"; prio=urgent; msg="Root disk at ${used}% (${free} free). Jobs die silently when it fills. ${runbook}" ;;
  high)     title="Hetzner disk ${used}% full"; prio=high; msg="Root disk at ${used}% (${free} free, alarm at ${PCT_LIMIT}%). ${runbook}" ;;
  unknown)  title="Hetzner disk check UNKNOWN"; prio=high; msg="df could not read ${MOUNT}. Treat as not-clear until checked (#5534)." ;;
  ok)       title="Hetzner disk recovered: ${used}%"; prio=default; msg="Root disk back under ${PCT_LIMIT}% (${free} free)." ;;
esac
[ "$page" = repeat ] && title="STILL: $title"
if curl -fsS -m 15 -H "Title: $title" -H "Priority: $prio" -H "Tags: floppy_disk" -d "$msg" "$TOPIC" >/dev/null; then
  echo "$level $epoch" > "$STATE"; echo "$now paged ($page): $title"
else
  echo "$now ntfy send FAILED; state left at $prev so the next run retries"
fi
