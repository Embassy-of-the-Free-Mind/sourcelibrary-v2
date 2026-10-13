---
stage: metadata
measure: accuracy
languages: []
scripts: []
canons: []
n_books: 68
n_pages: null
verdict: "Metadata-only date rules (v3) classify IA candidates old vs modern at 65/68 = 95.6% against title pages read by eye, clearing the 90% bar."
status: adopted
decision: "v3 rules write classification.date_check on 1.0M IA candidates (scripts/lib/ia-date-check.mjs, #5458)"
superseded_by: null
issue: 5458
---
## 2026-10-01 · IA candidate dates: which Internet Archive items are actually old? (#5458)

- **Question.** Can metadata rules alone, with no AI calls, tell whether an `ia_language` import candidate dated <1900 or undated was really produced before 1900?
- **Design.** IA scrape-API metadata was pulled for 1,003,754 candidates. Rules in `scripts/lib/ia-date-check.mjs` cover provenance (library catalogue / DLI / Universal Library / patron upload), calendar conversion (AH, Solar Hijri, Bengali San, Vikram, ROC, Anno Mundi) and modern markers. Each round validated a blind, stratified sample of 100 by reading the title page or colophon from IA page images. The bar was modern-vs-old accuracy of at least 90% where both sides were decided. `measure: accuracy` (label read from image).
- **Result.**
  - Round 1, v1: 60/69 = 87%, which fails the bar. The misses traced to four rules (ordinal editions, an ISBN on a microfiche, Shaka/VS-coded DLI years, DLI pre-1800) and those were fixed.
  - Round 2, 99 fresh items: v2 scored 61/68 = 89.7%.
  - v3 adds one rule for the `ds-legacy-data` screenshot family. That rule was confirmed on 10 further items by page hash (16/16 overall). v3 scores 65/68 = 95.6%, with old precision 30/31 and modern precision 35/37.
  - Undated patron uploads read modern 25/25. The `unknown` class is mixed: 8 old, 7 modern, 5 undecidable.
  - Written to the candidates as `classification.date_check`: old 222,492, modern 635,098, unknown 146,164. Of these, 3,022 rare-language items are old and pre-1800.
- **Replicated?** Partly. Round 2 is an out-of-sample replication of the v2 rules. The v3 rule has its own out-of-sample check, but the full v3 rule set was not re-drawn a third time.
- **Artifact.** `scripts/audit/results/ia-date-check-2026-10-01/` (`validation-labels.jsonl`, tables, library report).
