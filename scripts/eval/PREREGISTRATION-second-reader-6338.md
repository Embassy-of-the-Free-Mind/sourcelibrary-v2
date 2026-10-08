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
- **Reading order** is random (seeded); **block 1** is the first 50 pages, **block 2** the last 50.
- **Planted errors:** 28 of the 100 pages (`plantErrors`, seed = draw seed + 1), five classes in rotation: negation
  removed in the English, a number multiplied in the English, a sentence from another book of the same script inserted,
  a middle sentence of the English dropped, the whole text replaced by another book's page (wrong leaf). A page that
  cannot take its class takes the next. Plants are spliced into the page's own text, so its line breaks and markup
  are unchanged and a planted page looks like any other. The key stays in `private/` until all reads are done.
  28% rather than 50%: readers who meet errors on half the pages learn to over-flag (the prevalence effect), and the
  false-alarm rate would not carry to production, where about 1 page in 6 is serious.
- **Packets:** 5 books per call. If the #6338 pilot shows a Gemini call cannot hold 5 single-page books, 1 per call for
  every reader (recorded in the run's README before the first read).

## Readers (the arms)

Every reader gets the same frozen text — `spot-check/REVIEWER.md` + `second-reader/CALIBRATION-ADDENDUM.md` + the
taxonomy — and the same pinned image files, with model names and URLs removed from the packet, in a sealed folder
(`run-readers.sh`; for claude the CLI's `--restricted` confines it there, verified 2026-10-08).

| name | engine | model |
|---|---|---|
| `opus-a` (primary) | claude | opus |
| `opus-b` (control) | claude | opus, a second independent run |
| `gemini-pro` | agy | gemini-3.1-pro-high |
| `gemini-flash` | agy | gemini-3.8-flash-high |
| `gemini-retest` | agy | the model chosen on block 1, re-run on the Latin script only (Gemini's own floor) |

A call that writes nothing is retried once; a page still missing counts as **not found** for that reader.

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
- **False alarms:** a reader's serious issues on natural pages adjudicated not real-and-serious, per 100 pages.
- **Agreement:** Krippendorff's α on natural pages, missing pages allowed: nominal on the serious flag, ordinal on the
  OCR and English scores; opus-a–opus-b (floor), opus-a–each Gemini, gemini-retest pair (Gemini's floor).

## Adjudication

- **Items:** every issue cluster on a natural page that at least one reader called serious, except those all readers
  called serious; of those, a random 10 are adjudicated as a check and the rest are taken as confirmed. Plus planted
  claims: max(5, 10% of items) true (planted spans) and as many false (a sentence of a page no reader flagged,
  claimed as an inverted sense).
- **Blind:** each item shows the image, the texts and the claim as structured fields only (lane, class, quoted
  span), never the reader's wording, in random order (`ADJUDICATOR.md`).
- **Two adjudicators:** Opus and the Gemini model not chosen as the candidate, each blind. Where they agree (and
  neither says unsure), that is the verdict. Every split, plus a random 20 items, is read by eye (Derek, or Claude
  reading the image with the item, labelled as such), and the eye's verdict wins. "Unsure" never confirms.
- **Shared misses:** 20 natural pages no reader called serious, read by eye; the share with a serious error is
  reported with a Wilson interval. This is the number capture–recapture cannot give when readers fail alike.

## Decision rule (per script)

1. **Model choice on block 1:** the Gemini model with the higher serious recall on block-1 planted pages; within 5
   points, the higher yield gain over the control; within 1 per 100 pages, the fewer false alarms.
2. **Interim look after block 1:** stop the script with a null if, for every Gemini model, the 99% interval of the
   gain lies below +5 per 100 pages. No early stop for success.
3. **Final, on block 2, the chosen model only:** **ADOPT** Gemini as a standing second reader for the script if the
   gain `yield(opus-a ∪ gemini) − yield(opus-a ∪ opus-b)` is **≥ 5 confirmed serious issues per 100 pages**, its 95%
   interval (bootstrap by book, weighted) is above 0, **and** Gemini's false-alarm rate is at most 3 per 100 pages
   above opus-a's (a false alarm costs a minute of adjudication; a missed serious error misleads a reader).
   Otherwise **DO NOT ADOPT**; if `yield(opus-a ∪ opus-b) − yield(opus-a)` meets the same bar, recommend a second
   Opus read instead.
4. H2 and H3 are reported, with intervals, and decide nothing.

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
3. Gain of the chosen Gemini over the control on block 2, per script, against the +5 line (figure), with the
   second-Opus gain beside it.
4. Which readers found which confirmed issues (UpSet figure).
5. Krippendorff's α per pair against the Opus–Opus floor and the Gemini retest floor.
6. Adjudicator accuracy on planted claims and against the eye; shared-miss rate.
7. Cost per confirmed serious issue found, per reader.
8. H2 (lane of unique finds) and H3 (recall on planted translation errors; mean English score) with intervals.

**Deviations** from this document are listed in the paper's method section with the date and reason; an analysis
not listed here is labelled *post hoc* wherever it appears.

## Limits to state in any write-up

No scholar is in the loop: adjudication is two more model reads plus by-eye checks by non-specialists, and on a
script the checker cannot read, by-eye means layout, numbers and alignment only. Recall on planted errors measures
detection of the kinds planted, not of every error. The CLI request is not the API request (thinking level,
temperature). The pages are frozen at draw time. "Serious" is the reviewer brief's definition, not a severity rated by
readers (#6203 step 0). Gemini runs through `agy` are not audited for reads outside the folder.

## Budget

Per script: about 2 × 100 Opus page reads at $0.15–0.20 plus adjudication, ≈ $45 API-equivalent on the subscription;
two Gemini reads of 100 pages each through the CLI ($0, ≈ 1–2 h of quota); 2–3 h by eye in all. $0 API. No production
write; the `book_checks` rows are written only after the verdict, for the pages read, with reader and calibration id.
