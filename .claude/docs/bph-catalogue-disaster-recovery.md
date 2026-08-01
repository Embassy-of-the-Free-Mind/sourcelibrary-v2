# BPH catalogue — protection and disaster recovery

`bph_works` is the **system of record** for the Bibliotheca Philosophica Hermetica.
Memorix is no longer the upstream (that sync ended 2026-05-25, see
`bph-memorix-final-sync.mjs`), and BPH librarians now edit it directly on Source
Library. So this table is not a cache of something else — if it is lost, the
catalogue is lost. It holds 29,879 records.

Verified end-to-end 2026-08-01, including a full restore drill.

## The four layers

| # | Layer | Covers | Where |
|---|---|---|---|
| 1 | `bph_works_revisions` | per-field logical rollback (from→to, editor, timestamp) | Supabase, append-only |
| 2 | Supabase managed backups | whole-database physical restore | Supabase, daily, 8 retained |
| 3 | Nightly JSON export | table-level restore, independent of Supabase | Hetzner `/root/backups/bph-catalog-*`, 04:00 daily + weekly kept |
| 4 | restic → object storage | offsite, encrypted, versioned | Hetzner Object Storage nbg1, 05:00 daily, 7d/8w/12m |

Layers 3 and 4 matter most: they are the only ones that survive losing the Supabase
account itself. Layer 4 sweeps `/root/backups` wholesale — note its cron entry and
snapshot tag both say `mongodump`, so **if anyone ever narrows that path, the BPH
catalogue silently falls out of offsite backup.** It is included by breadth, not by
design.

**PITR is OFF** (`pitr_enabled: false`). Supabase's physical backups are daily
snapshots, so the exposure on a bad write is up to ~24h, not seconds. Enabling PITR
is a paid add-on and a deliberate cost decision — not enabled unilaterally.

## Restoring

`scripts/maintenance/restore-bph-catalog.mjs`. Dry-run by default; `--apply` to write;
restoring over the live table additionally demands
`--i-understand-this-overwrites-live-data`.

```bash
# 1. Fetch a snapshot (latest, or a dated weekly)
scp -r root@46.224.122.120:/root/backups/bph-catalog-latest /tmp/
#    older: /root/backups/bph-catalog-weekly/2026-07-26
#    offsite: restic -r <repo> restore latest --target /tmp/restic-out

# 2. Rehearse — reads the snapshot, writes nothing
node scripts/maintenance/restore-bph-catalog.mjs --dir /tmp/bph-catalog-latest

# 3. Restore into a scratch table and diff before committing to anything
node scripts/maintenance/restore-bph-catalog.mjs --dir /tmp/bph-catalog-latest \
  --table bph_works --into bph_works_restore_drill --apply

# 4. Only then, if it is genuinely the right call:
node scripts/maintenance/restore-bph-catalog.mjs --dir /tmp/bph-catalog-latest \
  --table bph_works --apply --i-understand-this-overwrites-live-data
```

It upserts on `id` and **never deletes** — a row that is live but absent from the
snapshot is reported, not removed, because "created after the backup" and "should not
exist" are indistinguishable from inside the script.

For a *logical* mistake (a bad sweep, a wrong bulk edit) prefer layer 1: replay the
`from` values out of `bph_works_revisions` for the affected UBNs. That is surgical and
loses no legitimate concurrent work. Reach for a full restore only for structural loss.

## What the drill actually found

A restore path that has never been run is a hypothesis. Running it on 2026-08-01
against a scratch table surfaced three things, all now handled:

1. **Eight generated columns** (`search_norm`, `title_norm`, `author_norm`,
   `editor_norm`, `place_norm`, `printer_norm`, `publisher_norm`, `shelf_mark_norm`)
   cannot be inserted into — Postgres rejects any INSERT naming them. A naive
   "read the JSON and upsert it" loop dies on row one. They are dropped before
   writing and the database recomputes them; verified all 29,879 restored rows had
   `search_norm` rebuilt *identically to live*.
2. **Schema discovery by sampling a row fails on an empty table** — which is exactly
   the restore case. The first version of the script learned its column list by
   reading one existing row, worked fine in rehearsal, and failed on the first real
   drill. The column list is now static, with the write loop parsing Postgres's own
   error to drop anything unexpected.
3. **`CREATE TABLE … (LIKE … INCLUDING CONSTRAINTS)` does not copy the primary key** —
   that needs `INCLUDING INDEXES` (or `INCLUDING ALL`). Without a PK there is nothing
   for the upsert to conflict on and the restore cannot proceed. **If you ever
   recreate `bph_works` from scratch, restore its indexes before restoring its rows.**

Result: 29,879/29,879 rows restored in ~3m30s; a field-by-field comparison against
live differed on exactly 7 rows, in `sl_book_id`/`sl_book_slug` only — written by the
6-hourly `sync-bph-sl-book-ids` cron in the hours after the snapshot. Correct drift,
not restore error.

## Backup integrity

`scripts/workers/backup-bph-catalog.sh` (04:00 daily, Hetzner cron):

- Dumps to a **staging directory and swaps only on success.** It used to `rm -rf` the
  latest snapshot *before* dumping, so a failure destroyed the last good local copy.
- **Refuses to publish a collapsed snapshot** — under 1,000 rows, or a >10% drop
  against the previous manifest. An export that "succeeds" with zero rows (revoked
  key, silent API change) would otherwise overwrite the good copy with an empty one
  and then propagate through the retention chain.
- **Pushes to `ntfy.sh/sourcelibrary-uptime` on failure.** Previously it only wrote
  `ERROR:` to a log file that nothing monitored, which is the failure mode described
  in CLAUDE.md: an alarm nobody reads is not an instrument.

## Re-drill periodically

The point of a drill is that it decays. Re-run steps 1–3 above (scratch table, then
drop it) after any schema change to `bph_works`, and at least a couple of times a
year. It costs about five minutes and is the only thing that distinguishes a backup
from a hope.
