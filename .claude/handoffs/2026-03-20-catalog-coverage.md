# Handoff: Unified Catalog Coverage Database & Dashboard

**Date:** 2026-03-20
**Branch:** main (committed and pushed)
**GitHub Issue:** https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/261

## What Was Built

Unified database + dashboard + API that joins USTC (1.57M editions, 1450-1700) with IIIF scan availability, published translation catalogs, and Source Library processing status.

### Files Created

```
scripts/catalog-coverage/
├── build.mjs              # Materialization script — pulls USTC from Supabase, joins with MongoDB
├── enrich-supabase.mjs    # Push coverage flags back to Supabase ustc_editions (not yet run)
└── coverage-by-year.json  # Static JSON for "dark shelf" visualization (249 years, 2068 year×lang combos)

src/app/api/catalog/coverage/route.ts   # API: summary, search, timeline, works modes
src/app/admin/catalog-coverage/page.tsx  # Dashboard with cards, language table, timeline, search, methodology
```

### Data in MongoDB

- **`catalog_coverage`**: 1,571,796 documents (one per USTC edition), with `has_scan`, `has_published_translation`, `in_source_library`, `iiif_manifest_url`, `work_cluster_id`, etc.
- **`catalog_coverage_meta`**: Pre-computed stats (summary + work-level), used by API to avoid heavy aggregations on Vercel.

### Key Numbers

| Language | Editions | Scanned | % | Translated | % |
|----------|----------|---------|---|------------|---|
| Latin | 508,604 | 128,213 | 25.2% | 68,435 | 13.5% |
| German | 340,205 | 45,197 | 13.3% | 15,657 | 4.6% |
| French | 233,563 | 32,668 | 14.0% | 10,366 | 4.4% |
| English | 164,309 | 1,150 | 0.7% | 0 | 0.0% |
| Greek | 10,441 | 2,900 | 27.8% | 1,928 | 18.5% |
| **Total** | **1,571,796** | **217,665** | **13.8%** | **110,712** | **7.0%** |

**Work-level:** 1,071,422 distinct works. 135K scanned, 67K translated, 109K scanned-not-translated, 895K neither.

## What's Pending

### 1. Spot Checks
Atlas was saturated during this session so spot checks failed. Need to verify:
- Copernicus De Rev has scan + translation
- Ficino De Vita has scan (after Latin suffix fix)
- No English editions flagged as "has translation"
- IIIF manifest URLs are valid

### 2. Supabase Enrichment
Script ready at `scripts/catalog-coverage/enrich-supabase.mjs`. Dry run passed: 280,287 records to update.

**Before running:**
1. Run this SQL in Supabase SQL Editor (https://supabase.com/dashboard/project/ykhxaecbbxaaqlujuzde/sql):
```sql
ALTER TABLE ustc_editions
  ADD COLUMN IF NOT EXISTS has_iiif_scan boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS iiif_manifest_url text,
  ADD COLUMN IF NOT EXISTS iiif_source text,
  ADD COLUMN IF NOT EXISTS has_english_translation boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS in_source_library boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ustc_has_scan ON ustc_editions (has_iiif_scan) WHERE has_iiif_scan = true;
CREATE INDEX IF NOT EXISTS idx_ustc_has_translation ON ustc_editions (has_english_translation) WHERE has_english_translation = true;
```

2. Run enrichment:
```bash
set -a; source .env.production.local; set +a
export SUPABASE_SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY ~/vibecodingevents/.env.local | cut -d= -f2)
node scripts/catalog-coverage/enrich-supabase.mjs
```

**Note:** REST API is slow (~3-5 hours for 280K records at 10 parallel PATCHes). Consider using Postgres direct connection for speed.

### 3. Dark Shelf Visualization
`coverage-by-year.json` is ready for the pixel grid visualization on Second Renaissance. Data shape:
```json
{ "year": 1680, "total": 19043, "scanned": 1586, "translated": 601, "in_sl": 14 }
```
Peak year 1680: 92% dark (neither scanned nor translated).

### 4. Dashboard Improvements
- IIIF viewer links (click scan → view in Mirador)
- "The Unseen" spotlight — random untranslated book with title page
- Click-through from language rows to filtered search
- One-click "translate this" for scanned-but-untranslated books

## Technical Notes

### Build Script Resilience
Multiple iterations to handle Atlas issues:
- Paginated loading (10K batches with `_id > lastId`) instead of cursor/toArray — survives replica set failovers
- Chunked bulkWrite (500 ops) with 3 retries on timeout
- Direct MongoClient with 120s socket timeout (shared `getScriptClient` was too aggressive at 30s)
- Supabase year-range splitting: 5-year windows, falls back to single years on timeout

### Matching Improvements
- Latin suffix stripping (`-us`, `-is`, `-ius`, `-inus`) for author surname matching (ficinus→ficin matches ficino→ficin)
- Adjacent decade checking (±10 years) for scan blocking
- English editions excluded from translation matching

### API Performance
- Summary endpoint reads from pre-computed `catalog_coverage_meta` (instant, no aggregation)
- Works endpoint same — server-side aggregation on 1.5M docs times out on Vercel
- Timeline endpoint uses indexed `{language, year}` aggregation (fast)
- Search endpoint uses compound indexes

## Commands
```bash
# Rebuild coverage (all languages, ~25 min)
set -a; source .env.production.local; set +a
node scripts/catalog-coverage/build.mjs

# Single language rebuild
node scripts/catalog-coverage/build.mjs --language=Latin

# Dry run
node scripts/catalog-coverage/build.mjs --dry-run

# Supabase enrichment (needs SUPABASE_SERVICE_KEY)
export SUPABASE_SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY ~/vibecodingevents/.env.local | cut -d= -f2)
node scripts/catalog-coverage/enrich-supabase.mjs
```
