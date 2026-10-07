# embed-granularity — which unit, text and ranking serve cross-tradition concept search (#6173)

<!-- PRIOR ART: scripts/eval/orig-lang-recall/ (#5729; one gold page per query, untranslated pages, model comparison), scripts/eval/librarian-search/ (page-grain golden set of factual questions, live RPCs), scripts/analysis/experience-map/ (probe retrieval stratified by language, no gold set). None has a gold set of the same idea in several traditions, and none compares embedding units. -->

Derek, 2026-10-07: "consider also what we need the embeddings for: conceptual
links across traditions." This pilot asks which change puts passages from
several traditions into the first ten results for a concept query.

## Design (fixed before any arm was scored)

**Pool.** 12,154 pages from 304 live books, 38 per shelf group, a window of 40
consecutive readable pages per book, one edition per work (`build-pool.mjs`,
seed 6173). Every page is English text (a translation, or the OCR of an
English-language book). Shelves are loose, so 65 books were relabelled by eye
(`label-books.mjs`): hermetic-esoteric 49, christian 51, hindu-indic 39,
chinese-daoist-confucian 39, buddhist 37, islamic-sufi 26, greek-roman 24,
jewish-kabbalistic 23, zoroastrian 1, other 15. `other` never counts as a
tradition.

**Gold.** 33 candidate queries were worded first (`candidate-queries.json`).
Three readers then looked for passages with lexical grep and reading only
(`pool-tool.mjs`), never with an embedding arm, and recorded a verbatim quote
per passage, which `build-gold.mjs` checks against the page. All 33 reached
three traditions. 25 were kept by a rule that reads only the gold: the six seed
concepts (c01–c06) and the 19 others with the most traditions. `gold.json`:
25 queries, 252 passages, 3–8 traditions each.

**Arms.** `run-arms.mjs` lists them. One embedding model throughout
(`gemini-embedding-2-preview`, 768-d, no task type: the production request), so
arms differ in unit, text and ranking only.

**Judging.** The gold set was found lexically, so it misses relevant pages that
do not use the expected words. Every non-gold page in any arm's top 10 is
therefore read by eye and graded, with the arm and the rank hidden:
2 = states or develops the idea (a scholar would put it beside the gold
passages), 1 = touches it, 0 = not about it. Relevant = gold, or grade 2.

**Measures** (accuracy against by-eye relevance, per query, mean of 25):

- `rel_trad@10`: distinct traditions with a relevant page in the top 10. Primary.
- `P@10`: relevant pages in the top 10, as a share.
- `gold_trad@10`: share of the query's gold traditions with a gold page in the
  top 10. Needs no judging; the check that judging did not move the result.
- `gold_R@50`: share of gold pages in the top 50 (is there anything to re-rank?).
- `trad@10`: distinct traditions in the top 10, relevant or not. Reported, never
  a target: a quota reaches it with unrelated pages.
- `books@10`: distinct books in the top 10.

Differences are paired by query, with a 95% bootstrap interval over the 25
queries (10,000 resamples, seed 6173).

## The bar

Written before scoring. `a` is production today.

1. **A new index (b or c, corpus-wide spend) is proposed only if** it raises
   `rel_trad@10` over `a` by at least **+1.0**, the interval excludes 0,
   `gold_trad@10` agrees in sign, **and** it beats the best arm that needs no
   re-embedding (`e_rr`, `e_rrf`, `a_mmr`, `a_book1`) by at least **+0.5** with
   an interval that excludes 0. If it beats `a` but not those, the cheap arm is
   the recommendation and the new index is not proposed.
2. **A diversity re-ranker is proposed if** it raises `rel_trad@10` over its
   base arm by at least **+1.0**, the interval excludes 0, and `P@10` falls by
   no more than **0.10**.
3. **Fusion (`ac_rrf`) counts as a win for c** only if it also clears 1.
4. If no arm clears 1 or 2, the result is "no change supported at this size",
   and the write-up says what a larger test would need.

`b0` (chunks without the prefix) is an ablation added only if budget remains
after the three main arms; it is reported apart from the bar.

## Run

    D=/root/claude-jobs/embed-granularity-research-work
    node --env-file=.env.production.local scripts/eval/embed-granularity/build-pool.mjs --out $D
    node scripts/eval/embed-granularity/label-books.mjs --dir $D
    node --env-file=.env.production.local scripts/eval/embed-granularity/arm-a-stored.mjs --dir $D
    node --env-file=.env.production.local scripts/eval/embed-granularity/arm-b-chunks.mjs --dir $D
    node --env-file=.env.production.local scripts/eval/embed-granularity/arm-c-abstracts.mjs --dir $D          # generate
    node --env-file=.env.production.local scripts/eval/embed-granularity/arm-c-abstracts.mjs --dir $D --embed
    node scripts/eval/embed-granularity/build-gold.mjs --dir $D
    node --env-file=.env.production.local scripts/eval/embed-granularity/run-arms.mjs --dir $D
    node scripts/eval/embed-granularity/score.mjs --dir $D

The pool and the vectors are not committed (35 MB of text, ~190 MB of vectors);
they rebuild from the seed. Result: `scripts/eval/experiments/2026-10-07-embedding-granularity-cross-tradition.md`.
