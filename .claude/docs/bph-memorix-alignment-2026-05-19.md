# BPH Memorix XML ↔ `bph_works` alignment plan (2026-05-19)

**Status:** DRY-RUN PLAN — no schema changes or data writes applied yet. User has approved the strategy below; awaiting one final review before apply.

**Source:** `~/Downloads/Archive 2.zip` (Memorix export, response date 2026-05-19T10:23Z) — this is the **final** Memorix sync. After this, Memorix is no longer the upstream source; `bph_works` becomes authoritative.

**Tenant:** `rit` (Ritman Library)

## What's in scope

Three Memorix exports become the authoritative BPH catalog snapshot:

| Memorix export | XML records | Goes into | Notes |
|---|---|---|---|
| Bibliotheca Philosophica Hermetica (`derek9`) | 28,170 | `bph_works` rows with `record_type='printed'` | Existing 27,703 stay (105 will get field updates); 467 new; 3 removed |
| Handschriften (`derek10`) | 812 | `bph_works` rows with `record_type='manuscript'` | All net new; only catalog rows — no SL Mongo books until scans arrive |
| Fotocopieen (`derek 3`) | 959 | `bph_works` rows with `record_type='photocopy'` | Photocopy / article reference cards; provisionally added, may be removed later |

**Join key:** Memorix `record.uuid` ↔ `bph_works.uuid`. 100% stable for printed (27,703/28,170 match in current data; the rest are net-new).

## Decisions (approved by user)

| Question | Decision |
|---|---|
| 3 rows only in DB, no `sl_book_id` (UBN 12507, 12204, null) | **Delete** from `bph_works` (appear deleted upstream) |
| 102 PH/BPH synthesized Allard-Pierson rows (NULL uuid) | **Keep** as-is; scope all upserts with `WHERE uuid IS NOT NULL` |
| Fotocopieen | **Import** with `record_type='photocopy'` (may retire later) |
| 105 changed printed rows | **Apply all 105 updates** via uuid upsert |
| 2 sammelband cross-listings (RIT001000026, RIT001000028) | Import both records (printed + manuscript), link via new `cross_listed_with_uuid` column |
| Schema | Single `bph_works` table; new `record_type` ENUM + JSONB `memorix_raw` for full XML preservation + promoted columns for type-specific display fields |
| `memorix_raw` JSONB backfill | **All** rows (existing 27,703 + 467 new + 812 + 959), so ALL fields from XML are preserved everywhere |
| Column naming for new columns | English style, matching existing `bph_works` columns |

## Schema migration (SQL)

File: `scripts/migration/bph-memorix-final-sync.sql`

```sql
BEGIN;

-- 1. record_type discriminator (existing rows default to 'printed')
CREATE TYPE bph_record_type AS ENUM ('printed', 'manuscript', 'photocopy');
ALTER TABLE bph_works
  ADD COLUMN record_type bph_record_type NOT NULL DEFAULT 'printed';

-- 2. Full XML preservation (every Memorix field, lossless)
ALTER TABLE bph_works
  ADD COLUMN memorix_raw JSONB,
  ADD COLUMN memorix_files JSONB,  -- list of {uuid, name, filesize, mimetype} from <files>
  ADD COLUMN memorix_modified_time TIMESTAMPTZ;

-- 3. Sammelband cross-listing (same physical scan, dual catalogued)
ALTER TABLE bph_works
  ADD COLUMN cross_listed_with_uuid UUID;

-- 4. Manuscript-specific promoted columns (Handschriften)
ALTER TABLE bph_works
  ADD COLUMN full_title TEXT,
  ADD COLUMN script TEXT,
  ADD COLUMN scribe TEXT,
  ADD COLUMN iconography TEXT,
  ADD COLUMN compiler TEXT,
  ADD COLUMN contents TEXT,
  ADD COLUMN physical_description TEXT,
  ADD COLUMN characterization TEXT,
  ADD COLUMN origin TEXT,
  ADD COLUMN icn_registration_number TEXT,
  ADD COLUMN illumination_illustration TEXT,
  ADD COLUMN edition_note TEXT,
  ADD COLUMN statement_of_responsibility TEXT,
  ADD COLUMN ms_date TEXT;  -- raw "date" field from MSS export, e.g. "17th century; ca. 1650-1654"

-- 5. Photocopy / journal-article columns (Fotocopieen)
ALTER TABLE bph_works
  ADD COLUMN journal_title TEXT,
  ADD COLUMN volume_number TEXT,
  ADD COLUMN pagination TEXT,
  ADD COLUMN annotation TEXT;

-- 6. Indexes
CREATE INDEX idx_bph_works_record_type ON bph_works(record_type);
CREATE INDEX idx_bph_works_cross_listed_with ON bph_works(cross_listed_with_uuid)
  WHERE cross_listed_with_uuid IS NOT NULL;
CREATE INDEX idx_bph_works_memorix_raw_gin ON bph_works USING GIN (memorix_raw);

COMMIT;
```

