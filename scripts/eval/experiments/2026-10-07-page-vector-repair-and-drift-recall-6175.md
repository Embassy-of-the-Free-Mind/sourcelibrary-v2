---
stage: pipeline
measure: accuracy
languages: []
scripts: []
canons: []
n_books: 136
n_pages: 136
verdict: "Exactly 211,377 e5 rows in 1,402 books; after re-embedding 140,965 pages none remain on embeddable pages. Stale and OCR-before-translation vectors lose about 0.2 recall@10."
status: informational
decision: "e5 rows re-embedded ($11.40); stale/OCR-before-translation re-embed deferred to #6221, archived-page rows to #6270"
superseded_by: null
issue: [6175, 6221, 6270, 6267]
---
## 2026-10-07 · Which wrong page vectors cost search results, and are the e5 rows gone? (#6175)
<!-- PRIOR ART: 2026-10-07-embedding-vector-truth.md (same issue) classed the rows and explained the drift by cosine; it did not test retrieval per class, and its e5 count was scaled from a 3-rows-per-book sample. 2026-10-07-embedding-models-qwen3-dual.md (#6172) measured stored vs fresh on a 10,888-page eval pool, not in the production index and not per class. -->

- **Question.** Derek approved a repair on two conditions (#6175, 2026-10-07): re-embed every e5 row, and re-embed a drift class only if fresh vectors win recall@10 by ≥ 0.10. How many e5 rows are there exactly, which drift classes lose results, and what is left after the repair?
- **Answer.**
  - **e5 rows, counted exactly: 211,377 in 1,402 books** (2026-10-07 23:15 UTC). The earlier estimate from 3 rows per book was ≈ 205K rows in ≈ 685 books: the row count held, the book count was half, because a book with a few e5 pages is rarely caught by three rows.
    - 139,562 rows are on live pages. 70,730 are on **archived pages** (`page_number <= 0`, 305 books), and 1,085 on pages that no longer exist in Mongo (18 books).
    - 1,450 rows carried an old book id (8 book pairs); the re-embed writes the current one.
  - **The first repair had not been written.** The 16 Batch jobs of the first run (80,000 pages) finished at Gemini and were never collected. The plain collector on the main box runs a checkout from before #6194 and hashes page text differently, so it would have closed them with nothing written. They were set to `held` and collected with `--collect-jobs` (#6267).
  - **Repair outcome (2026-10-08 06:10 UTC).** 140,965 pages in 1,157 books re-embedded with `gemini-embedding-2`: 128,979 through 24 Batch jobs and 11,986 through the realtime path, after Gemini refused new Batch jobs for three hours (429 on create).
    - The e5 listing re-run returns **72,290 rows, none on a page the writer embeds**: 70,730 on archived pages (→ #6270), 1,085 on pages gone from Mongo, 475 on live pages whose text is under the writer's 20-character floor.
    - Detector re-check on all 1,385 books that held an e5 row (4,013 rows, 10/10 planted defects caught): 252 e5 rows, of which 249 archived, 2 page gone, 1 under the floor. Off-space rows on live pages that are not e5: 2 (a blank page with a stale vector; a removed translation, #4757).
    - Gemini cancelled or failed 21,986 of 150,965 Batch requests (three whole jobs and part of a fourth). Failed requests are not billed.
  - **Drift classes (136 pages, one per book, a query written by eye for each):**

    | what the stored vector was made from | n | mean cos | R@10 stored | R@10 fresh | Δ R@10 [95% bootstrap] | gained / lost |
    |---|---|---|---|---|---|---|
    | the pre-2026-05-30 cleaner's text | 30 | 0.926 | 15 (0.50) | 13 (0.43) | −0.067 [−0.27, 0.10] | +3 / −5 |
    | an older translation | 30 | 0.910 | 13 (0.43) | 14 (0.47) | +0.033 [−0.10, 0.17] | +3 / −2 |
    | the OCR, page since translated | 30 | 0.863 | 8 (0.27) | 14 (0.47) | +0.200 [0.00, 0.40] | +9 / −3 |
    | no stored text reproduces it | 28 | 0.849 | 8 (0.29) | 12 (0.43) | +0.143 [−0.07, 0.36] | +7 / −3 |
    | source flagged newer, text unknown | 18 | 0.814 | 3 (0.17) | 8 (0.44) | +0.278 [0.00, 0.56] | +6 / −1 |
    | all | 136 | 0.878 | 47 (0.35) | 61 (0.45) | +0.103 [0.01, 0.19] | +28 / −14 |

    The classes above need an embed to assign. Two flags that need none split the same rows cleanly:

    | flag | n | R@10 stored | R@10 fresh | Δ R@10 [95% bootstrap] |
    |---|---|---|---|---|
    | Mongo source newer than the row (`stale`) | 63 | 17 (0.27) | 30 (0.48) | +0.206 [0.08, 0.35] |
    | row has no English snippet, page is translated | 67 | 17 (0.25) | 30 (0.45) | +0.194 [0.06, 0.33] |
    | either | 82 | 23 (0.28) | 38 (0.46) | +0.183 [0.07, 0.30] |
    | neither | 54 | 24 (0.44) | 23 (0.43) | −0.019 [−0.17, 0.13] |

  - **Verdict per class.**
    - *Pre-2026-05-30 cleaner* and *older translation, not flagged stale*: no measurable loss. Left alone.
    - *Stale by timestamp, or embedded from the OCR before the translation existed*: fresh vectors win by about 0.19–0.21. This clears the 0.10 bar. The approval named "OCR before translation" as benign, so it was **not** repaired here; it is ≈ 22% of rows in translated books (400 of 1,789 sampled), ≈ 1.26M rows, ≈ $65 by Batch, and it needs a write window. → #6221.
  - **Side finding: the index drops pages it holds.** With the stored vector, 47 pages belong in the top 10 by exact distance; the HNSW at `ef_search` 100 returned 37 of them there. Production runs at 40.
  - **New defect class.** Archived pages keep a served row: 42 of 599 sampled books [5.2–9.3%] hold Gemini vectors for pages with `page_number <= 0`, and search does not filter them. → #6270. The detector now flags them (`archived-page-served`) and no longer counts a row it cannot repair by re-embedding as off-space.
  - **Supabase write rate during the repair.** 1.8 rows/s for two connections while `embed-batch-5729` collected and the index scan ran, 4–6 rows/s later, and about 17 rows/s once the other collector went quiet (10,000 rows in 10 minutes). 25-row upserts hit the 60 s statement timeout twice and were retried. The autovacuum of the first measurement finished at 2026-10-07 18:18 UTC; the table is 72 GB with a 29 GB HNSW.
- **measure:** recall@10 of the target page for its query. *Stored rank* = 1 + rows in the production top-100 (HNSW, `ef_search` 100) closer to the query than the stored vector. *Fresh rank* = the same with a fresh `gemini-embedding-2` vector of today's composed text, i.e. the rank the page would have if only its own row were re-embedded. Intervals are a paired bootstrap over pages (4,000 draws).
- **Limits.**
  - The query is written from today's text, which the fresh vector is made from. A reader also searches for what the page says now, but read the differences as upper bounds.
  - n is 18–30 per class. Only the flag-level intervals exclude 0.
  - One author wrote all 136 queries (Claude, reading each page's text; none uses the page's exact sentences).
- **Positive control.** The e5 listing was checked against 78,143 pages known to be e5 from the first run's repair list: 21 missed (99.97%). The 0-row result after repair is therefore a real zero, within that miss rate.
- **Spend.** Repair $11.40: Batch $9.73 billed (first run's 16 jobs $5.59, this run's 8 jobs $4.13) and realtime $1.67. Detector runs for the explain sample and the re-checks $1.39, recall-test embeds ≈ $0.03. With the first job's $4.13 of detection, #6175 cost about $17 of the $60 approved. Envelope `embed-repair-6175`: $5.83 / $60.
- **Replicated?** The recall test is one run. The e5 count replicates the earlier scaled estimate (≈ 205K rows) by a different method.
- **Artifacts.** `scripts/eval/vector-truth/e5-enum.mjs` (lists e5 rows through the index), `recall-stored-vs-fresh.mjs` and `recall-6175.jsonl` (pages, flags, queries, ranks). Collector flag: `embed-gemini.mjs --collect-jobs` (#6267).
