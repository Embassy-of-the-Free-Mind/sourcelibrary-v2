# Calibration set for page severity — DESIGN (not run)

PRIOR ART: `.claude/skills/paired-arm-judge/SKILL.md` (blind judge, wrong-page controls, noise floor; that compares two
ARMS on one page, this compares two READERS on one text); `scripts/eval/lib/plant-ocr-errors` (planted positives for a
screen); `scripts/audit/convergent-audit-weekly.mjs` (the two-family weekly read whose Gemini half never ran). None gives
what the 2026-11-12 tests found missing: an independent second reading of the **same text** under **one rubric**.
Status: design, 2026-11-12. Every step that spends or takes Derek's time is a DECISION line at the end.

## What it must settle

1. **The ceiling.** How often two independent readers (two model families, and a person where one can read the language)
   agree on a critical span and on the page band, on identical text. Today this number does not exist: the only "agreement"
   figure (46%) compared lane B's sign-off on its own repairs with an audit of later text.
2. **Sensitivity and specificity.** How many planted criticals each reader finds; how many clean and wrong-page controls
   it passes. These need no human.
3. **Whether the rubric helps.** Agreement under `SEVERITY-RUBRIC-PROPOSAL.md` against agreement under the current brief.
4. **What the predictor is worth.** Its AUC against each reader's critical target, set against the ceiling from 1.

## The pages (120, one per book, text frozen by hash)

| block | pages | languages | why |
|---|---|---|---|
| A, human-checkable | 72 | Latin 24, German 16, French 16, Italian 16 | Derek can verify spans in these; enough per language for a page-level κ with a usable interval |
| B, model-only | 32 | Greek, Chinese, Arabic, Hebrew (8 each) | the scripts where errors concentrate; two families, no human |
| C, planted | 10 | from block A languages | a clean page copied with one critical planted: a name changed, a negation dropped, a number changed, a line dropped, a sentence from the facing leaf. Known answer |
| D, controls | 6 | mixed | 3 wrong-page (image of n, text of n+1), 3 typed e-text pages (known clean) |

Within A and B: half drawn uniformly from the weekly audit's frame, half from the risk score's top decile, so the set holds
enough criticals to measure agreement on them. Printed and handwritten both, recorded. Each page's `text_sha` and image hash
are frozen in `key.json`; a page whose text changes before every reader is done is dropped, not re-read.

## The readers

| reader | how | pages |
|---|---|---|
| Opus | fresh sealed `claude -p`, rubric brief, image first, spans + band | all 120, plus a re-read of 30 |
| Gemini 3.8 Flash high | agy, same brief, one page a call, tool log must show the image opened | all 120, plus a re-read of 30 |
| Opus, current brief | the #6338 brief unchanged | the 72 of block A (rubric vs no rubric) |
| Derek | sees the scan, both panes, and the **union of both models' spans** (prefilled, unlabelled by source); accepts, rejects or edits each, adds what is missing, gives the band | block A, or a 36-page half of it |

Prefilled spans are the ESA-AI design: reviewers verify instead of reading cold, which roughly doubled agreement in the
published study and cuts the time per page. The models' spans are shown without saying which model wrote them.

## What is computed

- Page band and critical-yes/no: Cohen's κ for Opus–Gemini, Opus–Derek, Gemini–Derek, Opus–Opus (re-read), Gemini–Gemini.
- Span level: overlap F1 between readers for critical spans (a span matches when the quotes overlap by ≥ 50%).
- Planted: recall per reader; controls: pass rate per reader.
- Rubric effect: Opus-rubric vs Opus-current-brief agreement with Derek on block A.
- The ceiling for the predictor: the reader–reader κ and balanced accuracy on critical-yes/no. The predictor's AUC against
  each reader is reported next to it, not alone.
- All rates by book, one page per book, Wilson 95% intervals (`.claude/docs/quality-statements.md`).

## What it costs

| item | amount | money |
|---|---|---|
| Opus | about 250 page reads on the subscription | none beyond the subscription |
| Gemini | about 150 agy calls | Ultra plan, no API spend |
| Derek | about 3 minutes a page with prefilled spans: 72 pages ≈ 3.5 h, 36 pages ≈ 1 h 50 | his time |
| Planting and drawing | scripts only | none |

## DECISIONS (defaults in brackets)

1. **Run the Gemini half** [yes: 150 agy calls on the Ultra plan, no API].
2. **Derek's time** [36 pages of block A, about two hours, in one sitting; the other 36 stay model-only].
3. **Adopt the rubric in the weekly audit brief** [no, not until the calibration set shows it raises agreement].
4. **Retarget the predictor** to transcription-criticals and English-criticals as separate scores [yes once the set exists;
   meanwhile the OCR-serious target is the one to aim audits with, because it is the one the text predicts].
