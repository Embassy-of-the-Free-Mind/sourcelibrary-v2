# Preregistration — #6338: does a Gemini second reader find serious errors an Opus reader misses?

PRIOR ART: scripts/eval/PREREGISTRATION-ai-exposure-r3-6038.md (form). The reader brief, packet shape and runner are
the shelf overview's (`scripts/eval/spot-check/`, #6056, #6174); the Opus-vs-Opus noise floor is #6174
(`scripts/eval/experiments/2026-10-07-script-run-reviewers-6174.md`). Plan and discussion: #6338 (comments of
2026-10-08), parent design #6203 point 6.

**Committed before any calibration draw, read or score** (2026-10-08). Before writing it: the harness was run on
SYNTHETIC packets only (`tests/unit/second-reader-6338.test.ts`), and three Opus calls ran by accident on synthetic
packets during a smoke test (fake text, no library page). No real page has been drawn or read for this study.
Nothing below changes after a result is seen. Anything not listed here is labelled *post hoc* in the report.

Code: `scripts/eval/second-reader/` (RUNBOOK.md for the sequence). Results: `scripts/eval/results/second-reader-6338/<script>/`,
committed only after every read and adjudication of that script is done (the planted-error key must stay out of reach
of the readers until then). Write-up: one file in `scripts/eval/experiments/`, verdict on #6338.

## Why

