# #6170 follow-up: the prefix test at ~100K pages (job embed-next-6173)

<!-- PRIOR ART: scripts/eval/experiments/2026-10-07-embedding-format-ga.md — the first test, two pools of 8–10K pages scored separately, both baselines at the ceiling (R@10 0.93 / 0.97). This file fixes the design and the bar for the larger test before any arm is scored. -->

Approved 2026-10-07 (Derek, "defaults"): a ~$10 test on a ~100K-page pool where the
baseline is not at the ceiling, before any decision on the ≈ $360 prefix re-embed.

## Pool (build-pool-100k.mjs, seed 61701)

One pool. Both gold sets search all of it, mixed the way `page_translations` is:
translated pages as their English translation, OCR-only pages as the cleaned OCR.

| role | what |
|---|---|
| a-gold | the 40 set-A gold books, up to 60 OCR pages each, gold page forced in (OCR even where the book has since been translated: set A is the cross-lingual test) |
| a-sib | every other live edition of a set-A gold work, up to 40 pages, production text |
| b-exp | every set-B expected book and every other edition of its work, 20 translated pages |
| dup | near-duplicate clusters: works with ≥ 3 live translated editions, up to 4 editions × 20 pages |
| ocr | OCR-only books (mostly Chinese, as in the live table), 30 pages |
| tr | random live translated books, 20 pages, until the budget |

Filler never takes a concept-lane stage-1 book (#6173): the two envelopes would
meter each other's spend.

## Gold

- **Set A** (page level, cross-lingual): the 40 #5729 queries, plus new queries
  written for this pool by AI readers from OCR-only pages, without any embedding
  arm. A hit is the gold page, or a page of another edition of the same work
  that holds the same passage (found by character-shingle overlap with the gold
  page's OCR, then confirmed by reading; `gold-100k/a-equivalents.json`).
- **Set B** (book level): the 31 Librarian golden-set queries, with every edition
  of an expected work counted as expected; plus new queries about the CONTENT of
  a near-duplicate cluster that name no author, title or work (so the title in the
  document prefix cannot match them), every edition of the cluster's work expected.
- Original queries and new ones are scored together and also reported apart.

## Arms (768-d, gemini-embedding-2-preview, Batch API for documents)

| arm | query | documents |
|---|---|---|
| 1f | plain | plain (production format, re-embedded) |
| 2 | `task: search result \| query: …` | plain |
| 2d | plain | `title: … \| text: …` |
| 4 | `task: search result \| query: …` | `title: … \| text: …` |

## The bar (fixed here, before scoring)

The ≈ $360 re-embed of `page_translations` with the document prefix is recommended
only if **arm 4** against **arm 1f**:

1. raises R@10 by **≥ +0.05 on set A AND on set B** (all queries of each set), and
2. shows **no reversal**: neither set, nor any set-A language stratum with ≥ 5
   queries, loses more queries at rank ≤ 10 than it gains.

If arm 4 misses the bar, the recommendation is no re-embed. Arm 2 (query prefix
only) is reported because it is free to ship; it needs the same bar. MRR, top-1,
gained/lost, a sign test on ranks and Wilson intervals are reported for every arm.
