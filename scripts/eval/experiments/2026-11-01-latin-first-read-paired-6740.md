---
stage: ocr
measure: [judged]
languages: [la]
scripts: [Latn]
canons: []
n_books: 40
n_pages: 40
verdict: "On 40 unread Latin print pages from the latin-blank/print queue (one per book, PPS by pages owed, blind Opus, 2026-11-01), the preregistered S1 rule picks pero>agy-flash-low@4-written at every misleads weight, so the #7862 HOLD resolves to a switch. Neither severity contrast against the live route is supported (pero@4 -5.5 per 1,000 words, 95% CI -18.8 to +3.0; read@4 +10.2, -9.8 to +34.7). The live route's 2.33 wrong-text rate did not reproduce (0.20, 0 to 0.66). Both PERO routes leave about 45% of pages unwritten; read@4 accepts 0.75 of all drawn pages against 0.55 (+20 points, p 0.02), but at 0.92 wrong text per 1,000 words, on the pages the PERO routes refuse."
status: undecided
decision: "Recommended: latin-blank/print moves to pero>agy-flash-low@4-written (S1, stable across weights; build.py with this study pooled agrees). Not applied: current.json, the armc lane (which has no 4-a-call mode yet) and the cron are Derek's (#7809). 31 pages written back."
superseded_by: null
issue: [6740, 7862, 7824, 7701, 7853]
router_evidence: "none — the export is in router-table/evidence/latin-paired-6740.score.json but rules.json does not name it, and defect-rate.py ADD does not pool it: both move the latin-blank pick, which is Derek's call (#7809); results/router-check.json shows the move"
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
- **Done before this file merged:** the census, exclusions, draw, page choice and face tags (98 books tagged; 52 drawn books replaced as possible unsplit spreads, 1 as `none`). The sample: 40 pages in 40 books, all e-rara; 37 Antiqua and 3 Fraktur; every block 4 pages. While this PR's checks ran, the PERO drafts were made (158 of 160 block pages) and the arms ran (dry applies only). No text has been judged.
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

## Results (run 2026-11-01 01:20Z – 02:40Z)

**Run.**
- **Opus**: `claude-opus-5-5` via `claude -p` on this box's subscription, the image attached. 93 calls against the 220 cap (82 items, 11 controls, 0 unparsed), 02:20Z–02:26Z, after #7875 merged at 02:19:58Z. Weekly meter 46% before and after (shared account). List-price equivalent $5.62, not billed.
- **agy**: `gemini-3.8-flash-low`, default pool, 2 at a time. 226 calls (98 face tags, 128 read and correction calls). No quota stop.
- **GPU**: one hand-queued task (`00-lp-6740-gpu`), 01:20:01–01:20:58Z. PERO made 158 of 160 block-page drafts in 56 s. The filler was paused 01:12–01:22Z. SigLIP chunk c003 yielded at its shard boundary; no filler chunk was running, so none was stopped (logged on #6871).
- **Paid API: $0.**
- **Killed reads**: two arm-2 reads ended `exit -9`. Each was retried once; one was killed again, so its outcome stands (not written).
- **Inbox**: no notes.
- **Code fix after the prereg, no change of method.** `analyze.mjs router` now also writes the export's by-script cut (#7853's `evidence/by-script/` file); without it, build.py filed the k/n evidence under a `latin-blank/unknown` row. `score.json` also gains `study_cells`, the shape the header lint reads.
- **Artifacts**: `scripts/eval/latin-paired-6740/results/` (`frame.json`, `score.json`, `router-evidence.score.json`, `router-check.json`, `writeback*.json`, `cascade-post-hoc.txt`). Texts, reads and verdicts are in `$JOB_SCRATCH/lp-6740/` (archived to R2 after 7 idle days).

### Instrument: valid for this study
- Wrong-page controls: 6/6 refused at fidelity ≤ 2 (2 per arm).
- Planted errors: 5/5 caught (kinds B, C, D, E, B).
- Noise floor: #7818's κ 0.87 (not rerun).

### The three routes (40 pages, 40 books; weighted to the queue's owed pages)

"Accept, all drawn" counts a page the route does not write as not accepted: that page stays scans-only. Defect rates are over the pages the route writes. CIs are book-cluster (= page) stratified bootstrap 95%. Severity uses MQM weights 1 / 5 / 25 per 1,000 words.