Every `book_checks` verdict (#6174), and so every reader warning (#6199), is one Opus read. Two Opus runs agree with
each other (κ 0.85–0.92 on the serious flag), but agreement within one model family says nothing about what both
miss. The question is practical: **for a given script, does adding a Gemini read surface enough real serious errors
to be worth running on every shelf, or does a second Opus read (or nothing) do as well?**

## Hypotheses

- **H1 (the decision).** On natural pages, Opus + Gemini finds more confirmed serious issues than Opus + Opus.
- **H2 (shared OCR blind spot, #6184).** Gemini's confirmed finds that Opus missed are mostly in the translation
  lane; on OCR misreadings Gemini adds little, because it re-makes the misreading.
- **H3 (family leniency).** The served translations are Gemini's. Gemini's recall on planted *translation* errors is
  lower than Opus's, and its mean English score on the same pages is higher.

## Population and frames (one study per script)

| script (`dominantScript`) | `books.language` in (case-insensitive) | seed |
|---|---|---|
| `latin` | Latin, German, French, Italian, Dutch, Spanish, Portuguese | 20261009 |
| `han` | Chinese, Classical Chinese, Literary Chinese | 20261010 |
| `arabic` | Arabic, Persian, Ottoman Turkish, Urdu | 20261011 |

Tibetan waits for the scholar read (#5800). English-language books are out of the Latin frame (their "translation" is
a different defect, #5913).

- **Books:** `visible: true`, `pages_count > 0`, `pages_translated ≥ 1`, language as above, minus every book in any
  earlier spot-check or shelf-overview packet (`second-reader.mjs exclude`; 112 books on 2026-10-08), whose reviews
  led to hides and fixes.
- **Eligible page:** `page_number > 0`; OCR ≥ 200 characters; translation ≥ 100 characters; `page_type` not in
  {archived-spread, blank, title-page, toc, index, illustration, digitizer-insert, colophon, errata, cover, map,
  plate}; the page's OCR is in the frame's script by `dominantScript` (tags removed); its image downloads (≥ 2 KB).
- **Flagged (the enriched stratum):** pages flagged by `scripts/audit/page-integrity.mjs` (kinds trunc, echo,
  repeat, vocab, meta, ocrleak, dup, pnmis), converted by `second-reader.mjs flagged`. Run on the mirror before the
  draw; the run's date is recorded.

## Sample

- **n = 100 pages from 100 books per script** (`draw.mjs`), one page per book.
- **Enrichment:** 33 books from those carrying a flagged page, 67 from the rest. In a flagged book the page is a
  flagged one with probability 0.8, else uniform over its eligible pages. Every pick records π (book) and q (page);
  books rejected for having no eligible page or no image are replaced, and the acceptance rate per stratum enters π.
  Rates are Hájek-weighted back to "a book at random, then a page at random". Unweighted rates are reported beside.
- **Reading order** is random (seeded). Blocks (the first and last 50 pages) are recorded but, since amendment 1,
  decide nothing.
- **Planted errors:** 28 of the 100 pages (`plantErrors`, seed = draw seed + 1), five classes in rotation: negation
  removed in the English, a number multiplied in the English, a sentence from another book of the same script inserted,
  a middle sentence of the English dropped, the whole text replaced by another book's page (wrong leaf). A page that
  cannot take its class takes the next. Plants are spliced into the page's own text, so its line breaks and markup
  are unchanged and a planted page looks like any other. The key stays in `private/` until all reads are done.
  28% rather than 50%: in human visual search, how often a target appears changes how often it is missed (Wolfe et
  al. 2005). By analogy, a reader meeting errors on half the pages works under a different error density from
  production, where about 1 page in 6 is serious, so its miss and false-alarm rates might not carry over. 28% keeps
  the task closer to production while leaving enough planted errors to measure recall.
- **Packets: one page per call, for every reader** (amendment 2). The rule fixed here first said 5 books per call
  unless the pilot showed a Gemini call could not hold them; it did (a four-image call found about half the errors of
  one call per page), so the rule's own fallback applies.

## Readers (the arms)

Every reader gets the same frozen text — `spot-check/REVIEWER.md` + `second-reader/CALIBRATION-ADDENDUM.md` + the
taxonomy — and the same pinned image files, with model names and URLs removed from the packet, in a sealed folder
(`run-readers.sh`). Claude runs with `--restricted --tools Read Write`: it opens the files itself and cannot leave
the folder (verified 2026-10-08). Gemini runs exactly as in the pilot (amendment 2): `scripts/eval/run-cli-arm.py`,
`agy --mode plan` with no tools, the brief and the one-page packet inline in the prompt with the taxonomy's class
headings, the page image attached, the CLI's nudge when the model asks for a tool (`--attempts 4`), and the JSON in
the reply (`second-reader.mjs cli-requests` / `cli-assemble`; the repository forbids auto-approving an agent CLI,
`tests/unit/no-cli-auto-approve.test.ts`). The inputs are the same bytes; the access differs, and the write-up says so.

| name | engine | model |
|---|---|---|
| `opus-a` (primary) | claude | opus |
| `opus-b` (control) | claude | opus, a second independent run |
| `gemini-pro` | agy via run-cli-arm.py | gemini-3.1-pro-high |
| `gemini-flash` | agy via run-cli-arm.py | gemini-3.8-flash-high |
| `gemini-retest` | agy via run-cli-arm.py | gemini-3.1-pro-high re-run on the Latin script only (Gemini's own test–retest floor) |

A call that returns nothing usable is retried (Claude once; Gemini up to the runner's 4 attempts); a page still
missing counts as **not found** for that reader. So does a page the reader shows it did not see: `right_page: "unsure"`
with no OCR or English score (the pilot's tell for Gemini 3.1 Pro, 3 of 16 pages).

## Measures (as implemented in `second-reader/lib.mjs`; the tests pin each)

- **Issue matching** (`sameIssue`): two readers' issues on a page are one issue when both say wrong leaf; or both
  quote the same lane and the quotes overlap or touch the same sentence (an unpunctuated run counts in 120-character
  windows); or a quote cannot be located and both name the same class in the same lane. A quote not found in the
  text it claims to quote is **fabricated**: it never matches and counts against its reader.
- **Recall on planted errors** (`caughtSeed`), per reader and class: span overlap for negation, number, invented;
  an omission named in the English lane for dropped (its background rate on natural pages reported beside it);
  `right_page: "no"` or OCR score 1 for wrong leaf. Reported as detected (any severity) and serious.
- **Confirmed serious issues** come from adjudication (below). **Yield** of a set of readers on a page = confirmed
  serious issues raised (at any severity) by at least one of them. Natural (unplanted) pages only.
- **False alarms** (amendment 2): a reader's serious issues on natural pages adjudicated **not real**, per 100 pages.
  A real error the reader graded serious and the adjudication did not is **severity inflation**, reported per reader
  beside it and outside the false-alarm cap.
- **Agreement:** Krippendorff's α on natural pages, missing pages allowed: nominal on the serious flag, ordinal on the
  OCR and English scores; opus-a–opus-b (floor), opus-a–each Gemini, gemini-retest pair (Gemini's floor).

## Adjudication

- **Items:** every issue cluster on a natural page that at least one reader called serious, except those all readers
  called serious; of those, a random 10 are adjudicated as a check and the rest are taken as confirmed. Plus planted
  claims: max(5, 10% of items) true (planted spans) and as many false (a sentence of a page no reader flagged,
  claimed as an inverted sense).
- **Blind:** each item shows the image, the texts and the claim as structured fields only (lane, class, quoted
  span), never the reader's wording, in random order (`ADJUDICATOR.md`).
- **Two adjudicators:** Opus and Gemini 3.1 Pro, each blind (one from each family, so neither family settles its
  own findings alone). Where they agree (and
  neither says unsure), that is the verdict. Every split, plus a random 20 items, is read by eye (Derek, or Claude
  reading the image with the item, labelled as such), and the eye's verdict wins. "Unsure" never confirms.
- **Shared misses:** 20 natural pages no reader called serious, read by eye; the share with a serious error is
  reported with a Wilson interval. This is the number capture–recapture cannot give when readers fail alike.

## Decision rule (amendment 1, 2026-10-08, before any data — see "Amendments")

**The unit of the test is the error, not the page.** For each Gemini model *g*, among the confirmed serious issues on
natural pages that **opus-a missed**: *b* = found by *g* (at any severity) and not by opus-b; *c* = found by opus-b
and not by *g*. Both Gemini models are tested; there is no model choice and no block split in the decision.

1. **Primary decision, pooled over the three scripts.** *g* passes if, with *b* and *c* summed over the scripts,
   the one-sided exact sign test gives **p < 0.025** (Bonferroni over the two models), **and** the mean over the
   scripts of the weighted gain `yield(opus-a ∪ g) − yield(opus-a ∪ opus-b)` is **≥ 3 confirmed serious issues per
   100 pages** (point estimate; its 95% interval is reported), **and** in every script *g*'s false alarms are at
   most 3 per 100 pages above opus-a's. **ADOPT** the passing model with the larger gain as a standing second reader;
   if neither passes, **NOT SHOWN**. Reported as provisional until all three scripts are scored.
2. **Per script, the same test on that script's counts.** Reported for every script with its power stated (about
   half the pooled test's; see `power.mjs`). A script that fails while the pooled test passes is reported as "not
   shown for this script", never as "no".
3. **Interim look after the first script (Latin):** stop with a null if for both models *b ≤ c*. No early stop for
   success.
4. **Second Opus read.** `yield(opus-a ∪ opus-b) − yield(opus-a)` is reported per script with its interval: what
   reading twice with the same model buys.
5. H2 and H3 are reported, with intervals, and decide nothing.

*Why 3, not 5, per 100 pages:* under plausible rates (opus-a finds 60% of serious issues; a second Opus re-finds
20% of its misses), +5 per 100 pages needs Gemini to catch about 40 points more of opus-a's misses than a second
Opus does. +3 is a confirmed serious error found on one extra page in 33, for a read that costs CLI quota and no
money; the false-alarm cap bounds what it costs to adjudicate.

## Stop conditions before scoring

- The pilot shows a Gemini model failing on ≥ 20% of calls after one retry: that model is dropped before the draw.
- A reader's transcript shows a READ outside its sealed folder: that packet is re-run; twice for one reader, the
  reader is dropped and the report says so.

## Reporting plan (fixed now, whatever the result)

**Every outcome is published.** An ADOPT, a DO NOT ADOPT, a futility stop, a dropped reader and a script abandoned
for any reason are all reported, on the site and in the paper, with the same tables and figures. A selective
write-up (only the scripts where Gemini helped) is what this section exists to prevent.

**Every number comes from one generated file.** `second-reader.mjs export` reads each script's committed
`report.json` and writes `src/data/second-reader-6338.json`; `export --check` rebuilds it in memory and fails if a
committed number differs. The site renders from that file; the paper's tables are generated from it; the paper's
`VERIFICATION` table maps every number in the text to a field in it. No figure is typed by hand.

**Where it is reported:**
- `scripts/eval/experiments/` (one entry per script round) and a verdict comment on #6338.
- `/research/quality/open` lists the study while it runs; `/research/quality` gets a results section and
  `/quality/methods` the method, once a script is scored. Public copy follows `.claude/docs/quality-statements.md`
  ("AI reviewers", n, date, interval, measured strengths beside measured shortcomings) and merges as `tier:hold`.
- Reader warnings (#6199) cite a reader's calibrated recall for the page's script only after Derek approves the
  wording, and never for a script whose study was not run.
- A dataset (`second-reader-v1`, CC BY-SA 4.0 for our text, images as URL + sha256, the eval canary on every row)
  with a Zenodo DOI, built by `second-reader.mjs dataset` from the committed run directories only.
- A paper (`paper/second-reader-calibration.md`), preprinted with the dataset DOI before submission.

**Tables and figures, fixed now:**
1. Per script and reader: pages returned, recall on planted errors (detected / serious, Wilson 95%), false alarms
   per 100 pages, confirmed serious issues per 100 pages (weighted, 95% by book).
2. Recall by planted class × reader (figure).
3. Per Gemini model, pooled and per script: *b*, *c*, the sign-test p, and the weighted gain over the control
   against the +3 line (figure), with the second-Opus gain beside it.
4. Which readers found which confirmed issues (UpSet figure).
5. Krippendorff's α per pair against the Opus–Opus floor and the Gemini retest floor.
6. Adjudicator accuracy on planted claims and against the eye; shared-miss rate.
7. Cost per confirmed serious issue found, per reader.
8. H2 (lane of unique finds) and H3 (recall on planted translation errors; mean English score) with intervals.

**Deviations** from this document are listed in the paper's method section with the date and reason; an analysis
not listed here is labelled *post hoc* wherever it appears.

## Amendments

**1 (2026-10-08, before any page was drawn).** A simulation of the first decision rule (`second-reader/power.mjs`)
showed it could not do its job: with block 2 alone (about 36 natural pages a script) and page-level weighting, a
true gain of +6.3 per 100 pages was adopted 34% of the time (+9.4: 60%). Replaced by the error-level sign test above,
pooled over scripts: 93% at +6.3, 75% at +4.7, under 1% when Gemini adds nothing (600 simulated studies each).
Changed with it: no block split or model choice in the decision (both models tested, Bonferroni); the practical bar
from 5 to 3 per 100 pages (reason under the rule); the second adjudicator fixed as Gemini 3.1 Pro; the retest model
fixed as Gemini 3.1 Pro. Sample, readers, planting, matching and adjudication are unchanged.

**2 (2026-10-09, after the feasibility pilot and before any page was drawn).** The pilot (16 pages of an earlier
shelf review, three Gemini settings; `scripts/eval/experiments/2026-10-09-second-reader-pilot-gemini-cli-6338.md`)
read nothing this study will sample and gave no rate; it measured how a Gemini read runs. Three changes follow from it:
- **One page per call for every reader**, by the fallback this document already set (a four-image call found about
  half the errors). The runner is the pilot's (`run-cli-arm.py`: plan mode, nudge on a denied tool, a call log).
- **A false alarm is a claim adjudicated not real.** The pilot's Gemini readers called 15 of 16 pages serious where
  Opus called 6. Counting a real but over-graded error as a false alarm would decide the study on severity labels,
  not on what the reader finds; such errors are reported as severity inflation instead.
- **A page the reader did not see counts as not found**, by the pilot's tell (`right_page: "unsure"` with no scores).

## Limits to state in any write-up

No scholar is in the loop: adjudication is two more model reads plus by-eye checks by non-specialists, and on a
script the checker cannot read, by-eye means layout, numbers and alignment only. Recall on planted errors measures
detection of the kinds planted, not of every error. The CLI request is not the API request (thinking level,
temperature). The pages are frozen at draw time. "Serious" is the reviewer brief's definition, not a severity rated by
readers (#6203 step 0). Claude opens its files with a tool across several turns; Gemini receives them attached to one call, so a difference
between the families may partly be a difference in access. Gemini also sees the taxonomy's class headings, not the
whole file, and is nudged once when it asks for a tool (the pilot's runner).

## Budget

Per script: 2 × 100 Opus calls of one page each (the brief and taxonomy are re-read every call, so more than the
$0.15–0.20 a page of multi-page packets: estimate $0.25–0.35) plus adjudication, ≈ $60–80 API-equivalent on the
subscription; two Gemini reads of 100 pages each through the CLI ($0; the pilot measured ≈ 1.4 h for Pro and 1.0 h for
3.8 Flash high per 100 pages at two calls at a time); 2–3 h by eye in all. $0 API. No production
write; the `book_checks` rows are written only after the verdict, for the pages read, with reader and calibration id.
