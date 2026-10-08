## 2026-10-07 · Should page embeddings move to the GA model, the documented task prefix, or more dimensions? (#6170)
<!-- PRIOR ART: 2026-10-07-orig-lang-embedding-recall-5729.md (Gemini vs open models on the untranslated pool; one format, one model id, 768 dims) and scripts/eval/librarian-search/ (live-store search variants over translated books). Neither varies the model id, the input format or the dimension. -->

- **Question.** Every text store embeds with `gemini-embedding-2-preview`, plain text, 768 dims. Google's docs now list a GA `gemini-embedding-2`, say `task_type` is not supported on it (the documented form is an in-text prefix), and recommend 768 / 1536 / 3072. Does any of the three change retrieval on our corpus enough to justify a change or a re-embed?
- **Answer.**
  - **Model: preview and GA are the same function.** 500 page texts × 2 formats and 71 queries × 3 forms give bit-identical vectors (largest component difference 0). A store that mixes them is safe. Moving the model id to GA needs no re-embed.
  - **`taskType` does nothing** on either model (cosine 1.00000 with and without it).
  - **Query prefix alone: do not ship.** It gains 2 of 40 queries on the cross-lingual set and loses 4 of 31 on the translated-books set (R@10 0.97 → 0.84). It fails the bar and reverses direction between the two sets.
  - **Prefix on both sides: better ranks, but the bar is not met.** R@10 0.93 → 1.00 on set A (+0.075) and 0.97 → 1.00 on set B (+0.03, one query). Both baselines sit near the ceiling of these pools, so set B could not show +0.05. Top-1 goes 23 → 35 of 40 and 18 → 23 of 31. No re-embed is proposed on this evidence.
  - **Dimensions: no gain.** 1536 and 3072 score the same R@10 as 768 with and without the prefix.
- **measure:** recall@10 against by-eye gold (accuracy of retrieval, not agreement), Wilson 95%. n = 40 and n = 31, so per-language and per-category cells are directional only.

### Design (bar stated in #6170 before any arm was scored)

