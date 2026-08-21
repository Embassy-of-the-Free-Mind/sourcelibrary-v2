# Entity index + book embeddings — two silent defects, and what's still open

**Date:** 2026-07-28
**PRs:** #3379 (merged + deployed), #3394 (merged), #3396 (this doc change)
**Issue:** #3392 — the open follow-ups
**Started from:** "which extractor runs the re-extraction, and is /encyclopedia worth investing in?"

## What actually happened

The session began as a decision about a proposed ~$299 corpus-wide index re-extraction. Sizing it turned up two live defects that had nothing to do with the decision, and both were more valuable to fix than the re-extraction was to run. The re-extraction is now parked (reasons in #3392).

### Defect 1 — a fifth writer of `entities.books[]`

`CLAUDE.md` documented **four** writers and warned a fix must land in all of them. There were **five**. `src/app/api/[tenant]/books/[id]/index/route.ts` — a near-complete twin of the global index route — never received the #3361 fix that #3363 applied to the fourth. It was still:

- crediting every page of a ~50k-char Gemini batch to every entity in it (the original smearing bug, ~22% of resulting citations real);
- `$addToSet`-ing whole book subdocuments, so a re-index appended a *second* entry for the same book;
- computing `total_mentions` by summing raw page-array lengths across those duplicates.

Reachable: the route's `GET` auto-generates an index on demand, and 110 visible tenant books had none.

### Defect 2 — `book_embeddings` discarded every entity and topic term

`composeBookEmbeddingText` read `.name` on people/places/concepts; `buildConceptIndexFromBatches` emits `{ term, pages, page_precision }`. Every element mapped to `undefined`. Separately, topic terms were keyed on `entries` — a legacy shape on ~1,017 of 18,243 `book_indexes` docs — while the extractor writes `vocabulary` and `keywords`.

Measured on live Supabase: **14,237 of 36,078 rows** contained the literal line `People: , , , ,`; only **1,019** had a `Topics:` line at all. The book-level semantic lane in `/api/search` and `/api/search/unified` had been matching on title, author, summary and section headings alone.

The composer existed in three copies (worker, backfill migration, eval spike) and all three carried both bugs. Collapsed into `scripts/lib/book-embedding-text.mjs`.

## Files modified

| File | Change |
|---|---|
| `src/app/api/[tenant]/books/[id]/index/route.ts` | ported `attributeEntityPages` + section fallback, `$pull`/`$push`, `entityCounters` |
| `scripts/lib/book-embedding-text.mjs` | **new** — single composer + `BOOK_INDEX_EMBEDDING_PROJECTION` |
| `scripts/workers/enrich-worker.mjs` | import the composer, delete the local copy |
| `scripts/migration/backfill-book-embeddings.mjs` | same, + use the shared projection |
| `scripts/eval/librarian-search/_spike-rich-embedding.mjs` | same, + header note invalidating pre-fix runs |
| `scripts/maintenance/repair-entity-page-attribution.mjs` | keyset pagination + DNS-transient retries (cherry-picked, #3394) |
| `tests/unit/book-embedding-text.test.ts` | **new** — 14 assertions |
| `tests/unit/entity-page-attribution.test.ts` | + writer-set guard |
| `CLAUDE.md`, `.claude/docs/embeddings.md` | doctrine updates |

## Outcomes

- `npx tsc --noEmit` clean; **772 unit tests pass** (62 files).
- #3379 merged (`77b93208`) and **deployed to production** — aliased, Cloudflare purged, caches warmed, site 200.
- #3394 merged (`ada77836`); Hetzner pulled it and is at that commit, tree clean, 0 stashes.
- Repair sweep **running on Hetzner as pid 1026341** (setsid, PPID 1, no TTY), resumed from `69c817f26c6f3cc53c848ee8`, ~7,400 books remaining. Progress/log in `/var/log/sourcelibrary/`.
- Sweep effect so far: verified `page_precision` went **37.4% → 58.4%** of entity→book rows; unverified 62.3% → 38.3%.

## Lessons worth keeping

**A guard that passes against the broken code proves nothing.** Both new test files were negative-controlled — reverting the composer fails 8 of 14 assertions; restoring the pre-fix tenant route fails 4 of the writer-set assertions. Without that check they'd have been decorative.

**"Fixed everywhere" is a claim to test, not to assert.** #3361 was declared fixed twice and was wrong both times — #3363 found a fourth writer, this session found a fifth. CLAUDE.md's remedy was "grep for the writer set before declaring one fixed," which relies on a human remembering. That grep now runs on every test run. Prose that asks people to remember something is a weaker guard than a test that remembers for them.

**Silent failure modes need content assertions, not shape assertions.** Both defects produced well-formed output. `People: , , , ,` is valid text; a book page with no index panel renders fine. Nothing throws, nothing logs, and no schema check catches it. The only detection was reading the stored data.

**Duplication is the defect factory.** The tenant index route is ~1,374 lines duplicating ~1,448; the composer had three copies. In both cases the bug was "a fix landed in one copy." Deduping the two index routes is still open and is its own PR.

**Doc instructions rot into traps when infrastructure moves.** CLAUDE.md told people to check `ps aux | grep repair-entity-page-attribution` before deploying. Moving the sweep to Hetzner made that check return nothing while the sweep runs — an all-clear that is actively wrong. Fixed in this PR; the general shape is that a check which *appears* to work is worse than no check.

## CLAUDE.md invariant check

**Yes — three doc changes landed.** The writer count 4 → 5, now test-pinned (#3379). The single-composer rule in `.claude/docs/embeddings.md` (#3379). And the deploy-safety check now naming both machines (#3396, this PR).

## Still open — see #3392

1. ~~Orphaned sweep fixes~~ — done in #3394.
2. Sweep finishing on Hetzner, ~7,400 books.
3. **Re-embed `book_embeddings`** — needs a spend decision. ~36K books × up to 8,000 chars ≈ 70M tokens. Price against the *current* rate; a stale hardcoded constant is exactly how a re-extraction estimate came out at $521 against a true logged cost of $74.27. `--incremental` skips existing rows, so a full re-embed needs a targeted run.
4. **Book index panel** reads `book.index.entries`, present on 5.6% of docs — absent from ~17,200 book pages (276K views/month). Gated on item 2: those arrays still carry fabricated contiguous page runs, so wiring it early would render false citations at 17,000× scale.

Parked: the ~$299 re-extraction. It improves neither recall nor coverage; its marginal product is page-precision on a surface with 471 views/month.
