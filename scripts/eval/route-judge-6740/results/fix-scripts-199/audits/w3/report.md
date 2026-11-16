## fix-scripts wave 3 (Fable corrector), run id `fix-scripts-w3-ocr`

| | pages |
|---|---|
| attempted | 150 |
| written | 126 |
| unchanged (nothing to correct) | 0 |
| CONTAIN (not written) | 4 |
| refused by the writer: under 40% of its words are in the stored read: check by eye | 18 |
| refused by the writer: letters outside the book's scripts | 2 |
| other answers (none) | 0 |

Written by language: Greek 54, Arabic 40, Greek/Latin 12, Sanskrit 11, Ancient Greek 5, Hebrew 1, Hebrew, Judeo-Arabic, and Aramaic 1, Persian 1, Hebrew, Judeo-Persian, and Aramaic 1. All carry `--mark-stale=fix-scripts-199`: the English waits for the agy lane.

**Audit (10 random writes, one per language first, judged blind against the image by Opus, which did not write them):** 9 better, 1 same, 0 worse than the text they replaced. Wrong-page control: accept=false fidelity=1. Recorded as `lane-spot-check` book checks (run `fix-scripts-w3-ocr-audit`).

```
Greek: stored R3 -> written A5 better  699389f2ce15387065948196
Arabic: stored R3 -> written A4 better  69a5ea0d815633a563894da4
Sanskrit: stored R3 -> written A4 better  6abb823bd43e89b8da329afd
Hebrew: stored R2 -> written A4 better  69b52be43dd6d9423027ca14
Arabic: stored R2 -> written A4 better  69d5ac52d0bd3547a565602e
Persian: stored R2 -> written R3 better  69e74ef15cf1eaf3ad80df80
Greek: stored R3 -> written A5 better  699376e7b0a84a5763962155
Greek: stored R3 -> written A5 better  69b222db56715b0e3247599f
Greek: stored R3 -> written R3 same  69b2f40e0e2f024dfbfba6cb
Greek: stored R3 -> written A5 better  69ae633c5d11d232640c39c6
```
(A = accepted, R = not accepted, digit = fidelity 1 to 5.)

**CONTAIN (4):**
- `69942f6fb2f6748db4ac0db5` p.41: The draft is largely an invention rather than a reading of this leaf — fluent paraphrase with formulaic, repeating marginal text that does not follow the lines on folio 14 — and the minute, heavily abbreviated cursive of the main text and surrounding scholia cannot be read reliably enough here to replace it.
- `69b3e679304c1c6b3950b712` p.141: The draft is an invention rather than this leaf's text — beyond the heading and the שאל/תשובה labels, its body does not match the handwritten Hebrew on the page (which opens with the question "מי יכריחני להאמין שיש לעולם מנהיג") and collapses into runaway repetition of "וזהו המעלה" that the page does not contain.
- `69c1bb2e8522835be845d575` p.62: The draft is an invention, not this leaf's text: it repeats the filler words "בשלם ביהושע בשלם…" on every line, whereas the page carries three numbered lists of distinct handwritten Hebrew cursive lines (astrological-style judgments beginning "בשנה…", "השאלה…", "הסחורה…", "בדבר…") under the headings "יוסף ז" and "אבן ח", with the catchword "המלאכה".
- `69e786a94a6785cfd60c88a8` p.111: The draft transcribes a different page (p. 34, chapters XXXII–XXXIV on horses and veterinary art with five footnotes), whereas this leaf is p. 35, which continues with the birds kept at country houses, chapter XXXV on dogs, the note "Este último capítulo falta en la Obra", and the catchword "SIGUE".

**Refused by the writer's guards, not forced (20):**
- `695311a477f38f6761bcc8b8` Greek pp. 1470
- `6956952b8c9559f6c2db06a3` Greek/Latin pp. 419
- `69937973b0a84a5763964d43` Greek pp. 583
- `69942f6fb2f6748db4ac0db5` Greek pp. 84, 130, 165, 175, 224, 266
- `69b222db56715b0e324757a1` Greek pp. 16
- `69b52be43dd6d9423027ca00` Hebrew pp. 21, 57, 58, 83, 84, 118, 119, 175, 176
- `69b52c1d3dd6d9423027dcb0` Greek pp. 133

Manuscript or handwritten pages among the writes: 57 (Fable-written, audited by Opus; list in the final page-id file).

Revert: `node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id fix-scripts-w3-ocr --apply`