- **Set A, cross-lingual.** The #5729 gold: 40 English queries, one untranslated Latin / German / French / Chinese page each. The #5729 pool could not be rebuilt: the seeded draw over `pages_translated: 0` books now holds 13 of the 40 gold pages. Pool A is today's draw plus the 27 gold books it lost (up to 60 pages each, gold page forced in): **10,185 pages**, cleaned OCR.
- **Set B, translated books.** The Librarian golden set: 31 queries, 112 expected books (111 have translated pages). Pool B is 20 seeded-random translated pages from each expected book plus 20 from each of 300 random live translated books: **8,149 pages**, cleaned English translation. A hit is a page of any expected book in the top 10 pages.
- **Documents** were embedded once per format at 3072 dims with the GA model; 768 and 1536 are the renormalised leading dims (the API's own 768 equals the cut 3072 at cosine 1.00000). Formats: plain (production), and `title: <book title> | text: <page text>`.
- **Queries**: plain (production), `task: search result | query: …`, and `task: question answering | query: …` (exploratory).
- **Baselines.** "1" uses the vectors production stores, on the pages that have a usable one ("covered" view). "1f" re-embeds today's text in the production format, on the whole pool ("full" view). The fresh baseline is the clean comparison for format arms, because stored vectors are not always vectors of today's text (see below).
- **Decision bar.** An arm is worth a change if R@10 improves by ≥ 0.05 on BOTH gold sets and the direction does not reverse across languages.

### Result (recall@10, full pools, against the fresh baseline)

| arm | A R@10 | A MRR | A top-1 | La / De / Fr / Zh | B R@10 | B MRR | B top-1 |
|---|---|---|---|---|---|---|---|
| 1f current format, re-embedded | 0.93 [0.80, 0.97] | 0.70 | 23 | 10 / 9 / 9 / 9 | 0.97 [0.84, 0.99] | 0.71 | 18 |
| 2 query prefix only | 0.97 [0.87, 1.00] | 0.84 | 31 | 10 / 10 / 10 / 9 | **0.84** [0.67, 0.93] | 0.57 | 13 |
| 2x question-answering query prefix (exploratory) | 0.97 | 0.81 | 28 | 10 / 10 / 10 / 9 | 0.87 [0.71, 0.95] | 0.62 | 15 |
| 2d document prefix only (exploratory) | 0.97 | 0.87 | 32 | 10 / 9 / 10 / 10 | 1.00 [0.89, 1.00] | 0.84 | 23 |
| 3 = 4 prefix both sides, 768 (preview and GA identical) | **1.00** [0.91, 1.00] | 0.92 | 35 | 10 / 10 / 10 / 10 | **1.00** [0.89, 1.00] | 0.82 | 23 |
| 5 prefix both sides, 1536 | 1.00 | 0.92 | 35 | 10 / 10 / 10 / 10 | 1.00 | 0.81 | 23 |
| 5 prefix both sides, 3072 | 1.00 | 0.92 | 35 | 10 / 10 / 10 / 10 | 1.00 | 0.82 | 23 |
| 5p plain both sides, 1536 | 0.93 | 0.70 | 22 | 10 / 9 / 9 / 9 | 0.97 | 0.68 | 17 |
| 5p plain both sides, 3072 | 0.93 | 0.72 | 24 | 10 / 9 / 9 / 9 | 0.97 | 0.70 | 18 |

On the covered view (stored production vectors as documents; A 6,883 pages and 30 queries, B 7,391 pages and 31 queries):

| arm | A R@10 | B R@10 |
|---|---|---|
| 1 current: stored docs, plain query | 0.93 (28/30) | 0.94 (29/31) |
| 2 query prefix on stored docs | 1.00 (30/30) | 0.84 (26/31) |
| 4 prefix both sides (fresh docs) | 1.00 (30/30) | 1.00 (31/31) |
| 6 GA query on stored preview docs | 0.93 (28/30), every rank equal to arm 1 | 0.94 (29/31), every rank equal to arm 1 |

- **Against the bar.**
  - **Arm 2 fails.** Set A +0.05 (2 gained, 0 lost); set B −0.13 (0 gained, 4 lost; ranks better / worse 6 / 15). On stored documents the picture is the same (A +0.07, B −0.10). The prefix moves the query away from documents that were embedded without one: `suhrawardi-illumination` goes from rank 5 to 184, `rosicrucian-reformation` from 2 to 71, `boehme-aurora` from 3 to 40.
  - **Arms 3 and 4 do not meet it.** A +0.075 (3 gained, 0 lost; ranks better / worse 16 / 2, sign p < 0.01). B +0.03 (1 gained, 0 lost; 9 / 3, p = 0.15). No language or category goes down. Against the stored baseline the deltas are +0.07 and +0.06, but one of B's two gained queries comes from re-embedding a stale stored vector, not from the prefix.
  - **Arm 5 fails.** More dimensions change no query's hit at 10 in either format.
- **Arm 6, compatibility.** Preview vs GA, same text: cosine 1.000000 at 3072, 1536 and 768 for all 500 documents in both formats and for all 213 query vectors; the largest component difference is 0. The two ids return the same numbers.

### What limits the reading

- **Ceiling.** The fresh baseline is 0.93 and 0.97. Set B had room for +0.03 at most, so the bar could not be met there whatever the arm did. The pools are small (8–10K pages); #5729 measured the same model at 0.93 in a pool and 0.64 against 1.46M rows. The rank gains (MRR 0.70 → 0.92 on A) suggest the prefix would matter more at production size. That is not measured here.
- **The document prefix carries the book title, and set B's gold is book-level.** Its expected books were resolved by title match (`librarian-search/README.md`, "Known confound"). A query that names Agrippa is helped by a vector that contains "Agrippa" on every page of the book. On set B the whole gain comes from the document prefix (2d: 1.00, MRR 0.84) and the query prefix adds nothing on top. Set A's gold is one page among up to 60 of the same book, so the title cannot pick the page; there the two prefixes each help and combine.
- Queries were written by an AI reader (set A) or resolved by title (set B). One gold page per query on A.
- *Replicated?* Single run. The model is deterministic (repeat embeds are identical), so a rerun on the same pools returns the same table. The pools are seeded but depend on which books are untranslated on the day.

### Side finding: stored vectors are often not the vector of the stored text

Comparing each stored `page_translations` vector with a fresh plain embed of the same page's text today:

| | rows | identical (cos ≥ 0.999) | cos < 0.95 | cos < 0.5 |
|---|---|---|---|---|
| A, OCR-only rows | 6,883 | 73% | 20% | 0 |
| B, translated rows | 7,391 | 39% | 44% | 102 rows in 14 of 389 books |

- Most of the difference is old text: the row's text was cleaned or re-read after the vector was made (on the pages checked, the raw page text with its tags matches the stored vector better than the cleaned text does). Median cosine is still 0.96 on B, and recall with stored vectors is within one query of the fresh baseline.
- **102 rows are in another space altogether**: their best cosine against any fresh vector in the pool is ≈ 0.15, while the row is labelled `gemini-embedding-2-preview`. Whole books are affected (Gilbert's *De Magnete*, 19 of 20 sampled pages). On the 14 books, 13 match a `multilingual-e5-base` embed of the same text at cosine 0.75–0.97: they are e5 vectors under a Gemini label. Semantic search cannot reach these pages. Filed as #6175.

### Cost

- Spent: **$3.06** of the $5 cap (15.3M billed tokens; logged to `gemini_usage` as `eval/embed-format`). `batchEmbedContents` now returns `usageMetadata.promptTokenCount`, so these are billed tokens. On English translations the measured ratio is 4.44 chars/token.
- The document prefix adds 5% tokens on translated pages and 12% on the shorter OCR-only pages.
- A full re-embed of `page_translations` with the prefix: ≈ 6.9M rows (0.5% table sample: 75% translated at 2,515 chars average, 25% OCR-only), ≈ 3.6B tokens, **≈ $360 through the Batch API** at $0.10/M (≈ $720 realtime).

### Recommendation

1. Do not add the query prefix while documents are plain.
2. Do not re-embed for the prefix on this evidence. If the rank gain is worth pursuing, measure it first where the baseline is not at the ceiling: a pool of ~100K pages in both formats costs about $10.
3. Change the model id to `gemini-embedding-2` after the #5729 backfill finishes. It is free (identical vectors) and removes the preview-retirement risk. `page_translations.embedding_model` would then hold two labels for one function; anything that filters on it must accept both.
4. Stay at 768 dims.
5. Drop `taskType` from `src/lib/embeddings.ts` when that file is next touched; it is ignored.

- **Artifacts.** `scripts/eval/embed-format/` (`build-pools.mjs`, `embed.mjs`, `stored.mjs`, `compat.mjs`, `score.mjs`, shared `common.mjs`); `results/2026-10-07-score.json` (per-query ranks, every arm and view) and `results/2026-10-07-compat.json`. Pools and vectors are not committed (33 MB of text, 480 MB of vectors at `/data/scratch/sl/claude-jobs/embed-format-eval-work/` on the job box).
