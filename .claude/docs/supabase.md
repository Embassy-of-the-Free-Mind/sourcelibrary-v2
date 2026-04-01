# Supabase Integration

Source Library uses Supabase Postgres alongside MongoDB. MongoDB handles the reading experience, pipeline state, and imports. Supabase handles analytics, catalog cross-referencing, and semantic search.

**Project:** `ykhxaecbbxaaqlujuzde` (secondrenaissance), West EU (Ireland), Pro plan
**Client:** `src/lib/supabase.ts` — exports `supabase` (anon), `supabaseAdmin` (service role)

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

### Semantic Search
| Table | Rows | Purpose |
|-------|------|---------|
| `page_translations` | ~600K (backfilling) | Translation text + tsvector + pgvector(768) for hybrid search |

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
