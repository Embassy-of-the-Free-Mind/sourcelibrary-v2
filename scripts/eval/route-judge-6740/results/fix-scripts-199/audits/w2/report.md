## fix-scripts wave 2 (Fable corrector), run id `fix-scripts-w2-ocr`

| | pages |
|---|---|
| attempted | 150 |
| written | 97 |
| unchanged (nothing to correct) | 10 |
| CONTAIN (not written) | 18 |
| refused by the writer: under 40% of its words are in the stored read: check by eye | 25 |
| other answers (none) | 0 |

Written by language: Arabic 40, Greek 32, Sanskrit 11, Armenian 9, Hebrew 5. All carry `--mark-stale=fix-scripts-199`: the English waits for the agy lane.

**Audit (10 random writes, one per language first, judged blind against the image by Opus, which did not write them):** 10 better, 0 same, 0 worse than the text they replaced. Wrong-page control: accept=false fidelity=1. Recorded as `lane-spot-check` book checks (run `fix-scripts-w2-ocr-audit`).

```
Armenian: stored R2 -> written A5 better  69d66bb14da4f8dce52f1837
Hebrew: stored R3 -> written A5 better  69906607ef12272ffdc94eaa
Sanskrit: stored R3 -> written A5 better  6991d8978c1030b12444c05c
Arabic: stored R2 -> written R3 better  69c1b7a6fe4b8f25b9200a22
Greek: stored R2 -> written A5 better  6993838250654cbbe2916fb5
Greek: stored R2 -> written A4 better  69942f45b2f6748db4ac02d7
Greek: stored R3 -> written A4 better  6952c9ca77f38f6761bc31c3
Sanskrit: stored R3 -> written R4 better  69906822249ce014347d578c
Arabic: stored R3 -> written A5 better  69d6659cdaca889caf9274ca
Sanskrit: stored R4 -> written A4 better  69907c765f855ec553e7592e
```
(A = accepted, R = not accepted, digit = fidelity 1 to 5.)

