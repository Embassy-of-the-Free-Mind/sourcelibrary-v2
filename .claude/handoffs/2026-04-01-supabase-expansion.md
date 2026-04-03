# Handoff: Supabase Expansion (2026-03-30 to 2026-04-01)

## What Was Done

Expanded Supabase from a USTC-only catalog to the analytics, search, and browse layer for Source Library. MongoDB stays for the reading experience and pipeline; Supabase handles everything analytical, relational, or vector-based.

### Analytics Layer (PR #569, #582, live)
- 6 analytics tables: `gemini_usage` (5M rows), `pipeline_snapshots`, `analytics_pageviews`, `analytics_events`, `cron_runs`, `loading_metrics`
- Materialized views: `dashboard_usage`, `pipeline_velocity` — auto-refreshed by pg_cron every 5 min
- `/api/analytics/usage` and `/api/analytics/pipeline` read from Supabase (was 3-30s on MongoDB, now instant)
- Dual-write for `gemini_usage` in `gemini-logger.ts`
- Hetzner cron syncs other 5 collections every 5 min (`supabase-sync.mjs`)

### Semantic Search (PR #625, live, backfill in progress)
- `page_translations` table with tsvector + pgvector(768)
- `hybrid_search()` Postgres function — combined keyword + semantic similarity in one query
- Embedding server on Hetzner: systemd `sl-embedding-server`, port 3456, `multilingual-e5-base`
- `/api/search/semantic?q=...` endpoint on Vercel (calls Hetzner for query embeddings)
- Backfill running: ~66K of 600K pages done (~2 pages/sec, will take days)
- **IMPORTANT:** Kill backfill before Vercel deploys — they compete for Atlas connections. `ssh root@46.224.122.120 "pkill -f embed-translations"`. Restart after: `nohup node scripts/workers/embed-translations.mjs --full >> /var/log/sourcelibrary/embed-backfill.log 2>&1 &`

### Books Catalog Mirror (PR #661, pending merge)
- `books_catalog` table: 7,600 visible books with all browse/filter fields, 10 indexed columns
- `/api/books/browse` — Supabase-backed browse endpoint (46ms vs 326s under Atlas load)
- Sync added to `supabase-sync.mjs` cron
- Text search still uses `/api/books/library` (Atlas Search)

### Other
- `visible: true` migration (PR #594): replaced `hidden: { $ne: true }` in 65 files, fixed the 52-second health probe
- Portal pages build fix: Sacred Texts and Contemplative Traditions pages no longer crash Vercel build on DB timeout
- Database incident log: `.claude/docs/database-incidents.md` — 23 incidents documented with patterns

## What's Next

1. **Merge PR #661** (books catalog mirror) and deploy
2. **Wire `/api/books/browse` into the frontend** — replace the MongoDB browse calls on the library page
3. **Wait for embedding backfill** to complete (~595K pages remaining, running unattended on Hetzner)
4. **Add semantic search to the UI** — toggle or auto-blend on the search page
5. **Incremental embedding cron** — embed new translations as they complete (add to `supabase-sync.mjs` or a separate cron)
6. **Gallery embeddings → pgvector** — move from MongoDB brute-force to Supabase HNSW

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/supabase.ts` | Shared Supabase client (anon + admin) |
| `src/app/api/analytics/usage/route.ts` | Analytics dashboard — reads from Supabase |
| `src/app/api/search/semantic/route.ts` | Semantic search endpoint |
| `src/app/api/books/browse/route.ts` | Supabase-backed browse (PR #661) |
| `scripts/workers/supabase-sync.mjs` | Hetzner cron — incremental sync |
| `scripts/workers/sync-books-catalog.mjs` | Standalone books catalog sync |
| `scripts/workers/embed-translations.mjs` | Embedding backfill script |
| `scripts/workers/embedding-server.mjs` | Local embedding HTTP server |
| `scripts/migration/supabase-analytics-schema.sql` | Full SQL schema |
| `.claude/docs/supabase.md` | Comprehensive Supabase reference |
| `.claude/docs/database-incidents.md` | 23 March incidents documented |

## Env Vars Added

| Var | Where | Value |
|-----|-------|-------|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel, Hetzner | Service role key for writes |
| `EMBED_URL` | Vercel | `http://46.224.122.120:3456` |
| `SUPABASE_URL` | Hetzner | `https://ykhxaecbbxaaqlujuzde.supabase.co` |
| `SUPABASE_ANON_KEY` | Hetzner | Read-only anon key |

## Hetzner Services Added

| Service | Type | Purpose |
|---------|------|---------|
| `sl-embedding-server` | systemd | Embedding HTTP server on port 3456 |
| `supabase-sync.mjs` | crontab (*/5 min) | Analytics + books sync |
