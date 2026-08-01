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
STAGING_DIR="$BACKUP_DIR/.bph-catalog-staging"
NTFY="https://ntfy.sh/sourcelibrary-uptime"

# Alert loudly. A backup that fails silently is worse than no backup: it reads
# as protection right up until the moment it is needed. The log alone was never
# read by anyone (nothing monitored it — confirmed 2026-08-01).
alert() {
  log "ALERT: $1"
  curl -s -m 10 -H "Title: BPH catalogue backup FAILED" -H "Priority: high" \
       -d "$1" "$NTFY" > /dev/null 2>&1 || log "  (ntfy push failed too)"
}

# Build into staging and only swap on success. The previous version deleted
# LATEST_DIR *before* dumping, so any failure destroyed the last good local
# snapshot and left nothing behind — recoverable from the weeklies and restic,
# but exactly backwards for the one directory meant to be the fast restore path.
rm -rf "$STAGING_DIR"
if ! node "$REPO/scripts/maintenance/backup-bph-catalog.mjs" --out "$STAGING_DIR" >> "$LOG" 2>&1; then
  alert "backup-bph-catalog.mjs failed — previous snapshot at $LATEST_DIR left intact"
  rm -rf "$STAGING_DIR"
  exit 1
fi

# Sanity-gate the snapshot before it replaces a known-good one. An export that
# "succeeds" with zero or collapsed row counts (revoked key, silent API change)
# is the failure mode that quietly overwrites the good copy with an empty one.
NEW_ROWS=$(python3 -c "import json;print(json.load(open('$STAGING_DIR/manifest.json'))['tables']['bph_works']['rows'])" 2>/dev/null || echo 0)
OLD_ROWS=$(python3 -c "import json;print(json.load(open('$LATEST_DIR/manifest.json'))['tables']['bph_works']['rows'])" 2>/dev/null || echo 0)

if [ "$NEW_ROWS" -lt 1000 ]; then
  alert "snapshot has only $NEW_ROWS bph_works rows (expected ~30k) — refusing to replace $LATEST_DIR"
  rm -rf "$STAGING_DIR"
  exit 1
fi
# The catalogue only grows or holds steady; a >10% drop means deletion or a
# partial export, and either way a human should look before it becomes the
# newest copy in the retention chain.
if [ "$OLD_ROWS" -gt 0 ] && [ "$NEW_ROWS" -lt $((OLD_ROWS * 90 / 100)) ]; then
  alert "snapshot row count dropped $OLD_ROWS → $NEW_ROWS (>10%) — refusing to replace $LATEST_DIR; inspect $STAGING_DIR"
  exit 1
fi

rm -rf "$LATEST_DIR"
mv "$STAGING_DIR" "$LATEST_DIR"
SIZE=$(du -sh "$LATEST_DIR" | cut -f1)
log "BPH catalogue backup complete ($SIZE, $NEW_ROWS rows)"

# Weekly point-in-time snapshot on Sundays, kept forever.
if [ "$DAY_OF_WEEK" -eq 7 ]; then
  WEEKLY_DIR="$BACKUP_DIR/bph-catalog-weekly/$(date +%Y-%m-%d)"
  mkdir -p "$WEEKLY_DIR"
  cp -r "$LATEST_DIR"/* "$WEEKLY_DIR"/
  log "Weekly snapshot saved → $WEEKLY_DIR"
fi
