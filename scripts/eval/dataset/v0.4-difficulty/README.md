# v0.4-difficulty — a labelled corpus of HARD pages

Companion to the pinned ground-truth set (`../v0.3/`), answering a different
question. Built for [#3469](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/3469).

The 44 pinned pages are **selected for being easy**: they exist because
scholarly etexts exist for them, which means clean canonical print. Every
quality claim measured against them is a claim about the easy end of the
corpus. This set is the other end — pages sampled *because* something about
them is hard.

## What it is not

**Not accuracy-scored, and it never will be.** Most hard pages have no
scholarly etext and never will; that is what makes them our frontier. Scoring
here is reference-free:

- **attribution** — is AI-authored prose tagged, or emitted bare?
- **gap marking** — are unreadable regions marked rather than silently filled?
- **two-pass stability** — same page, same prompt, twice.
- **cross-model agreement**, with the caveat that consensus *fails* on
  canonical text, where models recite the same memorized passage and agree
  while both misreport the page.

Accuracy-based scoring stays with `../v0.3/`.

**Blind to fabrication, by construction.** Two passes that both recite the same
memorized verse agree perfectly and look easy. That class comes from the
synthetic cloze probe (`../../cloze-probe.mjs`, and `/blog/reciting-not-reading`),
not from here.

## Three sourcing lanes, and why the label matters

Every row carries `sourced_by`. Reading a result without it will mislead you.

| lane | how a page got in | what it can support |
|---|---|---|
| `self_reported` | the page's own `<warning>` names its condition | "does this change help on damaged scans" |
| `proven_miss` | two OCR passes over the same leaf disagree | "how often do we **miss** this" |
| `scan_quality` / `structural` | `scan_quality.scan_class`, or declared layout | class membership is objective |

`self_reported` is **biased toward success**: a `<warning>` about foxing is a
page the model *noticed* the foxing on. It cannot measure misses. This is why
the marginalia class is sourced from revision disagreement instead — selecting
pages by their stored `<margin>` tag selects marginalia the model **found**.

### The #3473 filter is mandatory on `proven_miss`

~40% of `page_revisions` pairs do not read the same image. The #3357 e-rara
repair moved `ocr` subdocuments between pages, so the "disagreement" is an
administrative artifact replicated across thousands of pages. Pairs whose
printed `<page-num>` disagrees are dropped. Measured on this draw: **39.5%
dropped** (3,103 of 7,849), against the 40.2% documented for #3473. Without this
filter the "hard" pages would mostly be re-archived ones.

## Two findings that changed the design

**1. `<warning>` is mostly a script declaration, not a damage report.**
Measured on two independent random samples: warnings appear on ~19% of pages
(not the 3.8% assumed in #3469), and **95%** of warning bodies are of the form
`Handwritten Tibetan Uchen script` — a source declaration. The actual damage
classes are 10–500× rarer than the issue's taxonomy suggests, which is why
`ink_blot` and `skew` cannot be filled to target from self-report.

**2. `degenerate_output` is confounded with script family — read it within a
family, never pooled.** Space-less scripts flag at ~40% against ~4.5% for
spaced scripts. That gap survives every attempt to explain it away, including
grapheme-cluster windowing (45.0% → 42.9%), and it is consistent with the known
Tibetan failure rate of ~1/3. It is probably a real failure rate rather than a
metric artifact — but that is not proven, so every row carries `script_family`.

The detector itself took three tries, and the two wrong ones were caught by
`tests/unit/hard-page-degeneracy.test.ts`, not by reading the code:

- word type/token ratio — meaningless for space-less scripts (flagged ~20% of
  them for having no spaces);
- non-overlapping 24-char tiles — scored a genuine `तत्रैव `-loop at 0.14,
  because a period-7 unit never aligns with a 24-char tile boundary;
- **sliding-window `1 - distinct/total` over 24 characters** — phase-independent,
  bounded 0–1. This is what ships.

## Row schema

```
slug            <class>-<book-slug>-<page-number>
book_id         books.id
page_id         pages.id  (the reader route takes this, NOT page_number)
page_number     ordinal within the book
book            { title, author, year, language, ia_identifier, url }
reader_url      https://sourcelibrary.org/book/<slug>/page/<page_id>
image           { url }   resolved via getPageSource(), never a raw field
difficulty[]    one or more class labels — a page is usually hard for several reasons
sourced_by      self_reported | proven_miss | scan_quality | structural
evidence        the warning text, or the disagreement that qualified it
script_family   spaced | spaceless
scan_quality    pages.scan_quality, where present
```

## Regenerating

```bash
set -a; source .env.production.local; set +a
node scripts/eval/hard-page-census.mjs --sample=40000      # availability per class
node scripts/eval/hard-page-sample.mjs --sample=200000 --rev-sample=14000
```

The draw is random (`$sample` must be the FIRST pipeline stage — a `$match` on
`ocr.data` is an unindexed scan over millions of pages and exceeds `maxTimeMS`
every time). Re-running produces a different, equally valid sample; commit the
output if you want it pinned.

Selection caps at 2 exemplars per book **per class**, so no single class is one
book's quirk. A book may still appear in more than one class (the observed
maximum is 3 rows), which is why the 334 pages come from 309 distinct books.
Books with no slug are skipped — an exemplar you cannot open in the reader is
useless for this set.

## This draw

334 pages, 309 distinct books, 20 classes.

### A spot check found 11.7% of the first draw mislabelled — read this before trusting a class count

Opening exemplars against their stored OCR showed the `gutter_loss` sample was a
**blank page**: its warning reads *"the page is blank, save for a small amount of
text visible on the extreme left edge (the gutter) which belongs to the facing
page"*, and the classifier matched the word `gutter`. Systematically, **39 of 334
rows (11.7%) were declared blank by their own OCR** — `gutter_loss` 8/20,
`image_only_labels` 10/20, `foxing` 7/20.

A blank page cannot exemplify a text-difficulty class. They were **reclassified,
not discarded**, into a `blank_page` class: "does the model invent text on an
empty page" is one of the few fabrication probes available without ground truth,
and it is a real failure mode. The sampler now routes them there at source
(`isBlankPage`, keyed on the structured `<page-type>` tag rather than on warning
prose — a prose regex misfires both ways, and would have dropped *"significant
bleed-through makes some text difficult to read"*, a genuine hard page).

The cost is that **11 classes are now under the target of 20** and only 8 reach
it. That is the honest composition of this draw; a wider `--sample` refills them.

| filled | short |
|---|---|
| `blur` `cropping` `degenerate_output` `handwriting` `microfilm` `multi_column` `spaceless_script` `tabular` (20 each) | `staining` 19 · `truncation` 19 · `marginalia_missed` 18 · `fading` 16 · `ink_blot` 16 · `bleed_through` 15 · `foxing` 13 · `gutter_loss` 12 · `skew` 12 · `image_only_labels` 10 · `corrupt_scan` 9 |

`blank_page` holds 38 — larger than target because it absorbed the reclassified
rows rather than being drawn to quota.

| lane | rows |
|---|---|
| `self_reported` | 144 |
| `structural` | 124 |
| `proven_miss` | 37 |
| `scan_quality` | 29 |

Sampled 200,000 pages (149,834 carrying OCR text) and 14,000 revisions, of which
4,746 pairs were comparable and **3,103 (39.5%) were dropped as page-number
shifts** — matching the 40.2% documented for #3473.

### Verified against the images, 2026-08-02

The two pages that transcribed >50 characters in the blank-page study were
opened and looked at. They are **not** the same kind of thing:

- **Bhagvat Geeta, leaf 73** — genuinely mislabelled. The scan is a spread whose
  right leaf is a fully printed NOTES page with a footnote table; only the left
  leaf is blank. Relabelled `multi_column`, so `blank_page` now holds 38.
- **Artis Cabalisticae, leaf 6** — correctly labelled `blank`. A title-page
  verso carrying mirrored bleed-through plus two library stamps; nothing is
  printed on that side. **Both** the production prompt and the Tier-2
  bleed-through arm transcribed the show-through anyway. Kept as `blank_page`,
  and it is the clearest single exemplar of the Tier-2 failure (#3444).

The lesson generalises: a page flagged by this metric is a *question*, not a
verdict. Of the first two, one was the corpus's fault and one the model's, and
only opening the image told them apart.

Two classes are short for reasons a bigger `--sample` cannot fix:
**`corrupt_scan`** is limited by `scan_quality` coverage (~1.5% of pages), and
**`skew`** because the model almost never reports it (13 candidates in 149,834
OCR'd pages). Filling those needs a different source — synthetic degradation, or
a targeted visual sweep. The rest are short because of the blank-page
reclassification above, and a wider draw refills them.

`script_family` is 268 spaced / 66 space-less. 24 pages carry more than one
difficulty label.
