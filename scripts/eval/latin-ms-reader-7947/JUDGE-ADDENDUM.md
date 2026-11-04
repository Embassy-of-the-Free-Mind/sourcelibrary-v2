<!-- PRIOR ART: scripts/eval/spot-check/OVERVIEW-ADDENDUM.md (the same mechanism: REVIEWER.md verbatim, an addendum
for what this run differs in). #7947 reader test: OCR only, several readers' transcriptions of the same pages. -->
# Addendum for this packet (#7947 reader test)

This packet differs from the brief above in three ways. Everything else in the brief holds.

1. **Transcriptions only.** There is no translation. Set `tr_score` to `null` and `tr_errors` to `[]` on every page,
   and judge only the transcription against the image (`ocr_score`, `ocr_errors`, `other`, `right_page`).
2. **Several transcriptions of the same pages.** The packet holds ONE book, and its entries are transcriptions of
   the same 3 pages made by different readers. Each entry has its own `book_id` label (for example `b07-k`); write one
   result object per entry, keyed by that label, in the same schema. Judge each entry on its own against the image, to
   the same standard. Do not prefer a reading because other entries share it, and do not mark an entry down because
   it differs from the others: the image decides. Download each page image once; every entry's page with the same
   `page_number` is the same image.
3. **Book-level fields.** Set `shelf_fit` to `"fits"`, `shelf_note`, `rights_flag` and `structure_note` to `null`.
   `on_sight_defect` and `book_verdict` are about that entry's transcriptions only.

The pages are not consecutive here: they are 3 pages from across the book.
