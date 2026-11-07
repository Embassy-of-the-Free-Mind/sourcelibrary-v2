---
stage: ocr
measure: [judged, judged_vs_reference]
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 35
n_pages: 35
verdict: "Opus correction of the stored Paddle text restores the 丨 ditto marks; re-running Paddle does not. On 30 zero-丨 pages of 佩文韻府 / 駢字類編 (one per book, seed 5274), usable pages were P0 1/30, Paddle at full resolution 5/30, Paddle full resolution with layout off 12/30, Opus correction 28/30 on the stored image and 29/30 on the Archive's, agy Flash correction 22/30. Marks recalled against the Kanripo WYG leaf: P0 2.6%, Paddle full resolution 27%, Opus 99.6-99.7%, agy 95%. Blind Opus judge, misleading: P0 29/30, Opus stored 7/30, Opus Archive 2-3/30, agy 24/30. Full resolution hurt the control pages (recall 77% to 31%). By Kanripo the loss is larger than the zero-丨 count: 29,073 of 62,491 pages have lost at least 10% of their marks, 20,018 of them all."
status: informational
decision: "Recommended route: paddle>opus with the ditto instruction on the stored image (P2-r2), the cheapest arm that clears the preregistered rule, about 6-12% of a Claude account-week per 1,000 pages. The whole run crosses the spend floor at fee share and touches held books, so it is a DECISION on #5274. No production write in this PR."
superseded_by: null
issue: [5274]
router_evidence: "none — the export is in router-table/evidence/zh-ditto-5274.score.json. rules.json does not name it: this is a defect-specific instruction on a subset of the Siku Paddle cells, not a new route for a cell, and the cell's route is unchanged until the DECISION on #5274"
defect_rates: "none — marks and CER per page are in scripts/eval/results/zh-ditto-restore-5274/; the judge gave page verdicts, with no per-1,000-word rate"
---
## 2026-11-03 · Which route restores the 丨 ditto marks in 佩文韻府-type dictionaries? (#5274)

PRIOR ART:
- `scripts/audit/headword-mark-drop.mjs` (the page census), which counted the marks but had nothing to compare them to.
- `scripts/eval/paddle-correct-6561/` (Paddle zh correction scored against Kanripo; the bar folding in its scorer).
- `scripts/batch/ocr-convergence/correct.mjs` (the #7568 correction prompt, imported) and
  `scripts/eval/flash-reread-5924/fc-prompt.mjs` (its one-page agy form, run as it stands).
- `scripts/eval/flash-reread-5924/C-TASK.md` and `T-TASK.md` (the judge's words).

Preregistration: `scripts/eval/zh-ditto-restore-5274/PREREG.md`, committed before any arm read a page (14f2ba019).

**Question.** Which route restores the marks, and fixes the misreads, at the lowest cost per usable page, so that a
translator can expand them?

### Result

30 zero-丨 pages, one per book (28 佩文韻府, 2 駢字類編), plus 5 keep pages as a control. Marks are measured against the
Kanripo WYG leaf (29 of the 30 pages; the 30th against the counter).

| arm | usable (95% CI) | marks: recall / precision | placed runs: recall / precision | median CER, marks removed | pages with no mark | misleading, blind | keep pages: usable, recall |
|---|---:|---:|---:|---:|---:|---:|---:|
| **P0** stored Paddle | 1/30 (1–17%) | 2.6% / 93% | 2.6% / 87% | 11.4% | 29 | **29/30** | 3/5, 77% |
| P1-r2 Paddle again, stored image | 2/30 (2–21%) | 5.8% / 97% | 5.7% / 91% | 13.5% | 27 | — | 1/5, 77% |
| P1-ia Paddle, Archive's file, no resize | 5/30 (7–34%) | 27% / 100% | 27% / 95% | 12.3% | 18 | — | 1/5, **31%** |
| P1-up3 Paddle, stored image ×3 | 4/30 (5–30%) | 26% / 100% | 27% / 97% | 11.9% | 20 | — | 1/5, 59% |
| P1-ia-nolayout, Archive's file, layout off | 12/30 (25–58%) | 61% / 100% | 59% / 97% | 7.7% | 11 | — | 2/5, 74% |
| **P2-r2** Opus correction, stored image | **28/30** (79–98%) | 99.6% / 98.6% | 96% / 97% | 3.7% | 0 | **7/30** | 5/5, 100% |
| **P2-ia** Opus correction, Archive's file | **29/30** (83–99%) | 99.7% / 99.6% | 97% / 98% | 3.7% | 0 | **2/30, 3/30** (two runs) | 5/5, 99% |
| P3-ia agy Flash-low correction, Archive's file | 22/30 (56–86%) | 95% / 99% | 89% / 92% | 5.6% | 0 | **24/30** | 5/5, 99% |

"Usable" is the preregistered bar: marks recall and precision ≥ 0.9, placed-run recall ≥ 0.8, and CER with marks removed no
worse than P0 + 0.5 pt. It says nothing about misreads except that they got no worse, which is why P3 can reach 22/30 usable
and still be misleading on 24/30.

**Route (the preregistered rule): P2-r2.** Against the rule's parts:
- Clears ≥ 24/30 usable: P2-r2 and P2-ia. P3 (22/30) does not. Every P1 arm is far below.
- Keep pages not damaged: both pass.
- Misleading at most half of P0's (≤ 14): both pass.
- Cheapest per 1,000 usable: P2-r2 at $125 list equivalent, P2-ia at $131. A 5% gap on 30 pages.

**P2-r2 or P2-ia.** The judge leans to the Archive's file (7 vs 3 misleading; pages misleading on one arm only: 7 and 3, sign
p ≈ 0.34; preference 7–13, 10 ties, p = 0.26). Kanripo does not back the lean. Mean CER with marks removed is 5.66% vs 5.55%,
4 pages better vs 2. On nine readings the judge named, which I checked against the leaf, Kanripo sides with P2-ia on five (瀼水, 賈餗, 蕭驃騎, 張說, 如襆) and
with P2-r2 on four (玉律, 淺瀨, 庾闡, 二日念). So the stored image is enough, and a run does not have to re-fetch 20,000 files
from the Archive. A later run can use the Archive's file if it is cheap to fetch: nothing here says it would hurt.

### What this says about the cause
- **It is not (only) resizing.** The stored image is a third of the Archive's file (R2 ~660 px wide; the Archive ~2,000 px;
  the lane had `max_side: 0`, so it did not resize further). More pixels helped, from 2.6% to 27% of marks, but the same
  input damaged the controls: two keep pages went from 23 and 34 marks to 0, and recall fell from 77% to 31%.
