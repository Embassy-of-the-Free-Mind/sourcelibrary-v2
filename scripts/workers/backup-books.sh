#!/bin/bash
# Daily backup of books collection from MongoDB Atlas to Hetzner
# Cron: 0 4 * * * /root/sourcelibrary/scripts/workers/backup-books.sh
#
# Keeps 7 days of gzipped mongodump archives.
# Restore: mongodump --uri="$MONGODB_URI" --db=bookstore --collection=books --gzip --dir=/root/backups/books-YYYY-MM-DD

set -euo pipefail

BACKUP_DIR="/root/backups"
RETENTION_DAYS=7
DATE=$(date +%Y-%m-%d)
DUMP_DIR="$BACKUP_DIR/books-$DATE"
LOG="/var/log/sourcelibrary/backup-books.log"

log() { echo "[$(date -Is)] $1" >> "$LOG"; }

# Load env
set -a
source /root/sourcelibrary/.env.production.local
set +a

mkdir -p "$BACKUP_DIR"

log "Starting books backup"

# Dump books collection
if mongodump --uri="$MONGODB_URI" --db=bookstore --collection=books --gzip --out="$DUMP_DIR" >> "$LOG" 2>&1; then
  SIZE=$(du -sh "$DUMP_DIR" | cut -f1)
  log "Backup complete: $DUMP_DIR ($SIZE)"
else
  log "ERROR: mongodump failed"
  exit 1
fi

# Also dump books_warehouse for completeness
if mongodump --uri="$MONGODB_URI" --db=bookstore --collection=books_warehouse --gzip --out="$DUMP_DIR" >> "$LOG" 2>&1; then
  log "Warehouse backup complete"
else
  log "WARNING: warehouse dump failed (non-fatal)"
fi

# Also dump deleted_books
mongodump --uri="$MONGODB_URI" --db=bookstore --collection=deleted_books --gzip --out="$DUMP_DIR" >> "$LOG" 2>&1 || true

# Clean up old backups
find "$BACKUP_DIR" -maxdepth 1 -name "books-*" -type d -mtime +$RETENTION_DAYS -exec rm -rf {} \; 2>/dev/null
log "Cleanup complete (retention: ${RETENTION_DAYS}d)"

# Report
TOTAL=$(ls -d "$BACKUP_DIR"/books-* 2>/dev/null | wc -l)
log "Done. $TOTAL backups on disk."
