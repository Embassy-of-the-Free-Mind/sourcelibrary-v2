---
stage: ocr
measure: [judged]
languages: [la]
scripts: [Latn]
canons: []
n_books: 20
n_pages: 60
verdict: "FAIL on the rule fixed before judging. Route C in production (PERO draft -> agy Flash-low with the image) on the first 15 unread pages of the 20 most-read held Latin books: 53/60 accepted (0.88, Wilson 0.78-0.94; 3 pages a book), under the 0.92 bar (the TEST's lower bound for arm C on Latin print); wrong text 5/60 (0.04-0.18) against the TEST's 3/108. Body-text pages 31/34, front matter 22/26 with 4 wrong text (exploratory). The 27% check flag did not separate good from bad pages (flagged 20/23 accepted, unflagged 33/37) and fired on 43% of written pages, not the TEST's 10%."
status: undecided
decision: "No cron line and no routing-table row (brief: outside the interval, stop and report). The lane code (cli-ocr-lane.mjs gpu-correct) and the sampler's book-depth mode are in the PR, unscheduled. The 196 written pages stay (their books stay held); one page with invented text was contained by eye."
superseded_by: null
issue: [7263, 7611]
router_evidence: [latin-gpu-7263]
---
## 2026-10-28 · Route C in production: PERO draft -> agy Flash-low with the image, pilot of 20 books (#7263)

