---
stage: ocr
measure: [judged]
languages: [fr]
scripts: [Latn]
canons: []
n_books: 29
n_pages: 29
verdict: "V4 PASS on french-lite/print. On 29 fresh French books (one page each, none in the cell's evidence), the decided route agy-flash-low@4-read was accepted on 24/29 pages and the route production runs there, lite>agy-flash-low, on 22/29, both judged blind on the same pages. Paired d = +0.069 (95% bootstrap CI 0 to +0.172): 2 pages gained, 0 lost. Wrong text: 3/29 in each arm, all three on the stored Flash-Lite text that both arms fell back to. The lower bound of d clears the -0.08 margin. Both wrong-page controls were rejected. Separately, the binding audit finds 3 decided cells with no lane (1.25M pages waiting) and 1 (french-lite/print, 143,663 pages) where a lane runs a route other than the decided one."
status: undecided
decision: "Not applied: the routing tables are on the hold list. This record is the V4 evidence that a routing-row PR for french-lite/print (agy-flash-low@4-read, cli-ocr-lane.mjs correct --reread-per-call=4) would cite. The binding report now posts to #7263 from the nightly lane-judge rebuild when it changes."
superseded_by: null
issue: [7263, 7853, 7809]
router_evidence: "none — a confirmation run of a decided cell; its pages are not added to rules.json (V4 tests the decision, it does not feed it)"
defect_rates: "none — acceptance and wrong-text pages only"
---
## 2026-11-01 · Does the french-lite/print switch reproduce on fresh books, and which decided cells have shipped? (#7263)

