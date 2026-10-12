# The review vocabulary: kind, exposure, k of n books

PRIOR ART: `.claude/docs/page-error-taxonomy.md` (44 classes by lane: where a defect arose) and `.claude/docs/quality-statements.md` (how to word a quality claim for readers). Neither says what KIND of wrong text a reader meets or whether a reader could see the page that was judged, which is why "invented" was one word for six kinds quoted from flagged or hidden samples (`.claude/docs/measurement-validity.md`, repair 2).

**Read this when** you write or change a review of served text (a reader brief, a gate, an audit, a spot check), record a verdict, or quote a rate of "invented", "serious" or "wrong" text. Code: `scripts/lib/review-vocabulary.mjs`. Tests: `tests/unit/review-vocabulary.test.ts`.

## Three rules

1. **Every serious finding names a kind.** The reviewer names it. Where a record has only a taxonomy class, the class's default kind applies (table below).
2. **Every verdict records exposure**: whether a reader could see the text when it was judged.
3. **A rate is k of n BOOKS, one page per book, with a Wilson 95% interval, and the headline is served text only.** `kOfNBooks()` does the counting, `formatKOfN()` the wording ("3 of 40 books (8%, 95% CI 3–20%)"). Three pages of one book are one observation of that book.

## Kinds

| kind | what the reader meets | not on the leaf? |
|---|---|---|
| `confabulation` | free invention: text with no basis on this leaf or any other | yes |
| `recitation` | a known text (a canonical edition, a familiar passage) substituted for what this leaf says | yes |
| `wrong_leaf` | the whole text is of another leaf: image and text are not the same page | yes |
| `carry_over` | a neighbouring page's words on this page: a facing strip, a block shifted across a boundary, a continuity leak | yes |
| `show_through` | text made from show-through, an offset or an empty leaf | yes |
| `illegible_fill` | a fluent guess where the leaf cannot be read, with no mark of doubt | yes |
| `misread` | the right leaf and the right place, wrong words, names or numbers | no |
| `mistranslation` | the transcription is right and the English says something else | no |
| `omission` | text on the leaf that is missing: a dropped line, list entry, note or passage | no |
| `layout` | the words are right and their order, tagging or structure is wrong | no |
| `added_gloss` | an explanation the model added; fine when marked and right, a defect only when wrong or unmarked | no |
| `other` | none of the above: an empty or refused read, leaked reasoning, a wrong tag, a catalogue fault | no |

The six "not on the leaf" kinds are `INVENTING_KINDS`; a report gives them as one count ("text not on the leaf") and by kind. Do not write "invented" for the six together without the split, and never for a misread.

`omission` is not in the audit's list of seven. It is here because a dropped line is one of the three planted controls, and the audit found the gate under-calls dropped list entries.

## Exposure

| exposure | meaning | read from |
|---|---|---|
| `served` | English is on the page for a reader (a translation, or the transcription of an English-language book) | `translation.data`, or `books.language` English + `ocr.data` |
| `withheld` | the page's English was withheld; the reader sees the original only | `pages.translation_withheld` |
| `no_english` | the book is live and the page has no English | neither of the above |
| `hidden` | the book is not live | `books.visible !== true`, or `pages_count: 0` |
| `unrecorded` | a backfill of a run that kept no record; never produced by `exposureOf()` | — |

`exposureOf({ book, page })` is pure; `pageExposure(db, bookId, pageNumbers)` reads it live. Record it when the page is drawn or the verdict is written, not later: a withheld page reads as `withheld` only until it is repaired.

## Where it is recorded

| writer | kind | exposure |
|---|---|---|
| `recordBookCheck` (`book_checks`) | `page_findings[].errors[].kind`, validated | `exposure: [{ page_number, exposure }]`, one per page read, **required** |
| #5826 gate (`quality_gates`) | `failure_classes[].kind` (`--failure-classes=O1:2:recitation`; default from the code) | `sample_ids[].exposure`, required, read by `quality-gate.mjs record` |
| #6420 weekly audit | the reader's `kind`, else the class default; `report.json` `typed` | `draw.json` `pages[].exposure` (not shown to the reader) |
| #5914 spot check | the same, in `report.json` `typed` and `book_checks` | `draw-log.json` `exposure[book_id][page_number]` |

## Reading old rows (no backfill)

Rows written before 2026-10-12 are not rewritten. Read them with this mapping.

| old field | where | read as |
|---|---|---|
| `classes: ['O1', …]` | `book_checks` | `kindOfClass(code)` per code |
| `page_findings[].errors[].class` | `book_checks` | `kindOfClass(class)`; `wrong_page: true` is `wrong_leaf` |
| `class: 'ocr-wrong-leaf' / 'ocr-unsettled' / 'ocr-misread'` | `book_checks` rows of `ocr-convergence` | `wrong_leaf` / `other` / `misread` |
| `failure_classes[].code` | `quality_gates` | `kindOfClass(code)` |
| `ocr_errors[] / tr_errors[] / other[]` `.class` | spot-check and audit review files | `kindOfClass(class)`; `right_page: 'no'` is `wrong_leaf` |
| no `exposure` field | all of the above | `unrecorded`. Do not infer it from today's `visible`: books are hidden and released after a check |
| the words "invented", "fabricated", "hallucinated" in a note or a report | prose | not a kind. Re-read the page, or quote the claim with its source and say the kind was not recorded |

## Class → default kind

| kind | classes |
|---|---|
| `confabulation` | O1, O2 |
| `recitation` | O3 |
| `wrong_leaf` | I1, I2, I6, T14 |
| `carry_over` | I4, T4, T5 |
| `show_through` | none by default: a reviewer names it (O1 on a blank leaf) |
| `illegible_fill` | T7 |
| `misread` | O6, O7, O8 |
| `mistranslation` | T8, T11, T12 |
| `omission` | O5, O10, T1, T9, T13 |
| `layout` | I3, I5, O4, O9, O11, O12, O13, O14, O17, T3, T6, T16, D1 |
| `added_gloss` | T10 |
| `other` | I7, O15, O16, O18, T2, T15, T17, E1, E2 |

A default is a fallback, not a finding. O1 covers both free invention and a guess on an illegible leaf; the #6519 re-check found the Hebrew "invented" page was a heavy misread. When the kind matters to the claim, the reviewer's own kind is the evidence.
