---
stage: ocr
measure: [judged]
languages: [la, zh]
scripts: [Latn, Hani]
canons: []
n_books: 90
n_pages: 90
verdict: "The live table's tests[] ranks 1-3, 30 new books each, judged blind by Opus against the image. latin-lite/print lite>agy-flash-low+diffqa as its lane serves it: 10/30 accepted, 18/30 wrong text (the apply guards refuse 19/30 corrections, which then serve the Flash-Lite draft). latin-flash3/unknown 3flash>agy-flash-low: 22/30, 5/30 wrong text. zh-paddle-dice-lt090/manuscript paddle>agy-flash-low: the correction read 19/30 (Gemini second judge 18/30), 9/30 wrong text, but cli-ocr.mjs apply refuses all 30 (more header tags than the Paddle draft), so the lane would serve none."
status: informational
decision: "No decision moves: with this evidence the rebuild (2026-11-02-queue-eu-7263) gives the same decision in every cell as without it. latin-lite/print stays switch -> lite>agy-flash-low (#7892's defaults); the +diffqa route falls to a posterior mean of 0.41 and is out. latin-flash3/unknown and zh-paddle-dice-lt090/manuscript stay NEEDS-ENGINE."
superseded_by: null
issue: [7263]
router_evidence: [latin-lite, latin-flash3, zh-paddle-dice-lt090]
defect_rates: "none — severe defects per 1,000 words reported from the route-judge severities (misleads + wrong_text) in results/score.json; not run through defect-rate.py"
---
## 2026-11-02 · Router tests[] queue, ranks 1-3 (#7263)

PRIOR ART:
- `scripts/eval/router-confirm/confirm.mjs`: the correction runner (the fc template, a dry apply whose `--emit-written` is the served text), the read-only Mongo preload, `evidenceSources` (imported).
- `scripts/eval/route-judge-6740/judge.mjs`: the router-test frames (the zh-dice Paddle rule, the Latin OCR rule), restated here. Its draw takes the first books of a fixed salt, which are the earlier tests' books, and it cannot cut by script type.
- `scripts/eval/latin-diffqa-7591/diffqa.mjs`: the diff-QA stages, run unchanged.
- `correction-pass-7818/lib.mjs` `judgeAgy`: the second judge.

**Why.** Dispatcher note, 2026-11-01 23:46Z: run the live table's `tests[]` queue first, exactly as specified there (`current.json` → `2026-11-01-validated-7263`):

| rank | cell | route | pages |
|---|---|---|---|
| 1 | latin-lite/print | lite>agy-flash-low+diffqa | 30 |
| 2 | latin-flash3/unknown | 3flash>agy-flash-low | 30 |
| 3 | zh-paddle-dice-lt090/manuscript | paddle>agy-flash-low | 30 |

Policy note, 23:56Z: Opus is the judge only, and no Opus arm is run.

### Design (`scripts/eval/router-queue-7263/run.mjs`, seed 72631102)

- **Frames.** One interior page per book, books in a seeded order. Every book named in any evidence file the cell cites is left out.
  - **Latin cells**: visible Latin books, not held. The page has 300+ characters of stored OCR by the cell's engine (Flash-Lite, or 3 Flash), not edited, no `ocr.pipeline`.
  - **zh cell**: books the Paddle lane wrote (`paddle_zh_reocr`), with their lane holds allowed. The page has Paddle text, is not the guarded apply, has its own `qa_screen` 0.6 ≤ dice < 0.90, and 40+ Han.
  - **Script class** in the router's order (`router-next-7263/script-type.mjs`): the `<script>` tag, then `pages.script_type`, then the book's hand, else unknown.
  - Drawn: latin-lite 30 of 104 books walked; latin-flash3/unknown 30 of 389 (252 had no page of unknown script); zh 30 of 33.