PRIOR ART:
- `scripts/eval/queue-routes-7853/` (#7853) built the frame (the #7558 Flash-Lite queue), the 4-page block and both arms (the lane's correction read and the read@4, each with a dry apply). It is the evidence behind the switch, and it fixes its draw at module level. Its mechanics are restated in `scripts/eval/router-confirm/confirm.mjs` and pointed at a new draw.
- `scripts/eval/correction-pass-7818/lib.mjs` `judgeAbsolute` (the route judge `route-judge-6740/judge.mjs` judgePrompt / opusCall / parseVerdict), imported unchanged.
- `scripts/audit/router-binding.mjs` + `scripts/lib/router-binding.mjs` map cron lines to cells and routes. The new `scripts/audit/router-table-drift.mjs` runs them over every repo crontab. `scripts/audit/routing-drift.mjs` audits DECISIONS.md and cannot see `current.json` (#7263 audit, 2026-11-01).

### Part 1: binding audit (`node scripts/audit/router-table-drift.mjs`)

`current.json` (2026-10-31-correction-pass-7818, with german-lite/print and french-lite/print from 2026-11-01-reread-7853) has 16 decided cells.

| status | cells | pages waiting |
|---|---|---|
| no lane at all (latin-lite/print, tibetan-yigdzin/manuscript, german-flash3/print) | 3 | 1,247,284 |
| lane runs another route, no waiver (french-lite/print: gex45 `correct` runs lite>agy-flash-low; decided agy-flash-low@4-read) | 1 | 143,663 |
| another route under a waiver (german-lite/print, until 11-14) | 1 | 409,596 |
| served on the decided route (german-lite/unknown) | 1 | 0 |
| nothing waiting (GPU and blank-page experiment frames, russian-lite/unknown, zh-6561-served/manuscript) | 10 | 0 |

No row in either routing table names a router cell. Both tables last changed on 2026-10-26, 5 days before the pointer was set. The crontabs read are the repo copies (`infrastructure/*-crontab`, `scripts/workers/crontab.production`), not a live `crontab -l`. The #7853 waiver says the gex45 correction lines move to `--reread-per-call=4`, but the repo's `gex45-crontab` has not moved yet.

Wired: `lane-judge-sampler.mjs rebuild` (nightly, l7a) appends this report to its #7263 comment when the set of non-served cells changes. It posts the report alone when no decision flipped. No new cron.

### Part 2: V4 confirmation run (`scripts/eval/router-confirm/`)

**Cell.** current.json has 11 switch cells. Nine have 0 pages waiting, because they are experiment frames or drained queues, so a confirmation there routes nothing. The two with pages waiting are french-lite/print (143,663) and tibetan-yigdzin/manuscript (272,550). The Tibetan cell needs Yigdzin, which is not on this ARM box. **TAKEN:** french-lite/print, the smallest-volume switch cell with pages waiting.

**Routes.** The winner is agy-flash-low@4-read (table 55/60, decided 2026-11-01). The current route is lite>agy-flash-low: the gex45 `correct` lane serves it, and the table named it before the switch (`HOLD → lite>agy-flash-low`). The row's `current` field says lite>opus. That is the bar, untested in the cell (k/n null) and not a candidate (rules.json `_bar`), so it is not the comparator.

**Bar, set before the data (rules.json `switch`).** PASS when paired d = acc(winner) − acc(current) ≥ −0.08 and wrong-text rate(winner) ≤ rate(current) + 0.04. VOID when a wrong-page control is accepted or more than 10% of pairs lack two verdicts.

**Frame and draw.** The #7558 queue for French: 845 visible French books with an idle pipeline and no hold. Excluded: 113 books that appear anywhere in the cell's evidence (every score file the french-lite routes cite, and those studies' results folders), plus every book in `lane_judge_verdicts`. Books were walked in a seeded order (seed 20261101), book-uniform, so this sample is not page-weighted like #7853. Each book gave one interior page still holding Flash-Lite text (≥ 300 characters, not human-edited, script tag printed) and its 4-page block. 75 books were tried to fill 30. One drawn page's image is a 457-byte black placeholder (BSB IIIF, book 69b51eb1cf111105c42a2f45 p.63). Both arms said "blank", and the page was dropped from both arms: n = 29. `plan` now checks the image at draw time.

**Run.** agy gemini-3.8-flash-low on the second Ultra pool (`AGY_HOME=/root/.agy-james`; this box's default agy login is not signed in), 60 reads. The Opus judge ran through `claude -p` on l7a's subscription (derek@sourcelibrary.org, weekly 36%): 53 calls, all parsed, cap 80. 7 pages had the same served text in both arms and were judged once. Every reader ran under `readonly-mongo.mjs`, which makes each Mongo write throw: `cli-ocr.mjs read`'s lane_job_books record was refused and logged, and nothing was written. No paid API.

| | winner agy-flash-low@4-read | current lite>agy-flash-low |
|---|---|---|
| table k/n (evidence) | 55/60 (0.92) | 108/132 (0.82) |
| fresh accepted | **24/29** (0.83, 90% Wilson 0.69–0.91) | **22/29** (0.76, 0.61–0.86) |
| wrong-text pages | 3 | 3 |
| apply wrote a new text | 20 | 14 |
| refused → stored text served | 9 (6 replies cut before `<<<END>>>`, 2 letters outside the book's scripts, 1 restarted read) | 15 (7 UNCHANGED, 5 change-share guard, 2 scripts, 1 CONTAIN) |

- **Paired d = +0.069**, 95% bootstrap CI **[0.000, +0.172]**. 2 gained, 0 lost; sign test p = 0.50.
- Wrong-page controls: 0/2 accepted.
- **Verdict: PASS.** The lower bound clears the −0.08 margin, so this is a pass with margin, not only on the point estimate.
- **The table's prediction runs high.** The winner's 0.92 sits at the top edge of the fresh 90% interval. The fresh draw is book-uniform rather than PPS, and it is ~10 points lower for both routes. The ordering holds, but neither absolute rate reproduces exactly. (V1 territory.)
- **The read@4 truncates.** 6 of 30 block replies were cut before `<<<END>>>`, and the lane then serves the stored text. In two of those (below) the fresh read had the right page and the stored text is wrong, so the truncation guard kept wrong-leaf text live.

**Wrong-text pages: all three are the LIVE stored text** (both arms fell back to it):

| book | page | finding | checked |
|---|---|---|---|
| 69af5956569075d6ffc07222 (Duhem, *Le Système du Monde*) | 263 (printed 253) | serves printed p.252's text (I1, wrong leaf) | **by eye, image open: confirmed** |
| 69af5946522dc3dfdf725a23 (Duhem, *Le Système du Monde*) | 302 (printed 290) | serves printed p.289's text (I1, wrong leaf) | **by eye, image open: confirmed** |
| 69ac8e61e54b190acc1d3bab (*Histoire critique des dogmes et des cultes*) | 759 | Hebrew כתנת printed, בד served (O10) | judge only |

Containment (containment-on-finding.md) was **not** done: this job was briefed "no DB writes". Both Duhem pages are off by one leaf, which points to a book-level shift (#7866's leaf-alignment screen).

### Files

- `scripts/eval/router-confirm/confirm.mjs`: `plan` (frame + draw + budget, no model call), `arms`, `judge`, `analyze`. `readonly-mongo.mjs` is the write guard.
- `scripts/eval/router-confirm/results/french-lite-print-2026-11-01.json`: the per-page verdicts (ids, no text).
- `scripts/audit/router-table-drift.mjs`, tests `tests/unit/router-binding-drift-7263.test.ts`.
- The texts, images and raw verdicts are in `$JOB_SCRATCH/router-confirm/french-lite-print` on l7a, archived to R2 by the scratch reaper.
