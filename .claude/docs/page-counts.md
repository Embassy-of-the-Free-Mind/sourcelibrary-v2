# Page counts: one convention, one writer, an audit that reads `pages`

PRIOR ART: `scripts/lib/page-counts.mjs` (+ TS twin `src/lib/page-counts.ts`) — owns the visible-page convention and the canonical per-book pipeline, but not the write: 29 writers import it and each writes its own subset. `tests/unit/page-counter-writers.test.ts` — a ratchet on four of the six counters, `$set` only; it cannot see `$inc`, hoisted update objects, `pages_blank` or `pages_archived`. `.claude/docs/invariants/visibility-and-stats.md` — records the numerator/denominator incidents, not the writers. `translation-state.md` (#3402) — the sibling doc; it consumes these counters and names the quantities built from them.

**Read this when:** writing any of `pages_count`, `pages_ocr`, `pages_translated`, `pages_translatable`, `pages_blank`, `pages_archived` on a `books` document; adding a job that creates, hides, splits, OCRs, translates, clears or archives pages; dividing by one of those counters on a surface; or investigating a count that disagrees with what the reader shows.

**Status:** design, 2026-09-30. Tracking issue #4499 (writer burn-down), umbrella #5302. The migration steps below are the issues linked from both. Until step 2 lands, two definitions of `pages_ocr` and `pages_blank` are live and alternate every two hours (see "Why this exists").

---

## Who reads a page count, and what breaks their trust

1. **A reader on a book page.** "N scans", "N of M translated", the reader's page strip. A count that includes soft-hidden pages prints scans the reader can never open. A stale counter says "This edition is not yet translated" over 581 pages of English: the 2026-07-20 *Histoire de la magie* incident, where the sibling notice read a counter of 20.
2. **Every derived ratio.** The translation ladder (`translation-state.md`), the first-translation badge gate, the sibling notice (< 5%), collection counters, the spend page roadmap. All of them divide by these counters, so a drifted denominator moves every rung at once.
3. **Operators pricing work.** Pages remaining × unit cost. A counter that drifts HIGH understates the backlog. Every drift measured so far has been high (#4451: 6 of 120 sampled; below: 26 book-counter pairs in a 300-book sample).

A count is trusted when the same book gives the same number on the book page, in the ladder and on the spend page, and that number is what a recount of `pages` returns.

## Why this exists

The counters are nearly exact, but not because the writers are right. The two-hourly reconciler overwrites them. Measured 2026-09-30 on a random sample of 300 live books (`visible: true && pages_count > 0`, 42,009 books), comparing each stored counter with `buildVisiblePageCountPipeline()` run on the book's `pages`:

| counter | books off | direction | cause |
|---|---:|---|---|
| `pages_count` | 0 / 300 | — | exact |
| `pages_translated` | 0 / 300 | — | exact |
| `pages_ocr` | 8 / 300 (283 pages) | all HIGH | the reconciler counts `ocr.unreadable` pages (#4523); the canonical pipeline does not. All 8 match the reconciler's own predicate exactly |
| `pages_blank` | 16 / 300 | stored lower | two definitions: the reconciler counts `page_type = 'blank'`; the canonical `blank` counts all five never-translated types. All 16 match the reconciler |
| `pages_translatable` | 76 / 300 missing, 18 / 300 stale (44 pages) | stale ones all HIGH | the reconciler never writes it; only the manual recount and three job-time writers do |
| `pages_archived` | 0 / 300 against visible pages; 11 / 300 against all pages | — | the reconciler counts visible pages; `archive-images/route.ts` counts all pages. Both write it; the reconciler wins every 2 h |

So the problem is not the counter recount (exact on `pages_count` and `pages_translated`, as the 393-book recount of 2026-09-29 also found). The problem is that there are **five implementations of the rule** and they disagree:

1. `buildVisiblePageCountPipeline()` / `countVisiblePageStats()`: the canonical module.
2. The reconciler's own aggregation in `scripts/workers/sync-worker.mjs`, which does not import the module. It is the fifth copy and the one that always wins.
3. 44 live files that write counters with a private count or a partial one (inventory below). 32 of them are the #4499 baseline; 12 more are invisible to the ratchet test.
4. Two `$inc` writers (`pipeline-orchestrator.mjs` Phase 1.97 trailing-dupe dedup, and `dedup-ia-trailing-pages.mjs`), which drift by construction on any retry. The orchestrator also subtracts `run_len` while hiding `dupes_to_hide.length` pages, two numbers nothing forces to be equal.
5. 77 book-creation paths that set `pages_count` at insert and never set `pages_translatable`.

Two of those alternate on live books today: `src/lib/job-completion.ts` writes the canonical wide `pages_blank` when a translation job completes, and the reconciler narrows it again within two hours. `recount-page-stats.mjs` writes the canonical `pages_ocr`, and the reconciler adds the unreadable pages back.

**The 10,282 live books without `pages_translatable`** (24.5% of live books, 850,719 pages) are not mostly books imported since the 2026-08-31 backfill, as `page-counts.mjs` and #5292 assume. Only 157 were created after it. 10,064 were created in June–July 2026, and **10,134 of the 10,282 have no translated page at all**. The backfill evidently covered books with translations. Under the ladder's fallback (`translatable = whole`) the 148 with translations can only read lower, so the gap understates. It never overstates.

## The counters

Six counters, one convention, all over **visible pages only**: `page_number > 0` (`VISIBLE_PAGE_MATCH`, #3293). A page with `page_number ≤ 0` is a deliberate soft-hide (a dropped duplicate spread, a junk scan). It never renders, and it is in no counter.

| counter | counts visible pages that… | JS predicate (`page-counts.mjs`) |
|---|---|---|
| `pages_count` | exist | `isVisiblePage` |
| `pages_ocr` | carry servable OCR: non-empty `ocr.data`, not `ocr.unreadable` | `hasOcr` |
| `pages_translated` | carry non-empty `translation.data` and are not `page_type: 'blank'` | `isTranslatedPage` |
| `pages_blank` | are `page_type: 'blank'` **and** carry OCR | `isBlankPage && hasOcr` (see decision 3) |
| `pages_translatable` | could ever be translated: not a never-translated type, not a text-free illustration, not permanently refused; **pages awaiting OCR included** (#4516) | `isTranslatablePageForCount` |
| `pages_archived` | carry a non-empty `archived_photo` | new `isArchivedPage` |

Rules that already hold and stay:

- **A numerator excludes whatever its denominator excludes** (#3747). `pages_translated` excludes blank leaves because `whole` and the old `readable` subtract `pages_blank`. The Blue Qur'an's 1000% is the failure. `pages_blank` and the `pages_translated` exclusion must therefore name **the same page types**. Today the canonical module violates this: its `blank` is five types, its `with_translation` excludes one. Decision 3 settles it.
- **Pending is not impossible.** A page with no OCR yet is in `pages_translatable` (#4516). Theatrum Chemicum vol. 6 read 100% translated with 2,195 pages carrying no text when it was not.
- **`ocr.text_free`** is the stamp that lets Mongo exclude text-free illustrations. It is computed in JS by `isTextFreeIllustration()`. An unstamped page stays in the denominator, which is the safe direction.

## Named quantities

These are built from the counters. `translation-state.md` owns their use, and this doc owns their inputs. A surface computes them through `page-counts` helpers, never inline.

| name | definition | used by |
|---|---|---|
| **whole** | `pages_count − pages_blank` | ladder coverage, the `translatable` fallback |
| **translatable** | `pages_translatable` if a number, else **whole** | ladder, `translationCompleteness()`, spend page |
| **coverage** | `pages_ocr / whole` (the ladder's bar is 0.9) | ladder `transcribing` vs `transcribed` |
| **completion** | `pages_translated / translatable`, clamped to 100% | per-book percentage |
| **remaining** | `max(0, translatable − pages_translated)` | backlog pricing |
| **archive progress** | `pages_archived / pages_count` | archive selectors, watchdog |

`translation_percent` (stored) has had no writer since the `sync-page-counts` cron was archived (`src/lib/translation-percent.ts` header). It is not a quantity. `translation-state.md` step 7 deletes it.

## The single writer

**`recountBook(db, bookId, { reason })`** in `scripts/lib/page-counts.mjs`, with a TS twin in `src/lib/page-counts.ts`.

- It runs `buildVisiblePageCountPipeline(bookId)` (extended with the `archived` accumulator) and `$set`s **all six counters together**, plus `page_counts_at: now`. It never writes a subset and never uses `$inc`. The cost is one indexed aggregation over one book's pages: milliseconds for a normal book, about a second for the largest.
- Returns `{ before, after, changed }`, so a caller can log a drift without re-reading.
- It does not stamp `ocr.text_free`. That stays in `recount-page-stats.mjs`, which is the only place a page is read in JS. A page without the stamp is counted as translatable (the safe default).
- It does not write translation flags or `translation_state`. The reconciler derives those from the counters (see `translation-state.md` §"The single writer").

**The shared accumulator.** The `$group` body moves into one exported constant, `PAGE_COUNT_ACCUMULATORS`. `buildVisiblePageCountPipeline(bookId)` groups one book with it, and a new `buildCorpusPageCountPipeline()` groups all books by `book_id` with the **same object**. The reconciler imports the corpus variant and deletes its private copy. That ends the fifth implementation. A parity test runs both pipelines' predicates against `countVisiblePageStats()` on one fixture of edge pages: hidden, unreadable, blank with placeholder, exlibris with OCR, text-free illustration stamped and unstamped, refused, awaiting OCR, archived `failed:*`.

**Who calls it** (full list in the inventory below):

| caller | when |
|---|---|
| every job that changes a page's existence, `page_number`, `page_type`, OCR, translation or `archived_photo` — batch collectors, realtime OCR/translate, split/dedup/ghost-page workers, clear-OCR, archive workers and the archive route, page PATCH/split routes | once per book, after its page writes, before returning |
| `recount-page-stats.mjs` | the manual corrective: stamps `text_free`, then calls `recountBook()` instead of its own `$set` |
| book creation | not called: creation declares `initialPageCounters(n)` (`pages_count = pages_translatable = n`, the rest 0) through `makeBookDoc()`, which is honest because every page is pending. The next job or the reconciler corrects it |
| the reconciler | does not call it per book. It runs the corpus pipeline and writes all six counters on mismatch, including `pages_translatable` |

**Why job-time writes stay** (decision 1). The alternative is to delete every job-time counter write and let the reconciler do it. That is simpler, but it brings back the *Histoire de la magie* symptom for up to two hours after every translation job. It also blinds the orchestrator, whose selectors read `pages_archived` and `pages_ocr` between phases (a book archived by the route used to stay eligible for re-archiving, #3712). One aggregation per book per job is cheap. What made job-time writers dangerous was the private counting in each of them, and `recountBook()` removes that.

## The reconciler

`scripts/workers/sync-worker.mjs`, every 2 h on Hetzner (`infrastructure/hetzner-crontab`, installed; last three runs checked 117,140–117,141 books in about 20 min and corrected 13–42 each). It is the **safety net**, not the mechanism:

- It uses the shared accumulator and writes all six counters on mismatch. That includes `pages_translatable`, which it does not write today. Its first run after step 2 therefore writes the 10,282 missing and the stale-high ones. It is a data write by a cron, so it is decision 2.
- It logs a per-counter mismatch tally (`count 3, ocr 12, translatable 40…`) instead of one number. A reconciler that fixes a lot of one counter is reporting a broken job-time writer, and today nobody can tell which counter it fixed.
- It stays pause-exempt. The counters describe pages that exist whether or not the pipeline runs.

## Freshness

| number | source | staleness bound |
|---|---|---|
| a counter after a pipeline job | `recountBook()` in the job | job latency (minutes) |
| a counter after any other write to `pages` (manual scripts, an unconverted writer) | reconciler | ≤ 2 h + ~20 min run |
| `pages_translatable` on unstamped illustration pages | reads high (safe) until `recount-page-stats.mjs` stamps `text_free` | until the next manual recount |
| derived rung, flags | reconciler, from the counters | ≤ 2 h (`translation-state.md`) |
| Supabase `books_catalog` counters | `sync-books-catalog.mjs` | its cadence |

`page_counts_at` on the book says when a real recount last wrote it. A surface that needs to know whether a count is fresh reads that field, never `updated_at`, which every writer touches.

## The audit

`scripts/audit/page-count-audit.mjs`, daily on Hetzner, exit 1 = FAIL. It files or updates one GitHub issue on FAIL and closes it when the next run passes (`measurement-instruments.md` rules for scheduled detectors).

1. **Recount a random sample** of 300 live books from `pages` with `buildVisiblePageCountPipeline()`, compare all six stored counters. FAIL when more than 1% of books disagree on any counter, and FAIL on **any** counter stored HIGHER than the recount by more than the pages written in the last 2 h. High is the direction that overclaims. Skip books with a page write in the last 2 h (`page_counts_at`), because the reconciler has not had its turn.
2. **Missing-field check**: live books without a numeric `pages_translatable`. FAIL above 100 and on any week-over-week growth. This is #5292(a)'s definition of done, made standing.
3. **Positive control, every run:** perturb one sampled book's stored counter in memory and require the comparator to flag it. A run whose control does not fire reports `probe_broken`, never PASS.
4. **Negative control, once, recorded in the PR:** on one hidden test book, `$inc` `pages_translated` by 5, run, watch it go red, restore with `recountBook()`.

Today's numbers against these rules: rule 1 would FAIL on `pages_ocr` (2.7%), `pages_blank` (5.3%) and `pages_translatable` (6.0% stale-high). Rule 2 would FAIL at 10,282. Those failures are the design working. Steps 2 and 6 make them pass.

**The shape guard.** `tests/unit/page-counter-writers.test.ts` is widened so it can go red on the writers it misses today (`tests-that-are-not-guards.md`: vary the shape, not just the content):

- all six counters, not four;
- `$inc` as well as `$set`/`$setOnInsert`;
- the hoisted form, where the update object is built in a variable (`const update = { pages_archived: n }`), matched as any object literal with a counter key in a file that writes `books`;
- the rule becomes **"only `page-counts.mjs`/`page-counts.ts` and `recount`-named functions inside them may write a counter"**, not "the file imports the module". Importing the module and writing a subset passes today, and that is how `realtime-ocr.mjs` writes `pages_ocr` alone.

Negative controls in the PR: one violating file per shape (inline `$set`, hoisted object, `$inc`) turns the test red and names the file. The baseline becomes the full live list from the inventory, and it shrinks to zero. Creation paths go through `makeBookDoc()` and are exempt by construction.

## Migration, in independently mergeable steps

Each step is a GitHub issue linked from #4499 and #5302. The order is writer, reconciler, then callers, then creation, then the long tail, then the audit.

1. **Writer.** `PAGE_COUNT_ACCUMULATORS`, `buildCorpusPageCountPipeline()`, `isArchivedPage`, `recountBook()` in both twins. Decision 3 applied to `blank`. Parity test and the widened shape guard with the full baseline. `recount-page-stats.mjs` calls `recountBook()`. No caller changes and no data writes.
2. **Reconciler.** `sync-worker.mjs` imports the corpus pipeline, writes all six counters including `pages_translatable`, and logs per-counter tallies. **This is the data write** for the 10,282 books and the stale-high ones (decision 2). It lands with a dry-run tally in the PR.
3. **Live writers.** Request-path routes (tenant and global twins together), workers, batch collectors, archive writers, and both `$inc` sites call `recountBook()`. Each file leaves the baseline in the same commit. The `pages_archived` all-pages predicate in `archive-images/route.ts` goes. Per-file before/after on a book with soft-hidden pages.
4. **Creation.** `initialPageCounters(n)` in `makeBookDoc()`. The import routes and `insertBookIfNew()` use it. The importers that hand-build documents are the #3969/`field-sprawl.md` burn-down; they are not new work here.
5. **One-off scripts.** The 27 maintenance scripts call `recountBook()` when next run or touched. Scripts with no run in 90 days move to `scripts/_archived/`, which is a move, not a deletion. `scripts/tmp-*` writers are archived.
6. **Audit** as above, plus the Hetzner crontab line and a dated run recorded on the issue.

The ladder's `translation-state.md` step 8(a) and (b) are steps 2 and 3 here. Its step 8(c), `content_type`, is not a page count and stays with #5292.

## Decisions Derek owns (defaults in bold)

1. **Job-time writers call `recountBook()`. They are not deleted in favour of the 2 h reconciler.** Alternative: delete the counter writes from all 44 live writers and accept up to 2 h of stale counts after every job.
2. **The reconciler writes `pages_translatable`, and its first run fills the 10,282 books without it and corrects the stale ones.** This is a data write by a cron, and each book moves by a recount of its own pages. The alternative is a one-off `recount-page-stats.mjs --missing-translatable --apply`, which also stamps `text_free` but walks 850,719 pages in JS.
3. **`pages_blank` means `page_type: 'blank'` only, as stored today. The other never-translated types (exlibris, bookplate, digitizer notices and inserts) leave the denominator through `pages_translatable`, not `pages_blank`.** This keeps the #3747 rule (blank-leaf numerator and denominator name the same set), matches every stored value, and changes the canonical module rather than the data. Alternative: widen `pages_blank` and the `pages_translated` exclusion to all five types. That moves `pages_translated`, the input to every headline, on an unmeasured number of books.
4. **`pages_ocr` excludes `ocr.unreadable` pages (the canonical rule, #4523).** On about 2.7% of live books the reconciler's next run lowers `pages_ocr` (283 pages in the sample, Tibetan unreadable leaves). That is the correct direction: those pages are not served.

## The numbers today

Measured 2026-09-30 on a 300-book random sample of 42,009 live books. `pages_count` and `pages_translated` are exact. `pages_ocr` is high on 2.7% of books, `pages_blank` follows the non-canonical definition on 5.3%, and `pages_translatable` is missing on 24.5% of live books (10,282 counted, 10,134 of them untranslated) and stale-high on 6%. Every drift found runs high. A reader today can see a scan count or a translated count that is wrong only in the ways listed above, and a ladder rung can be too low but not too high.

## Do not

- Do not write a counter outside `recountBook()` or the reconciler. That includes `$inc`, a "known value" such as `pages_count: pages.length` after an edit, and a subset.
- Do not count all pages. `page_number > 0` is the only convention. A tool that needs hidden pages counts them into its own local variable, never into a `books` field.
- Do not add a seventh counter without adding it to `PAGE_COUNT_ACCUMULATORS`, the parity fixture, the shape guard and the audit in the same PR.
- Do not fix a drifted book by hand-setting its counter. Call `recountBook()`, which is what the audit and the reconciler would do anyway.

---

## Appendix: every writer of a page counter, 2026-09-30

Found by scanning every tracked `.mjs/.ts/.tsx/.js/.py` file outside `tests/` and `.claude/` for an update object (`$set`, `$setOnInsert`, `$inc`) or insert that names one of the six counters. That list was cross-checked with a line scan for counter keys in hoisted objects, which added the 5 writers marked "hoisted" and 6 creation routes. All 32 files in `tests/fixtures/page-counter-writers-baseline.json` are in the table. Lambdas (`scripts/aws-lambda/`) write no counter. "Canonical module" means the file imports `page-counts` today. That tells you the counting rule is shared, not that the file writes all six counters together.

Groups: **Reconciler** 1 · **Manual recount** 1 · **Request path** 19 · **Worker / batch** 9 · **Archive counter** 10 · **One-off script** 27 · **Book creation** 77 · **Not live** 12. Live writers with a private count: 44.

| # | file | writes | group | in #4499 baseline | today | becomes |
|---:|---|---|---|:-:|---|---|
| 1 | `scripts/workers/sync-worker.mjs` | $set count, ocr, translated, blank, archived | Reconciler |  | private aggregation (imports `page-counts` only for the flags) | Reconciler. Imports the shared accumulator; adds `pages_translatable`; step 2 |
| 2 | `scripts/maintenance/recount-page-stats.mjs` | $set count, ocr, translated, translatable | Manual recount |  | canonical module | Manual corrective. Calls `recountBook()`; keeps the `ocr.text_free` stamp; step 1 |
| 3 | `src/app/api/[tenant]/books/[id]/batch-translate-async/route.ts` | $set translated | Request path |  | canonical module | Calls `recountBook()` after its page write; step 3 |
| 4 | `src/app/api/[tenant]/pages/[id]/route.ts` | $set count | Request path | yes | private count | Calls `recountBook()` after its page write; step 3 |
| 5 | `src/app/api/[tenant]/pages/[id]/split/route.ts` | $set count | Request path | yes | private count | Calls `recountBook()` after its page write; step 3 |
| 6 | `src/app/api/[tenant]/pages/batch-split/route.ts` | $set ocr, translated | Request path | yes | private count | Calls `recountBook()` after its page write; step 3 |
| 7 | `src/app/api/admin/backfill-cropped-images/route.ts` | $set count, ocr, translated | Request path | yes | private count | Calls `recountBook()` after its page write; step 3 |
| 8 | `src/app/api/admin/sync-page-counts/route.ts` | $set count, ocr, translated | Request path |  | canonical module | Calls `recountBook()` after its page write; step 3 |
| 9 | `src/app/api/books/[id]/auto-split-ml/route.ts` | $set ocr, translated | Request path | yes | private count | Calls `recountBook()` after its page write; step 3 |
| 10 | `src/app/api/books/[id]/batch-translate-async/route.ts` | $set count, ocr, translated, translatable | Request path |  | canonical module | Calls `recountBook()` after its page write; step 3 |
| 11 | `src/app/api/books/[id]/clear-ocr/route.ts` | $set ocr, translated | Request path | yes | private count | Calls `recountBook()` after its page write; step 3 |
| 12 | `src/app/api/books/[id]/import-batch/route.ts` | $set ocr, translated | Request path | yes | private count | Calls `recountBook()` after its page write; step 3 |
| 13 | `src/app/api/contribute/process/route.ts` | $set ocr, translated | Request path | yes | private count | Calls `recountBook()` after its page write; step 3 |
| 14 | `src/app/api/cron/storage-stats/route.ts` | $set translated | Request path | yes | private count | Calls `recountBook()` after its page write; step 3 |
| 15 | `src/app/api/pages/[id]/route.ts` | $set count | Request path | yes | private count | Calls `recountBook()` after its page write; step 3 |
| 16 | `src/app/api/pages/[id]/split/route.ts` | $set count | Request path | yes | private count | Calls `recountBook()` after its page write; step 3 |
| 17 | `src/app/api/pages/batch-split/route.ts` | $set ocr, translated | Request path | yes | private count | Calls `recountBook()` after its page write; step 3 |
| 18 | `src/app/api/process/route.ts` | $set translated | Request path | yes | private count | Calls `recountBook()` after its page write; step 3 |
| 19 | `src/lib/job-completion.ts` | $set ocr, translated, translatable, blank | Request path |  | canonical module | Calls `recountBook()` after its page write; step 3 |
| 20 | `src/lib/page-split/dedup-overlapping-pages.ts` | $set count, ocr, translated, translatable, blank | Request path |  | canonical module | Calls `recountBook()` after its page write; step 3 |
| 21 | `src/lib/page-split/detect-ghost-pages.ts` | $set count, ocr, translated, translatable, blank | Request path |  | canonical module | Calls `recountBook()` after its page write; step 3 |
| 22 | `scripts/batch/collect-batch-results.mjs` | $set count, ocr, translated | Worker / batch |  | canonical module | Calls `recountBook()` once per book at the end of the job; step 3 |
| 23 | `scripts/batch/collect-multipage-ocr.mjs` | $set count, ocr, translated | Worker / batch |  | canonical module | Calls `recountBook()` once per book at the end of the job; step 3 |
| 24 | `scripts/batch/realtime-ocr.mjs` | $set ocr | Worker / batch |  | canonical module | Calls `recountBook()` once per book at the end of the job; step 3 |
| 25 | `scripts/batch/realtime-translate.mjs` | $set translated | Worker / batch |  | canonical module | Calls `recountBook()` once per book at the end of the job; step 3 |
| 26 | `scripts/workers/batch-collector.mjs` | $set count, ocr, translated | Worker / batch |  | canonical module | Calls `recountBook()` once per book at the end of the job; step 3 |
| 27 | `scripts/workers/mineru-ocr-worker.mjs` | $set ocr | Worker / batch | yes | private count | Calls `recountBook()` once per book at the end of the job; step 3 |
| 28 | `scripts/workers/pipeline-orchestrator.mjs` | **$inc** count | Worker / batch |  | canonical module | Calls `recountBook()` once per book at the end of the job; step 3 |
| 29 | `scripts/workers/syriac-kraken-lane.mjs` | $set ocr, translated | Worker / batch |  | canonical module | Calls `recountBook()` once per book at the end of the job; step 3 |
| 30 | `scripts/workers/translate-worker.mjs` | $set translated | Worker / batch | yes | private count | Calls `recountBook()` once per book at the end of the job; step 3 |
| 31 | `scripts/catalog-coverage/archive-acquired.ts` | $set archived | Archive counter |  | private count | `recountBook()` (archived counter is one of the six); step 3 |
| 32 | `scripts/import/claremont-nag-hammadi.mjs` | $set archived | Archive counter |  | private count | `recountBook()` (archived counter is one of the six); step 3 |
| 33 | `scripts/workers/archive-bulk.mjs` | $set archived | Archive counter |  | private (hoisted `$set`, invisible to the ratchet) | `recountBook()` (archived counter is one of the six); step 3 |
| 34 | `scripts/workers/archive-eap.mjs` | $set archived | Archive counter |  | private count | `recountBook()` (archived counter is one of the six); step 3 |
| 35 | `scripts/workers/archive-erara.mjs` | $set archived | Archive counter |  | private count | `recountBook()` (archived counter is one of the six); step 3 |
| 36 | `scripts/workers/archive-gallica.mjs` | $set archived | Archive counter |  | private count | `recountBook()` (archived counter is one of the six); step 3 |
| 37 | `scripts/workers/archive-harvard.mjs` | $set archived | Archive counter |  | private count | `recountBook()` (archived counter is one of the six); step 3 |
| 38 | `scripts/workers/archive-iiif-local.mjs` | $set archived | Archive counter |  | private (hoisted `$set`, invisible to the ratchet) | `recountBook()` (archived counter is one of the six); step 3 |
| 39 | `scripts/workers/archive-ocr.mjs` | $set archived | Archive counter |  | private (hoisted `$set`, invisible to the ratchet) | `recountBook()` (archived counter is one of the six); step 3 |
| 40 | `src/app/api/books/[id]/archive-images/route.ts` | $set archived | Archive counter |  | private (hoisted `$set`, invisible to the ratchet) | `recountBook()` (archived counter is one of the six); step 3 |
| 41 | `scripts/dedup-apply-approved.mjs` | $set count | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 42 | `scripts/dedup-autoapply.mjs` | $set count | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 43 | `scripts/force-restore-hidden-pages.mjs` | $set count | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 44 | `scripts/import-naj-sancai.mjs` | $set count | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 45 | `scripts/import/cdli-atf-source.mjs` | $set ocr, translated | One-off script |  | canonical module | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 46 | `scripts/import/oraec-paginate-translate.mjs` | $set count, ocr, translated | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 47 | `scripts/maintenance/apply-reocr-verdicts.mjs` | $set ocr, translated | One-off script |  | canonical module | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 48 | `scripts/maintenance/bph-nas-ingest.mjs` | $set count | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 49 | `scripts/maintenance/cleanup-dead-pages.mjs` | $set count | One-off script |  | private (hoisted `$set`, invisible to the ratchet) | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 50 | `scripts/maintenance/dedup-ia-trailing-pages.mjs` | **$inc** count | One-off script |  | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 51 | `scripts/maintenance/fix-batch-contamination.mjs` | $set ocr, translated | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 52 | `scripts/maintenance/fix-duplicate-page-numbers.mjs` | $set count | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 53 | `scripts/maintenance/fix-ia-page-counts.ts` | $set count, ocr, translated | One-off script |  | canonical module | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 54 | `scripts/maintenance/fix-translation-loops.mjs` | $set translated | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 55 | `scripts/maintenance/flag-ia-empty-target-pages.mjs` | $set count, ocr, translated | One-off script |  | canonical module | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 56 | `scripts/maintenance/hide-cdli-fabricated.mjs` | $set ocr, translated | One-off script |  | canonical module | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 57 | `scripts/maintenance/quarantine-fabricated-ocr.mjs` | $set ocr | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 58 | `scripts/maintenance/rearchive-iiif-fullres.mjs` | $set count, ocr, translated | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 59 | `scripts/maintenance/repair-bulkjp2-text-shift.mjs` | $set ocr, translated | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 60 | `scripts/maintenance/repair-erara-text-shift.mjs` | $set ocr, translated | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 61 | `scripts/maintenance/repair-ia-ocr-leaf-offset.mjs` | $set count, ocr, translated | One-off script |  | canonical module | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 62 | `scripts/maintenance/reset-book-ocr.mjs` | $set ocr, translated | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 63 | `scripts/maintenance/withhold-stale-translations.mjs` | $set count, ocr, translated, translatable | One-off script |  | canonical module | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 64 | `scripts/recount-pages-count-deduped.mjs` | $set count | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 65 | `scripts/repair-foreign-folder-pair.mjs` | $set count, ocr, translated | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 66 | `scripts/split-book.mjs` | $set count, ocr, translated, blank | One-off script |  | canonical module | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 67 | `scripts/split-pecha.mjs` | $set count | One-off script | yes | private count | Calls `recountBook()` when next run or touched; if unused for 90 days, move to `_archived/`; step 5 |
| 68 | `scripts/experiments/batch-size-experiment.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 69 | `scripts/iiif-discovery/import-from-cache.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 70 | `scripts/iiif-discovery/import-leiden-artworks.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 71 | `scripts/iiif-discovery/import-leiden-books.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 72 | `scripts/import-aic-artworks.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 73 | `scripts/import-cleveland-artworks.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 74 | `scripts/import-commons-artworks.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 75 | `scripts/import-getty-artworks.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 76 | `scripts/import-met-artworks.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 77 | `scripts/import-nga-artworks.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 78 | `scripts/import-rijks-artworks.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 79 | `scripts/import/al-badri-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 80 | `scripts/import/batch-import-istc-bsb.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 81 | `scripts/import/bncf-aldine-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 82 | `scripts/import/bsb-from-file.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 83 | `scripts/import/ccag-vii-pdf-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 84 | `scripts/import/chilam-balam-calkini-byu.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 85 | `scripts/import/chilam-balam-gates-byu.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 86 | `scripts/import/chilam-balam-kaua-maler-byu.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 87 | `scripts/import/direct-import-cosmogony.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 88 | `scripts/import/early-america-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 89 | `scripts/import/fetch-wikisource-javanese.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 90 | `scripts/import/founders-collected-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 91 | `scripts/import/founding-chase.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 92 | `scripts/import/founding-docs-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 93 | `scripts/import/founding-enrich-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 94 | `scripts/import/founding-influences2-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 95 | `scripts/import/founding-tail-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 96 | `scripts/import/fragmenta-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 97 | `scripts/import/gallica-islamic-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 98 | `scripts/import/gallica-plethon-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 99 | `scripts/import/harvard-iiif-direct-batch.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 100 | `scripts/import/harvard-philosophy-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 101 | `scripts/import/harvard-wuzhen-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 102 | `scripts/import/ia-bundle-import.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 103 | `scripts/import/ia-manifest-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 104 | `scripts/import/iiif-direct-import.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 105 | `scripts/import/import-artwork.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 106 | `scripts/import/import-hashika-e-posters.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 107 | `scripts/import/import-idp-batch.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 108 | `scripts/import/import-kloss-collection.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 109 | `scripts/import/import-met-egyptian.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 110 | `scripts/import/import-pdf-books.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 111 | `scripts/import/import-rijksmuseum-artworks.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 112 | `scripts/import/import-sefaria.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 113 | `scripts/import/import-thirukkural.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 114 | `scripts/import/import-umn-health-texts.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 115 | `scripts/import/jefferson-canon-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 116 | `scripts/import/marcianus-299-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 117 | `scripts/import/met-shunga-albums-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 118 | `scripts/import/ndl-daoist-import.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 119 | `scripts/import/new-world-wave.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 120 | `scripts/import/pdf-direct.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 121 | `scripts/import/popol-wuj-ximenez-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 122 | `scripts/import/shwep-curator-pass-import.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 123 | `scripts/import/syriac-canon-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 124 | `scripts/import/tartu-dspace-pdf-direct.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 125 | `scripts/split-book-v2.mjs` | insert | Book creation |  | canonical module | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 126 | `scripts/workers/batch-split-bph.mjs` | insert | Book creation |  | canonical module | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 127 | `scripts/workers/enrichment-snapshot.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 128 | `scripts/workers/erara-import-queue.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 129 | `scripts/works-catalog/import-cbeta-text.mjs` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 130 | `src/app/api/books/roadmap/route.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 131 | `src/app/api/books/route.ts` | insert | Book creation |  | canonical module | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 132 | `src/app/api/import/e-rara/route.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 133 | `src/app/api/import/gallica/route.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 134 | `src/app/api/import/google-books/route.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 135 | `src/app/api/import/ia/route.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 136 | `src/app/api/import/iiif/route.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 137 | `src/app/api/import/loc/route.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 138 | `src/app/api/import/mdz/route.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 139 | `src/app/api/import/pdf/route.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 140 | `src/app/api/import/route.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 141 | `src/app/api/import/wellcome/route.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 142 | `src/app/api/scan/create/route.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 143 | `src/lib/import-utils.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 144 | `src/lib/uploads/utils.ts` | insert | Book creation |  | declared at insert | Book creation: `initialPageCounters(n)` via `makeBookDoc()`; step 4 |
| 145 | `scripts/_archived/2026-07-hygiene/maintenance/batch-fix-ia-page-counts.ts` | $set count, ocr, translated | Not live |  | canonical module | Not live (archived / migration / tmp). No change; excluded from the guard |
| 146 | `scripts/_archived/2026-07-hygiene/maintenance/fix-inflated-page-counts.mjs` | $set count, ocr, translated | Not live |  | canonical module | Not live (archived / migration / tmp). No change; excluded from the guard |
| 147 | `scripts/_archived/2026-07-hygiene/maintenance/fix-remaining-inflated.ts` | $set count, ocr, translated | Not live |  | private count | Not live (archived / migration / tmp). No change; excluded from the guard |
| 148 | `scripts/_archived/2026-07-hygiene/maintenance/fix-stuck-jobs.mjs` | $set ocr, translated | Not live |  | private count | Not live (archived / migration / tmp). No change; excluded from the guard |
| 149 | `scripts/migration/backfill-blank-page-markers.mjs` | $set translated, blank | Not live |  | private count | Not live (archived / migration / tmp). No change; excluded from the guard |
| 150 | `scripts/migration/bph-s3-to-r2.mjs` | $set count | Not live |  | private count | Not live (archived / migration / tmp). No change; excluded from the guard |
| 151 | `scripts/migration/bulk-import-to-r2.mjs` | $set count | Not live |  | private count | Not live (archived / migration / tmp). No change; excluded from the guard |
| 152 | `scripts/tmp-import-berlin-papyri.mjs` | insert | Not live |  | private count | Not live (archived / migration / tmp). No change; excluded from the guard |
| 153 | `scripts/tmp-recitation-retry.mjs` | $set ocr | Not live |  | private count | Not live (archived / migration / tmp). No change; excluded from the guard |
| 154 | `scripts/tmp-split-book-v2.mjs` | $set count | Not live |  | private count | Not live (archived / migration / tmp). No change; excluded from the guard |
| 155 | `src/app/api/cron/_archived/process-batches/route.ts` | $set count, ocr, translated | Not live |  | private count | Not live (archived / migration / tmp). No change; excluded from the guard |
| 156 | `src/app/api/cron/_archived/sync-page-counts/route.ts` | $set count, ocr, translated, blank | Not live |  | canonical module | Not live (archived / migration / tmp). No change; excluded from the guard |
