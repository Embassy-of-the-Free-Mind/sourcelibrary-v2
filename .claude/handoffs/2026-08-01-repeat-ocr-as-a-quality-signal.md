# Repeat OCR as a quality signal — 2026-08-01

Continues `2026-07-30-ocr-provenance-and-revision-corpus.md`. Everything below is
on **PR #3475** (branch `worktree-audit-revision-image-shift`), 14 commits, not
merged. Issue **#3473**.

## Where it started and where it landed

Started from "we need to align the misaligned OCR." **There was nothing to
align** — the live text is correctly paired with the live image on every page
checked (6 pages, 6 books, both offset signs). The +1 population is the #3357 /
#3368 repairs *landing*: 98.9% of those prior revisions were written in
2026-07, all top books are e-rara. `page_revisions` recorded the repair from
behind.

Derek's actual interest was **repeat-OCR inconsistency as a quality measure**.
That reframed the corpus work as the foundation for it.

## What is now true and measured

- **63,572 true repeats** exist free in `page_revisions` — same leaf, same
  model, same prompt. Isolating them required removing the 40% of pairs that
  read *different leaves* — not re-archiving but the #3357 repair moving `ocr`
  subdocuments between page docs (#3473).
- **6,420 unstable** (<0.85); 93% carry no degenerate/refusal/commentary flag.
- **It is not the scan.** Among pages the model rated, 491 of 497 unstable ones
  are rated a *good* scan; page-type is identical across arms.
- **Primary axis is manuscript hand** — 28.7% vs 2.6%, and 95% of every
  warning-bearing unstable page.
- **On printed pages the warning channel goes dark.** Printed pages are 69% of
  the unstable population and the biggest secondary category is five pages.
- **What passes disagree about:** 67% local glyph substitution, 20% mixed, 6%
  omission, 4.9% reordering (bag 0.98 vs seq 0.42 — clean separation), 2.3%
  divergent content.
- **Best triage signals, all free:** `<unclear>` marks 3.97 vs 0.02 (198×),
  length asymmetry 17×, page-type flip 4.5×, language flip 3.8%.
- **New class, found by the queue not by hypothesis:** the plate/text
  specification gap. Verified on Schott *Mechanica* p513. Baseline **0.34% of
  illustrated pages**. Prompt clause drafted, deliberately **not applied**.

## Tools left behind

`ocr-triage.mjs` (ranked queue + example set) · `ocr-difficulty-taxonomy.mjs` ·
`disagreement-classes.mjs` (bag-vs-sequence, has a pairing guard) ·
`plate-flip-rate.mjs` · `repeat-instability-draw.mjs` (blinded matched draw).
Docs: `ocr-difficulty-taxonomy.md`, `ocr-quality-measurement-loop.md`.

**`revision-agreement-corpus.mjs` now records `leaf_shift` per row** plus a
`strata_same_leaf` block. Full run is 15 min, 191,171 revisions. The 276MB
per-pair JSONL is not committed — regenerate it, everything downstream reads it.

## Next, in Derek's priority order

1. **Embed both sides of the existing pairs.** Cheap (embeddings ≪ OCR), no new
   OCR, and it converts the free stability corpus into a semantic one — telling
   us how much measured "disagreement" is meaning versus spelling. Levenshtein
   is not comparable across scripts (Chinese 36.7% word vs 72.7% char), so
   **embedding distance is what makes a single corpus-wide quality number
   possible at all.** Needs a spend decision. Validate against the 32 anchor
   pages before trusting corpus-wide.
2. **Vary the input, measure the variance.** Derek's palm-leaf "one panel at a
   time" generalises: hold the page fixed, vary resolution / crop / panel
   segmentation, N passes each, and the condition with lower variance is the
   better input. This is the experiment the session kept circling.
3. **Resolution is NOT free** — `pages` stores no width/height/bytes. Needs HEAD
   requests for `Content-Length` as a proxy.
4. The alignment claim still rests on **6 pages of 168 books**. Weakest thing
   still standing; the catchword chain (below) is the free way to scale it.

## Read this before trusting any aggregate here

Five claims in this session were wrong. Each was a plausible aggregate over a
broken instrument, none would have been caught by a green test, and every one
was caught by opening the artifact.

| claim | reality |
|---|---|
| catchword chain 1–3% | intact — naive tag-strip kept envelope prose |
| 15 difficulty categories | one — 15 regexes over the same sentence |
| "disagree on column count" 8.4× | 588/600 are a tag on one side only |
| ghost text "renders to readers" | it is in revision history; live pass is correct |
| plate fix "addresses 30%" | 0.34% — bucket size read as effect size |

Two of those are denominator errors and one is a field name read as its
contents — the exact failures CLAUDE.md already warns about, committed anyway.
**Compute the rate of the defect in the population the fix touches, before
scheduling the work.**

## CLAUDE.md check

No new invariant proposed. The lessons here are instances of rules the file
already has (denominators, opening the artifact, paired artifacts). The one
genuinely new candidate — *stability is not accuracy, and two passes reciting
memorised text agree perfectly* — should wait until the embedding work says
whether the distinction is measurable in practice.
