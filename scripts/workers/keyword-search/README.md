# Keyword page service (#6852)

PRIOR ART: `github.com/JDerekLomas/sourcelibrary-atlas` `scripts/local-corpus/` (`index-fts.mjs`,
`search.mjs`, `fuse-lib.mjs`) — the same corpus in SQLite FTS5 on a laptop — and
`scripts/workers/vector-search/` here, whose layout (pull → build → server with a local admin
listener → delta) and app wiring (off / shadow / serve) this copies. Each file names what it took.

The `/api/search` page lane asks Atlas Search (`pages_search`) up to four questions per query and
takes **1.3 s at the median, 2.9 s at p90** in production, with an 8 s ceiling (#6852). This service
answers the same questions from one SQLite FTS5 index. **The app calls it only when
`KEYWORD_SEARCH_MODE` is set** (`src/lib/keyword-search.ts`): `shadow` runs it beside Atlas and logs
`search_queries.keyword_shadow`; `serve` uses its pages and falls back to Atlas on any error or
timeout. Default off.

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
- **Stopwords dropped** from an unquoted query that has other words (`lib.mjs` `STOPWORDS`). Atlas
  keeps them, but their IDF is ~0, and FTS5 scores every page a term matches: "the" alone would mean
  reading every page.
- **Fuzzy** is expanded against the index vocabulary (one edit, same first 4 characters, at most
  50 terms). Expansions are scored as Lucene's fuzzy rewrite does: blended IDF, boost 1 − 1/len.
  Without that, a rare misspelling outranks the word the reader typed.
- **Analyzer**: `lib.mjs` `tokenize` approximates UAX#29 in JS (apostrophe/period between letters
  join; Han and Hiragana one token per character). FTS5 then splits only on the spaces it inserts.
  Known gaps: Thai/Lao/Khmer runs stay whole; a word-final capital sigma lowercases to ς, not σ.

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
   "match": "\"drebbel\" OR \"furnace\"", "fuzzy": false,
   "ms": {"main": 3.1, "variants": 1.2, "counts": 4.0, "extra": 2.2, "total": 11.0}, "server_ms": 11.6}
```

- `book_ids`: `null` means every live book; an array is an allow-list, and `[]` returns nothing.
- `score` is −bm25 (higher is better), with column weights 2 (translation) and 1 (OCR).
- No text is returned. The app hydrates with one `pages.find({id: {$in}})` and drops any page that
  is gone, renumbered to ≤ 0, retyped as non-content, or moved to another book. That read-side check
  is what makes the delta's blind spots harmless (below).
- `GET /health` → `{ok, pages_max_rowid, books, live_books, built_at, checkpoint, last_delta_at, threads, busy, queued, served, errors}`.
- Bodies over 1 MB are refused on the public listener.

Listeners:
- `KEYWORD_SEARCH_HOST:3460` needs the token on every route.
- `127.0.0.1:3461` needs none and also serves `/admin/apply`, `/admin/live` and `/admin/checkpoint`
  (used by `sync-delta.mjs`).

The public listener binds to 127.0.0.1 until the TLS proxy (#6843) fronts it.

## Files

| file | does |
|---|---|
| `lib.mjs` | paths, the tokenizer, the schema, query-string builders, the Mongo client (zlib wire compression) |
| `pull-pages.mjs` | Mongo `pages` → `shards/*.jsonl.gz`, per book on the `(book_id, page_number)` index, resumable |
| `build-fts.mjs` | shards → `index/keyword.sqlite` (tokenizing on worker threads), then `optimize` |
| `engine.mjs` | the lane over the index: main, variants, counts, extra |
| `server.mjs` | HTTP, a pool of query threads (each with its own read-only connection), one writer for the delta |
| `sync-delta.mjs` | pages whose translation/OCR changed since the checkpoint, plus the live-book set, posted to the running service |
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
