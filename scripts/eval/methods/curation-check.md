---
id: curation-check
version: 1
stage: [ocr, translation, structure]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [5918, 6056, 6174]
status: active
---
<!-- PRIOR ART: scripts/eval/spot-check/CURATION-ADDENDUM.md (the brief) and curation-shelf.mjs (merges its verdicts into a
private collection). This file describes the instrument for book_checks rows. -->
## curation-check v1 — of the books chosen for a reader, which can be put in front of them today?

**Sampling.** None: books are **chosen by hand** for interest (`overview-draw.mjs --picked`). Two consecutive
translated pages from the middle of each book (the page at 45% of its translated pages, and the next), or a named page.
A curation check gives **no rate** — `overview-score.mjs` refuses such a run — only a worklist.

**Reader and input.** Usually an Opus reviewer given `REVIEWER.md` + `CURATION-ADDENDUM.md`, which **opens both page
images** and must not judge from text alone (if it cannot read the image, tier 2 at best). The 2026-10-06 Eternity
run (`curation-2026-10-06-eternity`, 107 books) mixed three readers, recorded per book in `read_by`:
- `reviewer by eye` (68) — Opus reviewer subagents, image opened → `{kind: model, model: opus, image_opened: true}`;
- `read from image` (15) — the orchestrating session itself, image opened → `{kind: model, role: session, image_opened: true}`;
- `earlier session` (24) — verdicts carried over from earlier sessions' reads; whether the image was opened is not
  recorded unless the note says so → `image_opened: 'unrecorded'`.

**Serious.** As in `REVIEWER.md` and the addendum's tier 3: text that is not on the leaf, a loop, a missing column,
English that is not a translation of the page, the wrong work under the title.

**Verdict.** The reviewer's tier: 1 (show) → **show**, 2 (show with care) → **caveat**, 3 (fix first or do not show) →
**fix**. Copied (`verdict_source: reader`). `note` = the reviewer's note.

**Pages read.** The addendum asks for "Checked p.N" and `?page=N` in the note. The 2026-10-06 shelf stored only the
note, so the backfill takes `pages_read` from the page numbers the note names (`pages_read_source: note`): that is the
page(s) the verdict cites, which may be one of the two read. A book whose note names no page is not backfilled.

**Known blind spots.** Two pages; hand-picked books (never a rate); for `earlier session` rows the reader's input is
not recorded. Same AI-reader caveats as [shelf-overview](shelf-overview.md).

**Rows written by** the backfill. Future curation runs go through `run-reviewers.sh … CURATION-ADDENDUM.md`.

**Versions.** v1 — 2026-10-06: CURATION-ADDENDUM.md as written down in PR #6079 from the Eternity run.
