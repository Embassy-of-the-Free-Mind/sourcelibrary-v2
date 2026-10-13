---
stage: translation
measure: judged
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 28
n_pages: 112
verdict: "The 993 held no-reference BL Tibetan books read by eye: 9% serious pages (frame-weighted), mostly in the English; 0 wrong leaves, 0 don't-show books, 25 of 28 show with caveat."
status: informational
decision: null
superseded_by: null
issue: 4523
---
## 2026-10-07 · The 993 held BL Tibetan books with no reference (ritual, sādhana, astrology, local), read by eye per monastery: 9% serious pages (frame-weighted), 0 "don't show" (#4523, step B)
<!-- PRIOR ART: .claude/skills/shelf-overview (method, unchanged); scripts/eval/results/spot-check/overview-2026-10-07-bhutan-kangyur (PR #6143: Padmasambhava lives + Derge Kangyur, 2 strata). Neither read the no-reference "other" stratum of the held set, or split it by monastery collection. -->

**Question.** Most of the held set (993 of 1,434 books, 117,643 pages) has no printed reference, so step A's
instrument cannot reach it. What is a reader's experience of these books today: the served OCR (Yigdzin or
Woodblock) and the English already stored, both read against the page image?

**Design.** `shelf-overview` unchanged. Seven strata = the "other" books of each EAP collection (EAP039
Gangtey; EAP105/1 Drametse; EAP105/2 Ogyen Choling; EAP310/1–4 Thadrak, Neyphug, Phurdrup, Tshamdrak). 4 books ×
4 pages (one per quarter of the translated pages), seed 2026100702, `overview-draw.mjs`. Seven Opus reviewers
via `run-reviewers.sh` (`claude -p`, REVIEWER.md + OVERVIEW-ADDENDUM.md, no hints), plus the standing retest of
one random stratum (Phurdrup). $26.08 API-equivalent on subscription ($0 API): 112 pages at $0.196/page, retest
16 pages. `book_checks`: 28 rows (method `shelf-overview`); no book or page was written.

**Result** (`results/tibetan-bl-evidence-2026-10-07/B-shelf-overview/report.md`).

| collection | frame (books) | serious pages (95% CI by book) | OCR | EN | show / caveat / don't |
|---|---|---|---|---|---|
| Ogyen Choling | 411 | 6% (0–19%) | 3.94 | 3.88 | 0 / 4 / 0 |
| Gangtey | 243 | 19% (6–25%) | 3.63 | 3.50 | 0 / 4 / 0 |
| Drametse | 207 | 0% (0–0%) | 4.38 | 4.00 | 1 / 3 / 0 |
| Tshamdrak | 55 | 19% (0–38%) | 4.13 | 3.94 | 0 / 4 / 0 |
| Thadrak | 27 | 13% (0–25%) | 4.00 | 3.75 | 0 / 4 / 0 |
| Neyphug | 26 | 13% (0–25%) | 3.94 | 3.38 | 0 / 4 / 0 |
| Phurdrup | 24 | 13% (0–25%) | 3.94 | 3.81 | 2 / 2 / 0 |
| **all, frame-weighted** | **993** | **9%** | | | **3 / 25 / 0** |

- **Wrong leaf: 0 of 112 pages.** Every page's OCR was of the leaf in the image.
- **Serious defects (14 pages) are mostly in the ENGLISH:** sense inverted with correct OCR (T8, 6 judgements,
  5 on one Tshamdrak astrology page), fluent-over-garble (T7, 3), a misread carried into a fluent English (O6),
  block repetition in the OCR carried into the English (O4, 3 pages: Neyphug p.1, Thadrak p.51, Phurdrup p.210),
  one confabulated title page (O1, Ogyen Choling p.3), one invented note (T10).
- The common moderate classes are T7 (14), T8 (11) and O6 (9 OCR + 6 EN): the English reads fluently over
  uncertain text. Recurrent caveats in the verdicts: four-leaf "boards" whose reading order is uncertain
  (Ogyen Choling, Drametse), guessed names and numbers stated as fact, and books only partly translated.
- **Reviewer consistency** (retest of Phurdrup, 16 pages): serious-flag agreement 0.94, κ 0.76 [0.00, 1.00];
  verdict agreement 3/4. Above the 0.7 floor, but the CI is wide (4 books).

**Reading.**
1. **The no-reference stratum is mostly not the #4523 failure.** No page served another leaf; the OCR scores
   3.6–4.4 of 5. Four pages still carry invented OCR (three repeated blocks, O4; one confabulated title page, O1). That failure class (lite OCR inventing text) is gone from the pages read: 111 of 112 serve
   the Yigdzin read (one Ogyen Choling page still serves a Gemini read).
2. **What remains is mainly an English-quality problem** — 9% serious pages, every book "show with caveat". Re-translating from the Yigdzin read (step C) is what fixes the
   English. These rates describe the CURRENT English; they are the baseline the re-translation must beat.
3. With 4 books per collection, quote the CIs, not the points. Gangtey (largest cursive share, 3.63 OCR) is the
   weakest collection; Drametse the strongest.

Showcase candidates (partner-facing only after Derek's eye) are listed in `report.md`.
