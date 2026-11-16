## fix-scripts wave 6 (Fable corrector), run id `fix-scripts-w6-ocr`

| | pages |
|---|---|
| attempted | 78 |
| written | 41 |
| unchanged (nothing to correct) | 3 |
| CONTAIN (not written) | 1 |
| refused by the writer: under 40% of its words are in the stored read: check by eye | 1 |
| other answers (no-answer 32) | 32 |

Written by language: Greek 33, Sanskrit 4, Arabic 3, Armenian 1. All carry `--mark-stale=fix-scripts-199`: the English waits for the agy lane.

**Audit (10 random writes, one per language first, judged blind against the image by Opus, which did not write them):** 9 better, 1 same, 0 worse than the text they replaced. Wrong-page control: accept=false fidelity=1. Recorded as `lane-spot-check` book checks (run `fix-scripts-w6-ocr-audit`).

```
Greek: stored A4 -> written A5 better  6a357f022aadc65cf090825a
Sanskrit: stored R3 -> written A4 better  69907c495f855ec553e7362c
Arabic: stored R3 -> written A4 better  6a20329818654bf8e19031f7
Armenian: stored R3 -> written A5 better  69a5ead1d507939f0352d002
Greek: stored R3 -> written A4 better  6a0851bb49638a50931b906b
Greek: stored R4 -> written A5 better  6a0859db49638a50931c87c0
Greek: stored R3 -> written A5 better  69b3006c5545150b61b4c75d
Greek: stored R3 -> written A5 better  69b2ff96a1a4246ddb45b758
Greek: stored R2 -> written A5 better  6a3f027997e91e1768f674e3
Arabic: stored R3 -> written R3 same  6a2032e218654bf8e1903af2
```
(A = accepted, R = not accepted, digit = fidelity 1 to 5.)

**CONTAIN (1):**
- `69b3f724a107e55a0ee1b5f5` p.386: The image is a low-resolution two-page spread of a Greek minuscule manuscript whose writing cannot be read at this size, and the draft's fluent Greek astronomical text (with invented ellipsis-ended "Σχόλιον" and "Ἔκθεσις" inserts, and the left page's roughly 30 lines omitted) cannot be verified against any line, so it appears to be an invention rather than a reading of this leaf.

**Refused by the writer's guards, not forced (1):**
- `69b2ffbce5d6d64d8e19757b` Greek pp. 73

Manuscript or handwritten pages among the writes: 6 (Fable-written, audited by Opus; list in the final page-id file).

Revert: `node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id fix-scripts-w6-ocr --apply`
