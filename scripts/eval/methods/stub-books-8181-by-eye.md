---
id: stub-books-8181-by-eye
version: 1
stage: [ocr]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [8181]
status: active
---
<!-- PRIOR ART: lane-spot-check.md (the quick judge a running lane makes of what it just wrote, with OCR and English, by a
frozen prompt in a sealed folder, and warns readers); judged-pages.md (route judging, a fidelity scale). This one is a go/no-go gate between
waves of held books, transcription only, read in the job's own session with no translation yet to read. -->
## stub-books-8181-by-eye v1: the gate between waves of the 25-page stubs (#8181)

**What it is for.** To decide whether the next wave of stub books may be held for the first-read lane. It answers one
question: did the last wave write invented or wrong-leaf text? It does not measure reading accuracy.

**Sampling.** The frame is every page the wave wrote (`ocr.pipeline: agy-first-read-7701`) in books held
`preview-stub-first-read-8181`. One page per book drawn with `Math.random` (unseeded, so a draw cannot be repeated), at
least 30 pages; when a book has no written page, the shortfall is topped up with a second page from another book.
`frame.selection` is `random`. Blank leaves and plates stay in the draw: a blank leaf with text on it is one of the
failures looked for.

**Reader and input.** The job's Opus session opens the exact image the lane read (`ocr.engine.input.image_url`, sha256
checked against the stamp) and reads it beside the stored transcription. Reader in the row:
`{kind: model, model, image_opened: true}`. A page whose image was not opened is not a verdict.

**Serious.** Only text that is not this leaf's text: `wrong_page` (another leaf's text) or invented text (words the leaf
does not carry). Either one stops the rollout and goes to `containment-on-finding.md`. Misreadings are not serious here;
they are `defects` with a severity: `cosmetic` (a slip, long s as f, a stray entity), `misleads` (a clause reads wrong,
a dropped sign, guessed letters).

**Verdict.** `verdict_source: rule`. `fix` for a serious page, `caveat` for a page with a `misleads` defect, otherwise
`show`.

**Readers.** `reader_warning: false`. One page a book answers a question about the wave, not about the book, and these
books are still being read. The rows are listed on the book's checks page and derive nothing else.

**Known blind spots.** One reader, one read per page, no planted controls. 0 findings in 30 pages only bounds the rate
of bad pages below about 10% (95%, rule of three); it cannot exclude a rare failure such as the 2 in 460 on #7966.
Spelling and punctuation were read at reading speed, so `clean` means no slip was noticed, not that none exists.

**Rows written by** the job, through `recordPageVerdicts()` (`scripts/lib/book-checks.mjs`), one row per book per run.
Evidence: `box:<host>:<path>`, the job's `verdicts.json`; the row holds the record because that file does not last.
