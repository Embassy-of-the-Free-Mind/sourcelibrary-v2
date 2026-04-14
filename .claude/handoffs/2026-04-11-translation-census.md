# Translation Census (#187) — Handoff 2026-04-12 (updated)

## What was built

**`/census` page** — public dashboard showing what % of pre-1700 European works have been translated into English. Reads from `get_translation_census()` Supabase RPC. Falls back to edition-level coverage stats with honest caveats.

**`/api/census/search`** — "Has X been translated?" search. Uses `search_translation_census()` RPC (searches 4K matches table, fast) with fallback to enrichments.

**`build-census.mjs`** — iterative matching script. Processes catalog surnames one at a time with 30s per-query timeout, checkpoints progress in `census_processed_surnames` table.

## Current data state (2026-04-12)

- **12,781 catalog matches + 5,066 SL first translations = 17,847 total**
- Page shows **0.93%** of pre-1700 works with known English translation
- 23,738 catalog records from 20+ sources (up from 13,862)
- Census built via batch SQL join on Supabase Pro (takes ~5 min)
- Summary via materialized view `translation_census_by_language`, RPC `get_translation_census()`

## What's running on Hetzner

`build-census.mjs` is running via `setsid` from `/root/sourcelibrary`. It resumes from checkpoints. Many short/common surnames timeout at 30s (B-tree prefix `LIKE 'carr%'` returns thousands of hits on 1.4M works). Progress is slow but incremental.

To check: `ssh root@46.224.122.120 "tail -20 /tmp/census-build.log"`
To restart: `cd /root/sourcelibrary && set -a && source .env.production.local && set +a && setsid node scripts/catalog-coverage/build-census.mjs > /tmp/census-build.log 2>&1 < /dev/null &`

## Supabase constraints discovered

- **Statement timeout:** Default 2 min, can SET to 0 on session mode (port 5432). BUT Supabase kills connections after ~5-8 min regardless.
- **Must use port 5432** (session mode), not 6543 (pgBouncer transaction mode). SET doesn't persist on pgBouncer.
- **Must use single `pg.Client`**, not `pg.Pool`. Pool gives different connections per query, losing SET.
- **GROUP BY on 1.4M rows times out.** Can't build materialized views over `ustc_distinct_works`. Used pre-computed work totals + JSON config instead.
- **`%` trigram operator scans all 1.4M works** per query — too slow. B-tree exact+prefix only.
- **`ustc_distinct_works` table** was built once via language-chunked INSERT (each language < 500K). Can't be rebuilt easily.

## Surname extraction bug

`lower(regexp_replace(..., '[^a-z ]'))` stripped uppercase before lowering → "Thomas Aquinas" became "homas quinas". Fixed in code but the `ustc_distinct_works` table still has old surnames (rebuilding times out). Matching still works via prefix matching.

## PRs merged

- #938 — Initial census page + search
- #940 — Work-level matching + honest fallback
- #943 — Trigram surname matching fix
- #945 — Iterative matching (avoid cross-join timeout)
- #946 — GIN-indexed surname matching
- #953 — Fix surname extraction, raise threshold, fix search RPC
- #954, #955 — Session mode + timeout fixes
- #957, #958 — Skip works rebuild, CREATE TABLE instead of mat view
- #959 — Single pg.Client with unlimited timeout
- #960 — Chunked works build by language
- #961 — Resumable matching + JSON summary
- #962 — Drop trigram operator per-surname

## Key files

- `src/app/census/page.tsx` — Census page (reads from RPC)
- `src/app/census/CensusSearch.tsx` — Client-side search
- `src/app/api/census/search/route.ts` — Search API
- `scripts/catalog-coverage/build-census.mjs` — Build script

## Supabase objects

- `ustc_distinct_works` — 1.39M rows, regular table (not mat view)
- `translation_census_matches` — ~4.3K rows (growing as process runs)
- `translation_catalogs` — 13,862 rows (synced from MongoDB)
- `census_config` — JSON summary read by RPC
- `census_processed_surnames` — checkpoint tracking
- `get_translation_census()` — reads from census_config
- `search_translation_census()` — searches matches + enrichments

## Next steps

1. Let the background process finish all 2,389 surnames (will take hours, many will timeout)
2. After completion, run `fix-census.mjs` on Hetzner to update the census_config summary
3. Consider lowering threshold back to 0.25 (0.3 may be too strict)
4. The surname extraction bug means we're missing Latin↔English name variants (Ficinus→Ficino). Adding the alias map from `build.mjs` would help.
5. Expanding translation catalogs (WorldCat, more publisher catalogs) would have the biggest impact on completeness.
