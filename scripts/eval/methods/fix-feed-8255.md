---
id: fix-feed-8255
version: 1
stage: [ocr, translation]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [8255]
status: active
---
<!-- PRIOR ART: served-audit.md and fortnightly-spot-check.md (REVIEWER.md: a random draw, scores per page, a book verdict;
no stage per defect that a repair lane can act on) and lane-spot-check.md (a lane's check of its own output). This one
re-reads books that already carry a `fix` verdict, to name the stage of each defect. -->
## fix-feed-8255 v1 — the diagnosis read that turns a `fix` verdict into a repair

**What it is for.** A `fix` verdict says a book has a serious defect; it does not say which lane repairs it. This read
names the stage of each defect (OCR, translation, the page unit, invented text). The rows are read by
`scripts/eval/error-zoo/labels.mjs` and so by `repair-queue.mjs`, which gives each flagged page its router cell and
route; pages whose text is not the leaf's are contained (`containment-on-finding.md`). It answers
"what repair does this book need?", not "how good is the corpus?": the frame is books already found bad.

**Sampling.** `frame.selection` is `picked`. Frame: visible books whose latest image-opened `book_checks` row is `fix`
(469 on 2026-11-13). Pages: up to 4 the earlier row flagged (`page_findings`, serious `page_notes`, else its
`pages_read`), plus 2 pages it did not read, with OCR of 300+ characters and English, ordered by sha1(`8255|page_id`)
(`scripts/eval/fix-feed-8255/packet.mjs`). The flagged pages are biased toward defects by construction, so no rate from
these rows describes a book or the corpus; the 2 extra pages are the only unselected ones, and 2 is too few for a rate.

**Reader and input.** One Opus subagent per 2 to 4 books, with `scripts/eval/fix-feed-8255/READER.md`, the page image on
disk, the stored OCR and the stored English. A page counts only if the reader says it opened the image. Reader in the
row: `{kind: model, model, image_opened: true}`.

**Serious.** A page is serious when a reader is misled about what the source says: sense changed, a passage dropped or
invented, another leaf's text, a name or number wrong where it matters. `page_findings` name the stage (`ocr`,
`translation`, `other` for the page unit) and a review-vocabulary `kind`; no taxonomy class.

**Verdict.** `verdict_source: rule`, per page: `fix` for a serious page, `caveat` for a minor one, `show` for a clean
one; the book takes the worst. A row here is a second read of a selected book, so `reader_warning` is true only through
its findings: it warns on the pages it names and its clean pages say "checked" for those pages alone.

**Qualitative record.** Every page read has a `page_notes` entry (the reader's note, `outcome`, `verdict` =
`<prior>/<confidence>`), and `text_provenance` holds the hashes of the text judged, so a later re-read or
re-translation makes the row stale by construction. Evidence: `scripts/eval/fix-feed-8255/results/verdicts.jsonl.gz`.
