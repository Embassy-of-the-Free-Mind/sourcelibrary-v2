---
stage: ocr
measure: [judged, accuracy]
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 60
n_pages: 60
verdict: "On a random sample of 60 Siku Quanshu pages that PaddleOCR wrote, no page is unusable and none carries invented text. 51% are clean, 27% have minor errors and 22% have material errors (Opus and Gemini 3.8 reviewers, with Opus adjudicating where they disagree). Opus transcribing from the image cannot be told apart from Paddle against Kanripo; Gemini 3.8 Flash is 4 points worse."
status: informational
decision: null
superseded_by: null
issue: [6388, 5600, 5660, 5547]
---
## 2026-10-10 · PaddleOCR Chinese lane, random-sample QA by Opus and Gemini on the subscriptions (#6388)

PRIOR ART: `2026-10-01-chinese-ocr-cohort-5547.md` (the 540-page Kanripo benchmark before the run: catastrophic
pages lite 10.6%, flash-preview 3.7%, Paddle 0.9%), `2026-10-02-paddle-zh-serving-config-5600.md` (the lane),
`2026-10-10-ocr-prereg-routing-6388.md` (the seeded one-page-per-work draw and the CLI readers reused here), and
`ground-truth-5935/kanripo.mjs` (the Kanripo leaf rule). None of them had a random sample of what the lane actually
wrote reviewed against the page image. Data, code and the draw: `scripts/eval/paddle-zh-qa-6388/` (README has the
rules and two amendments, both committed before the arms they changed ran). Every number below is from
`results.md` / `results.json` (`score.mjs`).

**Sample.** 60 books, one interior page each, seed 6388, drawn at 2026-10-10T17:26Z and committed before any
reviewer ran. 50 come from all 10,201 books the lane had written (#5600: 7,006; #5660: 3,195; job
paddle-skqs-rest-6388 had written none yet). 10 come from the 53 books whose English the lane marked stale. Every
book is a Wenyuange Siku Quanshu volume.

**Reviewers.** All ran on subscriptions, at $0. Each review ran in its own fresh CLI process: one page per call, no
shared session, no `--resume`.
- R1: Opus (`claude -p`).
- R2: Gemini 3.8 Flash High (`agy -p`).
- R3: Gemini 3.1 Pro High (`agy -p`).

Each saw the page image and the stored Paddle text, and listed every invented, omitted, misread and out-of-order
span. The 75 requests went out in a blind, shuffled packet: the 60 pages, 10 planted-error copies and 5
byte-identical repeats. Where R1 and R2 gave different verdicts, a third read was made by Opus at high effort, with
the image and both lists labelled only "reviewer A/B".

### Verdicts on what the lane wrote (by book, Wilson 95% CI)

| Sample | n | clean | minor (≤ ~1% chars) | material | unusable |
|---|---:|---|---|---|---|
| Random, all written books | 49 | 27 (55%; 41–68%) | 14 (29%; 18–42%) | 8 (16%; 9–29%) | 0 (0–7%) |
| Books with English marked stale | 10 | 3 (30%) | 2 (20%) | 5 (50%; 24–76%) | 0 |
| All 60 | 59 | 30 (51%; 38–63%) | 16 (27%; 17–40%) | 13 (22%; 13–34%) | **0 (0–6.1%)** |

One random page has no final verdict, because R2's call failed twice and the job had used its 450-call `agy` cap.

**Invented text.** Four pages have any invented span in the final list. All of them are one or two characters, or a
stray markup token (`1.1`). None has an invented span of 4 or more Han characters (0/59, 0–6.1%).

**Containment.** Nothing was contained. The one "unusable" verdict came from R2: it said Paddle had appended 147
characters from the next page. Kanripo refutes this. The stored text is 325 characters against the leaf's 320, with
Dice 0.97 and CER 2.8%. R1, R3 and the adjudicator all called that page minor.

**Against #5547.** Unusable is 0/60 (95% CI 0–6.0%), which agrees with #5547's 0.9% catastrophic rate for Paddle. A
sample of 60 cannot tell 0.9% from 0%.

### Do the reviewers measure anything? Controls and Kanripo

| Reviewer | planted spans caught | trusted | repeats: same verdict | median s per call | median in / out tokens |
|---|---|---|---|---|---|
| R1 Opus | 30 / 30 | yes | 5/5 | 14 | not logged (rows written before token logging) |
| R2 Gemini 3.8 Flash High | 30 / 30 | yes | 5/5 | 95 (2 calls a row: nudged on 84 of 86) | `agy` reports no tokens |
| R3 Gemini 3.1 Pro High | 19 / 21 run | not established: 9 spans not run | 1/3 | 129 | — |
| Adjudicator, Opus high | — | — | — | 15 | 39.6K / 0.8K |

- **Planted controls.** 10 copies of clean pages, each with 3 spans planted: a 6-character insertion, a
  6-character deletion and a 4-character substitution.
- **Why R3 is short.** R3 was stopped at 50 of 75 requests so that R2 and the cross-reviews could finish inside the
  450-call `agy` cap.
- **Agreement on the 4-level verdict.**
  - R1 vs R2: 31/59 exact, quadratic-weighted κ 0.45. They agree on "material or worse" for 47 of 59 pages.
  - R2 vs R3: κ 0.19, n = 37.
  - R1 vs R3: κ 0.26, n = 38.
  - The Gemini reviewers are much harsher. R2 called 22% of pages clean and R3 3%; R1 called 63% clean.
