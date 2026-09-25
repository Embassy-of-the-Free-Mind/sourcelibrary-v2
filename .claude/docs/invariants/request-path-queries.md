# A request-path query must not scale with the corpus

**Read this when:** Adding or changing a query behind an API route — especially over `pages`, `entities`, or any collection that grows with the corpus.

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

Two of the three volunteer review queues returned **504** for months (#3568): each picked one item by `$sample`-ing `pages` — **19.1M docs** — with a predicate no index can serve (a regex on `ocr.data`; `archived_photo: {$exists}`). That is a full collection scan per request, behind `maxDuration = 15`. It was never going to work at corpus scale and it degraded **quietly** as the corpus grew, because nothing alarms on "slower every month" and the client only ever showed "Network error".

- **The tell is the query shape, not the timing:** an unindexed predicate on a collection whose size tracks the corpus. `pages` is 19.1M and growing; `gallery_images` is 207K. Confirm offline — the same aggregation also fails to return locally inside two minutes.
- **Which one survived is the lesson.** `gallery-quality` worked only because `gallery_images` is a *materialized view* — and still cost 8.2s/item, its own kind of unusable. **Precompute a bounded pool** (`review_candidates`, built by `scripts/maintenance/build-review-candidates.mjs`, read via `src/lib/review-candidates.ts`) and the same work takes 23–61ms.
- **A builder that feeds such a pool must cap items per book.** An unbounded draw lets one 900-page volume dominate and silently turns "quality of the corpus" into "quality of that book" — and write the `stratum` at build time, because a stratified draw cannot be reconstructed afterwards.
- Same family as the `/explore` prerender timeout (#3373), where counts over `entities` sit close to `maxTimeMS`: a query that merely *fits* today is a deadline you have already scheduled.

## An index is not "indexed" until `explain` says so

**Read this when:** a fix says "add an index" — especially under an `$or`, a `$ne`/`$nin`/`$exists: false`, or a case-insensitive regex.

`/es/collections/<slug>` 500'd 1,246 times in one week (#5074) on a corpus-wide `$or: [{ pages_translated_es: { $gt: 0 } }, { language: /^(spanish|…)$/i }]` that FETCHed all 57K visible books. The issue prescribed a partial index on the counter. Created, re-explained: **identical plan.** The OR union over the new index and `books_language_idx` sat in `rejectedPlans`, because a `/…/i` regex has no index bounds — its leg must walk every key of the language index, and the planner's trial prefers the `visible` scan. The index alone changed nothing.

- **The predicate shape must be boundable, per branch.** Equality, `$in`, ranges and case-SENSITIVE anchored prefixes bound; `/…/i`, `$ne`, `$nin`, `$exists: false` do not. Inside an `$or`, one unboundable branch sinks the whole union.
- **Resolve the unboundable branch before the query.** `distinct('language')` is a DISTINCT_SCAN over the language index (~500 keys, 0 docs, 1 ms); apply the regex to those values in JS and query `$in: <matches>`. Same set by construction, 57,678 → 277 docs, 1,579 → 94 ms. `localizedEditionFilterIndexed` in `src/lib/localized.ts` is the pattern (PR #5078).
- **Or scope by a field that IS indexed.** The per-collection page needed counts for its children only: `collections: { $in: childSlugs }` in front turns the regex into a cheap post-filter over 77 docs. Ask what the result is *for* before asking how to make the whole thing fast.
- **Read `totalDocsExamined` and `rejectedPlans` after `createIndex`**, never `createIndex`'s success. A rejected plan is the planner telling you which branch it could not bound.
