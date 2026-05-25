# BPH Memorix Final Sync — Apply Log (2026-05-25)

**What this is:** the operational record of applying the BPH Memorix final sync to production. After this lands, Source Library's `bph_works` table becomes the authoritative catalog of record for the BPH (Bibliotheca Philosophica Hermetica) at the Embassy of the Free Mind. Memorix is no longer the upstream source.

**Why it matters:** this is the institutional handover of a partner organization's catalog. Years of librarian work, provenance notes, and ~28k catalog records move under our care. There is no "previous database" to roll back to once Memorix is decommissioned. Every step here needs a provenance record so future audits can reconstruct exactly what changed, when, and why.

**Operator:** Claude Opus 4.7 driving, Derek (j.d.lomas@tudelft.nl) reviewing.

**Code:** PR #1975, branch `worktree-bph-memorix-sync`.

**Plan reference:** `.claude/docs/bph-memorix-alignment-2026-05-19.md` (decision log + per-row diff).

**Tracker:** issue #1881 (epic), #1878 (parent — Source Library as BPH catalogue of record).

---

## Provenance model — two layers

1. **Per-row database provenance**: Step 3's field updates (~105 rows) each write a `bph_works_revisions` row with `editor_email='system:bph-memorix-final-sync-2026-05-19'` and `change_type='edit'`. Future audits can reconstruct exactly which columns this sync touched on which UBNs:

   ```sql
   SELECT ubn, applied_at, field_changes
   FROM bph_works_revisions
   WHERE editor_email = 'system:bph-memorix-final-sync-2026-05-19'
   ORDER BY applied_at;
   ```

2. **Per-step operational log** (this file): timestamped counts, retries, anomalies, verification spot-checks. Update this file as each step lands.

Steps 2/4/5/6/7/8 do **not** write per-row revisions because:
- Step 2 only writes internal `memorix_*` columns (not librarian-visible)
- Steps 4/5/6 insert brand-new rows (no prior value to revise)
- Step 7 sets `cross_listed_with_uuid` on 4 rows (low-value to log)
- Step 8 deletes 3 rows (the act of deletion is the record)

Their provenance lives entirely in this handoff doc + the Step 0 backup.

---

## Pre-flight baseline (captured 2026-05-25, before any step)

Query: `curl ...rest/v1/bph_works?select=id -H "Prefer: count=exact"`

| Metric | Value |
|---|---|
| Total `bph_works` rows | 27,808 |
| `uuid IS NULL` (Allard-Pierson + 1 null-UBN orphan) | 103 |
| `uuid IS NOT NULL` | 27,705 |
| `sl_book_id IS NOT NULL` (live SL book links — must NOT break) | 2,247 |
| `ubn IS NULL` (Step 8 orphan target) | 1 |
| UBN 12507 + 12204 (Step 8 named targets) | present, both `sl_book_id=null` |

No drift since the 2026-05-19 Memorix snapshot. Safe to proceed.

---

## Step 1 — SQL schema migration (applied 2026-05-25 via Supabase dashboard)

**File:** `scripts/migration/bph-memorix-final-sync.sql` (174 lines, idempotent).

**Applied by:** Derek, via Supabase SQL editor.

**Adds to `bph_works`:**
- `record_type bph_record_type` ENUM (`printed | manuscript | photocopy`), default `printed`
- `memorix_raw JSONB`, `memorix_files JSONB`, `memorix_modified_time TIMESTAMPTZ`
- `memorix_file_count INT`, `memorix_total_file_bytes BIGINT`
- `cross_listed_with_uuid UUID`
- 14 manuscript-specific columns: `full_title, script, scribe, iconography, compiler, contents, physical_description, characterization, origin, icn_registration_number, illumination_illustration, edition_note, statement_of_responsibility, ms_date`
- 4 photocopy-specific columns: `journal_title, volume_number, pagination, annotation`
- Indexes on `record_type`, partial on `cross_listed_with_uuid`, GIN on `memorix_raw`

**New table:** `bph_work_files` (per-file inventory; populated by future Step 9 once Picturae sends the scans XML). RLS enabled with policies matching `bph_works_revisions`: service-role full access, anon/authenticated SELECT-only.

