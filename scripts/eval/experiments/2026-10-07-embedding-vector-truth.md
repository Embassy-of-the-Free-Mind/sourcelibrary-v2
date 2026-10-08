## 2026-10-07 · Is each stored embedding the vector of its own text, by the model its row names? (#6175)
<!-- PRIOR ART: 2026-10-07-embedding-format-ga.md (#6170 found the e5 rows as a side finding) and 2026-10-07-embedding-models-qwen3-dual.md (#6172 found the 0.5–0.9 band). Both re-embedded an eval pool; neither asked which writer made a wrong vector, measured the corpus, or repaired it. -->

- **Question.** `page_translations` held e5-base vectors under a `gemini-embedding-2-preview` label (#6175), and #6172 saw 1,547 of 10,888 rows at cosine 0.5–0.9 against a fresh embed. How many rows are wrong, why, and in which stores?
- **Answer.**
  - **Root cause of the e5 rows.** `embed-translations.mjs` wrote multilingual-e5-base vectors from 2026-03-31 to 04-14 (859036d43). The Gemini `--full` pass that replaced it never finished, and every later mode skips a row that already has a vector. On 2026-06-06 `add-embedding-model-columns.sql` (#2124) added `embedding_model … DEFAULT 'gemini-embedding-2-preview'`, and the DEFAULT stamped every e5 row "Gemini". No live writer produces e5. The label came from a column default.
  - **e5 is recognisable without re-embedding.** e5-base is anisotropic: its rows sit 0.85–0.91 from their centroid, and 3,000 Oct-2026 Gemini rows sit ≤ 0.07. `vector-truth.mjs` `e5Signature` / `assertStoreVector` now refuse such a vector at write time (#6189).
  - **Corpus, translated books** (23,064 of 23,234 live books, 3 rows each, 68,690 rows; Wilson 95% by book):
    - **e5:** 2.95% of books [2.74–3.17], ≈ 685 books. A full scan of the 680 flagged books found **162,810 e5 rows**. Scaled to the frame, ≈ 205K rows.
    - **Removed translation still served:** 4.05% of books [3.81–4.32], ≈ 124K rows (Tibetan 685 books, Syriac 72, …). These are withheld pages (#4523) whose Supabase rows were never withdrawn. It agrees with `withheld-translation-drift.mjs` (123,283 reachable rows) within 0.4%, which is an independent check on the instrument. → #4757.
    - **AI page summary stored as the quoted snippet:** 1.52% of books [1.37–1.68], ≈ 34K rows. `embed-gemini.mjs` prepended `translation_summary`; fixed in #6194.
    - **Cosine bands:** ≥ 0.99 **43.7%** · 0.9–0.99 30.9% · 0.5–0.9 22.5% · < 0.5 1.9% (1,226 of 1,326 are e5).
  - **The 0.5–0.9 band is staleness, not a model fault.** `--explain` re-embeds every text a writer has ever composed and names the one that reproduces the vector at ≥ 0.99. On 212 drifted rows from 400 books:

    | the vector was made from | rows |
    |---|---|
    | an older translation | 62 |
    | the OCR, before the translation landed | 41 |
    | another older source | 15 |
    | the pre-2026-05-30 text (wrapper prose and markdown kept; snippet later re-derived by `backfill-clean-snippets.mjs`) | 70 |
    | e5 | 3 |
    | unexplained | 26 |

    Hypotheses rejected: the 8,000-char cut (3 rows) and CJK truncation (0). Corpus scale: ≈ 992K rows stale by timestamp and ≈ 2.44M drifted with no timestamp signal. → #6221.
  - **Untranslated books** (2,598 sampled): 0.12% off-space, 20% drifted, nearly all stale OCR.
  - **Other model-free findings:** `page_number` differs from Mongo on ≈ 137K rows; 6 books have rows pointing at another book; blank pages legitimately share one vector (1,143 rows of "[Blank page — no translatable content]"). The first duplicate check counted these and was corrected.
  - **Sibling stores** (300-row samples; book and artwork compared with their own stored `summary_text`):
    - `book_embeddings` 300/300 ok.
    - `artwork_embeddings` (3072 halfvec) 300/300 ok.
    - `site_pages` 300/300 ok.
    - `page_texts` (es) 300/300 ok, 3 stale.
    - `gallery_text_embeddings` (row-level sample of 391): **75 drifted (20%)** and **16 (4.1%) pointing at deleted gallery images**. The backfill skips ids already present, so an edited description is never re-embedded. → #6222.
    - `clip_embeddings` not redone: #5195 / #4185.
- **measure:** cosine of the stored vector against a fresh `gemini-embedding-2` (bit-identical to -2-preview, #6170) embed of the text the production composer builds today. Cut-offs: < 0.5 off-space, < 0.99 drifted. This is truth against the writer's own input, not retrieval quality. The retrieval cost of drift was measured in #6172: R@10 29/31 stored vs 31/31 fresh.
- **Positive control.** `--plant` adds 9 synthetic defects in memory (e5-shaped, zero, NaN, 512-dim, a shared vector, wrong book, stale watermark, unrelated vector). **9/9 caught.** The e5 scan returned 0 on a known-Gemini book and 699/736 on a known-e5 book.
- **Repair.** 80,000 e5 pages in 301 books were submitted via `embed-gemini.mjs --pages-file … --batch` inside envelope `embed-integrity-6175`. *Correction, 2026-10-08:* this line first said 105,058 pages "were re-embedded". The envelope stopped submission at 80,000, and the jobs were never collected in that run. They were collected, and the rest repaired, in the follow-up: `2026-10-07-page-vector-repair-and-drift-recall-6175.md`.
- **Spend.** Detection $3.81 (Batch, billed) plus $0.32 realtime (pilots, explain, stores). Repair: see #6175.
- **Replicated?** Yes. The e5 books reproduce #6170/#6172's lists, and the withheld count matches the separate audit.
- **Artifacts.** `scripts/audit/page-vector-truth.mjs`, `scripts/lib/vector-truth.mjs`, `scripts/eval/vector-truth/stores.mjs`. Corpus JSON: `/root/claude-jobs/embed-integrity-6175/corpus.json` on Hetzner.

### Supabase write ceiling (read-only, 2026-10-07)
- **Instance.** `page_translations` is 69 GB: heap 6.2 GB, TOAST 33 GB, indexes 29 GB, of which **HNSW is 28 GB**. The instance is **Large** (8 GB RAM, `shared_buffers` 2 GB, 3,600 baseline IOPS, max_connections 160).
- **Cache.** HNSW hit ratio 93% over 1.95 B lifetime block reads; heap 35%. Active inserts wait on `DataFileRead`.
- **Autovacuum.** Running 2 d 2 h in `vacuuming indexes` (2 of 8 indexes, 460K dead items). pgvector's HNSW vacuum rewires the graph, and with the index 3.5× RAM it is IO-bound. Measured write rate during a collect: 8.6 rows/s.
- **Churn.** Lifetime HOT-update share is 19%, so most upserts are non-HOT: a new HNSW insertion plus a dead entry for vacuum to repair.
- **Recommendation.**
  - Don't cancel the running vacuum.
  - Do bulk re-embeds in a window on **2XL** (32 GB, $0.562/h, billed hourly). A 48 h window is ≈ $27 against ≈ $410/mo permanent. The index then fits in RAM and baseline IOPS rises 3.3×.
  - Skip no-op upserts (unchanged vector) in the writers.
  - Longer term: a halfvec HNSW (~14 GB) is a separate migration.
  - `maintenance_work_mem` (512 MB) is not the bottleneck: the dead-tuple store is 3.4 MB of 512 MB.
