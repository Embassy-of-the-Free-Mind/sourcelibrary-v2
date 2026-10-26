---
stage: ocr
measure: judged
languages: [ar]
scripts: [Arab]
canons: []
n_books: 1
n_pages: 10
verdict: "On 10 pages of the Book of Wonders manuscript (5 known-error, 5 random), Opus correcting the stored Gemini 3 Flash text made 84 spans better and 9 worse, but where it disagreed with a fresh Argon read a blind Opus judge sided with Argon 89 to 46. On the random pages most of the serious stored errors (a planetary-hours table with 10 of 12 Friday planets wrong, a copied digit row, dropped section numbers) were fixed by Opus correction; Argon's remaining wins there were mostly the scribe's spelling. On the known-error pages Argon's wins include whole words and clauses."
status: undecided
decision: null
superseded_by: null
issue: [7274]
---
PRIOR ART: `2026-10-13-ocr-opus-correct-vs-lane-b-q300-6694.md` (Opus correction beat a fresh read 158–6 over 976 pages, 50 of them Arabic print); `2026-10-24-latin-lite-opus-correct-vs-flash-reread-5924.md` (Opus correction on Latin: 111 → 31 misleading pages of 250). This entry adds an Arabic manuscript, and Argon as the fresh read.

## 2026-10-25 · Book of Wonders: does Opus correcting the stored text match a fresh Argon read? (#7274)

**Book.** `6953b56577f38f6761bd979d`, 366 pages, an Arabic manuscript of wonders, astrology and divination. 318 pages carry Gemini 3 Flash OCR and translation. A by-eye check on 2026-10-10 found misreads on 9 of 10 pages.

**Arms.** A is the stored text. B is `scripts/batch/ocr-convergence/correct.mjs --model=opus --per-call=1`: the image plus the stored text, changing only what the image contradicts. C is Argon (high) through `cli-ocr.mjs read`. Job bw-correct-7274 cost $0 and wrote nothing to the database.

**Pages.** Known-error pages 7, 11, 12, 43 and 120. Five random pages, seed 7274, drawn from the 305 eligible pages in pp.20–360: 309, 164, 140, 64 and 222.

**Judge.** 292 differing spans. The texts were aligned word by word, because the engines break lines and place red headings differently. Each page went to one fresh Opus subagent, which saw only the image and two unlabelled readings (X/Y, random order).

| | Known-error pages | Random pages |
|---|---|---|
| Words where B and C agree | 86% | 93% |
| B's edits to A: better / worse | 56 / 2 | 28 / 7 |
| Where B and C differ: B right / C right | 29 / 65 | 17 / 24 |
| Spans wrong in both | 11 | 2 |

**Severity, random pages** (hand sort of the judge's rulings, 2026-10-26). The stored text had about 28 errors on these 5 pages.
- **About 21 change what the text says.** 10 of the 12 Friday planets in the planetary-hours table on p.140 were wrong, in the Arabic and the English. A digit row on p.64 copied the row above. Section numbers on p.222 and a red heading on p.164 were dropped, along with roundel letters and single words on p.309. A few phrases were garbled, such as `والدر بخت` for `والذي تحت`.
- **About 7 are spelling only.**
- Opus correction fixed nearly all of the serious ones. Most of Argon's wins over B on these pages are the scribe's own spellings, which B standardised: `وساادكر` four times, `تنصلح`, `لتجرية`. B's remaining misses that change meaning number about 5. Three of B's 9 worse edits also change meaning (`الرواح`→`الزواج`, `وحات`→`وجات`, a dropped `الله اكبر`, all on p.164).

**An independent check.** The planetary hours follow the fixed Chaldean order. The judge's readings of the Friday column match it exactly, the stored Friday column does not, and the stored Thursday column does. That table is the one place in this test where the ground truth does not depend on a model.

**Limits.** No Arabic specialist checked anything. The judge is the same family as arm B. Errors B and C share are invisible. 8 items were marked cant-tell, and faded red planet names were read partly from the planetary order.

**Not decided.** For the full book, the options are Opus correction of all pages (under a day), Argon on all ~357 pages, or Opus correction then Argon on the table and number pages. Argon at the default guard cap of 40 heavy calls per box per day would take about 9 days. The cap is our own setting; logs show 400–740 Argon calls a day on 2026-10-14/15. Artifacts are on the main box at `/mnt/HC_Volume_105839809/jobs/bw-correct-7274/`, and the full table is on #7274.

*Replicated?* No. One book, 10 pages.
