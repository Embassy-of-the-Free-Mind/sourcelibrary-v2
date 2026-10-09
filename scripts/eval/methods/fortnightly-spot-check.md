---
id: fortnightly-spot-check
version: 1
stage: [ocr, translation, structure]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [5914, 6056, 6174]
status: active
---
<!-- PRIOR ART: scripts/eval/spot-check/ROUTINE.md (how to run it), REVIEWER.md (the frozen brief) and
scripts/eval/experiments/_series-fortnightly-spot-check.md (the rate series). This file is the instrument's description
for book_checks rows. -->
## fortnightly-spot-check v1 — what does a reader meet on a book drawn at random, read against the images?

**Sampling.** `scripts/eval/spot-check/draw.mjs` (`lib.mjs`): every other Monday, 10 books drawn uniformly per BOOK from
the frame (public books, or the canon shelves), seed = the draw date; one random run of **3 consecutive translated
pages** per book. Month 0 (2026-10-06) drew 30 books from the 1,661 canon-gap books with ≥ 3 translated pages, seed
1791290001 (ops `rights-screen/2026-10-06-canon-shelves/spot30/draw30.mjs`). Quality-sprint rounds
(`sprint-2026-10-07-r1`, #6056) use the same draw and brief.

**Reader and input.** Blind Opus reviewers, 5 books each, given the frozen `REVIEWER.md`; each **opens every page
image**. Reader in the row: `{kind: model, model: opus, image_opened: true}`.

**Serious.** As in `REVIEWER.md`; classes from `.claude/docs/page-error-taxonomy.md`. A page is serious if any error
on it is, or `right_page` is `"no"`. An **on-sight defect** is anything an expert would flag opening the book: a
serious error, a wrong shelf, a rights problem, broken structure, leaked markup.

**Verdict — derived, not the reviewer's.** REVIEWER.md asks for no show / caveat / fix, only per-page errors, the
on-sight flag and a sentence. The row's verdict is derived by a fixed rule (`verdict_source: derived:fortnightly-v1`):
- **fix** — any page read has a serious error or `right_page: "no"`;
- **caveat** — otherwise, `on_sight_defect` is true (month 0, which predates that field: `shelf_fit` is not
  yes/fits, or any page has a moderate error);
- **show** — otherwise.

This is **stricter than the overview reviewers' own verdicts**, who often give `caveat` to a book with a serious page.
Do not compare `fix` shares across the two methods.

**Known blind spots.** 3 consecutive pages are one observation of a book. Month 0's per-book files survive for 25 of
30 books (batch 5's JSON was not written) and carry no model ids, so their provenance is reconstructed from the pages
(see `text_provenance[].source`). The rest as [shelf-overview](shelf-overview.md).

**Rows written by** the backfill; sprint rounds via `register.mjs` from #6174 step 4.

**Versions.** v1 — 2026-10-06: REVIEWER.md v1 (frozen); derived-verdict rule above.