**Verification:** all 25 new columns return 200 on `?select=...&limit=1`; existing rows default to `record_type='printed'`.

---

## Step 0 — Backup (applied 2026-05-25 11:21:33 UTC)

**Output:** `backups/bph_works-pre-memorix-sync-2026-05-25T11-21-33-738Z.jsonl.gz` (11 MB, 27,808 rows, 18 s wall time).

**Status:** local file written. **TODO Derek:** upload to R2 `bph-backups/`.

**Recovery path:** if any subsequent step corrupts data, restore from this file via `gunzip -c <file> | jq -c | curl ...rest/v1/bph_works -X POST -H "Prefer: resolution=merge-duplicates,return=minimal"`.

---

## Step 2 — Backfill `memorix_raw` / files / counters for in-both printed rows (applied 2026-05-25)

**Target:** all 27,703 `bph_works` rows where `record_type='printed' AND uuid IS NOT NULL AND uuid` appears in the 2026-05-19 printed XML (`derek9_*.xml`).

**Writes only these columns:** `memorix_raw` (JSONB of every XML field), `memorix_files` (JSONB of `<files>` block), `memorix_modified_time`, `memorix_file_count`, `memorix_total_file_bytes`.

**Does not touch:** any librarian-relevant column (`title`, `author`, `year`, `shelf_mark`, etc.) or any of our enrichments (`sl_book_id`, `ia_*`, `*_norm`, `field_provenance`, etc.).

### Run history

| Attempt | Start | End | Method | Rows attempted | Rows landed | Outcome |
|---|---|---|---|---|---|---|
| 1 | 2026-05-25 11:23 UTC | ~11:30 | per-row PATCH | 27,703 | 6,712 | died at ~6,600 with `TypeError: fetch failed` (no retry) |
| 2 | 2026-05-25 ~12:55 UTC | ~13:00 | per-row PATCH + retry | 20,991 | 7,325 (cumulative 14,037) | died at ~7,200; all 3 retries failed instantly — systematic ~7k threshold, not transient |
| 3 | 2026-05-25 13:08 UTC | 13:09 | **bulk upsert** (500-row POST batches with `Prefer: resolution=merge-duplicates`) | 13,666 | 13,666 | clean completion, zero retries |

### Why bulk upsert was the architectural fix

The failure at ~7k requests in two consecutive runs was systematic, not transient. Suspect: Supabase/Cloudflare per-IP request budget or Node's fetch keep-alive pool entering a degraded state after sustained per-row load. Bulk upsert via `POST /bph_works` with `Prefer: resolution=merge-duplicates` collapses ~27k sequential PATCHes into ~28 batched POSTs, well under any plausible threshold. Conflict resolution by PK (`id`); pre-validation against the existing `id` set ensures we never accidentally INSERT a half-row.

### Final state

| Metric | Expected | Observed |
|---|---|---|
| Rows with `memorix_raw IS NOT NULL` | 27,703 | **27,703 ✓** |
| Rows where `record_type='printed' AND uuid NOT NULL AND memorix_raw IS NULL` | 2 (the Step 8 delete targets, not in XML) | **2 ✓** |
| `sl_book_id` count (must equal pre-flight) | 2,247 | **2,247 ✓** (integrity preserved) |
| Total `bph_works` count | 27,808 (unchanged) | **27,808 ✓** |

### Spot check — UBN 11557 (Paracelsus, *De praesagiis* 1569, 134 scans)

| Field | DB after Step 2 | Source XML | Match |
|---|---|---|---|
| uuid | `004a0cdf-5f6f-…` | `004a0cdf-5f6f-…` | ✓ |
| title (librarian-relevant) | "De praesagiis, vatiticinijs [!] et divinationibus…" | (same) | ✓ unchanged |
| author | "Paracelsus, Theophrastus" | (same) | ✓ unchanged |
| memorix_file_count | 134 | 134 | ✓ |
| memorix_total_file_bytes | 20,394,466 | 20,394,466 | ✓ |
| memorix_modified_time | `2021-11-03T14:07:59.079Z` | `2021-11-03 14:07:59.079457` | ✓ (ISO-normalized) |
| memorix_raw field count | 43 | 43 | ✓ |
| memorix_files first entry | `{uuid, name: "RIT001001125_0005", filesize: 150378, mimetype: "image/jp2"}` | same | ✓ |

