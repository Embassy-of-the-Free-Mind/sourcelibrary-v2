#!/bin/bash
# archive-iiif-daemon.sh — drain the IIIF/e-codices archiving backlog, unattended.
#
# Two lanes so the slow, big-file e-codices manuscripts can't stall the common case:
#   - iiif lane:     fast (concurrency 6, 5 req/s) — 2,300+ books, archives cleanly
#   - e-codices lane: slow (concurrency 2, 1.5 req/s, 120s timeout, breaker=80)
#                     — 55 manuscripts, 10 MB JP2s, the host throttles big files
#
# Runs as a launchd KeepAlive agent (survives reboot/sleep-wake). Loops forever:
# when both lanes report no work, it idles for an hour, then re-checks (new imports
# may enter 'archiving'). Logs to /tmp/archive-iiif-loop.log.
#
# Managed by ~/Library/LaunchAgents/org.sourcelibrary.archive-iiif.plist
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
set -a; source .env.production.local; set +a

W="node scripts/workers/archive-iiif-local.mjs --ignore-pause"

while true; do
  echo "===== CYCLE $(date) ====="

  # Fast lane: plain IIIF (the bulk). Clean, no throttling.
  IIIF=$($W --providers=iiif --limit=20000 --concurrency=6 --rate=5 2>&1)
  echo "$IIIF"

  # Slow lane: e-codices manuscripts. Polite + patient so big files don't trip the breaker.
  ECOD=$($W --providers=e-codices --limit=4000 --concurrency=2 --rate=1.5 --timeout=120 --max-fails=80 2>&1)
  echo "$ECOD"

  # Idle when fully drained; otherwise loop straight back for the next chunk.
  if echo "$IIIF" | grep -q "0 unarchived pages across 0 books" && \
     echo "$ECOD" | grep -q "0 unarchived pages across 0 books"; then
    echo "===== DRAINED — idling 1h $(date) ====="
    sleep 3600
  else
    sleep 15
  fi
done
