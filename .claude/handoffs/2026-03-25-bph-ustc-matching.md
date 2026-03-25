# BPH→USTC Matching & Catalog Scanner — Handoff 2026-03-25

## Goal

Answer: "What in the BPH collection has never been digitized?" Build toward a reusable tool that takes any library's catalog and identifies which items have never been digitized (GitHub issue #361).

## Final Results

**BPH 1450-1700, all languages:**

| | Count | % of 4,099 |
|---|---|---|
| **Matched to USTC** | **3,242** | **79.1%** |
| **Digitized elsewhere** | **1,619** | **39.5%** |
| **Unique to BPH** | **2,480** | **60.5%** |
| Unmatched to USTC | 861 | 21.0% |

**Digitization providers with BPH overlap:**
BSB 751, Gallica 238, e-rara 208, IA 178, SLUB 116, SBB 59, Göttingen 55, Heidelberg 14

**Matches written to Supabase:** `bph_works.ustc_sn` column (3,244 rows populated).

### Matching passes

| Pass | Works processed | New matches | Total | Method |
|---|---|---|---|---|
| v4 (Latin only) | 2,531 | 717 | 717 | surname+year → title overlap → Gemini YES/NO |
| v5 (Latin unmatched) | 1,814 | 262 | 979 | + bracket stripping, Gemini author name resolution |
| All-languages | 3,120 | 748 | 1,727 | v5 approach on all languages |
| v6 (timeout fix) | 2,372 | 743 | 2,470 | + exact-match queries, retry on timeout, Gemini USTC name forms |
| v6 resweep | 1,629 | 59 | 2,529 | Same as v6, after trigram index was live |
| **v7 (English titles)** | **1,208** | **713** | **3,242** | **Gemini translates BPH title → search ustc_enrichments.english_title** |

## Bugs Found & Fixed

### 1. USTC SN vs row ID (critical)
`build.mjs` stored Supabase auto-increment `id` as `ustc_id` instead of USTC serial number `sn`. Caused all cross-references to point at wrong editions. Fixed `ustc_id: edition.id` → `ustc_id: edition.sn`, rebuilt catalog_coverage.

### 2. Stale `has_scan` field
`catalog_coverage` had both `has_scan` (old) and `has_iiif_scan` (current) with contradictory values. Removed `has_scan` from 1.56M docs, cleaned up TypeScript types.

### 3. Author matching gaps
`extractSurname("Agrippa von Nettesheim")` → `"agrippa von nettesheim"` didn't match USTC's `"agrippa"`. Added first-word indexing + entity_aliases integration. Scan detection nearly doubled (325K → 548K).

### 4. Supabase `ilike` timeouts (critical, discovered this session)
`ilike` on 1.6M rows in `ustc_editions` times out intermittently (~3s Supabase statement timeout). The matching scripts had `catch { return []; }` which **silently treated timeouts as "no candidates found"**. This caused ~500+ false negatives in earlier runs.

**Fix:** Added `pg_trgm` GIN trigram index on `author_1`:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_ustc_author1_trgm ON ustc_editions USING GIN (author_1 gin_trgm_ops);
```
Performance: `ilike` queries went from 3s+ timeouts to **67-178ms**. Zero timeouts after index was created.

## Supabase Service Role Key

Saved to `secret-lover` as `SUPABASE_SERVICE_ROLE_KEY` (project: sourcelibrary). Note: can't run DDL via REST API even with service role JWT — need the SQL Editor or a direct pg connection for schema changes.

## Key Data Sources

| Source | Location | Size | Notes |
|---|---|---|---|
| BPH catalog | Supabase `bph_works` | 27,879 works | Embassy's official catalog. 4,099 works in 1450-1700 range |
| USTC editions | Supabase `ustc_editions` | 1.6M editions | Use `sn` field, NOT `id` |
| USTC enrichments | Supabase `ustc_enrichments` | 1.6M rows | Has `english_title`, `std_title`, `original_author`. `id` = `ustc_editions.id` (NOT `sn`). **No trigram index yet** — needs one on `english_title` and `original_author` |
| Scan data | MongoDB `catalog_coverage` | 2.45M records | Use `has_iiif_scan`, NOT `has_scan` (deleted) |
| Import candidates | MongoDB `import_candidates` | 920K records | 9 IIIF providers |
| Entity aliases | MongoDB `entity_aliases` | 1,322 records | No VIAF data yet |
| BPH→USTC matches | `scripts/output/bph-ustc-matches.json` | 2,529 matches | Each has: bph_ubn, bph_title, bph_author, bph_year, ustc_sn, ustc_title, ustc_author, overlap, method, pass |

## Remaining Gap: Why 936 Have Candidates But Don't Match

The biggest unmatched bucket (936 works) finds USTC editions by the same author but title overlap is <0.5 and Gemini says NO. Spot-checking reveals three patterns:

1. **Cross-language titles** (~200-300): BPH has "A warning" (English translation), USTC has "Eine Warnung" (German original). Title word overlap = 0.00 because they're different languages.

2. **Different works by same author** (~400-500): BPH has a specific Boehme tract, USTC has other Boehme works in the same year range. Correctly not matched.

3. **Title normalization failures** (~100-200): Greek text in brackets (`[Greek: ...]`), stripped diacritics, short generic titles ("Opera", "Revelationes") that are too ambiguous.

### Proposed fix: English title matching via `ustc_enrichments`

`ustc_enrichments` has AI-generated English translations of all 1.6M USTC titles. Strategy:
1. Add trigram indexes on `ustc_enrichments` (SQL below)
2. Translate BPH title to English via Gemini
3. Search `english_title` with `ilike`
4. This catches cross-language matches that are invisible to direct title overlap

**SQL needed (not yet run):**
```sql
CREATE INDEX idx_ustc_enrichments_english_title_trgm
  ON ustc_enrichments USING GIN (english_title gin_trgm_ops);
