<!-- PRIOR ART: ../second-reader/CALIBRATION-ADDENDUM.md (appended after the frozen REVIEWER.md; it asks for classes
only). This addendum adds the one field the #6203 cross-family run scores: a KIND per error, from the shared
vocabulary (scripts/lib/review-vocabulary.mjs, .claude/docs/review-vocabulary.md). v1, 2026-10-12. -->

## Second addendum: name the kind of each error

Add a `kind` field to EVERY object in `ocr_errors`, `tr_errors` and `other`, beside its class. The kind says what the
wrong text IS, as a reader meets it. Use exactly one of these twelve words:

- `confabulation`: free invention. Text with no basis on this leaf or any other.
- `recitation`: a known text (a canonical edition, a familiar passage) put in place of what this leaf says.
- `wrong_leaf`: the whole text is of another leaf. Image and text are not the same page.
- `carry_over`: a neighbouring page's words on this page (a facing strip, a block shifted across the page boundary).
- `show_through`: text made from show-through, an offset, or an empty leaf.
- `illegible_fill`: a fluent guess where the leaf cannot be read, with no mark of doubt.
- `misread`: the right leaf and the right place, but wrong words, names or numbers.
- `mistranslation`: the transcription is right and the English says something else (a reversed sense, a wrong term).
- `omission`: text on the leaf that is missing from the transcription or the English (a dropped line, entry or passage).
- `layout`: the words are right and their order, tagging or structure is wrong.
- `added_gloss`: an explanation the model added. Report it only when it is wrong or not marked as a note.
- `other`: none of the above.

Choose by what you can SEE. If the image shows the words and the transcription has different ones, that is `misread`,
not `confabulation`. Use `confabulation` only when nothing on the leaf could have produced the text. If you cannot
tell between two kinds, pick the more modest one and say so in `problem`.
