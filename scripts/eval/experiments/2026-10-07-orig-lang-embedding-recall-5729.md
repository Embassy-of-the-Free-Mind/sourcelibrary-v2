## 2026-10-07 · Can an English query find an untranslated Latin/German/French/Chinese page by meaning? (#5729)
<!-- PRIOR ART: scripts/eval/search-recall/ (#5905; book recall of /api/search over the live English lanes, expected sets from period-term phrase facets) and scripts/eval/librarian-search/ (page-grain golden set over TRANSLATED books). Neither embeds original-language OCR with an open model, and neither has a gold set of untranslated pages. -->

- **Question.** RESULTS PENDING.

### Design (fixed before any arm was scored)

- **Pool.** 8,576 pages of untranslated live books (`pages_translated: 0`), in one cross-lingual pool: Latin 1,702 pages / 80 books, German 1,985 / 80, French 966 / 42 (every eligible book), Chinese 3,923 / 80. Books drawn with seed 5729, up to 60 pages per book, pages with ≥ 300 cleaned OCR characters (≥ 100 for Chinese). Text is the production composer's (`cleanPageText`). `scripts/eval/orig-lang-recall/build-pool.mjs`.
- **Gold.** 40 queries, 10 per language, in `scripts/eval/orig-lang-recall/gold.json`, frozen before any arm was scored. One page drawn at random per book. Non-substantive pages were skipped (an index, a dedication poem, a Latin page in a book labelled French). The OCR was read, and an English query written for what a reader would ask that page to answer. Wording is not copied from the page, but names are kept. Relevant set = that one page.
- **Arms.**
  - (a) the **current lane** as served: `match_semantic` over all of `page_translations`, top 10;
  - (b) the same model **in the pool**: the vectors production already stores for these pages (untranslated pages are embedded from their OCR, so the lane is not empty by construction; 5,654 of 8,576 pool pages have one);
  - (c) **multilingual-e5-base** (the model `sl-embedding-server` runs) on the OCR;
  - (d) **BGE-M3** (dense, int8 ONNX), the stronger open multilingual model that runs on this box's CPU.
  - (c) and (d) are cut at 512 tokens, `scripts/eval/orig-lang-recall/embed-local.mjs`.
- **Measure.** Page-level recall@10 (gold page in the top 10 of the arm's ranking of the pool), with a Wilson 95% CI. Per language, plus MRR. Arms (b)–(d) are also compared on the **shared** subset: pool pages that have a stored Gemini vector, and queries whose gold page has one.
- **Decision bar, stated in advance.** Propose an original-text backfill with an open model only if:
  1. its recall@10 is **≥ 0.50** over the 40 queries;
  2. it is **≥ 0.30 in every one of the four languages**;
  3. on the shared subset it is **no more than 0.10 below** the stored Gemini vectors.

  If (3) fails, the open model is not the gap. The cheaper fix is then to finish embedding the OCR-only tail with the model the read path already queries, and no new table or query path is needed.
