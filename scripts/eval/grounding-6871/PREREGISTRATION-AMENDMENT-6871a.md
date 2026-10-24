# Preregistration amendment · #6871 row A, job grounding-6871a (committed before any item below is scored)

PRIOR ART: `PREREGISTRATION.md` (this folder, 2026-10-18, commit 6812ff73b) and its interim result
(`scripts/eval/experiments/2026-10-18-image-gain-guessed-text-detector-6871.md`, PR #6913: unit AUROC 0.60 on 707 of
2,178 pages, bar 0.75). Everything in that preregistration stays as written: scorer, prompt, units, labels, the AUROC
bar and the decision rule. This amendment adds what the 2026-10-22 brief (Derek, "yes to 3") asks for and the first run
did not have. It does not re-open any choice made there.

**State when written (2026-10-22 22:xx Z).** I have not seen any score from the 2026-10-18 queue task
`50-grounding-6871` (the remaining 1,504 items, the plants, the noise floor): this job runs on l7a, which has no shell
on gex45, and no comment on #6871 reports it. Its output may already exist on gex45. The bar below is fixed without it.

## What is added

1. **A phrase-plant set (the brief's set a).** `plant-phrase.mjs`, seed 68711, $0 (no model proposes anything):
   50 pages, 93 planted spans. Latin 22 and Greek 13 pages that a sealed Opus judged clean in lane B (n_errors = 0, not
   serious, not a plant.mjs page; Greek's clean pool gave 13, so Latin took 22); SKQS 15 pages, planted into the
   Kanripo WYG transcription of the leaf (the closest thing to a clean read we hold). Each page gets 1–3 plants: a run
   of 2–5 words (Han: 4–8 characters) in the page's running text replaced by a run of the same size from another page
   of the same book (|Δpage| 2–12), same script, never inside a tagged block or a heading. Offsets are in the item's
   `spans`; no prompt mentions them (the scoring prompt is the fixed transcription prompt).
2. **A Chinese SKQS cell (the brief's second script).** #6420 has no Opus-adjudicated SKQS leaf. `skqs-real.py` takes
   the 36 #5568 Wenyuange leaves Kanripo aligned and scores two real reads of each: P = PaddleOCR-VL-1.6 (the
   production read) and L = gemini-3.1-flash-lite. A read's errors are its differences from Kanripo after the #5568
   variant fold: `zh_sub` (the read has a different character) and `zh_ins` (the read has characters the leaf body does
   not). Text before Kanripo's first and after its last matched character is masked (page-edge shifts, the 版心 strip),
   as is any 四庫全書 line. 71 items (one L read, a loop, dropped), 350 spans (P 119, L 231).
3. **The brief's bar: span recall at a precision useful for review.** For each cell, sweep the flag threshold over the
   gain score (flag low gain); precision = flagged units that are positive; span recall = located bad spans with at
   least one flagged unit. **R@P50** = the highest span recall at precision ≥ 0.5. 95% CI from 500 page-cluster
   bootstrap resamples (seed 6871). Same for text-only perplexity and image surprisal, as comparisons.
4. **Repeat noise for the new items.** Every new item is scored twice, the second time with a fresh vLLM server
   (`rerun`). A cell **beats repeat noise** when the median gain of its negative units minus that of its positive units
   is more than twice the median per-unit |gain − gain_rerun|, and the rerun's unit AUROC lies inside the main pass's
   95% CI. For the #6420 set the 300-page rerun of the 2026-10-18 preregistration is used.

## Bar (per cell; cells = #6420 real pooled and per group with ≥ 30 positive pages; SKQS real, pooled and per reader)

A cell passes, and gain may pre-screen that cell's pages before review, only if **all three** hold:
- **B1** (unchanged from 2026-10-18): unit AUROC(gain) ≥ 0.75, its CI excludes 0.5, and the paired CI of
  AUROC(gain) − AUROC(text-only perplexity) is above 0;
- **B2** (the brief): R@P50 ≥ 0.6 on real errors;
- **B3**: it beats repeat noise as defined above.

The plant cells are **descriptive**: they say whether the detector sees text from another page at all. If plants pass
and real errors fail, the reading is the one the 2026-10-18 decision rule already gives: it sees swapped-in text, not
the errors a reader meets.

## Decision rule

- No cell passes → **no image-gain pre-screen** in front of agy/Opus review on #6420 (it neither replaces nor
  pre-filters a round). Review stays as it is.
- A cell passes → gain pre-screens that cell only, at the threshold that gave R@P50, reported with its precision and
  the share of units flagged.
- Throughput: pages per hour for the image + no-image pair, from `hold.log` (scored rows / seconds), reported beside
  the capability card's 1,340 pp/h.

## Run

gex45 gpu-queue task `55-grounding-6871a` (`queue-task-6871a.sh`): fetch the 121 new images; finish the
2026-10-18 remainder if `50-grounding-6871` left no `results.json`; score the new items, then score them again with a
fresh server; stop the model; `score-6871a.py` on the new items and on the full #6420 set; `report-6871a.py` posts the
table and the verdict against this bar to #6871 and #6420. Files only, nothing written to any store, $0.
