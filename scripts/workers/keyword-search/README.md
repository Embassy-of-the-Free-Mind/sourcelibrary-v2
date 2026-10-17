# Keyword page service (#6852)

PRIOR ART: `github.com/JDerekLomas/sourcelibrary-atlas` `scripts/local-corpus/` (`index-fts.mjs`,
`search.mjs`, `fuse-lib.mjs`) — the same corpus in SQLite FTS5 on a laptop — and
`scripts/workers/vector-search/` here, whose layout (pull → build → server with a local admin
listener → delta) and app wiring (off / shadow / serve) this copies. Each file names what it took.

## Engine: tantivy, because FTS5 was measured too slow

SQLite FTS5 was tried first, as the brief asked. It was dropped on a measurement: the same 815,900 pages
(8.7% of the corpus) indexed both ways, the same top-25 queries, warm cache, on main:

| query | matching pages | FTS5 top 25 | tantivy top 25 |
|---|---|---|---|
| god | 139,318 | 175 ms | 2.3 ms |
| nature | 142,229 | 313 ms | 2.1 ms |
| nature of god | 237,091 | 323 ms | 3.6 ms |
| the | 593,761 | 978 ms | 8.4 ms |
| alchemy | 13,735 | 23 ms | 0.3 ms |
| "prima materia" (phrase) | 828 | 5 ms | 1.0 ms |

FTS5 scores every page a term matches. It has no top-k pruning, so its time grows with the posting
list: about 2–4 s for a common word over the whole corpus, slower than the Atlas lane it would replace.
Its roll-up count (a full iteration) doubled that. tantivy's block-max WAND skips blocks that cannot
reach the top k. tantivy-py 0.26 also gives:
- a Rust regex tokenizer, so index and query share one analyzer;
- `terms_with_prefix`, for the fuzzy expansion;
- a terms aggregation, for the roll-up counts;
- delete-by-term, for the delta.

So the service is Python (`server.py`, `kwindex.py`, `build_index.py`). The pull and the delta stay in
Node (`pull-pages.mjs`, `sync-delta.mjs`), beside the app's Mongo code.

