# Preregistration — Yigdzin page-mode on the 5,132 "guttered" Tibetan pages (#6871 row 4)

Written 2026-10-20, before any read below was scored. PRIOR ART: `scripts/eval/PREREGISTRATION-tibetan-woodblock-yigdzin-5660.md`
(same reader, a Derge e-text reference; these pages have no e-text) and `2026-10-14-yigdzin-hidden-tibetan-books-4523.md`
(the run whose worker refused these pages).

## Why

The #4523 leaf worker refused 5,135 pages in 130 hidden Tibetan books because its gutter detector saw a bound-book
opening, not a pecha leaf (5,132 still have no `ocr.data` on 2026-10-20). Opening the first two drawn pages shows what
they are: a modern single book page and a pecha-shaped leaf in a modern reprint frame. Both are clean prints. The
question is whether Yigdzin 1 reading the **whole page** (no leaf cut) gives text we would serve. That decides whether
these pages get a reader (the GEX45, €0 marginal) or stay empty.

## Pages

30 pages from the 5,132, drawn page-weighted with at most 2 per book (19 books), LCG seed 6871
(`draw.mjs`, `draw.json`). Images: our archived JPEGs (R2), as a lane would read them.

## Arms (gex45 queue task `60-tib-gutter-bakeoff`, reads to files only)

- **page**: `yig_page.py --mode page`: BDRC/tibetan-ocr @ 50506eb6 under HF transformers 5.17, the model card's recipe
  (sequential M-RoPE, greedy, DRY 0.8/1.75/12), the processor's own resize.
- **bands**: the same, the image cut into 3 horizontal bands at the emptiest pixel rows, each read alone.

## Reference (fixed before scoring, by eye)

Opus is not a credible Tibetan *transcriber*: re-reading from the image it writes fluent Tibetan that is not on the
leaf (identity 0.70 vs Yigdzin 0.945, #6560; 0.26 in #6011). It is a credible *checker* (correcting a Yigdzin draft
made 0 of 30 folios worse, #6560). So the reference is structural, written blind of the reads, and the reads are then
checked line by line against the image:

1. **Before**: two independent Opus readers per page (images opened, full + two half tiles) record: does the page
   carry text; layout (book page / pecha leaf / opening of two pages / other); scripts present; the number of
   Tibetan body lines; header/footer/page-number lines; the first and last few syllables of the first and last body
   line. Kept as `references.jsonl` with both readers.
2. **After**: an Opus checker sees the image tiles and each arm's read (arm names hidden, order shuffled) and marks every
   read line `ok` / `minor` (a few syllables wrong) / `wrong` (mostly wrong) / `invented` (not on the page), lists
   body lines on the image that the read **dropped**, and flags a loop. `read-from-image` on every page.

## Rule (fixed now)

Instrument valid only if the two readers' body-line counts agree within ±1 on ≥ 25/30 pages.

An arm **PASSES** (and the 5,132 pages are queued for a page-mode read to files, the apply then following #4523's
write rule: v4 judge, `first-ocr-guard`, ≥ 150 syllables, revisions first) only if ALL hold over the 30:
1. **no invented text**: 0 pages with an `invented` line;
2. **line recall ≥ 0.95** pooled: body lines read (ok + minor + wrong) / reference body lines;
3. **≥ 27/30 pages** with no dropped body line, no loop, and ≤ 1 `wrong` line;
4. **ok + minor ≥ 0.90** of read body lines pooled.

If both arms pass, the faster one is the lane. If neither passes, these pages stay empty and the result is posted on
#6871; no further arm is queued without a new prereg.

`measure: accuracy` (by-eye check against the image), n = 30 pages / 19 books: this rules out a high failure rate,
not a low one.
