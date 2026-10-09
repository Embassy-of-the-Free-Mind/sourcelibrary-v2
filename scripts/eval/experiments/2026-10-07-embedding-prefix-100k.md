## 2026-10-07 · Does the task prefix earn the $360 re-embed when the baseline is off the ceiling? (#6170, follow-up)
<!-- PRIOR ART: 2026-10-07-embedding-format-ga.md — the first test, two pools of 8–10K pages, both baselines at the ceiling (R@10 0.93 / 0.97), so it could not show +0.05 on set B. This is the larger test it asked for; design and bar in scripts/eval/embed-format/DESIGN-100k.md, committed before scoring. -->

- **Question.** Should `page_translations` be re-embedded in the documented form (`title: … | text: …` for documents, `task: search result | query: …` for queries)? The first test could not decide, because its pools were too small for the baseline to miss. Approved by Derek on 2026-10-07: a ~$10 test on a ~100K-page pool.
- **Answer: the bar is missed, by one query on set B.** The pre-registered recommendation is therefore **no re-embed**.
  - **Set A.** Cross-lingual: an English query, and the gold is one original-language page. The baseline is now far off the ceiling (R@10 **0.58**). The prefix on both sides takes it to **0.97**: 25 queries gained, 0 lost.
  - **Set B.** Translated books, book-level gold. It stays near the ceiling: **0.94 → 0.98**, which is +0.039 against a bar of +0.05.
  - **Two arms fail outright:**
    - The **query prefix alone** loses on B (−0.078).
    - **A store that mixes formats** is worse than either uniform format.
- **measure:** recall@10 against by-eye gold (accuracy of retrieval, not agreement), Wilson 95%, paired gained/lost and sign test on ranks against the production format re-embedded today (arm 1f).

### Design (DESIGN-100k.md, commit 9083b148c; gold and scorer be3ecc86f, both before any score)

