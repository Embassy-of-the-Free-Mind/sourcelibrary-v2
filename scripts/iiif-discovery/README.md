# IIIF Discovery — 100K Renaissance Books

Bulk discovery and import of pre-1800 books from IIIF-enabled digital libraries.

## Architecture

```
Discovery (OAI-PMH / SRU / IIIF Collections)
  → import_candidates (MongoDB staging collection)
    → import-batch.mjs (dedup + import via /api/import/iiif)
      → books collection (main library)
        → OCR/translation pipeline
```

**Two-phase approach:**
1. **Discovery** — harvest metadata + manifest URLs from each source into `import_candidates`
2. **Import** — batch import from candidates, with dedup checking, into the main collection

This separation means:
- Discovery can run independently per source
- Candidates can be reviewed/filtered before import
- Everything is resumable
- Progress is tracked per source

## Sources

| Source | Est. pre-1800 books | Discovery method | Status |
|--------|-------------------|-----------------|--------|
| e-rara.ch | ~50-80K | OAI-PMH | Ready |
| BSB Munich | ~30-50K (of 3.1M total) | OAI-PMH | Ready |
| Gallica (BnF) | ~20-40K | SRU API | Ready |
| Biblissima | ~60K (aggregated) | IIIF Collections / Portal API | Ready |

## Usage

### 1. Discover candidates

```bash
# All commands need MongoDB access
set -a; source .env.production.local; set +a

# Discover from e-rara (fastest start — 100K titles)
node scripts/iiif-discovery/sources/erara.mjs

# Discover from BSB Munich (filter to pre-1800)
node scripts/iiif-discovery/sources/bsb.mjs --max-year=1800

# Discover from Gallica
node scripts/iiif-discovery/sources/gallica.mjs --max-year=1800

# Discover from Biblissima (already pre-1800)
node scripts/iiif-discovery/sources/biblissima.mjs
```

### 2. Check progress

```bash
node scripts/iiif-discovery/status.mjs
node scripts/iiif-discovery/status.mjs --source=erara
```

### 3. Import candidates

```bash
# Dry run first
node scripts/iiif-discovery/import-batch.mjs --dry-run --limit=100

# Import 500 books from e-rara, pre-1800 only
node scripts/iiif-discovery/import-batch.mjs --source=erara --limit=500 --max-year=1800

# Import from all sources
node scripts/iiif-discovery/import-batch.mjs --limit=1000
```

## Options

### Discovery scripts
- `--max-records=N` — stop after N records
- `--from=YYYY-MM-DD` — only records modified after date (OAI-PMH)
- `--set=xxx` — harvest specific OAI set (e.g., `vd16` for BSB 16th-century prints)
- `--start=N` — resume from record N (Gallica)
- `--page=N` — resume from page N (Biblissima)

### import-batch.mjs
- `--source=xxx` — only import from one source
- `--limit=N` — max books per run (default: 500)
- `--delay=N` — ms between imports (default: 2000)
- `--dry-run` — show what would be imported
- `--min-year=N` / `--max-year=N` — date filter
- `--min-pages=N` — skip books with fewer pages (default: 5)

## MongoDB collection: import_candidates

```js
{
  manifest_url: "https://...",      // IIIF manifest URL (unique key)
  source: "erara",                  // discovery source
  origin_library: "ETH Zürich",    // actual holding library
  title: "De re metallica",
  author: "Agricola, Georg",
  language: "Latin",
  date_text: "1556",
  date_earliest: 1556,              // parsed year
  date_latest: 1556,
  page_count: null,                 // filled at import time
  status: "discovered",             // discovered → imported/skipped/failed
  skip_reason: null,
  book_id: null,                    // after import
  discovered_at: Date,
  imported_at: null,
}
```
