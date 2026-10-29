#!/bin/bash
#
# Weekly offsite backup of EVERY OTHER Mongo collection — the ~196 that neither
# backup-books.sh nor backup-corpus-text.sh dumps (#7708).
#
# PRIOR ART: scripts/workers/backup-corpus-text.sh — same stream-into-restic shape.
# It dumps a list chosen BY DESIGN (the irreplaceable text); this script is the
# complement, chosen BY ENUMERATION, so nothing new can fall through the gap.
#
# WHY: on 2026-10-29 ~44 GB of `bookstore` had no copy outside Atlas — audit_log,
# sweep_log, iiif_manifests, book_indexes, page_annotations, collections, users,
# system_config_revisions, … — and Atlas's own snapshots are unverified
# (preservation-policy.md). The collection list is taken with listCollections at
# run time, so a collection created next month is in next week's backup.
#
# WHY UNCOMPRESSED: restic chunks, deduplicates and compresses. A gzipped archive
# changes byte-for-byte when one document changes, which defeats dedup; a plain
# archive with --numParallelCollections=1 is stable week to week, so restic
# stores mostly the delta. (backup-corpus-text.sh predates this and gzips.)
#
# Runs on gex45 (unmetered bandwidth, room for the read-back); needs mongodump
# (mongodb-database-tools, MongoDB's apt repo — installed 2026-10-29) and restic. Cron:
#   0 3 * * 1 f=/root/sourcelibrary/scripts/workers/backup-mongo-rest.sh; [ -x $f ] && flock -n /tmp/sl-backup-mongo-rest.lock $f
#
# RESTORE
#   source /root/.config/restic-hetzner.env
#   restic snapshots --tag mongo-rest
#   restic dump <snapshot-id> bookstore-rest.archive \
#     | mongorestore --uri "$MONGODB_URI" --archive --nsInclude 'bookstore.<collection>'
#   (omit --nsInclude to restore every collection; add --drop only if you mean it)
#
set -uo pipefail

REPO_DIR="${REPO_DIR:-/root/sourcelibrary}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG="${LOG:-/var/log/sourcelibrary/backup-mongo-rest.log}"
NTFY="https://ntfy.sh/sourcelibrary-uptime"
TAG=mongo-rest
FILE=bookstore-rest.archive
mkdir -p "$(dirname "$LOG")"

# Covered elsewhere, and dumped there — keep in step with those scripts. The
# check below fails loudly if one of these stops appearing in its script, so a
# collection dropped from corpus-text cannot silently fall out of both.
COVERED=(books deleted_books pages page_revisions chapter_texts entities first_translation_attempts gallery_images)

log() { echo "[$(date -Is)] $1" >> "$LOG"; }
alert() {
  log "ALERT: $1"
  curl -s -m 10 -H "Title: Mongo rest backup FAILED ($(hostname))" -H "Priority: high" \
       -d "$1" "$NTFY" > /dev/null 2>&1 || log "  (ntfy push failed too)"
}
die() { alert "$1"; log "=== $TAG backup FAILED ==="; exit 1; }

log "=== $TAG backup start ==="

# shellcheck disable=SC1091
set -a; source "$REPO_DIR/.env.production.local"; set +a
# shellcheck disable=SC1091
source /root/.config/restic-hetzner.env
[ -n "${MONGODB_URI:-}" ] || die "MONGODB_URI unset"
[ -n "${RESTIC_REPOSITORY:-}" ] || die "RESTIC_REPOSITORY unset"
DB="${MONGODB_DB:-bookstore}"

for c in "${COVERED[@]}"; do
  grep -qw -- "$c" "$HERE/backup-books.sh" "$HERE/backup-corpus-text.sh" \
    || die "'$c' is excluded here as covered, but neither backup-books.sh nor backup-corpus-text.sh names it"
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/mongo-rest.XXXXXX")"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

excl=$(IFS=,; echo "${COVERED[*]}")
(cd "$REPO_DIR" && node "$HERE/lib/mongo-collection-counts.mjs" "$DB" --exclude "$excl") > "$WORK/expect.json" 2>>"$LOG" \
  || die "could not list collections in $DB"
n=$(node -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1]))).length)' "$WORK/expect.json")
[ "$n" -ge 50 ] || die "only $n collections listed in $DB (expected ~196) — refusing to back up a shrunken database"
log "$n collections to dump (name estimated_count):"
node -e 'for (const [k,v] of Object.entries(JSON.parse(require("fs").readFileSync(process.argv[1])))) console.log("  "+k+" "+v)' "$WORK/expect.json" >> "$LOG"

ex_args=()
for c in "${COVERED[@]}"; do ex_args+=(--excludeCollection "$c"); done

# One archive, one collection at a time (stable byte order → restic dedups it).
# PIPESTATUS tells "mongodump died" from "restic died"; without it a truncated
# dump uploads as a clean snapshot.
# The URI goes in a 0600 --config file, not argv, where `ps` would show the password.
( umask 077; printf 'uri: "%s"\n' "$MONGODB_URI" > "$WORK/mongodump.yaml" )
mongodump --config "$WORK/mongodump.yaml" --db "$DB" "${ex_args[@]}" --numParallelCollections=1 --archive 2>>"$LOG" \
  | restic backup --stdin --stdin-filename "$FILE" --tag "$TAG" --host "$(hostname)" \
      --retry-lock 30m --json 2>>"$LOG" | tee "$WORK/restic.json" | grep -v '"status"' >>"$LOG"
st=("${PIPESTATUS[@]}")
[ "${st[0]}" -eq 0 ] && [ "${st[1]}" -eq 0 ] || die "mongodump=${st[0]} restic=${st[1]}"
snap=$(grep '"message_type":"summary"' "$WORK/restic.json" | sed -E 's/.*"snapshot_id":"([0-9a-f]+)".*/\1/')
[ -n "$snap" ] || die "restic reported no snapshot id"
log "snapshot $snap written"

# Restore rehearsal: read the snapshot back out of the repo and count every
# collection in it. Exit 0 from mongodump+restic is not evidence of a backup.
restic dump --retry-lock 30m "$snap" "$FILE" 2>>"$LOG" \
  | node "$HERE/lib/verify-dump-stream.mjs" mongo-archive --expect "$WORK/expect.json" > "$WORK/verify.json"
vst=("${PIPESTATUS[@]}")
summary=$(node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(`ok=${v.ok} collections=${v.names} docs=${v.total} bytes=${v.bytes} problems=${JSON.stringify(v.problems)}`)' "$WORK/verify.json" 2>/dev/null)
log "rehearsal $snap: $summary"
mkdir -p /var/log/sourcelibrary/backup-rehearsals
cp "$WORK/verify.json" "/var/log/sourcelibrary/backup-rehearsals/$TAG-$(date -u +%F)-$snap.json"
[ "${vst[0]}" -eq 0 ] && [ "${vst[1]}" -eq 0 ] || die "rehearsal failed for $snap: restic-dump=${vst[0]} verify=${vst[1]} $summary"

# Retention for THIS tag only. Never a bare `restic forget`: other tags in this
# repo have their own policies, and `transcripts` is never pruned.
restic forget --tag "$TAG" --host "$(hostname)" --keep-weekly 8 --keep-monthly 12 --prune --retry-lock 30m >>"$LOG" 2>&1 \
  || log "WARN: forget/prune returned non-zero"
restic snapshots --tag "$TAG" --compact >>"$LOG" 2>&1 || true

log "=== $TAG backup OK — $snap ==="
