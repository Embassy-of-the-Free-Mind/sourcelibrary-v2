#!/bin/bash
# Daily same-scan duplicate detector (#4285). Approved by Derek 2026-10-23.
#
# PRIOR ART: scripts/audit/duplicate-fingerprint-groups.mjs --detect (the detector; this file only
# schedules it and decides when to page). It reads only: it never merges, hides or writes duplicate_of.
#
# Why: the detector existed since 2026-08-30 but was on no cron, and 1,060 groups of records holding
# the same digital object accumulated unseen (2026-10-23). It exits 2 while ANY group is unbaselined,
# so paging on exit 2 would page every day until the backlog is reviewed. This pages only when the
# number of unreviewed groups GROWS from one day to the next: a new duplicate was imported.
#
# Install (Hetzner main box crontab):
#   20 6 * * * flock -n /tmp/sl-duplicate-detector.lock /root/sourcelibrary/scripts/workers/duplicate-detector-daily.sh >> /var/log/sourcelibrary/duplicate-detector.log 2>&1
set -u
export PATH=/usr/local/bin:/root/.local/bin:/usr/bin:/bin
cd "$(dirname "$0")/../.." || exit 1
STATE=${DUP_DETECTOR_STATE:-/var/lib/sourcelibrary/duplicate-detector.count}
TOPIC=${DUP_DETECTOR_TOPIC:-https://ntfy.sh/sourcelibrary-uptime}
mkdir -p "$(dirname "$STATE")"

page() {
  echo "$(date -u +%FT%TZ) PAGED: $1"
  curl -s -m 20 -H "Title: duplicate scans" -H "Priority: high" \
    -d "$1. Log: /var/log/sourcelibrary/duplicate-detector.log (#4285)" "$TOPIC" > /dev/null
}

out=$(node --import tsx --env-file=.env.production.local scripts/audit/duplicate-fingerprint-groups.mjs --detect 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && [ "$rc" -ne 2 ]; then
  echo "$out" | tail -5
  page "detector failed (exit $rc)"
  exit 1
fi
n=$(echo "$out" | grep -o 'since the baseline: [0-9]*' | grep -o '[0-9]*$')
n=${n:-0}
prev=$(cat "$STATE" 2>/dev/null)
echo "$(date -u +%FT%TZ) unreviewed_groups=$n previous=${prev:-none} exit=$rc"
if [ -n "$prev" ] && [ "$n" -gt "$prev" ]; then
  page "$((n - prev)) new same-scan group(s) since yesterday; $n unreviewed. Check the import path that created them"
fi
echo "$n" > "$STATE"
