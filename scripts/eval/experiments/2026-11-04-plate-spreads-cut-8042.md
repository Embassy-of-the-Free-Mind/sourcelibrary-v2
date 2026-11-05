---
stage: image
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 4
n_pages: 34
verdict: "Plates that cross a fold were cut into two pages by three paths: the source's own two-leaf photography (IA Piranesi Carceri, 16 plates), split-book.mjs gutter-only (BPH Khunrath, its own read said 'illustration, split-position null'), and the Dec-2025 in-app crop split. A model-free per-frame rule over each frame's stored read and detections flags 74 split-book frames in 35 books; 19 of 20 sampled flags were one image cut in two (8 plates or maps across a fold, 11 single leaves or covers), 1 was a real two-leaf spread and the rule was tightened to exclude it. The old-era crop signal is 6/12 by eye, too weak to act on blind. 72% of flagged books (BPH 21 + Kloss 4 of 35; BPH 29 of 30 old-era) are partner reading-room books."
status: adopted
decision: "Guard in split-book.mjs (both lanes) keeps such a frame whole and flags it; repaired Piranesi (16 plates) and the BIUSante Khunrath Emerald Table by eye; BPH/Kloss repairs wait for Derek because they remove pages from a partner reading room (#8042)"
superseded_by: null
issue: [8042, 7605]
router_evidence: "none — an image-splitting rule, not an OCR/translation router lane"
---
## 2026-11-04 · How many plates spanning a fold did our splitters cut into two pages, and what keeps them whole? (#8042)

PRIOR ART: `scripts/maintenance/fix-false-split-portrait-pages.mjs` (single-leaf frames by aspect ratio: a plate across
a fold is as wide as a real spread, so it cannot see these), `scripts/maintenance/hide-repeat-captures.mjs` (the
`repeat_of` retire mechanism, reused), `split-book.mjs` Step 2.5 (the book-level `imgFrac` plate gate, which never looks
at a single frame).

### What was reported
Feedback 6ae342a1 (Khunrath's Emerald Table split; "a number of the EFM books") and 6ae78ce2 (Piranesi Carceri
page 69de98e21b234a773e439839 "should be unsplit").

### Three shapes, all seen on the images
1. **The source photographed the plate as two leaves.** IA `gri_33125010859573` (Piranesi, *Carceri*, 70 pages):
   pages 6+7, 10+11, … 66+67 are the 16 plates, each as two leaf photos that compose without a seam. No splitter
   of ours was involved. Repair: join the two images into one R2 object; the left page shows it, the right is retired.
2. **split-book.mjs gutter-only cut a plate in a text book.** BPH `69ef33e2` (*Amphitheatrum*, run `spwmc8`,
   2026-06-08): frame -127 (Emerald Table) became leaves 237/238 and frame -125 (another plate) became 233/234. The
   frame's own read said `<page-type>illustration</page-type>` with `<split-position>null</split-position>`. The
   book-level gate counted the book as text (imgFrac < 0.25) and the frame's read was never consulted.
3. **The Dec-2025 in-app split** cropped one archived image 0–500 / 500–1000 into two pages (BIUSante Khunrath
   `69487f16`, p.11/12, the Emerald Table; the book is hidden as a duplicate of `6952d086`).
   The visible kept copy `6952d086` (Google scan) has the plate on leaves 267/268 whose images overlap (the text
   block is in both). They do not join cleanly, so the pair is listed and was not touched.

### Census (model-free)
- **New era (split-book frames, `page_type: 'archived-spread'`, 200,596 frames):** `plateSpanVerdict()` flags
  **74 frames in 35 books** (v2 rule). By eye, 20 of the 83 v1 flags: **19 were one image cut in two** (8 plates or
  maps across a fold: Münster's *Cosmographey* BPH `69c8716b` alone has about 20 maps cut this way; 11 single leaves
  or covers, which belong to fix-false-split-portrait-pages' class). **1 was a real two-leaf spread** (BPH `68679f27`
  frame -3, a text page facing a title page, one detection box drawn round both). v2 no longer lets a text or
  title-page read keep a frame whole, which removes it.
  Books: 21 BPH, 4 Kloss collection, 10 with no tenant.
- **Old era (crop pairs where both halves are plate-typed and a detected image touches the cut):** 100 pairs in
  30 books (29 BPH). By eye **6 of 12** are plates across a fold. The other 6 are correct splits: two separate
  woodcuts on facing pages. Too weak to apply without an eye on every pair.
- **Source two-leaf photography (shape 1) outside Piranesi:** bbox-adjacency gives 772 tight candidate pairs in 132
  books, which is noisy (the rule missed Piranesi 10/11 on a y-offset). None were checked by eye, so no total is
  claimed.

**What the signals cannot see:** a frame with no stored read and no detections; a plate whose read says `text`; a
frame
read by a single-page prompt (no `<split-position>`), unless a detection crosses the cut; and in the old era any pair
whose halves were never typed as plates.

### Repairs (by eye, `scripts/maintenance/restore-plate-spreads.mjs`)
| book | pairs | run | state |
|---|---|---|---|
| Piranesi *Carceri* 69de98e2 | 16 joins | plate8042-pir-1 | applied; p.11 URL redirects to p.10, which shows the whole plate (headless check) |
| Khunrath BIUSante 69487f16 (hidden duplicate) | 1 unsplit-crop | plate8042-biu-1 | applied |
| Khunrath BPH 69ef33e2 | 2 unsplit-frame | (dry run) | **refused: tenant.** Asked on #8042 |
| BPH 697c8e13 p66, 697d9ca2 p135 & p252, 698255e9 p377, 69a0278f p46 | 5 unsplit-crop | — | confirmed by eye, tenant, listed |

Each kept page has `cropped_photo` set to the whole image and `plate_whole.before`; each retired page has
`repeat_of` set to the kept page. Both are also logged in sweep_log. `--revert <run> --books …` restores them. 17 kept pages carry a read
of half a plate: listed in `needs-read.jsonl` for a separate read job. Their gallery_images rows (31 for Piranesi)
are listed for `regen-split-gallery-images.mjs`.
