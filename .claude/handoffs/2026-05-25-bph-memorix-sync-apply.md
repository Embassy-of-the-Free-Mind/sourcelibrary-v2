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

## Step 3 — Field updates (applied 2026-05-25 13:49–13:50 UTC)

**Target:** 105 rows where the 2026-05-19 Memorix XML differs from current DB on at least one of the 36 mapped columns. Per-row distinct payloads.

**Librarian-edit guard:** queried `bph_works_revisions` for every target UBN with `applied_at >= 2026-05-19T10:23:00Z`. Result: **zero conflicts** — no librarian had edited any of the 105 target UBNs since the Memorix snapshot. No diff columns were dropped.

**Audit trail:** every applied update wrote a `bph_works_revisions` row with `editor_email='system:bph-memorix-final-sync-2026-05-19'`, `change_type='edit'`, and `field_changes` JSONB capturing every (column, to-value, source) triple.

**Per-column tally (matches plan exactly where plan enumerated):**

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

**Wall time:** 64 s for 210 API calls (105 PATCH + 105 INSERT), no retries.

**Spot check — UBN 23380 (the Plantin Press fix from the plan):**

| Field | Pre-Step 3 (from .jsonl.gz backup) | Post-Step 3 (DB) |
|---|---|---|
| year_raw | `[ca. 1660]` (incorrect upstream value) | `[ca 1581]` ✓ |
| year | (was null) | `1581` ✓ (derived from year_raw) |
| printer | (null) | `[Plantin, Christophe]` ✓ |
| place | (null) | `[Antwerp]` ✓ |
| internal_remarks | (null) | `bij JRR` (← Joost R. Ritman) ✓ |
| bibliography | (null) | `Voet, Plantin Press 627` ✓ |

The bph_works_revisions row for UBN 23380 captured all 7 changes (printer, publisher, place, year_raw, year, internal_remarks, bibliography) with `source='memorix-2026-05-19'`.

**Verification queries:**

```sql
-- All revisions written by this sync (expect 105)
SELECT COUNT(*) FROM bph_works_revisions
WHERE editor_email = 'system:bph-memorix-final-sync-2026-05-19';

-- Per-column change tally (matches the table above)
SELECT jsonb_object_keys(field_changes) AS col, COUNT(*) AS n
FROM bph_works_revisions
WHERE editor_email = 'system:bph-memorix-final-sync-2026-05-19'
GROUP BY 1 ORDER BY n DESC;

-- Sample a specific revision in detail
SELECT ubn, applied_at, field_changes
FROM bph_works_revisions
WHERE editor_email = 'system:bph-memorix-final-sync-2026-05-19'
  AND ubn = '23380';
```

### Known provenance gap — `from: null` in field_changes

The script wrote `field_changes[col].from = null` for every entry instead of the pre-update DB value. The revisions table therefore captures **what Memorix set** but not **what was there before**. The pre-state for those 105 rows is recoverable from the Step 0 backup file (`backups/bph_works-pre-memorix-sync-2026-05-25T11-21-33-738Z.jsonl.gz`) but it's not co-located with the "to" values.

To reconstruct full before-and-after for a UBN that this sync touched:

```bash
# Pre-state from the backup
gunzip -c backups/bph_works-pre-memorix-sync-2026-05-25T11-21-33-738Z.jsonl.gz \
  | jq 'select(.ubn=="23380") | {ubn, year_raw, year, printer, place, internal_remarks, bibliography}'

# Post-state from DB + change set from revisions table
psql -c "SELECT field_changes FROM bph_works_revisions WHERE ubn='23380' AND editor_email='system:bph-memorix-final-sync-2026-05-19'"
```

The code fix (capture `from: db[col]` instead of `from: null`) is a one-line change in `step3_fieldUpdates`. The 105 already-written rows can't be patched because `bph_works_revisions` is append-only by design. Left as-is for this migration since the backup file makes pre-state recoverable; will fix the code for any future re-use of this script.

---

## Order applied — not 4→8

The original plan assumed Steps run in numeric order. Reality: Step 4 hit a UBN-collision class the plan didn't enumerate (see Step 4 notes), so we ran in this order: **0 → 2 → 3 → 8 → 4 → 5 → 6 → 7**. Each is independent except 7 (needs 5 for the manuscript side to exist) and the special case that 8 frees UBN 12204 for Step 4 to insert the new record under that UBN cleanly.

## Step 8 — Delete 3 truly-removed rows (applied 2026-05-25 ~16:35 UTC)

