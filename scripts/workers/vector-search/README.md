# Page-vector service (#6821)

PRIOR ART: `github.com/JDerekLomas/sourcelibrary-atlas` `scripts/local-corpus/` (`pull-embeddings.mjs`,
`build-hnsw.mjs`, `semantic-lib.mjs`) — the same corpus in a usearch HNSW on a laptop. This is that, as a
service on l7a with filters, a delta sync and a unit; each file names what it took and what it changed.

Every semantic page lookup (`semanticPageSearchGlobal` → `match_semantic`) costs ~1.1 s for a new query
vector, because Supabase reads its HNSW index for `page_translations` from disk (#2049). This service holds
the same vectors in an 8-bit HNSW in RAM on l7a and answers in milliseconds. **The app calls it only when `VECTOR_SEARCH_MODE` is set** (`src/lib/vector-search.ts`): `shadow`
runs it beside the RPC and logs `search_queries.vector_shadow`; `serve` uses its rows, falling back to
the RPC on any error or `complete: false`. Default off. The app reaches it at
`https://vectors.sourcelibrary.org` (Caddy on l7a, phase 4, #6843).

## Contract

`POST /match` — same as `match_semantic`; the text columns only when asked (`with_text`):

```json
{"vector": [768 floats], "k": 15, "threshold": 0.3,
 "filter_language": "Latin", "filter_languages": ["German"], "filter_exclude_languages": ["English"],
 "year_min": 1500, "year_max": 1700}
→ {"rows": [{"page_id": "…", "book_id": "…", "page_number": 12, "similarity": 0.71}], "ms": 2.4,
   "path": "exact", "complete": true, "filtered_rows": 154299, "candidates": 154299, "rounds": 1}
```

- **Rows served**: every `page_translations` row with a non-null `embedding` — translated or not, exactly
  the set `match_semantic` searches (7,631,047 on 2026-10-16, not the 4.5M of #2049). Withheld rows
  (`embedding` moved to `embedding_withheld`, #4523) are not served.
- **Filters** are the RPC's predicates on the RPC's columns: `page_translations.book_language` and
  `book_year`, per row, by exact string equality. The caller expands language names (`expandLanguages`)
  before the call, as it does for the RPC. An empty array means no filter. A NULL language passes only the
  exclude list; a NULL year fails any year bound.
- **Threshold**: similarity = 1 − cosine distance, kept when `> threshold` — the RPC's operator.
- **Filtered queries** (phase 3) go through a planner; `path` says which branch ran:
  - The filtered row count comes exactly from per-(language, year) class counts.
  - **≤ 300K rows → `exact`.** An int8 scan of exactly those rows, read as one contiguous range from
    `index/exact.i8` (built by `build-exact.mjs`, ordered by language then year). The top 2k are
    re-scored in float32 from the shards.
  - **Otherwise → `hnsw`.** Over-fetch sized by the filter's share of the corpus, then widened by
    the pass rate actually seen near the query, up to 16,384 candidates or 250 ms.
  - **Still short and ≤ 600K rows → `hnsw+exact`.**
  - **Otherwise `complete: false`.** Fewer than k rows came back, and rows above the threshold may
    exist that were not seen. Typical case: a broad Latin filter on a query whose neighbourhood is
    all Chinese. The app treats it as a miss and asks the RPC.
  - Recall against an exact filtered scan: `scripts/eval/experiments/2026-10-17-vector-service-filtered-recall-6821.md`.
    Knobs (env): `VECTOR_SEARCH_MAX_ASK`, `_BUDGET_MS`, `_EXACT_MAX`, `_EXACT_FALLBACK_MAX`, `_EXACT_THREADS`.
- **`with_text: true`** (phase 4, serve mode) adds the RPC's other columns to every row: `book_language`
  and `book_year` from the row store, `translation`, `book_title` and `book_author` from the **text store**
  (`text/pages.sqlite`, one row per page_id, filled by `pull-text.mjs`, kept current by `sync-delta.mjs`).
  The response says `text_ms` and `text_missing`. A row the store lacks comes back without those three
  keys, and the app hydrates only that row from Supabase. Title and author are kept per row, as the RPC
  returns them, not per book. Shadow calls do not ask for text: they compare page ids.
- **`book_ids`** (≤ 50, #2049) is `match_pages_in_books`' question: `path: "books"`, an exact float32 scan
  of exactly those books' live rows, ANDed with any other filter. The keys come from a book index (CSR
  over the row store, built at startup and after each save; keys a delta sets in between are checked on
  every query). Each row is scored from the float32 shards, or from its int8 override if a delta changed
  it since the build. Without the shards it answers `complete: false` and the app asks the RPC. On 30
  real search_within_book calls: 10 ms server-side p50, the RPC's top 10 up to ties
  (`scripts/eval/experiments/2026-10-18-within-book-vector-books-2049.md`).
- `GET /health` → `{size, live_rows, book_map_size, built_at, last_delta_at, checkpoint, generation, text_store, …}`.
- `k` ≤ 1000. Bodies over 256 KB are refused.

Listeners: `127.0.0.1:3458` (`VECTOR_SEARCH_HOST`) needs `Authorization: Bearer $VECTOR_SEARCH_TOKEN` on
every route, `/health` included; Caddy terminates TLS for `vectors.sourcelibrary.org` and proxies to it
(`infrastructure/caddy/Caddyfile.l7a`), and ufw allows 80/443, not 3458. `127.0.0.1:3459` needs no token
and also serves `/admin/apply`, `/admin/ids` and `/admin/save` (used by `sync-delta.mjs`); Caddy never proxies it.

## Files

| file | does |
|---|---|
| `lib.mjs` | paths, the Postgres client (`SUPABASE_DB_URL`, read-only), the row store (key → page, language, year) |
| `pull-embeddings.mjs` | Supabase → `shards/shard-<k>.{f32,jsonl}`, keyset on `page_id`, resumable |
| `build-hnsw.mjs` | shards → `index/index-1.usearch` + `rows-1.jsonl` + `state.json`, streamed |
| `server.mjs` | the service |
| `pull-text.mjs` | Supabase → `text/pages.sqlite`: translation, book_title, book_author per served page (19.3 GB at 7.64M rows, ~30 min), resumable |
| `text-fingerprints.mjs` | once, for a store made before the `fp` table: fills each row's fingerprint from the store itself and sets `meta.fp_complete` |
| `sync-delta.mjs` | rows updated (or withheld) since the checkpoint → the running service and the text store, then a heartbeat; `--reconcile` (page-id diff against Supabase, plus the text fingerprints; `--hash` adds the md5 for a seventh of the rows), `--save`, `--count-check` |
| `freshness-check.mjs` | ntfy `sourcelibrary-uptime` once per state change: service down, `/health` slower than 1 s, last delta > 2 h, last reconcile > 6 h, or row drift > 0.5% (from the reconcile's count; no database read) |
| `match-latency-probe.mjs` | steady `/match` load at a fixed rate, p50/p90/p99 per window: what a reconcile or a save does to query latency |
| `latency-eval.mjs` | end to end over HTTPS: service + text vs service + Supabase hydration vs the RPC, and a column-by-column check against the RPC |
| `build-exact.mjs` | shards → `index/exact.{i8,keys,json}`: int8 vectors in (language, year) order for the exact filtered scan (~5.9 GB, ~4 min) |
| `recall-eval.mjs` | overlap@45 vs exact float32 cosine, latency; no Gemini |
| `filtered-recall-eval.mjs` | recall@45 of filtered queries vs an exact float32 filtered scan, per filter shape |
| `bootstrap.sh` | pull → build → start → recall → first delta → phase-2 job |
| `../../../infrastructure/l7a-crontab` | the delta, nightly save and freshness lines (installed 2026-10-17) |
| `../../../infrastructure/caddy/` | the Caddyfile and Caddy's slice drop-in |
| `../../../infrastructure/systemd/vector-search.service` | the unit |
| `../../../infrastructure/systemd/l7a-search.slice` | its slice (installed as `search.slice` on l7a; cloudlayer's `search.slice` is a different file), shared with Caddy and apart from the jobs' `sourcelibrary.slice` |

## Choices that are not obvious

- **e4m3, not i8.** usearch casts a unit vector to i8 on a fixed [−1, 1] scale, and these components are
  ~±0.04, so i8 keeps about five levels of each. On 2,000 real rows against exact float32 cosine: similarity
  error mean 0.0129 (i8) vs 0.0015 (e4m3) at the same 917 B/row; overlap 0.951 vs 0.975. f16 would be
  near-exact but 1.7 KB/row, which at 7.6M rows does not fit the slice beside anything else.
- **Its own slice, not the jobs'.** The service and Caddy run in `search.slice` (MemoryMin 9G, MemoryLow
  11G, MemoryMax 13G, no MemoryHigh). They started in `sourcelibrary.slice`, and on 2026-10-17 two `sl-tsc`
  runs took that slice past its MemoryHigh=12G: the kernel throttled every process in it, the service
  included (state D in `mem_cgroup_handle_over_high`), and every shadow call timed out from ~21:04 UTC.
  The delta, reconcile and freshness jobs stay in `sourcelibrary.slice`: a throttled job is late, a
  throttled service fails a reader. `freshness-check.mjs` pages when `/health` takes over 1 s.
- **Delta in the server's process.** `sync-delta.mjs` reads Supabase and posts the rows to `/admin/apply`;
  it does not load its own copy of the index, because two 7 GB copies do not fit the 14 GB slice.
- **Saves are nightly.** `index.save` blocks queries for seconds. Between saves the changes live in RAM;
  a restart reloads the last generation and the next delta re-applies everything after its checkpoint.
  A generation is `index-<g>.usearch` + `rows-<g>.jsonl`, and `state.json` (tmp + rename) is the commit
  point, so a crash mid-save leaves the previous generation intact.
- **The `updated_at` delta is not enough: `--reconcile` is load-bearing.** The writer stamps `updated_at`
  with the page's Mongo source time, not the write time (`scripts/lib/page-embedding-text.mjs`), so a page
  embedded after the checkpoint with an older source time is invisible to the delta. In the first 26 h
  that was 4,055 rows against the delta's 681 (2026-10-17). Deleted rows are invisible to it too.
  `--reconcile` (cron, every 2 h) reads every served page_id in one unordered cursor scan (~55 s; ordered
  by page_id it was ~10K ids/s, 12 min), reads the service's live ids range by range (`/admin/ids`, pages
  of 50K) and diffs them itself, and the missing rows are fetched and applied, the extras removed. It writes `logs/reconcile.json`, where
  `freshness-check.mjs` reads the drift. `--count-check` (nightly) still exits 4 above 0.1%.
- **…and ids are not enough either: the text store compares fingerprints.** In-place edits of
  `page_translations.translation` leave `updated_at` alone (`resyncMirrors` in
  `scripts/lib/translation-text-repair.mjs`, `backfill-clean-snippets.mjs`, `translation-cleanup-a2-5700.mjs`,
  `repair-text-shift-run.mjs`), and `updated_at` is the Mongo source time by design (`.claude/docs/embeddings.md`),
  so bumping it in the writers would break what the column means for `--restale`. Instead the store keeps a
  fingerprint per row (`fp`: byte lengths of translation and of title + author, and an md5 of all three),
  written with every row write. The reconcile's scan reads the lengths beside each page_id — Postgres
  takes `octet_length` from the TOAST header; the fingerprint lookups add ~40 s, in sorted batches — and the
  nightly run adds `--hash`, which catches a same-length edit. The md5 detoasts every translation it covers
  on Supabase, and the full pass ran past 28 min, IO-bound (2026-10-17), pushing `match_semantic`'s HNSW
  index out of Supabase's cache with it, so `--hash` covers one seventh of the rows a night
  (`abs(hashtext(page_id)) % 7` = the UTC weekday): every row weekly. `--hash-part all` forces the full pass. A row
  whose fingerprint differs, or that the store lacks, has its text re-read and replaced (its vector is
  left alone). The JS and SQL fingerprints agreed on 3,000 of 3,000 store rows, 2,010 of them non-ASCII
  (2026-10-17).
- **Admin work yields to `/match`.** `/admin/apply` and `/admin/ids` run on the thread that answers
  queries, so they give the loop back every 5 ms (`VECTOR_SEARCH_ADMIN_YIELD_MS`), never between a row's
  index and row-store updates. Vectors travel as base64 float32 (`embedding_b64`), not JSON arrays, so a
  500-row apply is ~2 MB to parse instead of ~7.5 MB. Before this (2026-10-17), one reconcile took `/match`
  p99 from ~17 ms to 1,869 ms, with 2.4 s stalls.
- **The exact file is a second copy, on disk, not in RAM.** The shards are ordered by page_id, so a
  filtered set is scattered across 23 GB (5.5K random reads/s on l7a). In (language, year) order,
  one language is one sequential read. Rows a delta adds or re-embeds are not in the file: the server
  keeps their int8 vectors in RAM and saves them with each generation (`overrides-<g>.bin`). A
  rebuilt index renumbers keys, so the server ignores an `exact.json` whose `index_built_at` differs
  from `state.json`, and `bootstrap.sh` rebuilds the file after every index build. The scan reads
  into ONE buffer allocated at startup: a fresh 96 MB buffer per query cost 390 ms of reclaim in a
  slice at its `memory.high`.
- **Postgres, not PostgREST**, for the pull: 5,000 rows with vectors in 1.9 s per stream from l7a against
  ~11 s per 1,000 over REST. The `translation` column is not in the shards; `pull-text.mjs` pulls it into
  the text store.
- **The text store is SQLite on disk, not RAM.** 19.3 GB does not fit the slice beside the index; 45 point
  reads by primary key cost about a millisecond once cached. Writers (the pull, the delta) and the server
  are separate processes on one WAL file; every upsert carries the row's `updated_at` and only replaces an
  older one, so a pull and a delta can run in either order. The delta writes the text BEFORE it hands the
  vector to the service, so a row the service can return already has its text.

## Install (l7a)

```bash
mkdir -p /data/vector-search/{app,logs}
cp scripts/workers/vector-search/{*.mjs,bootstrap.sh,package*.json} /data/vector-search/app/
(cd /data/vector-search/app && npm ci)        # its own node_modules: usearch (prebuilt linux-arm64) + pg
umask 077; printf 'VECTOR_SEARCH_TOKEN=%s\nVECTOR_SEARCH_PORT=3458\nVECTOR_SEARCH_LOCAL_PORT=3459\n' "$(openssl rand -hex 32)" > /etc/vector-search.env
cp infrastructure/systemd/l7a-search.slice /etc/systemd/system/search.slice && cp infrastructure/systemd/vector-search.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable vector-search
# TLS (phase 4, #6843): Caddy in front, the service on loopback. See infrastructure/caddy/Caddyfile.l7a.
apt-get install -y caddy && cp infrastructure/caddy/Caddyfile.l7a /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d && cp infrastructure/caddy/caddy-slice.conf /etc/systemd/system/caddy.service.d/slice.conf
systemctl daemon-reload && systemctl restart caddy
ufw allow 80/tcp; ufw allow 443/tcp                 # never 3458: the service listens on 127.0.0.1
# Cron: append the four lines of infrastructure/l7a-crontab to root's crontab (back it up first).
setsid nohup systemd-run --scope --quiet --unit=vector-search-bootstrap --slice=sourcelibrary.slice \
  bash /data/vector-search/app/bootstrap.sh >> /data/vector-search/logs/bootstrap.log 2>&1 < /dev/null &
```

Disk: ~23 GB of float32 shards (kept: the recall evals, the exact path's float32 re-score and a rebuild
read them) + ~7 GB per index generation + ~5.9 GB for `exact.i8` + ~19.3 GB for `text/pages.sqlite` (plus ~0.5 GB of fingerprints).

Rotating the token: `openssl rand -hex 32` into `/etc/vector-search.env` (mode 600), `systemctl restart
vector-search` (~5 min until `/health` answers), then the same value in Vercel's `VECTOR_SEARCH_TOKEN`.
