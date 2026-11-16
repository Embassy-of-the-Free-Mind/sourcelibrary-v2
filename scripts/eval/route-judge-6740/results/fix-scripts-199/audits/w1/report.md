## fix-scripts wave 1 (Opus corrector), run id `fix-scripts-w1-ocr`

| | pages |
|---|---|
| attempted | 150 |
| written | 113 |
| unchanged (nothing to correct) | 9 |
| CONTAIN (not written) | 4 |
| refused by the writer: under 40% of its words are in the stored read: check by eye | 23 |
| refused by the writer: a blank read over a stored transcription : check by eye | 1 |
| other answers (none) | 0 |

Written by language: Arabic 40, Greek 33, Hebrew 26, Persian 6, Ge'ez 5, Hebrew and Judeo-Arabic 1, Russian 1, Armenian 1. All carry `--mark-stale=fix-scripts-199`: the English waits for the agy lane.

**Audit (10 random writes, one per language first, judged blind against the image by Fable, which did not write them):** 8 better, 2 same, 0 worse than the text they replaced. Wrong-page control: accept=false fidelity=1. Recorded as `lane-spot-check` book checks (run `fix-scripts-w1-ocr-audit`).

```
Hebrew: stored R3 -> written A4 better  6985d06e2ee67e21c500ed5d
Greek: stored R3 -> written A4 better  6993890ece1538706594649e
Arabic: stored R3 -> written R3 same  69b3e596c94a4ff7cce22d65
Ge'ez: stored R2 -> written R3 better  69d5ad0c4dc55b8478ddf711
Russian: stored R3 -> written A4 better  6984f45eb3153e81a880f595
Hebrew: stored R2 -> written R3 better  69b3e67c304c1c6b3950b88f
Hebrew: stored R2 -> written R3 better  69c1bb8e8522835be84603fd
Arabic: stored R2 -> written R3 better  69908a7793003de39c96594f
Arabic: stored R2 -> written A4 better  6953b59b77f38f6761bd9962
Hebrew: stored R3 -> written R3 same  69b52bd1d6bd9f58edb24d51
```
(A = accepted, R = not accepted, digit = fidelity 1 to 5.)

**CONTAIN (4):**
- `69b52cc7b3537347e51e2edd` p.99: This leaf is an unidentified commentary in a very heavily abbreviated cursive. The draft's flowing text does not match the visible lines in many places (for example, lines 6 and 15 onward), and the drawing it describes as a rectangular diagram is only a small marginal sketch, so its readings cannot be verified or reliably corrected from this image.
- `69b52cc7b3537347e51e2edd` p.100: This leaf is a heavily abbreviated cursive commentary. The draft contains readings the page does not support (for example "ὁ πατὴρ", "ἡ γυνὴ προσχῇ" and "ἐλπίζον"), gets the left-margin notes wrong and leaves out the separate last line at the bottom, and the hand cannot be read reliably enough to give a faithful replacement.
- `69b52cc7b3537347e51e2edd` p.179: This leaf is a heavily abbreviated cursive commentary that cannot be reliably read from this image. The draft reads largely as reconstruction rather than transcription (for example, line 33 is a run of single-letter unclear tags), and its catchword "λ" is not on the page.
- `69b52cc7b3537347e51e2edd` p.180: The draft is not this leaf's text. It is an invented passage on astronomy, geometry and a "δομική/δορική" music theory that does not match the heavily abbreviated logical commentary on the page, it gives the margin number "55" as "ϛϛ" and it adds a page number "2"; the hand itself cannot be read reliably enough to give a replacement.

**Refused by the writer's guards, not forced (24):**
- `6953b59b77f38f6761bd990c` Arabic pp. 66
- `695931cbb91a6184ea94337c` Arabic pp. 3
- `6985ca7194b042cd03912166` Hebrew pp. 21
- `6993831384cf5845c644cb68` Greek pp. 358, 359, 461, 462, 524, 525
- `6993895d74305116d72d1644` Greek pp. 6, 11, 13
- `69b3e67c304c1c6b3950b7c3` Hebrew pp. 20, 362
- `69c1bb8e8522835be84603f3` Hebrew pp. 21, 43
- `69c1bb948522835be84604fa` Hebrew and Judeo-Arabic pp. 5, 10
- `69d5ac04d0bd3547a5654b83` Armenian pp. 534
- `69d5ad0c4dc55b8478ddf60b` Ge'ez pp. 21, 22, 339
- `6a358874d8c4016326cdcb7f` Persian pp. 757, 758

