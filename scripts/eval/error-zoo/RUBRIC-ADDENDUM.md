<!-- PRIOR ART: SEVERITY-RUBRIC-PROPOSAL.md (the rubric, for people) and scripts/eval/second-reader/CALIBRATION-ADDENDUM.md
(the frozen addendum every weekly-audit reader gets). This is the rubric written as one more addendum, sealed in after
those two by run-readers.sh EXTRA_BRIEFS (Opus) and second-reader.mjs --addendum (Gemini), for the calibration set's
"rubric" arm only. It keeps the output schema, so the collector and scorer are unchanged. v1, 2026-11-12. -->

# Severity addendum — consequence for a reader who quotes the page (calibration set, v1)

This addendum **replaces the severity definitions** in the brief above. Everything else in the brief stands.

## The one question

For every error, ask: **if a reader quoted or cited this page, what would they get wrong?**

- `serious` means **critical**: the reader would publish something the book does not say.
  - Text not on this leaf: invented, recited from memory, another leaf's text, an illegible patch filled in fluently.
  - Meaning reversed, or who does what to whom changed; a negation lost or added.
  - A name, number, date, dose, measure or citation changed. This is critical in the transcription even if only one
    letter or digit differs: it is what a citer copies.
  - A line or more dropped with no mark; the English rendering a different text from the transcription.
- `moderate` means **major**: misled locally but recoverable from context, or apparatus lost. A wrong word sense that
  makes a sentence odd but not false; a qualifier weakened; a footnote, marginal note or gloss dropped or merged; table
  structure lost; reading order broken inside a sentence; a wrong added note that is clearly marked as a note.
- `minor`: the words a reader would quote are right. Spelling normalised, an abbreviation expanded correctly,
  punctuation, a heading level, italics, a running head left in.

**Not errors at all:** `<summary>`, `<keywords>`, `<sig>`, `<page-num>`, `<header>`, `<vocab>` (the reader moves them out
of the reading text), `<leaf-break/>` and `<column-break/>` (the reader renders them), an expansion marked as one, text
marked `<unclear>` that is genuinely unclear.

## Two extra fields

- On **every** error, add `"sure": true` or `"sure": false`. `false` means you think it is an error but the image does
  not let you be certain. Be honest: an unsure critical is checked by a second reader, never counted alone.
- On every **page**, add `"band"`: `"usable"` (no critical, at most one major), `"care"` (majors, no critical) or
  `"not_usable"` (any critical). Decide it after listing the errors.

Every error still needs its quote: an error without the exact served words is not recorded.
