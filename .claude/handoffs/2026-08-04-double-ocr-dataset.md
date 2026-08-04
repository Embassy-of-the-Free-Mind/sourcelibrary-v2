# The double-OCR dataset, and five bugs that produced plausible numbers — 2026-08-02/04

Started from one line in commit `2b8bfa2a`: *"the same sweep touched 55,272
TRANSLATION revisions and no translation-agreement work has accounted for it."*
Ended with a filtered dataset of pages genuinely read twice, the tooling to measure
consistency on it, and a volunteer task design.

**PR #3559** (open, `worktree-feat-double-ocr-dataset`) · **issue #3558** (open).
Full doc: `.claude/docs/double-ocr-dataset.md`.

## What was built

| file | what |
|---|---|
| `scripts/lib/revision-pairs.mjs` | the shared filter — five exclusions, per-book shift verdict, `dominantScript` |
| `scripts/eval/double-ocr-pages.mjs` | the inventory (`--field=translation`, `--write-collection`) |
| `scripts/eval/sample-rerun-baseline.mjs` | unbiased rerun manifest; **selection only, spends nothing** |
| `scripts/eval/build-adjudication-items.mjs` | span-level volunteer questions |
| `tests/unit/revision-pair-filter.test.ts` | 28 tests, each verified by deleting its guard |
| `tests/unit/orthography-folding.test.ts` | 14 tests |
| modified | `revision-agreement-corpus.mjs`, `hard-page-sample.mjs`, `disagreement-typology.mjs`, `lib/metrics.mjs` |
| data | `double_ocr_pages` / `double_translation_pages` in Mongo; `dataset/v0.5-difficulty/` |

## The numbers

- **97,421** pages with a genuine second OCR pass (of 164,664 carrying a revision);
  63,776 verified same-leaf. Translation: 70,502, but only 788 verified.
- Coverage: **0.67%** of the ~14.5M OCR'd pages, non-randomly selected. This limit
  matters more than any rate computed on the data.
- **96.9%** of pairs are one model reading twice — repeatability, not two opinions.
- Convention is **6.6%** of average disagreement (Latin +2.4pt, English +0.3).
- The same-prompt cut moves more than folding: Latin 82.3% → **90.0%**, Italian
  54.6% → **86.4%**.

## Five bugs, one shape

Every one produced a **plausible number rather than an error**, and the ones caught
were caught by a reconciliation check or an impossible sign — never by reading output.

1. **Quadratic upsert.** `page_id` indexed *after* the loop; 165K upserts scanning a
   growing collection. 90 minutes of silence that reads like "a big job".
2. **Readline drain.** The reader was constructed before an `await`, and a readline
   interface starts consuming on construction. The index build ate 54% of the file:
   one pass counted 185,534 pairs, the next wrote 75,759 of 163,495 rows, same file,
   same process, no error. → guard: the two passes must agree on row count.
3. **File-order sampling.** Took the first 400 rows of a file ordered by `page_id`,
   which clusters by book. Read 2.3% where the full population was **27.6%**.
4. **Macron expansion.** `ē` means a following m *or* n; a fixed mapping is wrong
   half the time. Caught by a test, not by inspection.
5. **Fold before strip.** Folding mangled tag names (`<language>` → `<laᴺguage>`),
   so wrapper prose leaked in and the folded score came out *below* raw — impossible
   for a fold. The sign was the tell.

A sixth was caught by the guard added for the fifth: the fold's NFD step strips
combining marks, which in Tibetan and Devanagari are the vowels. It was deleting the
script and reporting the wreckage (−9.7 points).

## What the spot-checking found

- The Sanskrit collapse (1,145 pairs at 0.2% median agreement) was **#3362**, not an
  OCR failure: `rasaratnasamuccaya-vagbhata` p27 held a *Latin index* as its OCR
  while the scan is a Devanagari table of contents. Verified against the image.
  Across the near-zero tail, 27.6% of pairs are cross-script.
- 30 verified pairs, one per book: **zero contamination escapes**. Low-overlap cases
  were all genuine — hard Greek minuscule, truncation, lacuna-dot padding.
- Most mid-band "disagreement" is one pass expanding a macron and the other
  preserving it. Same reading, different convention.

## Open

- **PR #3559 not merged.** Scripts + docs only; no Vercel deploy needed.
- **Translation side is weakly filtered** — leaf check verifies 788 of 70,502,
  cross-script catches 6. Rests almost entirely on the source label.
- **32 `devanagari→latin` pairs** — the direction meaning damage rather than repair.
  Unexamined.
- **Calibration refit** is a ~6% correction, not urgent. (I initially claimed the
  bands were fit on contaminated data; wrong — the sweep wrote its rows on
  2026-07-25, five days *after* the July corpus runs.)
- **Gold items came out at ~2%** against an 8% target; seed them deliberately from
  the excluded degenerate population instead of hoping they appear.
- **Main checkout is on `feat/measure-ai-agent-requests`**, not `main`.
- Large result JSONLs lived on the Hetzner worktree (now removed, 946M reclaimed).
  Regenerable: rerun `double-ocr-pages.mjs`, then the builders with the same seed.

## CLAUDE.md

Updated this session — the `page_revisions` section now carries both halves of the
filter, the translation-side numbers, and a pointer to
`.claude/docs/double-ocr-dataset.md`. No further invariant needed: the recurring
lesson (a broken instrument reports a plausible number, not an error) is already
doctrine in the *"A metric is a claim about an instrument"* section, and this session
is another five instances of it rather than a new class.
