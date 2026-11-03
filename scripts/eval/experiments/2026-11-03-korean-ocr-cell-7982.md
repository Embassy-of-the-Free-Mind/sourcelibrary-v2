---
stage: ocr
measure: [judged]
languages: [ko, lzh]
scripts: [Hani, Hang]
canons: []
n_books: 30
n_pages: 30
verdict: "PENDING — preregistered 2026-11-03 before any page was judged; results follow below this line when scored."
status: undecided
decision: null
superseded_by: null
issue: [7982, 7933, 6553]
router_evidence: "none — preregistration; the score export lands with the results"
defect_rates: "none — preregistration; filled when scored"
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