**Targets:** UBN 12507, UBN 12204, and the null-UBN orphan. All three had `sl_book_id IS NULL` (no live SL book link), confirmed in pre-flight.

**Visual confirmation of the null-UBN orphan before delete:**

```json
{
  "id": "45d593ab-0446-3589-c5ce-d9e5b6ad2f1f",
  "uuid": null,
  "ubn": null,
  "picturae_barcode": null,
  "title": "Tussen heks en heilige. Het vrouwbeeld op de drempel van de moderne tijd, 15de/16de eeuw",
  "author": "Bange, Petty | Brandenbarg, Ton | Dresen, Grietje | Dresen-Coenders, Lène | Muller, Ellen | Noël, Jeanne Marie | Pigeaud, Renée",
  "year_raw": "1985",
  "sl_book_id": null,
  "memorix_raw": null,
  "created_at": "2025-12-07T09:46:56.321643+00:00"
}
```

A 1985 academic anthology on 15-16th c. women's roles. No UUID, no UBN, no barcode, no scan, no Memorix backfill from Step 2 (confirms absence from XML). An orphaned record from a prior data load. Recoverable from the Step 0 backup if ever needed.

**Side effect:** deleting UBN 12204 (uuid `b58aa3ad…`) freed the UBN for the Memorix record with new uuid `6e80cbce…` — which then inserted cleanly in Step 4.

**Final state:** 27,805 rows (was 27,808). No FK errors from `bph_works_revisions` because none of the 3 deleted rows had any revisions logged.

## Step 4 — Insert new printed rows (applied 2026-05-25 ~16:47 UTC)

**Plan said:** 467 new printed rows.
**Actually inserted:** **300** rows.
**Skipped (UBN collision):** 167 rows, logged in `.claude/docs/bph-memorix-step4-ubn-collisions-2026-05-19.json`.

### The plan didn't enumerate this case

Memorix's XML itself contains **163 duplicate UBNs** — the same UBN appears under two different UUIDs. Their model treats UUID as the PK and UBN as a label; ours has `UNIQUE(ubn)` on `bph_works` (required by the FK from `bph_works_revisions.ubn`). So 168 of the 467 "new in XML" records would have hit a unique-constraint violation on insert.

Investigation:
- 167 of the 168 colliding cases: the old DB UUID is still alive in Memorix under a *different* UBN — Memorix has effectively split or duplicated these records upstream.
- 1 case (UBN 12204): the old DB UUID is abandoned by Memorix entirely; this was already in our Step 8 delete list. Running Step 8 first freed UBN 12204, letting Step 4 pick up the new uuid `6e80cbce…` under that UBN.

### Decision

Per user direction: **skip the 168 collisions, insert only the 299 truly-new** (now 300 after Step 8 freed UBN 12204). The colliding records stay in our DB as the existing row (same UBN, our old UUID). The skipped 167 are logged in full for later manual reconciliation — librarians can decide per-record whether to merge, replace, or leave them split.

Tradeoffs:
- ✓ No data corruption from forcing inserts past the unique constraint.
- ✓ No loss of existing librarian-relevant data (we never overwrite our `sl_book_id`, `ia_*`, `*_norm` etc. anyway).
- ✗ 167 Memorix records aren't in our catalog (yet) — recoverable from the JSON log when triaged.

### Final state

| Metric | Value |
|---|---|
| Rows inserted | 300 |
| Total `bph_works` | 28,105 (was 27,805) |
| `sl_book_id` count | 2,247 (unchanged) |
| `record_type='printed'` | 28,105 |
| UBN 12204 verification | `{"uuid":"6e80cbce-…","ubn":"12204","title":"Renati des Cartes principiorum philosophiae"}` (new Memorix record now linked to UBN 12204) |

### How to re-import the 167 later

The JSON log has every skipped record's XML UUID, UBN, title, and the conflicting DB UUID. Once a triage decision exists per UBN, options are:

- **Merge:** `UPDATE bph_works SET uuid = '<new>' WHERE uuid = '<old>'` (replaces old with new, keeps existing UBN row).
- **Replace:** delete the old DB row first, then run `--step 4` again (the collision will be gone, the new record gets inserted).
- **Split (schema change):** drop the `UNIQUE(ubn)` constraint and accept duplicate UBNs in our model. Would need a corresponding `bph_works_revisions` FK rework.

## Step 5 — Insert 812 manuscript rows (applied 2026-05-25 ~16:48 UTC)

