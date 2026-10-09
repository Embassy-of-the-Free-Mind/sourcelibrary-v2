---
stage: translation
measure: none
languages: []
scripts: []
canons: []
n_books: 21411
n_pages: 21411
verdict: "A deterministic $0 cleanup (A2) would touch about 479K served pages (9.8%); off-page original: notes about 173K; reader-visible markup leaks about 22K."
status: informational
decision: "A2 cleanup approved by Derek 2026-10-04 and applied (2026-10-04-a2-cleanup-applied-5700.md)"
superseded_by: null
issue: 5700
---
## 2026-10-03 — How many served translated pages would each text-quality backfill touch? A1 census, $0 (#5700)

PRIOR ART: 2026-09-30 monthly translation corpus audit (`_series-monthly-translation-corpus-audit.md`) judges translation fidelity on ~100 pages with a model. This census uses no model: it sizes deterministic defect CLASSES on every live translated book. The (b) verifier is `scripts/lib/page-terms-parse.mjs` `verifyQuote()` (#3825/#4777), reused unchanged. The (c) "what the reader sees" check imports the reader's own `NotesRenderer`.

**Question.** Before paying for any backfill, how many served translated pages carry each of: (a) decorative-initial or scan-condition notes; (b) `original:` notes not on the page; (c) leaked markup; (d) reading-order breaks (#5699); (e) OCR-risk strata?

**Design.** `measure: count`, which is not quality. Population: all 21,411 live translated books (`visible, pages_count > 0, pages_translated > 0`; 4,906,211 translated pages, exact). One seeded interior page per book (`makeRng(5700)`, index-only draw, no `$sample`), page-weighted by `pages_translated`, bootstrap CIs over books. (c) is measured twice: on stored `translation.data`, and on the reader's rendered output. (d) is a new detector (`page-marker-order.mjs`). It reads printed markers from running heads, centred numerals and bare numerals, never `<page-num>`, and scans served pages only. It ran in full on RTL, CJK and multi-language books (2,372) plus a seeded 1,500-book sample of the rest. Precision was judged by eye on 20 flagged books per round.

**Result.**
- **A2, deterministic $0 cleanup: ≈ 479K pages (9.8%, CI 452K–505K)**, the biggest backfill.
  - (a) ≈ 227K (4.6%). Mostly decorative initials; **20% of pre-1500 pages**.
  - (b) ≈ 173K (3.5%), which is 15.3% of the pages that carry any `original:` note. Sanskrit 29.5%, Hebrew 27.7%, Tibetan 24.8%, Greek 22.4%, Latin 18.6%, Arabic 10.5%.
  - (c) raw tag faults ≈ 194K (4.0%), led by `<margin></margin>`+text+`</margin>`. Leaks the reader actually shows ≈ 22K (0.44%). Placeholder brackets ≈ 62K (1.3%).
- **No Esukhia `#` in served English.**
- **(d)** 52 of 736 RTL books flagged (Syriac 21/82, mostly Bedjan volumes stored back to front), 8 of 1,456 CJK, about 114 of the 19,039 others. Precision **16/20** on a fresh sample. Maqrizi is pair-swapped through the whole book, not at one place.
- **(e)** Latin before 1550: 634,822 pages (exact). Chinese interlinear commentary ≈ 24K pages. Rotated (as the OCR noticed) ≈ 12K. Grossly garbled OCR ≈ 21K.
- **Retraction inside the run:** detector v1–v2 "found" reversed books that were soft-hidden negative-`page_number` spreads, which sort in reverse by construction. The fix was to scan served pages only.

**Replicated?** No. One draw. The (d) precision is from one fresh 20-book sample, after four tuning rounds on other samples.

**Artifact.** `results/quality-census-2026-10/` (README, `census.json`, `pages.jsonl`, `page-order-summary.json`, `d-precision-review.md`). Scripts: `quality-census-draw.mjs`, `quality-census-score.mjs`, `page-marker-order.mjs`.