**CONTAIN (18):**
- `69906606ef12272ffdc94dd0` p.92: The draft's Genesis verses are an invention — this side of the leaf carries no writing of its own, only mirror-reversed show-through from the other side, staining and the library's digital watermark.
- `69906606ef12272ffdc94dd0` p.93: The draft's two paragraphs on intellect, prophecy and the soul are an invention — apart from the folio number 45 in the top left corner, this side of the leaf shows only mirror-reversed show-through from the other side, staining and the library's digital watermark.
- `6991d8978c1030b12444c035` p.18: This leaf is a blank tissue guard carrying only mirror-reversed show-through of a diagram; the draft's text is cut-off line fragments from the page lying beneath it and from the facing page, not text printed on this leaf.
- `6991d8978c1030b12444c035` p.29: This side of the leaf is blank apart from mirror-reversed show-through and red offset of the chakra plate printed on the other side; the draft's heading, seed syllable and table are invented, not printed here.
- `69c1bbcf8522835be8460a04` p.89: The draft is a different work (a passage on the disciples of Abraham and of Balaam from Mishnah Avot with commentary), whereas the leaf, half covered by a repair strip, carries cursive Hebrew magical recipes that do not match it.
- `69c1bbcf8522835be8460a04` p.96: The draft is an invented Syriac text with Christian formulas, whereas the leaf is written in cursive Hebrew script with divine names and ring-letter magical characters, so none of the draft is this leaf's text.
- `69c1bd578522835be8469631` p.24: The draft is not this leaf's text but an invention loosely hung on a few of its words: the page carries the Ge'ez Book of Enoch (the leaders of the seasons, Melkiel, Helemmelek, Mel'eyal, Narel, then Enoch's vision addressed to his son Methuselah), while the draft is filled with made-up phrases and repeated "ሥላሴ / እግዚአብሔር / ወኵሉ" that are not on the leaf.
- `69c1bd578522835be8469631` p.25: The draft is an invention rather than this leaf's text: the page carries the Ge'ez Book of Enoch animal vision (fallen stars, bulls, the flood and the vessel, the white bull and the sheep), while the draft supplies names and passages (Gideon, Gregory, Constantine, Joseph, a closing "አሜን", runs of repeated bold lines and marginal lists) that are not on the leaf.
- `69c1bd578522835be8469631` p.58: The draft is an invention, not this leaf's text: the page carries the Ge'ez 1 Samuel 9–10 (Saul seeking the asses of Kish, his meeting with Samuel and his anointing), while the draft names Eleazar, Nicodemus, Solomon, Moses and Aaron and matches the page only in scattered words.
- `69c1bd578522835be8469631` p.73: The draft is not this leaf's text: after an invented opening it falls into a runaway loop repeating the same nine lines dozens of times, whereas the page carries three columns of the Ge'ez 1 Samuel 29–30 (David and the Philistine lords, the burning of Ziklag, the pursuit of Amalek).
- `69c1bd578522835be8469631` p.105: The draft is largely an invention rather than this leaf's text: the page carries the Ge'ez 1 Kings 14–15 (Jeroboam's wife, Rehoboam and Shishak, Abijam, Asa and Ben-hadad), while the draft replaces these with Nahum, Hezekiah, Manasseh, Amon, Isaiah and a "Book of Wisdom" that the leaf does not contain.
- `69c1bd578522835be8469631` p.132: The draft is an invention, not this leaf's text: it consists almost entirely of filler lines repeating "ወኵሉ፡", "ወካህናት፡" and "እምነ፡", whereas the page carries three columns of the Ge'ez 2 Kings 22–23 (Hilkiah finding the book of the law, Shaphan, the prophetess Huldah, Josiah's covenant and reforms).
- `69d5abf3d0bd3547a5654428` p.6: The draft is an invention in Armenian script and language, whereas the leaf is a Georgian manuscript in Nuskhuri hand with red rubrics, so none of the draft's text is on this page.
- `69d5abf3d0bd3547a5654428` p.7: The draft follows the leaf's line count and rubric positions but its wording is garbled pseudo-Georgian that does not give the Nuskhuri text actually written here (a lectionary-style page with red lection rubrics), so it is an invention and not a usable reading of this leaf.
- `69d5abf3d0bd3547a5654428` p.204: The draft is an invented, formulaic martyrdom narrative with repeated sentences and a "red initial" description before every sentence, which does not correspond to the roughly 38 lines of faded Nuskhuri text, the red rubric line and the centred closing line on this leaf.
- `69d5abf3d0bd3547a5654428` p.271: The draft is a recitation of standard opening prayers (Trisagion, Lord's Prayer, "Come let us worship") that is not this leaf's text; the page (folio 139) carries about 37 lines of Nuskhuri broken by some twenty red initials into short sections, plus a centred closing line, none of which the draft reflects.
- `69d5abf3d0bd3547a5654428` p.430: The draft is an invented, runaway repetitive litany ("და ვიყავი მე … და შენ მომეც …") in modern Georgian that is not on this leaf, which holds about 38 lines of Nuskhuri text with three red rubrics marking new readings.
- `69d5abf3d0bd3547a5654428` p.431: The draft is an invented set of modern-style prayers with fabricated "კურთხევაი/ლოცვაი" rubrics and HTML colour spans that does not match this leaf (folio 218), whose Nuskhuri text has three red rubric passages of a different form and position.

**Refused by the writer's guards, not forced (25):**
- `6953a82c77f38f6761bd0bc5` Armenian pp. 126, 127, 141
- `69906606ef12272ffdc94dd0` Hebrew pp. 27, 28
- `69908ad8285673ff8cb80bac` Arabic pp. 4
- `6993832950654cbbe29163fb` Greek pp. 245, 246
- `6993838250654cbbe2916e4c` Greek pp. 436, 587, 588
- `69942f45b2f6748db4ac0121` Greek pp. 31, 324, 527, 528
- `69c1bd578522835be8469631` Ge'ez pp. 106, 133
- `69d66bb14da4f8dce52f16eb` Armenian pp. 60, 116, 117, 227, 228, 333, 413, 414

Manuscript or handwritten pages among the writes: 80 (Fable-written, audited by Opus; list in the final page-id file).

Revert: `node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id fix-scripts-w2-ocr --apply`
