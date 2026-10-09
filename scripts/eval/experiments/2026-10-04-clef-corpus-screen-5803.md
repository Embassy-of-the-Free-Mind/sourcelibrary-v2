---
stage: image
measure: judged
languages: []
scripts: []
canons: []
n_books: 41096
n_pages: 41096
verdict: "151 of 41,096 visible books (0.37%) show a clean one-page text/image shift on the sampled page; 86 are e-rara PDF archives (10.7% of e-rara screened)."
status: informational
decision: null
superseded_by: null
issue: 5803
---
## 2026-10-04 · Across the whole visible corpus, how many books carry another page's text beside an image? (#5803) — RESULT

PRIOR ART: scripts/eval/experiments/2026-10-04-clef-page-image-screens.md — the 1,497-book random subset that measured the ~0.8% lower bound; this runs the same check on every visible book.

**Headline: 151 books (0.37%, 95% CI 0.31–0.43%) show a clean one-page shift on the one page sampled.** Every one of them is
Internet Archive (65) or e-rara (86). e-rara is the hot spot: 86 of 807 screened books (10.7%), all archived from the
e-rara PDF (`erara_pdf`, the #5803 Group C cover-sheet cause). By eye, 10/10 clean shifts agreed with the neighbour Clef picked.

**Design.** Clef (`@cf/cloudflare/clef`), the `same_page` noul question, 1024px JPEG. One random page per visible book
(`visible: true, pages_count > 0`), with `page_number` in [1, pages_count], ≥ 300 chars of OCR and an R2 image. Pass 1 tried up to 4
random pages per book. Pass 2 sampled server-side among eligible pages for the books pass 1 skipped. Flags (p < 0.5) went to
`clef-shift-check.mjs`:
- **clean**: image N vs text N±1 ≥ 0.95 AND the mirror (text N vs image N∓1) ≥ 0.95.
- **one-sided**: any neighbour pair ≥ 0.7.
- otherwise **no neighbour match**.

**Result.**

| | books |
|---|---|
| visible | 42,077 |
| screened | 41,096 (30,153 pass 1 + 10,943 pass 2) |
| no page with ≥ 300 chars of OCR and an image | 980 |
| flagged p < 0.5 | 1,355 (3.30%, CI 3.13–3.47%) |
| clean shift | 151 |
| one-sided | 486 (217 are BL Tibetan multi-folio photos) |
| no neighbour match | 718 |

Which side, for the 151 clean shifts:
- **e-rara, image-side, 53.** The image shows text N−1, and the OCR predates archival (IIIF read, then a PDF archive with a cover sheet).
- **e-rara, text-side, 33.** The image shows text N+1, and the batch OCR read the shifted archive (the Group D shape).
- **IA, image-side, 32.** `bulk-archive-alignment.mjs` reports dHash shift+1 (#3368).
- **IA, #5309-stranded, 6.** `jp2_offset_repaired` is set, images are aligned, and the text is still +1. This is the known residual.
- **IA, undetermined, 27.** The alignment audit is ambiguous, or the book is not `bulk_jp2`.

**The no-neighbour class is mostly not a text defect.** 294/718 are non-text leaves by their own `<page-type>`: blank, illustration,
binding. Their stored "OCR" is an image description of ≥ 300 chars, which Clef rightly refuses to call a transcription. All 5 opened
were this: a binding, an illumination, a coat of arms, a board and a fore-edge. Of 4 opened text pages, 1 was a real wrong leaf (a loc
Chinese woodblock), 1 a Clef false alarm (Dutch blackletter), 1 the right page with degenerate OCR (Buginese), and 1 could not be
read (Tibetan cursive).

**Not shown.** One page per book, so this is a lower bound on books with a shifted *run*: a book shifted only over its batch pages (as in
Group C) passes if the sampled page is a preview page. 752 e-rara books have `erara_pdf` archives, and only 86 showed the shift on the
sampled page. The by-eye checks cover 10 clean shifts and 9 non-matches, not the one-sided class. *Replicated?* The 1,497-book subset
(same day) gave 11 clean shifts in 1,497 (0.73%). The two rates are not directly comparable. The subset required pages_count > 30 and ≥ 500 chars on the page and its neighbour. It
also ran before the #5803 repairs fixed 7 of its books.

**Spend** $16.80 Clef ($14.58 screen + $2.20 neighbour check), under the $35 cap. No writes.

**Artifacts.** `scripts/eval/jev/clef-corpus-screen.mjs` (resumable, one JSONL row per book); `scripts/eval/jev/clef-shift-check.mjs`
(now runs on Linux and resumes). Summary plus the flagged list (no page text): `scripts/eval/results/clef-corpus-screen-2026-10-04.json`.
