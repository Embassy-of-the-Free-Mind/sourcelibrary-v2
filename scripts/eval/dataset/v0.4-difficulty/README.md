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
printed `<page-num>` disagrees are dropped. Measured here: **40.2% dropped**,
matching the documented rate. Without this filter the "hard" pages would mostly
be re-archived ones.

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

334 pages, 309 distinct books, 19 classes. 16 classes reached the target of 20.

| lane | rows |
|---|---|
| `self_reported` | 171 |
| `structural` | 95 |
| `proven_miss` | 39 |
| `scan_quality` | 29 |

Sampled 200,000 pages (149,834 carrying OCR text) and 14,000 revisions, of which
4,746 pairs were comparable and **3,103 (39.5%) were dropped as page-number
shifts** — matching the 40.2% documented for #3473.

Short of target: **`corrupt_scan` (9)**, limited by `scan_quality` coverage
(~1.5% of pages), and **`skew` (13)**, because the model almost never reports it
(13 candidates in 149,834 OCR'd pages). Both are properties of the corpus, not
of the sample size — filling them needs a different source (synthetic
degradation, or a targeted visual sweep), not a bigger `--sample`.
**`marginalia_missed` (19)** is one short only because a single exemplar was
dropped for having no reader URL.

`script_family` is 268 spaced / 66 space-less. 27 pages carry more than one
difficulty label.
