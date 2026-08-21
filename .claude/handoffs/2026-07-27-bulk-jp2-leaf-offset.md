# Postmortem: the bulk-JP2 leaf offset — images one page behind their text

**Date:** 2026-07-27 · **Issue:** #3368 · **PR:** #3369 · **Severity:** data integrity, reader-facing, ~4 months undetected

## Summary

For four months a subset of Internet Archive books served a page scan **one leaf behind** the OCR/translation displayed beside it. A reader opening *Pseudodoxia Epidemica* saw the start of Chapter IV on the image and the text of Chapter V underneath. Reported twice through the footer feedback widget (2026-07-16, 2026-07-26) before anyone connected the two.

Root cause: `scripts/workers/archive-bulk.mjs` treated IA's IIIF page number and the ordinal of a file inside the item's `*_jp2.zip` as the same sequence. They are not.

## What was actually wrong

IA marks some leaves `addToAccessFormats=false` in scandata — scanner calibration targets (`Color Card`, `White Card`) and leaves marked `Delete`. Those leaves:

- **are** present in the raw `*_jp2.zip` (one file per physical leaf), but
- **are excluded** from the access derivatives, so IIIF `/page/nN` skips them.

`b30324828` (Pseudodoxia) has `leaf 0: pageType "Color Card"`. The archiver did:

```js
const leafNum = parseInt(photoUrl.match(/\/page\/n(\d+)/)[1]);
const srcFile = pageFiles[leafNum];   // sorted zip listing
```

so IIIF `n220` resolved to zip leaf 220 — the *previous* page. Every page in the book, off by one.

**Only leading exclusions matter.** Cards at the tail are extremely common and harmless; they shift nothing. That is why the defect is patchy rather than universal.

## Blast radius (audit in progress at time of writing)

2,262 books audited (`scripts/audit/bulk-archive-alignment.mjs`):

```
aligned    1309
shift+1     524   (severity: high 272, partial 73, none 179)
ambiguous   390
unknown      39
```

**261 reader-visible books, all `visible: true`, ~105,000 pages.** Treat as a floor — see "What we still don't know."

`severity: none` (179 books) are shifted but need **no repair**: their OCR was transcribed from the same shifted images, so text and image agree and no reader sees a defect.

## The second-order damage: duplicates and gaps

Not every affected book is a clean shift. Where a book was OCR'd in **two passes straddling the archival date**, the passes read two different sequences one leaf apart:

| page | OCR ran | read from | result |
|---|---|---|---|
| 219 | 25 Mar (pre-archival) | IIIF n218 = printed 199 | correct text, image shows 198 |
| 220 | 12 Apr (post-archival) | archived[220] = printed 199 | **duplicate of 199** |
| 221 | 25 Mar (pre-archival) | IIIF n220 = printed 201 | correct text, image shows 200 |

So a page gets transcribed twice while its neighbour is never transcribed at all. In Pseudodoxia: **49 printed numbers transcribed more than once, 72 printed pages with no OCR anywhere** — including printed 200, the exact page the reader was looking at.

This was found because Derek searched the book for "dolphin" and saw repeated lines. Pages 219 and 220 carry the same sentence, one modernising the long-s and one preserving it — two OCR passes over one page. Distinctive-word overlap 72% vs a 16% adjacent-page baseline.

**Consequence for repair:** re-archiving fixes the pairing but cannot recover text that was never captured. Books with mixed OCR timing need re-OCR after their images are corrected — a paid operation.

## Timeline

