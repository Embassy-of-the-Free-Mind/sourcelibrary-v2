---
stage: ocr
measure: [judged]
languages: [ko, lzh]
scripts: [Hani, Hang]
canons: []
n_books: 30
n_pages: 30
verdict: "On 30 Korean pages (one per book, live and hidden, blind Opus against the image, instrument valid 8/8 wrong-page, 6/6 planted, 2026-11-03), no route reads Korean well: Opus accepts the stored read on 2/30 (wrong text on 25/30), agy 3.8 Flash low 3/30 (25/30), PaddleOCR-VL-1.6 5/30 (17/30) and Qwen3-VL-8B 2/30 (23/30). Every candidate has invented-text pages, so the preregistered hard floor blocks all three: HOLD, and no production re-read. PaddleOCR-VL is the best arm on hanja print (3/11 accepted, wrong text 5/11, against stored 1/11 and 9/11) but writes nothing or garbage on 4 of 8 hangul and mixed pages; against stored it is better on P = 0.89, short of the 0.95 bar. On the #7866 rubric, the stored read on the 28 live books says what the page says on 1/28 (3.6%, Wilson 0.6–17.7%), and its text is not on the page on 23/28 (82%, 64–92%). One live stored page was invented throughout and is contained."
status: rejected
decision: "No production re-read of Korean (DECISION on #7982). HOLD (hard floor) for the cell: all three candidates are blocked. rules.json is not changed: build.py with this evidence pooled would move korean-lite/manuscript to paddle, which writes nothing on hangul manuscripts. Split the Korean cell by script mix before any Korean evidence enters it. The next test is paddle>agy-flash-low on hanja print. Contained: Yŏja sanghaeng pʻyŏn p.37 (English withheld; the book was already held)."
superseded_by: null
issue: [7982, 7933, 6553]
router_evidence: "none — the export is in router-table/evidence/korean-cell-7982.score.json (+ by-script). rules.json does not name it: pooled, it moves korean-lite/manuscript to paddle, which fails on hangul. Splitting the cell by script mix is Derek's call; results/router-check.json shows the move"
defect_rates: "scripts/eval/korean-cell-7982/results/score.json"
---
## 2026-11-03 · Korean OCR: which route should read it? Stored read vs agy Flash vs two GPU engines (#7982)

Part of #7933. On /quality Korean is the worst cell with no OCR issue: 17.8 errors per 1,000 characters and 0% clean pages in the #7866 draw (3 books, 15 pages). The router's `korean-lite` cell has only #6553's fresh reads: Flash-Lite 2/11 print and 2/14 manuscript; agy Flash 5/11 print. This test decides the cell on k/n from one page per book before any Korean book is re-read.

PRIOR ART:
- `scripts/eval/experiments/2026-10-25-untested-language-cells-6553.md` and `evidence/cells-6553.score.json`: the Korean cell's only evidence (fresh Flash-Lite and agy Flash reads, sealed Opus judge, live books only). This test adds the STORED read, two GPU engines, hidden books and a script-mix stratum.
- `scripts/eval/experiments/2026-11-02-agy-reread-looping-pages-4850.md`: two Korean manuscript pages re-read by agy 3.8 Flash; Opus accepted neither.
- `scripts/eval/confidence-7866/` (lib.mjs `eligiblePage`, `imageUrl`, `routeOf`, `makeRng`) and through it `correction-pass-7818/lib.mjs judgeAbsolute` (route-judge-6740 `judgePrompt`, Opus via `claude -p`, image in the workspace) and `paceCheck`: imported unchanged.
- `scripts/eval/sanskrit-gex45-7243/drive.sh` and `read.py`: the PaddleOCR-VL-1.6 and Qwen3-VL-8B-FP8 arms on gex45, copied into `gpu-task.sh` / `read.py` with a Korean prompt instead of the Devanagari one.
- `scripts/batch/cli-ocr.mjs read`: the production agy OCR reader (live default OCR prompt, one page a call).
- `scripts/eval/estimator/router-table/rules.json` (`switch`, `hold`, `hard_floor`, `absolute_bar`) and `build.py paired_draws`: the gate constants and the paired Dirichlet restated below.