**Rows inserted:** 812. **Wall time:** 24 s. **Method:** bulk POST (5 batches of 200). **Zero retries.**

All 812 inserted with `record_type='manuscript'` and `ubn=null` (Memorix Handschriften records don't have UBNs assigned — that's slated for #1878 Phase 3 once we build the UBN minting flow).

Sample rows:
- `M 362` — uuid `0024efc6…`, no full_title (untitled bequest item)
- `T 5` — uuid `01163e58…`, full_title "Het evangelie van de heilige twaalven"
- `M 276` — uuid `021a09c0…`

Counts: total `bph_works` = 28,917; `record_type='manuscript'` = 812.

## Step 6 — Insert 959 photocopy rows (applied 2026-05-25 ~16:50 UTC)

**Rows inserted:** 959. **Wall time:** 14 s. **Method:** bulk POST (5 batches of 200). **Zero retries.**

All 959 inserted with `record_type='photocopy'` and `ubn=null` (same rationale as manuscripts).

Sample rows:
- `[Buch der Heiligen Dreifaltigkeit]` — alchemy treatise photocopy
- `Allgemeine Reformation der gantzen Welt` — Rosicrucian fragment
- `The Rose Croix` in journal `Freemasonry today` — example of populated `journal_title` and source attribution

Counts: total `bph_works` = 29,876; `record_type='photocopy'` = 959.

## Step 7 — Sammelband cross-listings (applied 2026-05-25 ~16:51 UTC)

**Updates:** 4 (the 2 sammelband pairs × 2 directions each).

| Barcode | Printed side | Manuscript side |
|---|---|---|
| RIT001000026 | UBN 199 — "Der äussere und innere güldene Augen-Spiegel" (1713) | "Reverendo in Christo[?] patri ac domino domino Ray…" (Guido de Monte Rochen + Suso codex) |
| RIT001000028 | UBN 207 — "Aglais" (1787) | "Sanctus Johannes ewangelista sach" (Otto von Passau, 14th c) |

`cross_listed_with_uuid` is set bidirectionally on each pair so catalog detail can render "This volume also catalogued as: [other side link]". The printed side retains the `sl_book_id` link (the manuscript records have none).

---

## Final post-flight (2026-05-25 ~16:51 UTC)

| Metric | Plan | Actual | Notes |
|---|---|---|---|
| Total `bph_works` | ~29,941 | **29,876** | -65 from 167 skipped UBN collisions (+UBN 12204 picked up = -167+1 from 467 → 300 inserted in Step 4) |
| `record_type='printed'` | ~28,167 | **28,105** | -62 net (same reason) |
| `record_type='manuscript'` | 812 | **812** | ✓ exact |
| `record_type='photocopy'` | 959 | **959** | ✓ exact |
| `cross_listed_with_uuid NOT NULL` | 4 | **4** | ✓ exact |
| `uuid IS NULL` (Allard-Pierson) | 102 | **102** | ✓ untouched throughout |
| `sl_book_id NOT NULL` (live SL links) | 2,247 (= pre-flight) | **2,247** | ✓ **zero broken** |
| `memorix_raw NOT NULL` | 29,774 (= total − 102 AP) | **29,774** | ✓ exact |
| Step 3 revisions logged | 105 | **105** | ✓ exact |

**Memorix is now decommissioned as the authoritative source for the BPH catalog.** Source Library's `bph_works` table holds the system of record.

## Outstanding follow-ups

1. **Upload Step 0 backup to R2** — `aws s3 cp backups/bph_works-pre-memorix-sync-2026-05-25T11-21-33-738Z.jsonl.gz s3://bph-backups/` (or wrangler r2 equivalent).
2. **Triage the 167 UBN-collision records** in `.claude/docs/bph-memorix-step4-ubn-collisions-2026-05-19.json` — librarian decision required per UBN.
3. **Mark legacy import scripts deprecated** with header notes:
   - `scripts/migration/import-bph-catalog.mjs`
   - `scripts/migration/enrich-bph-from-csv.mjs`
4. **Step 9 (scans XML → `bph_work_files`)** — separate follow-up PR once Picturae delivers the scans XML.
5. **DCO sign-off rebase** on `worktree-bph-memorix-sync` so PR #1975 can merge.
6. **Convert PR #1975 from draft → ready for review.**
7. **Fix the `from: null` provenance gap** in step3_fieldUpdates for any future re-use (one-line change).

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