- **Adjudication.** 28 pages went to a third read. It sided with R1 on 20, with R2 on 5, and with neither on 3. The
  adjudicator is Opus, the same family as R1, so the final verdicts lean towards Opus's leniency. The Kanripo check
  below is the outside test of that.
- **Kanripo** (56 aligned pages). Median CER is 2.9% for pages called clean, 2.3% for minor and 11.5% for material.
  Spearman ρ between verdict and CER is 0.54. No page called material had CER ≤ 5%. Seven pages with CER > 5% were
  called clean or minor; Kanripo's edition differences account for at least some of these.

### Transcription from the image: Opus and Gemini 3.8 against Paddle (same 60 pages)

| Engine | Kanripo mean body CER (57 pages; 95% CI) | − Paddle (paired CI) | errors found by the OTHER family's reviewer | refusals / loops | median s per page |
|---|---|---|---|---|---|
| Paddle (stored) | 5.37% (4.03–6.90) | — | Opus: 1.50%; Gemini: 5.03% | 0 / 0 | GPU batch, ≈ €0.0007/page (#5547) |
| Opus (`claude -p`, live OCR prompt v19.1) | 6.17% (3.78–10.04) | +0.80 pts (−1.70 to +4.72): **cannot be told apart** | Gemini: 1.45% (Paddle by the same reviewer: 5.03%) | 0 / 1 | 20 |
| Gemini 3.8 Flash Low (`agy -p`) | 9.36% (6.74–12.35) | **+3.99 pts (+2.17 to +5.97): worse** | Opus: 3.61% (Paddle by the same reviewer: 1.50%) | 0 / 0 | 34 (33 of 60 nudged) |

- **Family rule.** No family reviews its own text, so Opus's transcription is scored only by Gemini, and Gemini's
  only by Opus.
- **The Gemini reviewer prefers Opus's text to Paddle's:** −3.65 pts (95% CI −7.39 to −1.28). About 0.85 pts of
  Paddle's 5.03% under that reviewer is the refuted 147-character claim above.
- **The Opus reviewer finds Gemini 3.8's text worse than Paddle's:** +2.11 pts (95% CI +0.95 to +3.38). Opus also
  found 14 column-order errors in Gemini's text, against 6 in Paddle's.
- **Column order.** On one page, a rhyme dictionary with interlinear notes, Opus reads in a different order from
  Kanripo. It scores CER 0.95 at every batch size, yet the Gemini reviewer finds only one omitted character there.

**Verdict on transcription.** Neither CLI model beats Paddle against the outside text. Opus cannot be told apart from
it, and Gemini 3.8 Flash is clearly worse. Cost at scale, for the 93,775 pages the current Siku run is reading:
- **Paddle:** about €66 of rented GPU.
- **Opus on the subscription:** about 9,400 ten-page calls, at about 19 s per page. One stream would take about 3
  weeks, and the subscription's rate limits are unknown at that volume. The CLI's own API-price figure is about $0.19
  per page at one page per call (6 calls logged) and $0.063 per page at ten, so roughly $6K–18K if it were ever paid.

### Context arm: how much each CLI call does

The same 10 Kanripo-aligned pages were transcribed with the same live OCR prompt. One-page cells are the transcription
rows above. Multi-page calls returned per-page text between `===== PAGE n =====` lines.

| Engine | pages per call | calls | mean CER | median CER | omitted pages | page mix-ups | loops | wall s per page | input tokens per call |
|---|---|---|---|---|---|---|---|---|---|
| Opus | 1 | 10 | 14.7% | 4.2% | 0 | 0 | 0 | 32 | ≈ 46K |
| Opus | 5 | 2 | 13.6% | 3.2% | 0 | 0 | 0 | 22 | ≈ 51K |
| Opus | 10 | 1 | 14.1% | 3.4% | 0 | 0 | 0 | 19 | ≈ 56K |
| Gemini 3.8 Flash Low | 1 | 10 | 12.1% | 8.0% | 0 | 0 | 0 | 35 | not reported |
| Gemini 3.8 Flash Low | 5 | 2 | **21.6%** | 7.6% | 0 | 0 | 0 | 4 | not reported |
| Gemini 3.8 Flash Low | 10 | — | skipped by the gate | | | | | | |

- **Opus does not degrade up to 10 pages per call.** Most of its input is the CLI's own fixed context (≈ 39K tokens
  even for a one-image review), so batching cuts tokens per page from about 46K to 5.6K and wall time per page by 40%.
  The mean is driven by the column-order page above (CER 0.94–0.95 at every k).
- **Gemini 3.8 degrades at 5 pages per call.**
  - One page's text matched none of the 5 pages' Kanripo windows (CER 1.0 against all of them), so it is text from
    no page in the call.
  - A second page went from CER 0.29 to 0.56.
  - It answered 5 pages in about 18 s.
  - By the gated rule, k = 10 was not run. For Gemini on the CLI, keep one page per call.

### Calls and spend

- **Opus:** 226 calls (cap 450).
- **agy:** 450 calls (cap 450), counting the stopped first two jobs' calls in the agent log; 446 are in the rows.
- **Chatter or plan-mode replies** (`cliChatterReason`, #6361): 0 in every arm.
- **Unparseable reviews:** 0.
- **Spend:** $0 on the API, and no Gemini API call.
- **Writes:** nothing was written to `pages` or `books`.

**Not done.**
- No human key. The verdicts are model-adjudicated and leaned on Opus.
- R3's controls are incomplete (above).
- One random page has no R2 verdict.
- The 17 non-Siku Chinese manuscripts are outside this frame (#5574).
