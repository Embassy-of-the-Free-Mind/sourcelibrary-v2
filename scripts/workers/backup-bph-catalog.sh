#!/bin/bash
# Daily backup of the BPH catalogue (Supabase) to Hetzner.
# Cron: 0 4 * * * /root/sourcelibrary/scripts/workers/backup-bph-catalog.sh
#
# The BPH catalogue (bph_works) is the system of record that editors write to
# directly, so it gets the same latest+weekly discipline as the books backup:
#   - /root/backups/bph-catalog-latest/  — overwritten daily (fast restore)
#   - /root/backups/bph-catalog-weekly/<date>/ — every Sunday, kept (PITR)
#
# Each dir holds bph_works.json.gz, bph_works_revisions.json.gz,
# bph_works_pending_changes.json.gz + manifest.json (row counts).
#
# This is layer 3 of the catalogue's protection — on top of the append-only
# bph_works_revisions audit trail and Supabase's own managed backups.

set -euo pipefail

BACKUP_DIR="/root/backups"
LOG="/var/log/sourcelibrary/backup-bph-catalog.log"
DAY_OF_WEEK=$(date +%u)  # 1=Monday … 7=Sunday
REPO="/root/sourcelibrary"

log() { echo "[$(date -Is)] $1" >> "$LOG"; }

mkdir -p "$BACKUP_DIR" "$(dirname "$LOG")"

set -a
source "$REPO/.env.production.local"
set +a

log "Starting BPH catalogue backup"

LATEST_DIR="$BACKUP_DIR/bph-catalog-latest"
rm -rf "$LATEST_DIR"

if node "$REPO/scripts/maintenance/backup-bph-catalog.mjs" --out "$LATEST_DIR" >> "$LOG" 2>&1; then
  SIZE=$(du -sh "$LATEST_DIR" | cut -f1)
  log "BPH catalogue backup complete ($SIZE)"
else
  log "ERROR: backup-bph-catalog.mjs failed"
  exit 1
fi

# Weekly point-in-time snapshot on Sundays, kept forever.
if [ "$DAY_OF_WEEK" -eq 7 ]; then
  WEEKLY_DIR="$BACKUP_DIR/bph-catalog-weekly/$(date +%Y-%m-%d)"
  mkdir -p "$WEEKLY_DIR"
  cp -r "$LATEST_DIR"/* "$WEEKLY_DIR"/
  log "Weekly snapshot saved → $WEEKLY_DIR"
fi
