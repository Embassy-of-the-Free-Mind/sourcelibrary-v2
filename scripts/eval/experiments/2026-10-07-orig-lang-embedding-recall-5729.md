## 2026-10-07 · Can an English query find an untranslated Latin/German/French/Chinese page by meaning? (#5729)
<!-- PRIOR ART: scripts/eval/search-recall/ (#5905; book recall of /api/search over the live English lanes, expected sets from period-term phrase facets) and scripts/eval/librarian-search/ (page-grain golden set over TRANSLATED books). Neither embeds original-language OCR with an open model, and neither has a gold set of untranslated pages. -->

- **Question.** #5729 proposed embedding the original-language OCR of untranslated books with an open multilingual model, so that an English query could find them. Does an open model on this box (multilingual-e5-base, BGE-M3) retrieve those pages? Compare it with what production already has.
- **Answer: not an open model.** Production already embeds untranslated pages from their OCR with Gemini (`pageEmbeddingInput` falls back to OCR when there is no translation). Those vectors find the right page far better than either open model:
  - **Gemini 0.93** recall@10 vs **e5-base 0.38** over the same 8,576-page pool;
  - **Gemini 0.93 vs BGE-M3 0.82** on a 3,000-page sub-pool.

  **The pages are lost by the shared index, not by the model.** In a lane of their own, the gold page is in the top 10 for 0.64 of queries at full scale (1.46M OCR-only rows, exact). Through `match_semantic`, where 6.7M rows (most of them English translations) compete with them, it falls to **0.10**. So the gap is a missing lane, plus ≈814K OCR-only pages not yet embedded (≈$15 of Gemini). A second model is not needed. The pre-stated bar is **not met** for either open model, so no open-model backfill is proposed.
- **measure:** page-level recall@10 against one by-eye gold page per query (accuracy of retrieval, not agreement). Wilson 95% intervals. n = 40, so per-language cells (n = 10) are directional only.

### Design (fixed before any arm was scored; committed in 6e270bd)

- **Pool.** 8,576 pages of untranslated live books (`pages_translated: 0`), all four languages in one cross-lingual pool:

  | language | pages | books |
  |---|---|---|
  | Latin | 1,702 | 80 |
  | German | 1,985 | 80 |
  | French | 966 | 42 (every eligible book; most are 25-page stubs) |
  | Chinese | 3,923 | 80 |

  Books were drawn with seed 5729, up to 60 pages per book. Pages need ≥ 300 cleaned OCR characters (≥ 100 for Chinese). Text is the production composer's (`cleanPageText`). `build-pool.mjs`.
- **Gold.** 40 queries, 10 per language, in `gold.json`. One page drawn at random per book. Non-substantive pages were skipped (an index, a dedication poem, Latin text in a book labelled French). I read the OCR and wrote an English query for what a reader would ask that page to answer. Wording is not copied from the page, but names are kept. Relevant set = that one page.
- **Arms.** All under `scripts/eval/orig-lang-recall/`.

  | arm | what it is | script |
  |---|---|---|
  | **global** | `match_semantic` over all of `page_translations`, top 10: the lane search and the Librarian call today | `gemini-arm.mjs` |
  | **gemini** | the vectors production stores for the pool pages (5,654 of 8,576 have one) | `gemini-arm.mjs` |
  | **gemini-full** | the same plus the 2,986 missing pool pages, embedded the production way (2,904 of them Chinese; $0.0315, logged to `gemini_usage` as `eval/orig-lang-recall-5729`) | `gemini-arm.mjs --fill-pool` |
  | **ocr_only** | the gold page's exact rank among every OCR-only row (1,456,484), i.e. a dedicated original-text lane at real size | `gemini-arm.mjs --ocr-only-rank` |
  | **e5-base** | the `sl-embedding-server` model, in-process; parity with the server checked at cosine 0.997 | `embed-local.mjs` |
  | **bge-m3** | dense head, int8 ONNX; on the 3,000-page sub-pool only (gold pages + 2,960 seeded others), because it runs at ~1.1 pages/s here | `embed-local.mjs --subset` |

  Both open models are cut at 512 tokens.
- **Decision bar, stated in advance.** Propose an open-model backfill only if the model:
  1. reaches recall@10 **≥ 0.50** over the 40 queries;
  2. reaches **≥ 0.30 in every language**;
  3. is **within 0.10 of the stored Gemini vectors** on shared pages.

### Result (recall@10, Wilson 95%)

| arm | candidates | R@10 | MRR | La | De | Fr | Zh |
|---|---|---|---|---|---|---|---|
| global `match_semantic` (production today) | 6.7M rows | **0.10** [0.04, 0.23] | 0.17 | 1/10 | 1/10 | 2/10 | 0/10 |
| Gemini, OCR-only lane, exact | 1.46M rows | **0.64** [0.46, 0.79] (n = 28) | 0.31 | 6/10 | 5/10 | 6/7 | 1/1 |
| Gemini, OCR-only lane, existing HNSW + `iterative_scan` | 1.46M rows | 0.50 (14/28) | — | | | | |
| gemini-full | pool 8,576 | **0.93** [0.80, 0.97] | 0.68 | 10/10 | 10/10 | 8/10 | 9/10 |
| e5-base | pool 8,576 | **0.38** [0.24, 0.53] | 0.24 | 2/10 | 6/10 | 7/10 | 0/10 |
| e5-base, shared pages | 5,590 | 0.45 [0.28, 0.62] (n = 29) | 0.26 | 2/10 | 6/10 | 5/8 | 0/1 |
| gemini, shared pages | 5,590 | 0.93 [0.78, 0.98] (n = 29) | 0.66 | 10/10 | 10/10 | 6/8 | 1/1 |
| gemini-full | sub-pool 3,000 | 0.93 [0.80, 0.97] | 0.76 | 10/10 | 10/10 | 8/10 | 9/10 |
| bge-m3 | sub-pool 3,000 | **0.82** [0.68, 0.91] | 0.69 | 8/10 | 10/10 | 9/10 | 6/10 |
| e5-base | sub-pool 3,000 | 0.60 [0.45, 0.74] | 0.33 | 6/10 | 9/10 | 7/10 | 2/10 |

- **Against the bar.**
  - **e5-base fails all three parts.** It scores 0.38 overall, Latin 0.20 and Chinese 0.00, and is 0.48 below Gemini on shared pages. Its Chinese gold pages rank 20–1,392.
  - **BGE-M3 passes (1) and (2), but only on the sub-pool, and misses (3) by 0.01:** 0.82 against Gemini's 0.93 there, a gap of −0.11. The sub-pool flatters every arm: e5 goes 0.38 → 0.60 when the pool shrinks from 8.6K to 3K. So BGE-M3 at full pool size would score lower than 0.82. It doesn't clear the bar either.
- **Why the global lane fails.** The global lane found the gold page 4/40 times, and the gold book 6/40. The cross-lingual vectors are sound: the same Gemini vectors score 0.64 against 1.46M OCR-only rows. But an English query sits closer to any English translation than to a Latin page on its exact subject. With 5.2M translated rows in the same HNSW index, the original-language pages never reach the top 10. #4439 (language post-filter) is the same shape: a minority of the table is invisible to an unfiltered nearest-neighbour search.
- **Chinese.** The embedder has barely reached Chinese: 9 of the 10 Chinese gold pages had no vector, and 3,438 Chinese books have zero rows (`embedding-coverage.mjs`, 2026-10-07). Once embedded, Gemini found 9/10. e5 found 0/10 and BGE-M3 6/10.
- **Cost of the alternatives, measured on this box.**
  - e5-base: 2.4 pages/s. The ≈1.67M untranslated OCR pages would take **≈8 days** of CPU, then a new 768-d table and HNSW index of ≈12 GB in Supabase (the database is at 166 GB), plus a new query path with its own query-embedding call.
  - BGE-M3: 1.1 pages/s, so **≈17 days**.
  - Neither is needed. The Gemini vectors exist for 1.46M OCR-only rows already. The ≈814K missing OCR pages would cost **≈$15** (Chinese 690,753 pages × 197 chars ≈ $6.30; the rest ≈ $8.50; at 4.29 chars/token, $0.20/M), ≈12 h of `embed-gemini --books-file`.
- **The lane.** `hnsw.iterative_scan = relaxed_order` on the existing index (pgvector 0.8.0) costs no storage. It returned the gold page for 14/28 queries, against 18/28 exact. Latency is median 2.9 s, p90 8.3 s, max 13.5 s, on a loaded database. A partial HNSW index on `page_translations WHERE coalesce(translation,'') = ''` would sit close to the exact result at normal HNSW latency. It would cost ≈5.7 GB now (the existing index is 26 GB for 6.7M rows) and ≈9 GB once the tail is embedded.
- **Caveats.**
  - The queries were written by an AI reader, not by people, and keep the page's proper names. That may favour Gemini, whose embedding model shares a lineage with the models that write our translations.
  - One relevant page per query, so a correct neighbouring page counts as a miss. That understates every arm equally.
  - The OCR-only exact arm has n = 28, because 12 gold pages had no stored vector.
  - Where the open models win: BGE-M3 finds q25 (1605 Guinea, palm-oil anointing) at rank 2, where Gemini has it at 12 on the sub-pool. e5 ranks the French Vattel pages (q26, q29) first. Misses common to Gemini and BGE-M3: q24, a catalogue page that is mostly Greek incipits; and q32, Leijing on strong vs mild drugs.
  - *Replicated?* Single run. e5 and BGE-M3 are deterministic on this runtime. The Gemini query vectors were embedded once.
- **Artifacts.** `scripts/eval/orig-lang-recall/` (pool builder, gold set, the two embedders, scorer); `results/2026-10-07-score.json` (per-query ranks for every arm). The pool and the vectors are not committed: 11 MB of OCR plus ~200 MB of vectors at `/root/claude-jobs/librarian-orig-5867/` on Hetzner, rebuildable with the seed.
