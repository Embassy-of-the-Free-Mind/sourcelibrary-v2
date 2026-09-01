# The corpus dataset — flat tables for analysing the double-OCR corpus

Builder: `scripts/eval/build-corpus-dataset.mjs`. Output: `scripts/output/corpus-dataset/`
(scratch — not committed). Free: Mongo reads and local compute, no model calls.

This doc is the thinking around the dataset, not a column list — the builder's
header block and `manifest.json` carry that. Read this before doing analysis on
it, because the two biggest facts about this corpus are both traps.

---

## 1. Three tables, three units of analysis

Most wrong conclusions about this corpus come from analysing the wrong row. A
metric's name is a claim about its denominator (see the `reading_history`
lesson in `CLAUDE.md` — "62% of members came back" counted user+**book**
sessions, not days).

| table | one row is | n (scope=revised) |
|---|---|---|
| `books.csv` | a book | 2,139 |
| `pages.csv` | a page — re-OCR'd **and** single-OCR | ~800K |
| `revisions.csv` | one stored prior text | 191,221 |
| `book_terms.csv` | a (book, term) TF-IDF pair | top 40/book |
| `tfidf_vocab.csv` | a (corpus, term) doc-frequency | — |

The existing pair-level table from `scripts/eval/revision-agreement-corpus.mjs`
(one row per rewrite *transition*, carrying the agreement metrics) joins to
these on `page_id` / `book_id`. This builder does not recompute agreement — that
file's metric is the house standard and should stay the single definition.

Note the unit differences that matter:

- A **page** with 3 revisions contributes 1 row to `pages.csv` and 3 to
  `revisions.csv`. Averaging agreement over revisions weights heavily-rewritten
  pages more than pages; averaging over pages does not. Say which you meant.
- 19,808 of 164,664 re-OCR'd pages have **more than one** revision. Treating the
  corpus as "pairs" silently drops the later steps of those chains.
- Books are wildly unequal: the top 200 books hold **50%** of all revisions,
  median 25 revisions/book. Any per-revision statistic is dominated by a few
  books. **Per-book shares survive this; sums do not.**

## 2. The selection problem — read this before quoting any agreement number

`page_revisions` is **not** a sample of "the same page read twice." It is a log
of every time stored text was overwritten. The two largest contributors are
data-repair sweeps in which **the image under the text changed**:

| contributor | n | what it is |
|---|---|---|
| `source='shift-repair-erara-2026-07'` | 56,413 (29.5%) | #3186/#3357. `repair-erara-text-shift.mjs` **moved** text from p(N+1) to p(N). The "prior" side is the *neighbouring page's* transcription. |
| `created_at` in Mar–Apr 2026 | 84,307 in April alone | The #3362 window, when `archive-bulk.mjs` wrote pages to a shared `archived/undefined/<n>.jpg` key and OCR read other books' images. |

This is the measured cause of the warning in `CLAUDE.md` that ~40% of pairs
report a different printed page number. It is not noise around the edges — it is
roughly a third of the corpus, by construction, and it is **labelled**: nobody
needed a heuristic, the `source` column said so all along.

Columns provided for this:

- `provenance_class` — `text_move_repair` | `human_edit` | `reocr`. Asserted only
  from an explicit source label; everything unlabelled is `reocr`.
- `printed_page_shift` / `shift_offset` — does the printed `<page-num>` the model
  read *off the page* differ between the prior text and the live text. This is
  the per-row version of `scripts/audit/revision-image-shift.mjs`, which
  previously only ran on a sample.
- `in_undefined_key_window` — a **hypothesis** column, not a verdict. The window
  is necessary, not sufficient.

**Minimum filter for any agreement claim:**
`provenance_class == 'reocr' AND printed_page_shift != True`.

### How much survives that filter

Full corpus, all 191,221 OCR revisions. Reproduce with
`node scripts/eval/corpus-dataset-report.mjs` (offline, reads the CSVs only):

