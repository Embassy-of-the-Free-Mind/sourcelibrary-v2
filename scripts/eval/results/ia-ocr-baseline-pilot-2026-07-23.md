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

## Book counts

- sampled: **200**
- aligned (probes matched, scored): **115**
- unalignable (fetched OK, page-align failed): **61**
- skipped (never fetched — no djvu.txt, HTTP error, etc.): **24**
- page rows scored: **2276**

### Top skip/unalignable reasons

| reason | books |
|---|---:|
| only_0_of_5_probes_matched | 44 |
| no_djvu_xml (404) | 14 |
| only_2_of_5_probes_matched | 10 |
| only_1_of_5_probes_matched | 4 |
| timeout_after_120000ms_twice | 3 |
| djvu_xml_too_large_48MB | 2 |
| djvu_xml_too_large_69MB | 1 |
| djvu_xml_too_large_62MB | 1 |
| djvu_xml_too_large_56MB | 1 |
| inconsistent_offsets_across_probes | 1 |
| djvu_xml_too_large_71MB | 1 |
| djvu_xml_too_large_84MB | 1 |
| insufficient_probe_text | 1 |
| only_0_of_4_probes_matched | 1 |

### Per-stratum book outcomes

| stratum | aligned | unalignable | skipped | top reason |
|---|---:|---:|---:|---|
| Latin 1500s (early print, ligatures) | 18 | 1 | 1 | djvu_xml_too_large_69MB (1) |
| Latin 1800s (roman type) | 14 | 0 | 1 | timeout_after_120000ms_twice (1) |
| English 1600s (early modern) | 10 | 1 | 4 | no_djvu_xml (404) (2) |
| English 1900s (modern roman) | 12 | 1 | 2 | no_djvu_xml (404) (2) |
| German 1600s (Fraktur likely) | 9 | 5 | 1 | only_2_of_5_probes_matched (2) |
| German 1900s (Fraktur/roman mix) | 11 | 1 | 3 | no_djvu_xml (404) (3) |
| French 1600s | 14 | 1 | 0 | inconsistent_offsets_across_probes (1) |
| French 1800s | 12 | 1 | 2 | no_djvu_xml (404) (2) |
| Greek 1500s (polytonic print) | 2 | 11 | 2 | only_0_of_5_probes_matched (8) |
| Greek 1800s | 10 | 2 | 3 | djvu_xml_too_large_48MB (2) |
| Hebrew (all centuries, pooled — sparse corpus) | 2 | 8 | 5 | only_0_of_5_probes_matched (5) |
| Chinese 1600s — EXPECTED-COLLAPSE control **[EXPECTED-COLLAPSE CONTROL]** | 0 | 15 | 0 | only_0_of_5_probes_matched (15) |
| Chinese 1800s — EXPECTED-COLLAPSE control **[EXPECTED-COLLAPSE CONTROL]** | 1 | 14 | 0 | only_0_of_5_probes_matched (12) |

## Script × century agreement (ours vs IA)

Only pages with **no screens tripped** on either side (not image-only, not
degenerate/repetition-looping, not entity-padded) enter this table — see the JSONL
for the full row-level detail including screened-out pages.

| script class | language | century | n pages | mean agreement |
|---|---|---:|---:|---:|
| spaced | Latin | 1500s | 348 | 27.2% |
| spaced | Greek | 1500s | 39 | 39.6% |
| spaced | Hebrew | 1500s | 18 | 38.3% |
| spaced | English | 1600s | 195 | 56.6% |
| spaced | German | 1600s | 169 | 47.7% |
| spaced | French | 1600s | 272 | 59.0% |
| spaced | Latin | 1800s | 268 | 60.6% |
| spaced | French | 1800s | 209 | 80.5% |
| spaced | Greek | 1800s | 191 | 63.3% |
| spaced | Hebrew | 1800s | 18 | 51.9% |
| spaced | Chinese | 1800s | 14 | 73.3% ⚠ UNMEASURABLE (expected baseline collapse) |
| spaced | English | 1900s | 222 | 87.4% |
| spaced | German | 1900s | 208 | 55.3% |

## What the full run needs

- **Extend the sample spec, don't restart it.** `--stage=sample` re-samples fresh
  random books per stratum; to grow the corpus, raise each stratum's `n` in
  `STRATA` (or add new language/century strata) and diff `book_id` against the
  existing `ia-ocr-baseline-sample-spec-2026-07-23.json` so already-fetched books aren't re-downloaded.
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
