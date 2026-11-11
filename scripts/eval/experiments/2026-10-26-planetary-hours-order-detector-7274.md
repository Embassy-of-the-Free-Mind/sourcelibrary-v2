---
stage: ocr
measure: [accuracy]
languages: [ar, la, de, fr, en]
scripts: [Arab, Latn]
canons: []
n_books: 73148
n_pages: 15
verdict: "A text-only check that planetary-hours columns follow the fixed Chaldean order flags 71 pages in 46 books across the 2026-10-26 corpus mirror. By eye, 5 of 14 readable flags in a random 15 were real transcription or translation errors (36%), 2 faithful, 7 detector artifacts. On the Book of Wonders all 3 of its flags were real errors."
status: informational
decision: "Use the 71 as a by-eye review list, not an automatic correction; artifact fixes from this sample are in the detector."
superseded_by: null
issue: [7274]
---
PRIOR ART: `scripts/audit/ocr-loop-corpus.mjs` (whole-page loops; it cannot see one wrong cell). This entry is the follow-up to `2026-10-25-book-of-wonders-opus-correct-vs-argon-7274.md`, where the stored planetary-hours table on p.140 was wrong in 10 of 12 Friday cells.

## 2026-10-26 · Can a fixed order catch wrong table cells without an image or a model? (#7274)

**Check.** `scripts/lib/table-sequence-check.mjs` reads planet names (English, Latin, German, French, Italian, Arabic, symbols) column by column, in markdown tables and in runs of short lines. A column of 12+ names that mostly steps +1 through Saturn, Jupiter, Mars, Sun, Venus, Mercury, Moon and breaks somewhere is flagged with the cell where it breaks. `scripts/audit/table-sequence-corpus.mjs` runs it over the local mirror for $0. It also counts adjacent identical digit rows (1,550 pages, not calibrated).

**Corpus (mirror of 2026-10-26, 73,148 books, 9.72M pages).** 1,454 pages hold an ordered planet column. 71 pages in 46 books have a full hours column that breaks its order.

**Calibration.** 15 random flags, each checked against the page image by an Opus subagent:
- **5 real errors.**
  - Book of Wonders `6953b565…` p.140: the Friday column.
  - Book of Wonders `69907bd9…` p.141: night hours 2 and 10.
  - `69c89642…` p.-79: Thursday hour 2, Mercury for Mars.
  - Sibley `69b418b7…` p.-46: Saturn for Mercury.
  - `69592f2e…` p.131: a Capricorn glyph read as Saturn in a horoscope figure.
- **2 faithful.** The page itself breaks the order: a list of planets with epicycles, and conjunction pairs.
- **7 detector artifacts.**
  - Unread forms such as `solis` and `Vénus` (fixed).
  - A heading or `<vocab>` line read as a row (fixed for `#`/tag lines, not for a plain heading like "Saturni dies").
  - Index entries stitched into a column (not fixed).
- **1 unreadable.** A Gallica image would not load.
- Separately, Book of Wonders pp.140, 143 and 144 were checked by eye: 3 of 3 were real errors, and on 143 and 144 a faded red planet name had been guessed.

**Limits.** Precision is from 14 readable pages, about 36%; the fixes since may raise it, unmeasured. Recall is unknown: a wrong cell that happens to fit the order, or a table set in a layout the parser does not split, passes. The judge is a model looking at the image, with no specialist.

*Replicated?* No.
