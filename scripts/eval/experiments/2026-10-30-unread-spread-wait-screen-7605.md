---
stage: image
measure: accuracy
languages: [de, fr]
scripts: [Latn]
canons: []
n_books: 2833
n_pages: 9500
verdict: "None of the 2,833 unflagged deu/fra books that the agy first-read lane held as 'possible unsplit spreads' needed a cut. Opus, reading 10-book contact sheets (one sheet per call), called 2,812 books single. Of the 21 it flagged or could not call, all 21 were single by eye once fold-out plates, maps, diagrams across an opening and binding openings were kept whole. On a 10-book control it matched a by-eye reading on every row, the same in both runs."
status: adopted
decision: "Mark the 2,833 books pipeline_auto.split_checked (scripts/maintenance/split-check-unread-7605.mjs) so the lane reads them; split nothing"
superseded_by: null
issue: [7605]
---
## 2026-10-30 · Are the books the first-read lane holds as possible spreads really spreads? (#7605)

PRIOR ART: `2026-10-29-split-cut-review-sheet-format-7605.md` picked Opus on contact sheets, one sheet per call, to
CHECK cuts. This uses the same judge to answer an earlier question: is there anything to cut?

**Decision it changes.** The brief for job split-unread-7605 assumed the lane's ~2,284 `spread_wait` books were
spreads waiting on `split-spreads-agy.mjs`. The lane's own `spreadReason()` said otherwise. 2,833 of the 2,834 books
carry its second reason: no crop data and no `pipeline_auto.split_checked`. Phase 1.25 never ran on them because they
are held. Sources: e-rara 2,074, MDZ/BSB 566, IA 179, other 14.

**Free AR screen** (stored `image_width/height` on every live page; Phase 1.25's 1.2 threshold):
- every page portrait: 1,420 books;
- some pages wider than 1.2: 26;
- most pages wider than 1.2: 10;
- some pages with no stored dimensions: 1,378.

AR alone was not trusted: it has missed narrow spreads before (#7605, ~50 books).

**Screen.**
- One contact-sheet row per book: pages at 25/50/75%, plus the widest page when any is wider than 1.2. Books with
  missing dimensions are measured from 12 thumbnails.
- 10 books a sheet, 284 sheets.
- `claude -p --model claude-opus-5-5`, Read tool only, one sheet per call, asked per image: one page, or two
  facing pages. Calls take about 5 s each, on the subscription.

**Control.** 10 books from the 2026-10-29 agy census: 4 multi, 6 single (one of them since split, so its live pages
are leaves). Opus matched a by-eye reading on all 10 rows, identically in two runs. That includes a two-page opening
in three books the census had called `single` (6a1dda33 p.25, 6a19d4e0 p.45, 6ac7e948 p.1). The widest-page slot is
what catches them.

**Result.** 2,812 single, 9 with a two-page image, 12 unclear.
- **The 21, opened at 420 px by eye.** Every one is single:
  - folding plates with blank or offset backs (the Wiegleb *Magie* volumes);
  - maps;
  - an oblong pattern book;
  - a diagram, a table and processional engravings printed across an opening (kept whole: cutting them splits
    the image);
  - an inserted folded letter, rear binding openings, a book photographed in its box;
  - single pages showing a strip of the facing page (trimming: #5876).
- **Spot checks of "single" rows with wide pages** (screen-071, -079, -082, -114): oblong writing-master books,
  maps with colour bars, oblong battle plates. All correct.

**Limits.** At most 4 pages are shown per book (12 thumbnails measured where dimensions are missing). A two-page
frame that is no wider than the book's single pages could be missed. That is the narrow-spread case, and its
signature here would be two text blocks in a portrait frame, which no sampled row showed. A missed frame is read
whole by the lane (both leaves on one page). It does not invent text.

**Not a cut, one book.** 69aeab17 (*Geschichte und Klassenbewußtsein*, IA) is still held by `spreadReason()`
because it checks `needs_splitting` alone. The book is already split (`split_completed`, 368 frames → 736 leaves) and
carries `needs_resplit`. `isUnsplitSpread()` in `pipeline-hold.mjs` respects `split_completed`; `spreadReason()` does
not. Left for the `ocr-spreads-7605` job: it has OCR.