Code: `scripts/eval/korean-cell-7982/` (`lib.mjs`, `frame.mjs`, `gpu-task.sh`, `read.py`, `judge.mjs`, `score.mjs`). Results: `scripts/eval/korean-cell-7982/results/`. Texts, images and verdicts: `$JOB_SCRATCH/kc-7982/`.

### Frame and census (`frame.mjs census`, run 2026-11-03 09:08Z)

- **Books**: `language` starting "Korean", `pages_count > 0`, visible or hidden: 319 books, 70,409 pages, 57,673 with a stored read.
- **Script mix per book**, from its stored reads: hangul share of the hangul + hanja characters. Under 5% = hanja, over 50% = hangul, else mixed. Under 50 such characters = unknown.
- **Form per book**, from its pages' own `script_type`: manuscript when handwritten + mixed outnumber printed, else print. This is the split the router table uses.
- **Eligible pages**: a stored read that is not a skip page type, not hidden or split, and has an image (`eligiblePage`).

| stratum | books (live / hidden) | pages | eligible |
|---|---|---|---|
| hanja / print | 103 / 3 | 31,091 | 23,988 |
| hanja / manuscript | 134 / 2 | 30,857 | 26,960 |
| hangul / manuscript | 16 / 1 | 1,866 | 1,615 |
| hangul / print | 1 / 1 | 274 | 236 |
| mixed / manuscript | 6 / 0 | 601 | 180 |
| no stored read (unknown) | 34 / 18 | 5,720 | 0 |

- **Stored reads by route** (`routeOf`): `3flash` (gemini-3-flash-preview) 40,480 pages; `lite` (Flash-Lite) 17,193.
- **Not covered**: the 52 books with no read at all (5,720 pages). They have no stored arm to pair. The engine result is expected to carry over by script mix and form; that is an assumption.

### Draw (`frame.mjs draw`, seed 79821)

