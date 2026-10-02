# Pre-registration: OCR prompt v19 (v18 + show-through + context rule) — confirmatory run

PRIOR ART: scripts/eval/ocr-v18-ab.mjs (#4195, the runner this extends: production Batch request, strata, scoring, A/A floor); scripts/eval/PREREGISTRATION-ocr-v18-blank-insert.md and RESULTS-ocr-v18-blank-insert.md (the run this follows up). Extend that runner, do not write a parallel one.

Written 2026-10-02, **before any v19 call**. Issue #4195. Derek approved the confirmatory run in session ocr-prompt-v17.

## Why
The v18 result was **not established**:
- v18 fixed clean white leaves (5 pages: v16 invented a whole page, v18 said blank on 3/3 runs).
- It fixed nothing on show-through leaves. Both prompts "read" the mirror-reversed facing page.
- The test had little signal. Today's Flash-Lite invents on only ~15 of the 40 #4149 pages, and the S2 "blank" labels came from an old OCR claim; 5 of the 6 disputed pages carry real ink by eye.

One more observation. On a white leaf of a Clement volume, both prompts invented a Clement running header and Clement-flavoured Greek on 9/9 runs. The production request appends **Document context** (title, author, year), so the model may be writing from the book's identity rather than the image.

## Arms (same production Batch request as v18's runner; only the prompt differs)
| arm | prompt |
|---|---|
| `A`  | v16 (DB row, hash `0203c264…`) |
| `A2` | v16 again, an independent Batch job (the noise floor) |
| `B`  | v18 candidate (`prompts/ocr/standard-ocr-v18-candidate.md`) |
| `C`  | **v19 candidate** (`prompts/ocr/standard-ocr-v19-candidate.md`): v18 plus a **Show-through** section and a **Document context is not a source** section |

k = 3 per (page, arm). The unit is the page. The model is `gemini-3.1-flash-lite`, via Batch.

## Step 1: screen (outcome-blind selection, results never reused)
- Pool: the 409 `FABRICATED` rows of the #4149 file, plus the 38 v0.4 `blank_page` rows, minus Tibetan and Syriac books.
- Run **v16 once** per pool page as its own Batch job, labelled `screen`. A page **qualifies** if the screen run has more than 20 body letters.
- The screen runs are **not** used in any outcome. All four arms are run fresh afterwards, which avoids regression-to-the-mean from selecting on a noisy first read.

## Step 2: label by eye (before any arm runs, blind to arm output)
Open each image, both the qualifying pages and all 38 v0.4 `blank_page` pages, and label it as one of:
- **white**: no marks at all;
- **show-through**: only mirror-reversed or offset marks from the other side;
- **real ink**: any right-reading mark on this side (shelfmark, pencil, stamp, text).

Record the label and one line of what you saw in `scripts/eval/dataset/ocr-v19-labels.jsonl`. "By eye" means the image was opened: say which file you viewed.

## Strata
| id | pages | correct output |
|---|---|---|
| **W** white | qualifying pages labelled white, ≤ 40, one per book, seed 4195 | blank, no body |
| **T** show-through | qualifying pages labelled show-through + v0.4 show-through pages, ≤ 40, one per book | blank, no body |
| **S3** real ink | v18's 43 sparse-ink pages + every page labelled real ink in step 2 | NOT blank |
| **S5** references | v18's 38 non-abstaining #5250 pages | CER does not worsen |

S4 (labels/inserts) is dropped. v18 already measured it (52% vs 37%), and neither v19 section touches `<insert>`.

## Outcomes
These are as in the v18 pre-registration:
- **fabricated**: body > 20 letters;
- **blank recall**;
- **false blank**: declared blank OR 0 body letters;
- **windowed CER**;
- **loop rate**: Wilson 95% interval.

Plus one diagnostic: **context echo**. On W and T, does a run's `<header>` or body share a 4+-character token with the book's title or author (normalised, case-folded)? It is reported per arm and does not gate.

## Noise floor
`floor` = the p90 of |A − A2| per stratum. **If that is 0** (as it was on every binary stratum in v18), use 1/k = 0.333 per page as the minimum meaningful per-page difference for counting a page better or worse. A page then counts as better only if its rate moves by at least one run in three.

## Decision rule: recommend **v19** for promotion only if all hold
1. **Primary, W ∪ T pooled:** mean(A − C) fabricated > 0, and the exact sign test over non-tied pages has **p < 0.05**.
2. **T alone:** C is better than A on more pages than it is worse (directional; T is the stratum v18 failed).
3. **S3 guard:** mean false blank under C ≤ A + 0.05.
4. **S5 guard:** median(C − A) windowed CER ≤ max(floor, 0.01).
5. **Loop guard:** C's Wilson lower bound ≤ A's upper bound.

Also reported, without gating:
- **B vs C** on W and T: does the new text matter beyond v18?
- **B vs A** on the relabelled strata: does v18 itself pass once the labels are right?

If v19 fails and B passes 1–5 with B in place of C, the recommendation is **v18**. Otherwise it is **not established**. The promote is Derek's call. The run writes no `prompts` row and nothing to `pages`.

## Budget
| step | requests | estimate |
|---|---|---|
| screen | ~440 | ~$0.4 |
| arms | 4 arms × 3 runs × ≤ 160 pages ≈ 1,900 | ~$2 |

**Cap: $6.** The ledger line goes in `/root/claude-jobs/ocr-v19-ab-spend.txt`, and the parent copies it to the ops ledger.

## Amendments
None yet. Any amendment is appended with a date, before the affected step runs.