- **Route, as its lane would serve it.**
  1. `cli-ocr.mjs read --correct-prompt` (fc template, gemini-3.8-flash-low, pool james), then `cli-ocr.mjs apply`, dry. A page the guards refuse serves the stored draft.
  2. **+diffqa** only: a fresh agy read, then #7591's list / spans / judge-req / judge / merge on the corrections the guards pass.
     - The span judge is gemini-3.8-flash-high. The james pool runs flash-low only, so that step ran on the default pool.
  3. **zh**: apply refused all 30 corrections ("more transcription headers than the draft"). TAKEN: the correction READ is judged, as this route's 2026-10-28 evidence was, and the lane's 0/30 is reported beside it.
- **Judge.**
  - Opus via `claude -p`, sealed, Read only, the route-judge OCR prompt, blind. All 96 transcripts show `./page.jpg` opened.
  - zh also got the second judge, Gemini 3.8 Flash-low on agy, with the same prompt (paper decision 8).
  - Controls: 2 wrong-page controls per cell, all 6 rejected (and the zh pair by Gemini too).

### Results

| cell / route | accepted [95%] | wrong text | severe / 1k words | invented / wrong-leaf pages | what the lane serves | served route in the table |
|---|---|---|---|---|---|---|
| latin-lite/print · lite>agy-flash-low+diffqa | **10/30** [0.19, 0.51] | 18/30 | 12.4 | 4 / 5 (I4 strips) | 11 diff-QA merged (7 accepted), 19 refused → lite draft (3 accepted) | lite 528/849, wrong 320 |
| latin-flash3/unknown · 3flash>agy-flash-low | **22/30** [0.56, 0.86] | 5/30 | 5.4 | 0 / 1 | 18 corrected (16 accepted), 12 refused → 3 Flash draft (6 accepted) | 3flash 13/16 |
| zh-paddle-dice-lt090/manuscript · paddle>agy-flash-low (read) | **19/30** [0.46, 0.78]; Gemini 18/30; both 13 | 9/30 (Gemini 10/30) | 11.1 | 0 / 0 | **0/30**: all refused, the Paddle draft is served | paddle 14/30, wrong 12 |

- **The refusals on latin-lite.** 12 corrections change more than 25% of the draft's words ("check by eye"), and 7 contain letters outside the book's scripts.
  - On the stored Flash-Lite drafts the guard turns away most of the pages that need correcting, so the route mostly serves the draft. That is why it scores below plain `lite>agy-flash-low` (540/646 in the table, measured on reads, not through the apply guards).
- **The zh guard.** The fc template's reply adds `<scan-quality>`, `<warning>`, `<page-type>` and `<page-num>`, which a Paddle draft never has.
  - The header-count guard reads those as a restarted or refused transcription and refuses every page. Read on its own, the correction beats Paddle (19/30 vs the table's 14/30).
  - Before this route can serve, it needs a Chinese correction template, or a guard that discounts metadata tags.
- **Leads, judge-only, not confirmed by eye.** On 5 latin-lite pages the judge tags I4 wrong text: a neighbour strip read as content.
  - In the European translation test, the same defect was confirmed by eye on `69bda0d7f6d63c919748b44a` p.849.
  - These pages are listed in `results/score.json`, `per_page`.

### Router table

- **Evidence.** `evidence/router-queue-7263.score.json` and the by-script file, wired into `rules.json` on the three routes.
- **Rebuild.** Build `2026-11-02-queue-eu-7263`. Against the same rules without this evidence, **no decision changes**:
  - latin-lite/print: switch → lite>agy-flash-low (#7892's defaults, not this run). `lite>agy-flash-low+diffqa` falls from the prior's 0.87 to a posterior mean of 0.41.
  - latin-flash3/unknown: NEEDS-ENGINE. 3flash>agy-flash-low is now 26/34, mean 0.77.
  - zh-paddle-dice-lt090/manuscript: NEEDS-ENGINE. paddle>agy-flash-low is now 34/59, mean 0.57.

### Cost

- agy: 90 corrections + 30 fresh reads (james pool), plus 6 flash-high span-judge calls (default pool), plus 32 Gemini judge calls.
- Opus: 96 judge calls on the box account's subscription.
- No paid API.

Artifacts: `scripts/eval/router-queue-7263/` (`run.mjs`, `results/score.json` with per-page verdicts). Reads, diff-QA files, images and transcripts are in the job's scratch directory.
