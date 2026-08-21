# Supabase Integration

Source Library uses Supabase Postgres alongside MongoDB. MongoDB is the source of truth for all book/page data and pipeline state. Supabase serves analytics, browse/filter read paths, catalog cross-referencing, and experimental semantic search.

**Project:** `ykhxaecbbxaaqlujuzde` (secondrenaissance), West EU (Ireland), Pro plan ($25/mo)
**Client:** `src/lib/supabase.ts` — exports `supabase` (anon), `supabaseAdmin` (service role)

## Why Supabase Exists (What It Prevents)

MongoDB Atlas had 23 database incidents in March 2026 alone (see `database-incidents.md`). Supabase specifically prevents three recurring failure patterns:

1. **Analytics queries saturating Atlas.** The dashboard fired 11 parallel `countDocuments` calls, causing a complete site outage (~Mar 20). The `/api/analytics/usage` endpoint had a 60-second timeout and regularly took 30+ seconds. Now reads from Supabase materialized views — instant.

2. **Slow aggregations blocking user-facing pages.** `$facet` pipelines on the books collection took 90+ seconds under load, collapsing WiredTiger cache and taking down the entire site (Mar 30 crisis). Pipeline velocity and cron health queries now run against Supabase, not Atlas.

3. **Low-selectivity browse queries timing out.** `visible: true` matches 86% of books, so index scans degenerate into collection scans. All five browse/filter page types (`/browse/*`, `/languages/*`, `/libraries/*`) were dead — 60s+ timeouts. Now served from `books_catalog` on Supabase in <50ms. (PR #667, 2026-04-01.)

4. **No hybrid search capability.** MongoDB can't combine keyword search (`$search`) with vector similarity (`$vectorSearch`) in a single query. Supabase does both in one SQL query via `tsvector` + `pgvector`. However, as of 2026-04-01 this is experimental — only 4.1% of pages are embedded, the hybrid_search RPC is unreliable from Vercel, and there is no UI integration. The existing Atlas Search handles all production search needs.

**The boundary:** MongoDB owns the document model (books, pages, pipeline state, Atlas Search). Supabase serves analytics, catalog cross-referencing, browse/filter read paths, and experimental semantic search. See "What Lives Where" below for the full split.

## What Lives Where (The Boundary)

**MongoDB is the source of truth** for all book and page data. Supabase serves derived read caches and analytics. If they diverge, MongoDB wins.

MongoDB owns (not in Supabase):
- Page content: OCR text (`pages.ocr.data`), translations (`pages.translation.data`)
- Page images, thumbnails, crops
- Pipeline state (`books.pipeline_auto`, `jobs`, `batch_jobs`)
- Page revisions (`page_revisions` collection)
- Gallery images (`gallery_images`, `detected_images`)

Supabase mirrors (synced from MongoDB, read-only):
- **`books_catalog`** — book metadata for browse/filter queries (PR #667, 2026-04-01). Synced by `sync-books-catalog.mjs` on Hetzner cron. Powers `/browse/titles`, `/browse/authors`, `/browse/years`, `/languages`, `/libraries`.
- **`page_translations`** — cleaned translation text + embeddings for semantic search (experimental)
- **Analytics tables** — gemini_usage, pipeline_snapshots, pageviews, events, cron_runs, loading_metrics

**Why the split?** MongoDB's `visible: true` filter matches 86% of books — indexes barely help. Browse/filter queries that scan the full collection time out on Atlas (60s+). The same queries run in <50ms on Postgres. Page-level reads (book detail, reader) are fast on MongoDB with `book_id` indexes, so they stay.

**Scope discipline:** `books_catalog` is a lightweight metadata cache, not a full mirror. It has title, author, year, language, library, thumbnail — enough for browse cards. It does NOT have pipeline state, page counts, OCR/translation data, or any page-level content. Don't expand it without good reason — every field added is a field to keep in sync.

## What Lives in Supabase

### Catalog (read-only reference)
| Table | Rows | Purpose |
|-------|------|---------|
| `ustc_editions` | 1.6M | USTC bibliographic records (sn, title, author, year, place) |
| `ustc_enrichments` | 1.6M | AI-enriched USTC records (English titles, detected language) |
| `bph_works` | 28K | Embassy of the Free Mind / BPH catalog |
| `entity_aliases` | 1.3K | Author name variants from Wikidata |

### Browse / Read Cache (synced from MongoDB)
| Table | Source | Sync Method | What it powers |
|-------|--------|-------------|----------------|
| `books_catalog` | MongoDB `books` | `sync-books-catalog.mjs` (Hetzner cron) | `/browse/*`, `/languages/*`, `/libraries/*` |

### Analytics (synced from MongoDB)
| Table | Source | Sync Method |
|-------|--------|-------------|
| `gemini_usage` | MongoDB `gemini_usage` | Dual-write in `gemini-logger.ts` |
| `pipeline_snapshots` | MongoDB `pipeline_snapshots` | Hetzner cron (every 5 min) |
| `analytics_pageviews` | MongoDB `analytics_pageviews` | Hetzner cron |
| `analytics_events` | MongoDB `analytics_events` | Hetzner cron |
| `cron_runs` | MongoDB `cron_runs` | Hetzner cron |
| `loading_metrics` | MongoDB `loading_metrics` | Hetzner cron |

### Materialized Views (auto-refreshed by pg_cron)
| View | Refresh | What it powers |
|------|---------|----------------|
| `dashboard_usage` | Every 5 min | `/api/analytics/usage` — daily cost/usage by type+model |
| `pipeline_velocity` | Every 5 min | `/api/analytics/pipeline` — hourly pipeline progress |

### Semantic Search (experimental — not in UI)
| Table | Rows | Purpose |
|-------|------|---------|
| `page_translations` | 65,928 of 1.59M (4.1%) | Translation text + tsvector + pgvector(768) for hybrid search |

**Status (2026-04-01):** API endpoint works (`/api/search/semantic`) but is NOT wired into the search UI. Backfill running at ~3.3 pages/sec (~5 days to complete). Hybrid mode only triggers ~20% of queries — most fall back to keyword-only, which returns poor results. The `hybrid_search` RPC times out from Vercel on the keyword-only path. Needs: finish backfill, fix RPC performance, integrate into UI, then validate quality before shipping.

## How Data Flows

```
MongoDB (writes)
  ├── gemini-logger.ts ──dual-write──→ Supabase gemini_usage
  ├── pipeline-orchestrator ──writes──→ MongoDB pipeline_snapshots
  │                                      └── Hetzner cron syncs → Supabase
  ├── track/route.ts ──writes──→ MongoDB analytics_pageviews
  │                                └── Hetzner cron syncs → Supabase
  ├── books collection ──sync──→ Supabase books_catalog
  │                                └── Hetzner cron (sync-books-catalog.mjs)
  └── pages collection ──sync──→ Supabase pages
                                   └── Hetzner cron (sync-pages-content.mjs)

Supabase (reads)
  ├── /browse/titles,authors,years ──reads──→ books_catalog
  ├── /languages/[code] ──reads──→ books_catalog
  ├── /libraries/[slug] ──reads──→ books_catalog
  ├── /api/analytics/usage ──reads──→ dashboard_usage materialized view
  ├── /api/analytics/pipeline ──reads──→ pipeline_snapshots + cron_runs
  ├── /api/search/semantic ──reads──→ page_translations (hybrid search)
  └── /api/ustc/search ──reads──→ ustc_editions + ustc_enrichments
```

## Sync Points (Complete Map)

Audited 2026-05-14. Every Mongo→Supabase write path in the codebase:

| # | Path | Trigger | Schedule | Fields | Status |
|---|---|---|---|---|---|
| 1 | MongoDB books → `books_catalog` | Hetzner `scripts/workers/sync-books-catalog.mjs` | every 5 min, last-10-min window | ~40 fields incl. `thumbnail`, `thumbnail_blob`, title, author, language, pages_count, pages_ocr/translated/blank, categories, collections, cover_image, summary_text, doi, published, place_published, publisher | ⚠️ window-only, no retry; **missing `held_by`, `image_display`, `image_thumb`** |
| 2 | MongoDB books → `books_catalog` | PATCH `/api/books/[id]` → `mirrorBookToCatalog()` | on curator edit | ~11 fields: title, display_title, author, thumbnail, thumbnail_blob, language, published, categories, publisher, place_published, doi | ⚠️ **only fires from the PATCH route**; direct DB updates from `scripts/` bypass it |
| 3 | MongoDB books → `bph_works.sl_book_id` | Vercel cron `/api/cron/sync-bph-sl-book-ids` | every 6h | `sl_book_id`, `sl_book_slug` | ✓ Honors `bph_catalog_link: false` opt-out (PR #1752, 2026-05-14) |
| 4 | MongoDB pages → `pages_images` | Hetzner `scripts/workers/supabase-sync.mjs` | every 5 min, last-10-min window | id, book_id, page_number, archived_photo, display_photo, thumbnail_blob | ⚠️ window-only; no retry/backfill if a sync window misses a row |
| 4b | MongoDB pages → `pages` (content + OCR/translation) | Hetzner `scripts/workers/sync-pages-content.mjs` | every 5 min, last-15-min window | id, book_id, page_number, photo*, ocr.*, translation.*, page_type, columns, script_type, detected_images, image_extraction_updated_at | ✓ Queries via `pages_ocr_updated_idx` and `pages_translation_updated_idx` with explicit `.hint()` (planner picks coll-scan otherwise). Idempotent upsert. Backfill: `--since=ISO` or `--book=ID`. Closed gap #2020. |
| 5 | MongoDB → 5 analytics tables | Hetzner `scripts/workers/supabase-sync.mjs` | every 5 min | pipeline_snapshots, analytics_pageviews, analytics_events, cron_runs, loading_metrics | ✓ |
| 6 | MongoDB entities → `entities` | `scripts/workers/sync-entities.mjs` | manual / one-shot | id, name, canonical_name, type, book_count, mentions, aliases, wikidata_id, portrait_url | ⚠️ no recurring trigger; new entities go stale |
| 7 | MongoDB book.gemini_usage → `gemini_usage` | Synchronous dual-write in `gemini-logger.ts` | per Gemini call | usage rows | ✓ Fire-and-forget (see Gotchas) |
| 8 | (runtime, no stored sync) `bph_works.sl_cover` | Computed in `/api/catalog/bph` from MongoDB at request time | per request | — | ✓ Always fresh; bottleneck is MongoDB freshness |

## Known Sync Gaps

These have bitten us before and will bite again. Documented so the next debugger doesn't relearn it.

### A. PATCH bypass — scripts that update MongoDB directly never call `mirrorBookToCatalog`

Symptom: a curator clicks "set cover" and the BPH grid updates instantly (PATCH mirrors immediately). But `scripts/migration/foo.mjs` runs `db.books.updateOne(...)` directly — the same field change shows up in `books_catalog` only after the 5-min Hetzner sync, *if* the sync window catches it. If the sync misses it (see B), the BPH grid is stale indefinitely.

Concrete example (2026-05-13/14): I fixed 10 BPH spread-cover URLs via a script that wrote MongoDB directly. 4 made it to Supabase within a sync window; 6 were stranded — the BPH home grid kept showing the old spread covers until I manually `UPDATE`d `books_catalog`.

Mitigations to consider:
- Extract `mirrorBookToCatalog` to a shared module any maintenance script can import.
- Or have the Hetzner sync use `supabase_synced_at < mongo updated_at` instead of a fixed 10-min window.

### B. Hetzner sync uses a fixed last-10-min window with no retry

`scripts/workers/sync-books-catalog.mjs` and `supabase-sync.mjs` look at MongoDB documents whose `updated_at > now() - 10 min`. There's no record of which rows have been mirrored — if a tick fails mid-batch, the missed rows are stranded until *another* edit re-bumps `updated_at`. Same shape applies to `pages_images`.

Mitigations to consider:
- Track `supabase_synced_at` on MongoDB docs and pick the diff each tick.
- Or run a daily "catch-up" pass with a wider window (last 24h).

### C. `held_by` is in MongoDB but not in `books_catalog`

Flagged in `.claude/handoffs/2026-04-24-bph-full-catalog.md` ("Supabase `books_catalog` sync doesn't include `held_by` yet"). Still open. Catalogue/BPH-filter code has to round-trip MongoDB to filter by holding library; Supabase-only browse pages can't filter.

### D. Entities sync is manual only

`scripts/workers/sync-entities.mjs` was run once during the encyclopedia backfill. There's no cron — new entities added in MongoDB don't reach Supabase unless someone re-runs the script. Low impact today (entities don't change often), but worth a recurring cron if entity edits become common.

### E. No central inventory of sync state

This table is the inventory. Before this section, sync points were scattered across `vercel.json` (Vercel crons), Hetzner crontab (worker scripts), and route file headers. Always update this table when adding or modifying a sync path.

## pg_cron Jobs

All prefixed `sl-`. Managed inside Supabase (no external cron needed).

| Job | Schedule | SQL |
|-----|----------|-----|
| `sl-refresh-dashboard-usage` | `*/5 * * * *` | `REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_usage` |
| `sl-refresh-pipeline-velocity` | `*/5 * * * *` | `REFRESH MATERIALIZED VIEW CONCURRENTLY pipeline_velocity` |
| `sl-cleanup-pageviews` | `0 3 * * *` | `DELETE WHERE timestamp < NOW() - 90 days` |
| `sl-cleanup-events` | `0 3 * * *` | `DELETE WHERE timestamp < NOW() - 90 days` |
| `sl-cleanup-loading` | `0 3 * * *` | `DELETE WHERE timestamp < NOW() - 30 days` |

## Hetzner Cron

```
*/5 * * * * cd /root/sourcelibrary && flock -n /tmp/sl-supabase-sync.lock bash -c "set -a; source .env.production.local; set +a; node scripts/workers/supabase-sync.mjs" >> /var/log/sourcelibrary/supabase-sync.log 2>&1
*/5 * * * * cd /root/sourcelibrary && flock -n /tmp/sl-sync-pages-content.lock bash -c "set -a; source .env.production.local; set +a; node scripts/workers/sync-pages-content.mjs" >> /var/log/sourcelibrary/sync-pages-content.log 2>&1
```

`supabase-sync.mjs` syncs the 5 non-dual-write analytics collections incrementally — typical run ~300 rows in ~3 seconds.

`sync-pages-content.mjs` syncs Mongo pages → Supabase `pages` table (OCR + translation columns) — typical 15-min window covers ~2K pages in <15s. Backfill mode: `--since=2026-05-22T00:00:00Z` or `--book=BOOK_ID` for one-off catch-up.

## Embedding Server (Hetzner)

Systemd service `sl-embedding-server` on port 3456. Serves embeddings from `multilingual-e5-base` (768 dims, quantized ONNX).

```bash
# Health check
curl http://46.224.122.120:3456/health

# Embed text
curl -X POST http://46.224.122.120:3456/embed \
  -H 'Content-Type: application/json' \
  -d '{"texts": ["philosopher stone"], "task": "query"}'
```

Used by:
- `embed-translations.mjs` — backfill/incremental page embeddings
- `/api/search/semantic` — query-time embedding generation

## Extensions Enabled

- `pg_trgm` — trigram indexes for fast `ILIKE` on catalog tables
- `unaccent` — diacritics-insensitive matching (Böhme → Bohme)
- `vector` (pgvector) — HNSW index for semantic search
- `pg_cron` — scheduled view refreshes and retention cleanup

## Env Vars

| Var | Where | Purpose |
|-----|-------|---------|
| `SUPABASE_URL` | Vercel, Hetzner | `https://ykhxaecbbxaaqlujuzde.supabase.co` |
| `SUPABASE_ANON_KEY` | Vercel, Hetzner | Read-only client (catalog lookups) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel, Hetzner | Write access (analytics, embeddings) |
| `EMBED_URL` | Vercel | `http://46.224.122.120:3456` (Hetzner embedding server) |

## Gotchas and Rules

### Embedding backfill conflicts with Vercel deploys
The embedding backfill (`embed-translations.mjs --full`) consumes MongoDB connections. Vercel builds also need MongoDB for static page generation. Running both simultaneously causes build timeouts. **Kill the backfill before deploying:** `ssh root@46.224.122.120 "pkill -f embed-translations"`. Restart after deploy succeeds.

### Embedding model must match between indexing and querying
The backfill uses `multilingual-e5-base` via the Hetzner embedding server. The search API also calls the same server. If you change the model, you must re-embed all pages — mixed vector spaces produce garbage similarity scores.

### Supabase CLI credentials are ephemeral
`supabase db dump --linked --dry-run` gives fresh Postgres credentials that expire. The pooler URL (`aws-1-eu-west-1.pooler.supabase.com`) uses a different password than the direct connection (`db.ykhxaecbbxaaqlujuzde.supabase.co`). Direct connection is IPv6-only — may not work from all networks.

### The anon key is public (read-only) but don't hardcode it
The anon key grants read access to all tables without RLS. It was previously hardcoded in 7 source files. Now centralized in `src/lib/supabase.ts` via env vars. Keep it that way.

### Dual-write is fire-and-forget
The `gemini-logger.ts` dual-write to Supabase is non-blocking and best-effort. If Supabase is down, new `gemini_usage` data only goes to MongoDB. The next incremental sync or manual backfill will catch it up.

### Analytics events had 29K duplicates from double full-run
The initial backfill was run twice for `analytics_events` (serial-ID table, no dedup on insert). Duplicates were cleaned up 2026-03-30. If you re-run `--full` on serial-ID tables (pageviews, events, loading_metrics, cron_runs), duplicates will be created. Use `--incremental` for ongoing sync.

### page_translations stores cleaned text, not raw
The translation text in `page_translations` has XML tags stripped and whitespace collapsed (via `cleanTranslation()`). The tsvector index is built on this cleaned text. If translation formatting changes upstream, the cleaned version may drift.

## Common Operations

### Run a one-off SQL query (including DDL)

The short path: `SUPABASE_DB_URL` lives in secret-lover, and the `pg` module's own
connection-string parser handles it as-is.

```bash
secret-lover run -- node scripts/migration/<your-migration>.mjs
# inside: new pg.Client({ connectionString: process.env.SUPABASE_DB_URL,
#                         ssl: { rejectUnauthorized: false } })
```

Touch ID means **foreground only** — `secret-lover` cannot reach the Keychain from a
background process. Node's `--env-file` does NOT override variables already in the
environment, so `secret-lover run -- node --env-file=… ` lets a stale keychain value
win over the file; export only what you need from the keychain instead.

**The host is IPv6-only, and an A-record lookup reads exactly like a dead host.**
`nslookup db.ykhxaecbbxaaqlujuzde.supabase.co` answers "No answer" because it asks for
an **A** record and there is none; `dig +short AAAA` returns an address and the
connection works. On 2026-08-13 that lookup was read as "Supabase retired this
hostname", DDL was declared impossible without a human pasting into the SQL editor, and
a migration was blocked for a week. Verified working from both the laptop and Hetzner on
2026-08-21 (created `page_texts`, three RPCs, a trigger and four indexes). **Check AAAA
before concluding a Supabase host is gone.**

Two things that genuinely do not work, so you don't retry them: the service-role key
cannot run DDL (it only reaches PostgREST), and the `exec_sql` RPC some older scripts
reference does not exist (`PGRST202`).

Ephemeral credentials via the CLI still work as an alternative:

```bash
supabase link --project-ref ykhxaecbbxaaqlujuzde
supabase db dump --linked --dry-run 2>&1 | grep "^export PG"
# Use those with psql or node pg client (SET ROLE postgres for DDL)
```

### Backfill analytics from MongoDB
```bash
set -a; source .env.production.local; set +a
SUPABASE_SERVICE_ROLE_KEY=... node scripts/migration/backfill-supabase-analytics.mjs --full
# Or incremental (default):
node scripts/migration/backfill-supabase-analytics.mjs
# Or single collection:
node scripts/migration/backfill-supabase-analytics.mjs --collection gemini_usage
```

### Embed translations for semantic search
```bash
# Requires embedding-server.mjs running on localhost:3456
node scripts/workers/embed-translations.mjs --full    # all pages
node scripts/workers/embed-translations.mjs            # incremental
node scripts/workers/embed-translations.mjs --book ID  # single book
```

### Check pg_cron jobs
```sql
SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
```

### Refresh materialized views manually
```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_usage;
REFRESH MATERIALIZED VIEW CONCURRENTLY pipeline_velocity;
```
