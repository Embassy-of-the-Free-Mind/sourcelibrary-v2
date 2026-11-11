# Measuring lane-B repairs before and after — the plan (#6420, error zoo v2)

PRIOR ART: `.claude/skills/paired-arm-judge/SKILL.md` (two arms on the same pages, blind judge against the image,
`route-judge-6740/judge.mjs` file format) — the instrument this plan reuses rather than a new judge.
`scripts/eval/experiments/2026-10-13-ocr-opus-correct-vs-lane-b-q300-6694.md` — the one time lane B's output was
judged against another arm; its "made worse" audit is the shape of step 4 here. `scripts/audit/convergent-audit-weekly.mjs`
— the weekly draw already holds a `lane-b-written` stratum (20 pages a week); this plan turns that stratum into a
paired measurement instead of a one-sided rate.

**Status: a plan. Nothing here has run. No repairs are started by this document.**

## What the question is

Lane B (`scripts/batch/cli-ocr.mjs`: Gemini Flash CLI second read of the stored OCR, Opus adjudication on
disagreement, the winner written with a `page_revisions` snapshot and a `sweep_log` row `ocr-reread-through-cli`,
reason `#6420 lane B`) has written 347 pages that the weekly audit can draw from. Three weeks of the audit put the
serious rate on lane-B-written pages at **47% (n = 419 page reads)** against **31% on the uniform random draw**.
That number is read two ways and both are wrong on their own:

- *"Lane B makes pages worse."* Not shown: lane B picks the most-read books and the pages where two engines
  disagreed, which are harder than a uniform draw. The 47% is a rate on a selected population.
- *"Lane B's own check says the pages are fine."* Lane B's check rows (`book_checks`, method `ocr-convergence`,
  reader Gemini Flash) agree with the independent Opus audit on only **46% of the 250 pages both read**, which is
  below chance for two readers at these base rates. A lane cannot be measured by the instrument that chose its writes.

The only fair question is paired: **on the same page, is the text after the repair better than the text before it,
by a reader who did not take part in the repair, and by how much?**

## Design

1. **The pages.** Every page lane B will write in the next run is known before the write (the queue). Freeze the
   list, and for each page record: `page_id`, the pre-write OCR `text_sha`, the pre-write translation hash, the
   predictor's risk score (features.py over the pre-write text) and the book's queue rank. Nothing is drawn yet.
2. **Before.** Lane B already snapshots the prior text to `page_revisions` under its run id (`cli-ocr.mjs`, #7058),
   so the "before" text survives the write by construction. No extra write is needed. Assert this on the first ten
   pages: `page_revisions` row with `field: 'ocr'`, `run_id` = the lane-B run, `data` = the frozen `text_sha`.
3. **After.** When the run has written, draw **one written page per book, up to 120 books**, uniformly over the
   books written (the weekly audit's rule: rates are by book). Build a paired-arm packet per page with two blind
   arms, `A` = before text, `B` = after text, with the page image and the two neighbouring leaves, in the
   `judge.mjs` file format (`key.json` + packet). Shuffle arm order per page. Add the recipe's controls: 10% wrong-page
   items and 10 repeated items to measure the judge's noise floor.
4. **The judge.** Opus on the subscription, sealed `claude -p`, the #6338 brief; a judge that did not adjudicate the
   write (lane B's adjudicator is also Opus, so the judge must be a fresh session with no lane-B context, and the
   recipe's blind arm names). Each page gets: a preference (A, B, tie), `fidelity` 1–5 per arm, and defects per
   arm with class and quote. Optionally a second reader (Gemini 3.8 Flash high, as #6694 did) for a second opinion;
   the headline uses Opus, the Gemini line is reported beside it.
5. **The predictor's part.** Score every page before and after with features.py. Report (a) whether the risk score
   fell on the pages the judge preferred after, and did not fall on the pages it preferred before: that is the first
   test that the score sees a repair and not just a hard page; and (b) the serious rate by pre-write risk decile, so
   the next run can be aimed at the deciles where repairs help most.

## What is reported, in this order

| line | form |
|---|---|
| made worse | k of n pages where the judge preferred the BEFORE text, with its material defects, Wilson 95% CI, book-clustered |
| made better | k of n pages where the judge preferred the AFTER text, same interval |
| serious before → after | k₁/n → k₂/n pages with any serious finding, by kind (review-vocabulary KINDS), paired |
| by risk decile | serious before and after in each pre-write risk decile; the deciles where the repair moved the rate |
| noise floor | the repeated items' disagreement and the wrong-page catch rate; if the judge missed more than 1 of the wrong-page controls, the run is not reported |
| cost | Opus subscription calls and Gemini CLI calls, no API spend |

The stop rule from #6694 holds: if the "made worse" line is above **5% with the lower CI bound above 2%**, lane B
stops writing and the finding goes to #6420 before anything else runs.

## What is NOT in this plan, and why

- **No new reader is run on the 347 pages already written** until the before text is confirmed present in
  `page_revisions` for them; the 2026-10 gate runs wrote under several run ids and a few pages may have been written
  twice. An audit of the revision chain comes first (read-only, one script).
- **No withholding or repair from the predictor's score alone.** The score's precision on the uniform frame is
  74% at the top 10%: good enough to aim a reader, not to act without one.
- **No Flash-Lite screener, no second GPU read.** Both would improve the "signals that see the error" block, both
  spend outside the job's quota; they are DECISION lines on #6420, not steps here.

## Decisions waiting on Derek (defaults in brackets)

1. Run the paired before/after on the next lane-B batch [default: yes, 120 books, Opus judge only, subscription].
2. Aim the next weekly audit half at the predictor's top decile [default: yes, 40 random + 40 risk-ranked, the random
   half keeps the series honest; the stratum is recorded in `draw.json`].
3. Record the audit's labels into `book_checks` with `recordBookCheck()` so the next retrain finds them without a
   disk walk [default: yes, one method row per run, `reader_warning: false` so no reader-facing warning derives
   from a single-reader finding].
