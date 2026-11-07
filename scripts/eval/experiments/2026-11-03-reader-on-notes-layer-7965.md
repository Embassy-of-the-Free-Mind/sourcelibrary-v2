---
stage: pipeline
measure: agreement
languages: []
scripts: []
canons: []
n_books: 800
n_pages: 800
verdict: "The reader rendered from the notes layer (translation.text + the newest current page_annotations doc, composed by layerMarkup, drawn by NotesRenderer) matches today's reader on a fresh one-page-per-book draw of 400 backfilled pages: notes ON, 352/400 identical visible text, 46 spacing or whitespace only, 2 a doubled word the renderer's own #5700 repair now removes. Notes OFF, 372/400 identical and 6 spacing or whitespace only. On the other 22 the layer is the right side: on 20, today shows model commentary as the book's words, and on 2, today hides the book's words after an unclosed tag. No page shows model words with notes off that today hides. 40 pages read by eye with the scan: the layer is right on 26 of the 30 diffs, 3 are acceptable spacing, and 1 is mixed (a marginal diagram filed as an image note)."
status: informational
decision: "The reader reads the layer where a page has one (step 1 of #7965); every other page takes today's path, unchanged"
superseded_by: null
defect_rates: "none — a render-equivalence gate of the reader, no translation was judged for defects"
issue: [7965]
---
## 2026-11-03 · The reader on the notes layer: gate (#7965 step 1)

PRIOR ART: `scripts/eval/notes-layer-5942/pilot-checks.mts` compared the parser's clean TEXT with today's notes-off reader
(`prepareNotesMarkdown`, squashed). This gate compares what the reader RENDERS: `ReaderProse` → `NotesRenderer` to static HTML,
from today's `translation.data` and from the layer, with notes on and off. Scripts: `scripts/eval/notes-reader-7965/`
(`gate.mts`, `scan.mts`, `eye-sheet.mts`). Rows: `scripts/eval/results/notes-reader-7965/`.

**Draws.** `$sample` over `page_annotations`, one page per book, kept when the page's `translation.text` is current and the doc is
the newest one with the current hash. The *dev* draw (400) was used to find and fix composer rules. The *final* draw (400, no page in
common) was drawn after the code froze. All 800 took the new path: 0 orphans, 0 fallbacks.

### Final draw, visible text (400 pages)

| class | notes ON | notes OFF | what it is |
|---|---:|---:|---|
| HTML byte-identical | 318 | 367 | |
| visible text identical (HTML differs) | 34 | 5 | split mark spans, block order of hidden page blocks |
| whitespace only | 23 | 4 | blank lines from page blocks (meta, summary) moved to the top or bottom |
| spacing at a note chip | 23 | 2 | "817c" → "817 c": a space before a note the model wrote with none (notes on); "flash—shot" → "flash —shot" (notes off, 2 pages) |
| doubled word removed | 2 | 0 | `X <term>X</term> <note>…` now meets the renderer's #5700 repair ("governance governance" → "governance") |
| today shows model words; layer hides them | 0 | 20 | a note nested in a margin, insert or gloss, which today's renderer flattens into the book's words; a definition inside a term chip |
| today hides book words after an unclosed tag; layer shows them | 0 | 2 | the parser's unclosed-tag rule; the cost is the few model words inside the unclosed tag (#5942) |
| **layer shows model words today hides** | **0** | **0** | |

The dev draw gave the same picture: notes ON 373 identical, 26 spacing, 25 whitespace, 1 bold marker; notes OFF 373 identical, 5 spacing, 22 today-shows-model-words.

### Composer rules found on the dev draw (each a test in `tests/unit/reader-text-layer.test.ts`)

`renderMarkup` alone (a faithful rebuild) read 37 pages differently with notes on and 27 with notes off, 5 of them the wrong way round
(model words shown with notes off). `layerMarkup` adds these rules:

1. Malformed annotations (unclosed, stray close) are not put back. A lone `<margin>` made the renderer read the rest of the page as margin.
2. A note never lands inside a mark: the mark is split around it, and the spaces stay outside the tags. Today's renderer flattens a nested note into plain words, notes on and off.
3. Empty marks are left out. A rebuilt `<margin></margin>` sorts its close before its open.
4. A term definition goes after the model's space when a markdown closer follows, so `**<term>Iyatē</term> <gloss>he goes</gloss>**` keeps its bold. A note between a space and a word gets the space after it back.
5. Notes the page ends on (footnotes) get their own paragraph.
6. Marks that end or start together nest. This is a fix in `renderMarkup` itself, which crossed `</margin></term>`.
7. Fallback: an orphan, or a result whose inline tags do not nest, returns null, and the reader serves today's path.

**Scan (composer only, 2 × 5,000 docs).** 0.13 ms mean, 7 ms max per page. Second scan: 6 of 4,974 current docs (0.12%) fall back to today's path. Five are garbled pages whose annotation bodies hold tag text (`<gloss>a paste</term>`); one has an orphan.

### By eye, 40 pages with the scan open

There were 30 pages from the final draw whose visible text differs, worst class first, plus 10 seeded random identical pages. Four Opus readers each took 10, image opened for each page. Per page they checked:

- model commentary in the notes-off text;
- page words missing from the notes-off text;
- notes attached to the wrong words;
- which side of the diff is right;
- rendering defects.

Verdicts: `by-eye-40.json`.

- **Diffs: layer right on 26, acceptable spacing on 3, mixed on 1.** On the mixed page (Aristotle, Barocci 70 f.161), the model's "A schematic diagram…" note also carries the translated diagram labels, so hiding the note hides those labels. Today shows them with notes off.
- **Notes misplaced: 1 of all notes on 40 pages** (borderline: Greek fish names after "Oppian").
- **Problems the readers found that both paths share** are not part of this change. Each is listed in the verdicts:
  - hidden interpolations leave a double space or a stranded comma;
  - a ⚠ condition warning shows as page text;
  - a word printed on the page is stored only as an `original:` note, so notes off hides it (#5942's open class);
  - margin labels sit mid-sentence.
- **One invented page:** Maximus Confessor p.336 (`69942f5cb2f6748db4ac09d9`). The OCR is a repetition loop (872 words, 116 distinct) under a dense rubricated folio, and the English translates the loop. Posted on #3878. The book is already in `loop_quarantine_hold`.

### Not measured here

Search, quotes, embeddings, exports and the MCP still read `translation.data`. No PLAIN + notes-step page exists yet, so every page measured has an `inline-v*` doc. The notes-step source is exercised only by the unit test.
