---
stage: ocr
measure: [judged]
languages: [la, lzh]
scripts: [Latn, Hani]
canons: []
n_books: 68
n_pages: 68
verdict: "Three results. (1) The prior's calibration (logit acceptance = 1.12 + 0.38 x logit of the v1/v2 mean) fits in sample, but it LOSES held out: leaving one cell out, the log likelihood is -205.3 calibrated against -202.1 uncalibrated (on the final split table, -165.0 against -155.2). The slope comes from one route, Latin Flash-Lite's draft (v1 0.035 against 0.65 judged). The uncalibrated prior stays in force, and the calibrated decision is a sensitivity column; it differs on 2 cells. (2) Print and manuscript are now separate cells. Every evidence source was re-cut page by page (92 source pairs reconciled exactly), and waiting pages were split by a measured share. 49 of 86 split rows decide differently from their unsplit cell. Nearly all of them are manuscript or unknown-script variants that now say UNTESTED or HOLD instead of inheriting print numbers. (3) The tests ran on WAITING print pages, one per book, read-weighted. Latin Flash-Lite, a fresh agy Flash-low read: 22 of 34 accepted (8 replies cut, so not delivered; 22/26 of the delivered). Latin 3 Flash, an agy Flash-low correction: 28/34, wrong text 4/34. Neither clears the Opus bar, and both cells stay HOLD. The Chinese Paddle flash-high test did not run: its pool was under the floor. 33 library pages were rewritten."
status: undecided
decision: "Proposal only (ocr-routing-table.json untouched). rules.json: prior.calibration in_force false; switch.bar_scope = print (Opus is a candidate in manuscript cells, Derek 12:06Z); script_split on, with Greek manuscripts planned on Opus. Router table 2026-10-28-router-next (split) and -unsplit (the same evidence pooled), before = 2026-10-28-agy-gpu-7263. zh-paddle-dice-lt090 paddle>agy-flash-high is deferred until the default agy pool is above its pace line (sample drawn, refs aligned)."
superseded_by: null
issue: [7263, 7611, 6740]
router_evidence: [latin-lite, latin-flash3]
---
## 2026-10-28 · Prior calibration held out, print vs manuscript cells, and two agy tests on waiting pages (#7263)

