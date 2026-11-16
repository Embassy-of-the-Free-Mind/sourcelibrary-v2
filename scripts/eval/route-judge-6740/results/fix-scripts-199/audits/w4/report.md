## fix-scripts wave 4 (Fable corrector), run id `fix-scripts-w4-ocr`

| | pages |
|---|---|
| attempted | 150 |
| written | 55 |
| unchanged (nothing to correct) | 2 |
| CONTAIN (not written) | 0 |
| refused by the writer: under 40% of its words are in the stored read: check by eye | 4 |
| other answers (no-answer 89) | 89 |

Written by language: Greek 50, Arabic 4, Sanskrit 1. All carry `--mark-stale=fix-scripts-199`: the English waits for the agy lane.

**Audit (10 random writes, one per language first, judged blind against the image by Opus, which did not write them):** 10 better, 0 same, 0 worse than the text they replaced. Wrong-page control: accept=false fidelity=1. Recorded as `lane-spot-check` book checks (run `fix-scripts-w4-ocr-audit`).

```
Greek: stored R3 -> written A5 better  69b2235a56715b0e324773e6
Arabic: stored R3 -> written A4 better  69f325c852a77bb28fdb5d37
Sanskrit: stored R3 -> written A5 better  6990694b2f82e0fda48065bb
Greek: stored R3 -> written A4 better  69b62f671c1c21a3737f5282
Greek: stored R3 -> written A4 better  69d146051c2a66dc094b2061
Greek: stored R3 -> written R4 better  69b3e5e7304c1c6b3950a893
Greek: stored R3 -> written A5 better  69b630611c1c21a37380129f
Greek: stored R4 -> written A5 better  69b220b356715b0e3247338d
Greek: stored R2 -> written R3 better  69938919ce15387065946752
Greek: stored R2 -> written A5 better  69b2fee065b9d6bf89925454
```
(A = accepted, R = not accepted, digit = fidelity 1 to 5.)

**CONTAIN (0):**
- none

**Refused by the writer's guards, not forced (4):**
- `69b2fee065b9d6bf89925253` Greek pp. 374
- `69b52c5c3dd6d9423027f9f2` Greek pp. 101
- `69b630611c1c21a37380114a` Greek pp. 80
- `69f325c852a77bb28fdb5cd7` Arabic pp. 142

Manuscript or handwritten pages among the writes: 9 (Fable-written, audited by Opus; list in the final page-id file).

Revert: `node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id fix-scripts-w4-ocr --apply`
