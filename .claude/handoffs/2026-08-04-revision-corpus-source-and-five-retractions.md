# The revision corpus is a mixed record — and five things I got wrong finding that out

2026-08-01 → 08-05, issue #3473. Merged: **PR #3475**, **PR #3617**.
Open: **PR #3637** (neighbour test), issue **#3614**.

Written to be read cold. The retractions are the point — every one was a confident,
plausible aggregate over an instrument nobody had checked, and four of the five
survived a first round of scrutiny before failing a second.

---

## What is true now

**`page_revisions` is not a double-OCR corpus. It is a mixed record of model passes
AND bulk maintenance, and `page_revisions.source` says which.**

| source | ocr rows | leaf-shifted |
|---|---|---|
| `batch_api` | 109,982 | 3.8% |
| `shift-repair-erara-2026-07` | 56,413 | **99.0%** |
| `pipeline_preview` | 12,949 | 0.8% |
| `ai` | 8,622 | 0% |

The ±1 page-offset population that two sessions characterised by sampling,
page-number arithmetic, per-book offset signatures and finally two scans opened by
hand **is just the rows that say `shift-repair-erara-2026-07`**. The field was
documented in `data-provenance.md` the whole time; the enum there was stale.

Consequences that stand:

- **Segment by `source` before quoting any number over `page_revisions`.** Now
  enforced in `revision-agreement-corpus.mjs` and `repeat-instability-draw.mjs` via
  `scripts/eval/lib/revision-source.mjs`, matched by *shape*
  (`repair|fix|shift|migrat|backfill|cleanup|sweep|maintenance`) so next year's sweep
  is excluded by default. Unlabelled rows are deliberately NOT treated as
  maintenance — absence of a label is not evidence of a sweep.
- **The published corpus barely moves:** 61,719 → 61,640 true repeats (0.13%
  tightening). Requiring equal printed page numbers already dropped ~99% of sweep
  rows. The change matters for correctness of *reasoning*, not of the headline.
- **Repeat instability does not transfer to translation.** Median agreement 0.630 vs
  0.996 for OCR; 89.8% of translation pairs fall below the 0.85 "unstable" threshold
  against 9.3% for OCR. Structural, not a data problem: OCR has one correct output,
  translation has many. A semantic metric (embedding cosine over `page_translations`)
  is the path; the lexical one cannot work here.
- **Translation was never measurable by page number:** 2.0% of translation rows carry
  a printed `<page-num>` against 60.9% of OCR rows. The same-leaf filter cut 130,049
  rows to **331**.
- **Instability by language** (true repeats only — the metric finally pointed at the
  question it was built for): English 2.3% unstable, German 4.4%, French 8.0%, Latin
  15.5%, Italian 22.8%, Greek 23.3% (7.8% outright bad), **Arabic 59.7%**, **Persian
  70.1%**. Caveat: stability ≠ accuracy, and Latin-vs-German may be *material* (older
  holdings) rather than language.

---

## The five retractions

| claimed | reality | how it failed |
|---|---|---|
| inverted timestamp proves a text move | 90% of *proven re-OCRs* invert too | signal never checked against a control cohort |
| "no clock can order these rows" | `original_date` orders 99.3% correctly | one field's failure generalised to the category |
| ~3.8% residual contamination in rescued pairs | the low tail is *hard pages*, not contamination | rate measured on one population, applied to another |
| 86% of re-archived pages mispaired | 2.3× on spaced scripts, no signal on space-less | word metric on Tibetan + arms 76% vs 7% Tibetan |
| Tibetan "instrument doesn't work" | that instability *is* the quality signal | conflated the pairing question with the quality question |

