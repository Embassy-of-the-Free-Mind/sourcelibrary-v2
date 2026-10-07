#!/bin/bash
# Root-disk alarm for the Hetzner box (#5534). Every 15 min from cron; pages ntfy ONCE per
# crossing of the threshold (state file), and once more when it recovers.
#
# Why: on 2026-10-01 the 150 GB root disk hit 100% and headless jobs died at worktree checkout
# with "No space left on device" and no log line. The disk check in pipeline-health-alert.mjs
# (#5539) runs once a day at 07:00 and emails; the disk filled within hours. This is the fast path.
#
# Channel: ntfy topic sourcelibrary-uptime, the same one scripts/uptime-monitor.mjs pages on.
# Install (Hetzner crontab, beside the uptime monitor):
#   */15 * * * * /root/sourcelibrary/scripts/workers/disk-alarm.sh >> /var/log/sourcelibrary/disk-alarm.log 2>&1
# Test that it fires: DISK_ALARM_PCT=1 DISK_ALARM_STATE=/tmp/disk-alarm-test scripts/workers/disk-alarm.sh
set -u
PCT_LIMIT=${DISK_ALARM_PCT:-85}
STATE=${DISK_ALARM_STATE:-/var/lib/sourcelibrary/disk-alarm.state}
TOPIC=${DISK_ALARM_TOPIC:-https://ntfy.sh/sourcelibrary-uptime}
MOUNT=${DISK_ALARM_MOUNT:-/}
mkdir -p "$(dirname "$STATE")"
now=$(date -u +%FT%TZ)

used=$(df --output=pcent "$MOUNT" 2>/dev/null | tail -1 | tr -dc '0-9')
if [ -z "$used" ]; then
  # An unreadable check is UNKNOWN, never clear: page once for it too.
  level=unknown
else
  level=ok; [ "$used" -ge "$PCT_LIMIT" ] && level=high
fi
prev=$(cat "$STATE" 2>/dev/null || echo ok)
free=$(df -h --output=avail "$MOUNT" 2>/dev/null | tail -1 | tr -d ' ')
echo "$now $MOUNT used=${used:-?}% free=${free:-?} level=$level prev=$prev limit=$PCT_LIMIT%"

if [ "$level" != "$prev" ]; then
  case "$level" in
    high)    title="Hetzner disk ${used}% full"; prio=urgent; msg="Root disk at ${used}% (${free} free, alarm at ${PCT_LIMIT}%). Jobs die at checkout when it fills. Runbook: #5534; the 500 GB volume /mnt/HC_Volume_105839809 has room (root-moved/)." ;;
    unknown) title="Hetzner disk check UNKNOWN"; prio=high; msg="df could not read ${MOUNT}. Treat as not-clear until checked (#5534)." ;;
    ok)      title="Hetzner disk recovered: ${used}%"; prio=default; msg="Root disk back under ${PCT_LIMIT}% (${free} free)." ;;
  esac
  if curl -fsS -m 15 -H "Title: $title" -H "Priority: $prio" -H "Tags: floppy_disk" -d "$msg" "$TOPIC" >/dev/null; then
    echo "$level" > "$STATE"; echo "$now paged: $title"
  else
    echo "$now ntfy send FAILED; state left at $prev so the next run retries"
  fi
fi