**Manuscript pages corrected by Opus, awaiting cross-family re-check (94):**
- `69c1be4e8522835be846c16b` Arabic pp. 1
- `69c1bb948522835be84604fa` Hebrew and Judeo-Arabic pp. 6
- `6993895d74305116d72d1644` Greek pp. 7, 8, 10, 12, 14
- `6993890ece15387065946496` Greek pp. 8, 9, 10, 11, 12, 13, 16, 256
- `69908a7693003de39c9658e5` Arabic pp. 10, 11, 36, 37, 64, 65, 80, 81, 106, 107
- `69c1bb8e8522835be84603f3` Hebrew pp. 10, 22
- `695931cbb91a6184ea94337c` Arabic pp. 14
- `6953b59b77f38f6761bd990c` Arabic pp. 15, 16, 39, 40, 42, 43, 65, 86, 87
- `695230c6ab34727b1f044784` Greek pp. 18, 20, 21
- `69b3e596c94a4ff7cce22d4f` Arabic pp. 21, 22, 42, 86, 87, 104, 105, 162, 163
- `69b3e67c304c1c6b3950b7c3` Hebrew pp. 21, 105, 106, 204, 205, 291, 292, 361
- `6a358874d8c4016326cdcb7f` Persian pp. 25
- `69938fa45d28b693146d14dd` Greek pp. 35, 56, 71
- `69b52bd1d6bd9f58edb24c2c` Hebrew pp. 37, 83, 84, 132, 133, 197, 198, 293, 294
- `69b52cc7b3537347e51e2edd` Greek pp. 52, 268, 392, 393
- `695361cd9c494f9f9f042f19` Arabic pp. 59
- `6993831384cf5845c644cb68` Greek pp. 70, 71, 164, 165
- `69d5ad0c4dc55b8478ddf60b` Ge'ez pp. 84, 85, 216, 262, 263
- `69dea2514d19ec2e9ba762be` Arabic pp. 100, 145, 146
- `69d5ac04d0bd3547a5654b83` Armenian pp. 137
- `69e96123390d3ed634590b97` Arabic pp. 141, 300, 378, 379, 519, 520

Revert: `node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id fix-scripts-w1-ocr --apply`

**Read this plainly:** the corrections are better than what they replaced, but 6 of the 10 audited pages are still not accepted by the judge. They are mostly manuscript pages; the correction improves them and does not make them good.

**By eye (3 opened this wave, none confirmed as wrong-leaf, so no hold):**
- CONTAIN book `69b52cc7b3537347e51e2edd` (Greek manuscript, heavily abbreviated cursive commentary). Opus called the stored text of p.180 invented. I opened p.180: the leaf does carry the words the stored text is built on (μουσική, γεωμετρική, καθόλου recur through it), so it is the same leaf read too fluently, not another leaf, and I could not confirm invention. This book needs a reader who can read the hand; no model here should be trusted on it.
- Galen `6993831384cf5845c644cb68` p.525 (5% shared): same leaf. The stored text is the same lines without accents or breathings, so the guard counts accent differences as different words. That likely explains most of the Greek refusals. Not forced.
- Persian `6a358874d8c4016326cdcb7f` p.757 (17% shared): a dense lithographed page. The stored heading is on the leaf; the body I could not verify at this size.
- Armenian p.534: Opus read the page as blank against 332 stored characters. Not opened.
- From the cell test, the 3 Fable corrections refused by the same guard (`69942f6fb2f6748db4ac0db5` p.7, `69b52c1d3dd6d9423027dcb0` p.123, `69bfcd228ab50eb88e8c7d27` p.68) are in the same state. p.123 opened: same leaf (folio 58), the stored text a poor read of it.

The Fable audit of Opus manuscript pages is same-family, so the manuscript list above is not settled by it. Waves 2, 3 and 4 are being read by Fable now.
