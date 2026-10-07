# Preregistration — OCR engine for the 8,141 Chinese books held out of #4719 (#5547)

PRIOR ART: `PREREGISTRATION-chinese-ext-4925.md` (the cost-lane rule, the arms, the reference
method — reused verbatim where it applies) and `cursive-census-classify.mjs` (#5100: the #4745
six-class page classifier, metered and capped). Neither measured the population at stake here:
the 2026-09-18 cell was a benchmark draw over all Chinese books; this one is the actual held cohort.

Written 2026-10-01, after the draw was sealed and BEFORE any engine or classifier ran on it.
Nothing below changes after the run; deviations are reported as deviations.

## Population and draw (sealed: `scripts/eval/benchmark/chinese-cohort-5547.json`, seed 5547)

- Cohort: the 7,894 books of `/root/preview-stubs-4719/ids-chinese-held-5481.txt` + the 247
  Chinese books still in the #4719 `ids.txt` (in flight, being OCR'd by lite now) = 8,141 books,
  1,205,682 pages (`pages_count`). Measured at seal: **7,883 of the 7,894 held books are
  Siku Quanshu-shaped** (IA `*.cn` Wenyuange scans, `(vol N)` titles); the catalogue shape is not
  the page class, so the census below decides.
- `census` (300 pages): books drawn without replacement with probability ∝ pages_count,
  one page uniform over the interior 10–90 %. Page-weighted: class shares estimate the share
  of the cohort's PAGES.
- `inflight` (240 pages): every remaining in-flight Chinese book, one interior page each.
- One page per book throughout. No text screen (an illustration page is a census answer).

## Step 1 — page-class census

- Classifier: `gemini-3-flash-preview`, thinking off, temperature 0, the #4745 six-class prompt
  verbatim, run by `cursive-census-classify.mjs` (metered, capped). Classes reported as
  typeset / woodblock (regular + cursive) / manuscript-regular / manuscript-cursive /
  illustration / other.
- Shares over the 300 `census` pages with Wilson 95 % intervals. The `inflight` pages are
  classified too but do not enter the census shares (they are not a page-weighted draw).
- **By-eye check (labelled `read-from-image`, a model reading the image, not a human):** 30
  census pages — every page the classifier puts outside `manuscript-regular` (up to 15), the
  rest a seeded random fill from `manuscript-regular` — read from the image with the classifier
  label hidden, then joined. Reported: agreement on the class, and on the woodblock-vs-manuscript
  axis.
- **Step 3 trigger:** woodblock (regular + cursive, classifier) ≥ 15 % of census pages AND the
  by-eye check does not overturn that. Otherwise step 3 is not run and the reason is recorded.

## Step 2 — lite on the real cohort

- Arms on all 540 pages, generic transcription prompt of `benchmark-run-api.mjs` (the
  benchmark's, so the result sits on the 2026-09-18 footing), thinking 0, temperature 0:
  `gemini-3.1-flash-lite` (production model) and `gemini-3-flash-preview` (probe + second reader);
  `paddleocr-vl-1.6` on the leased L4 (second reader). The stored preview-era reading
  (`stored-gemini-3-flash-preview`, production prompt) is kept where the drawn page has one and
  is exploratory only.
- **Production lite output**: if ≥ 50 drawn in-flight pages have a production lite reading
  when scoring starts, it is scored as its own arm (`prod-lite`); otherwise the count is reported
  and the job does not wait.
- References: `benchmark-refs.mjs --wide` (Kanripo by title + juan, all juan files of the work on
  the WYG branch; CBETA for Buddhist titles), ≥ 0.35 4-gram overlap, scorer's `ref_mismatch`
  guard. Only referenced pages give `accuracy` numbers; everything else is `agreement`, labelled.
- Primary number: **lite catastrophic rate (CER > 0.5 vs reference) per observed class**, with a
  Wilson 95 % interval. "The benchmark's 20 % holds here" ⇔ the manuscript-regular interval
  contains 0.20 (09-18: 14 of 69 referenced manuscript pages). Secondary: loop rate, reading-order
  gap (bag-of-words − sequence, the scorer's `gap`), and the agreement screen (lite vs Paddle and
  lite vs flash-preview CER > 0.5) on unreferenced pages, each labelled `agreement`.
- **Replication of the cost-lane rule**: `benchmark-cost-lane.mjs` on this stratum, class
  manuscript-regular, Paddle vs lite, the 09-18 rule unchanged (median Δ ≤ +0.02, CI-upper ≤
  +0.05, catastrophic ≤ lite + 1, invention ≤ lite, loops ≤ lite; ≥ 50 referenced pages). The
  A-vs-A floor is not re-run: the 09-18 lite REPEAT tied 63/65 at temperature 0 (floor 0), and
  that is the floor cited — a deviation from the 09-18 design, stated here in advance.

## Step 4 — Paddle scale pilot

- Books: 30 drawn (Mulberry32 seed 5547 over the id-sorted list) from the cohort books whose
  drawn page the classifier called `manuscript-regular`; processed whole, in draw order, on one
  leased L4 (`owner=5547`, `--progress`-free lease of ≤ 5 h, under `idle-poweroff.sh run --`).
  Images fetched to Hetzner and pushed to the box BEFORE it boots. The 540 sample pages run first.
- **Time box:** inference stops at 3 h of wall clock on the box, or at the €5 GPU cap, whichever
  is first; books are only counted when complete. Reported: books / pages completed, s/page
  (wall, including the pipeline's layout step), error and empty-page rate, loop rate (scorer's
  rule), €/page at the Scaleway L4 list rate actually billed (boot to confirmed stop).
- **Writer check:** the outputs are written to files only. A dry-run builds, for 5 pages, the
  exact update the production OCR writer would apply (engine, model version, `ocr.source`,
  revision row, licence) and reports whether the writer can accept a non-Gemini reading without
  code changes. Nothing is written to `pages`.

## Step 5 — duplicates (#4270)

- A held book is a **duplicate read** if another held book or a live book (`pages_count > 0`)
  carries the same Kanripo `work_id` (`kr:KR…`) AND its title's juan range overlaps this book's.
  Ranges are parsed from the title (`卷N~卷M`, Chinese numerals); a book with no parseable juan
  is counted separately, never as a duplicate. Reported as books and pages.

## Decision row (the output)

Per class: engine, measured €/page or $/page, the evidence cell, and a recommended default.
Spend cap for the whole eval: $10 (≈ $3 Gemini, ≈ €5 GPU); a step that would exceed it stops
and is reported on #5547.
