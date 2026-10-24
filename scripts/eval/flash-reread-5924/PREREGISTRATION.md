# Preregistration: does a Flash re-read halve the misleading pages of lite-read Latin books? (#5924)

PRIOR ART: `scripts/eval/experiments/2026-10-22-latin-served-pages-by-eye-and-facing-bleed-5924.md` (the spot check
this tests: misleading 3/12 lite-OCR pages vs 2/24 flash; Flash drops the facing strip 11/11) and
`2026-10-22-latin-ocr-repair-census-5924.md` (PR #7173: 25 SPREAD pages decide the book; re-read defects are
invisible from text). Committed before the draw is run and before any read or judgment.

Job `flash-reread-test-5924`, 2026-10-23. Derek approved the recommendation 2026-10-23. Grade: **exploratory**
(10 books; eval-design §10.2), so the result can at most recommend the next, priced step. No production OCR is written.

## Sample
- `draw.mjs`, Mulberry32(51023). Frame: visible Latin books, 1500–1800, ≥ 100 OCR pages, ≥ 70% of OCR'd pages read
  by flash-lite, ≥ 50 eligible body pages (page_type text/null, flash-lite read, ≥ 400 OCR letters, an image),
  stopword classifier says Latin. Every book or page id that appears in a prior #5924 eval file is excluded.
- 14 candidates in seeded order. A **format screen** (one Opus reader, 2 of each book's drawn pages, image only)
  drops a candidate that is a manuscript or not Latin print. The first **10** that pass are the sample; the screen's
  verdicts are committed with the results.
- Pages: `spread` over the eligible body pages, `v[floor((i + 0.5) · n / 25)]`, 25 per book = **250 pages**.
- "Lite OCR" is the text stored today (it includes the long-s pass of PR #7223 where that ran). That is what readers
  are served, so that is the baseline.

## Arms
- **L** — the stored lite OCR.
- **F** — Gemini 3.8 Flash (`gemini-3.8-flash-low`) through `agy`, via `scripts/batch/cli-ocr.mjs read` unchanged:
  live OCR prompt, plan mode, one page per call, tool gate, the #6331 nudge on a denied tool, one fresh re-read on a
  chatter/marker problem. Never auto-approve. Only the read stage runs; `apply` is never called.
- No post-processing of F (no long-s pass). A page F fails to read (empty, timeout, refusal after the retries)
  counts as **F worse** on that page.

## Judgments (Opus subagents, image open, zoom allowed through a crop helper)
- **Step A** (unblind, L only): per page, the defects (`page-error-taxonomy.md` classes) and a verdict
  **misleading** (a reader is misled about what the page says: a meaning change, an omitted passage, another leaf's
  text served as this one's) / **flawed** (gist right) / **sound**. One reader per book.
- **Step C** (blind pairwise, fresh readers, not the Step A readers): per page, the image and two transcriptions
  labelled X and Y, order from Mulberry32(1023) per page. Per read: the same three-way verdict. Then a preference:
  X better / Y better / tie, and whether the loser's defect is **material** (it changes or drops meaning the other
  read gets right) or minor (spelling, punctuation, tags, layout).

## Measures and bar
- **Primary rates come from Step C**, where one blind reader judges both reads of the page under the same
  conditions: misleading(L) and misleading(F), pooled over pages, with the per-book rates beside them.
- Step A's misleading(L) is reported next to Step C's as a reader-agreement check. It does not enter the bar.
- **The bar passes when both hold:**
  1. misleading(F) ≤ ½ · misleading(L), pooled over the 250 pages (Step C). If misleading(L) is 0, the bar
     cannot pass: there is nothing to halve.
  2. **No page worse by eye:** no page where F is misleading and L is not, no page where Step C prefers L with a
     **material** defect in F, and no unread F page. Every such page is listed. A page whose L preference rests
     only on minor differences is counted and reported but does not fail the bar.
- Reported but not part of the bar: the pairwise win/tie/loss count, per-book rates with Wilson intervals, the
  defect classes each arm fixes or introduces, and facing-strip handling.

## The whole-book rule (priced if the bar passes)
- A book **fails the 25-page check** when ≥ 2 of its 25 pages are misleading on L (Step C verdicts; Step A as a
  check). The test's 10 books give the failing share. The frame count gives books and pages, and the price is the
  frame's failing books × their lite pages, as agy calls per day at ~5,500/24 h (the measured quota). The price
  also states the gap-fill retranslation an OCR write would trigger. Nothing is written in this job.

## Containment
A reader who finds another leaf's text or invented text on L (not a misread) flags it. The job then follows
`containment-on-finding.md` for those pages, and says so on the issue.
