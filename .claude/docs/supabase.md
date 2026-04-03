# Supabase Integration

Source Library uses Supabase Postgres alongside MongoDB. MongoDB handles the reading experience, pipeline state, and imports. Supabase handles analytics, catalog cross-referencing, and semantic search.

**Project:** `ykhxaecbbxaaqlujuzde` (secondrenaissance), West EU (Ireland), Pro plan ($25/mo)
**Client:** `src/lib/supabase.ts` — exports `supabase` (anon), `supabaseAdmin` (service role)

## Why Supabase Exists (What It Prevents)

MongoDB Atlas had 23 database incidents in March 2026 alone (see `database-incidents.md`). Supabase specifically prevents three recurring failure patterns:

1. **Analytics queries saturating Atlas.** The dashboard fired 11 parallel `countDocuments` calls, causing a complete site outage (~Mar 20). The `/api/analytics/usage` endpoint had a 60-second timeout and regularly took 30+ seconds. Now reads from Supabase materialized views — instant.

2. **Slow aggregations blocking user-facing pages.** `$facet` pipelines on the books collection took 90+ seconds under load, collapsing WiredTiger cache and taking down the entire site (Mar 30 crisis). Pipeline velocity and cron health queries now run against Supabase, not Atlas.

3. **No hybrid search capability.** MongoDB can't combine keyword search (`$search`) with vector similarity (`$vectorSearch`) in a single query. Supabase does both in one SQL query via `tsvector` + `pgvector`. However, as of 2026-04-01 this is experimental — only 4.1% of pages are embedded, the hybrid_search RPC is unreliable from Vercel, and there is no UI integration. The existing Atlas Search handles all production search needs.

**The boundary is clear:** MongoDB stays for document storage (books, pages), the pipeline state machine (`pipeline_auto.status`), Atlas Search (keyword search), and flexible-schema imports. Supabase handles everything analytical, relational, or vector-based.

## What Is NOT in Supabase

Book and page data is **not mirrored** to Supabase. The `books` and `pages` MongoDB collections are the sole source of truth for:
- Book metadata (title, author, year, language, collections, pipeline state)
- Page images (photo URLs, thumbnails, crops)
- OCR text (`pages.ocr.data`)
- Translation text (`pages.translation.data`) — except for the cleaned copy in `page_translations` used for search only
- Pipeline state (`books.pipeline_auto`)
- Page revisions (`page_revisions` collection)

The `page_translations` table contains a cleaned copy of translation text + embeddings for search purposes, but it is NOT a read replica of the pages collection. It lacks OCR text, images, pipeline state, and many other fields.

**Why not mirror books/pages?** The warehousing migration (Mar 30) cut live collections by 75% (34K→9K books, 9.6M→2.5M pages). Combined with the `visible: true` index migration, MongoDB is now fast enough for the read path. A full Postgres mirror would add sync complexity without proportionate benefit. This decision should be revisited if Atlas performance degrades again.

## What Lives in Supabase

### Catalog (read-only reference)
| Table | Rows | Purpose |
|-------|------|---------|
| `ustc_editions` | 1.6M | USTC bibliographic records (sn, title, author, year, place) |
| `ustc_enrichments` | 1.6M | AI-enriched USTC records (English titles, detected language) |
| `bph_works` | 28K | Embassy of the Free Mind / BPH catalog |
| `entity_aliases` | 1.3K | Author name variants from Wikidata |

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
  └── track/route.ts ──writes──→ MongoDB analytics_pageviews
                                   └── Hetzner cron syncs → Supabase

Supabase (reads)
  ├── /api/analytics/usage ──reads──→ dashboard_usage materialized view
  ├── /api/analytics/pipeline ──reads──→ pipeline_snapshots + cron_runs
  ├── /api/search/semantic ──reads──→ page_translations (hybrid search)
  └── /api/ustc/search ──reads──→ ustc_editions + ustc_enrichments
```

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
```

Syncs the 5 non-dual-write collections incrementally. Typical run: ~300 rows in ~3 seconds.

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

### Run a one-off SQL query
```bash
supabase link --project-ref ykhxaecbbxaaqlujuzde
# Get ephemeral credentials:
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
