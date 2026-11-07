<!-- PRIOR ART: JUDGE-ADDENDUM.md here, without its point 2 (several transcriptions side by side): the solo control's brief. -->
# Addendum for this packet (#7947 reader test)

This packet differs from the brief above in two ways. Everything else in the brief holds.

1. **Transcriptions only.** There is no translation. Set `tr_score` to `null` and `tr_errors` to `[]` on every page,
   and judge only the transcription against the image (`ocr_score`, `ocr_errors`, `other`, `right_page`).
2. **Book-level fields.** The packet holds ONE book. Set `shelf_fit` to `"fits"`, `shelf_note`, `rights_flag` and
   `structure_note` to `null`. `on_sight_defect` and `book_verdict` are about the transcriptions only.

The pages are not consecutive here: they are 3 pages from across the book.
