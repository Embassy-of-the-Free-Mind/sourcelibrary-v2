#!/bin/bash
# Auto-sync Hetzner crontab to git.
# Runs daily via cron. Commits directly to main (acceptable for this file per #498).
# Usage: add to Hetzner crontab:
#   0 4 * * * /root/sourcelibrary/scripts/workers/sync-crontab.sh >> /var/log/sourcelibrary/crontab-sync.log 2>&1

set -euo pipefail
cd /root/sourcelibrary

CRONTAB_FILE="scripts/workers/crontab.production"

# Dump current crontab
crontab -l > "$CRONTAB_FILE.tmp"

# Check if anything changed
if diff -q "$CRONTAB_FILE" "$CRONTAB_FILE.tmp" > /dev/null 2>&1; then
  rm "$CRONTAB_FILE.tmp"
  echo "[sync-crontab] $(date -Iseconds) No changes"
  exit 0
fi

mv "$CRONTAB_FILE.tmp" "$CRONTAB_FILE"

# Pull latest to avoid conflicts, then commit and push
git pull --rebase --quiet origin main 2>/dev/null || true
git add "$CRONTAB_FILE"
git commit -m "chore: auto-sync Hetzner crontab [skip ci]" --no-gpg-sign
git push origin main

echo "[sync-crontab] $(date -Iseconds) Crontab updated and pushed"
