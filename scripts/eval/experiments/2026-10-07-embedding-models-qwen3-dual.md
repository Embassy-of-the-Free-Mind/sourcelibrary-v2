## 2026-10-07 · Would a different embedding model, or a second original-language vector, find more of the right pages? (#6172)
<!-- PRIOR ART: scripts/eval/orig-lang-recall/ (#5729; pool A, gold A, Gemini/e5/BGE-M3 arms, scorer reused here) and scripts/eval/librarian-search/ (golden set B, book-grain, run through the LIVE index only — no pool, so no way to score a model that has no stored vectors). Neither has a translated-page pool with both OCR and translation text, nor a Qwen3 arm. #6170 (job embed-format-eval) covers Gemini preview→GA, task prefixes and dims; not repeated here. -->

**Status: design fixed, nothing scored yet.** This section is committed before any arm is scored; results are appended below it.

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