- **Pool.**
  - **Size and mix.** 100,766 pages from 4,334 live books, seed 61701, mixed the way `page_translations` is: translated pages as their English translation, OCR-only pages as cleaned OCR.
  - **Roles:**
    - set-A gold books (OCR, gold page forced in): 1,396 pages;
    - other live editions or volumes of those works: 10,198;
    - set-B expected books plus every other edition of their works: 4,262;
    - near-duplicate clusters (260 works with ≥ 3 translated editions, up to 4 editions each): 18,600;
    - OCR-only books, mostly Chinese, as in the live table: 26,879;
    - random translated filler: 39,431.
  - **Exclusion.** Filler never took one of the concept-lane stage-1 books (#6173), so the two envelopes could not meter each other.
- **Gold.**
  - **Set A**, page level: the 40 #5729 queries, plus 24 new ones written by an AI reader from seeded-random OCR-only pages by the #5729 method (14 Chinese, 6 Latin, 2 German, 2 Dutch). A hit is the gold page, or a page of another edition that holds the same passage. Character-shingle overlap found 4 candidates and reading kept 2 (`gold-100k/a-equivalents.json`).
  - **Set B**, book level: the 31 Librarian golden-set queries, with every edition of an expected work counted. Plus 20 new "content, no name" queries about near-duplicate clusters, naming no author, title or work, so the title in the document prefix cannot match them.
  - No embedding arm or search tool was used to write any query.
- **Documents.** Embedded through the Gemini Batch API with the production request (`gemini-embedding-2-preview`, 768-d), plain and prefixed, into files only (`batch-embed.mjs`).
  - All 100,766 rows got a plain vector. 88,318 got a prefixed vector.
  - The envelope stopped the last 12,448 rows (see Cost). They are all random translated filler, and no gold page is among them.
  - Every arm is scored on the **88,318 rows that hold both vectors**, so arms rank identical candidates.
- **The bar** (fixed before scoring): arm 4 is worth the re-embed if R@10 rises **≥ +0.05 on set A and on set B**, and neither set nor any set-A language stratum (≥ 5 queries) loses more queries than it gains.

### Result (R@10, 88,318 candidate pages)

| arm | A all (64) | A orig (40) | A new (24) | B all (51) | B orig (31) | B new (20) |
|---|---|---|---|---|---|---|
| 1f plain query, plain docs (production) | **0.58** [0.46, 0.69] | 0.65 | 0.46 | **0.94** [0.84, 0.98] | 0.90 | 1.00 |
| 2 query prefix, plain docs | 0.58 (7 gained / 7 lost) | 0.55 | 0.63 | **0.86** (1 / 5) | 0.84 | 0.90 |
| 2d plain query, prefixed docs | 0.94 (23 / 0) | 0.95 | 0.92 | 0.94 (2 / 2) | 0.94 | 0.95 |
| **4 prefix both sides** | **0.97** [0.89, 0.99] (25 / 0) | 1.00 | 0.92 | **0.98** [0.90, 1.00] (3 / 1) | 0.97 | 1.00 |

| arm 4 vs 1f | MRR | top-1 | ranks better / worse (sign p) |
|---|---|---|---|
| set A | 0.36 → 0.77 | 15 → 42 of 64 | 45 / 2 (< 0.001) |
| set B | 0.68 → 0.81 | 27 → 37 of 51 | 19 / 7 (0.029) |

- **Against the bar.**
  - **Arm 4 misses it on set B:** +0.039, which is 3 queries gained and 1 lost (`alchemical-emblem-books` rank 10 → 16). Set A clears it by eight times, and no set-A language goes down (Latin 10 → 15 of 16, German 7 → 12 of 12, French 6 → 10 of 10, Chinese 14 → 23 of 24).
  - **Arm 2 (query prefix only) fails** with reversals: set B −0.078, A/German 7 → 3 of 12. It must not ship while documents are plain, as the first test also found.
  - **Arm 2d (document prefix only) misses** (B +0).
- **Why set B still sits at the ceiling.** The 20 new no-name queries were all hits at baseline (20/20), so they added no room. The B misses that remain are three original golden-set queries (`bruno-art-of-memory` rank 18 → 4, `suhrawardi-illumination` 14 → 1, `paracelsus-medicine` 14 → 1). Arm 4 fixes all three.
- **Ranks.** On both sets arm 4 improves the rank far more often than it worsens it. The R@10 bar on B is a ceiling problem more than evidence against the arm.

### Exploratory (added after the bar was scored, not part of it): a store with mixed formats

A re-embed of only the OCR-only rows (≈ 25% of the table, ≈ $90) would have been the cheap version. I built it from the vectors in hand: prefixed vectors for the OCR-only rows, plain vectors for the translated rows.

| arm | A all | B all |
|---|---|---|
| x1 plain query, prefix on OCR-only docs | **0.45** (−0.125; 6 gained / 14 lost) | 0.94 (no change) |
| x2 query prefix, prefix on OCR-only docs | 0.98 (+0.41) | **0.75** (−0.196; 1 / 11) |

- **Each mixed store is worse than one of the uniform ones on one set.** The prefix moves every vector, so a query in one format prefers documents in the same format.
- **This also governs any rolling re-embed.** Half-done, the table is a mixed store. The prefix has to arrive as a shadow column switched over in one step, with the query format switched at the same moment. A partial re-embed is not a cheaper option.

### What limits the reading

- **The document prefix carries the book title.** On set A the title cannot pick the page among up to 60 pages of the same book and 10,198 pages of its other volumes, so the gain is not the title alone. It does help find the BOOK across languages, and that is part of the gain.
- **Queries were written by AI readers;** set B's originals were resolved by title. The new set-B queries turned out too easy to measure anything.
- **Pool mix.** The pool is 43% OCR-only rows against ≈ 25% in the live table, so set A's share of production traffic is smaller than its weight here.
- **Replication.** Single run. The model is deterministic, so a rescore of the same vectors is identical.
- **Not measured:** the stored production vectors (the "covered" view of the first test). Reading 88K stored vectors back from Supabase was not worth the egress, given that the first test found the stored and fresh baselines within one query of each other.

### Cost

- **Billed: $7.87.**
  - 78.7M billed tokens through the Batch API at $0.10/M, logged to `gemini_usage` as `eval/embed-prefix-100k`, one row per book per job.
  - The queries cost < $0.01 realtime (`eval/embed-format`).
- **Cancelled requests are unbilled but slow the run.**
  - One 20,000-row job came back with every request "The operation was cancelled".
  - 17,000-row jobs lost a third of their requests the same way.
  - 10,000-row jobs, one per project, lost almost none. Two projects ran in parallel (keys 8 and 9).
- **The envelope closed at $10.36 metered against $7.87 of this test's spend.**
  - The meter sums every `gemini_usage` row on the envelope's 4,333 books since it opened, including other lanes' OCR and translation on them (`meter_endpoints`, #6150, is not merged).
  - I did not raise the cap. The last 12,448 filler rows were left unembedded instead (≈ $0.50).
- **The full re-embed** is unchanged from the first test: ≈ 6.9M rows, ≈ 3.6B tokens, **≈ $360 Batch**.

### Recommendation

1. **No re-embed on this evidence.** Arm 4 missed the pre-registered bar, by one query on set B.
2. **The case for it is strong on the cross-lingual side,** and the decision should be made on a set B that can move.
   - The vectors for this pool are on disk, so rescoring costs nothing.
   - Before any rescore, **people** write about 25 harder book-level questions (Derek, Francis-style Librarian questions, agent logs), with their gold fixed.
   - If arm 4 then clears +0.05 on both sets, the re-embed is justified.
3. **If the re-embed is done:**
   - put it in a shadow column and switch documents and queries together (see the mixed-store result);
   - never ship the query prefix alone.

- **Artifacts.**
  - Scripts in `scripts/eval/embed-format/`: `DESIGN-100k.md`, `build-pool-100k.mjs`, `batch-embed.mjs`, `score-100k.mjs`.
  - Gold additions: `gold-100k/` (a-new, b-new, a-equivalents, a-candidates).
  - Scores: `results/2026-10-07-score-100k.json` (per-query ranks for every arm).
  - The pool and vectors are not committed: 100,766 rows and 2 × 768-d vectors, at `/mnt/HC_Volume_105839809/embed-next-6173/prefix/` on the job box.