CREATE INDEX idx_ustc_enrichments_original_author_trgm
  ON ustc_enrichments USING GIN (original_author gin_trgm_ops);
```

**Important:** `ustc_enrichments.id` = `ustc_editions.id` (Supabase auto-increment), NOT `ustc_editions.sn`. Any lookup needs to join through `ustc_editions` to get the real USTC serial number.

## Output Files

| File | Description |
|---|---|
| `scripts/output/bph-ustc-matches.json` | 2,529 BPH→USTC matches (all passes merged) |
| `_tmp-match-bph-ustc-v4.mjs` | v4 matching (Latin, surname+year, Gemini YES/NO) |
| `_tmp-match-bph-ustc-v5.mjs` | v5 matching (Latin unmatched, Gemini author resolution) |
| `_tmp-match-bph-ustc-all-langs.mjs` | All-languages matching |
| `_tmp-match-bph-ustc-v6.mjs` | v6 matching (exact-match first, retry on timeout, Gemini USTC name forms) |

## Learnings

### Matching
- **Gemini 2.0 Flash** hallucinated matches when given pick-from-list prompts. **Gemini 3 Flash Preview** with binary YES/NO is much better.
- Title word overlap ≥0.5 is reliable for auto-matching. Below that, Gemini YES/NO is needed.
- The biggest bottleneck is **candidate discovery** (finding the right USTC editions to compare against), not title comparison.
- Language labels in BPH catalog are unreliable — don't filter by language. Many "Latin" works are actually German or Dutch.
- BPH collection skews heavily toward 17th-century esoterica (alchemy, Rosicrucianism, theosophy) — exactly what USTC is weakest on.

### Infrastructure
- **Supabase `ilike` on large tables NEEDS a trigram index.** Without it, queries timeout intermittently and silently fail. This was the #1 source of false negatives.
- **Never swallow errors as empty results.** `catch { return []; }` is dangerous — distinguish "no results" from "query failed."
- Exact-match queries (`author_1=eq.X`) use the index and are always fast (<100ms). Use as primary strategy, fall back to `ilike` only when needed.
- `ustc_enrichments.id` ≠ `ustc_editions.sn`. They share the Supabase auto-increment `id`, not the USTC serial number.

### Author name issues
- BPH → USTC name mismatches: Boehme/Böhme, Castellio/Châteillon, Caussinus/Caussin, Lull/Llull
- Multi-word surnames (Agrippa von Nettesheim) need first-word extraction
- Diacritics still cause misses even with trigram index — `unaccent` extension + immutable wrapper would help

## Next Steps

1. **Add trigram indexes on `ustc_enrichments`** — enables English title matching (v7 pass)
2. **Run v7 matching pass** using English title matching for the 936 with candidates but no title match
3. **Cross-reference all 2,529 matches against `catalog_coverage`** — get final "digitized elsewhere" numbers
4. **Write matches back to Supabase** — add `ustc_sn` column to `bph_works`
5. **Add `unaccent` support** on Supabase — diacritics-insensitive matching
6. **Build out `entity_aliases`** with VIAF data — authoritative author name crosswalk
7. **Package as reusable tool** — `scripts/catalog-coverage/scan-library-catalog.mjs` per issue #361
8. **Build admin UI** for human review of ambiguous matches
9. **Extend beyond USTC range** — match post-1700 works against `import_candidates` directly

## For BPH Curator

Summary to share: of 4,099 BPH works (1450-1700), 61.7% are confidently matched to USTC editions. Another 10-15% are likely in USTC but hard to match automatically (cross-language title differences). ~5% are genuinely absent from USTC. 9% are anonymous. The digitization overlap analysis (how many are already scanned by BSB, Gallica, e-rara, etc.) still needs to be run on the full matched set.
