# The double-OCR dataset — which pages were actually read twice

**Living doc.** Update it or archive it under its last-accurate date; do not cite a
stale copy. Numbers here were measured 2026-08-03/04.

## What the dataset is

`double_ocr_pages` (Mongo, 163,495 rows) and `double_translation_pages` (128,883).
One row per page carrying a stored revision, answering the question everything else
assumes: **does this page have two or more independent model passes over the same
leaf, and how good is the evidence for that?**

Fields worth knowing: `double_ocr`, `independent_reads`, `usable_pairs`,
`leaf_evidence`, `excluded_reasons`, `book_shift_verdict`, and `passes` (the full
chain — source, model, prompt version, timestamp, printed page number per pass).
Indexed on `double_ocr` + `leaf_evidence` and on `book_id`.

Regenerate with `scripts/eval/double-ocr-pages.mjs [--field=translation]
[--write-collection]`. Free — Mongo reads only.

| | OCR | translation |
|---|---:|---:|
| pages carrying a stored revision | 164,664 | 133,287 |
| **pages with a genuine second pass** | **97,421** | **70,502** |
| verified same-leaf / unverified | 63,776 / 33,645 | 788 / 69,714 |

## A revision is not a second read

Five populations look like a double read from inside `page_revisions` and are not.
The filter is `scripts/lib/revision-pairs.mjs` — **use it; do not re-implement it.**
Consumers: `revision-agreement-corpus.mjs`, `hard-page-sample.mjs`,
`disagreement-typology.mjs`, `double-ocr-pages.mjs`. `calibration-scorecard.mjs`
reads the corpus summary and inherits it.

| exclusion | what it is | OCR pairs |
|---|---|---:|
| `text-move-source` | the #3357 e-rara repair MOVED text between pages; the revision is the neighbouring leaf | 56,822 |
| `different-leaf` | the two sides print different page numbers — an unlabelled image swap | 5,330 |
| `different-script` | the two sides are in different writing systems — #3362 cross-book contamination | 3,809 |
| `book-shifted` | unverified leaf in a book whose verified pairs are mostly shifted | 1,822 |
| `human-edit` / `derived-text` | a person's edit; a blank-page marker or mechanical tag repair | 22 |

**Both halves are needed and neither sees the other's case.** The printed
`<page-num>` catches an unlabelled image swap; only the `source` label catches the
repair sweep, whose relocated text frequently prints the same number as the page it
landed on. A per-**book** verdict sits on top because a uniform slide preserves the
printed sequence exactly, so unnumbered leaves in an affected book pass every
per-pair check.

**An unrecognised `source` is refused, not folded in.** A bulk writer that borrows a
pipeline label (`ai`, `batch_api`) is indistinguishable from real model output
forever after. The alarm has already earned its keep once, surfacing blank-page
markers and mechanical tag repairs.

## What it can and cannot support

**It can support**, as descriptive statistics over a measured population:
- counts and disagreement rates per language / era / model / prompt / script class
- **disagreement as a lower bound on error** — if two passes differ, one is wrong.
  No ground truth needed; the strongest claim the data supports.
- the convention/reading decomposition (below)

**It cannot support** corpus-wide accuracy, or a cross-language quality ranking.
Three reasons, all structural:

1. **Coverage is 0.67%.** 97,421 pages against ~14.5M OCR'd pages (19.1M total,
   75.8% ±0.4pp carry OCR). The verified tier is 0.44%.
2. **Selection is not random and cannot be corrected.** A page is here because
   something re-OCR'd it, for reasons nobody recorded.
3. **96.9% of pairs are one model reading twice** — often the same prompt version.
   That is repeatability, not two opinions. Only 3,620 pairs are cross-model.

The fix for all three is a probability sample, not more filtering:
`scripts/eval/sample-rerun-baseline.mjs` selects one (different model, same prompt,
stratified, weighted). ~5,000 pages ≈ $3.36. **Selection only — it spends nothing.**

## Inconsistency, not error

