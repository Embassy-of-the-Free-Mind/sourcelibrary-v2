#!/bin/bash
# Daily backup of books collection from MongoDB Atlas to Hetzner
# Cron: 0 4 * * * /root/sourcelibrary/scripts/workers/backup-books.sh
#
# Strategy:
#   - /root/backups/books-latest/  — overwritten daily, always current (fast restore)
#   - /root/backups/books-weekly/  — snapshot every Sunday, kept forever (point-in-time)
#
# Only backs up book metadata (books, books_warehouse, deleted_books).
#
# The TEXT (pages, page_revisions, chapter_texts, entities, …) is covered by its
# sibling, backup-corpus-text.sh — NOT by this script. An earlier version of this
# comment read "pages can be re-OCR'd from R2 if needed", which left ~20.6M pages
# of OCR and translation with no offsite copy for months. It is true in the narrow
# sense and expensive in the real one: re-OCR re-spends the model budget and still
# cannot regenerate human corrections, page_revisions, or first-translation
# evidence. See .claude/docs/preservation-policy.md, principle 2.
#
# Restore: mongorestore --uri="$MONGODB_URI" --db=bookstore --gzip --dir=/root/backups/books-latest/bookstore

set -euo pipefail

BACKUP_DIR="/root/backups"
LOG="/var/log/sourcelibrary/backup-books.log"
DAY_OF_WEEK=$(date +%u)  # 1=Monday, 7=Sunday

log() { echo "[$(date -Is)] $1" >> "$LOG"; }

# Load env
set -a
source /root/sourcelibrary/.env.production.local
set +a

mkdir -p "$BACKUP_DIR"

log "Starting books backup"

# Always overwrite the latest snapshot
LATEST_DIR="$BACKUP_DIR/books-latest"
rm -rf "$LATEST_DIR"

if mongodump --uri="$MONGODB_URI" --db=bookstore --collection=books --gzip --out="$LATEST_DIR" >> "$LOG" 2>&1; then
  SIZE=$(du -sh "$LATEST_DIR" | cut -f1)
  log "Books backup complete ($SIZE)"
else
  log "ERROR: mongodump failed"
  exit 1
fi

mongodump --uri="$MONGODB_URI" --db=bookstore --collection=books_warehouse --gzip --out="$LATEST_DIR" >> "$LOG" 2>&1 || log "WARNING: warehouse dump failed"
mongodump --uri="$MONGODB_URI" --db=bookstore --collection=deleted_books --gzip --out="$LATEST_DIR" >> "$LOG" 2>&1 || true

# On Sundays, copy to a weekly snapshot for point-in-time history
if [ "$DAY_OF_WEEK" = "7" ]; then
  WEEKLY_DIR="$BACKUP_DIR/books-weekly-$(date +%Y-%m-%d)"
  cp -r "$LATEST_DIR" "$WEEKLY_DIR"
  log "Weekly snapshot saved: $WEEKLY_DIR"
fi

WEEKLY_COUNT=$(ls -d "$BACKUP_DIR"/books-weekly-* 2>/dev/null | wc -l)
log "Done. Latest updated, $WEEKLY_COUNT weekly snapshots on disk."
