---
stage: pipeline
measure: [judged]
languages: [la, grc, fr, de, cu, pl]
scripts: [Latn, Grek, Cyrl]
canons: []
n_books: 7
n_pages: 30
verdict: "Opus read through claude -p on the subscription (claude-ocr.mjs / claude-translate.mjs, 3 pages a call) on seven hidden bath books: a blind Opus judge accepted the OCR on 29/30 pages (Latin 8/8, Greek 6/6, French 4/4, German 4/4, Church Slavonic 4/4, Polish 3/4) and the English on 30/30. One wrong-text page (Polish, Oczko scan 20: 'nieśmiertelné' for 'niewieczné') was found, and it has been fixed by hand. All 14 wrong-page controls were caught. 0/10 accept flips when the same item was judged twice. Each cell holds 1–2 books, so this is a cell test, not a rate."
status: undecided
decision: "No routing change. This is the first evidence for opus-read in these cells. Every cell is still untested under the router rule, because 4–8 pages from 1–2 books cannot carry a cell."
feeds: route
supersedes: []
superseded_by: null
---
PRIOR ART: none for these cells. No experiment in scripts/eval/experiments/ tests a Claude subscription read on Church Slavonic or Polish. The Greek and Latin opus tests (e.g. agy-opus-7545) used other books and the API/agy channel, not `claude -p`.

## 2026-11-12 · Is a Claude subscription read good enough for the bath books? (conceptual-histories#11)

**Who it is for.** The bath article in JDerekLomas/conceptual-histories needs these readable texts: Olga's bath-house in the Primary Chronicle, and Aristides' winter river at Smyrna. agy was out of quota until about 2026-11-15. On 2026-11-12 Derek directed Sonnet/Opus subscription reads for these books. This run is the cell test the brief asked for.

**Design.**
- Books (all hidden):
  - Primary Chronicle `6af5f8cdd9ec0ea7635aa87f`
  - Aristides `6adf8f02bf12d2ef205aea68`
  - Oczko `6af5f8cf2d7bc14fc2a45495`
  - Schwenckfeld `6adeb2e1a765b2fd7a094890`
  - Bacci `6adedf3cbf12d2ef2054684b`
  - Montaigne `6adecd6fbf12d2ef2053737e`
  - De balneis 1553 `6adee2a1bf12d2ef20548f71`
- Pages read: 222 in all.
- Draw:
  - 30 pages, 4 per book, except 6 from Aristides and 4 from the Chronicle.
  - A page qualified if its OCR came from claude-opus-5-5, had 300+ characters of body, had an English translation, and was not blank or a title page.
  - Pages were ordered by a seeded hash.
  - Oczko scan 6 was excluded because its title is a hand correction, not a model read.
- Judge: Opus, one output a call, blind arm names. The judge saw the page image together with the OCR (or, for translation items, the OCR plus the English).
- Controls: 14 wrong-page controls and 10 same-arm repeats.
- Files:
  - score: `scripts/eval/route-judge-6740/results/bath-reads-opus-cli-2026-11-12/paired-score.json`
  - also there: verdicts, key and recipe
  - packet not kept (R2: ids only)

| cell | arm | accept | wrong text | fidelity (mean) |
|---|---|---|---|---|
| OCR Latin (2 books) | opus-cli-ocr | 8/8 | 0/8 | 4.75 |
| OCR Greek | opus-cli-ocr | 6/6 | 0/6 | 4.83 |
| OCR French | opus-cli-ocr | 4/4 | 0/4 | 5 |
| OCR German | opus-cli-ocr | 4/4 | 0/4 | 5 |
| OCR Church Slavonic | opus-cli-ocr | 4/4 | 0/4 | 4.75 |
| OCR Polish | opus-cli-ocr | 3/4 | 1/4 | 4.75 |
| EN Latin (2 books) | opus-cli-tr | 8/8 | 0/8 | 4.5 |
| EN Greek | opus-cli-tr | 6/6 | 0/6 | 4.83 |
| EN French | opus-cli-tr | 4/4 | 0/4 | 4.25 |
| EN German | opus-cli-tr | 4/4 | 0/4 | 4.5 |
| EN Church Slavonic | opus-cli-tr | 4/4 | 0/4 | 4 |
| EN Polish | opus-cli-tr | 4/4 | 0/4 | 4.25 |

- **Controls.** All 14 wrong-page controls were rejected.
- **Noise floor.** Same-arm repeats: 0/10 accept flips.
- **By eye.** Separately, 3 pages a book were checked by eye against the image. No invented text was found. The small slips found:
  - Chronicle 102 drops "нъ" in родинъ, twice.
  - Montaigne 172: the English adds "to cool it".
  - De balneis 285: the English gives "effeminate" for *mollissimam*.
- **Hand fixes.** Two Oczko pages were fixed by hand: scan 6 (the title) and scan 20 (the wrong-text page). Both fixes were written revision-first.

**Recipe rules waived.** R1: the brief fixed 30 pages over seven named books (4–8 per language cell, from 1–2 books). These are not 30 independent pages.

### Replicated?

No. One judge family (Opus), and the judge is the same model family as the reader. A held-out draw from other books in these languages would be needed before any router cell moves.