A mismatch is inconsistency. Whose inconsistency is the question that decides
whether it counts:

- **Instrument noise — excluded.** Annotation syntax (`[[meta:]]` vs `<meta>`; we
  changed the output format) and #3362 contamination (our archiver). Not the model.
- **Rendering-policy inconsistency — counted.** Macron expansion, hyphen glyph,
  u/v, ligatures. Both readings faithful; the model still rendered one page two ways.
- **Reading inconsistency — counted.** Glyph confusion, truncation, degeneration.

`agreement_folded` **decomposes** the last two rather than discarding the middle
one. Raw stays the headline — a reader sees raw text. Corpus-wide, convention is
**6.6%** of average disagreement: Latin +2.4pt, Italian +2.5, Greek +2.0, against
+0.3 for English and German.

**The same-prompt cut matters more than folding.** Latin reads 82.3% overall and
**90.0%** among pairs where both sides ran the same prompt version; Italian 54.6%
against **86.4%**. Any cross-language comparison that ignores this is substantially
ranking how often we changed prompts on each corpus.

**The fold is Latin-only.** Its NFD step strips combining marks, which in Tibetan,
Devanagari, Arabic and Hebrew are the vowels — applied there it deletes the script
and reports the wreckage (Tibetan read −9.7 points). It abstains on non-Latin.

## Derived artifacts

| artifact | what it is |
|---|---|
| `revision-agreement-corpus.mjs` | pair-level agreement + ~30 covariates; feeds the calibration scorecard |
| `scripts/eval/dataset/v0.5-difficulty/` | 322 pages for eval, four lanes. Supersedes v0.4, which was selected before the filter and carried 7 contaminated pages |
| `build-adjudication-items.mjs` | volunteer questions (below) |
| `sample-rerun-baseline.mjs` | manifest for an unbiased second pass; nothing submitted |

## Asking humans the right question

`build-adjudication-items.mjs` turns disagreements into span-level judgements —
"which of these two readings matches the image?" — answerable in seconds, against
10–30 minutes to transcribe a page. It never asks a volunteer to produce text whose
own errors would then be indistinguishable from the OCR errors being measured.

**The human gets the residue.** Anything folding can settle is not put to a person:
convention-only differences, punctuation, and line-break hyphenation (`inso-`
against `insolubles.` — both passes read the same marks and differ on whether to
rejoin; the answer is not on the page). The metric measures convention, the human
measures reading.

Also rejected before anyone sees them: `<image-desc>` prose (a preview asked whether
the page said "beginning" or "start", from inside a description of a decorative
initial), space-less scripts (a Han page is ~22 whitespace tokens against ~310 for
Latin, so a "substitution" pairs a clause against a fragment), and alignment
artifacts.

Design requirements, each load-bearing: blinded and order-randomised; `neither` as a
real option because both passes are often wrong together; `can't tell` kept separate
as evidence about the **scan**; gold items with known answers; ~10% overlap for
inter-annotator agreement; answer key in a separate file.

**Out of scope by construction:** pages where both passes AGREE and are both wrong.
Agreement is blind to recitation, so no adjudication of disagreements can reach it.
That needs whole-page review of canonical texts, and it is the one question that
cannot be answered by spending money instead of volunteer time.

## Watch-outs for anyone extending this

- **The translation side is weakly filtered.** Its two strongest tests are
  structurally inert: the leaf check verifies 788 of 70,502, and cross-script catches
  6 pairs because a translation is English whatever the source is. It rests almost
  entirely on the source label. Do not publish translation consistency numbers
  without saying so.
- **Sample across books, never by file order.** The JSONL is ordered by `page_id`,
  which clusters by book. A first cross-script measurement read 2.3% that way; the
  truth over the full population was 27.6%.
- **32 pairs run `devanagari→latin`** — the direction that would mean new damage
  rather than repair. Unexamined.
- Related: #3558 (translation contamination), #3473 (`page_revisions.source`),
  #3362 (cross-book contamination), #3357 (the e-rara repair).