| step | n | share |
|---|---:|---:|
| all OCR revisions | 191,221 | 100% |
| − `text_move_repair` (source-labelled) | −56,413 | 29.5% |
| = candidate re-OCR | 134,808 | |
| − printed page number shifted | −2,843 | |
| **= clean same-image re-OCR** | **131,965** | **69.0%** |
| − also inside the #3362 window | −96,606 | |
| = most conservative corpus | 35,359 | 18.5% |

**The headline correction: once `text_move_repair` is removed by its source
label, the residual leaf-shift rate is 4.2%, not ~40%.** `CLAUDE.md` and
`revision-image-shift.mjs` report ~40.2% of pairs showing a different printed
page number, measured on the raw corpus. Nearly all of that is the e-rara text
move, which is *labelled* — so the corpus is far healthier than the raw figure
suggests, provided the label is used.

**But the shift test abstains on half the corpus.** A printed page number is
readable on both sides of only **50.1%** of candidate pairs, so 4.2% is a rate
among the testable half and therefore a **lower bound** on image churn, not a
clean bill of health.

**Do not routinely subtract the #3362 window as well.** It costs 73% of the
remaining corpus, and it is a hypothesis flag: #3362 affected ~300 books /
130,040 pages, not everything OCR'd in March–April 2026. Use the 35,359 figure
only as a floor for a claim that must be unimpeachable.

### Words per page (clean corpus, n=119,222)

```
mean 344   p10 66  p25 167  p50 289  p75 428  p90 650  p99 1480  max 8139
```

Unimodal, mode at 300–399 (18.8%), long right tail. Stripping annotation moves
the mean only 344 → 326, but the **zero bucket triples, 1.4% → 4.4%**: those are
covers, endpapers and plates whose entire "text" is an AI image description.
They disagree between passes by construction and must never be read as OCR
losing text — `revision-agreement-corpus.mjs` calls this stratum `image_only`.

And the standing caveat from the audit script: a shift proves the image
*changed*. It does **not** say which side is correct — #3357 was a repair, so
some shifts are the fix rather than the damage. Separating those needs archive
history (`batch_jobs.page_sources`, `archived_photo` provenance), not OCR text.

## 3. Why `pages.csv` contains pages that were only OCR'd once

Because otherwise nothing about the re-OCR'd population is testable. "Re-OCR'd
pages are longer / later in the book / more marginal" is unfalsifiable against a
table containing only re-OCR'd pages. The table therefore holds **every page of
every scoped book**, flagged `is_double_ocr` / `n_revisions`, so the control is
*within-book* — which also absorbs the book-level confounds (provider, scan
quality, language, century) that would wreck a between-book comparison.

Selection still operates at the book level: these 2,139 books were re-OCR'd for
a reason. `books.csv` carries `provider`, `dominant_scan_class`, `quality_score`,
`revision_sources` so that reason can be modelled rather than assumed.

## 4. TF-IDF decisions

- **IDF is computed within a language corpus**, never globally. A global IDF
  would make language the dominant axis of every book vector — a fact about the
  corpus mix, not about any book. Uses the ngram viewer's language-aware
  tokenizer (`scripts/lib/ngram-normalize.mjs`: Latin u/v + i/j folding, Greek
  polytonic folding, ligature expansion, line-break de-hyphenation).
- Languages the ngram viewer doesn't model (Chinese, Tibetan, Arabic, Sanskrit…)
  keep their **own name** as the corpus key rather than sharing an `other`
  bucket — pooling them reintroduces exactly the problem above.
- **Editorial wrappers are stripped before counting.** `<meta>`, `<summary>`,
  `<keywords>` etc. are AI prose *about* the page that routinely names content
  from adjacent pages. Counting them fabricates term frequencies the same way
  quoting them fabricates citations (`CLAUDE.md`, quote integrity; #3175 applied
  the same rule to the ngram build).
