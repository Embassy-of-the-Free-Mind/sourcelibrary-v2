---
stage: ocr
measure: [judged]
languages: [grc, la, ko, hy, he, syr, ka]
scripts: [Grek, Latn, Hang, Armn, Hebr, Syrc, Geor]
canons: []
n_books: 30
n_pages: 30
verdict: "agy gemini-3.8-flash removes the loop: 29 of 30 re-reads pass loopVerdict, and the blind Opus judge rates the new read better than the stored looping read on 19, the same on 9 and worse on 1 (mean fidelity 1.63 -> 2.31 of 5). But the new reads are not publishable. Opus accepts 1 of 30, and the new reads carry more wrong-text spans than the old ones (176 vs 131 over 29 pages). On Greek manuscripts the judge calls them fluent invention (35 -> 58 spans). One Hebrew page was read as blank, and loopVerdict lets a blank read through."
status: rejected
decision: "No-go for every stratum, including the cheaper lane proposed mid-run (agy read, loopVerdict on every page, Opus on about 1 in 20). Writing these reads would swap a loop that a free detector catches for plausible invented text that only an image check finds, and would then re-translate English that the dry run found mostly usable apart from the tail. The one page that passed both checks was written (Latin MS p.704), with translation_stale set. Trim the looping tails instead (the #4850 proposal). Re-reading waits for a stronger reader behind a per-book gate."
superseded_by: null
issue: [4850, 7945]
router_evidence: "none — a 30-page gate on pages chosen because the stored read looped, not a random draw of any router cell"
defect_rates: "none — n = 30 across 7 strata (2 to 8 pages each); per-page fidelity and wrong_text counts are in scripts/eval/results/agy-reread-4850/results.json"
---
## 2026-11-02 · Can agy 3.8 Flash re-read the 506 looping pages? (#4850, gated test)

Part of #4850. The token-run arm of the loop guard (#7945) refuses a transcription in which one short word repeats 25 or more times. 506 pages in 169 live books already carry such a read, with English made from it. Before the fan-out, this test checks whether the subscription agy reader (`gemini-3.8-flash`) is good enough to re-read them.

PRIOR ART:
- `scripts/eval/agy-ocr-per-call-6740/` (`read.mjs`, `results.json`): the agy read eval this test follows. That eval measured per-call batching on random pages. This one uses one page a call, on pages whose stored read looped.
- `scripts/eval/confidence-7866/judge.mjs`: the judge, imported unchanged (`correction-pass-7818/lib.mjs judgeAbsolute`, the route-judge-6740 prompt, Opus via `claude -p` with the page image).
- `scripts/batch/cli-ocr.mjs`: the production agy OCR reader and writer. Both the read and the one write went through it.

### Method

