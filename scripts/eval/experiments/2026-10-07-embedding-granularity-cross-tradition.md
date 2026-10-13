---
stage: pipeline
measure: accuracy
languages: []
scripts: []
canons: []
n_books: 304
n_pages: 12154
verdict: "A per-page concept abstract lane was the only index change to clear the bar: relevant traditions in the top ten 1.68 to 2.80 (+1.12 [0.60, 1.64]); chunks and query rewriting did not."
status: adopted
decision: "Concept lane stage 1 built (1,216 books) and serving search; corpus-wide pass held (#6173)"
superseded_by: null
issue: 6173
---
## 2026-10-07 · Which embedding unit, text and ranking put several traditions into the first ten results for a concept? (#6173)
<!-- PRIOR ART: scripts/eval/orig-lang-recall/ (#5729; one gold page per query over untranslated pages, a model comparison), scripts/eval/librarian-search/ (page-grain golden set of factual questions against the live RPCs), scripts/analysis/experience-map/ (#3276; probe retrieval stratified by language, no gold set). None has a gold set of one idea in several traditions and none compares embedding units or texts. -->

- **Question.** Derek, 2026-10-07: "consider also what we need the embeddings for: conceptual links across traditions. We can embed by page, by book, by chapter, by paragraph, by summary." Today there is one vector per page (the translation, else the OCR) and one per book. Which change makes a concept query return Hermetic, Kabbalistic, Buddhist, Daoist and Sufi passages together, and what does it cost at 7.9M pages?
- **Answer.** Embed a short, model-written **concept abstract** of each page, in plain language without the tradition's own terms, as a second lane beside the page vectors.
  - It was the only index change to clear the bar set before scoring: relevant traditions in the top 10 rose from **1.68 to 2.80** (+1.12, 95% CI [0.60, 1.64], 18 queries better, 1 worse).
  - Queries whose top 10 held relevant pages from at most one tradition fell from **15 of 25 to 4**.
  - Paragraph chunks with a book prefix improved precision (P@10 0.36 → 0.50) but not the spread of traditions (+0.44, CI includes 0).
  - Re-ranking the current vectors for diversity gave about +0.5 at a small cost in precision.
  - Rewriting the query into each tradition's vocabulary, the first fix proposed in #3514, made results worse as tested here.
  - Both margins against the bar are narrow, the queries were written by an AI in the same plain register as the abstracts, and the pool is 304 books. So the proposal is a staged build (≈ $50) and a re-test with human queries, with the corpus-wide pass (≈ $530) held until then.
- **measure:** accuracy against by-eye relevance. `rel_trad@10` = distinct traditions with a relevant page in the top 10 (S-recall with traditions as subtopics, as a count). Means over 25 queries; differences are paired by query with a 95% bootstrap interval.

### Who each choice serves

| reader | what they need | what this run says |
|---|---|---|
| 1. A site visitor searching a concept | several traditions on the first screen | concept lane, with at most 2 results per tradition once books carry a tradition label (`c_quota`: 3.24 traditions, 2 of 25 queries stuck at ≤ 1) |
| 2. The Librarian comparing traditions (#6077) | cited passages per tradition | #6077's per-tradition scoped search is the right shape, and it should query the concept lane inside each tradition. Chunks raised precision, which matters for citation; that is a separate question from spread |
| 3. An agent calling `search_concept` (#3895) | a cross-author survey | concept lane; return the tradition label and per-tradition counts with the hits |
| 4. A reader of one page wanting "the same idea elsewhere" | links that mean something | **not tested.** The page's own concept vector is the natural query, but a see-also list is a ranked list readers take as meaningful (`measurement-instruments.md`), so it needs its own by-eye check before it ships |

### Research summary (sources at the end)

- **Unit.** Published evidence favours units smaller than a page, but nearly all of it is factoid question answering.
  - Propositions beat passages by +10 to +12 recall points for unsupervised retrievers on Wikipedia [1].
  - 200–400-token chunks recall as well as 800-token chunks with far less irrelevant text [2].
  - A single vector loses discrimination with input length, steepest between 128 and 1,000 tokens, which is where our pages sit [3][4][5].
  - None of this tests finding the same idea in different words. Smaller units change what can be found, not which vocabulary it is filed under.
- **Text.** The closest prior art is analogy mining: embed an abstraction of each item (its purpose, its mechanism) instead of its text, and retrieval returns analogues from distant domains instead of surface matches from the same one [6][7][8].
  - Precision in the top 1% was 0.74 against 0.63 for TF-IDF [6].
  - An intermediate level of abstraction worked best [8].
  - Replace "domain" with "tradition" and this is arm (c).
- **Other document-side methods.**
  - Contextual retrieval [9] and late chunking [10] repair chunks that lost their document context. They add the book's own vocabulary, so they do not bridge traditions.
  - Late chunking needs token-level output, which the Gemini embedding API does not give.
  - Query-side rewriting (HyDE [11], query2doc [12], multi-query fusion [13]) is evaluated on web question answering. A one-rewrite-per-tradition variant has no published test.
- **Hierarchies and multi-vector.**
  - RAPTOR [14] summarises within a document, so it abstracts within a tradition.
  - GraphRAG [15] was tested on corpora about 3,000 times smaller than ours.
  - ColBERT-style indexes [16] lean on shared tokens and would need about 10 KB per page and a different engine than pgvector.
- **Ranking.**
  - MMR [17] diversifies on whatever the embedding encodes. Explicit methods (xQuAD [18], PM-2 [19], or a plain per-tradition quota) cover named aspects, and need a tradition label.
  - Any diversifier only reorders what retrieval returned. If the candidates are all one tradition there is nothing to promote.
  - Cross-encoder rerankers add 6–14 nDCG points on BEIR [20] but judge in the query's words, so they are not expected to help spread (#2295 stands on precision grounds).
- **Translation or original.** General embedders are weak on classical languages (Sanskrit→Chinese P@1: BGE-M3 40, the domain model MITRA-E 79 [21]), so embedding the English translation is defensible. #5729 found the same on our pages.
- **Prior art in the field.** Intertextuality tools (Tesserae, TRACER, Passim, BuddhaNexus [22]) find the same text reused or translated, at sentence or verse grain. The research pass found no evaluated system and no benchmark for conceptual parallels across unrelated traditions, so the gold set had to be built here.

### Design (committed in 4ae252bdc before any arm was scored; `scripts/eval/embed-granularity/README.md`)

- **Pool.** 12,154 pages from 304 live books: 38 per shelf group, a window of 40 consecutive readable pages per book, one edition per work, seed 6173. All text is English (a translation, or an English-language book).
  - `books.tradition` does not exist and `faceted_tags.tradition` covers 143 of the 304 books, so traditions come from collection slugs with 65 books relabelled by eye.
  - Final labels: hermetic-esoteric 49, christian 51, hindu-indic 39, chinese-daoist-confucian 39, buddhist 37, islamic-sufi 26, greek-roman 24, jewish-kabbalistic 23, zoroastrian 1, other 15.
- **Gold.** 25 concept queries, 252 passages, 3–8 traditions each (`gold.json`, with page links).
  - 33 queries were worded first, from the brief, #3514, #6077, #4251 and the experience-map probe dimensions.
  - Three AI readers then found passages by lexical grep and reading only, never with an embedding arm. Each passage carries a verbatim quote that is machine-checked against the page; none failed.
  - The 25 kept are the six seed concepts plus the 19 others with the most traditions.
- **Arms.** One embedding model throughout (`gemini-embedding-2-preview`, 768-d, the production request).

  | arm | what is embedded or re-ranked | needs |
  |---|---|---|
  | `a` | the stored page vectors (production today; 466 missing pages filled the production way) | nothing |
  | `b` | ~1,000-character passages packed from whole sentences, running across page breaks, each prefixed with title, author, year and section; 37,304 chunks, 3.07 per page; page score = its best chunk | re-embed |
  | `c` | a 2–4 sentence concept abstract per page from `gemini-3.1-flash-lite`: the ideas on the page in neutral modern language, no technical terms and no proper names (median 310 characters; 355 pages answered NONE) | generation + embed |
  | `ac_rrf` | reciprocal-rank fusion of `a` and `c` | as c |
  | `a_book1`, `a_mmr` | `a` with one page per book; `a` with MMR (λ 0.7, top 100) | nothing |
  | `a_quota`, `c_quota`, `ac_quota` | at most 2 pages per tradition | a tradition label per book |
  | `e_rr`, `e_rrf` | #3514's first fix: flash-lite rewrites the query once per tradition in that tradition's vocabulary; eight lists over `a`'s vectors, interleaved or fused | one model call per query |

- **Judging.** The gold set was found by wording, so every non-gold page in any arm's top 10 (1,259 pages) was read by one of four AI judges with the arm and rank hidden. Grades: 2 states the idea, 1 touches it, 0 not about it. Relevant = gold or grade 2 (278 pages). No top-10 slot is unjudged.
- **The bar.**
  1. A new index is proposed only if it raises `rel_trad@10` over `a` by ≥ +1.0 with an interval that excludes 0, the gold-only measure agrees in sign, and it beats the best arm that needs no re-embedding by ≥ +0.5 with an interval that excludes 0.
  2. A diversity re-ranker is proposed if it adds ≥ +1.0 over its base arm with P@10 falling by ≤ 0.10.

### Result

| arm | rel_trad@10 | P@10 | queries with ≤ 1 relevant tradition | gold_trad@10 | gold_R@50 | trad@10 (any page) | books@10 |
|---|---|---|---|---|---|---|---|
| `a` page vectors (today) | **1.68** | 0.36 | 15 | 0.12 | 0.14 | 2.80 | 5.4 |
| `b` chunks + prefix | 2.12 | **0.50** | 8 | 0.15 | 0.24 | 2.88 | 5.2 |
| `c` concept abstract | **2.80** | 0.45 | 4 | 0.16 | 0.25 | 3.88 | 7.4 |
| `ac_rrf` | 2.32 | 0.45 | 8 | 0.14 | 0.24 | 3.36 | 6.5 |
| `a_book1` | 2.04 | 0.31 | 8 | 0.12 | 0.15 | 4.12 | 10.0 |
| `a_mmr` | 2.24 | 0.31 | 6 | 0.12 | 0.14 | 4.72 | 9.3 |
| `a_quota` | 2.20 | 0.30 | 8 | 0.08 | 0.15 | 5.52 | 8.0 |
| `c_quota` | **3.24** | 0.41 | 2 | 0.14 | 0.25 | 5.52 | 8.6 |
| `ac_quota` | 3.16 | 0.43 | 3 | 0.12 | 0.24 | 5.56 | 8.0 |
| `e_rr` | 1.16 | 0.14 | 17 | 0.07 | 0.11 | 6.32 | 8.6 |
| `e_rrf` | 1.36 | 0.25 | 16 | 0.08 | 0.12 | 3.92 | 5.9 |

Paired differences in `rel_trad@10` (95% CI; queries better/worse):

| comparison | diff | CI | better/worse | P@10 diff |
|---|---|---|---|---|
| `c` − `a` | **+1.12** | [0.60, 1.64] | 18/1 | +0.08 [0.00, 0.17] |
| `c` − `a_mmr` (best arm with no re-embedding) | **+0.56** | [0.08, 1.04] | 14/5 | +0.14 [0.06, 0.22] |
| `b` − `a` | +0.44 | [−0.12, 0.96] | 12/4 | +0.14 [0.08, 0.20] |
| `ac_rrf` − `a` | +0.64 | [0.32, 1.00] | 12/1 | +0.08 [0.04, 0.13] |
| `a_mmr` − `a` | +0.56 | [0.20, 0.92] | 14/4 | −0.06 [−0.11, −0.00] |
| `a_quota` − `a` | +0.52 | [0.20, 0.84] | 12/2 | −0.06 [−0.12, −0.00] |
| `c_quota` − `c` | +0.44 | [0.08, 0.84] | 8/2 | −0.04 [−0.09, 0.01] |
| `ac_quota` − `ac_rrf` | +0.84 | [0.40, 1.28] | 13/2 | −0.02 [−0.08, 0.04] |
| `c_quota` − `a` | +1.56 | — | — | +0.05 |
| `e_rr` − `a` | −0.52 | [−1.04, 0.04] | 6/12 | −0.23 [−0.32, −0.14] |

Queries (of 25) with a relevant top-10 page from each tradition; the gold set holds that tradition for the number in the last row:

| arm | greek-roman | christian | hermetic | kabbalistic | islamic-sufi | hindu-indic | buddhist | chinese |
|---|---|---|---|---|---|---|---|---|
| `a` | 5 | 9 | 3 | 2 | 6 | 9 | 4 | 4 |
| `b` | 7 | 13 | 9 | 2 | 2 | 8 | 3 | 9 |
| `c` | 10 | 13 | 12 | 9 | 4 | 8 | 7 | 7 |
| `c_quota` | 12 | 13 | 14 | 8 | 6 | 10 | 8 | 10 |
| `e_rr` | 2 | 8 | 1 | 4 | 6 | 6 | 1 | 1 |
| gold holds it | 15 | 22 | 18 | 14 | 19 | 23 | 16 | 19 |

- **Against the bar.**
  - **`c` clears part 1, narrowly on both counts:** +1.12 over `a` against a bar of +1.0, and +0.56 over `a_mmr` against +0.5. The gold-only measure agrees in sign (+0.03, interval includes 0).
  - **`b` does not clear it** (+0.44, interval includes 0).
  - **`ac_rrf` does not** (+0.64 < 1.0), so fusing the lanes into one list is not the way to combine them.
  - **No re-ranker clears part 2 alone:** each adds 0.4–0.8 over its base. The quota adds the most on a fused list and the least where the base is already spread. `c_quota` is the best arm overall (+1.56 over today, P@10 +0.05), but that is two changes together.
- **#3514 is reproduced.** For "what makes a human life go well; the highest good and true flourishing for a person", today's top 10 is nine pages of al-Fārābī and one of Llull. The single largest tradition holds 67% of an average top 10 under `a`.
- **The two lanes return different pages.** `a` and `c` share 1.3 of 10 results on average. That is why `c` is proposed as a second lane and not as a replacement: a reader who types a tradition's own term ("fanāʾ", "prima materia") is still best served by the text itself.
- **Query expansion failed as tested.** The rewrites pack several terms of art into one sentence ("cleave to the Divine through *mitzvot*, achieving *devekut*… *Ein Sof*"), and each retrieves pages dense in those terms and about something else.
  - Results were spread across traditions (6.3 in an average top 10) and mostly irrelevant (P@10 0.14).
  - This is one prompt. A list of bare terms per tradition, or the hand-built alias nodes of #4251, is a different design and is not refuted.
  - #6077's per-tradition scoped search does not depend on rewriting and is not touched by this.
- **The lexical gold set is mostly out of reach of every embedding arm.** Only 11–25% of gold passages are in any arm's top 50, and gold is 21–26 of the 91–126 relevant pages in the top 10s.
  - Passages a reader finds by a tradition's own words, and passages an embedding ranks first, are largely different sets. The experience map found the same (1,797 of 139,201 pages found by both of its lanes).
  - No embedding design here replaces a term or alias lane (#4251); the concept lane adds to it.
- **Chapters and books.** Not run as arms. Chapter boundaries exist for 270 of the 304 pool books but only as a prefix in `b`. A chapter or book vector answers "which book is about X" (the existing `book_embeddings` job), and length studies [3][5] say a single vector over a chapter keeps less than one over a page.

### Recommended architecture

1. **Keep the page vectors as they are.** They serve topical search, in-book search and #5729's original-language lane.
2. **Add a concept lane.** One abstract per translated page from flash-lite in batch, embedded at 768-d as `halfvec`, in its own table (`page_concepts`: page id, book id, page number, abstract, vector, prompt version) with its own index and RPC.
   - It is read by `search_concept`, by #6077's `compare_traditions` inside each tradition, and by concept queries on the site.
   - The abstract is an index key. It is a model paraphrase, so it is never shown as the page's text and never quoted; the reader gets the page (`quote-and-snippet-integrity.md`).
   - The two lanes are shown or interleaved as lanes, not fused into one score.
3. **Spread the first screen.** Until books carry a tradition label, one result per book or MMR (free, about +0.5). With `books.tradition` (#4773, ≈ $3 proposed there), at most 2 per tradition in the first ten.
4. **Not now:**
   - chunks for this purpose (they are a precision change; test them for the Librarian's citations on their own);
   - query rewriting as tested;
   - late chunking, ColBERT, RAPTOR and GraphRAG, for the reasons in the research summary.

### Priced plan (batch prices; pilot ratios: 30 prompt tokens and 58 output tokens per page, 75 tokens per abstract; corpus mean 374 tokens per page)

| option | pages | model spend | new storage in Supabase (database is at 166 GB) | status |
|---|---|---|---|---|
| Re-rank only (`a_book1` / `a_mmr`) | — | $0 | none | supported as an interim step |
| Tradition quota | 63K books | ≈ $3 (#4773) | one field on `books` | wait for #4773 |
| **Concept lane, stage 1**: ~2,000 books across the eight traditions | ≈ 500K | **≈ $50** | ≈ 2 GB as `halfvec` | **proposed** |
| Concept lane, every translated page | 5.2M | ≈ $530 (abstracts $490, embedding $40) | ≈ 20 GB `halfvec` (≈ 39 GB as `vector`) | after stage 1 is re-tested |
| Concept lane, all 7.9M pages incl. untranslated | 7.9M | ≈ $800 | ≈ 30 GB `halfvec` | untested: every pilot page was English |
| Chunks with prefix, corpus-wide | ≈ 15.8M chunks | ≈ $375 | ≈ 57 GB `halfvec` (≈ 114 GB as `vector`) | not proposed: missed the bar |
| Model-written context per chunk (Anthropic's form) | ≈ 15.8M chunks | ≈ $1,800 + $375 | as above | not proposed |

Realtime prices are double. `gemini-2.5-flash-lite` would be cheaper per token but returns 404 on our key (`model-pricing.mjs`).

- **Stage 1 definition of done.**
  - The lane is behind a flag on `search_concept`.
  - 25 queries written by people (Derek, Francis-style Librarian questions, agent logs), judged by eye with a second rater on a sample.
  - `c` again beats `a` by ≥ +1.0 traditions in the top 10 at no loss in P@10, at a pool of ≈ 500K pages. If it does not, the corpus-wide pass is not run.

### Caveats

- **The queries favour arm c.** An AI wrote them in plain modern English, which is the register the abstracts are written in. A reader who types a term of art may see the opposite. This is the main reason for stage 1.
- **Narrow margins, one run.** +1.12 against +1.0 and +0.56 against +0.5, on 25 queries. Abstracts were generated once at temperature 0; nothing was replicated.
- **Small pool.** 12K pages. At 5.2M the largest shelves (Latin is 36% of translated rows) crowd harder, and the quota or a per-tradition search matters more.
- **AI judges, one per query, no second rater.**
  - Strictness varied: 14% to 28% of pages got grade 2. Comparisons are paired within a query, so this does not favour an arm, but absolute P@10 is soft.
  - One judge read only the first 1,900–3,200 characters of long pages.
  - Two of the three gold readers read around the matching passage, not always the whole page.
- **Tradition labels are by eye and argued at the edges:** Christian Kabbalah, Boehme, and modern popularisers (one judge filed "Yogi Ramacharaka" as Hindu, two as esoteric). Jain texts sit under hindu-indic.
- **355 pages (2.9%) got NONE** and cannot be found in the concept lane, by design (indexes, tables, title pages).
- **Abstracts were not checked for fidelity.** They are never shown, but an abstract that states an idea the page does not hold would produce a false link. Stage 1 should sample 100 against their pages.
- **`b0` (chunks without the prefix) was not run.** `b` missed the bar, so the ablation could not change the recommendation; ≈ $1.60 saved.
- *Replicated?* No. Single run.

### Spend

≈ **$5.21** of the $8 allowed, logged to `gemini_usage` as `eval/embed-granularity`:

| item | tokens | cost |
|---|---|---|
| abstracts (7.54M in, 0.71M out, realtime) | 8.25M | $2.94 |
| chunk embeddings | 9.16M | $1.83 |
| first chunk run, stopped at 4,000 chunks by a 429 on the shared embedding quota (**not logged**) | ≈ 1M | ≈ $0.20 |
| abstract embeddings | 0.88M | $0.18 |
| missing page vectors | 0.27M | $0.05 |
| queries and rewrites | — | < $0.01 |

### Artifacts

`scripts/eval/embed-granularity/`: pool builder, labels, the three index arms, `gold.json` (25 queries, 252 passages with page links and quotes), `expansions.json`, `run-arms.mjs`, `score.mjs`, `results/2026-10-07-score.json` (per-query measures and every arm's top 10 with grades), `results/judgments.json` (1,259 grades). The pool text, abstracts and vectors (≈ 230 MB) are at `/data/scratch/sl/claude-jobs/embed-granularity-research-work/` on the job box and rebuild from seed 6173.

### Sources

The research pass opened each source unless marked (s), which rests on a search summary only.

1. Chen et al., "Dense X Retrieval: What Retrieval Granularity Should We Use?", 2023, arXiv:2312.06648.
2. Smith and Troynikov, "Evaluating Chunking Strategies for Retrieval", Chroma technical report, 2024, https://www.trychroma.com/research/evaluating-chunking
3. Jina AI, "Long-Context Embedding Models are Blind Beyond 4K Tokens", 2025, https://jina.ai/news/long-context-embedding-models-are-blind-beyond-4k-tokens/ (vendor blog, one model).
4. Coelho et al., "Dwell in the Beginning: How Language Models Embed Long Documents for Dense Retrieval", 2024, arXiv:2404.04163.
5. Zhou et al., "Length-Induced Embedding Collapse in PLM-based Models", ACL 2025, arXiv:2410.24200.
6. Hope, Chan, Kittur, Shahaf, "Accelerating Innovation Through Analogy Mining", KDD 2017, arXiv:1706.05585.
7. Chan et al., "SOLVENT: A Mixed Initiative System for Finding Analogies between Research Papers", PACM HCI (CSCW) 2018 (numbers not verified).
8. Kang et al., "Augmenting Scientific Creativity with an Analogical Search Engine", 2022, arXiv:2205.15476.
9. Anthropic, "Introducing Contextual Retrieval", 2024, https://www.anthropic.com/news/contextual-retrieval (35% / 49% / 67% fewer top-20 failures; $1.02 per million document tokens).
10. Günther et al., "Late Chunking: Contextual Chunk Embeddings Using Long-Context Embedding Models", 2024, arXiv:2409.04701 (+1.9 nDCG@10 on average).
11. Gao, Ma, Lin, Callan, "Precise Zero-Shot Dense Retrieval without Relevance Labels" (HyDE), 2022, arXiv:2212.10496.
12. Wang, Yang, Wei, "Query2doc", EMNLP 2023, arXiv:2303.07678.
13. Rackauckas, "RAG-Fusion", 2024, arXiv:2402.03367.
14. Sarthi et al., "RAPTOR", ICLR 2024, arXiv:2401.18059.
15. Edge et al., "From Local to Global: A Graph RAG Approach to Query-Focused Summarization", 2024, arXiv:2404.16130.
16. Santhanam et al., "ColBERTv2", NAACL 2022, arXiv:2112.01488.
17. Carbonell and Goldstein, "The Use of MMR, Diversity-Based Reranking…", SIGIR 1998 (s).
18. Santos, Macdonald, Ounis, "Exploiting Query Reformulations for Web Search Result Diversification" (xQuAD), WWW 2010 (s).
19. Dang and Croft, "Diversity by Proportionality" (PM-2), SIGIR 2012 (s); subtopic recall: Zhai, Cohen, Lafferty, "Beyond Independent Relevance", SIGIR 2003 (s).
20. Elastic Search Labs, "Elastic semantic reranker, part 2", 2024, https://www.elastic.co/search-labs/blog/elastic-semantic-reranker-part-2 (vendor benchmark).
21. Nehrdich and Keutzer, "MITRA…", 2026, arXiv:2601.06400.
22. Nehrdich, "A Method for the Calculation of Parallel Passages for Buddhist Chinese Sources…", JJADH 5(2), 2020.

Vendor facts read 2026-10-07: Gemini pricing (https://ai.google.dev/gemini-api/docs/pricing: embedding $0.20 per 1M tokens, $0.10 batch; `gemini-3.1-flash-lite` $0.25 / $1.50, batch half), pgvector row sizes (https://github.com/pgvector/pgvector: `vector` 4 × dims + 8 bytes, `halfvec` 2 × dims + 8). The index estimate uses our own figure: 26 GB of HNSW for 6.7M 768-d rows.