| route | writes | accept, all drawn (weighted, 95% CI) | accept, written | severity / 1,000 words (95% CI) | wrong text / 1,000 | misleads / 1,000 | wrong-text pages | fidelity | agy calls a page | $ per accepted page |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 `pero>agy-flash-low-written` (live) | 22/40 | 19/40, 0.48 (0.33–0.63) | 19/22 | 15.2 (7.6–28.4) | 0.20 (0–0.66) | 0.59 (0–1.33) | 1 | 4.32 | 0.98 | 0.00177 |
| **2 `pero>agy-flash-low@4-written`** | 23/40 | 22/40, 0.55 (0.41–0.70) | 22/23 | **9.3 (6.0–13.3)** | **0 (0–0)** | 0.56 (0–1.26) | 0 | 4.48 | **0.24** | 0.00038 |
| 3 `agy-flash-low@4-written` | 37/40 | **30/40, 0.75 (0.63–0.88)** | 30/37 | 41.9 (21.3–64.2) | 0.92 (0.23–1.72) | 2.77 (1.45–3.86) | 5 | 4.27 | 0.30 | 0.00034 |

- **Why the PERO routes write so few pages.** Of the live route's 18 unwritten pages:
  - 12 were refused by the #7695 put-back (9 a flag that is not a like-for-like substitution, 3 a flag spanning a tag);
  - 3 for letters outside the book's scripts;
  - 2 under the shared-words floor against the draft;
  - 1 with no PERO draft.
  - Arm 2's 17 refusals are of the same kinds, plus one page the corrector tagged handwritten and one killed read.
  - Read@4's 3 unwritten pages are foreign-letter refusals.
- **Three Fraktur pages** (of 40): no route had any accepted.
- **CER on CAMENA**: not available. None of the 40 books is in #6012's CAMENA manifest: an aligned page needs a stored read, and these books have none.

### Primary: severity per 1,000 words, paired against the live route (Holm over two)

| contrast | pages both wrote | difference (95% CI) | Wilcoxon p | Holm p | wrong text, live → candidate | misleads, live → candidate |
|---|---|---|---|---|---|---|
| pero@4 − live | 21 | −5.5 (−18.8 to +3.0) | 0.49 | 0.49 | 1 → 0 | 2 → 3 |
| read@4 − live | 22 | +10.2 (−9.8 to +34.7) | 0.11 | 0.21 | 1 → 2 | 3 → 8 |

**Neither is supported.** On the pages they share, the routes do not differ measurably at n = 21–22.

### Gate and decision