---

## Step 3 — Field updates (NOT YET APPLIED)

**Target:** ≤ 105 rows where the 2026-05-19 Memorix XML differs from current DB on at least one of the 36 mapped columns. Per-row distinct payloads.

**Librarian-edit guard:** before applying, queries `bph_works_revisions` for every target UBN with `applied_at >= 2026-05-19T10:23:00Z`. Any column edited by a librarian since the Memorix snapshot is dropped from this run's diff, preserving the librarian's value. Dry-run at 2026-05-25 reports: zero conflicts (no librarian edits on the 105 target UBNs since the snapshot).

**Audit trail:** every applied update writes a `bph_works_revisions` row with `editor_email='system:bph-memorix-final-sync-2026-05-19'`, `change_type='edit'`, and full `field_changes` JSONB.

**Dry-run summary (2026-05-25):**

| Column | Count | Plan expected |
|---|---|---|
| year_raw | 45 | 45 ✓ |
| number_of_copies | 27 | 27 ✓ |
| internal_remarks | 11 | 11 ✓ |
| place | 6 | 6 ✓ |
| shelf_mark | 6 | 6 ✓ |
| publisher | 5 | 5 ✓ |
| remarks | 5 | — |
| printer | 4 | — |
| present_location | 4 | — |
| work_status | 4 | — |
| year | 3 | (derived from year_raw) |
| author | 3 | 3 ✓ |
| language | 2 | 2 ✓ |
| series_title | 2 | — |
| keywords | 2 | 2 ✓ |
| editor | 2 | — |
| bibliography | 1 | — |
| provenance | 1 | — |
| bound_with | 1 | — |
| acquisition_date | 1 | — |
| acquisition_source | 1 | — |
| price | 1 | — |
| variant_author | 1 | — |
| title | 1 | — |
| **Total rows touched** | **105** | **~105** ✓ |

(Plan enumerated only the top categories; the per-column tally above is the precise breakdown.)

---

## Step 4 — Insert 467 new printed rows (NOT YET APPLIED)

…(reserved for post-apply)

## Step 5 — Insert 812 manuscript rows (NOT YET APPLIED)

…(reserved)

## Step 6 — Insert 959 photocopy rows (NOT YET APPLIED)

…(reserved)

## Step 7 — Set sammelband cross-listings (NOT YET APPLIED)

…(reserved)

## Step 8 — Delete 3 truly-removed rows (NOT YET APPLIED)

…(reserved)

---

## Anomalies and one-off decisions

- **103 NULL-uuid rows vs the plan's 102:** the +1 is the null-UBN/null-uuid orphan (Step 8 delete target #3). The plan counted 102 Allard-Pierson PH-synthesized rows separately; the orphan was tracked as a delete, not as part of the 102 keep-set. Math is consistent.
- **2 rows with `record_type='printed' AND uuid NOT NULL AND memorix_raw IS NULL` after Step 2:** these are UBN 12507 and 12204 — they exist in our DB but are not present in the 2026-05-19 Memorix XML (i.e., upstream considers them deleted). Step 8 deletes them.
- **The DCO bot is blocking PR #1975** because the early commits used `git commit -m` instead of `-s`. To be fixed via `git rebase --signoff` on `worktree-bph-memorix-sync` once the migration is complete.

---

## Memorix decommissioning (after Step 8 lands)

Files to add a deprecation header note:
- `scripts/migration/import-bph-catalog.mjs` — original XML import path
- `scripts/migration/enrich-bph-from-csv.mjs` — ScannedBooks.csv enrichment

The authoritative ingestion script going forward is `scripts/migration/bph-memorix-final-sync.mjs`. Step 9 (scans XML → `bph_work_files`) will be a follow-up PR once Picturae delivers the scans XML.
