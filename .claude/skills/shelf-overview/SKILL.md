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
- **Also done** (`overview-2026-10-07-eternity2/`): Hindu/Vedanta/Bhakti Sanskrit, Greek+Latin classics, Chan/Zen,
  Latin Kabbalah, Korean, Japanese. Their keyword frames are in that run's `draw-log.json` (`desc` + `frame_ids`).
- **Mongolian has nothing to read** (2026-10-07: 108 Kanjur volumes, all hidden, 0 OCR pages). Re-check before drawing.
- A keyword frame drags in false positives (an author named in a title, a Reuchlin dictionary). Read 15 random
  titles from each frame before you draw, and tighten the frame rather than redraw after.

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

## 3. Review: one Opus reviewer per stratum, at most 6. Run them from the script, not from this session
`scripts/eval/spot-check/run-reviewers.sh <dir>/packets <scratchpad>/overview` (add `CURATION-ADDENDUM.md` as a third
argument for the curation check). It launches the prompt below as headless `claude -p --model opus` calls in
parallel, retries a call that ends without its file, and writes `meta/` with each call's cost. Then run
`python3 scripts/eval/spot-check/run-cost.py <scratchpad>/overview`.
- Measured on #6174: $0.15–0.20 per page.
- Agreement with session-run reviews is the same as two script runs agreeing with each other (κ 0.85–0.92).
- Run it under `nohup`, or as a Hetzner job, and leave this window quiet while it runs.
- **Every run rereads one stratum (standing rule, #6174).** It costs about $2.50 and builds the reviewer-consistency
  series:
  1. Pick one packet at random: `ls <dir>/packets | shuf -n1`.
  2. Copy it alone into `<scratchpad>/retest-packets/` and run the runner again into `<scratchpad>/retest`.
  3. Run `review-agreement.py RUN=<scratchpad>/overview RETEST=<scratchpad>/retest > <dir>/agreement.md`. The weekly
     subscription report lists every `agreement.md` on main.
  4. Put the κ in your #6056 line.

  A serious-flag κ below 0.7 means the stratum's rate is noise-dominated: say so in the report rather than quote
  the rate.
- To measure reviewer consistency on a whole new shelf, run it twice and compare with
  `scripts/eval/spot-check/review-agreement.py A=<dir1>/reviews B=<dir2>/reviews`.
  The pattern is in `2026-10-07-script-run-reviewers-6174.md`.

Fallback when `claude -p` is unavailable: the Agent tool with `model: "opus"`, `run_in_background: true`. The prompt is exactly:
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
- `cp <scratchpad>/overview/reviews/*.json <dir>/reviews/` (run-reviewers.sh writes them under `reviews/`).
- **Rights notes stay out of the public repo:** first copy the unredacted files to ops `quality-sprint/<dir name>/`,
  then run `node scripts/eval/spot-check/redact-rights.mjs <dir>/reviews/*.json`.
- `node --env-file=.env.production.local scripts/eval/spot-check/overview-score.mjs --dir <dir> --meta <scratchpad>/overview/meta`
  writes `report.md` and `report.json`, and records one `book_checks` row per book (method `shelf-overview`, #6174),
  each with its share of the reviewers' cost from `--meta`.
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

Budget: 6 Opus reviewers for 96 pages ≈ $15–19 API-equivalent, about 0.6–0.75 of a weekly point (#6174), $0 API.
Stay within 8 agents a session.

## Hand-picked variant: the curation check (a worklist, NOT a rate)
Use this when the question is only "which of THESE books can we show <partner>?" and someone has already chosen the
books for interest. First run: Eternity, 107 books, 2026-10-06
(`scripts/eval/experiments/2026-10-06-eternity-shelf-review.md`). It shares this skill's tools and differs in three ways:

- **Pick, don't draw.** `strata.json` lists the chosen ids per tradition (`"id"` or `"id:page"`). Run
  `overview-draw.mjs --picked --strata … --out scripts/eval/results/spot-check/curation-<date>-<tag>`: every id is
  taken, with two consecutive mid-book pages. Finding candidates is a Mongo query per language (public, mostly
  translated, sorted by `read_count`), written to the scratchpad.
- **Reviewer brief:** REVIEWER.md, then `scripts/eval/spot-check/CURATION-ADDENDUM.md` (not the overview addendum).
  One Opus reviewer per tradition; each writes `<scratchpad>/curation/<tradition>.json`, an array of
  `{ book_id, tier, title, note, interest }`. Copy them to `<dir>/verdicts/` with Bash; rights notes go to ops only.
- **No score.** `overview-score.mjs` refuses a `--picked` run. The verdicts go to a PRIVATE collection, where the
  person choosing what to show opens them:
  `curation-shelf.mjs --slug <private collection> --verdicts <dir>/verdicts [--apply]` (dry run by default; it
  refuses a public collection). `--list` prints the shelf.

Never quote its tier shares as quality: the books were chosen, two pages were read, and a tier-1 book can still hold
bad pages. For a number, run the random draw above. What the curation check is good for is the worklist and new defect
classes; a class still needs 3 distinct books and a detector (step 5) before it counts as general.