Notes:
- ENUM default `'printed'` means every existing row classifies correctly without an UPDATE.
- All ADD COLUMN operations are nullable, safe to apply online (PostgreSQL doesn't rewrite the table for nullable additions).
- The GIN index lets us query "find all records with iconography matching X" via JSONB without promoting every field.

## Data migration sequence

File: `scripts/migration/bph-memorix-final-sync.mjs` (will be written next)

Each step is a separate function with a `--dry-run` flag that reports counts without writing. The user runs each step manually after reviewing the dry-run report.

| Step | What | Affected rows | Reversible? |
|---|---|---|---|
| 1 | Backfill `memorix_raw` + `memorix_files` for existing 27,703 in-both printed rows | 27,703 | Yes (column ADD/DROP) |
| 2 | Apply 105 field updates (year_raw, place, shelf_mark, etc.) | 105 | Backup before, diff-driven |
| 3 | Insert 467 new printed rows (record_type='printed') | 467 | Delete by uuid |
| 4 | Insert 812 manuscript rows (record_type='manuscript') | 812 | Delete by uuid |
| 5 | Insert 959 photocopy rows (record_type='photocopy') | 959 | Delete by uuid |
| 6 | Set `cross_listed_with_uuid` on the 2 sammelband pairs | 4 rows touched | Set back to NULL |
| 7 | Delete 3 truly-removed rows (UBN 12507, 12204, null) | 3 | Restore from backup |

**Pre-flight checks before any step:**
- `pg_dump` snapshot of `bph_works` to R2 — recoverable backup
- Verify row count: expect ~27,808 → expect ~29,941 after import (≈ +2,133)
- Verify `sl_book_id` count unchanged on existing rows (we never touch SL enrichments)

## Field updates (the 105)

Full list in `.claude/docs/bph-memorix-alignment-2026-05-19.json`. Highest-impact categories:
- `year_raw` (45): date refinements like UBN 23380 `[ca. 1660]` → `[ca 1581]`
- `number_of_copies` (27): multiple-copy notes
- `internal_remarks` (11), `place` (6), `shelf_mark` (6), `publisher` (5)
- `author` (3): spelling fixes ("Catharine" → "Catharina", etc.)
- `language` (2), `keywords` (2): terminology fixes

All upstream librarian improvements. None destructive.

## The 2 sammelbände

Same physical volume catalogued at BPH twice (printed + manuscript), sharing the same 180/177 jp2 scans.

| Barcode | Printed (existing in DB) | Manuscript (to insert) | SL book |
|---|---|---|---|
| RIT001000026 | UBN 199 "Augen-Spiegel" (1713), uuid `25974bc9…` | Guido de Monte Rochen + Suso codex, uuid `8aa695c2…` | `6970e35b9b09d309d780a256` (links to printed only) |
| RIT001000028 | UBN 207 "Aglais" (1787), uuid `2a1ceb4c…` | Otto von Passau (14th c), uuid `8cc9a6c1…` | `6970e35c9b09d309d780a25a` (links to printed only) |

After migration: each side has `cross_listed_with_uuid` pointing to the other. Catalog detail page can render "This volume also catalogued as: [manuscript/printed link]". SL Mongo book remains exclusively linked to the printed record.

## Product impact (post-migration)

| Surface | Change |
|---|---|
| `/api/catalog/bph` route | Add `record_type` filter; include manuscript-specific fields in response |
| `BphUnifiedCatalogue.tsx` (grid + list view) | Show manuscript / photocopy badge; type-aware filter |
| Catalog detail page | Type-specific template (manuscripts show script/scribe/contents/etc.) |
| `/api/cron/sync-bph-sl-book-ids` | No change — still UBN-keyed |
| Tenant subdomain `bph.sourcelibrary.org` digitised filter | No change — still keyed on `sl_book_id IS NOT NULL` |
| Search | Manuscript-specific text fields should be added to `search_tsv` regeneration |

## Decommissioning Memorix

Final sync after this — no live process pulls from Memorix.

Files to mark deprecated (one-line header note):
- `scripts/migration/import-bph-catalog.mjs` — initial XML import path
- `scripts/migration/enrich-bph-from-csv.mjs` — ScannedBooks.csv enrichment

The new authoritative ingestion script is `scripts/migration/bph-memorix-final-sync.mjs`.

## Files

- This plan: `.claude/docs/bph-memorix-alignment-2026-05-19.md`
- Raw diff data: `.claude/docs/bph-memorix-alignment-2026-05-19.json`
- Source XML: `/tmp/bph-xml/` — should be moved to `data/bph-memorix/2026-05-19/` (gitignored on-disk archive)
- Schema migration: `scripts/migration/bph-memorix-final-sync.sql` (next)
- Sync script: `scripts/migration/bph-memorix-final-sync.mjs` (next)
- Analysis scripts (temporary, will clean up): `scripts/_tmp-bph-align-diff.mjs`, `scripts/_tmp-bph-field-diff.mjs`, `scripts/_tmp-bph-onlydb-and-dups.mjs`, `scripts/_tmp-collision-detail.mjs`, `scripts/_tmp-collision-files.mjs`, `scripts/_tmp-mss-bph-overlap.mjs`
