---
stage: ocr
measure: [judged]
languages: [la]
scripts: [Latn]
canons: []
n_books: 40
n_pages: 40
verdict: "Preregistered 2026-11-01; no judge call yet."
status: undecided
decision: "Pending: the latin-blank/print route is Derek's call (#7862 DECISION); this test supplies the paired evidence."
superseded_by: null
issue: [6740, 7862, 7824, 7701, 7853]
router_evidence: "pending"
defect_rates: "scripts/eval/latin-paired-6740/results/score.json"
---
## 2026-11-01 · Latin first reads: PERO > agy one a call (live), PERO > agy four a call, or agy read four a call? Paired, queue-weighted (#6740)

PRIOR ART:
- `2026-10-31-queue-routes-7853.md` and `scripts/eval/queue-routes-7853/`: the whole design. Reused: the PPS draw on pages owed inside strata with one uniform a book drawn before exclusions, the agy face tag with replacement (`agyFace`), the arm machinery (`dryApply` with `--emit-written`, `callsOf`, the agy pool of 2, retry of a read the box killed), the hand-queued GPU task, the judge driver (`judgeAbsolute`, `paceCheck`, the call budget, wrong-page and planted controls), HT weights and the stratified bootstrap, Wilcoxon and Holm, the write-back rule, `exportScore` and the router check.
- `scripts/eval/route-judge-6740/judge.mjs drawBlank` and `cheap-routes-7701/run.mjs` (#7701): the first-read frame (`FIRST_READ_BOOKS` + `firstReadSkip`, `spreadReason`), the page's block of up to 4 consecutive unread pages, the la-armc arms (PERO > agy at 1 and 4 a call through `cli-ocr.mjs read --gpu-draft --image-dir`, written by `apply --diff-guard=gpu-draft --print-only`), the read@4 arm's `apply --first-read-only --print-only`, the per-arm wrong-page control.
- `scripts/batch/cli-ocr-lane.mjs armcRun --frame=first-read`: the live route exactly as production runs it (GPU template `0601ef30e816f7a7`, no `--over-stored`, lane `pero-agy-first-read-7701`).
- `2026-10-28-euro-print-gpu-draft-flash-correct-7567.md`, `scripts/batch/pero-draft.py`: PERO-OCR (`pero_eu_cz_print_newspapers_2022-09-26`) on this box.
- `scripts/eval/estimator/router-table/build.py decide_defects` (#7862) and `route-judge-6740/results/defect-rate-2026-10-30/RULE.md` amendment S1 (#7824): the decision rule, restated over this study's data; its constants are read from `rules.json decision_rule`.
- `scripts/eval/route-judge-6740/defect-rate.py --add-pooled`: how this study's defect counts join the router's rates.

Code: `scripts/eval/latin-paired-6740/` (`lib.mjs`, `frame.mjs`, `arms.mjs`, `gpu-task.sh`, `judge.mjs`, `analyze.mjs`, `writeback.mjs`). The analysis is committed in this PR, before any verdict exists.

**Why.** In the #7862 build the defect rule turns latin-blank/print to HOLD: the live route `pero>agy-flash-low-written` carries 2.33 wrong-text defects per 1,000 words, about six times `pero>agy-flash-low@4-written` and `agy-flash-low@4-written`, and the pick between those two moves with the misleads weight ($0.001 / $0.01 → pero@4, $0.1 → agy@4). Those rates come from 22 to 26 books drawn separately for each route, much of the live route's from a 4-book depth sample. Derek took the default on 2026-11-01: test the three routes on the same pages before moving the cell.

### Frame (`frame.mjs census`, run 2026-11-01 00:55Z)

- **The queue** is latin-blank/print: the first-read lane's Latin books, `FIRST_READ_BOOKS` + `firstReadSkip(languages: lat)` (visible, held as scans with a first-read hold, print route, no manuscript by library, title or date, not a known unsplit spread). The live armc `--frame=first-read` lane plans from the same set.
- **Owed pages** per book = `pages_count − pages_ocr`, the lane's own count. 15,356 books, 4,741,905 owed pages (15,300 books have no OCR at all).
- **The queue's make-up** (owed pages): ≤ 1600 41%, 17th 37%, 18th 22%, 19th+ and undated under 0.1%. e-rara holds 85% of owed pages, BSB 11%.
- **Exclusions** (`frame.mjs exclusions`): every queue book that a committed `.json/.jsonl/.gz/.md/.tsv/.csv` file under `scripts/eval/` names, by book id or by a page id resolved to its book. A file naming more than 1,000 queue books is a census, not a test, and is not used (one file: `output/book-class-5768/classes.jsonl.gz`, 15,265). 1,666 books (460,477 owed pages) are excluded. Declared gap: tests whose page rows sit only in a job's scratch or on R2 are not seen.

### Strata, allocation, draw (`frame.mjs draw` / `tag` / `select`, seed 67401)

- **Strata**: the century band of the book's year (≤ 1600, 17th, 18th, 19th+, undated).
- **Allocation**: 40 pages, proportional to owed pages by largest remainder. A stratum under 1% of owed pages gets none and is reported as uncovered (19th+ and undated, 0.07%). Each covered stratum gets at least 2. Result: ≤ 1600 16, 17th 15, 18th 9.
- **Draw**: sequential Poisson sampling, PPS on owed pages. One uniform a book (`makeRng(67401)` over all owing books in id order, before exclusions), key = U / owed; a stratum's books in ascending key, the rest its reserves in order.
- **The page**: one interior unread page of the book (`isInterior` on `pages_count`), uniform from a stream seeded by the book id. Its block is the run of consecutive unread pages around it, cut to 4 with the page at a seeded position. A book that left the frame, that `spreadReason` marks as a possible unsplit spread, or that has no interior unread page is replaced by the stratum's next reserve.
- **Typeface** (post-stratum): one agy call a page (`agyFace`, unchanged). A page tagged `none` (no printed body text) or an unfetchable image is replaced by the next reserve.
- **Done before this file merged:** the census, exclusions, draw, page choice and face tags (98 books tagged; 52 drawn books replaced as possible unsplit spreads, 1 as `none`). The sample: 40 pages in 40 books, all e-rara; 37 Antiqua and 3 Fraktur; every block 4 pages.
- **Weights**: Horvitz–Thompson, a page stands for w = owed / π pages, π = min(1, n_h · owed / M_h). Every weighted figure uses w; unweighted k/n are reported beside it. The 52 spread replacements mean the weighted estimates describe the part of the queue the lane can read now, not the books waiting on a split check.

### Arms, all on the same page (`arms.mjs`; every apply is a DRY run with `--emit-written`; nothing is written)

- **GPU drafts.** PERO-OCR on the block pages' image bytes, the same bytes the correctors and the judge see (`gpu-stage`, then one hand-queued gex45 gpu-queue task, `gpu-task.sh`; `gpu-collect` makes one draft a page with `armcDraftText`). A draft under 30 word characters is no draft (armcRun's rule).
- **1, `live` = `pero>agy-flash-low-written`**: the live route as armcRun `--frame=first-read` runs it. `cli-ocr.mjs read --correct-prompt=<GPU template 0601ef30e816f7a7> --lane=pero-agy-first-read-7701 --gpu-draft --image-dir`, the page alone, then `apply --diff-guard=gpu-draft --print-only`.
- **2, `pero4` = `pero>agy-flash-low@4-written`**: the same, the block's drafted pages 4 a call (`--per-call=4`), lane `pero-agy4-first-read-6740`.
- **3, `read4` = `agy-flash-low@4-written`**: a fresh read of the block, 4 a call, on the live first-read prompt, then `apply --first-read-only --print-only --lane=agy-first-read-7701`.
- **A page an arm does not write stays scans-only** (it serves no text). It is not accepted in the all-drawn accept, and has no defect rate.
- **Common.** `gemini-3.8-flash-low` on agy's default pool, 2 calls at a time. Reads are not `--fresh` (a kept read of the identical request is reused and costs 0 calls). A read killed by the box (`exit -9`) is retried once. If a lane writes a sampled page between this test's read and its dry apply, the apply refuses ("the page has OCR now"): for `read4` the read stands as its text, and it is never written back; for the GPU arms the page counts as not written. Either case is counted.
- **GPU in front of production.** The task is hand-queued in `/root/gpu-queue/pending` with `/root/gpu-queue/ocr-filler/PAUSE` touched while it runs, and removed after.

### Judge (`judge.mjs`)

- Opus via `claude -p --model opus` on this box's subscription, `judgePrompt` (task ocr, language Latin) unchanged, the page image attached, one text a call, blind to the arm. A text identical to one already queued for the page is judged once and stands for every arm that wrote it.
- Order: `makeRng(67402)` over the items. 3 calls at a time.
- **Budget**: at most 220 Opus calls (about 120 items + 6 wrong-page + 5 planted). Pace: weekly ≥ 85% or 5-hour ≥ 95% stops; resume after the reset.
- **Controls.**
  - Wrong-page: 2 per arm, this page's image with another book's written text of the same arm (`mulberry32(67403)`). Passes when not accepted at fidelity ≤ 2.
  - Planted: 5 on accepted texts, kinds B–E rotating (`plantError`, `makeRng(67404)`), scored by `scorePlant`.
  - The judge is **valid for this study** when every wrong-page control passes and at least 0.80 of plants are caught. If not, the judged outcomes are reported as invalid and nothing is decided or written back.
- Noise floor: #7818's κ 0.87, same judge, prompt and kind of task (not rerun).

### Outcomes (`analyze.mjs score`)

- **Primary: severity-weighted defects per 1,000 words** (#7824, MQM weights cosmetic 1, misleads 5, wrong_text 25; words by #7824 `words()`).
  - Contrasts: `pero4` against `live`, and `read4` against `live`, each paired on the pages both arms wrote and the judge read.
  - Effect: the difference of the HT-weighted ratios (Σ w·points / Σ w·words), with a book-cluster bootstrap 95% CI (one page a book, so books are resampled within their strata; 4,000 resamples).
  - Test: Wilcoxon signed-rank on the per-page severity rates. **Holm over the two contrasts.** Supported = Holm-adjusted p < 0.05.
- **Gate: accept.** Weighted accept over every drawn page (a page not written is not accepted). A candidate passes when it is no more than 5 points below `live`.
- **Decision: #7862's S1 rule**, restated over this study (`decideS1`; constants from `rules.json decision_rule` as on main):
  - Bar = `live`. Rated arms have ≥ `min_books` (10) judged written pages.
  - Rates: gamma-Poisson posterior means per 1,000 words, one common prior for the three arms (their pooled rate, worth 2,000 words, defect-rate.py's `A0_WORDS`), deflated by the re-check (misleads × 0.625, wrong text × 0.80, from `defect-rates.json recheck`).
  - Gate 1, wrong text: ≤ the bar's + 0.15 per 1,000 words.
  - Gate 2, acceptance floor: P(acc_arm ≥ acc_live − 0.05) ≥ 0.5 under the paired Dirichlet(1 + both, 1 + arm only, 1 + live only, 1 + neither) on every drawn page.
  - Pick: the lowest price per raw page (agy calls a page × $0.00087; GPU card time unpriced, as build.py prices the pero stages) + W/1000 × w_m × (misleads + 3 × wrong text), W = the median of the arms' median words a page.
  - A pick that changes across w_m ∈ {$0.001, $0.01, $0.1} is **HOLD**, not switch. Otherwise keep (pick = live) or switch.
  - Reported beside it: the same rule with GPU time priced (3 s a page at gex45's $249 a month), and what `build.py` decides on a copy of main with this export in rules.json and these defect counts pooled into `defect-rates.json` (`analyze.mjs router`).
- **Secondary**: `read4` against `pero4` (severity and accept); accept McNemar for each contrast with the weighted effect and CI; wrong text, misleads and cosmetic per 1,000 words per arm with CIs; wrong-text pages added and removed; written share and the arms' refusal reasons; fidelity; agy calls and GPU seconds a page; $ per accepted page; by stratum and face.
- **CER on CAMENA-matched pages** (#6012 `kgram-vote-v2`, same edition, congruent). Checked before this file: none of the 40 sampled books is in the CAMENA manifest (an aligned page needs a stored read, and these books have none). With fewer than 5 matched pages no CER is computed, and the outcome is reported as not available at this n.

### Write-back (the only production write)

- On each page, the best judged arm: accepted, then fidelity, then fewer wrong_text, misleads, cosmetic defects; ties go to the cheaper arm (read4 < pero4 < live).
- Written only where it is accepted, its own dry apply would write it, and the page was unread when the arm read it.
- Through `cli-ocr.mjs apply --apply --only=<page>` from the arm's own read directory, with its guards (first reads only, printed only; the GPU arms' put-back against the draft), revision row and provenance (`writeback.mjs`, dry run first). The lane stamps are those of the arms. Books keep their scans-only hold. There is no `--mark-stale` (no translation exists).
- Every page written is listed in the results with its run id for `revert-run.mjs`.

### Seeds

| purpose | seed |
|---|---|
| draw (book uniforms; page and block position: 67401 + the book id's last 6 hex digits) | 67401 |
| judge queue | 67402 |
| wrong-page | 67403 |
| planted | 67404 |
| bootstrap and Dirichlet draws | 6740 + offsets |

### Declared deviations from the brief

- n = 40, as briefed. Severity contrasts are on pages both arms wrote; a page one arm leaves unwritten enters through the accept gate.
- The S1 rule is restated over this study's paired pages with an in-study prior. build.py's own decision on the pooled rates is reported beside it, not used.
- The face tag is one agy call a page (#7835 T4), not by eye: 98 calls on top of the arms' ~160.
- Limits: Claude only via `claude -p` on this box's subscription; Gemini only through agy flash-low; no paid API; no cron or routing change; `current.json` is not moved.