PRIOR ART: `2026-10-28-gpu-flash-vs-opus-7263.md` (the TEST this pilot checks: Latin print, 108 pages one a book, arm C
105/108 usable, Wilson 92-99%, 3 misleading), `scripts/batch/cli-ocr-lane.mjs` correct mode (#7558, the lane shape),
`scripts/eval/lane-judge-sampler.mjs` (#7611, the judge of what lanes write), reused.

**Decision being checked (Derek, 2026-10-28, "defaults"):** route C for Latin print pages with no OCR yet, with a check
flag where Flash changed >= 27% of the draft's words.

### Rule, fixed before any judge call (commit a70b69fd7)
- **Frame judged:** the pages the pilot run WROTE (`ocr.pipeline = pero-agy-flash-low-7263`), in the 20 pilot books.
- **Draw:** `lane-judge-sampler.mjs run --book=<the 20> --per-book=3`, seed 7263: 3 written pages a book, uniform, plus
  every check-flagged page not drawn (the flagged stratum, judged always, reported apart, never evidence).
- **Judge:** Opus via `claude -p`, the route-judge prompt unchanged, page image attached, blind; two wrong-page controls.
- **PASS** (cron line + routing-table row) if the random stratum's acceptance rate is inside or above the TEST interval
  for arm C on Latin print, i.e. >= 0.92. **FAIL** (stop and report, no cron) if it is below 0.92, or if the wrong-page
  controls do not both fail. Wrong text (misleading) is reported with its interval, against the TEST's 3/108.

### The pilot run (one run, no cron, `--apply`)
- **Books:** the first 20 of the lane's queue: visible Latin books held `scans-only-publish-7176`, most-read first
  (`gpu-count --list=20`). 8 of the 20 are music treatises. One chunk of 15 unread pages a book, in page order, so the
  frame is FRONT-MATTER HEAVY (title pages, dedications, prefaces, calendars), unlike the TEST's interior pages.
- **Engine:** PERO-OCR `pero_eu_cz_print_newspapers_2022-09-26`, CPU config (as in the TEST), `/root/pero-ocr` on gex45;
  agy `gemini-3.8-flash-low` on the main pool, template `0601ef30e816f7a7` byte for byte, page image attached.
- **First attempt stopped and fixed:** the image host served two different JPEG byte-variants of the same URL from one
  request to the next, so the reader's re-fetch rarely matched the bytes PERO read and the hash guard refused 21 of 30
  pages. The reader now sends the lane's own download (`--image-dir`). The wrongly ledgered pages were un-ledgered.

| outcome (299 pages taken) | pages |
|---|---|
| written | 197 (196 after containment) |
| blank (PERO draft < 30 word characters) | 45 |
| refused: Greek or other letters outside the book's languages (existing guard) | 35 |
| refused: Flash tags the page handwritten or mixed (route is print only) | 16 |
| CONTAIN answer (an e-rara cover sheet), agy timeouts, cut replies, no draft | 1, 2, 2, 1 |

Cost: 255 agy calls (main pool weekly 29.88% -> 29.57%), 1,160 s of PERO wall time on 8 CPU threads, 0 GPU seconds
(PERO's CPU config is the one the TEST used; on the card the drafts differed more). Per ACCEPTED page (197 x 0.883):
1.47 agy calls and 6.7 s of PERO CPU wall time.

### Judged (64 Opus calls, the meter 81% -> 82%; stopped after the random stratum, see below)
| stratum | accepted | 95% (Wilson) | wrong text | books |
|---|---|---|---|---|
| **random, 3 a book (the rule)** | **53/60 (0.88)** | 0.78-0.94 | 5/60 (0.04-0.18) | 20 |
| random, page flagged | 20/23 | 0.68-0.96 | 2/23 | 13 |
| random, page not flagged | 33/37 | 0.75-0.96 | 3/37 | 17 |
| random, body text (`page-type` text) | 31/34 | | 1/34 | |
| random, front matter (title, dedication, preface, index, toc) | 22/26 | | 4/26 | |
| flagged stratum (beyond the draw) | 1/3 | | 2/3 | 1 |
| wrong-page controls | 0/2 (both failed, as they should) | | | |

- **FAIL:** 0.88 < 0.92.
- The judge was stopped after 3 of the 61 flagged-stratum pages: the decision rests on the random stratum, and the
  Claude account (shared with the Opus translation and Tibetan jobs on gex45) was at 82% of its week, with the pace guard at 85%.
- **What failed:** a liturgical calendar (Breviarium, 1490s: numerals and feast names in tables, 3 of 3 judged pages),
  title pages and dedications (an invented woodcut and date, misread verse), a two-column index with repeated lines.
- **The check flag** fired on 84 of 197 written pages (43%; the TEST: 10%) and did not pick out the bad pages here.
  PERO drafts on this early print are far from the corrector's text, so the TEST's p90 threshold is not this frame's.

### Containment (same run, by eye)
Guillaume Postel, *De originibus* (Paris, Lescuier) p.2, the title page: the stored read added an `<image-desc>` of a
woodcut printer's device (a sow under a tree) and the date "1538."; the leaf has neither (the imprint names the sign
*sub Porcelli signo*). The page was restored to its prior state, no OCR (`writePageText`, run
`contain-gpu-latin-route-7263-20261028`, revision `206b4c8427cc`), counters recounted, search mirror re-synced. The book
was and stays held. The other wrong-text findings are misreadings (calendar numerals, words), not text from elsewhere.

### What this does not show
- **Interior pages.** The pilot read each book's first 15 unread pages. Body-text pages did better (31/34) than front
  matter (22/26), but the rule was fixed on all pages and the split is exploratory.
- **The flagged stratum** is 3 pages, not 61.
- **What a book queues next:** nothing. All 20 books are `held` (`scans-only-publish-7176`) and stay held; no pipeline
  phase selects a held book, and new paid translation is braked (`lane_budgets.translate.enrol_paused`).

Files: `scripts/batch/cli-ocr-lane.mjs` (`gpu-correct`, `gpu-count`), `scripts/batch/pero-draft.py`,
`scripts/batch/cli-ocr.mjs` (`--gpu-draft`, `--image-dir`), `scripts/lib/draft-change-share.mjs`,
`scripts/eval/lane-judge-sampler.mjs` (`--book=`, the flagged stratum). Verdicts: Mongo `lane_judge_verdicts`,
`lane: pero-agy-flash-low-7263`. Ledger and logs: `/root/jobs/gpu-latin-route-7263/` on gex45.
Undo the pilot's writes: `revert-run.mjs --run-id <run>` for each `cli-ocr-2026102820*` run in that ledger.
