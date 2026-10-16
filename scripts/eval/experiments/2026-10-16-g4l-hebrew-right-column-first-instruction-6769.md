---
stage: ocr
measure: judged
languages: [he, arc]
scripts: [Hebr]
canons: []
n_books: 1
n_pages: 23
verdict: "A right-column-first instruction makes Gemini 4 Argon low's column order on two-column Hebrew pages WORSE, not better: it read the left column first on 15/23 Zohar Chadash pages (65% [45, 81]), against 6/23 (26% [13, 46]) on the same pages without it. Target was <= 1. The text itself still beat flash-lite OCR on 18/18 OCR-served pages and lost on 5/5 Sefaria-fitted ones, as in the pilot. The Rashi re-read lane is blocked until an order check exists."
status: rejected
decision: "Do not send this instruction. The Rashi/mixed re-read waits for an order check (#6769)."
superseded_by: null
issue: 6769
---
## 2026-10-16 · Does a right-column-first instruction fix G4L's column order on two-column Hebrew pages? (#6769)
PRIOR ART: `2026-10-16-gemini-4-argon-low-reread-pilot-greek-ms-rashi-6769.md` (the pilot that found 6/23 reversed, same pages, same judge).

**Question.** The pilot found G4L reads the left column of a two-column Zohar Chadash page first on 6 of 23 pages. Derek's brief (2026-10-16): add a right-column-first instruction, re-run those 23 pages, target ≤ 1 reversed; if not met, stop.

**Design.** The pilot's 23 two-column pages, re-read with `cli-ocr.mjs read --model=gemini-4-argon-low --instruction-file=results/g4-reread-pilot-6769/rashi-colfix-instruction.txt` (the live OCR prompt plus that paragraph; agy 1.4.0). Judged exactly as in the pilot: `draw.mjs --n=23 --controls=5` (controls drawn from the same pages), `judge.py` (Opus 5.5 through `claude -p`, blind, image whole + halves), `score.mjs`. $0: 23 agy calls, 28 `claude -p` calls.

**Result.**

| | pilot (no instruction) | with instruction |
|---|---|---|
| G4L column order, 23 two-column pages | correct 17, **reversed 6** | correct 8, **reversed 15** |
| G4L vs served, OCR-served pages | better 25/25 (30-page draw) | better 18/18 |
| G4L vs served, Sefaria-fitted pages | worse 5/5 | worse 5/5 (now skipped by the apply) |
| controls | 5/5 | 5/5 |

Read from the image (me): p.33 — the right column opens `אדם מאי משמע כתיב הכא עליו`, the left `רעייה דמסר נפשיה`; the instructed read opens with `רעייה דמסר`. The judge's "reversed" is right.

**Reading.** The instruction does not make the model find the right-hand column; it makes it worse at it. The order is not fixable by prompt wording alone on this evidence. Candidates for an order check, none built: read the two column crops as two attachments named in order; or locate the right half's first line (a crop) in the read and rotate the text there.

Files: `results/g4-reread-pilot-6769/{key,verdicts,score}-rashi-colfix.*`, `reads-g4l-rashi-colfix.tar.gz`, `rashi-colfix-instruction.txt`.
