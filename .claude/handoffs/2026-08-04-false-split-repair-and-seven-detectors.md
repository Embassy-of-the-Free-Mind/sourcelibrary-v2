# The false-split repair, and seven detectors — 2026-08-04

A reader (Corey) reported that the frontispiece of Weigel's *Studium Universale*
rendered and downloaded as only its left half. Repairing that turned into a
corpus-wide class, four detector rewrites, two retractions of my own "verified"
claims, and one finding that had been sitting in Mongo in plain English since
February.

Everything below is technical. PR **#3562**; issues **#3593** (guard, shipped),
**#3608** (mis-framed archives, open), **#3627** (dead API keys).

## What the bug was

BPH photographed volumes **two ways within the same book**: front matter one
leaf at a time (portrait), the body as spreads (landscape). `auto-split-ml`
selects pages by `crop: { $exists: false }` and splits every one the ML model
returns a position for. The model always returns a position. So the
individually-shot leaves were cut in half.

The Weigel book had 98 genuine spreads split correctly and **4** broken pages,
all front matter. That is why earlier false-split sweeps missed it: the book
looks fine everywhere you would naturally check, and the damage concentrates on
frontispieces and title pages — the pages people actually try to download.

**Nothing was destroyed.** `archived_photo` held the complete leaf throughout.
Only `crop`, `cropped_photo` and `thumbnail` pointed at the half. Pure metadata
repair, no re-archiving.

**Naming trap:** the half is stored as `{NNNN}-full.jpg`. The file called
`-full` IS the cropped half; plain `{NNNN}.jpg` is the full page.

## Final numbers

- **474 pages repaired** across 45 books, live in production
- **97 reverted** — genuine spreads un-split by an over-eager detector
- **54 re-OCR'd** — 36 gained >15% text, 18 unchanged, 0 lost text, $0.12
- **349 books** could not be judged by measurement; closed by human review of
  the 54 still-cropped pages whose OCR reported a sliver

## The seven detectors

Four shipped wrong answers. Every single failure was found by opening an image,
never by a check that inspected data.

| # | test | claimed | reality |
|---|---|---|---|
| 1 | `w > h` on the source | 1,046 | 543 false positives in one book |
| 2 | per-book leaf-ratio calibration | 10,277 | counted spurious crops that render fine |
| 3 | + require the image be materially halved | 567 | still un-split 97 real spreads |
| 4 | + dead-zone abstention + absolute ceiling | 470 | correct |
| 5 | auto-classifier over the flagged set | — | contradicted direct observation; discarded |
| 6 | edge-ink test for mis-framing | — | fired on 100% of both flags and control |
| 7 | OCR's own written warnings | 54 | **worked** |

**Why shape kept failing.** Leaf proportions vary enormously between books. A
spread of two narrow folio leaves (1415×3106 each) is 2780×3105 — still taller
than wide, and shape-indistinguishable from one squarish leaf. Absolute
thresholds cannot work; single-leaf and spread ratios from different books
overlap.

**Why per-book calibration alone also failed.** "Uncropped pages are single
leaves" is false — in a partly-split book the unsplit pages may be spreads
nobody got to. One book drew its reference from 24 uncropped pages that were all
spreads, so the yardstick measured a spread and its real spreads read as single
leaves. **A reference set can be contaminated by the very defect it calibrates.**

**The dead zone.** Nearest-neighbour between 1× and 2× forces a verdict on
sources sitting midway, and it chose wrong: real spreads at 1.32× and 1.40×.
Verified true positives all sit at 0.91–1.08×. Abstain between 1.25× and 1.75×.

**Raw pixel width is not a substitute for aspect ratio** — scan resolution
varies *within* a book (one referenced leaves at 3290px and cropped sources at
2000px), so widths are not comparable across its own pages.

## Two "verified" claims that were false

**1. "Verified in production."** True for the two books I sampled, false for a
third of the rest. Clearing `crop` + `cropped_photo` makes `resolveSized()` fall
through to `display_photo` — which for **196 of 567** pages was *itself* a resize
of the half. Those read as repaired in the database and changed nothing on
screen. The tell: a real display variant is capped at 1200px wide; these were the
half at native height (858×3039 against a 1734×3039 source).

**2. "A count of zero needs its denominator checked."** My post-apply check
reported "0 pages still carrying crop" from a query that matched **nothing** —
the backup serialises `_id` as a hex string, Mongo stores an ObjectId, so
`{_id: {$in: [<strings>]}}` matched zero documents and zero read as success.
Caught only because a sample loop printed no rows.

## What actually worked

**Human review, twice.** "Spotcheck" surfaced 3 false-positive classes. "I can
review a page" surfaced 97 wrongly un-split spreads — visible in seconds once
the contact sheet was sorted widest-first, invisible to a classifier that had
already passed every one of them.

A contact sheet must be **big enough for the judgment it asks for**. At 150px a
book's fore-edge is indistinguishable from a gutter, which produced false flags
on complete pages. Sort by risk so a partial review is still maximally
informative.

**The OCR model's own warnings.** Pages carried text like:

> `<warning>This image is an extremely narrow vertical fragment. The text is
> severely truncated on both the left and right sides…`

Written 2026-02-25. Never read by anything. This is a free, text-only detector
that needs no image fetching and **works where shape-based tests cannot** — it
was the only way to probe the 349 books that had no internal reference.

Its sibling: the re-OCR run failed 27/54 and the console printed a bare count.
The reason — `"API key not valid"` — was in `gemini_usage.error_message` the
whole time. Two of four Gemini keys are dead, so every local OCR run silently
loses half its calls (#3627).

**Caveat kept on the record:** "the OCR did not complain" is not proof of health.
A model fed a clean half-page often transcribes it without remark — exactly what
the Weigel and Duret pages did. This detector finds damage; it does not certify
absence.

## Corrections to my own reporting

- "Every false split destroyed that page's transcription" — **wrong**. The
  `$unset: { ocr, translation, summary }` is real, but 0 of 470 repaired pages
  were missing OCR and median text was 0.88 of their book's norm. The genuinely
  damaged subset was 54.
- "91 pages need re-OCR" — **wrong by nearly half**. Title pages and plates are
  legitimately short; filtering on `<page-type>` cut it to 54.

## Files

- `scripts/maintenance/fix-false-split-portrait-pages.mjs` — detector + repair
- `scripts/maintenance/fix-half-display-variants.mjs` — the 196-page second pass
- `src/lib/spread-guard.ts` + `tests/unit/spread-guard.test.ts` — the guard
- `src/app/api/books/[id]/auto-split-ml/route.ts` — guard wired in, report mode
- `scripts/batch/realtime-ocr.mjs` — `--page-ids-file=` targeting

Backups (untracked, `scripts/output/`): `false-split-repair-2026-08-03T21-31-14-551Z.json`,
`half-display-variants-2026-08-04T14-27-45-026Z.json`. Both `--revert`-able.

## Still open

- **#3608** — archived captures framed too far left, clipping text mid-word.
  Lives in `archived_photo`, needs re-archiving, not re-cropping. 4 of 39 pages
  hand-verified; deliberately no classifier.
- **#3593 enforce mode** — guard ships in `report`. Log one real batch, confirm
  the refusals are single leaves, then set `SPLIT_SPREAD_GUARD=enforce`.
- **7,792 spurious crops** that were never materialised. Invisible today, live
  ammunition for any future pass through the splitter.