| date | event |
|---|---|
| 2026-03-21 | `archive-bulk.mjs` created (PR #299/#301). `pageFiles[leafNum]` is in the first commit — never a regression |
| 2026-03-25 | Pseudodoxia OCR'd, 287 pages, from IA IIIF URLs (correct leaves). Images not yet archived |
| 2026-04-04 | `da1c221c` fixes a *different* archiver bug (missing `book_id` → everything written to `archived/undefined/N.jpg`, #3362). Same day: all 360 pages archived, correct paths, shifted mapping |
| 2026-04-10/12 | 54 scattered pages re-OCR'd, now reading the shifted archive → duplicates and gaps |
| 2026-07-16 | Reader reports misalignment on *The Federalist*. Not actioned |
| 2026-07-26 | Reader reports it on *Pseudodoxia*, twice |
| 2026-07-27 | Diagnosed, fixed, audited |

## Why it survived four months

1. **Neither artifact is wrong on its own.** The image is a real page of the right book; the text is a real page of the right book. Only the *pairing* is wrong, and nothing ever compared the two.
2. **They are written by different code at different times.** Archiving and OCR never met, so there was no natural place for the check to live.
3. **It works on most inputs.** Items without a leading excluded leaf map 1:1 — 1,309 aligned vs 524 shifted. Any spot check had a good chance of landing on a clean book.
4. **A browser looks fine.** Both panes render plausible content. Only reading them *against each other* reveals it.

## Deeper causes

Beyond the wrong assumption, three systemic conditions let it run for four months.

### 1. The signal arrived and had nowhere to aggregate

Feedback search over all 327 rows finds **six** alignment/duplication-shaped reports, three of them this defect:

| date | status | message |
|---|---|---|
| Jul 16 | read | "The page ocr and text of image do not appear to be aligned" |
| Jul 16 | read | "This image doesn't correspond with this text." |
| Jul 26 | unread | "This page has errors — not the same as image" |

Two reports, **two different books, the same shape, the same day** — and ten days passed before anything happened. This is *not* a backlog failure: only 14 of 327 rows are unread and none predates 2026-07-01. Triage is healthy. The failure is that feedback is handled item-by-item, so each report read as a one-off defect in one book. **Nothing clusters feedback by symptom**, so "same complaint, different books" never surfaced as a pattern — which is exactly the shape that distinguishes a systemic bug from a bad scan.

(An earlier report — 2026-03-11, "The text is repeated on this page from the former", on *Astronomiae Instauratae Mechanica* — predates `archive-bulk.mjs` by ten days, so it is probably a different cause. Noted, not claimed.)

### 2. The layer that writes the corpus is the layer without tests

60 unit test files in `tests/unit`. **Exactly one** references `scripts/workers` (`selective-unpause.test.ts`). Before this PR there was no test anywhere for image archiving.

The risk allocation is inverted. A rendering bug is visible, reversible, and caught by looking. A corpus-write bug is invisible, and can be **unrecoverable** — printed page 200 of Pseudodoxia was never transcribed, and no amount of re-pairing brings that text back. The code with the least reversible failure mode has the least coverage.

### 3. A near-miss with the defect on screen

On 2026-04-04, `da1c221c` edited **this same function** to fix a different bug (`book_id` missing from a projection → every page written to `archived/undefined/N.jpg`, #3362). Whoever wrote that fix was reading the leaf-mapping lines directly and corrected only the symptom in front of them.

That is the fix-the-instance-not-the-class pattern, and it had a second cost: #3362 also identified the OCR-before-archival **ordering hazard** and it was never enforced. That un-enforced ordering is precisely what turned a recoverable image shift into duplicated text and permanent gaps here.

### 4. The archiver never inspected its own output

`archive-bulk.mjs` counted skips (`skippedNoLeaf`, `skippedOutOfRange`, `skippedMissingFile`) and reported them — real diligence about *inputs it rejected*, none about *what it wrote*. Skip-counting feels like validation and isn't. A worker that writes derived artifacts needs at least one assertion about the artifact.

## What would NOT have caught it (a corrected claim)

During the investigation I asserted that the `<page-num>` tag OCR writes would have caught this instantly. **That is wrong**, and the data says so:

- `De Abditis Nonnullis` is 100% shifted with `dupPageNums=0, seqBreaks=0` — a perfectly sequential page-number run. A **uniform** shift preserves sequence and is invisible to this signal.
- Early-modern books produce heavy false positives: *Opera Chymica* shows 77 "duplicate" page numbers that are just OCR misreading ornate numerals and signature marks.

`<page-num>` anomalies detect the **duplicate/gap** class (mixed OCR timing) and nothing else. The uniform shift requires comparing the stored image against the stored text directly.

## Fixes shipped (PR #3369)

- **`scripts/lib/ia-access-leaves.mjs`** — resolves the real access-leaf sequence from scandata (XML or JSON), so `accessLeaves[iiifN]` is the true zip ordinal. Verified on the live item: 360 access leaves (exactly our `pages_count`) and `accessLeaves[220] = 221`.
- **Filename-keyed lookup** rather than position in a sorted list — positional indexing silently shifts on sparse zips too, a second latent instance of the same bug shape.
- **Fail-closed pre-write verification** — decode a 3-page sample, perceptual-hash against each page's own IIIF URL, and mark the book `bulk_unsuitable` rather than write a shifted sequence. Also refuses when scandata is absent **and** verification can't run.
- **`scripts/lib/page-alignment.mjs`** — the #3359 re-archive guard's verdict logic, extracted so the audit and the guard share one implementation.
- **`scripts/audit/bulk-archive-alignment.mjs`** — read-only sweep, resumable.
- **`tests/unit/ia-access-leaves.test.ts`** — 9 cases pinning the mapping, including tail-only exclusions which must *not* shift.

Correctness deliberately does not rest on the scandata parser being right for every IA vintage. The hash check is the load-bearing part.

## Mistakes made during the investigation

Worth recording, because two of them nearly became conclusions:

1. **Sampling the wrong pages.** The audit sampled from *all* pages of a book, but books are often archived by several paths. `Homiliae S. Isaaci Antiocheni` has 22 of 894 pages from bulk_jp2; the sampler tested the other 872 and returned "aligned". Scoped to bulk_jp2 pages it flips to `shift+1`, 21/22 affected. **37 of 1,245 books** were sampled this way, so earlier aligned counts contain false negatives.
2. **A 400-row query cap.** A split-page test returned 0/12 because `.limit(400)` truncated before the divergence began. Same shape as the supabase 1,000-row truncation already in CLAUDE.md.
3. **Two wrong hypotheses about the `ambiguous` class** (multi-exclusion offsets; split-page books), both disproved by checking. It remains unexplained.
4. **A long-lived Mongo cursor** died at 701 books with `CursorNotFound` after sitting idle through image fetches. Fixed with `_id`-range pagination.

## What we still don't know

- **390 `ambiguous` books are unverified, not clean.** Decomposed by sample votes: 52 lean aligned, 65 lean shifted, 67 matched neither hypothesis, 12 conflict. Up to ~65 more affected books may sit in there.
- **The affected count is a floor** — the mis-sampling above means some `aligned` verdicts are false.
- **The trigger for the 2026-04-10/12 re-OCR sweep** is inferred from the scattered page numbers, not confirmed.
- **Coverage of other writers.** Only `archive-bulk.mjs` and `rearchive-iiif-fullres.mjs` verify alignment. Other active writers of `archived_photo` (`archive-ia-bulk.mjs`, `archive-images-fast.ts`, `archive-unarchived-books.ts`, `archiving-watchdog.mjs`, …) have no such check.
- **Nothing runs continuously.** The audit is on-demand. A new divergence introduced by an unguarded path would be as invisible as this one was.

## Open work

1. Finish the corpus sweep; re-audit the 37 mis-sampled books.
2. Characterise the 390 ambiguous.
3. Split affected books by OCR timing — uniform-pass books are free to fix (re-archive only); mixed-timing books need paid re-OCR. **Estimate before running.**
4. Repair. ~105K pages across 261 live visible books.
5. Extend the alignment guard to the other `archived_photo` writers, and wire a periodic sample-based alignment check into the weekly health routine.
6. Mark the two feedback entries addressed once repaired.

## The generalisable lesson

This is the **third** incident of one shape: #3362 (archiver wrote every page to a shared `archived/undefined/N.jpg` path), #3186/#3357 (e-rara PDF cover sheet offsetting a re-archive), and now #3368. Each time, two artifacts produced by different code at different times were *assumed* to correspond, and nothing verified it. Each was invisible in the output and surfaced only as user feedback, months later.

See the CLAUDE.md invariant added alongside this postmortem.