PRIOR ART:
- `2026-10-28-router-backfill-all-and-prior-weight-7263.md` (#7612): it fitted the prior weight (7 pages) and an in-sample calibration slope of 0.40, applied neither, and set the evidence conventions kept here.
- `2026-10-28-router-tests-agy-flash-low-gpu-draft-7263.md` (#7615): it reported its own cells' k/n by script type (`script-split.json`). It did not split the router.
- `route-judge-6740/judge.mjs`: the judge, unchanged except `correct --keep-reads`.
- `euro-gpu-correct-7567/write-back.mjs`: the write-back pattern.

**Inbox notes acted on:**
- Derek 11:54Z: split every cell by print vs manuscript before the calibration and the tests, and draw print waiting pages.
- Derek 12:06Z, on classification:
  - The `<script>` tag of the current OCR where the field is missing.
  - The tag wins on a conflict.
  - Otherwise the book's majority, else unknown.
  - Nothing is written to `pages.script_type`.
- Derek 12:06Z, on Opus: in manuscript cells Opus is a candidate; Greek manuscripts are planned on Opus.

### Part 0: print vs manuscript
**Classification.** `router-next-7263/script-type.mjs` classifies each page. Mixed counts as print.

**Coverage of the judged evidence** (2,244 distinct pages, 92 source × cell × route pairs; `evidence_pages.py` reconciles each pair page by page with its score.json, so k/n, wrong text, books and the zh name check are all exact):

| basis | print | manuscript | unknown |
|---|---|---|---|
| page field, agreeing with the tag | 1,389 | 438 | |
| tag only | | 78 | |
| tag, conflicting with the field | | 10 | |
| book majority | 56 | 92 | |
| unknown | | | 181 |

**Waiting pages.** `waiting-split.mjs` counts frames of up to 120 books in full. Larger frames are estimated from a draw of 120 books, weighted by their frame pages, with a 90% bootstrap interval in `results/waiting-split-2026-10-28.json`. Pages with no page-level type are the "book-majority" and "unknown" counts there. Main cells:

| cell | print | manuscript | unknown |
|---|---|---|---|
| Latin lite | 97% | 3% [1, 5] | 0% |
| Latin 3 Flash | 53% | 6% | 42% [35, 50] |
| German 3 Flash | 40% | 0.5% | 60% |
| Greek lite | 30% | 70% | 0% |
| Arabic lite | 63% | 37% | 0% |
| Arabic 3 Flash | 22% | 48% | 30% |
| Hebrew 3 Flash | 11% | 29% | 61% |
| Korean lite | 44% | 56% | 0% |
| Tibetan Yigdzin | 2% | 97% | 1% |
| Chinese Paddle and Siku | 0% | 100% | 0% |

- **The Siku copies are manuscripts.** That is the Wenyuange tag. 2,069 of 18,301 sampled Siku pages carry `script_type: printed` against a `handwritten` tag; the tag wins.
- **Most 3 Flash pages have no type.** Their OCR predates the tag, and many of their books have no `script_type`. The unknown share is the coverage gap: Latin 3 Flash 42%, German 3 Flash 60%. A backfill is a separate job (script-type-backfill-7263).

**Split rules** (`build.py expand_by_script`; `rules.json script_split`):
- `<cell>/print`, `/manuscript` and `/unknown` each get their share of the pages waiting, and the evidence of their own pages (`evidence/by-script/`).
- A manuscript cell takes no v1/v2 prior, because both were fitted on print.
- In a manuscript or unknown cell, a route with fewer than 10 judged pages counts as unmeasured, and the cell says `UNTESTED` or `HOLD (… < 10 pages a route)`.
- `switch.bar_scope = print`.
- Greek manuscripts are `planned → Opus`.
- `--no-script-split` builds the same evidence pooled.

**Decisions that change with the split** (2026-10-28-router-next against -unsplit, same evidence): 49 rows; the full list is on #7263. Three matter most:
- **russian-lite/print: switch → HOLD.** The pooled switch leaned on unknown-type pages.
- **tibetan-yigdzin.** The switch to agy holds on the 97% manuscript part; the small print and unknown parts fall to `UNTESTED`/`HOLD`.
- **zh-paddle-dice-lt090/manuscript: HOLD → paddle>opus.** Opus is now a candidate, but nothing reaches P(acc ≥ 0.8) ≥ 0.9.

### Part 1: calibration of the prior means
`fit_prior.py` fits (alpha, beta, W) on a fine grid, then holds out one cell at a time.

| table | in sample | held out, calibrated | held out, uncalibrated | MAE cal / uncal |
|---|---|---|---|---|
| backfill-all (15 routes) | 1.12 + 0.38·logit m, W 16.9 | -205.3 | -202.1 | 0.139 / 0.119 |
| same, without the Latin lite draft | | -191.6 | -184.3 | 0.087 / 0.084 |
| router-next, split (20 routes) | 0.78 + 0.44·logit m, W 8.6 | -165.0 | -155.2 | 0.207 / 0.155 |
| same, without the Latin lite draft | | -155.2 | -136.7 | 0.127 / 0.130 |

- **Intercept only** (+0.36 logit, W 10): a wash (-202.7 against -202.1).
- **What is built in:** the mapping, with `rules.json prior.calibration.in_force = false`. The calibrated decision is a sensitivity column.
- **It differs on two cells:** zh-6561-served/manuscript (keep → switch paddle>opus, 0 pages waiting) and arabic-flash3/print (HOLD names 3flash instead of 3flash>agy-flash-low).
- **The weight is about the same:** W = 7.4 pages, 90% [3.6, 16], on 20 routes; rules.json keeps 7.

### Part 2: the test-next cells, on waiting pages
**Draw** (`router-next-7263/draw.mjs`):
- From the cell's census bucket, one page per book.
- Books drawn without replacement with probability ∝ read_count + 1. Median reads of the books drawn: 5 for Latin lite, 8 for 3 Flash; the corpus mean is 2.0.
- Print pages only.
- Held and unsplit books and 69bd9d05 are left out.

**Reads** (judge.mjs `correct --keep-reads`):
- `findRead` was checked first: 0 kept reads existed.
- 80 agy calls on the second pool (jamesdereklomas@, Flash-low only).
- Every read is kept in R2.

**Judge:** 64 Opus calls, blind, image attached, the same prompt and template as the router tests.

| cell / route | accepted | wrong text | notes | router after |
|---|---|---|---|---|
| latin-lite / agy-flash-low-read (fresh read) | 22/34 (22/26 delivered) | 2/34 | 8 replies cut (no `<<<END>>>`) after retries; counted as not delivered, as fresh-7517 | the route's posterior 0.70 [0.58, 0.80], was 0.83; cell HOLD → gpu>agy-flash-low (0.82, P within 0.08 of the Opus bar 0.65) |
| latin-flash3 / 3flash>agy-flash-low | 28/34 | 4/34 | | 47/60 pooled → 0.80 [0.71, 0.87]; HOLD (no route has P(acc ≥ 0.8) ≥ 0.9) |
| zh-paddle-dice-lt090 / paddle>agy-flash-high | — | — | not run (see below) | HOLD → paddle>opus (manuscript) |

**Why the zh test did not run.** The second pool runs only Flash-low (`allowed-model`). Flash-high therefore needs the default pool, and it stood at 31% weekly against its 34% pace line. The brief says to stop under the floor.
- The draw is ready for a resume: 36 Siku manuscript pages, 32 of them with a Kanripo leaf.
- #7615 measured paddle>agy-flash-low 19/29 on the same frame. That is the arm test-next now proposes.

**Pages written.** Each accepted read went through `cli-ocr.mjs apply --apply` with every guard.
- Latin lite: 16 pages, run `cli-ocr-20261028122723-644561`.
- Latin 3 Flash: 17 pages, run `cli-ocr-20261028122726-644639`.
- Undo with `revert-run.mjs --run-id`.
- 17 accepted reads were refused by apply's guards and keep their text:
  - Greek letters in a Latin book: 8.
  - Correction changes ≥ 26% of the words: 6.
  - < 40% shared words: 2.
  - An extra transcription header: 1.
- Per-page plan: `route-judge-6740/results/router-next-2026-10-28/apply/plan.json`.

**What the writes queue.**
- Neither lane is a `WITHHOLD_LANE`, so no English is withheld.
- 3 written pages already in English sit in `ocr_complete` books: the translate lane re-translates them when it takes the book (Flash-Lite, cents).
- 4 written pages without English are in books that already wait for translation.
- The other 26 pages are in books a gap-fill does not select; their English is flagged stale by rule (OCR newer) and nothing is queued.

**Rejected:** 10 pages (4 + 6). They keep their text and go on #7611 as the GPU-draft>agy retry list.
- **No containment candidates.** No page was judged wrong-leaf or invented.
- **One corrector output** substituted letters to fit an expected word (O3/O8, "Emeth"). It was never written, and it is the corrector's error, not the served text's.

### What this does not show
- **The unknown cells are large** (Latin 3 Flash 549K pages waiting) and decided by little evidence. The script-type backfill will move pages out of them.
- **Waiting shares outside the census languages are exact counts**; the others come from samples, with the 90% intervals in the results file.
- **The new tests' draw is read-weighted**, not the cell's page mix. The router pools it with the earlier draws.

Files:
- Code: `scripts/eval/router-next-7263/` (draw, script-type, classify-evidence, evidence_pages, split_evidence, waiting-split, derive_score, accepted).
- Router evidence: `evidence/router-next-7263.score.json`, `evidence/by-script/`.
- Judge results: `route-judge-6740/results/router-next-2026-10-28/`.
- Tables: `router-table/2026-10-28-router-next{,-unsplit}.md`.
- Prior fit: `router-table/prior-fit-2026-10-28-router-next.json`.
