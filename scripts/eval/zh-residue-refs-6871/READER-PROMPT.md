# Reader brief (passes A and B, identical text)

You are making a **reference transcription** of classical Chinese book pages (Siku Quanshu 四庫全書 manuscript
copies, scanned) so that OCR engines can later be scored against it. Accuracy matters more than speed. You read
from the image only: there is no other text for these pages, and you must not fill in from memory of the work.
If you recognise the passage, still transcribe only what the image shows.

For each page id you are given, these images exist in `$IMG` (open them with the Read tool):
- `<id>_full.jpg` — the whole page
- `<id>_R.jpg`, `<id>_L.jpg` — right and left halves (full height, a little overlap)
- `<id>_R1.jpg`, `<id>_R2.jpg`, `<id>_L1.jpg`, `<id>_L2.jpg` — quarters (top/bottom of each half) for small type

Open the full page and both halves at least; open quarters wherever characters are small (double-line notes,
tables, diagram labels). Do not open any other file in the scratch directory.

## Convention
- **Characters as printed.** Traditional forms; keep variant forms the scribe wrote (e.g. 㑹 not 會, 竒 not 奇)
  when you can see them. Do not normalise, do not modernise. Distinguish 已/巳/己, 曰/日, 未/末 by the image.
- **No punctuation added.** Copy only marks that are printed (e.g. ○ as a table symbol or a printed circle).
- **Reading order:** columns right to left, each column top to bottom. **One output line per printed column.**
- **Small double-line notes (雙行小注):** inline at their position, wrapped in `〔` `〕`; inside, right sub-column
  then left sub-column, continuing into the next column's note if it continues there.
- **Tables / grids:** cells in the order the table is read (normally by column, right to left, each column top to
  bottom; if the table is clearly read by row, by row), cells separated by ` | `, one output line per table
  column (or row). An empty cell is written as an empty slot between separators. A ruled header cell counts as
  a cell. Say in `layout_note` which way you read it.
- **Diagrams / illustrations:** write `[圖]` once, then the labels inside it, as cells (` | `), right to left,
  top to bottom.
- **Seal / clerical / archaic head glyphs** (篆書, 古文, 隸書, bronze-inscription forms) drawn as glyphs, not
  in regular script: write the regular-script (楷書) character it represents inside `⟨ ⟩`, e.g. `⟨一⟩`. If you
  cannot identify it, write `⟨□⟩`. Do not guess a character you cannot see; `⟨□⟩` is a correct answer.
- **Non-Chinese script** (Manchu, Mongolian, Tibetan, Arabic, etc.): in `text` write a placeholder
  `[滿文]`/`[蒙文]`/`[藏文]`/`[other]` at its position (one per column or cell). In `foreign`, give your
  transliteration attempt per placeholder in order (Möllendorff for Manchu), with your confidence. An honest
  `null` is better than an invented reading.
- **Illegible** Chinese characters: `□`, one per character (your best estimate of the count).
- **Exclude** from `text`: the fold strip / running title at the page edge (欽定四庫全書, the work title, 卷 number,
  leaf number), collectors' seals and stamps. Put fold-strip / running-title text in `margin` instead.
  A title or heading INSIDE the ruled text frame is body text, include it.

## Output
For each page write one JSON file `$OUT/<id>.json` (UTF-8, use the Write tool):
```json
{"page_id":"<id>","page_kind":"body|blank|non-body","layout":"prose|notes|table|diagram|seal|mixed",
 "layout_note":"one line: columns, reading direction for tables, anything unusual",
 "text":"line\nline\n…","margin":"…","foreign":[{"placeholder":"[滿文]","translit":"…","confidence":0.0}],
 "n_han":0,"confidence":0.0,"confidence_note":"which characters/areas you are unsure of and why",
 "uncertain":["the specific characters you doubt, each as 'col N: X (or Y?)'"]}
```
- `page_kind`: `blank` if no text at all; `non-body` for a cover, endpaper, colour card, fold-strip-only leaf.
- `n_han`: your count of Han characters in `text` (excluding placeholders and `□`).
- `confidence` (0–1): your honest estimate of the share of characters in `text` that are exactly right. Be
  calibrated, not modest or proud: 0.99 means about 1 wrong character in 100.

When all your pages are written, reply with one line per page: `<id> <page_kind> <layout> n_han=<n> conf=<c>`.
