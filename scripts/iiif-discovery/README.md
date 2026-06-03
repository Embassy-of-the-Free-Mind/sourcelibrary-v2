# IIIF Discovery — 100K Renaissance Books

Bulk discovery and import of pre-1800 books from IIIF-enabled digital libraries.

## Architecture

```
1. ENUMERATE   sources/<x>.mjs            → import_candidates (id + manifest_url + metadata)
2. CACHE       harvest-manifests.mjs      → manifest_cache on each candidate (pages + rights)
3. DEDUPE      analyze/dedupe-candidates  → mark dupes vs the library + cross-source
4. IMPORT      import-from-cache.mjs       → books (+ pages) HIDDEN   [offline, no network]
                                          → QA → flip visible
```

**Why four stages (not two).** A staging collection (`import_candidates`) decouples
discovery from import. The key piece is the **manifest-cache stage**: it fetches each
candidate's IIIF manifest exactly once — isolating all the slow, rate-limited, or
browser-driven network work into one resumable pass — and stores the per-page image
URLs + rights on the candidate. Import is then a fast, offline, idempotent DB→DB
operation. A throttled source (Leiden F5, Harvard 429) is hit once.

- Each stage runs independently and is fully resumable
- Network work (the expensive part) happens once, in stage 2
- Candidates are deduped/reviewed before any write to `books`
- `import-from-cache` routes by shape: 1 canvas → `content_type:'artwork'`,
  >1 → book + per-page docs. No bespoke importer per source.

**Two ways to enumerate (stage 1):** rich adapters fetch the manifest during
enumeration (fine for fast sources); `--enumerate-only` (e.g. `sources/leiden.mjs`)
records just id + manifest_url and leaves the single fetch to stage 2 — best for
slow/bot-walled sources, avoids fetching each manifest twice.

**Legacy path:** `import-batch.mjs` is the older one-shot importer (manifest fetched
server-side via `/api/import/iiif`, books only). Still fine for fast/open/book
sources; it breaks on artworks and datacenter-429/F5 sources — those use the
cache→import-from-cache path (or a direct importer like `import-leiden-{artworks,books}.mjs`).

### The new pipeline, end to end

```bash
set -a; source .env.production.local; set +a
# 1. enumerate (lightweight) — e.g. Indonesian maps from Leiden
node scripts/iiif-discovery/sources/leiden.mjs --collection=ubl_maps \
  --extra-facet="mods_originInfo_place_placeTerm_text_authority_marccountry_ms:Indonesia" --enumerate-only
# 2. cache every manifest once (browser fetcher auto-selected for leiden)
node scripts/iiif-discovery/harvest-manifests.mjs --source=leiden --collection=ubl_maps
# 3. (optional) dedupe/analyze
node scripts/iiif-discovery/analyze-candidates.mjs --source=leiden --mark-dupes
# 4. import offline — routes artwork vs book automatically; lands HIDDEN
node scripts/iiif-discovery/import-from-cache.mjs --source=leiden --collection=ubl_maps \
  --sl-collection=indonesian-maps --book-type=map --facsimile --dry-run
```

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