The `/api/search` page lane asks Atlas Search (`pages_search`) up to four questions per query and
takes **1.3 s at the median, 2.9 s at p90** in production, with an 8 s ceiling (#6852). This service
answers the same questions from one tantivy index. **The app calls it only when
`KEYWORD_SEARCH_MODE` is set** (`src/lib/keyword-search.ts`): `shadow` runs it beside Atlas and logs
`search_queries.keyword_shadow`; `serve` uses its pages and falls back to Atlas on any error or
timeout. Default off.

## Measured (2026-10-17, main box; `scripts/eval/experiments/2026-10-17-keyword-service-parity-6852.md`)

**Footprint and build:**
- 9,341,133 pages from 72,173 books; 35.8 G characters of text. 42,187 of the 42,374 live books have text in it.
- Index: 15.52 GB on disk.
- Pull: 27.8 min. Build: 25.7 min at ~6.4K pages/s, 4 GB writer heap.
- Service process: ~80 MB RSS. The index is memory-mapped, so it lives in the page cache, not the process.
- First delta after the build: ~1,300 pages in 5 s.

**Parity with the Atlas lane** (180 scored logged queries):

| measure | value |
|---|---|
| books@20 | 0.963 |
| page recall@20 | 0.903 |
| lane recall | 0.933 |
| roll-up books@30 | 1.00 |
| top-1 | 1.00 |

**Time:**
- Service, warm: p50 20 ms, p90 147 ms, p99 362 ms.
- Service, cold, read from a network volume: p50 195 ms, p90 491 ms.
- Atlas lane, same queries: p50 787 ms, p90 2,200 ms.

## The Atlas lane's contract (what this reproduces)

Read from `src/app/api/search/route.ts` (the `page` lane), `src/lib/atlas-search.ts`
(`buildPageSearchStage`) and `src/lib/search/page-rollup.ts` on 2026-10-17. When those change, this
section and `engine.mjs` change with them.

- **Index.** `pages_search` maps `translation.data` and `ocr.data`, analyzer `lucene.standard`:
  UAX#29 word tokens, lowercased; no stemming, no stop list, no diacritic folding. The raw field is
  indexed, editorial wrappers (`<meta>`, `<image-desc>`, `<vocab>`…) included (#2236 is open about it).
  **The issue's list was wider than the code.** `stemmedQueryRegex` / `word-forms` is used only by the
  book lane's metadata fallback, not by the page lane. `lexicalPageSearchLang` is the `?lang=` lane
  (Postgres `page_texts`), a different store, and stays as it is.
- **Main query** (`buildPageSearchStage(query, bookIds)`):
  - An unquoted query matches pages printing **ANY** of its words: two `text` clauses,
    translation boost 2 and OCR boost 1, summed BM25.
  - A query wrapped in `"…"` is a `phrase` on both fields.
  - One word of 6+ characters is **fuzzy**: maxEdits 1, prefixLength 4.
  - Filter: `page_number > 0`, plus `book_id` (one id, or `$in` an allow-list; an empty allow-list
    matches nothing, #2760).
  - Then `$match page_type ∉ NON_CONTENT_PAGE_TYPES` and `$limit`: 25 pages, `limit` for one book,
    150–500 for `pages_only`.
- **Name variants** (`expandNameQuery` → `requireNameVariant`). When the query names a person
  `entities` knows, a second query must match one of up to 40 other spellings, plus one topic word
  when there are any. The query's own words still score. Up to 10 pages are appended after the main
  pages, minus duplicates. Not for a quoted phrase.
- **Roll-up** (#5905; not for `book_id` or `pages_only`):
  - `rollupTerms` gives up to 8 non-stopword terms.
  - `countMatchingPagesByBook` counts pages printing **EVERY** term, each as a phrase, faceted on
    `book_id`, top 200 books. It counts hidden books too.
  - The route keeps the live ones (`buildBookFilters()` + `hidden ≠ true`).
  - `bestPagePerBook` then fetches one page each for the first 30 live books the main/variant pages
    did not reach. 4 s budget.
- **Downstream** (unchanged by this service): the join re-applies every book filter and drops hidden
  books. The snippet comes from `highlights` (which field the hit is in) or falls back to
  translation-else-OCR. `pages_only` re-ranks by phrase position (`rankPassages`, from `searchScore`).
  RRF orders the lane by the roll-up counts.

## What the service does differently, on purpose

- **Live books only.** Every list is confined to books that are visible, `pages_count > 0` and not
  hidden: the set `sync-delta.mjs` posts. So the 25 slots and the 200 count buckets are not spent on
  books the route would drop. The parity eval compares against Atlas's *live* pages for that reason.
- **Fuzzy** is expanded against the index vocabulary (`terms_with_prefix`: one edit, same first 4
  characters, at most 50 terms per field). Expansions are scored as Lucene's fuzzy rewrite does:
  blended IDF, boost 1 − 1/len. Without that, a rare misspelling outranks the word the reader typed.
- **Analyzer**: `kwindex.py` `TOKEN_PATTERN`, a tantivy regex tokenizer plus a lowercase filter. It
  approximates UAX#29: an apostrophe or period between letters joins them; Han and Hiragana are one
  token per character. Known gap: Thai/Lao/Khmer runs stay whole (StandardTokenizer segments them by
  dictionary).
- **Stopwords are kept**, as in Atlas: WAND makes them cheap.

## Contract

`POST /lane` (Bearer `KEYWORD_SEARCH_TOKEN`):

```json
{"query": "Drebbel furnace", "k": 25, "book_ids": null,
 "variants": ["Drebelius", "Drebelii"], "topic_words": ["furnace"], "variant_k": 10,
 "rollup": {"terms": ["Drebbel", "furnace"], "buckets": 200, "max_books": 30}}
→ {"main":     [{"page_id": "…", "book_id": "…", "page_number": 12, "score": 23.1, "src": "main"}],
   "variants": [… "src": "variant"],
   "counts":   [{"book_id": "…", "pages": 51}],      // null when no roll-up was asked
   "extra":    [… "src": "rollup"],
   "tokens": ["drebbel", "furnace"], "phrase": false, "fuzzy_terms": 0,
   "ms": {"main": 3.1, "variants": 1.2, "counts": 4.0, "extra": 2.2, "total": 11.0}, "server_ms": 11.6}
```

- `book_ids`: `null` means every live book; an array is an allow-list, and `[]` returns nothing.
- `score` is tantivy's BM25: translation clauses boosted 2, OCR 1, summed as Atlas sums its clauses.
- No text is returned. The app hydrates with one `pages.find({id: {$in}})` and drops any page that
  is gone, renumbered to ≤ 0, retyped as non-content, or moved to another book. That read-side check
  is what makes the delta's blind spots harmless (below).
- `GET /health` → `{ok, pages, segments, live_books, built_at, checkpoint, last_delta_at, served, errors}`.
- Bodies over 1 MB are refused on the public listener.

Listeners:
- `KEYWORD_SEARCH_HOST:3460` needs the token on every route.
- `127.0.0.1:3461` needs none and also serves `/admin/apply`, `/admin/live` and `/admin/checkpoint`
  (used by `sync-delta.mjs`).

The public listener binds to 127.0.0.1 until the TLS proxy (#6843) fronts it.

## Install (the serving box)

```bash
git -C /root/sourcelibrary fetch origin <branch> && git -C /root/sourcelibrary worktree add /data/scratch/kw <branch>
mkdir -p /data/keyword-search/logs
setsid nohup systemd-run --scope --quiet --unit=keyword-search-bootstrap --slice=sourcelibrary.slice \
  bash /data/scratch/kw/scripts/workers/keyword-search/bootstrap.sh /data/scratch/kw \
  >> /data/keyword-search/logs/bootstrap.log 2>&1 < /dev/null &
```

`bootstrap.sh` copies the app, makes the venv, runs `test_engine.py`, writes `/etc/keyword-search.env`
(a fresh token; host 127.0.0.1), and installs the unit. It then streams the pull into the build, starts
the service, runs the first delta and appends the cron line (crontab backed up first). It needs ~28 GB
free: the index is ~16 GB, plus merge headroom. The process is small; the index is memory-mapped, so
free RAM is what keeps it fast. Python 3.9+ with tantivy-py's wheels (x86_64 and aarch64).

## Files

| file | does |
|---|---|
| `kwindex.py` | paths, the schema, the analyzer (one definition for index and queries) |
| `build_index.py` | shards, or a pipe from the pull, → `index/` (built in `index.building`, renamed when complete) |
| `server.py` | the engine (main, variants, counts, extra) and the two HTTP listeners; holds the one index writer |
| `test_engine.py` | self-test on a tiny index (run by `bootstrap.sh` before it installs anything) |
| `lib.mjs` | paths, the Mongo client (zlib wire compression), the page row |
| `pull-pages.mjs` | Mongo `pages` → `shards/*.jsonl.gz`, or `--stdout`, per book on the `(book_id, page_number)` index |
| `sync-delta.mjs` | pages whose translation/OCR changed since the checkpoint, plus the live-book set, posted to the running service |
| `bootstrap.sh` | install → pull \| build → start → first delta → cron, on the serving box |
| `requirements.txt` | tantivy (the Python half's only package) |
| `../../eval/keyword-lane-parity/` | the parity eval against the Atlas lane on logged queries |
| `../../../infrastructure/systemd/keyword-search.service` | the unit |
| `crontab` | the delta line |

## Freshness

- **Every 10 min** (`sync-delta.mjs`): pages whose `translation.updated_at` or `ocr.updated_at` is at
  or after the checkpoint are upserted or removed, on each field's own index, oldest first, with `$gte`
  (boundary timestamps are re-read, and re-applying a page is harmless). Then the live-book set is
  posted. The server refuses a set under 1,000 books, so a failed read cannot empty the results.
- **Not seen by the delta**: a page deleted outright, or renumbered without a text edit. Both stay in
  the index until the next rebuild, and the app's hydration drops them, so a reader never sees one.
  The cost is a slot in the top 25. Rebuild when that drift matters (a full pull is ~1 h, the build ~1 h).
