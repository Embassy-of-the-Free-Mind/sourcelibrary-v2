---
stage: ocr
measure: judged
languages: [he, arc]
scripts: [Hebr]
canons: []
n_books: 1
n_pages: 30
verdict: "An image-anchored column-order check catches every reversed G4L read on Zohar Chadash: of 53 labelled reads (pilot + colfix runs, 30 pages), it called 0 reversed reads 'correct' (24 reversed: 22 flagged, 2 undetermined) and flagged 0 correct reads (22 correct: 17 pass, 5 undetermined). Writing only the reads it passes gives 0 of 18 read left column first (95% upper bound 18%), against the target of ≤ 1 of 23. The 3 pages where it disagreed with the Opus judge were read by eye: the check was right on all 3; the judge had called reversed reads 'correct'."
status: undecided
decision: "Wire it into the Rashi lane as a per-page refusal (write only 'correct'), then re-measure on a second Rashi book before row 1 runs (#6769)."
superseded_by: null
issue: 6769
---
## 2026-10-18 · Can a check, not a prompt, keep reversed Hebrew column order out of the Rashi re-read? (#6769)
PRIOR ART: `2026-10-16-g4l-hebrew-right-column-first-instruction-6769.md` (the instruction made order worse, 15/23; it named this check as option 2, not built).

**Question.** G4L's text beats the served flash-lite OCR on Zohar Chadash, but it sometimes reads the left column first. Can a cheap check tell which reads are in the right order, so the lane writes only those?

**Design.** `scripts/eval/g4-reread-pilot-6769/colorder.mjs`:
1. **Find the text columns.** The image's x-profile of ink/paper transitions down the page, counted only on paper, so binding grain and cardboard are excluded. Columns are numbered right to left.
2. **Read the strips.** Crop each column's first lines and stack the crops into one numbered sheet. One G4L call (agy, $0) transcribes the sheet.
3. **Check the order.** Locate each strip's text in the full read (Hebrew letters only, final forms folded, 3-gram offset voting, score ≥ 0.25). The verdict is `correct` if the located strips come in right-to-left order, `reversed` if any pair is inverted, and `undetermined` if fewer than 2 strips are located. A strip that isn't found is ignored, never guessed: a sliver of the facing page or the binding label falls out this way.

Scored (`colorder-score.mjs`) against the judge's `order_A/order_B` on the same reads: the pilot's 30-page draw (no instruction) and the colfix run's 23 two-column pages. Cost: 30 agy calls, $0.

**Result** (judge labels, with the 3 corrected by eye below):

| truth → check | correct | reversed | undetermined |
|---|---|---|---|
| reversed / interleaved (24) | **0** | 22 | 2 |
| correct, 2+ columns (22) | 17 | **0** | 5 |
| single column (7) | 1 | 0 | 6 |

**The 3 disagreements, read from the image (me).** On each, the judge said "correct" and the check said "reversed":
- p.73 (pilot): the right column opens `קדישא סגי יקרא דבריה דמלכא`, the left `עוד לתרומה הוצרך משה`. The read starts `**עוד לתרומה**`.
- p.157 (colfix): the left column opens `יהבין ליה שאלתוי בתלת כתרין`. The read starts with that line.
- p.155 (pilot): the left column opens `…יתמ׳ משה רוע׳ אבן ישראל`. The read starts `ליתמ׳ מסה רוע׳ לכן יסרחל`.

All three are reversed: the check is right and the judge is wrong. So G4L's reversed rate was higher than reported: pilot 8/23 two-column pages (was 6), colfix 16/23 (was 15). The judge's order field is not reliable enough to gate on alone.

**Reading.**
- As a gate (write `correct` only), the check let through **0 reversed of 18 written**.
- What it costs is reads not written: 5/22 correct two-column reads and 6/7 single-column reads come out undetermined.
  - A single-column page has only one strip, so there is no order to check.
  - Passing 1-column pages is the obvious relaxation. It needs its own check that a two-column page is never detected as one column.
- Column detection is rough: it merges a column with a facing-page sliver on some pages and splits a header on others. The verdict survives because unfound strips drop out.

**Not done here:**
- Wiring it into `cli-ocr.mjs apply` (the next PR).
- A second Rashi book: one book and 30 pages is thin, and one printer's layout.
- The single-column relaxation.

Files: `results/g4-reread-pilot-6769/colorder-score.json` (per-read rows), `colorder-strips.tar.gz` (column boxes, strip sheets' replies).
