## fix-scripts wave 7 (Opus corrector), run id `fix-scripts-w7-ocr`

| | pages |
|---|---|
| attempted | 150 |
| written | 129 |
| unchanged (nothing to correct) | 4 |
| CONTAIN (not written) | 6 |
| refused by the writer: under 40% of its words are in the stored read: check by eye | 11 |
| other answers (none) | 0 |

Written by language: Greek 103, Hebrew 7, Greek-Latin 7, Judeo-Arabic and Hebrew 5, Sanskrit 5, Arabic 1, Armenian 1. All carry `--mark-stale=fix-scripts-199`: the English waits for the agy lane.

**Audit (10 random writes, one per language first, judged blind against the image by a fresh blind Opus session (SAME-FAMILY audit), which did not write them):** 10 better, 0 same, 0 worse than the text they replaced. Wrong-page control: accept=false fidelity=1. Recorded as `lane-spot-check` book checks (run `fix-scripts-w7-ocr-audit`).

```
Hebrew: stored R2 -> written R4 better  699f92622c6ec1d73a97e812
Greek: stored R3 -> written A5 better  69938a8ee07f979c72ac6688
Sanskrit: stored R3 -> written A4 better  6a060d36e16c60cb2a894917
Arabic: stored R2 -> written A5 better  6ae4dccc2b8091b67d1a45c3
Armenian: stored R3 -> written R4 better  69944861185a84ef595aaf48
Greek: stored R4 -> written A4 better  6959067f95a91542b28bd357
Judeo-Arabic and Hebrew: stored R2 -> written A4 better  69c1bb638522835be845f5ee
Greek: stored R3 -> written A4 better  69b62f671c1c21a3737f5201
Greek: stored R3 -> written A4 better  699750805583d749eb733000
Greek: stored R3 -> written A4 better  69a5e3d7006a4098422165e2
```
(A = accepted, R = not accepted, digit = fidelity 1 to 5.)

**CONTAIN (6):**
- `69bfcf293047130b1c3beced` p.9: The draft does not transcribe this leaf: its text is a loose, largely invented paraphrase of a commentary on Romans 1 with made-up Chinese "margin" tags, and the heavily abbreviated Byzantine minuscule cannot be reliably re-read line by line from this image.
- `69bfcf293047130b1c3beced` p.163: The draft is a free reconstruction of a commentary on 2 Corinthians 6:4–9 whose wording often departs from the manuscript (for example, it adds "οὐχὶ τὰς τυχούσας λέγει, ἀλλὰ τὰς ἀνυπομονήτους" and "ἐν δεσμοῖς", which are not on the leaf), and the dense abbreviated minuscule cannot be reliably re-transcribed in full from this image.
- `69bfcf293047130b1c3beced` p.194: From "Παῦλος ἀπόστολος…" onward the draft invents the full biblical text of Galatians 1:1–24, which this leaf does not contain (the page carries commentary that ends in "…πταίουσι"), and the earlier lines are also a loose paraphrase; the abbreviated minuscule cannot be reliably re-transcribed in full from this image.
- `69bfcf293047130b1c3beced` p.316: The draft is a loose paraphrase of a commentary on 1 Thessalonians 5:15–23 that departs from the manuscript's wording throughout (for example, the leaf opens "διώκετε εἰς ἀλλήλους καὶ εἰς πάντας· Οὐκ ἀρκεῖ τὸ μὴ ἀποδοῦναι κακὸν ἀντὶ κακῶν· ἀλλὰ χρὴ καὶ ἀγαθοῖς ἀμείβεσθαι…"), and the faded, abbreviated minuscule cannot be reliably re-transcribed in full from this image.
- `69bfcf293047130b1c3beced` p.405: The draft is a loose reconstruction of a commentary on Hebrews 3:11–15 whose wording does not follow the manuscript line by line, and the abbreviated, partly stained minuscule cannot be reliably re-transcribed in full from this image.
- `69bfcf293047130b1c3beced` p.432: The draft mixes invented commentary with the full biblical text of Hebrews 9:2–5, which the leaf does not write out in that form (the leaf opens "…γεγραμμένου τῶν προγεγονότων ἁμαρτιῶν, οὐκέτι μέμνηται…"), and the stained, abbreviated minuscule cannot be reliably re-transcribed in full from this image.

**Refused by the writer's guards, not forced (11):**
- `699389e61075be7d320556aa` Greek pp. 124
- `69938a8ee07f979c72ac6590` Greek pp. 29
- `69942e5cd607f8e57e4b89fa` Greek pp. 586, 730
- `699439cd6879ff0184cb9235` Greek pp. 79
- `699ef9fd15618a982bb1ebd9` Hebrew pp. 537
- `69bfcde68ab50eb88e8c83b3` Greek pp. 2
- `69bfcf293047130b1c3beced` Greek pp. 593
- `69c1bb638522835be845f5c7` Judeo-Arabic and Hebrew pp. 16, 40, 86

**Manuscript pages corrected by Opus, awaiting cross-family re-check (44):**
- `6a2032b518654bf8e19035c4` Arabic pp. 6
- `699388e60f04c37dcfa6000f` Greek pp. 13
- `69a5e3d7006a4098422165d4` Greek pp. 13, 14, 15, 16, 17, 18, 19, 22, 47, 105, 126, 193
- `6993896474305116d72d17e1` Greek pp. 14, 175, 266, 360, 569
- `69c1bb638522835be845f5c7` Judeo-Arabic and Hebrew pp. 17, 39, 48, 49, 87
- `69938963ce15387065946bf9` Greek pp. 19, 269
- `69938a8ee07f979c72ac6590` Greek pp. 30
- `699439c96879ff0184cb8fed` Greek pp. 32
- `69ae923286f8cb4a256ee4d6` Greek pp. 34
- `699382f784cf5845c644c2d3` Greek pp. 104, 157, 221, 642
- `69907ceb5f855ec553e7801f` Sanskrit pp. 176
- `6993890e74305116d72d0d43` Greek pp. 197
- `69938a8ee07f979c72ac658f` Greek pp. 248
- `69bfcf293047130b1c3beced` Greek pp. 522, 532, 676
- `699389f2ce15387065947f46` Greek pp. 712, 1046, 1110, 1151, 1352

Revert: `node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id fix-scripts-w7-ocr --apply`

**Contained by eye (same run):** I opened p.194 and p.432 of `69bfcf293047130b1c3beced` (Bodleian MS Auct. E.1.6, Theophylact) against their images. In both pages the stored Greek inserts continuous scripture that is not on the leaf. p.194 writes out the whole of Galatians 1:1–24, where the leaf has one lemma and its commentary. p.432 inserts Hebrews 9:2–5 as one block, where the leaf gives it only as short lemmata. I held the book (`by-eye-invented-pages`, release on v3#199) and withheld the English on pp.194 and 432 (`withhold-stale-translations.mjs --by-eye-pages`). Opus answered CONTAIN on pp.9, 163, 316 and 405 for the same reason; I have not checked those four by eye, so their English is still served. They are listed for the release check. 13 images opened by eye so far (limit 20).
