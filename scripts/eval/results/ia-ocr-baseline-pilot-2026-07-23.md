# IA-OCR corpus baseline — pilot (2026-07-23)

Internet Archive's own OCR (ABBYY/Tesseract-class, non-generative — it cannot
recite memorized canonical text) fetched for the same scans we hold, page-aligned
by TEXT MATCHING against our `pages.ocr.data`, and scored for word/char agreement
by script × century. Zero AI cost: Mongo reads + polite HTTP fetches + local
compute only. Script: `scripts/eval/ia-ocr-baseline.mjs`. Sample spec:
`ia-ocr-baseline-sample-spec-2026-07-23.json`. Rows: `ia-ocr-baseline-pilot-2026-07-23.jsonl`.

## Interpretation — read this before the table

Where IA is competent (clean 19th/20th-c roman type), ours-vs-IA disagreement is an
**upper bound on combined error** — IA is an INDEPENDENT, non-generative reading a
skeptical outsider can reproduce themselves from a public archive.org URL, with no
memorization channel. **Agreement is not accuracy** — a page where both sides mis-
transcribe the same word in the same way still "agrees"; a page where our OCR is
correct and IA garbles a ligature "disagrees" while our text is fine. Treat this
table as a bound and a corroboration signal, not a scorecard.

Where the baseline COLLAPSES (empty/near-empty/garbage IA text — expected on 16th-c
ligatures and on CJK per the 2026-07-20 Tesseract-typography finding), the resulting
low agreement or high unalignable rate is **UNMEASURABLE, not evidence our OCR is
better**. Those strata are called out explicitly below.

## ⚠ This run was stopped early — 10 of 13 strata have ZERO data, not "collapse" data

The fetch stage was interrupted for time before it reached most strata (sampling
proceeds stratum-by-stratum in `STRATA` order: Latin → English → German → French →
Greek → Hebrew → Chinese). Of 200 sampled books, only the first 41 were attempted —
all in Latin (1500s, 1800s) and the start of English (1600s) — before the run was
stopped. **English 1900s, both German strata, both French strata, both Greek strata,
Hebrew, and both Chinese strata have exactly zero books attempted.** Their rows below
read "skipped / not_fetched (15)" for a mundane reason (ran out of wall-clock), NOT
because IA's OCR collapsed on them. In particular: **the Chinese (CJK) stratum —
this design's expected-collapse control — was never actually fetched in this run, so
the "expected collapse" claim below is the pre-registered PREDICTION from the
2026-07-20 Tesseract-typography finding, not something this run confirmed.** Treat
every stratum with 0 aligned + 0 unalignable + all-skipped as UNSTARTED, distinct
from a genuine collapse (fetched, but the baseline had nothing readable to compare).

## Book counts

- sampled: **200**
- aligned (probes matched, scored): **35**
- unalignable (fetched OK, page-align failed): **2**
- skipped (never fetched — no djvu.txt, HTTP error, etc.): **163**
- page rows scored: **696**

### Top skip/unalignable reasons

| reason | books |
|---|---:|
| not_fetched | 159 |
| djvu_xml_too_large_69MB | 1 |
| only_2_of_5_probes_matched | 1 |
| timeout_after_120000ms_twice | 1 |
| no_djvu_xml (404) | 1 |
| djvu_xml_too_large_62MB | 1 |
| only_0_of_5_probes_matched | 1 |

### Per-stratum book outcomes

| stratum | aligned | unalignable | skipped | top reason |
|---|---:|---:|---:|---|
| Latin 1500s (early print, ligatures) | 18 | 1 | 1 | djvu_xml_too_large_69MB (1) |
| Latin 1800s (roman type) | 14 | 0 | 1 | timeout_after_120000ms_twice (1) |
| English 1600s (early modern) — **partially run, cut off mid-stratum** | 3 | 1 | 11 | not_fetched (9) |
| English 1900s — **UNSTARTED (0 books attempted)** | 0 | 0 | 15 | not_fetched (15) |
| German 1600s — **UNSTARTED (0 books attempted)** | 0 | 0 | 15 | not_fetched (15) |
| German 1900s — **UNSTARTED (0 books attempted)** | 0 | 0 | 15 | not_fetched (15) |
| French 1600s — **UNSTARTED (0 books attempted)** | 0 | 0 | 15 | not_fetched (15) |
| French 1800s — **UNSTARTED (0 books attempted)** | 0 | 0 | 15 | not_fetched (15) |
| Greek 1500s — **UNSTARTED (0 books attempted)** | 0 | 0 | 15 | not_fetched (15) |
| Greek 1800s — **UNSTARTED (0 books attempted)** | 0 | 0 | 15 | not_fetched (15) |
| Hebrew (pooled) — **UNSTARTED (0 books attempted)** | 0 | 0 | 15 | not_fetched (15) |
| Chinese 1600s (expected-collapse control) — **UNSTARTED, not confirmed this run** | 0 | 0 | 15 | not_fetched (15) |
| Chinese 1800s (expected-collapse control) — **UNSTARTED, not confirmed this run** | 0 | 0 | 15 | not_fetched (15) |