- **n = 30 pages, one per book.** Allocation over strata: hanja/print 11, hanja/manuscript 11, hangul/manuscript 4, hangul/print 2, mixed/manuscript 2. Proportional allocation would give hangul and mixed one page between them, so they are floored and the hanja strata take the rest.
- **Sampling.** Inside a stratum: sequential Poisson sampling, PPS on eligible pages. One uniform per book from `makeRng(79821)` over the census in id order; key = U / eligible; the stratum's lowest keys are drawn and the rest are its reserves in key order.
- **The page.** Uniform among the book's eligible pages in the middle 90% by page number with at least 20 characters stored, from `makeRng(79822 + the book's census index)`.
- **Weights.** Horvitz–Thompson: w = eligible / π, π = min(1, n_h · eligible / M_h). Cell-level weighted rates are reported beside the unweighted k/n. The router evidence is the unweighted k/n, as every other score file is.
- **Drawn.** 30 books, 2 of them hidden. The stored read is `3flash` on 21 pages and `lite` on 9.
- **By eye (`results/by-eye.json`, before any read).** Four pages differ from their book-level stratum:
  - hanja/print #6 is a hand-copied page (mathematics with counting rods).
  - hanja/manuscript #11 is a framed woodblock.
  - hangul/print #26 is a woodblock in Siddham, hanja and hangul.
  - mixed/manuscript #28 is a printed spread of two leaves.
  
  The strata stand as drawn: the weights belong to the draw. Results are also cut by the by-eye form.

### Arms (all on the same 30 pages; nothing is written to Mongo)

1. **`stored`**: the page's current `ocr.data` (`3flash` or `lite`). This is the bar.
2. **`agy-flash-low-read`**: `cli-ocr.mjs read --model=gemini-3.8-flash-low --concurrency=2`, the live default OCR prompt, one page a call, root's agy login, default pool. 30 calls plus cli-ocr's own retries; the brief's cap is under 100. The arm's text is the read between the markers. `read` records the book list in `lane_job_books` (the lane registry, #7301) and writes no page.
3. **`paddle-vl`**: PaddleOCR-VL-1.6 (0.9B) through the genai server, layout off. This is the production zh lane's P0 setting (`/root/pz/code/paddle-zh-box.sh arm`).
4. **`qwen3-vl-8b`**: Qwen3-VL-8B-Instruct-FP8 on vLLM 0.10 (`/root/bench/vl`), `read.py kore` with a Korean prompt (keep hanja and hangul as written; columns top to bottom, right to left), temperature 0, 6,000 max tokens, `--gpu-memory-utilization 0.6`.

- **The GPU arms** run as one hand-queued gpu-queue task (`00-korean-cell-7982`), on the same JPEG bytes the judge sees.
- **No output**: a read that is empty, under 20 characters after the tags are removed, errored or refused counts as **not accepted and not wrong text** (the router's mapping for refusal or empty).

### Judge (`judge.mjs`)

- **Call.** Opus (`claude -p --model opus`, this job's subscription login) with `judgeAbsolute`: route-judge-6740 `judgePrompt`, task `ocr`, language `Korean`, the page image in the workspace. One text per call; the judge is not told the arm.
- **Duplicates.** Identical texts on a page are judged once.
- **Order and pace.** Queue order `makeRng(79823)`, 3 calls at a time, paced by `paceCheck`. Cap: 160 calls.
- **Severity.** The prompt's three levels are REVIEWER.md's: `wrong_text` = serious, `misleads` = moderate, `cosmetic` = minor.
- **Controls.**
  - Wrong-page: 2 per arm, 8 in all. The page's image goes with another drawn book's text from the same arm (`makeRng(79824)`). It passes when the text is not accepted and fidelity is ≤ 2.
  - Planted: up to 6, on texts accepted in the main pass (`makeRng(79825)`). `plant-ocr-errors.mjs` has no CJK planter, so `judge.mjs` plants alternately:
    - D: one body line of at least 8 characters dropped from the middle.
    - S: a run of 3 consecutive characters in a middle body line replaced by 3 characters from another drawn page's text.
    
    A plant is caught when the verdict is not accept, or names a `wrong_text` or `misleads` defect.
  - **The instrument is valid** when all 8 wrong-page controls pass and at least 2/3 of the plants are caught. If it is not valid, the outcomes are reported as such and nothing is decided.
  - With fewer than 3 accepted texts to plant on, the plant check is reported as not run and validity rests on the wrong-page controls.

### Outcomes and the pass rule (fixed before scoring)

Per arm, over all 30 drawn pages:
- **Accept k/n**: Opus `accept`.
- **Wrong-text pages k/n**: at least one `wrong_text` defect.
- **Invented pages k/n**: a defect of class O1, O2, I1, I2, I6 or T14 (rules.json `hard_floor`).
- **Fidelity mean.**
- HT-weighted accept, with a stratified bootstrap 95% CI (4,000 resamples, seed 79826).

**Decision 1: the router cell route (new reads, and the 5,720 unread pages).**
- **Candidates**: agy-flash-low-read, paddle-vl and qwen3-vl-8b.
- **Hard floor**: a candidate is blocked when P(invented rate > 0.02) ≥ 0.9 under Beta(0.5 + k, 0.5 + n − k) with k ≥ 1 (rules.json `hard_floor`).
- **Pick**: the unblocked candidate with the highest posterior mean accept, Beta(1 + k, 1 + n − k).
- **A cheaper candidate** (GPU before agy) wins instead when P(acc_cheap ≥ acc_pick − 0.08) ≥ 0.9 under the paired Dirichlet(1 + both, 1 + cheap only, 1 + pick only, 1 + neither). These are rules.json `switch.within` and `switch.p`.
- **Floor**: the pick "clears the floor" when P(acc ≥ 0.8) ≥ 0.9 (rules.json `hold`).
  - If it does not, the row says **no arm clears the floor** and carries the NEEDS-ENGINE flag.
  - Under policy-1102 rule 1 that flag does not block the pick for unread pages.

**Decision 2: a production re-read of stored pages.** A re-read replaces text readers have now, so it needs a candidate that beats the stored read:
- (a) P(acc_cand > acc_stored) ≥ 0.95 under the paired Dirichlet on the 30 pages; and
- (b) no more wrong-text pages than stored; and
- (c) it is not blocked by the hard floor.

Scope:
- If more than one candidate passes, the Decision 1 pick is used.
- A re-read is recommended only for the hanja strata (22 of the 30 pages, 96% of eligible pages) where the candidate's accept k/n on that stratum is at least stored's.
- Hangul and mixed (8 pages) are reported, not decided; a re-read of them waits for a larger test.
- Any re-read goes to Derek as a DECISION line. This job writes nothing.

**Secondary (reported, not decided):**
- Each arm by stratum and by by-eye form.
- Stored `3flash` against stored `lite`.
- Wrong-text and misleads defects per 1,000 characters.
- The judge's reader notes on the hangul pages.

### Seeds

| purpose | seed |
|---|---|
| draw (book uniforms) | 79821 |
| page in book | 79822 + census index |
| judge queue | 79823 |
| wrong-page | 79824 |
| planted | 79825 |
| bootstrap and Dirichlet draws | 79826 |

### Declared limits

- **n = 30.** k/n on 11-page strata has wide intervals; this test is a cell decision, not a per-stratum rate.
- **One judge (Opus), not a human.** Opus reads cursive hanja and gungche hangul imperfectly. Where its notes say it could not read the hand, the verdict stands, but it is listed.
- **The stored arm** is whatever is live: two engines (3flash, lite) pooled as one bar, as a reader meets them.
- **Spend.** No paid API. Claude only via `claude -p` on the subscription. Gemini only via agy flash-low. GPU on gex45's flat fee.

## Results (run 2026-11-03 09:15Z – 09:50Z)

**Run.**
- **Opus**: `claude-opus-5-5` via `claude -p` (this job's subscription login). 130 calls against the 160 cap: 116 main and 14 controls, 0 unparsed. List-price equivalent $10.79, not billed.
- **agy**: `gemini-3.8-flash-low`, 30 calls, 0 retries. The weekly pool read 17% before and 15% after (shared account).
- **GPU**: two hand-queued gex45 tasks.
  - `00-korean-cell-7982`: PaddleOCR-VL, 30 pages in 68 s. The Qwen arm failed to start at `--gpu-memory-utilization 0.6`: a 1.27 GiB KV cache is under one page's image tokens plus output.
  - `00-korean-cell-7982-q`: Qwen alone at 0.7, with the card otherwise empty under the queue lock. 30 pages in 746 s; 7 pages hit the 6,000-token cap, all of them loops.
  - The card was back at 2 MiB after each task.
- **Paid API: $0.**
- **Inbox**: no notes.
- **Code fix after the prereg, no change of method.** Decision 1 assumed at least one unblocked candidate. With all three blocked, `score.mjs` now returns the router's own outcome, HOLD (hard floor; rules.json `no_served_privilege`: no fallback to the served route). It reports the unblocked decision beside it as `if_floor_ignored`, which is secondary.
- **Artifacts**: `scripts/eval/korean-cell-7982/results/` (`census.json`, `draw.json`, `by-eye.json`, `score.json`, `router-evidence.score.json`, `router-check.json`). Texts, images and verdicts are in `$JOB_SCRATCH/kc-7982/`.

### Instrument: valid
- Wrong-page: 8/8 refused at fidelity 1 (2 per arm).
- Planted: 6/6 caught (D, S, D, S, D, S on PaddleOCR-VL, agy and stored texts).

### The four arms (30 pages, 30 books)

| arm | usable | accept (HT-weighted, 95% CI) | wrong-text pages | invented pages | fidelity | wrong text / misleads per 1,000 chars | P(acc ≥ 0.8) | hard floor |
|---|---|---|---|---|---|---|---|---|
| stored (21 `3flash`, 9 `lite`) | 30/30 | 2/30, 0.09 (0–0.22) | 25/30 | 3/30 | 2.80 | 7.6 / 8.4 | 0.00 | blocked (P 0.99) |
| agy-flash-low-read | 30/30 | 3/30, 0.13 (0–0.29) | 25/30 | 4/30 | 2.77 | 7.3 / 8.2 | 0.00 | blocked (P 1.00) |
| **paddle-vl** (PaddleOCR-VL-1.6) | 26/30 | **5/30, 0.23 (0.06–0.41)** | **17/30** | 2/30 | **3.08** | 8.9 / 9.1 | 0.00 | blocked (P 0.94) |
| qwen3-vl-8b | 30/30 | 2/30, 0.09 (0–0.22) | 23/30 | 3/30 | 2.80 | 2.2 / 1.7 (inflated by loops) | 0.00 | blocked (P 0.99) |

- The stored read's 16 wrong-text-plus-misleads defects per 1,000 characters agree with /quality's 17.8 errors per 1,000 characters (#7866).
- The commonest defect on every arm is O6, a meaning-changing misread: 21–25 of 30 pages. Next are O5, silent omission (7–16), and O12, small-character notes and marginalia dropped or garbled.
- Qwen and PaddleOCR-VL loop on dense tables (genealogies, accounts). Qwen hit its token cap on 7 pages.
- agy returned an English content-filter message as its "transcription" on one account page. `cli-ocr.mjs apply` would refuse it as a refusal. The judge counted it as wrong text.
- **#6553's agy figure does not reproduce.** #6553 had agy at 16/28 with a sealed judge that wrote its own reference. This judge (route-judge `judgePrompt`, calibrated to the #7866 bar) is far stricter on Korean: 3/30.

### By stratum and by eye

| cut | pages | stored | agy | PaddleOCR-VL | Qwen |
|---|---|---|---|---|---|
| hanja / print | 11 | 1 acc, 9 wt | 2, 8 | **3, 5** | 1, 7 |
| hanja / manuscript | 11 | 1, 8 | 1, 9 | 2, 7 | 1, 8 |
| hangul / manuscript | 4 | 0, 4 | 0, 4 | 0, 2 (2 no output) | 0, 4 |
| hangul / print | 2 | 0, 2 | 0, 2 | 0, 1 (1 no output) | 0, 2 |
| mixed / manuscript | 2 | 0, 2 | 0, 2 | 0, 2 | 0, 2 |
| by eye: print | 14 | 1, 12 | 2, 11 | **4, 7** | 1, 9 |
| by eye: manuscript | 16 | 1, 13 | 1, 14 | 1, 10 | 1, 14 |
| stored engine `3flash` | 21 | 2, 16 | 3, 16 | 3, 12 | 2, 15 |
| stored engine `lite` | 9 | 0, 9 | 0, 9 | 2, 5 | 0, 8 |

- **Hangul.** No arm has an accepted page among the 8 hangul and mixed pages. Every hangul manuscript read by every arm misreads or invents syllables. PaddleOCR-VL returns nothing usable on 3 of the 8 (one character, a jamo string, two characters). Its fourth unusable page is a hanja manuscript.

### Decisions (preregistered rule)

- **Decision 1, the cell route: HOLD (hard floor).**
  - Every candidate has invented-text pages, and with them P(invented rate > 0.02) ≥ 0.9. PaddleOCR-VL has the fewest: 2/30, P 0.94.
  - If the floor is ignored (secondary): the pick is PaddleOCR-VL. It does not clear the floor (P(acc ≥ 0.8) = 0), so the row would carry NEEDS-ENGINE.
- **Decision 2, re-read the stored pages: no.**
  - No candidate passes. PaddleOCR-VL against stored, paired: 4 pages gained, 1 lost, 1 both, 24 neither. P(acc_paddle > acc_stored) = 0.89, under the 0.95 bar, although its wrong-text pages are fewer (17 against 25).
  - agy: 2 gained, 1 lost, P 0.69, wrong-text pages 25 against 25.
  - Qwen: 1 gained, 1 lost, P 0.50.
- **build.py on a copy of main** (`results/router-check.json`). This export was added to korean-lite (stored-lite and agy as evidence, paddle and qwen3-vl-8b as new stage-none routes); the checkout's rules.json is not changed.
  - korean-lite/print stays `switch → agy-flash-low-read`, pooled with #6553's agy at 7/24 (paddle 3/13).
  - korean-lite/manuscript moves from agy to `paddle` (fallback: none passes the gate).
  - That move would send hangul manuscripts to an engine that writes nothing on them. The router's Korean cell is split only by print and manuscript, not by script mix, and on this evidence hanja and hangul need different engines.
  - **Not applied.**

### Containment
- **Live page contained.** The stored read of *Yŏja sanghaeng pʻyŏn* p.37 (book 69f325ae52a77bb28fdb58e9, page 69f325ae52a77bb28fdb590e) is generic modern moral prose that is not on the leaf. The judge gave it fidelity 1 with three O1 spans; I confirmed it by eye. Its English (2,306 characters) was translated from that text.
  - Withheld under `.claude/docs/invariants/containment-on-finding.md` by `withhold-stale-translations.mjs --by-eye-pages=37 --apply`: 1 page, 1 `page_revisions` snapshot. Undo with `restore-withheld-translation.mjs`.
  - The book was already held, for another reason, so no new hold was written.
  - #7982 is labelled `contained`.
- **Hidden book, not touched.** The stored read of *Yang Pʻung-un chyŏn* p.21 (69f3249752a77bb28fdb3556, hidden book) is also not the leaf's text: a loop of invented syllables. The book is hidden, so no reader sees it.
- These two writes are the only Mongo writes, apart from `cli-ocr.mjs read`'s lane book list (`lane_job_books`, 30 books). The brief's "no Mongo writes" is read as no experiment write-back; the containment rule is a standing default that needs no ask.

### Served quality: the stored read on the live books (Derek, job inbox 2026-11-03 09:49Z)

- **Inbox note.** Report the STORED arm on live books as the served-quality figure for Korean, on the #7866 rubric, with Wilson intervals.
- **The live subset is 28 of the 30 drawn books** (`visible: true`, `pages_count > 0`). The two hidden books, *Wŏlchʻon chip* and *Yang Pʻung-un chyŏn*, are left out.
- **Grading.** One page per book, graded by `confidence-7866/regrade.mjs gradeOf` / `bucketOf` on the same Opus verdict. Rates per 1,000 use `route-judge-6740/defect-rate.mjs words()`, the function /quality uses.
- **Weighting.** Unweighted over books. The draw floors hangul and mixed books at 8 of 30, so hangul is over-represented against its share of pages. On the 21 live hanja pages alone it says what the page says on 1/21, and its text is not on the page on 16/21. `results/served.json`, `score.mjs served`.

| #7866 bucket | k/n | share | Wilson 95% |
|---|---|---|---|
| says what the page says (fit to quote or read) | 1/28 | 3.6% | 0.6–17.7% |
| misleads somewhere (search only) | 4/28 | 14.3% | 5.7–31.5% |
| text not on the page | 23/28 | 82.1% | 64.4–92.1% |

- **Grades**: fit to quote 1, fit to read 0, search only 4, wrong span 15, mostly wrong 6, not this page 2.
- **Opus accept**: 2/28 (7.1%, 2.0–22.6%).
- **Severe (misleads + wrong text)**: 32.7 per 1,000 `words()` units (5,971 units). Wrong text 15.4, misleads 17.3.
  - /quality's 17.8 is the same measure over 3 books and 15 pages (#7866).
  - On 28 books it is about twice that.
- **By stored engine**: `3flash` says what the page says on 1/21, `lite` on 0/7.

### What this says
- **Korean OCR is bad on every route we have.**
  - About one page in ten is accepted.
  - Five of six stored pages carry wrong text.
  - Both of the live engines, gemini-3-flash-preview and Flash-Lite, score near the bottom.
- **Re-reading with any of these routes would buy little and risk invented text.** Every arm invents on 2–4 of 30 pages.
- **Hanja print is where an engine shows a gain.** PaddleOCR-VL accepts 3/11 against stored 1/11 and halves the wrong-text pages (5 against 9). On print by eye it is 4/14 against 1/14. That is still far below any usable bar.
- **The next test:**
  - PaddleOCR-VL draft > agy 3.8 Flash correction on hanja print, the policy-1102 default pipeline, against the stored read on fresh pages.
  - Hangul (cursive gungche especially) needs a different engine or a by-eye lane; none of the four reads it.
