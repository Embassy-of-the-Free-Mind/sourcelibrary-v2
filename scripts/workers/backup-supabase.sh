#!/bin/bash
#
# Weekly offsite backup of the WHOLE Supabase database (#7708).
#
# PRIOR ART: scripts/workers/backup-corpus-text.sh (stream into restic --stdin),
# scripts/workers/backup-bph-catalog.sh (bph_works only, JSON export, daily).
# Neither covers the other ~145 tables: page_translations (94 GB), pages (38 GB),
# ngram_series, the embedding tables, ustc_editions, books_catalog, …
#
# WHY: until 2026-10-29 Supabase's own managed backups were the only copy —
# 8 daily, PITR off, held by the same vendor as the primary. This puts one in
# the restic repo on Hetzner Object Storage, which we control.
#
# HOW, and the three traps it steps around:
#   - pg_dump must be >= the server major (PG 17.6). Ubuntu 24.04 ships 16, which
#     refuses; install postgresql-client-17 from the PGDG apt repo.
#   - libpq cannot parse SUPABASE_DB_URL (the password breaks its URI parser), so
#     lib/pg-env-from-url.mjs splits it with Node's URL parser into PG* variables
#     and a 0600 PGPASSFILE. Nothing here prints them; pg_dump's stderr goes
#     through the same helper's `redact` filter before it reaches the log.
#   - Port 5432 (session), never 6543: the transaction pooler cannot hold the one
#     consistent snapshot pg_dump takes.
# Plain SQL format, uncompressed, so restic can dedup week over week.
#
# Runs on gex45. Cron (offset a day from backup-mongo-rest.sh):
#   0 3 * * 3 f=/root/sourcelibrary/scripts/workers/backup-supabase.sh; [ -x $f ] && flock -n /tmp/sl-backup-supabase.lock $f
#
# RESTORE (into an EMPTY database; a plain dump replays CREATEs then COPYs)
#   source /root/.config/restic-hetzner.env
#   restic snapshots --tag supabase
#   restic dump <snapshot-id> supabase.sql | psql -X -v ON_ERROR_STOP=0 "<target>"
#   One table: restic dump <id> supabase.sql | sed -n '/^COPY public.bph_works /,/^\\\.$/p'
#
set -uo pipefail

REPO_DIR="${REPO_DIR:-/root/sourcelibrary}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG="${LOG:-/var/log/sourcelibrary/backup-supabase.log}"
NTFY="https://ntfy.sh/sourcelibrary-uptime"
TAG=supabase
FILE=supabase.sql
PG_DUMP="${PG_DUMP:-/usr/lib/postgresql/17/bin/pg_dump}"
mkdir -p "$(dirname "$LOG")"

log() { echo "[$(date -Is)] $1" >> "$LOG"; }
alert() {
  log "ALERT: $1"
  curl -s -m 10 -H "Title: Supabase backup FAILED ($(hostname))" -H "Priority: high" \
       -d "$1" "$NTFY" > /dev/null 2>&1 || log "  (ntfy push failed too)"
}
die() { alert "$1"; log "=== $TAG backup FAILED ==="; exit 1; }

log "=== $TAG backup start ==="
[ -x "$PG_DUMP" ] || die "$PG_DUMP missing — apt install postgresql-client-17 (PGDG repo)"

# shellcheck disable=SC1091
set -a; source "$REPO_DIR/.env.production.local"; set +a
# shellcheck disable=SC1091
source /root/.config/restic-hetzner.env
[ -n "${SUPABASE_DB_URL:-}" ] || die "SUPABASE_DB_URL unset"
[ -n "${RESTIC_REPOSITORY:-}" ] || die "RESTIC_REPOSITORY unset"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/supabase-bk.XXXXXX")"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT
redact() { node "$HERE/lib/pg-env-from-url.mjs" redact; }

eval "$(node "$HERE/lib/pg-env-from-url.mjs" env "$WORK/pgpass")" || die "could not derive libpq settings from SUPABASE_DB_URL"

# Expected row counts (planner estimates — the rehearsal only fails on gross gaps).
psql -X -At -c "select coalesce(json_object_agg(schemaname||'.'||relname, n_live_tup), '{}') from pg_stat_user_tables" \
  > "$WORK/expect.json" 2> >(redact | grep -v -i -E 'collation|^DETAIL|^HINT' >> "$LOG") \
  || die "could not read table statistics"
n=$(node -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1]))).length)' "$WORK/expect.json")
[ "$n" -ge 50 ] || die "only $n tables listed (expected ~146) — refusing to back up a shrunken database"
log "$n tables; database size $(psql -X -At -c 'select pg_size_pretty(pg_database_size(current_database()))' 2>/dev/null)"

"$PG_DUMP" --format=plain --no-password 2> >(redact | grep -v -i -E 'collation version|^DETAIL: +The database was created|^HINT: +Rebuild' >> "$LOG") \
  | restic backup --stdin --stdin-filename "$FILE" --tag "$TAG" --host "$(hostname)" \
      --retry-lock 30m --json 2>>"$LOG" | tee "$WORK/restic.json" | grep -v '"status"' >>"$LOG"
st=("${PIPESTATUS[@]}")
[ "${st[0]}" -eq 0 ] && [ "${st[1]}" -eq 0 ] || die "pg_dump=${st[0]} restic=${st[1]}"
snap=$(grep '"message_type":"summary"' "$WORK/restic.json" | sed -E 's/.*"snapshot_id":"([0-9a-f]+)".*/\1/')
[ -n "$snap" ] || die "restic reported no snapshot id"
log "snapshot $snap written"

# Restore rehearsal: read it back from the repo, check the header and trailer,
# and count rows per table against the planner's estimates.
restic dump --retry-lock 30m "$snap" "$FILE" 2>>"$LOG" \
  | node "$HERE/lib/verify-dump-stream.mjs" pg-plain --expect "$WORK/expect.json" > "$WORK/verify.json"
vst=("${PIPESTATUS[@]}")
summary=$(node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(`ok=${v.ok} tables=${v.names} rows=${v.total} bytes=${v.bytes} complete=${v.complete} problems=${JSON.stringify(v.problems)}`)' "$WORK/verify.json" 2>/dev/null)
log "rehearsal $snap: $summary"
mkdir -p /var/log/sourcelibrary/backup-rehearsals
cp "$WORK/verify.json" "/var/log/sourcelibrary/backup-rehearsals/$TAG-$(date -u +%F)-$snap.json"
[ "${vst[0]}" -eq 0 ] && [ "${vst[1]}" -eq 0 ] || die "rehearsal failed for $snap: restic-dump=${vst[0]} verify=${vst[1]} $summary"

# Retention for THIS tag only — never a bare `restic forget`.
restic forget --tag "$TAG" --host "$(hostname)" --keep-weekly 8 --keep-monthly 12 --prune --retry-lock 30m >>"$LOG" 2>&1 \
  || log "WARN: forget/prune returned non-zero"
restic snapshots --tag "$TAG" --compact >>"$LOG" 2>&1 || true

log "=== $TAG backup OK — $snap ==="