- **Gate** (accept, all drawn, within 5 points of live's 0.48): all three pass.
- **Accept, paired over every drawn page** (exact McNemar):
  - read@4 against live: 12 gained, 1 lost, p 0.003, +27.6 points (+12.7 to +42.7).
  - read@4 against pero@4: 9 / 1, p 0.02, +20.0 (+7.4 to +34.9).
  - pero@4 against live: 4 / 1, p 0.38, +7.5 (−2.5 to +17.8).
- **#7862's S1 rule** (in-study rates, deflated):
  - Wrong text per 1,000 words: live 0.24, pero@4 0.12, read@4 0.70.
  - Misleads per 1,000 words: 0.58, 0.55, 1.65.
  - Gate 1: read@4 fails the wrong-text gate (0.70 > 0.24 + 0.15). pero@4 passes both gates (acceptance floor P = 0.98).
  - Defects cost a page (W = 211 words): live 0.27, pero@4 0.19.
  - Price a raw page: live $0.00085, pero@4 $0.00021.
  - **Pick: `pero>agy-flash-low@4-written` at w_m = $0.001, $0.01 and $0.1 → switch.** The pick no longer moves with the misleads weight. With GPU time priced, the result is the same.
- **build.py on main** (`results/router-check.json`) with this export named in rules.json and the defect counts pooled through defect-rate.py `ADD`:
  - latin-blank/print goes from HOLD to **switch → `pero>agy-flash-low@4-written`**. The k/n fallback would pick the live route.
  - Pooled wrong text per 1,000 words, before → after:
    - live: 2.33 (22 books) → 1.98 (44 books, 0.97–3.28);
    - pero@4: 0.37 → 0.17 (39 books);
    - read@4: 0.23 → 0.68 (63 books).
  - The live route's pooled rate is still carried by the earlier depth sample's words (23,507 of 28,496).
  - **Not applied**: rules.json and defect-rate.py are unchanged in this PR.

### What the coverage gap means (post hoc, exploratory: `cascade.mjs`, chosen after seeing the write rates)

- **pero@4, then read@4 on the pages pero@4 does not write**: accept, all drawn 0.75, severity 38.8 / 1,000 words, wrong text 0.89.
- **read@4 alone**: 0.75, 41.9, 0.92.
- **On the pages both wrote**, read@4 and pero@4 carry the same wrong text (0 and 0 defects, n = 23; severity +4.5, −0.3 to +9.2, p 0.11).
- So read@4's higher rate comes from the pages the PERO put-back refuses: harder pages that the live route leaves unread today.
- The S1 rule compares rates over written pages and prices raw pages, not coverage. It therefore picks the PERO route that writes fewer, easier pages. That is the preregistered rule, and it is reported as such.

### Write-back
**31 pages written**, each through `cli-ocr.mjs apply --apply --only=<page>` from the arm's own read directory: first reads only, printed only, the GPU arms' put-back against the draft, a `page_revisions` row and provenance.
- All 31 were unread when read and when written.
- Run ids are in `results/writeback-applied.json`; undo with `scripts/maintenance/revert-run.mjs --run-id <run>`.
- The books keep their scans-only hold.
- The reason text does not match the lane sampler's regexes, so these eval pages are not sampled as lane output.
- Nothing was written on 9 pages: no route had an accepted text there.

- **arm 3, read@4 (`agy-first-read-7701`), 15 pages:** 69b6b3d296dc15d4a16dab43, 69b6be518566c838146439b6, 69b6bed98566c83814646ec0, 69b6b08d96dc15d4a16ccba6, 69b6a2fd080b19f98fd18d98, 69b6fb2d3c7947b468d79f27, 69b6f8373c7947b468d67d12, 69b6dd43f8a84d859cdd71d9, 69b6e866f8a84d859cde7619, 69b64a1318b87551bfc6289b, 69b6700eb3f4fc044159b50a, 69b64ce118b87551bfc79187, 69b638321c1c21a3738355f8, 69b66b50b3f4fc044157d49c, 69b66968b3f4fc0441570d36.
- **arm 2, pero@4 (`pero-agy4-first-read-6740`), 10 pages:** 69b68b892368e1fad321d788, 69b6b3ee96dc15d4a16dc7bc, 69b6bed48566c83814646cc4, 69b6812270c69d645a71d396, 69b69ba2080b19f98fd03251, 69b6edb73c7947b468d3b2a0, 69b6e59aa8d7b8d17a67dbfa, 69b6c5368566c838146685a5, 69b63eb81c1c21a373867fbf, 69b658b218b87551bfcf5494.
- **arm 1, live (`pero-agy-first-read-7701`), 6 pages:** 69b6a0ae080b19f98fd13fc0, 69b6b33c96dc15d4a16d90c5, 69b6e6cca8d7b8d17a683ac0, 69b6f85b3c7947b468d6900f, 69b6568d18b87551bfce12ba, 69b6390c1c1c21a37383bf84.

### Router evidence
`router-evidence.score.json` (`exportScore`) is also at `scripts/eval/estimator/router-table/evidence/latin-paired-6740.score.json`, with its by-script cut. Cell: latin-blank. Routes: the three above, each over the pages it writes.

### What this says
- **The #7862 HOLD resolves.** On the same pages, PERO 4 a call leaves no more severity than PERO 1 a call (−5.5 per 1,000 words, CI −18.8 to +3.0) and accepts as many pages or more. It does this at a quarter of the agy calls. The S1 rule picks it at every weight.
- **The live route's 2.33 wrong-text figure did not reproduce**: 0.20 per 1,000 words here (1 defect in 4,989 words, 22 pages; CI 0 to 0.66), as of 2026-11-01.
- **Coverage is the open question.** Both PERO routes leave about 45% of the queue's pages unread. They accept 0.48 (live) and 0.55 (pero@4) of all drawn pages, against read@4's 0.75. Read@4's wrong text sits on those extra pages: all 5 of its wrong-text pages are pages pero@4 did not write (4 of them neither PERO route wrote; 3 are the Fraktur pages), 0.92 per 1,000 words overall.
- **Implementing pero@4 needs code.** The armc lane has no 4-a-call mode yet: `armcRun` reads one page a call. The test drove `cli-ocr.mjs read --per-call=4` directly.
