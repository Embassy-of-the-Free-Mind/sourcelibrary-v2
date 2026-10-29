---
stage: ocr
measure: [judged]
languages: [la, de]
scripts: [Latn]
canons: []
n_books: 45
n_pages: 45
verdict: "Opus through agy (claude-opus-5-5-low) matches Opus through claude -p on Latin Flash-Lite correction: 15/15 against 15/15 accepted, 0 wrong text on either, same pages (P = 0.915 under the router's 0.08 margin). On German translation it reads as well (23 of the 26 pages both routes answered, against 22), but 4/30 replies put the prompt's summary and keywords after <<<END>>>, which the writer refuses. Counted as the lane would count them, that is 23/30 against 26/30 (P = 0.45), so German does not pass yet. The Claude group of one agy account holds about 235 Latin corrections or about 870 German translations a week, down to the 10% floor."
status: adopted
decision: "lite>agy-opus is a fallback route for the latin-lite cell, used only when the account's Gemini weekly bucket reads 0 (agyClaudeGate, PR #7592). agy-opus-tr is not adopted until the marker failure is fixed and re-tested. Tibetan translation was not tested. The gate itself is PR #7592, still open on 2026-10-29 (land-evals): until it merges no lane takes this fallback."
superseded_by: null
issue: [7545, 6740]
router_evidence: [latin-lite, german-tr-flash3, german-tr-lite]
---
## 2026-10-28 · Is Opus through agy as good as Opus through claude -p on the cells routed to Opus? (#7545)
<!-- PRIOR ART: scripts/eval/route-judge-6740/judge.mjs (the router tests' instrument, reused unchanged except for two cells: latin-lite-7545 and german-7545); 2026-10-26 router tests (lite>opus-correct 30/30 on the Latin pilot; German opus-cli 49/60). Nothing before this run had measured Claude through agy: it was refused by assertGeminiModel until #7545. -->

**Latin correction: yes. German translation: not yet, because of a format failure rather than a reading failure.**

### Design
- **The exception.** Derek's rule (2026-10-27, restated 2026-10-28) allows Claude through agy only on an account whose Gemini weekly bucket reads 0. This test is the one exception, and it ran while Gemini quota remained. It used gex45's default login (dereklomas@, Gemini weekly 41%, Claude group 100%) on Derek's inbox note (09:21Z). The second login (`/root/.agy-james`) is held to `gemini-3.8-flash-low` and was not used. To open the gate in-process, the run pointed `AGY_QUOTA_CACHE` at a scratch reading with the Gemini weekly bucket set to 0. Nothing on any shared path was changed.
- **Pages.** Drawn with `judge.mjs draw --cells=latin-lite-7545,german-7545`, seeded, one page per book, visible books, interior pages.
  - **Latin, 15 pages.** Stored Flash-Lite OCR of at least 300 characters, books not held (the router-test frame, salt `rt-latin-lite-7545`).
  - **German, 30 pages.** Visible German books from 1500 to 1800 whose served English is 3 Flash or Flash-Lite and newer than the OCR, alternating between the two (salt `agy-opus-7545`, the pilot's 60 books left out). The cell was drawn at 15 pages and then extended to 30, because at n = 15 even 15/15 against 15/15 gives P = 0.87 under a flat prior. The first 15 pages are the same in both draws.
- **Routes.** Each pair ran on the same pages, with `CANDIDATE_READS=off` and `--fresh`. Nothing was kept or written.
  - Latin `lite>opus-correct`: `correct.mjs --model=opus` through `claude -p`, one page per call.
  - Latin `lite>agy-opus`: `cli-ocr.mjs read --correct-prompt` (the correction lane's own call and fc template) with `--model=claude-opus-5-5-low`. All 15 calls opened the image with `read_file`.
  - German `opus-cli`: `claude-translate.mjs read --model=opus --per-call=1`.
  - German `agy-opus-tr`: `cli-translate.mjs read --model=claude-opus-5-5-low`.
- **Judge.** `judge.mjs judge`: Opus through `claude -p`, blind, one output per call, the page image attached, two wrong-page controls per route. Every control passed.

### Result (`results/agy-opus-7545-2026-10-28/score.json`)
| cell | route | accepted | wrong text | fidelity |
|---|---|---|---|---|
| Latin lite | lite (the draft) | 8/15 | 7/15 | 3.53 |
| Latin lite | lite>opus-correct (claude -p) | **15/15** | 0/15 | 4.93 |
| Latin lite | lite>agy-opus | **15/15** | 0/15 | 4.73 |
| German tr | opus-cli (claude -p) | 26/30 | 3/30 | 4.10 |
| German tr | agy-opus-tr | 23/26 (+4 not written) | 2/26 | 4.12 |

- **Paired by page.** Latin: both routes accepted all 15 pages. agy answered UNCHANGED on 2 pages and claude -p on 1. German: both accepted 21 pages and both rejected 2. claude -p alone was accepted on 1 page, agy alone on 2. The remaining 4 were the agy marker failures, all of which claude -p got accepted.
- **The marker failure.** On 4/30 German pages, agy-Opus wrote the translation inside `<<<BEGIN>>>`/`<<<END>>>` and then the prompt's `<summary>` and `<keywords>` blocks after `<<<END>>>`. `unwrapRead` calls that "text outside the markers", and `cli-translate.mjs apply` refuses it. The translation inside the markers is complete. Fixing the call (a prompt line, or accepting a trailing summary/keywords block) and re-testing would likely clear the cell. That is a change to the writer's guard and is not made here.
- **The router's gate** (rules.json as of PR #7588: P(acc ≥ acc_ref − 0.08) ≥ 0.9, wrong text at most the reference rate + 4%):
  - Latin: P = **0.915** under the route prior Beta(3.22, 0.78), which `lite>opus` uses and the same model inherits; 0.873 under a flat prior. Wrong text 0 against 0. **Passes.**
  - German: 23/30 against 26/30 as the lane would count it, P = **0.45**. On the judged outputs alone (23/26), P = 0.85; against the pooled opus-cli record (75/90), P = 0.92. **Does not pass** until the 4 marker failures are fixed.

### Draw on the agy Claude group (`quota-readings.jsonl`, `agy-usage.json`)
Readings of `agy -p "/quota"` (free) on the main account, taken before and after each run. Nothing else on that account calls Claude models.

| run | pages | weekly bucket | 5-hour bucket |
|---|---|---|---|
| 15 Latin corrections + 15 German translations | 30 | 99.93% → 92.68% | 100% → 85.51% |
| 15 German translations alone | 15 | 92.08% → 90.52% | 85.30% → 81.18% |

- **Per page.** German translation: 0.104% of the week and 0.27% of the 5-hour bucket. Latin correction, by difference: about 0.38% of the week and 0.69% of the 5-hour bucket. The weekly bucket also fell 0.6% between the runs with no calls, which is probably late accounting; with it, Latin is about 0.42%.
- **Tokens.** Latin median input is 25.6K (15.5K of it cache read: agy's system prompt plus the fc template and the image). German median input is 11.0K. The median call took 19 s for Latin and 11 s for German.
- **What that buys.** With the fallback stopping at the 10% floor, one account's Claude group holds about 235 Latin corrections, or about 870 German translations, per week. The 5-hour bucket allows about 130 Latin pages per window. This is a small pool next to the claude -p subscription: `correct.mjs` at 10 pages a call draws about 0.004% of a week per page.

### Replicated?
No. One draw per cell. The Latin result agrees with the 2026-10-26 pilot, where `lite>opus-correct` accepted 30/30.

### Artifact
`scripts/eval/route-judge-6740/results/agy-opus-7545-2026-10-28/`: sample, key, score, verdicts, per-page agy usage and the /quota readings. The reads themselves stayed on gex45 under `$JOB_SCRATCH`. The router's entries are the `fallback_routes` of the `latin-lite`, `german-tr-flash3` and `german-tr-lite` cells in `scripts/eval/estimator/router-table/rules.json`.