## Script × century agreement (ours vs IA)

Only pages with **no screens tripped** on either side (not image-only, not
degenerate/repetition-looping, not entity-padded) enter this table — see the JSONL
for the full row-level detail including screened-out pages. Covers only the three
strata that got any data (see caveat above) — this is NOT the full script × century
matrix the brief called for.

| script class | language | century | n pages | mean agreement |
|---|---|---:|---:|---:|
| spaced | Latin | 1500s | 348 | 27.2% |
| spaced | English | 1600s | 57 | 64.9% |
| spaced | Latin | 1800s | 268 | 60.6% |

Reading these three honestly: Latin 1500s (early print, ligatures) at 27.2% is
consistent with the Tesseract-typography lesson — ligatures and long-s hurt a
non-generative baseline. Latin 1800s at 60.6% (clean roman type, where the lesson
predicts IA should be strong) is lower than expected; row-level inspection during
validation found at least one contributing book is a bilingual Greek/Latin critical
edition (Hultsch's Hero of Alexandria) where individual pages are tagged
`<language>Ancient Greek</language>` at the page level despite the book's `language`
field reading "Latin" — IA's OCR reads the embedded polytonic Greek badly, dragging
down a stratum whose book-level label doesn't reflect its actual per-page script
mix. This is a genuine, useful finding (book-level language ≠ page-level script in
bilingual critical editions) but means the 60.6% figure is a mix of two typographic
regimes, not a clean roman-type number — the full run should screen for this by
checking `pages.ocr.language`, not just `books.language`, when assembling the
Latin/Greek strata.

## Row-count verification (dedup check)

696 JSONL rows = 35 aligned books × up to 20 pages each (some books contributed
fewer than 20 because not every predicted page fell inside IA's page range or had
≥80 chars of our own OCR text). Verified by deduping on `(book_id, page_id)`:
**696 rows, 696 unique keys, 0 duplicates** — no re-append bug, no double-write.

## Full-corpus run estimate (from THIS run's real throughput)

The fetch stage attempted 41 books in ~16 minutes of wall-clock before being
stopped (≈23s/book average, dominated by download time — see below, not the 2s
politeness delay). Extrapolating:
- **Finishing this 200-book pilot:** ~159 books remaining × ~23s ≈ **60–65 more
  minutes** of fetch time, then a few seconds of scoring.
- **A corpus-scale run** (all ~22,936 `bookstore.books` docs with `ia_identifier`
  set and `pages_ocr > 0`, per the Mongo count taken at sample time): 22,936 × 23s
  ≈ 527,000s ≈ **~6 days of continuous single-threaded polite fetching**. This is
  fetch-bound, not compute-bound — scoring is local and fast (696 pages scored in
  well under a second). Real accelerants for a corpus-scale run: (a) modest fetch
  concurrency (a handful of parallel connections — still well within "polite" for
  a public archive, just not literally one-at-a-time), (b) dropping the per-item
  size cap lower to skip more outliers faster, (c) accepting a stratified SAMPLE
  (a few hundred books/stratum) rather than the full corpus, which is almost
  certainly the right call for the calibration use case this experiment serves.
- **Cost: $0** either way — no model calls, only Mongo reads and archive.org GETs.

## What the full run needs

- **Extend the sample spec, don't restart it.** `--stage=sample` re-samples fresh
  random books per stratum; to grow the corpus, raise each stratum's `n` in
  `STRATA` (or add new language/century strata) and diff `book_id` against the
  existing `ia-ocr-baseline-sample-spec-2026-07-23.json` so already-fetched books aren't re-downloaded.
- **Resume this exact run first** — 10 of 13 strata are UNSTARTED (see caveat
  above), not collapsed. Re-running `--stage=fetch` against the existing sample
  spec picks up exactly where the manifest left off (already-cached books are
  skipped) and would reach German/French/Greek/Hebrew/Chinese with no new sampling.
- **Download time dominates wall-clock more than the 2s politeness delay.**
  `_djvu.xml` (word-boxed, page-indexed — see script header) runs 1-40MB per book
  in this sample, some derivatives well over that for multi-volume works; a 200-book
  pilot took on the order of an hour. Run fetch detached (nohup) with the manifest's
  resume-on-restart behavior — a killed job loses nothing already cached — and budget
  proportionally more wall-clock (not more request volume) for a multi-thousand-book run.
- **CJK and pre-1500 strata need a different instrument, not more IA fetches.**
  If IA's OCR is structurally near-empty on those pages, no amount of additional
  sampling produces a measurement — see the degradation/occlusion pilot and the
  within-work canonicity pairs in the paper doc for how those get evidence instead.
- **Consider Kraken for the CJK/manuscript gap.** Kraken has historical-script
  models and might not collapse the way IA's engine does — worth a small side-check
  before concluding those strata are unmeasurable corpus-wide.
- **hOCR instead of djvu.txt** would carry per-word bounding boxes, enabling a
  region-level (not just page-level) agreement check — deferred for the pilot.
