---
stage: ocr
measure: judged
languages: [he]
scripts: [Hebr]
canons: []
n_books: 44
n_pages: 44
verdict: "Hebrew manuscripts (hebrew-flash3/manuscript): the stored 3 Flash text is accepted on 0/44 pages and invented on 36/44; the agy correction does not fix it (0/41). Both Opus arms are much better by the Opus judge (fresh read 20/44, correction 13/29), but the Gemini second judge accepts only 9/44 and 10/28, far short of the 39/44 hold bar. The cell stays HOLD."
status: rejected
decision: "No route moved: build.py keeps hebrew-flash3/manuscript on HOLD (the hard floor blocks 3flash, 3flash>opus and 3flash>agy-flash-low; opus-read fails the judge gate on the Gemini second judge). Evidence and second_judges rows added to rules.json. 11 judged pages were written (the best read that cleared every check), and 35 pages whose stored text the judge found invented were contained (35 books held). v2#8632."
feeds: "route"
supersedes: []
superseded_by: null
issue: [8632]
router_evidence: ["hebrew-flash3"]
defect_rates: "scripts/eval/route-judge-6740/results/hebrew-mss-cell-8632/defect-rates.json"
---
PRIOR ART: `2026-10-28-router-tests-agy-flash-low-gpu-draft-7263.md`, the only earlier judged test of this cell (n = 4 a route: stored 3 Flash 0/4, 3 Flash corrected by agy 0/3). `2026-11-13` latin-flash3 live-route test (results `latin-flash3-live-route-8632`, commit af816fd6d) is the template.

## 2026-11-13 · Does any route on the menu read Hebrew manuscripts well enough to repair the `fix` books? (#8632)

**Why.** fix-feed-8255 found 49 `fix` books (Hebrew, Armenian, Japanese, Korean) with no repair route. Hebrew manuscript is the largest cell, with 14.6K pages waiting and evidence of only n = 3–4 a route. Derek approved an Opus route test on 2026-11-13. The pre-registration was posted before any model call: v2#8632 comment 6853369726.

**Design.** One page per book over every book in the frame with an eligible page: visible Hebrew books, not held, stored OCR by `gemini-3-flash-preview`, interior, 300 or more characters, manuscript under the router's own script rule. That gives 44 pages from 44 books; n cannot be raised without breaking one page per book. Four arms on the same pages:
- `3flash`: the stored text (baseline).
- `3flash>opus-correct`: `correct.mjs`, the cell's live route `3flash>opus`.
- `opus-read`: `claude-ocr.mjs --reread`, one page a call, stage `opus-img@1`.
- `3flash>agy-flash-low`: agy 3.8 Flash-low correcting the stored text.

The judge was Opus through `claude -p`: blind, one output a call, the image open. There were 2 wrong-page controls an arm and 8 repeats; `paired-arm.mjs check` passed R1–R5 before the first judge call. On manuscripts the Opus judge fails its self-preference check (rules.json `judge_validity`, DBG 0.43), so Gemini 3.8 Flash-low through agy (the same judgePrompt and image) judged both Opus arms with their controls and repeats. The floor was invented or wrong-leaf text (O1, O2, I1, I2, I6, T14): 3 or more such pages of 44 block an arm.

**Opus judge** (`paired-score.json`):

| arm | accept | by-book 95% | wrong text | invented / wrong-leaf pages | fidelity | misleads / 1k words | control |
|---|---|---|---|---|---|---|---|
| 3flash (stored) | 0/44 | 0–0 | 44/44 | 36/44 | 1.82 | 8.64 | pass |
| 3flash>opus-correct | 13/29 | 0.28–0.62 | 13/29 | 2 | 3.34 | 5.15 | pass |
| opus-read | 20/44 | 0.32–0.59 | 16/44 | 2 | 3.20 | 5.31 | pass |
| 3flash>agy-flash-low | 0/41 | 0–0 | 41/41 | 32/41 | 1.95 | 7.58 | pass |

- `3flash>opus-correct` answered CONTAIN on 15 of 44 pages: it judged the stored text invented and wrote nothing. As the lane would serve the cell, that is **13/44**, because the stored text stays on those 15 pages.
- Against the stored text on shared pages: opus-read better on 36/44 and worse on 1, accepts +20; the correction better on 23/29 and worse on 0, accepts +13; agy better on 6/41 and worse on 3, accepts +0.
- Noise floor: 0 of 8 repeat pairs flip accept.

**Gemini second judge** (the Opus arms only):

| arm | accept | by-book 95% | wrong text | fidelity | control |
|---|---|---|---|---|---|
| 3flash>opus-correct | 10/28 | 0.18–0.54 | 18/28 | 3.29 | pass |
| opus-read | 9/44 | 0.09–0.34 | 35/44 | 2.66 | pass |

- Noise floor: 1 of 4 repeat pairs flips accept.
- 1 item came back unparsed and is not counted.
- The two judges disagree a lot. Gemini rejects 12 of the 20 opus-read pages the Opus judge accepts. That is the self-preference gap the calibration predicted, or Gemini Flash-low being a weaker Hebrew-cursive reader, or both; this run cannot tell which.

**Decision, by the table's own rule.** `build.py` with this evidence: **HOLD (hard floor: no rated route clears it)**.
- agy first: `3flash>agy-flash-low` fails the floor (32 invented pages of 41).
- An Opus route needs the second judge to clear P(acc ≥ 0.8) ≥ 0.9, which is 39/44. Gemini gave 9/44 and 10/28.
- No route moves. `bound_route` stays undecided ("no live route or agy route may run").

**What was written (brief step 4).** 11 judged pages, 6 from the correction and 5 from opus-read. Each cleared the floor, was accepted by the Opus judge with no invented or wrong-leaf defect and a fidelity above the stored text's, and was not rejected by Gemini.
- They were written through `cli-ocr.mjs apply`, all guards on, with by-eye rows from the judge, under runs `hebrew-mss-cell-8632-opusread-ocr` and `hebrew-mss-cell-8632-opuscorrect-ocr`.
- The before-snapshot was committed first (`before-snapshot.json`, `step4-selection.json`). Undo: `revert-run.mjs --run-id <run>`.

**Containment.** On 35 of the sampled pages the Opus judge found the stored 3 Flash text invented or in the wrong script (for example a Syriac Serto text over a Hebrew cursive draft, and Spanish words on a leaf with only show-through).
- Held: those 35 books, reason `hebrew-mss-invented-8632`, released by issue 8632.
- Withheld: the English on those 35 pages only (`--by-eye-pages`).
- Labelled `contained` on v2#8632.

At 36/44 the stored text of this cell is probably wrong on most of its 14.4K pages. Withholding the rest is a cell-wide decision, raised on the issue.

### Replicated?

A second judge family, yes. It disagrees with the Opus judge on the Opus arms and holds the cell. The agy and stored-text arms were not judged by Gemini: they already fail the floor on the Opus judge, and that judge is valid on Gemini-written text. No held-out draw: the frame is exhausted at one page a book.
