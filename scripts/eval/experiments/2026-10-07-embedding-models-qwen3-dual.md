## 2026-10-07 · Would a different embedding model, or a second original-language vector, find more of the right pages? (#6172)
<!-- PRIOR ART: scripts/eval/orig-lang-recall/ (#5729; pool A, gold A, Gemini/e5/BGE-M3 arms, scorer reused here) and scripts/eval/librarian-search/ (golden set B, book-grain, run through the LIVE index only — no pool, so no way to score a model that has no stored vectors). Neither has a translated-page pool with both OCR and translation text, nor a Qwen3 arm. #6170 (job embed-format-eval) covers Gemini preview→GA, task prefixes and dims; not repeated here. -->

- **Answer: no re-embed clears the bar.** The design and bar below were committed (63308ed4f) before anything was scored.
  - **Dual vectors (Gemini).** Fusing an original-text vector with the stored translation vector changes nothing on the Librarian set (29/31 → 29/31) and gains one query on the new set (16/20 → 17/20). Gemini is already cross-lingual enough that original-language queries find translated pages through their English (9/10).
  - **Qwen3-Embedding-8B** is the only model to reach the bar on one set: cross-lingual A 39/40 vs 37/40 (+0.05). On the Librarian set B it ties Gemini (29/31; 30/31 when truncated to 768). It is strongest on the new set C (20/20 vs 16/20), where queries carry rare Latin/German terms.
  - **4B** gains +0.02 on A and loses −0.03 on B. **0.6B** loses on A (−0.10). The CPU int8 0.6B loses −0.25 on A, so the $0 path is out.
- **The bigger finding is a confound:** stored vectors are out of sync with their own text. A fresh embed of exactly the stored text, with the same Gemini model, scores **31/31** on B. Of the 10,888 sampled stored vectors:
  - **16% have cosine < 0.9** with a fresh embed of their own text.
  - **2.1% are off-space** (≈ 0): e5 vectors mislabelled as Gemini, #6175. They include all sampled pages of Vesalius' *Fabrica* and Gilbert's *De Magnete*.
  - So part of any new-model gain on translated pages is just "re-embedded". The cheap fix is #6175 plus a same-model refresh of drifted rows, not a new model.
- **measure:** retrieval accuracy (R@10 against by-eye gold, Wilson 95%). Single run. Deterministic up to bf16 noise: batch-vs-single cosine ≥ 0.9998, positive control in "Instruments".

### Design (fixed before scoring)

- **Question.** Every page has one vector: the English translation if one exists, else the OCR (`pageEmbeddingInput`). Before a $120–300 corpus re-embed, does (1) an open model (Qwen3-Embedding 0.6B / 4B / 8B) or (2) a second Gemini vector of the ORIGINAL text of translated pages retrieve more of the right pages than what production stores today?
- **measure:** retrieval accuracy against by-eye gold (`read-from-text`: the page's OCR and translation read in full by the AI reader; not a human reference). Recall@10 = share of queries with at least one relevant page in the top 10 of a cosine ranking over a fixed pool. Wilson 95%. MRR alongside.
- **Gold sets and pools.**
  - **A — cross-lingual, untranslated** (reused unchanged): `scripts/eval/orig-lang-recall/gold.json`, 40 English queries → one untranslated La/De/Fr/Zh page each; pool 8,576 pages (and the fixed 3,000-page sub-pool for CPU arms). Gemini reference arm = `gemini-full` (0.93).
  - **B — Librarian golden set over translated books** (reused unchanged): `scripts/eval/librarian-search/golden-set.json`, 31 queries → expected books (any page counts, per the set's own match rule). The set was only ever run through the live index, so it gets a pool here (`embed-models/build-pool-t.mjs`, seed 6172): up to 40 pages from each expected book plus up to 60 pages from each of ~120 seeded distractor books drawn from live translated books, every page one that production holds a vector for. The Gemini reference arm = the **stored** `page_translations` vector of each page, whose text is the stored `translation` column (OCR when the page has no translation, as production does).
  - **C — new, 20 queries over translated books** (`scripts/eval/embed-models/gold-c.json`): one page from each of 20 Latin/German (and a few other) translated distractor books in pool T, OCR and translation read in full. 10 queries in the original language using the page's own period spellings and terms; 10 English queries that carry a Latin/German term from the page. Relevant set = that one page. Frozen before any arm is scored on it.
- **Arms.**
  - **C (dual vectors, Gemini `gemini-embedding-2-preview`, 768, plain-text query as `fetchQueryEmbedding` sends it):** `trans` = stored vector (production today); `orig` = the page's cleaned OCR embedded the production way; `fuse` = per page max(cos(q, trans), cos(q, orig)). Scored on B and C (A is untranslated: both vectors are the same text).
  - **A (Qwen3-Embedding-0.6B, CPU, int8 ONNX `onnx-community/Qwen3-Embedding-0.6B-ONNX`):** last-token pooling, L2 norm, query form `Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:{q}` (the model card's), documents bare; 1024 tokens max. On A's 3,000 sub-pool and pool T.
  - **B (Qwen3-Embedding-4B and -8B, plus 0.6B bf16, on one leased Scaleway L4):** same format; full pools A and T; pages/s measured for pricing.
  - Qwen arms are scored at native dims and truncated to 768 (MRL), since `page_translations.embedding` is `vector(768)`.
  - **D: Voyage-4, Cohere embed-v4 — untested, needs keys.**
- **Decision bar, stated in advance.**
  - A **model** (Qwen3 size) wins only if its R@10 beats the current Gemini arm by **≥ 0.05 on BOTH gold set A and gold set B**, on the same pool. (Gemini A = 0.93, so a model needs ≥ 0.98 there; at n = 40 that is 40/40 or 39/40. The ceiling is stated, not adjusted.)
  - **Dual vectors** win only if `fuse` beats `trans` by **≥ 0.05 on BOTH gold set B and gold set C**.
  - A win is a priced recommendation (model cost, GPU hours, Supabase disk with old and new vectors coexisting, time), never a started re-embed.
- **Budget.** Gemini ≤ $3 (`gemini_usage` endpoint `eval/embed-models`), GPU ≤ €10.

### Pools as built

- **Pool T** (`build-pool-t.mjs`, seed 6172): 10,888 pages from 228 books. 4,146 pages come from 108 of the golden set's 112 books (4 had no usable page: two Arabic Ibn ʿArabī editions, the Merian *Atalanta* engravings and the *Rasaratnākara*). 6,742 pages come from 120 distractor books (Latin 50, German 35, French 12, Italian 10, English 13). 10,126 pages carry a translation. Every query in gold set B keeps at least one expected book in the pool.
- **Gold C** (`gold-c.json`): 20 pages drawn from 28 seeded candidates; 8 were skipped as non-substantive (an anagram poem, a title page, verse, a biography fragment). There are 10 original-language queries (Latin 5, German 3, French 1, Italian 1) and 10 English queries carrying a source term. Written and committed (1c1845186) before any arm was scored on it.

### Results — recall@10 (Wilson 95%), MRR; Δ vs reference, (+wins / −losses) by query

**Gold set A — 40 English queries → one untranslated La/De/Fr/Zh page** (reference: `gemini-full`, stored + gap-filled Gemini vectors)

| arm | pool | R@10 | MRR | Δ (paired) | La | De | Fr | Zh |
|---|---|---|---|---|---|---|---|---|
| Gemini (current) | 8,576 | **0.93** [0.80, 0.97] | 0.68 | — | 10 | 10 | 8 | 9 |
| Qwen3-0.6B bf16 | 8,576 | 0.82 [0.68, 0.91] | 0.64 | −0.10 (+2/−6) | 8 | 10 | 9 | 6 |
| Qwen3-0.6B bf16 @768 | 8,576 | 0.85 [0.71, 0.93] | 0.65 | −0.08 (+2/−5) | 8 | 10 | 10 | 6 |
| Qwen3-4B | 8,576 | 0.95 [0.83, 0.99] | 0.79 | +0.02 (+2/−1) | 9 | 10 | 10 | 9 |
| Qwen3-8B | 8,576 | **0.97** [0.87, 1.00] | 0.82 | **+0.05** (+2/−0) | 10 | 10 | 10 | 9 |
| Qwen3-8B @768 | 8,576 | 0.97 [0.87, 1.00] | 0.79 | +0.05 (+2/−0) | 10 | 10 | 10 | 9 |
| Gemini (current) | sub-pool 3,000 | 0.93 [0.80, 0.97] | 0.76 | — | 10 | 10 | 8 | 9 |
| Qwen3-0.6B **int8 ONNX, CPU** | sub-pool 3,000 | 0.68 [0.52, 0.80] | 0.51 | −0.25 (+2/−12) | 5 | 7 | 8 | 7 |
| Qwen3-0.6B bf16 | sub-pool 3,000 | 0.90 [0.77, 0.96] | 0.79 | −0.03 (+3/−4) | 9 | 10 | 10 | 7 |

The two queries 4B and 8B win are q24 (a catalogue page of Greek incipits; Gemini rank 52, 8B rank 1) and q25 (1605 Guinea, palm-oil anointing; Gemini 40, 8B 1). Both were Gemini misses in #5729 too. q32 (Leijing on strong vs mild drugs) is missed by everything.

**Gold set B — Librarian golden set, 31 queries → expected books, pool T 10,888** (reference: `gemini-trans`, the stored vectors)

| arm | R@10 | MRR | Δ (paired) |
|---|---|---|---|
| Gemini stored (current) | **0.94** [0.79, 0.98] | 0.71 | — |
| Gemini original-text vector only | 0.90 [0.75, 0.97] | 0.77 | −0.03 (+2/−3) |
| **Gemini fusion (stored ∨ original)** | 0.94 [0.79, 0.98] | 0.76 | **+0.00** (+0/−0) |
| *control:* Gemini re-embed of the same stored text | **1.00** [0.89, 1.00] | 0.75 | +0.06 (+2/−0) |
| *control:* fresh ∨ original | 1.00 [0.89, 1.00] | 0.73 | +0.06 (+2/−0) |
| Qwen3-0.6B | 0.94 [0.79, 0.98] | 0.75 | +0.00 (+2/−2) |
| Qwen3-4B | 0.90 [0.75, 0.97] | 0.78 | −0.03 (+2/−3) |
| Qwen3-4B @768 | 0.87 [0.71, 0.95] | 0.72 | −0.06 (+2/−4) |
| Qwen3-8B | 0.94 [0.79, 0.98] | 0.76 | +0.00 (+2/−2) |
| Qwen3-8B @768 | 0.97 [0.84, 0.99] | 0.74 | +0.03 (+2/−1) |

The set is near its ceiling in this pool: only 2 of 31 queries miss on the reference, so it can't separate arms by much.
- Gemini's two misses are `ibn-arabi-unity` and `rosicrucian-reformation`. Qwen3-8B finds both, and so does the same-model re-embed.
- 8B misses `fludd-macrocosm-microcosm` (rank 16) and `suhrawardi-illumination` (rank 52).

**Gold set C — 20 queries over translated pages, pool T** (reference: `gemini-trans`)

| arm | R@10 | MRR | Δ (paired) | orig-language queries | English + source term |
|---|---|---|---|---|---|
| Gemini stored (current) | **0.80** [0.58, 0.92] | 0.78 | — | 9/10 | 7/10 |
| Gemini original-text vector only | 0.85 [0.64, 0.95] | 0.59 | +0.05 (+2/−1) | 9/10 | 8/10 |
| **Gemini fusion** | 0.85 [0.64, 0.95] | 0.72 | **+0.05** (+1/−0) | 9/10 | 8/10 |
| *control:* Gemini re-embed, same text | 0.80 [0.58, 0.92] | 0.74 | +0.00 (+1/−1) | 9/10 | 7/10 |
| Qwen3-0.6B | 0.95 [0.76, 0.99] | 0.87 | +0.15 (+3/−0) | 9/10 | 10/10 |
| Qwen3-4B | **1.00** [0.84, 1.00] | 0.97 | +0.20 (+4/−0) | 10/10 | 10/10 |
| Qwen3-8B | **1.00** [0.84, 1.00] | 0.93 | +0.20 (+4/−0) | 10/10 | 10/10 |

**Gemini's C misses.**
- **c11** ("Hermagoras … genus iudiciale, deliberativum, demonstrativum"): rank 103; re-embedded, 89.
- **c13** (Galen: *complexio, virtus, operatio, temperies*): rank 10,792, because the page's stored vector is off-space; re-embedded, it is 213.
- **c14** (Jerome, *fiunt, non nascuntur Christiani*): rank 11.
- **c08** (the Kabbalist working alone because of *Sympathie oder Antipathie*): rank 15; re-embedded, 1.

Qwen 4B and 8B put all four at rank 1. They are more lexically faithful to rare source terms carried into an English query. Gemini matches the topic and loses the specific page.

### Against the bar (stated in advance)

| option | A (Δ ≥ 0.05?) | B (Δ ≥ 0.05?) | C | verdict |
|---|---|---|---|---|
| Dual vectors (fusion) | n/a (untranslated) | +0.00 ✗ | +0.05 ✓ | **fails** (bar: B and C) |
| Qwen3-0.6B (bf16) | −0.10 ✗ | +0.00 ✗ | +0.15 | fails |
| Qwen3-0.6B int8 CPU | −0.25 ✗ (sub-pool) | not run | not run | fails |
| Qwen3-4B | +0.02 ✗ | −0.03 ✗ | +0.20 | fails |
| Qwen3-8B (@768 is the deployable form) | +0.05 ✓ | +0.00 / +0.03 ✗ | +0.20 | **fails on B** |

Nothing wins, so no re-embed is proposed. Two readings are not licensed by these numbers:
- **"8B is better."** On A its edge is 2 discordant queries (+2/−0; exact binomial p = 0.5). On B it ties.
- **"Gemini is fine."** Set C (n = 20, AI-written queries) shows a consistent +0.20 for 4B and 8B whenever a query carries a rare source term. That is worth a bigger, human-written gold set before the next decision, not a re-embed now.

### Instruments and controls

- **Positive control (Qwen):** the model card's 2×2 example scores, measured on the L4 (`--selftest`).

  | model | measured | card |
  |---|---|---|
  | 0.6B | [[0.7656, 0.1402], [0.1366, 0.6036]] | [[0.7646, 0.1414], [0.1355, 0.6000]] |
  | 4B | [[0.7525, 0.1133], [0.0302, 0.6237]] | — |
  | 8B | [[0.7460, 0.0746], [0.0893, 0.6335]] | — |

  Batched vs single-text cosine is ≥ 0.9998 for every model (bf16). The int8 ONNX export is NOT batch-invariant: batched vs single cosine is 0.91, because dynamic activation quantisation scales over the whole batch. So the CPU arm ran unbatched, which also explains part of its loss.
- **Stored vs fresh Gemini (the confound).** Over all 10,888 pool-T pages, the stored vector was compared with a fresh embed of exactly its stored text (`gemini-dual.mjs --fresh`).
  - Median cosine 0.987. 5,824 pages are below 0.99, 1,771 below 0.9, and 224 below 0.5.
  - The < 0.5 rows are all from April 2026, in 11 books, at cosine ≈ 0 to both the translation and the OCR. These are the off-space e5 vectors of #6175 (replication posted there).
  - The 0.5–0.99 band is consistent with two writers that rewrite `page_translations.translation` without re-embedding, by design: `scripts/lib/translation-text-repair.mjs` `resyncMirrors` and `translation-cleanup-a2-5700.mjs --snippets`.
  - Pool T is not a random corpus sample (108 curated books + 120 random ones), so these are rates in the sample, not corpus counts.
- **Query form.** Gemini queries are plain text, as `fetchQueryEmbedding` sends them; the prefix question is #6170's. Qwen queries use the card's `Instruct: … \nQuery:` form, and documents are bare. Documents are cut at 1,024 Qwen tokens. That drops the tail of 11.2% of pool-T pages (translations) and 3.5% of pool-A pages, where Gemini reads up to 8,000 chars. The cut handicaps Qwen, and the pricing below assumes it.

### Caveats

- Gold A and gold C queries were written by an AI reader from text, not image, and not by people. Gold C keeps distinctive source terms by design, which favours lexically faithful models.
- n = 40 / 31 / 20. Every Δ here is 1–4 discordant queries. B is near ceiling.
- One relevant page per query in A and C, so a correct neighbouring page counts as a miss.
- Pool T's Gemini reference includes the drifted and off-space rows. That is production's real state, and it is why the re-embed control is reported alongside.
- *Replicated?* Single run. Qwen bf16 is deterministic up to batch noise (≥ 0.9998). Gemini query vectors were embedded once.

### Pricing (for the record — no option won)

Measured on one Scaleway L4-1-24G (€0.7875/h), HF transformers 5.19 bf16 sdpa, length-sorted batches, 1,024-token cut, on 8.52M tokens (19,464 pages):

| model | tok/s | pages/s (pool T / pool A) |
|---|---|---|
| Qwen3-0.6B | 16,860 | 33 / 49 |
| Qwen3-4B | 4,310 | 8.4 / 12.6 |
| Qwen3-8B | 2,760 | 5.4 / 8.0 |
| 0.6B int8 ONNX on Hetzner CPU (8 threads) | 486 | — / 1.4 |

vLLM was not tried and might be faster, so the GPU figures below are upper bounds on cost.

**Corpus tokens (Qwen tokenizer):** 5.1M translated pages × 513 tok + 2.8M OCR-only pages × 342 tok ≈ **3.57G tokens**.

| option | model / GPU cost | Supabase disk during cutover | time | recurring |
|---|---|---|---|---|
| Qwen3-8B re-embed (@768, MRL) | ≈ 359 L4-hours ≈ **€283** | new `vector(768)` + HNSW for 7.9M rows ≈ 24 GB + 33–41 GB ≈ **57–65 GB** next to today's `page_translations` (68 GB, of which the HNSW index is 28 GB); database 170 GB → ≈ 230 GB until the old column is dropped | GPU 15 days on one L4 (≈ 2 days on 8); **Supabase writes** at the measured 20–50 rows/s (#5729) take 2–5 days, unless the rows go in by bulk COPY into a fresh table with the index built after | every search query needs the open model: an always-on L4 ≈ €575/month, or a hosted Qwen API (untested, no key) |
| Qwen3-4B re-embed | ≈ 230 L4-h ≈ €181 | same | same | same |
| Qwen3-0.6B re-embed | ≈ 59 L4-h ≈ €46 | same | same | 0.6B queries could run on CPU, but int8 loses 0.22 R@10; fp32 CPU unmeasured |
| Same-model Gemini refresh, whole corpus | 7.9M × 374 tok ≈ 2.95G tok: $591 realtime, **$295 Batch** | none (in place) | writes as above | none |
| Same-model refresh of off-space + drifted rows only | the off-space rows are found by #6175's detector; drift < 0.9 was 16% of this sample → ≈ $50 Batch if that rate held corpus-wide | none | ≈ 1 day of writes | none |

- **Supabase headroom** is not readable from this box: there is no management-API token, and the provisioned disk size is not visible over SQL. The 170 GB figure is `pg_database_size`. A cutover that adds ~60 GB needs that number from the dashboard first.
- pgvector's HNSW caps `vector` at 2,000 dims, so 8B's native 4,096 and 4B's 2,560 must be stored MRL-truncated. @768 scored the same as native on A and better on B.

### Spend

- **Gemini:** $2.07, logged on `gemini_usage` endpoint `eval/embed-models`, 4 rows: OCR vectors $0.34 + $0.54, fresh control $1.19, queries ≈ $0.001.
- **GPU:** one L4 for 1 h 37 min = **$1.49 (€1.28)**. The lease was tagged (`lease-until`, `owner=6172`), the job ran under `idle-poweroff.sh run --`, and the box and volume were deleted at 12:48 UTC.
- Voyage-4 and Cohere embed-v4: **untested, need keys.**

### Artifacts

- `scripts/eval/embed-models/`:
  - `build-pool-t.mjs`
  - `gold-c.json`
  - `gemini-dual.mjs` (original-text vectors; `--fresh` control)
  - `qwen-embed.py` (CPU int8 / GPU bf16, `--selftest`)
  - `score.mjs`
  - `results/2026-10-07-score.json` (per-query ranks, every arm)
- `scripts/gpu/embed-models-6172-{scw,box}.sh`: the leased-L4 driver.
- Pools and vectors (≈ 2 GB) are not committed. They sit at `/root/claude-jobs/embed-models-eval/` on Hetzner, rebuildable from the seeds.