Each was caught by opening the artifact, never by more reasoning. Two were caught only
because Derek asked a question I had not asked myself ("is a timestamp recorded
elsewhere?", "isn't this inconsistency what we can measure?").

---

## Instruments built

| script | what it answers | cost |
|---|---|---|
| `scripts/audit/ocr-revision-provenance.mjs` | which mechanism wrote each revision | free, ~2 min |
| `scripts/audit/doc-enum-drift.mjs` | does a documented enum still match production | free, minutes |
| `scripts/eval/true-repeat-count.mjs` | before/after on the true-repeat filter | free, local |
| `scripts/eval/reocr-pairing-check.mjs` | does stored text match the current image | ~$0.00079/page |
| `scripts/eval/lib/revision-source.mjs` | reading vs maintenance classifier | pinned by 27 tests |

`agreementPrimary` / `agreementChars` / `scriptClassOf` now live in
`scripts/eval/lib/metrics.mjs` — **character agreement on space-less scripts, word
agreement elsewhere.** Using the word metric on Tibetan is what produced the void
86% result.

---

## Open, in priority order

1. ~~**PR #3617 is unverified.**~~ **RESOLVED 2026-08-05 — verified and ready to merge.**
   Exact full scans, no sampling: `page_revisions.source` 12 values, `pages.ocr.source`
   16, `pages.translation.source` 11, all documented. Two bugs fixed on the way
   (`4210b4db`): the error path **hung forever** — `process.exitCode` does not force an
   exit and nothing closed the MongoClient, so one run sat alive 2h43m holding a
   connection pool; and phantom detection was reporting field *paths* as values. The
   hang was only visible from the process list, because the status check had been
   reporting a *different* process for an hour. **Run this audit on Hetzner** — exact
   mode scans `pages` twice at 19.1M docs and two of three local attempts died on a
   network blip mid-scan.
2. **#3614 — two `is_default: true` prompts** for `{summary, Standard Summary}`, one
   with no `version` field. Violates an invariant `data-provenance.md` itself states;
   `getSummaryPrompt()` resolves arbitrarily and one path records
   `prompt_version: undefined`. Also: the doc's "Current defaults" table is 5 and 4
   versions behind (OCR v10 vs **v15**, Translation v8 vs **v12**).
3. ~~**~40 stratified pairs**~~ **RESOLVED 2026-08-05 — PR #3637.** Done at n=190, not 40,
   and by a better method than eyeballing: `scripts/eval/neighbour-leaf-test.mjs` compares a
   prior revision against its own page AND pages N±1, needing no page number, timestamp or
   metadata. **94.7% same leaf / 1.6% shifted / 3.7% ambiguous.** But failures concentrate
   where the signal lives — the 0–0.3 band is 77/5/18, clean above 0.3 — so 94.7% describes
   the population while the *unstable arm* carries ~a fifth uncertain provenance. Adopting
   leaf-agnostic is now an evidenced call; it still moves a published number, so it stays a
   separate decision and the draw script default is unchanged.
4. ~~**`corpus` and `wikisource` rows are not model output**~~ **RESOLVED 2026-08-05 — PR
   #3637. Zero contamination**, measured over all 61,640 true repeats, not estimated. The
   same-model-same-prompt filter excludes them by construction: a non-model source carries
   neither. Every language figure stands. Worth noting the process — "too small to matter"
   was the right answer here, but it was only trustworthy once measured, and that phrasing
   had already been wrong four times above.
5. **Semantic metric for translation quality.** Scoped in the measurement-loop doc so the
   next attempt does not begin by re-running Levenshtein and rediscovering it fails.

---

## Does CLAUDE.md need a new invariant?

**No — and that is a deliberate call, not an omission.**

Every lesson here is already doctrine there, and adding a sixth restatement would
violate CLAUDE.md's own rule that doctrine lives in one place:

- "check whether the fact is stored before inferring it" → *"A metric is a claim about
  an instrument before it is a claim about readers"* and *"Read the actual output before
  interpreting an aggregate"*.
- word-metric-on-space-less-scripts → already stated with the exact numbers (Chinese
  36.7% word vs 72.7% character) in the quote-integrity section.
- a check that reports a false clean → already stated for the tenant leak audit
  (*"reports **NOT RUN** rather than passing"*).
- `page_revisions` is a mixed record → **added** in #3475 as a Domain Context pointer,
  which is the right weight: it routes to `data-provenance.md` rather than duplicating it.

The gap this session exposed was never missing doctrine. It was that **prose rots
silently and nothing notices** — `data-provenance.md` was stale in two independent
places, and the second was found by accident. That is what `doc-enum-drift.mjs` is for,
and it is a better answer than another paragraph.
