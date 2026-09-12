#!/bin/bash
#
# Offsite backup of the IRREPLACEABLE half of the corpus — the text.
#
# WHY THIS EXISTS
# ---------------
# `backup-books.sh` dumps `books`, `books_warehouse`, `deleted_books` and stops,
# on the stated reasoning: "Images live on R2; pages can be re-OCR'd from R2 if
# needed." That leaves ~20.6M `pages` documents — every line of OCR and every
# translation — with no offsite copy at all.
#
# The reasoning is true in the narrow sense and expensive in the real one. Re-OCR
# means re-spending the model budget (~$56.5K to date), and it does NOT regenerate:
#   - human editorial corrections made through the reader/editor round-trip,
#   - `page_revisions` (the double-OCR corpus the whole quality-measurement stack
#     is built on, and which cannot be recreated because it records what specific
#     model versions produced on specific days),
#   - `first_translation_attempts` (verification evidence behind public claims),
#   - `chapter_texts`, `entities` (book indexes, page attributions).
#
# The preservation manifest states the principle this implements:
#   "TEXT + METADATA … the half that CANNOT be re-acquired: produced here at
#    ~$56.5K of model spend plus years of curatorial judgment, and no institution
#    has a copy. Archive it first; it costs about four cents a month."
# See `.claude/docs/preservation-policy.md` and
# `scripts/maintenance/build-preservation-manifest.mjs`.
#
# WHY IT STREAMS INSTEAD OF LANDING ON DISK
# -----------------------------------------
# The box has ~39 GB free and `/root/backups` already holds 14 GB; the collections
# below are ~33 GB of compressed storage. Landing a dump on disk would risk filling
# the volume the pipeline workers write to. Each collection is piped straight from
# `mongodump --archive` into `restic backup --stdin`, so nothing is ever written to
# local disk. The trade-off is that there is no fast local restore copy — restore
# comes from the restic repo (see RESTORE below).
#
# Cron: Sundays 06:00, after backup-books (04:00) and restic-backup (05:00) so the
# three never contend for the same upload bandwidth.
#   0 6 * * 0 /root/sourcelibrary/scripts/workers/backup-corpus-text.sh
#
# RESTORE
#   source /root/.config/restic-hetzner.env
#   restic snapshots --tag corpus-text
#   restic dump <snapshot-id> pages.archive.gz > /tmp/pages.archive.gz
#   mongorestore --uri "$MONGODB_URI" --gzip --archive=/tmp/pages.archive.gz
#
set -uo pipefail

REPO_DIR="/root/sourcelibrary"
LOG="/var/log/sourcelibrary/backup-corpus-text.log"
mkdir -p "$(dirname "$LOG")"

# Collections that cannot be re-acquired or cheaply regenerated. Anything
# derivable from images (thumbnails, gallery crops) is deliberately absent —
# this list is by DESIGN, not by breadth. If you add a store that holds
# model output or human judgement, add it here in the same commit.
COLLECTIONS=(
  pages                        # OCR + translation text — the bulk of the value
  page_revisions               # double-OCR corpus; records what a model did on a day
  chapter_texts                # chapter segmentation + text
  entities                     # book indexes and page attributions
  first_translation_attempts   # evidence behind public first-translation claims
  gallery_images               # illustration catalogue (metadata, not the crops)
)

log() { echo "[$(date -Is)] $1" >> "$LOG"; }

log "=== corpus-text backup start ==="

# shellcheck disable=SC1091
set -a; source "$REPO_DIR/.env.production.local"; set +a
# shellcheck disable=SC1091
source /root/.config/restic-hetzner.env

if [ -z "${MONGODB_URI:-}" ]; then log "FATAL: MONGODB_URI unset"; exit 1; fi
if [ -z "${RESTIC_REPOSITORY:-}" ]; then log "FATAL: RESTIC_REPOSITORY unset"; exit 1; fi

DB="${MONGODB_DB:-bookstore}"
STAMP="$(date -u +%F)"
failed=0

for coll in "${COLLECTIONS[@]}"; do
  # A dump of a renamed/emptied collection SUCCEEDS and writes an empty archive,
  # which is the failure mode that leaves you with backups of nothing. Assert the
  # collection has documents before trusting its dump. (Same lesson as the BPH
  # catalogue falling out of backup "by breadth, not by design".)
  # node, not mongosh — mongosh is not installed on this box, and the driver is
  # already a repo dependency. Prints digits only; exits non-zero if it can't answer.
  count=$(cd "$REPO_DIR" && node scripts/workers/lib/count-docs.mjs "$DB" "$coll" 2>>"$LOG" | tr -dc '0-9')
  if [ -z "$count" ] || [ "$count" -eq 0 ] 2>/dev/null; then
    log "FAIL $coll: expected documents, counted '${count:-<none>}' — NOT dumping (renamed? permissions?)"
    failed=$((failed + 1))
    continue
  fi

  log "$coll: $count docs — dumping to restic"
  # pipefail alone tells you the pipeline failed, not which half. PIPESTATUS
  # distinguishes "mongodump died" (retry later) from "restic died" (repo/network),
  # and without this check a silently-truncated dump uploads as a clean snapshot.
  mongodump --uri "$MONGODB_URI" --db "$DB" --collection "$coll" --archive --gzip 2>>"$LOG" \
    | restic backup --stdin --stdin-filename "${coll}.archive.gz" \
        --tag corpus-text --tag "$coll" --host clawdbot >>"$LOG" 2>&1
  st=("${PIPESTATUS[@]}")
  if [ "${st[0]}" -ne 0 ] || [ "${st[1]}" -ne 0 ]; then
    log "FAIL $coll: mongodump=${st[0]} restic=${st[1]}"
    failed=$((failed + 1))
  else
    log "OK   $coll ($count docs)"
  fi
done

# Retention: fewer copies than the nightly metadata dumps — these are large and
# change slowly (the pipeline is paused; text is append-mostly).
restic forget --tag corpus-text --keep-weekly 6 --keep-monthly 12 --prune >>"$LOG" 2>&1 \
  || log "WARN: forget/prune returned non-zero"

log "--- corpus-text snapshots ---"
restic snapshots --tag corpus-text --compact >>"$LOG" 2>&1 || log "WARN: could not list snapshots"

if [ "$failed" -ne 0 ]; then
  log "=== corpus-text backup FINISHED WITH $failed FAILURE(S) — $STAMP ==="
  exit 1
fi
log "=== corpus-text backup OK — $STAMP ==="