- HTML entities are de-padded first. `&amp;` otherwise tokenizes as the word
  "amp", which ranked **2nd** by TF-IDF in a Latin alchemical volume.
- Pages are sampled **evenly through the book** (60/book), not the first N —
  front matter vocabulary is nothing like the body block.
- Single-letter terms are dropped by default (`--tfidf-min-len=1` restores
  them). Genuinely lossy in one known case: Trithemius's *Polygraphy* is a
  cipher manual whose ten strongest terms are all single letters.

### Measured quality (2,136 books, 69 corpora, 715,194 vocab rows)

Good: Latin reads `elementis aerem aer ignis aqua elementorum` for a treatise on
the elements; Chinese and Tibetan produce plausible content terms.

**Four defects, all real, listed because each changes how a result should be
read:**

1. **German is still function-word dominated at full scale, and `--tfidf-max-df`
   does NOT fix it.** I predicted more books would let IDF suppress these. It did
   not. Measured document frequencies in the 456-book German corpus:

   | term | df/N | | term | df/N |
   |---|---:|---|---|---:|
   | `und` | 0.910 | | `vnd` | 0.268 |
   | `der` | 0.967 | | `vnnd` | 0.221 |
   | | | | `nit` | 0.237 |
   | | | | `deß` | 0.349 |

   A max-df cut at 0.5 removes the **modern** spellings, which were never the
   problem, and leaves every **archaic** one — the exact terms topping the
   rankings — making the output worse, not better. It also destroys real content:
   Latin `aqua` sits at df/N 0.586 and `ignis` at 0.491. **Do not use
   `--tfidf-max-df` on this corpus.** The principled fix is orthographic folding
   inside `tokenize()` for German (`vnd`→`und`, `nit`→`nicht`), mirroring what it
   already does for Latin u/v and Greek polytonic. Until then, filter downstream
   using the emitted `doc_freq` / `tf` / `n_docs`.

2. **`books.language` is the edition language, not the text's** — so the Greek
   pool contains Latin. Its top-ranked book, *The Complete Works of the Divine
   Plato*, scores `vt soc est vero quod esse non ad`: a Latin translation of
   Plato filed under Greek, contaminating Greek IDF. Known issue
   (`books.language = edition, not source`); it degrades every per-language pool.

3. **`books.language` is free text with no controlled vocabulary.** 69 "corpora"
   include `auto-detect` (28 books), `unknown`, `und`, `e`, `ger` (a German book
   split from the other 456), `lb`, `multiple`, `latin/hebrew`,
   `english, prakrit, sanskrit`, `karaim and hebrew`, and script names rather
   than languages (`egyptian hieroglyphs`, `maya hieroglyphs`). 52 books total.
   **30 corpora hold exactly one book**, where IDF is log(1/1) = 0 and every
   TF-IDF is identically zero — 518 rows (0.6%). 51 corpora have fewer than 5
   books (89 books) and their IDF is not meaningful.

4. **Catalogue boilerplate can dominate a short book.** The Sanskrit sample
   returns `barcode benares language pages sanskrit series works publication` —
   Internet Archive scan front matter, not the text. Even sampling helps but
   cannot save a book whose pages are mostly catalogue cards.

Practical guidance: trust the top 8 corpora (1,901 books, 89%); treat anything
under ~20 books as indicative only; and join `tfidf_vocab.csv` to filter rather
than relying on the shipped ranking for German.

## 4a. First result: re-OCR is not uniformly an improvement

Joining each page's newest prior text to its live text over 100,580 clean pairs
(`provenance_class='reocr'`, shifted excluded):

| failure class | fixed | newly introduced | net |
|---|---:|---:|---:|
| commentary-as-transcription | 589 | 303 | −286 (better) |
| repetition loops | 352 | 614 | **+262 (worse)** |

