## fix-scripts wave 8 (Opus corrector), run id `fix-scripts-w8-ocr`

| | pages |
|---|---|
| attempted | 88 |
| written | 82 |
| unchanged (nothing to correct) | 2 |
| CONTAIN (not written) | 4 |

| other answers (none) | 0 |

Written by language: Greek 71, Sanskrit 4, Hebrew 3, Arabic 2, Hebrew, Judeo-Arabic and Aramaic 1, Hebrew and Judeo-Arabic 1. All carry `--mark-stale=fix-scripts-199`: the English waits for the agy lane.

**Audit (10 random writes, one per language first, judged blind against the image by a fresh blind Opus session (SAME-FAMILY audit, per Derek's 10:53Z note: no further Fable calls), which did not write them):** 9 better, 1 same, 0 worse than the text they replaced. Wrong-page control: accept=false fidelity=1. Recorded as `lane-spot-check` book checks (run `fix-scripts-w8-ocr-audit`).

```
Greek: stored R3 -> written A5 better  69b1def6ca46fa60ea1eed06
Hebrew: stored R3 -> written A4 better  69c1bb258522835be845d3a4
Sanskrit: stored R2 -> written R4 better  69dea5f84d19ec2e9ba77e35
Arabic: stored R3 -> written A4 better  69f33cf0876dd827cbc5b462
Greek: stored R3 -> written R4 better  69b222ed56715b0e32475bb7
Greek: stored A4 -> written A5 better  69b2f4280e2f024dfbfbba1f
Greek: stored R4 -> written A4 better  69b2f32121208ea9dc277b4e
Greek: stored R3 -> written A4 better  69b6848470c69d645a73808c
Greek: stored A4 -> written A5 better  69b2ff82e5d6d64d8e1971f8
Greek: stored R3 -> written R3 same  69b2ff96a1a4246ddb45b711
```
(A = accepted, R = not accepted, digit = fidelity 1 to 5.)

**CONTAIN (4):**
- `69b00a0ec42435fcd0cf9acb` p.619: The draft is the text of page 610 (a different passage, from Hippocrates' text on wounds and setting bones), but the image is page 611, headed "ΠΕΡΙ ΑΓΜΩΝ ΥΠΟΜΝΗΜΑ Γ." It contains sections να′/LI and νβ′/LII, on dislocations of the knee and elbow and on the thigh joint compared with the upper arm.
- `69c1bada8522835be845aee0` p.133: The draft doesn't match this leaf: its Syriac narrative about Nicholas and his brother Bardaya repeats itself, turns the six-line block in the left margin into one long sentence, and doesn't follow the page's actual lines, so it looks invented. I can't reliably read the page's cursive script to replace it, so the leaf can't be transcribed here.
- `69cf7b9e878f40c5945f1c42` p.39: The draft is the text of page 14 (header "THE OXYRHYNCHUS PAPYRI", notes 5–7 and the start of the IX. Aristoxenus introduction), but the image shows page 15 (header "NEW CLASSICAL FRAGMENTS"). That page continues the introduction ("this discussion with what precedes and follows…") and prints the Greek text of Col. I and Col. II.
- `69e7928c80b52390feb16343` p.30: The draft is the text of page 21, which begins "On his death his son Chândaghosha becomes Raja…". This leaf is page 22 and begins "her nurse and attendants, had continued in their hiding-place…", so the draft does not match it.

**Refused by the writer's guards, not forced (0):**
- none

**Manuscript pages corrected by Opus, awaiting cross-family re-check (8):**
- `69c1bb258522835be845d39d` Hebrew pp. 5, 7
- `69e7490485f786e884a4d186` Hebrew pp. 9
- `69dea5f84d19ec2e9ba77e07` Sanskrit pp. 11, 16
- `69c1bc6b8522835be8463238` Hebrew, Judeo-Arabic and Aramaic pp. 98
- `69c1bae98522835be845b6b8` Hebrew and Judeo-Arabic pp. 184
- `69f33cf0876dd827cbc5b31c` Arabic pp. 326

Revert: `node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id fix-scripts-w8-ocr --apply`

Wave 8 = the second part of the pages Fable left unanswered in waves 4 to 6, read by Opus. Inbox note acted on: Derek 10:53Z, no more Fable calls; this audit's judge is the same model family as the writer, so it is weaker evidence than the cross-family audits of waves 1 to 6.

**Containment from this wave's CONTAIN answers:** opened `69cf7b9e878f40c5945f1c42` p.39 by eye: the image is printed page 15 and the stored text is printed page 14's. Book held (`by-eye-off-leaf-pages`, release on #199) and that page's English withheld. The other three CONTAIN answers report the same kind of one-leaf shift and were not opened: `69b00a0ec42435fcd0cf9acb` p.619, `69e7928c80b52390feb16343` p.30, Syriac `69c1bada8522835be845aee0` p.133 (repetition). A shift like this usually runs over a stretch of the book, so these books want `scripts/maintenance/repair-text-offset-segments.mjs`, not page-by-page correction.
