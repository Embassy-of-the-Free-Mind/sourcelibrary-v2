---
name: shelf-overview
description: Holistic, quantified quality read of one or more SHELVES (a tradition, a partner's canon, a collection). Stratified random draw, 4 books × 4 pages spread through each book, Opus reviewers reading every page against its image, a show / caveat / don't verdict per book with showcase pages, and per-shelf rates with by-book CIs plus a frame-weighted total. Use when asked "how good is shelf X?", "what can we show <partner>?", "holistic quality review", or "read the books in <tradition>".
---
<!-- PRIOR ART: scripts/eval/spot-check/ROUTINE.md (the fortnightly random spot check, #5914: one frame, 3-page runs,
frozen); qa-audit skill (metadata and original-language checks, no image-grounded rates); qa-eval skill (engine
benchmarks against references). None answers "what is this shelf like to read, and what can we show", with rates. -->

# Shelf overview

**Why.** A partner (Eternity / Francis Pedraza, the Kabbalah Centre, a library) judges us by opening books on the shelves
it cares about. This answers two questions with one read: *which books and pages can we show*, and *how often does a page
on this shelf carry a serious error* (per shelf, with an honest interval). It also feeds the defect register (#6056).

## 0. Claim and scope
- Comment "taking this: shelf overview of <shelves>" on #6056 (or the partner's issue).
- **Done already, don't redo** (`scripts/eval/results/spot-check/overview-2026-10-07/`): Tengyur, Nālandā Sanskrit,
  Chinese (Eternity shelf), Pali, Hebrew (Eternity shelf), Arabic and Persian.
- **Open strata for Eternity:** Hindu, Vedanta and Bhakti Sanskrit; Greek and Latin classics ("Alexandria");
  Korean; Japanese; Mongolian; Kabbalah beyond the 15 Hebrew shelf books (the Latin Kabbala Denudata, Reuchlin and
  Pico); Chinese Chan and Zen masters specifically (Francis reads them daily).

## 1. Define strata → `strata.json`
`[{ "name", "desc", "ids": [book ids] }]`, one entry per shelf. Build the id lists with a Mongo query and write them
to the scratchpad, not to your context.
- Usual filter: `visible: true, pages_translated ≥ 8`. Include hidden books only if the shelf is about to be
  published (the Tengyur was).
- Exclude `hidden_reason` matching /rights/.
- Search the concept, not one word. "Nālandā" means the 17 masters' works, and their Tengyur volumes are titled by
  volume, not by author.

## 2. Draw (Mongo read, $0)
`node --env-file=.env.production.local scripts/eval/spot-check/overview-draw.mjs --strata <strata.json> --out scripts/eval/results/spot-check/overview-<date>[-<tag>] --seed <YYYYMMDDNN> [--books 4] [--bins 4]`
- Each book gets one random translated page from each quarter of the book: start, two middles, end.
- A page number below 1 is itself a finding.

## 3. Review: one Opus subagent per stratum, at most 6
Use the Agent tool with `model: "opus"`, `run_in_background: true`. The prompt is exactly:
> Your instructions are the full text of two files, read in this order and followed exactly (skip the leading
> `<!-- … -->` comments): 1. `<repo>/scripts/eval/spot-check/REVIEWER.md` 2. `<repo>/scripts/eval/spot-check/OVERVIEW-ADDENDUM.md`.
> The taxonomy is at `<repo>/.claude/docs/page-error-taxonomy.md`.
> PACKET_FILE: `<dir>/packets/<stratum>.json`
> OUTPUT_FILE: `<scratchpad>/overview/<stratum>.json`

Rules:
- OUTPUT_FILE goes to the **scratchpad**. The prior-art hook blocks the Write tool under `scripts/eval/`, so copy
  each file in with Bash afterwards.
- Add no hints, and never edit a reviewer's verdicts.
- REVIEWER.md is frozen.

## 4. Collect and score
- `cp <scratchpad>/overview/*.json <dir>/reviews/`.
- **Rights notes stay out of the public repo:** first copy the unredacted files to ops `quality-sprint/<dir name>/`,
  then run `node scripts/eval/spot-check/redact-rights.mjs <dir>/reviews/*.json`.
- `node scripts/eval/spot-check/overview-score.mjs --dir <dir>` writes `report.md` and `report.json`.
- The report gives, per stratum: serious-page rate (95% CI resampled by BOOK), wrong-leaf rate, mean OCR and English
  scores, books with an on-sight defect, show / caveat / don't, showcase URLs, and a total weighted by frame size.
- With 4 books a stratum, quote the CI, not the point estimate. Never pool strata into one number without saying
  they are weighted.

## 5. Act (cheap, reversible, inside the spend floor)
- **`do_not_show` because the text is invented or not on the leaf:** hide it with
  `scripts/maintenance/hide-named-books.mjs` (reason `broken_text_<issue>`) and hold it with `holdBook()` from
  `scripts/lib/pipeline-hold.mjs`, stating a release condition.
- **`do_not_show` for rights:** do not hide on a reviewer's hunch. Note it in the ops `rights-screen/` and ask Derek.
- Metadata errors (author, date, duplicate record) and recurring classes: comment on the class issue, or
  `gh issue list --search` before filing a new one.
- A class counts as general only when **3 or more DISTINCT books** carry it. Then it needs a model-free detector with
  a positive control (`scripts/audit/quality-sprint-classes.mjs` has the pattern).

## 6. Report
- One line on #6056: strata, weighted rate, show/caveat/don't counts, and the PR.
- **Showcase pages are partner-facing:** list them for Derek. Nothing goes to the partner without Derek's eye
  (`feedback_demo_links_checked_by_eye`: open two pages yourself first).
- Commit `<dir>` and open a PR (`tier:auto` expected).

Budget: 6 Opus reviewers ≈ 1.2M subagent tokens, $0 API. Stay within 8 agents a session.
