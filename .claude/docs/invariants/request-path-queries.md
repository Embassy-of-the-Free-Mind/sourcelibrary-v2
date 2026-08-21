# A request-path query must not scale with the corpus

**Read this when:** Adding or changing a query behind an API route — especially over `pages`, `entities`, or any collection that grows with the corpus.

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

Two of the three volunteer review queues returned **504** for months (#3568): each picked one item by `$sample`-ing `pages` — **19.1M docs** — with a predicate no index can serve (a regex on `ocr.data`; `archived_photo: {$exists}`). That is a full collection scan per request, behind `maxDuration = 15`. It was never going to work at corpus scale and it degraded **quietly** as the corpus grew, because nothing alarms on "slower every month" and the client only ever showed "Network error".

- **The tell is the query shape, not the timing:** an unindexed predicate on a collection whose size tracks the corpus. `pages` is 19.1M and growing; `gallery_images` is 207K. Confirm offline — the same aggregation also fails to return locally inside two minutes.
- **Which one survived is the lesson.** `gallery-quality` worked only because `gallery_images` is a *materialized view* — and still cost 8.2s/item, its own kind of unusable. **Precompute a bounded pool** (`review_candidates`, built by `scripts/maintenance/build-review-candidates.mjs`, read via `src/lib/review-candidates.ts`) and the same work takes 23–61ms.
- **A builder that feeds such a pool must cap items per book.** An unbounded draw lets one 900-page volume dominate and silently turns "quality of the corpus" into "quality of that book" — and write the `stratum` at build time, because a stratified draw cannot be reconstructed afterwards.
- Same family as the `/explore` prerender timeout (#3373), where counts over `entities` sit close to `maxTimeMS`: a query that merely *fits* today is a deadline you have already scheduled.
