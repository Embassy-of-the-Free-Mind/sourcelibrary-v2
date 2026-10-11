# #6388 Should the stale English on Paddle-read Siku books be retranslated?

PRIOR ART: `scripts/eval/paddle-zh-qa-6388/` (qa3, PR #6443): it judged the Paddle TEXT against the image. This
folder judges the ENGLISH that readers still see. That English was translated from the superseded reading, and
the Paddle lane stamped it `translation_stale` (lane `paddle-zh-2026-10`). The runners are adapted from qa3's, and
`scripts/eval/run-cli-arm.py` runs the `agy` arm unchanged.

Committed **before any reviewer ran** (job english-eval-6388, 2026-10-11):

- `census.mjs` → `census-summary.json`, `draw.json`: the census (step 1) and the seeded draw (step 2). No model,
  no writes.
- `controls-pick.mjs`, `controls.json`: 5 planted-error controls (2 names, 2 numbers, 1 negation) in the English of
  5 pages from books outside the draw. Every plant changes the meaning, so each is a material error.
- `prompt-page.txt` (+ `prompt-single-tail.txt` / `prompt-batch-tail.txt`): ONE instruction text for both reviewers.
- `prepare.mjs` → `packet-map.json`: 85 opaque requests `p01`…`p85` (80 sample pages + 5 controls), shuffled with
  seed 6391.

## Frame (census, 2026-10-11)

75,701 pages in 751 books carry `translation_stale.lane = paddle-zh-2026-10`. All of them still carry English, and
all of them have the lane's `page_revisions` snapshot. Excluded from the draw: 22 table/diagram pages
(`tables_flattened`/`img_dropped` > 0) and 28 pages with fewer than 8 Han characters in the Paddle body. That
leaves 75,651 eligible pages.
**Old-vs-new CER** = Levenshtein(superseded, Paddle) / |Paddle|, over `foldHan(bodyText(·))` (Han characters only,
margins removed), capped at 1. Deciles: p10 .012, p20 .021, p30 .031, p40 .042, p50 .056, p60 .078, p70 .112,
p80 .196, p90 .693. Reading order counts in this CER, so a superseded reading whose columns are out of order
scores high even when its characters are right.

## Sample (one page per book)

- **random**: 60 books, drawn uniformly (seed 6388), one random eligible page from each.
- **top_decile**: 20 further books that have a page at CER ≥ 0.693 (seed 6389). From each, the page with the highest CER.

## Reviewers ($0, subscriptions)

Each reviewer sees, for every page: the image, Reading A (superseded), Reading B (Paddle) and the stale English.
- **O**: Opus via `claude -p --model opus`, 5 pages per call, 17 calls (`review-opus.mjs`).
- **G**: Gemini 3.1 Pro (High) via `agy -p`, one page per call, 85 calls (`run-cli-arm.py`, model
  `gemini-3.1-pro-high`). No Gemini API.
- **Disagreement** (defined under the decision rule below): on each such sample page, one Opus single-page call (high
  effort, arm ADJ) re-reads it with both error lists shown as "Reviewer A/B" in seeded order. Its verdict is final.
  If the 30-call Opus cap binds, random-arm pages are adjudicated first, and any left unresolved are reported
  as a bound.

## Controls (gate)

A plant is **caught** when a reviewer lists an error whose `english` quote overlaps the planted words, at any
severity and with any cause. Both O and G must catch at least 4 of the 5. Otherwise the run stops and is reported
without a recommendation.

## Pre-registered decision rule

A page counts as **OCR-material** when its final error list has at least one `material` error with cause `OCR` or
`BOTH`. O and G **disagree** on a page when their page verdicts differ, or when their OCR-material flags differ.
Where they agree, that shared value is final. Where they disagree, ADJ's reading is final.

**Headline**: the share of the 60 **random** books whose drawn page is OCR-material, with a Wilson 95% interval.
Each book counts once. It estimates the chance that a random stale page of a random book shows a reader a
material English error caused by the old OCR.
- **≥ 15%**: recommend retranslating every stale page (75,651 eligible, or 75,701 with the excluded pages).
- **≤ 5%**: recommend keeping the stale English and retranslating nothing in bulk.
- **Between**: report the OCR-material rate in each CER bin (0–.05, .05–.1, .1–.2, .2–.5, .5–1). All 80 pages count
  here, the top-decile books included. Recommend retranslating only the pages at or above the lower edge of the
  lowest bin from which every higher bin's rate is ≥ 15%, and give that page count from the census. If no bin
  meets this, recommend no bulk retranslation.

Also reported, separately: the **TRANSLATION-material** rate, meaning pages with a material error of cause
`TRANSLATION`. Retranslating does not fix those unless the translator changes. Also reported: the
**retranslate-would-fix** verdict rate.

**Cost of each option**: Gemini CLI calls at one page per call, from the census page counts. The time each
would take comes from the measured `agy` rate on this box (`/root/agy-quota/summary.txt`).

## As run (2026-10-11, job english-eval-6388)

- O: 17/17 calls parsed. G: 85/85 pages answered in 98 `agy` calls. 12 pages first ended with a denied tool
  request; they were re-run with the runner's nudge.
- Controls: O 5/5, G 5/5; the gate passed.
- Disagreements: 38 of 80 pages (29 random). The 30-call Opus cap allowed 13 ADJ calls, all on random pages in
  qid order, which is the seeded packet order. That leaves 16 random pages unresolved, reported as bounds.
- Added after the run, as a $0 check of the reviewers' cause tags: `attribution-check.mjs`. It asks whether the
  Chinese a reviewer quotes for an OCR-caused error is in the Paddle reading but not in the old one.
- Write-up: `scripts/eval/experiments/2026-10-11-paddle-stale-english-retranslate-6388.md`.
