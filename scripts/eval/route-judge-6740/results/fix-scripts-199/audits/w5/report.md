## fix-scripts wave 5 (Fable corrector), run id `fix-scripts-w5-ocr`

| | pages |
|---|---|
| attempted | 150 |
| written | 31 |
| unchanged (nothing to correct) | 0 |
| CONTAIN (not written) | 0 |
| refused by the writer: under 40% of its words are in the stored read: check by eye | 2 |
| other answers (no-answer 117) | 117 |

Written by language: Greek 31. All carry `--mark-stale=fix-scripts-199`: the English waits for the agy lane.

**Audit (10 random writes, one per language first, judged blind against the image by Opus, which did not write them):** 10 better, 0 same, 0 worse than the text they replaced. Wrong-page control: accept=false fidelity=1. Recorded as `lane-spot-check` book checks (run `fix-scripts-w5-ocr-audit`).

```
Greek: stored R4 -> written A4 better  69938de2d5a98fd66f42f7ba
Greek: stored R2 -> written A5 better  69942a40045dfc482ad760aa
Greek: stored R1 -> written A5 better  69938a88d5a98fd66f42ce28
Greek: stored R2 -> written A5 better  69938a88c564adf9fabec136
Greek: stored R3 -> written A5 better  695aa9c7be4023bd34bd6ff2
Greek: stored R3 -> written A5 better  699379d1b0a84a5763966399
Greek: stored R3 -> written A4 better  6959067f95a91542b28bd433
Greek: stored R4 -> written A5 better  695aa9ddbe4023bd34bd7526
Greek: stored R4 -> written A5 better  69938dcfd5a98fd66f42f025
Greek: stored R3 -> written R4 better  69942a40045dfc482ad76111
```
(A = accepted, R = not accepted, digit = fidelity 1 to 5.)

**CONTAIN (0):**
- none

**Refused by the writer's guards, not forced (2):**
- `69938a88c564adf9fabebf28` Greek pp. 673
- `69938d615d28b693146cee47` Greek pp. 351

Manuscript or handwritten pages among the writes: 10 (Fable-written, audited by Opus; list in the final page-id file).

Revert: `node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id fix-scripts-w5-ocr --apply`