- **Paddle is close to all-or-none per page.** On the Archive's file, 18 of 30 pages have no mark, 8 have at least 90%, and only
  4 fall between (layout off: 11, 17, 2). Which pages get them changes with the input (the stored image ×3 gives
  `zero-e8351be4-p107` 23 marks, the Archive's file 0). Repeating the same input and settings flips 2 of 30 pages from none to
  some. A re-run is therefore not a fix, whatever its settings.
- **Layout off is the strongest Paddle lever** (61%, matching #5600's note), and it still leaves 11 of 30 pages with no mark.
- **Most marks do not vanish; about a third become 一.** The stored zero-丨 pages carry 10.9 more 一 per page than their leaves
  (the leaves average 34 marks; an inference from the counts, plus the judge's quotes). The judge quotes it: `紫水晶一一一口`. Opus removes them (+0.07). So a translator
  has been reading these as the numeral.

### The size of it: larger than the zero-丨 count
Kanripo gives every page a mark count to compare with, which the earlier census could not do
(`results/zh-ditto-restore-5274/partial-census.json`). 62,491 of the 62,892 body pages have an own leaf at dice ≥ 0.6.

| marks kept vs the leaf | pages | in held books |
|---|---:|---:|
| all lost | 20,018 | 2,695 |
| lost over half | 2,843 | 484 |
| lost 10–50% | 6,212 | 1,170 |
| kept ≥ 90% | 33,408 | 6,716 |
| leaf has no marks | 10 | 3 |

**29,073 pages in 783 books have lost at least 10% of their marks.** 40.6% of all marks in these books are gone (1,149,385 of
1,935,150 kept). Only 10 zero-丨 pages are leaves that really have none. The frame count differs from the brief's
(62,892 / 20,265 vs 65,927 / 21,451) because this one counts Han outside `<header>`/`<page-num>`. Live books: 1,216.

### Instruments
- **Kanripo WYG keeps the marks** and is the same witness: KR3k0059, KR3k0056, KR3k0060, commit in each page's `qa_screen`.
  This reference was not used in any prompt.
- **The Opus counter** (image only, no text) against Kanripo on 34 pages: 30 exact, 34 within 2, totals 1,132 and 1,132.
- **By eye** (`by-eye.json`): 5 pages counted with the image open: 26, 22, 60, 18, 12. All equal the counter, and the 4 with a
  leaf equal Kanripo. **Not blind:** the Kanripo counts had already been printed in the log when these were counted.
- **The judge:** 10/10 swap controls called misleading and `not_this_leaf`. P0's verdict repeated on 34/35 pages between the two
  runs, P2-ia's on 25/35, because its pages sit on the misleading/flawed line, so read 2 and 3 as "two or three".
  It was told a thin stroke in a cell is text, so P0's 29/30 is partly that instruction.

### Price per 1,000 pages
| arm | use | subscription share or box | per 1,000 usable, at fee share |
|---|---|---|---|
| P1 (any) | 1 s a page, about 15 GPU minutes | $0.09 of the flat box | useless at any price: not one arm reaches the bar |
| P2-r2 | $117 list equivalent | 6% of a Claude account-week by #7258's scale (1% per $20), 12% as an upper bound from this job's meter (4→6% on $20 of calls, with this session on the same account) | **$2.9–5.7** |
| P2-ia | $127 list equivalent | 6–13% | $3.0–6.0 |
| P3-ia | 1.0 agy call a page | about 1% of a pool week; $0.60 by #7568's plan-fee figure | $0.82, but it fails the bar and misleads on 24/30 |

Fee share assumes Max 20x at $200 a month, $46 a week. Cash billed: $0. Calls here were one page each; `correct.mjs` runs ten a
call in production, and #7568's Chinese price ($120 per 1,000) came out the same.

### P3: agy was better than its record, and still not enough
It failed as a Chinese corrector before (6/30, #7263). With the mark instruction it restores 95% of marks, so the marks were not
what it failed on. The judge's defects are misreads it did not fix (賈欽, 濃水, 官者 for 宦者), dropped lines and scrambled
double-line notes. Its pool had the room (third pool at 97% weekly before, 95% after, shared with its lane). One try, as the
brief asked, on the Archive's file; it did not get a stored-image try.

### The whole run (not done)
- Zero-丨 pages (20,265): 1.2–2.3 account-weeks, $2,370 list equivalent, $54–107 at fee share, about 70 h at 4 calls in flight.
- Every page below 90% of its marks (29,073): 1.7–3.3 account-weeks, $3,400 list equivalent, $78–154, about 100 h.
- 18,987 of the zero-丨 pages have English, and that English goes stale when the text changes. Re-translation is the next step.
- Held books: 2,923 zero-丨 pages in 180 books (`paddle-zh-5600-ocr-only` 126, `gpu-backlog-5660` 52, `paddle-zh-6388-ocr-only` 2).

### Limits
- Exploratory: 30 pages, and all three families are Siku manuscript; 韻府拾遺 drew no zero-丨 page. Keep pages n = 5.
- Single family: Opus judges Opus. The Kanripo measures are the independent check, and they agree on the marks and the CER.
- `zero-1d8ec548-p59` (駢字類編) scores 27% CER on every arm: Kanripo's flattening of its short sub-columns is not the reading order
  there. It is the one page P2-ia misses, at placed-run recall 0.79. CER is overstated on this layout, paired across arms.
- Not preregistered, added after the mark scores: the second judge run and `partial-census.mjs`. The prereg's "P0 against the best
  arm" was run as P0 / P2-ia / P3-ia and then P0 / P2-r2 / P2-ia, so all three candidates got a verdict.
- Nobody has checked a served correction by eye beyond the marks on these pages, or that the production guards (`correct.mjs`
  apply, `correction-diff-guard`) let a page with 40 new marks through. That is the first thing a pilot has to show.

### Outside this test, noted
The archived R2 copy of all of these pages is about a third of the Archive's file (62,883 of 62,892 stored widths are under 1,000
px; `archive_metadata.source: bulk_jp2`). It is enough for this correction, but it is what readers and every later read get.

Files: `scripts/eval/zh-ditto-restore-5274/`, `scripts/eval/results/zh-ditto-restore-5274/` (`frame.json`, `draw.json`,
`score.json`, `pages.jsonl.gz`, `texts.jsonl.gz`, `judge-judge.json`, `judge-judge2.json`, `by-eye.json`, `partial-census.json`).
