---
id: shelf-overview
version: 1
stage: [ocr, translation, structure]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [6056, 6079, 6090, 6174]
status: active
---
<!-- PRIOR ART: .claude/skills/shelf-overview/SKILL.md (how to run it) and scripts/eval/spot-check/OVERVIEW-ADDENDUM.md
(the brief). This file is the instrument's description for book_checks rows; it changes neither. -->
## shelf-overview v1 — what is this shelf like to read, and which books can a scholar be shown?

**Sampling.** `scripts/eval/spot-check/overview-draw.mjs`. One stratum per tradition a partner cares about; the frame of
each stratum is listed in `draw-log.json` with its size, so results can be weighted. 4 books per stratum, drawn
uniformly per book with the run's seed; 4 pages per book, one random translated page in each quarter of the book
(start, two middles, end). Only `page_number > 0` since the 2026-10-07 runs (6 soft-hidden records were drawn before the
filter; `overview-score.mjs` drops them).

**Reader and input.** An Opus reviewer per stratum, given the frozen `REVIEWER.md` plus `OVERVIEW-ADDENDUM.md`. It
downloads and **opens every page image**, then reads the transcription against the image and the English against the
transcription. Until 2026-10-06 the reviewers were subagents of an interactive session; from 2026-10-07 they are
`claude -p --model opus` calls from `scripts/eval/spot-check/run-reviewers.sh` (same prompt). Reader in the row:
`{kind: model, model: opus, image_opened: true}`.

**Serious.** As in `REVIEWER.md`: a reader would be misled about what the source says or is — sense reversed, a
statement invented, a passage dropped, the wrong leaf, text not on the page, a name, number or dose wrong where it
matters. Each serious error carries a class from `.claude/docs/page-error-taxonomy.md` (I*, O*, T*, D1, E*). A page is
serious if any error on it is, or `right_page` is `"no"` (`overview-score.mjs`).

**Verdict.** The reviewer's own per-book `fit_to_show`: `show` → **show**, `show_with_caveat` → **caveat**,
`do_not_show` → **fix**. Copied, never re-derived (`verdict_source: reader`). Row `classes` = the classes of the serious
errors on the book's pages; `note` = the reviewer's `reader_summary`.

**Consistency (measured 2026-10-07, #6174, PR #6190).** Same 24 books / 96 pages read three times (the original
session-run reviews and two script runs):
- per-page serious flag: **κ ≈ 0.9** (0.85 and 0.90 against the original; 0.92 between the two script runs; Fleiss 0.89);
- wrong-leaf call: κ 1.00, never flipped;
- **class labels are unstable: Jaccard 0.55–0.67** on pages both runs call serious. Do not build on one run's classes;
- per-book verdict moves one step on 1–3 of 24 books, almost always show ↔ caveat. A single run's caveat boundary is soft.

Consistency is not accuracy: all three runs are the same model with the same brief and share its blind spots.

**Known blind spots.**
- 4 pages per book: a book's verdict says nothing about the other pages.
- The reviewer is lenient at the book level: in `overview-2026-10-07-eternity2` half the pages carry a serious error
  but most books are `caveat`, not `fix`. Read `classes` and the evidence, not only the verdict.
- Small type and scripts the model reads poorly (Tibetan at the stored resolution, cursive manuscripts) are judged
  with low confidence; the reviewer is told to say so, not to guess.
- AI reviewers, not scholars of the tradition. External anchors are the human readers (#5800, #5406).

**Rows written by** the backfill (`scripts/maintenance/backfill-book-checks.mjs`) and, from #6174 step 4,
`overview-score.mjs` at the end of a run, with `run-cost.py`'s cost as `subscription_usd_eq`.

**Versions.** v1 — 2026-10-07: REVIEWER.md v1 (frozen) + OVERVIEW-ADDENDUM.md as of PR #6079.