- **Frame.** All 506 (book, page) pairs in `pages_by_reason.source_loop` of the token-run dry run (`/root/qa-6056/tokenrun-withhold-dry.json`, 2026-11-02), built by `frame.mjs`. The stratum is the book's `language` plus the stored read's own `<script>` tag. A Latin, Greek or Hebrew page with no tag counts as print. The counts match the brief: Greek MS 154, Latin MS 95, Latin print 92, Korean MS 23, Armenian MS 22, Hebrew print 22, other 98 (Chinese, 14 pages, is skipped because it routes to PaddleOCR).
- **Draw** (`draw.mjs`, seed 4850). 30 pages, at most one per book: Greek MS 8, Latin MS 6, Latin print 6, Korean MS 2, Armenian MS 2, Hebrew print 2, other 4. The 4 "other" pages are Syriac, Georgian and two Greek print.
- **Read.** `cli-ocr.mjs read --model=gemini-3.8-flash --fresh --concurrency=3`: the live OCR prompt, one page a call, the archived page image, root's agy login on agy 1.4.12. The fallback login's weekly pool read 3.7% and was not used. The run made 35 calls (5 pages were read twice by cli-ocr's own retry) and used 1.92 M tokens, 64 K a page on average. It took 16 minutes.
- **Guard.** A read fails if cli-ocr's reply checks refuse it (exit, wrapper, header) or `loopVerdict` refuses it.
- **Judge.** For every page, the stored read and the new read were each judged blind: one text per call with the page image, in a seeded random order, so the judge never saw the pair. That made 60 Opus calls. Better, same or worse compares the new read's fidelity with the old read's. A page could be written only if it passed the guard, was rated better, and its new read had no `wrong_text` defect.

### Results

| stratum | n | guard pass | better / same / worse | fidelity old → new | new accepted | wrong_text spans old → new | written |
|---|---:|---:|---|---|---:|---|---:|
| Greek MS | 8 | 7 | 5 / 2 / 0 (1 failed) | 1.25 → 1.86 | 0 | 35 → 58 | 0 |
| Latin MS | 6 | 6 | 4 / 2 / 0 | 1.83 → 2.83 | 1 | 28 → 33 | 1 |
| Latin print | 6 | 6 | 5 / 1 / 0 | 2.00 → 2.83 | 0 | 23 → 33 | 0 |
| Korean MS | 2 | 2 | 1 / 1 / 0 | 1.50 → 2.00 | 0 | 9 → 18 | 0 |
| Armenian MS | 2 | 2 | 2 / 0 / 0 | 1.00 → 3.00 | 0 | 9 → 6 | 0 |
| Hebrew print | 2 | 2 | 0 / 1 / 1 | 2.50 → 1.00 | 0 | 6 → 7 | 0 |
| other | 4 | 4 | 2 / 2 / 0 | 1.50 → 2.00 | 0 | 21 → 21 | 0 |
| **all** | **30** | **29** | **19 / 9 / 1 (1 failed)** | **1.63 → 2.31** | **1** | **131 → 176** | **1** |

The failed Greek MS page (p.843) came back with no `<<<BEGIN>>>` marker on both tries. The wrong_text columns cover the 29 pages that have both verdicts.

What the judge says, in its own reader notes:
- **Greek MS.** The new reads are "fluent invention" or "fluent Greek the image doesn't support", with no uncertainty marked, on 5 of 7. The old reads were invented Greek that ended in a loop. The loop made the failure obvious; the new reads hide the same failure.
- **Latin print.** Every new read covers the whole page, where the old reads lost a column or its last quarter to the loop. But all six carry sense-changing misreads: numerals (ix→iij, xxx→lxx), negations, names of jurists, and a merged dose.
- **Hebrew print, p.46.** The stored read was the best old read in the sample (fidelity 4, the body matched). The new read says the page is blank, so its fidelity is 1. `loopVerdict` passes a blank read, so the cheap gate cannot catch this failure.
- **Korean MS.** The new reads misread names and units, or impose the wrong language on cursive Sino-Korean notes.
- **The page that was written** (Latin MS, book 69c89d196c6f3cc53c85d762, p.704) is the Mandaic/Latin page from the dry-run comment. The old read had turned the edge of the facing page into 26 lines of repeated `<unclear>ܘ</unclear>`. The new read has all 28 Latin lines and leaves the edge out, and Opus gave it fidelity 5 with no defects. It was written by `cli-ocr.mjs apply --lane=agy-reread-4850 --mark-stale=agy-reread-4850` as run `cli-ocr-20261102181126-1376126`, with the judge verdict in `ocr.engine.run.reason`. To undo it: `scripts/maintenance/revert-run.mjs --run-id cli-ocr-20261102181126-1376126`. The page now carries `translation_stale` (lane agy-reread-4850), which the translate worker picks up. This job did not translate it.

**Gemini pool use** (agy `/quota`, root's login). Weekly fell 43.50% → 42.70% and the 5-hour bucket 82.78% → 80.10% over the read window. That is at most 0.027 weekly points and 0.089 five-hour points a page. "At most" because the pool is shared: in the next 20 minutes, with no agy call from this box, weekly fell another 0.74 points. Projected to the other 476 pages, a fan-out would cost about 13 points of the weekly pool and about 43 points of 5-hour windows (two or more windows), and take about 4 hours at concurrency 3.

### Go / no-go for the other 476

Mid-run, the dispatching session proposed this lane: an agy 3.8 Flash read, `loopVerdict` on every page, and an Opus check on about 1 page in 20. On these numbers it is **not safe for any stratum**:

- **Greek MS (146 left): no.** Opus accepted 0 of 7 new reads. Wrong-text spans rose from 35 to 58, and the judge calls the new text fluent invention. Writing it would remove the one sign a free detector can see (the loop), leave invented Greek in its place, and re-translate from that.
- **Korean MS (21), Hebrew print (20), other (80, Chinese excluded): no.** Opus accepted 0 of 8 across these strata. One Hebrew page went from fidelity 4 to a "blank page" read that the gate passes. Korean wrong-text spans doubled (9 → 18).
- **Latin print (86), Latin MS (89), Armenian MS (20): no as a write lane.** These are the closest cases: 11 of 14 better, fidelity up about one point, every Latin print page now complete. But Opus accepted 1 of 14. A 1-in-20 audit can show that a mostly good lane stays good. It cannot make a mostly failing lane safe: with an accept rate around 1 in 30 (95% CI 0.6–17%), the sample would only confirm that the lane is writing text Opus does not accept, and the re-translation would already have replaced the English.

What to do instead:
1. Trim the looping tail in place, in both the transcription and the English (the #4850 proposal). That removes the loop and adds no new text.
2. Keep the withhold arm at the ≥50% share.
3. Re-read these pages later with a stronger reader behind a per-book gate (for Greek manuscripts, the Argon re-read lane gate of #6769), not with Flash.

### Files

`scripts/eval/results/agy-reread-4850/`: `frame.mjs`, `draw.mjs` and `draw.json` (the 30 pages), `old-texts.mjs`, `judge.mjs`, `score.mjs`, and `results.json`. `results.json` holds the per-stratum table, the per-page guard, verdicts and token use, all 60 verdicts, the quota readings and the write. The new reads are kept in R2 `candidate-reads/` by cli-ocr (#7075).
