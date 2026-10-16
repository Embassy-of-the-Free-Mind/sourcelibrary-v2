---
id: served-audit
version: 1
stage: [ocr, translation, structure]
measure: judged
reader: model
image_opened: true
verdict_scale: [show, caveat, fix]
issue: [6691, 6688, 6174]
status: active
---
<!-- PRIOR ART: shelf-overview.md (stratified by a tradition's book list, 4 pages per book) and
fortnightly-spot-check.md (one frame, 3 consecutive pages). This one stratifies by LANE and reads one page per book,
so its rate is k of n books as review-vocabulary.md rule 3 asks. -->
## served-audit v1 — what share of the pages readers are served carries a serious error, by lane?

**Sampling.** `scripts/eval/spot-check/served-draw.mjs`. Frame: live books (`visible`, `pages_count > 0`) with a
translated page. Seeded order, uniform per book; for each of the first N (default 3,000) books, ONE translated page
with `page_number > 0`, uniform over the book's translated pages. The page's lane = OCR engine family × script family
(from `books.language`) × form (print / manuscript / e-text, a catalogue heuristic) × translation model family. Every
lane cell with ≥ 10 screened books is a stratum (up to 20), the rest is one stratum `rest`; 10 books per stratum.
A stratum's weight is its share of the screen. Pages made by Claude would go to a Gemini reviewer; pages with no
image (typed corpora such as ETCSL) are not reviewed.

**Reader and input.** One `claude -p --model opus` reviewer per packet (`run-reviewers.sh`), given the frozen
`REVIEWER.md` plus `SERVED-ADDENDUM.md`. It downloads and **opens the page image**. Reader in the row:
`{kind: model, model: <opus id>, image_opened: true}`.

**Serious.** As in `REVIEWER.md`; each serious error carries a taxonomy class and a review-vocabulary `kind`. A page
is serious if any error on it is, or `right_page` is `"no"`.

**Verdict.** The reviewer's `page_verdict`: `show` → **show**, `show_with_caveat` → **caveat**, `do_not_show` →
**fix**. Copied (`verdict_source: reader`). A `fix` row puts a book-level warning on the book in the reader
(`src/lib/book-warnings.ts`) until a later check reads the page clean or its text changes.

**Containment.** A page the reviewer marks `not_this_leaf` is re-read by the session with the image open; if
confirmed, it is contained per `.claude/docs/invariants/containment-on-finding.md` (hold, withhold, `contained`).

**Known blind spots.** One page per book: the verdict says nothing about the book's other pages. Opus reviewing
mostly-Gemini output is cross-family, but one reviewer, one read; class labels are unstable across reads (Jaccard
0.55–0.67, shelf-overview.md), kinds probably likewise. Script families the model reads poorly (Tibetan at stored
resolution, cursive) are judged at low confidence. Form is a catalogue heuristic for the strata; the reviewer's
`form` is the by-eye value.

**Rows written by** `scripts/eval/spot-check/served-score.mjs` at the end of a run.

**Versions.** v1 — 2026-10-13: REVIEWER.md v1 (frozen) + SERVED-ADDENDUM.md as of the #6691 PR.