Re-OCR repairs chatty preambles reliably (62% of broken priors) but introduces
**more repetition loops than it fixes**. Ask the question per failure class; the
aggregate agreement metric cannot see this, because a loop and a clean
transcription of the same page disagree exactly like a hard page does.

**The damage is concentrated in script, not spread evenly.** Loop-introduction
rate by language × live model:

| language × model | pairs | broke | rate |
|---|---:|---:|---:|
| Tibetan × `gemini-3.1-flash-lite-preview` | 1,357 | 341 | **25.1%** |
| Chinese × `gemini-3.1-flash-lite-preview` | 865 | 38 | 4.4% |
| Latin × `gemini-3.1-flash-lite-preview` | 17,310 | 17 | 0.10% |
| German × `gemini-3-flash-preview` | 9,875 | 31 | 0.31% |

Tibetan alone is **341 of all 614** newly-broken pages. Net effect by slice:

| slice | n | fixed | broke | net |
|---|---:|---:|---:|---:|
| all | 100,580 | 352 | 614 | +262 |
| excluding Tibetan | 99,223 | 228 | 273 | +45 |
| space-less scripts | 2,910 | 109 | 242 | +133 |
| spaced scripts | 97,670 | 243 | 372 | +129 |

So the direction (net worse) holds in every slice, but the **magnitude outside
Tibetan is negligible** — +45 pages across 99,223. Space-less scripts are 2.9%
of pairs and carry 51% of the damage. This independently reproduces the known
Tibetan-lite failure (`#3244`, "fails ~1/3") at 25% from a different instrument.

Model matters too, after controlling for language: head-to-head within the same
language, `gemini-3.1-flash-lite-preview` loops more than `gemini-3-flash-preview`
in 7 of 9 languages (Greek 0.60% vs 0.00%, Chinese 4.39% vs 0.00%, Sanskrit
1.31% vs 0.00%; German is the exception at 0.17% vs 0.31%). Both effects are
real and they interact — do not report either alone.

**Cleanup queue this produces:** 11,801 pages (1.6% of 732,037 OCR'd pages in
scoped books) are degenerate, and **10,591 of them have never been re-OCR'd**.
Re-running them on `gemini-3.1-flash-lite-preview` would, on this evidence, make
the space-less subset worse — route by script or the queue is self-defeating.

## 4b. Disagreement signals — and why the review queue finds repairs

`scripts/eval/corpus-signal-audit.mjs` (offline, free) scores ten per-page
disagreement signals and writes a ranked queue. Three results, in order of how
much they should change your behaviour.

**Score against a target you did not help define.** `degenerate` IS a low
type/token ratio, and loops inflate word counts, so length/TTR signals predict
their own label. The ranking reorders completely between a circular target
(degenerate-or-commentary) and an independent one (commentary/refusal prose,
regex on content):

| signal | flagged | circular | independent |
|---|---:|---:|---:|
| `body_emptied` | 572 | 3.3× | **7.4×** |
| `script_flip` | 231 | 11.3× | **4.6×** |
| `ttr_drop` | 1,076 | 14.7× | 3.0× |
| `pagetype_flip` | 3,513 | 1.3× | 2.7× |
| `grew_3x` | 2,736 | 9.7× | 1.3× |
| `delta_100` | 10,654 | 5.1× | **1.1×** |

`|Δ words| > 100` is the cautionary one: 5.1× circular, **1.1× independent** —
i.e. nothing. The word-delta *distribution* is still descriptively useful (38.4%
of re-reads change the count by zero, 71% by ≤10 words) but it is not a detector.

**Stacking is discontinuous.** Precision is flat 1→2 signals (1.0% → 1.7%) and
jumps at 3 (8.1%, 12.2×) and 4+ (22.2%, 33.8×). A ≥2 cut is 1,861 pages at 97%
false positives; a ≥3 cut is 220 pages across 76 books, and heavily concentrated
(Micrographia 36, *Rasārṇavakalpa* 24, *Rasaprakāśasudhākara* 24 — three books
are 38%). Review by book, not by page.

