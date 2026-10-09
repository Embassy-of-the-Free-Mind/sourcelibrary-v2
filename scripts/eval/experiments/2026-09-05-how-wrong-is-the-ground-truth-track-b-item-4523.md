---
stage: ocr
measure: accuracy
languages: [grc, de, la]
scripts: [Grek, Latn]
canons: []
n_books: null
n_pages: 69
verdict: "Reference error is 0.07% Greek, 0.06% German, 1.15% Latin; Latin engine gaps sit inside it, and our own reference cleaner cost Greek 6.0% of letters."
status: informational
decision: null
superseded_by: null
issue: 4523
---
## 2026-09-05 — How wrong is the ground truth? (Track B item 1, #4523)

- **Question.** Every engine accuracy we quote is `1 − CER(reference, output)`. At 98–99%
  the residual is a few characters per page. If the reference is wrong at the same rate,
  the engine ranking is inside our own noise and nothing downstream is quotable.
- **Design.** No hand transcription — and deliberately no VLM re-transcription, which
  would referee a bench about VLMs with the system under test. Wikisource pages carry
  their own second opinion: `level 3` = one human transcribed it, `level 4` = a second,
  different human re-read it against the scan. `reference-error-rate.mjs` replays each
  page's revision history and measures what the validator changed, through the same
  `normalizeForScript` folding the bench scores through, so the number is on the bench's
  own scale. Restricted to independent validators and to pages whose predecessor was
  genuinely level 3 (a level-1 predecessor is raw OCR and prices the whole proofreading
  pass — one such page carried 10.9% into a 1.1% Latin sample).
- **Result — the reference is NOT the constraint for Greek, and IS for Latin.**
  n=69 pages (pinned set + a matched level-4 harvest per wiki), median 0.00%, 39 exact.

  | | level-3 reference error (A) | level-4 residual (B) | reported engine gap |
  |---|---|---|---|
  | Greek (n=18) | **0.07%** CI [0.02, 0.13] | 0.00% (5/5 exact) | 1.5pp |
  | German (n=15) | **0.06%** CI [0.02, 0.11] | 0.01% | — |
  | Latin (n=36) | **1.15%** CI [0.15, 2.78] | 0.48% | 1.4pp |

  (CI recomputed 2026-09-30, #5373 — Latin was [0.17, 2.47]; Greek and German came out the same.)

  Greek and German engine differences are 20x the reference noise and stand. **The Latin
  comparison does not** — the reference error and the reported Kraken-vs-Gemini gap are the
  same size, which is the arithmetic behind "Latin is a tie". Latin's distribution is
  skewed, not uniformly bad: most references are exact and a handful omit a whole printed
  block (an apparatus criticus, a clause), so the median is 0 and the mean is 1.15%.
- **The bigger error was OURS.** Instrument C compares the two cleaners: the pre-fix
  `cleanPageText` deleted a formatting template together with the text it wrapped —
  `{{SperrSchrift|D’Glocke het zwölfi gschlage.}}` is a printed line, not scaffolding.
  Measured **6.0% of Greek reference letters, 3.8% of Latin, 0.9% of German**, single pages
  losing 40–100%. That is 5–80x the human reference error. Worse, deeply nested apparatus
  markup survived as literal braces: the Poemander reference was 1,178 characters of
  `{{κσχασ|εδάφιο=1|σημείωση=μου] μεν A, om Turn. Fluss.}}` soup where the page prints 383
  characters of Greek.
- **Consequence, measured on stored outputs (no re-runs, no cost).** Re-scoring the
  Gemini-lite arm against the corrected references: Greek conditional accuracy **97.8% →
  99.6%** on coverage 92% → 88%; Latin 96.3% → 96.0%; German unchanged. The single page
  that drove it went **59.7% → 100.0%** — a perfect transcription charged 40 points for our
  markup. Coverage fell because a table-of-contents page that the corrupted reference let
  through now fails the guard honestly. **The Greek correction (1.8pp) is larger than the
  Greek engine gap it was used to judge (1.5pp), so the Bench 2 Greek result must be
  recomputed for every arm before it is quoted again** — the Kraken ws outputs live in
  PR #4651 and were not available to re-score here.
- **What the instrument cannot see:** errors both readers share, and the 79/149 pages
  nobody validated. Pages volunteers chose to validate are the well-loved ones, so this is
  a lower bound.
- **Artifacts.** `scripts/eval/reference-error-rate.mjs`,
  `scripts/eval/refresh-ws-references.mjs`, `results/reference-error-2026-09-05.json`,
  8 new unit tests in `tests/unit/wikisource-text.test.ts`.
