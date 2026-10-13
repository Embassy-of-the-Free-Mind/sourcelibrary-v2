<!-- PRIOR ART: OVERVIEW-ADDENDUM.md (a shelf read, 4 pages per book, a fit-to-show verdict for a scholar) and
CURATION-ADDENDUM.md (hand-picked books, a tier). Neither asks for the review vocabulary's KIND on each serious error,
nor for a containment call, and both assume several pages per book. This addendum is for served-draw.mjs packets
(#6691, the served-text audit): appended after the frozen REVIEWER.md, never edited into it. -->

## Addendum for this packet (served-text audit, one page per book)

This packet is not a fortnightly run. Each book has **ONE page** (sometimes two records with the same page number:
review both). Ignore the "run of 3 consecutive pages" wording above. The page was drawn at random from what readers
are served today. Read it against its image exactly as REVIEWER.md says.

Add these fields:

- On **every serious error** (in `ocr_errors`, `tr_errors` or `other`), a `kind` from this list, naming what the reader
  meets. Pick the one that fits; the class says where the error arose, the kind says what it is:
  - `confabulation`: text with no basis on this leaf or any other (free invention).
  - `recitation`: a known text (a canonical edition, a familiar passage) substituted for what this leaf says.
  - `wrong_leaf`: the whole text is of another leaf; image and text are not the same page.
  - `carry_over`: a neighbouring page's words on this page (a block shifted across a page boundary).
  - `show_through`: text made from show-through, an offset, or an empty leaf.
  - `illegible_fill`: a fluent guess where the leaf cannot be read, with no mark of doubt.
  - `misread`: the right leaf and place, wrong words, names or numbers.
  - `mistranslation`: the transcription is right and the English says something else.
  - `omission`: text on the leaf that is missing (a dropped line, list entry, note or passage).
  - `layout`: the words are right and their order, tagging or structure is wrong.
  - `added_gloss`: an explanation the model added, wrong or unmarked.
  - `other`: an empty or refused read, leaked reasoning, a wrong tag, a catalogue fault.
  Moderate and minor errors may carry a `kind` too; it is required only on serious ones.
- Per page, `form`: what the image shows: `"print"`, `"manuscript"` (handwriting, including a manuscript facsimile),
  `"typescript"`, `"blank"` (no text on the leaf), `"plate"` (an image, map or table with little text), or `"unsure"`.
- Per page, `not_this_leaf`: `true` only if some of the transcription or the English is **not this leaf's text**
  (kinds confabulation, recitation, wrong_leaf, carry_over, show_through, illegible_fill) AND you saw it with the
  image open. Then add `not_this_leaf_evidence`: one or two sentences quoting the stored text and saying what the
  image shows there instead. A misread, however bad, is not this. Otherwise `false`.
- Per book, `page_verdict`: `"show"` (the page is sound for a reader), `"show_with_caveat"` (usable; name the
  weakness in `book_verdict`), or `"do_not_show"` (a serious error, or text that is not on the leaf).

Leave `shelf_fit` as `"fits"` unless the work is plainly not what the catalogue says it is; there is no shelf here.
