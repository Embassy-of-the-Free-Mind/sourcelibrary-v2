# Page-vector service (#6821)

PRIOR ART: `github.com/JDerekLomas/sourcelibrary-atlas` `scripts/local-corpus/` (`pull-embeddings.mjs`,
`build-hnsw.mjs`, `semantic-lib.mjs`) — the same corpus in a usearch HNSW on a laptop. This is that, as a
service on l7a with filters, a delta sync and a unit; each file names what it took and what it changed.

Every semantic page lookup (`semanticPageSearchGlobal` → `match_semantic`) costs ~1.1 s for a new query
vector, because Supabase reads its HNSW index for `page_translations` from disk (#2049). This service holds
the same vectors in an 8-bit HNSW in RAM on l7a and answers in milliseconds. **It is not wired into the
app yet**: that, and a shadow week comparing both paths, is a separate PR after the recall number exists.

## Contract

`POST /match` — same as `match_semantic`, minus the text columns (the app hydrates those by primary key):

```json
{"vector": [768 floats], "k": 15, "threshold": 0.3,
 "filter_language": "Latin", "filter_languages": ["German"], "filter_exclude_languages": ["English"],
 "year_min": 1500, "year_max": 1700}
→ {"rows": [{"page_id": "…", "book_id": "…", "page_number": 12, "similarity": 0.71}], "ms": 2.4, "candidates": 15, "rounds": 1}
```

- **Rows served**: every `page_translations` row with a non-null `embedding` — translated or not, exactly
  the set `match_semantic` searches (7,631,047 on 2026-10-16, not the 4.5M of #2049). Withheld rows
  (`embedding` moved to `embedding_withheld`, #4523) are not served.
- **Filters** are the RPC's predicates on the RPC's columns: `page_translations.book_language` and
  `book_year`, per row, by exact string equality. The caller expands language names (`expandLanguages`)
  before the call, as it does for the RPC. An empty array means no filter. A NULL language passes only the
  exclude list; a NULL year fails any year bound.
- **Threshold**: similarity = 1 − cosine distance, kept when `> threshold` — the RPC's operator.
- **Filtered queries** over-fetch k×4 and widen to k×16 when the filter leaves fewer than k rows. That is
  a post-filter: a very selective filter can return fewer rows than the RPC's iterative scan.
- `GET /health` → `{size, live_rows, book_map_size, built_at, last_delta_at, checkpoint, generation, …}`.
- `k` ≤ 1000. Bodies over 256 KB are refused.

Listeners: `0.0.0.0:3458` needs `Authorization: Bearer $VECTOR_SEARCH_TOKEN` on every route;
`127.0.0.1:3459` needs none and also serves `/admin/apply` and `/admin/save` (used by `sync-delta.mjs`).

## Files

| file | does |
|---|---|
| `lib.mjs` | paths, the Postgres client (`SUPABASE_DB_URL`, read-only), the row store (key → page, language, year) |
| `pull-embeddings.mjs` | Supabase → `shards/shard-<k>.{f32,jsonl}`, keyset on `page_id`, resumable |
| `build-hnsw.mjs` | shards → `index/index-1.usearch` + `rows-1.jsonl` + `state.json`, streamed |
| `server.mjs` | the service |
| `sync-delta.mjs` | rows updated (or withheld) since the checkpoint → the running service; `--save`, `--count-check` |
| `recall-eval.mjs` | overlap@45 vs exact float32 cosine, latency; no Gemini |
| `bootstrap.sh` | pull → build → start → recall → first delta → phase-2 job |
| `crontab.l7a` | the delta lines, **not installed** until the recall check has been read |
| `../../../infrastructure/systemd/vector-search.service` | the unit |

## Choices that are not obvious

- **e4m3, not i8.** usearch casts a unit vector to i8 on a fixed [−1, 1] scale, and these components are
  ~±0.04, so i8 keeps about five levels of each. On 2,000 real rows against exact float32 cosine: similarity
  error mean 0.0129 (i8) vs 0.0015 (e4m3) at the same 917 B/row; overlap 0.951 vs 0.975. f16 would be
  near-exact but 1.7 KB/row, which at 7.6M rows does not fit the slice beside anything else.
- **Delta in the server's process.** `sync-delta.mjs` reads Supabase and posts the rows to `/admin/apply`;
  it does not load its own copy of the index, because two 7 GB copies do not fit the 14 GB slice.
- **Saves are nightly.** `index.save` blocks queries for seconds. Between saves the changes live in RAM;
  a restart reloads the last generation and the next delta re-applies everything after its checkpoint.
  A generation is `index-<g>.usearch` + `rows-<g>.jsonl`, and `state.json` (tmp + rename) is the commit
  point, so a crash mid-save leaves the previous generation intact.
- **Deleted rows** are invisible to a delta keyed on `updated_at`. `--count-check` reports the drift; above
  0.1% it exits 4 and says to rebuild (`bootstrap.sh --rebuild --no-phase2`).
- **Postgres, not PostgREST**, for the pull: 5,000 rows with vectors in 1.9 s per stream from l7a against
  ~11 s per 1,000 over REST. The `translation` column is not pulled.

## Install (l7a)

```bash
mkdir -p /data/vector-search/{app,logs}
cp scripts/workers/vector-search/{*.mjs,bootstrap.sh,package*.json} /data/vector-search/app/
(cd /data/vector-search/app && npm ci)        # its own node_modules: usearch (prebuilt linux-arm64) + pg
umask 077; printf 'VECTOR_SEARCH_TOKEN=%s\nVECTOR_SEARCH_PORT=3458\nVECTOR_SEARCH_LOCAL_PORT=3459\n' "$(openssl rand -hex 32)" > /etc/vector-search.env
cp infrastructure/systemd/vector-search.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable vector-search
ufw allow 3458/tcp comment 'vector-search #6821'
setsid nohup systemd-run --scope --quiet --unit=vector-search-bootstrap --slice=sourcelibrary.slice \
  bash /data/vector-search/app/bootstrap.sh >> /data/vector-search/logs/bootstrap.log 2>&1 < /dev/null &
```

Disk: ~23 GB of float32 shards (kept: the recall eval and a rebuild read them) + ~7 GB per index generation.