**The queue is enriched for REPAIRS, not damage — this is the finding.**
Micrographia p289's prior text was `CAP. 9. HARMONICORUM LIB. III` — Mersenne's
*Harmonicorum Libri*, a different book entirely (the `archived/undefined/`
contamination, #3362) — and its live text correctly describes Micrographia plate
XXVIII. The re-OCR **repaired** it; `body_emptied` fired on the fix. 41 of that
book's 377 OCR'd pages now have zero body text, matching its ~38 engraved plates.
Corpus-wide, **61 of the 72 `body_emptied` pages in the tier-3 queue have a clean
live page.**

The selection is structural, not bad luck: the printed-page-number shift test
abstains on **49.9% of all clean pairs but 97.3% of this queue**, because a page
that becomes a plate has no printed number to compare. The signals concentrate
exactly where the one instrument that could adjudicate them cannot run.

**Consequence.** These signals detect that the two passes *disagree about what
the page is*. They do not say which side is right — the same limit as
`printed_page_shift` itself. Use the queue to BUILD a labelled set; never quote a
precision figure from it as though it measured damage, and never drive an
automated re-OCR from it (which, per §4a, would make the space-less subset worse).

## 5. Questions this dataset can and cannot answer

**Can:**
- Does re-OCR recover text, on which strata (language, century, script class,
  position in book, scan class, provider, model transition)?
- Is marginalia recovery a sharper quality signal than bulk agreement?
- What predicts a page being *selected* for re-OCR?
- How much of the corpus's "disagreement" is image churn vs reading difficulty?
- Do TF-IDF book vectors cluster by tradition, and do re-OCR'd books sit
  anywhere unusual in that space?

**Cannot, without more work:**
- **Which side is correct.** Nothing here is ground truth. Agreement is a weak
  accuracy proxy — 63 points of agreement range map to ~5 points of accuracy in
  the anchor fit (`scripts/eval/calibration-scorecard.mjs`). Ground truth lives
  in the eval dataset, not here.
- **Fabrication.** Two passes that both recite the same memorised canonical text
  agree perfectly (`/blog/reciting-not-reading`). Agreement is blind to this by
  construction, and the effect is largest on exactly the famous texts.
- **Anything about readers.** No traffic, no reading depth. `read_count` is on
  `pages.csv` but is crawler-contaminated (see the measurement-layer section of
  `CLAUDE.md`).

## 6. Cleanup this surfaced

- `books.year` is present on only **49,422 of 104,621** books (47%). Any
  year-stratified claim abstains on half the corpus. Report the denominator.
- `books.subject_keywords` exists on only **5,664** books (5.4%) — not usable as
  a corpus-wide feature, which is the direct reason TF-IDF is computed from text
  rather than read off that field.
- `page_revisions.reason` is null on **93%** of rows. `source` is the usable
  provenance field; `reason` is not. Writers calling
  `saveRevisionsBeforeOverwrite` should pass `reason` — it is a documented
  parameter that almost nothing supplies.
- `book_id` appears as either `books.id` or `String(books._id)` depending on the
  writer's vintage, in both `pages` and `page_revisions`. Every join here
  resolves both keys; a join on one key alone silently drops rows.
- **`revised_page_pct` can exceed 100%** — 8 books do, up to 139.6%. Not a bug in
  the rollup: revisions **outlive the pages they point at**. All 8 have
  `split_completed=1`, so the pre-split page docs were replaced while their
  `page_revisions` rows remained. `revision-agreement-corpus.mjs` already
  observes ~14% of revisions are orphaned this way. Consequence:
  `n_revised_pages` and `pages_count` have different denominators and must not
  be divided without excluding orphans — `revisions.csv` counts them
  (`manifest.rows.revisions_orphan_pages`).
- 4 of the 2,139 books in the revision rollup have **no surviving `books` doc**
  at all (purged), so `books.csv` has 2,135 rows.
