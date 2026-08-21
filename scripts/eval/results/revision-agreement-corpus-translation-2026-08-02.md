# OCR revision agreement — full corpus (2026-08-02)
Corpus-scale extension of the agreement→accuracy calibration pilot (#3235).
Every consecutive rewrite transition in `page_revisions` (field `ocr`), plus the
final stored revision against the live `pages.ocr`. Metric: wrapper-stripped,
letters-only, word-level normalized Levenshtein similarity (cap 800 words) —
identical to `revision-agreement-pilot.mjs`. No model calls; Mongo reads only.
## Corpus summary
- revisions read: **134,544**
- pages with revisions: **133,287** (1,749 live page docs not found — book purged; their rev→rev pairs are still included)
- computable pairs: **130,049** (4,412 skipped: single-element chain or empty after stripping)
### Pair eligibility
Stated before the analysis, not filtered after it. Body-word count excludes
annotation (`<image-desc>`, inline marks, headings) — it is what was actually
*transcribed*. Every computable pair lands in exactly one class:
| class | criterion | n | share | mean agreement |
|---|---|---:|---:|---:|
| eligible | max body ≥ 40 words | 126,149 | 97.0% | 35.3% |
| micro_text | 15–40 words (title pages, colophons) | 1,126 | 0.9% | 34.1% |
| image_only | < 15 words on both sides (covers, plates) | 2,774 | 2.1% | 29.1% |
Only **eligible** pairs enter the headline, the strata and the regression queue.
`image_only` pairs disagree by construction: both sides are AI descriptions of the
same picture, so a low score there means two different sentences about one engraving,
not lost text. `micro_text` is real but the metric is unstable on a few dozen words.
Pairs where either side is an untagged AI refusal or preamble: **368** —
kept (a refusal replacing a transcription is a genuine regression), counted here.
**Eligible pairs: 126,149.**
- **median agreement 19.8%** (p25 7.2%, p75 63.5%) — primary metric: char-level on space-less scripts, word-level elsewhere
- mean agreement 35.3% — QUOTE THE MEDIAN, not this. The distribution is heavily left-tailed: a catastrophic minority drags the mean ~11pp below the typical pair.
- mean agreement, pilot-parity word metric on every script: 35.3% — the gap is the CJK/Tibetan tokenization artifact
- agreement distribution: [0–0.5) 62.4% · [0.5–0.7) 15.9% · [0.7–0.85) 11.5% · [0.85–0.95) 3.1% · [0.95–1) 4.2%
- regression candidates (agreement<0.5 AND current <60% of prior length): **6,569** (5.21% of eligible)
## Did the two passes read the same leaf? (#3473)
The printed page number is transcribed *from the leaf the model was shown*, so it
identifies which image a pass read independently of how well it read it. Two passes
printing different numbers did not look at the same page — their disagreement is
re-archiving, not reading difficulty. This matters because the corpus is consumed as
a double-OCR dataset: `calibration-scorecard.mjs` fits agreement→accuracy on anchor
pages and applies it here, which assumes both sides read one image.
- same leaf (both numbers present and equal): **1,005** · median agreement 98.5%
- DIFFERENT leaf: **1,528** · median agreement 7.4%
- unmeasurable (no printed number on one side): **123,616** — counted as neither, never folded into "same"
- shifted share of measurable pairs: **60.3%**
- most common offsets (current − prior): `+1` ×1,350 · `+8` ×7 · `+3` ×7 · `-1` ×7 · `-6` ×6 · `+2` ×6 · `-3` ×6 · `+10` ×5
A shift proves the image **changed**, not which side is right. #3357 repaired an
e-rara off-by-one and #3368 a bulk-jp2 leaf offset, so a positive offset is what a
*fix* looks like as much as what damage looks like. Separating repair from damage
needs archive history (`batch_jobs.page_sources`, `archived_photo` provenance), not
the OCR text. Standing measurement: `scripts/audit/revision-image-shift.mjs`.
The summary JSON carries a second, identically-keyed `strata_same_leaf` block
restricted to same-leaf pairs. Anything applying an agreement→accuracy fit to this
corpus should read that one; the tables below are the unrestricted population.
**`strata_same_leaf` is not a cleaner sample of the same population.** Requiring a
printed number on both sides selects pages legible enough to print one twice, and
those pages agree far more than the unmeasurable remainder does — read the row for
`(no printed number)` below against `false` before quoting either. The same-leaf
bands are a ceiling on that subpopulation, not the corpus with noise removed.
### Prior side written by a bulk maintenance sweep (NOT a reading)

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| true | 54,092 | 7.6% | 10.7% | 96.9% | 2.6% |
| false | 72,057 | 57.8% | 53.8% | 39.9% | 5.5% |

### By `source` on the prior side — the stored mechanism label

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| system | 177 | 0.1% | 0.1% | 100.0% | 0.0% |
| realtime_api_sequential | 5 | 0.1% | 21.2% | 80.0% | 0.0% |
| skip | 34 | 0.9% | 0.9% | 100.0% | 0.0% |
| (none) | 1,017 | 6.0% | 5.8% | 99.9% | 0.0% |
| shift-repair-erara-2026-07 | 52,474 | 7.5% | 8.3% | 99.5% | 0.1% |
| unknown | 69 | 8.3% | 10.9% | 100.0% | 0.0% |
| manual | 22 | 32.5% | 41.7% | 72.7% | 13.6% |
| ai | 66,075 | 57.5% | 53.4% | 39.9% | 2.3% |
| batch_api | 4,835 | 100.0% | 69.4% | 26.0% | 50.6% |
| maintenance | 1,441 | 100.0% | 98.6% | 1.0% | 96.0% |

### By whether the passes read the same leaf

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| true | 1,528 | 7.4% | 8.4% | 99.2% | 0.0% |
| (no printed number) | 123,616 | 20.6% | 35.3% | 64.3% | 4.0% |
| false | 1,005 | 98.5% | 80.1% | 13.1% | 51.3% |

## Stratified agreement
### By position in the book

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| unknown | 1,666 | 6.3% | 11.6% | 94.2% | 5.5% |
| 1 front (0-5%) | 3,461 | 8.3% | 22.9% | 79.2% | 3.5% |
| 4 late (75-95%) | 22,459 | 13.0% | 32.1% | 69.9% | 4.5% |
| 5 back (95-100%) | 4,557 | 13.4% | 31.2% | 70.9% | 4.2% |
| 2 early (5-25%) | 24,879 | 16.9% | 36.8% | 60.4% | 4.5% |
| 3 middle (25-75%) | 69,127 | 32.1% | 37.2% | 62.1% | 4.2% |

### Soft-hidden pages (negative page_number)

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| false | 123,639 | 16.6% | 34.8% | 65.3% | 4.3% |
| true | 2,510 | 64.8% | 61.6% | 15.3% | 1.5% |

### By script class (space-less scripts need the char metric)

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| spaced | 126,148 | 19.8% | 35.3% | 64.3% | 4.3% |
| spaceless | 1 | 33.9% | 33.9% | 100.0% | 0.0% |

### Image-only pages (no transcribed body text on either side)

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| false | 126,149 | 19.8% | 35.3% | 64.3% | 4.3% |

### By language

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| Pahlavi | 100 | 4.0% | 4.2% | 100.0% | 0.0% |
| (unknown) | 1,092 | 6.2% | 12.3% | 93.0% | 7.0% |
| Sanskrit | 3,618 | 7.2% | 23.5% | 82.1% | 11.8% |
| Latin | 65,078 | 9.2% | 25.2% | 74.9% | 3.0% |
| German | 9,798 | 9.4% | 33.6% | 61.7% | 2.1% |
| Italian | 1,521 | 15.3% | 39.8% | 57.3% | 10.2% |
| Hebrew | 1,308 | 37.3% | 36.3% | 69.0% | 5.1% |
| Classical Chinese | 164 | 38.6% | 40.1% | 68.3% | 0.0% |
| Japanese | 234 | 40.1% | 38.8% | 85.0% | 0.0% |
| Persian | 734 | 40.3% | 40.1% | 73.4% | 0.0% |
| Hindi | 399 | 40.3% | 43.2% | 68.9% | 1.0% |
| Avestan | 143 | 41.9% | 42.0% | 65.0% | 2.1% |
| Tibetan | 17,484 | 45.0% | 45.2% | 63.9% | 0.1% |
| Armenian | 101 | 49.9% | 52.7% | 50.5% | 17.8% |
| Nahuatl-Spanish | 185 | 50.2% | 48.2% | 49.2% | 0.0% |
| Greek | 3,657 | 51.5% | 45.0% | 48.9% | 5.7% |
| Ge'ez | 1,006 | 52.6% | 49.1% | 44.4% | 0.7% |
| Middle High German | 129 | 52.6% | 52.5% | 37.2% | 0.0% |
| Latin-German | 41 | 53.3% | 53.7% | 43.9% | 14.6% |
| Arabic | 1,697 | 55.0% | 52.5% | 37.0% | 0.9% |
| Korean | 1,644 | 56.0% | 54.9% | 27.0% | 0.1% |
| roa | 89 | 60.6% | 61.2% | 22.5% | 0.0% |
| Latin-English | 44 | 62.4% | 63.6% | 11.4% | 0.0% |
| French | 3,536 | 62.6% | 47.9% | 43.4% | 1.7% |
| Chinese | 850 | 64.5% | 68.6% | 29.3% | 22.2% |
| auto-detect | 546 | 65.3% | 57.9% | 26.7% | 0.0% |
| Swahili | 199 | 73.9% | 66.0% | 14.6% | 1.5% |
| English | 7,721 | 78.0% | 62.8% | 29.3% | 15.9% |
| Dutch | 1,615 | 79.0% | 75.8% | 10.3% | 23.0% |
| Russian | 436 | 79.1% | 62.8% | 24.8% | 2.8% |
| Spanish | 211 | 81.3% | 75.7% | 8.5% | 5.7% |
| e | 122 | 83.2% | 78.9% | 9.0% | 21.3% |
| Danish | 185 | 85.2% | 84.2% | 0.5% | 1.6% |
| Thai | 101 | 98.4% | 96.6% | 0.0% | 74.3% |
| Filipino | 88 | 99.0% | 95.0% | 3.4% | 83.0% |
| Turkish | 168 | 99.7% | 98.1% | 0.0% | 88.7% |

### By year bucket

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| unknown | 1,092 | 6.2% | 12.3% | 93.0% | 7.0% |
| 1500-1599 | 29,239 | 8.8% | 24.4% | 76.2% | 3.4% |
| 1600-1699 | 33,453 | 9.2% | 24.9% | 75.9% | 2.1% |
| 1900+ | 8,061 | 32.8% | 37.9% | 62.7% | 7.8% |
| 1700-1799 | 34,346 | 43.5% | 42.6% | 60.0% | 2.5% |
| pre-1500 | 10,256 | 61.1% | 55.8% | 34.2% | 10.8% |
| 1800-1899 | 9,702 | 64.5% | 56.4% | 34.5% | 10.7% |

### By model pair (prior → current)

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| gemini-3.1-flash-lite-preview→? | 91 | 0.1% | 0.2% | 100.0% | 0.0% |
| gemini-3-flash-preview→? | 296 | 0.1% | 1.9% | 99.0% | 1.0% |
| gemini-2.5-flash→? | 44 | 0.4% | 2.1% | 100.0% | 0.0% |
| gemini-2.5-flash→gemini-3-flash-preview | 335 | 5.7% | 6.9% | 99.7% | 0.0% |
| ?→gemini-3.1-flash-lite-preview | 1,103 | 5.9% | 5.4% | 99.9% | 0.0% |
| gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 6,464 | 6.5% | 8.1% | 98.3% | 0.1% |
| gemini-3.1-flash-lite→gemini-3-flash-preview | 163 | 9.3% | 23.1% | 74.2% | 0.0% |
| gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 79,730 | 9.8% | 24.2% | 80.9% | 1.1% |
| gemini-3-flash-preview→gemini-3.1-flash-lite-preview | 39 | 19.3% | 22.5% | 89.7% | 0.0% |
| gemini-2.5-flash→gemini-3.1-flash-lite-preview | 401 | 65.3% | 49.5% | 39.6% | 0.0% |
| gemini-3-flash-preview→gemini-3-flash-preview | 27,236 | 66.6% | 64.4% | 21.9% | 9.4% |
| gemini-3.1-flash-lite→gemini-3.1-flash-lite | 8,489 | 69.8% | 63.2% | 21.7% | 6.3% |
| ?→gemini-3-flash-preview | 1,627 | 100.0% | 87.3% | 12.4% | 85.1% |

### By prompt-version transition

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| ?→12 | 146 | 0.1% | 0.1% | 100.0% | 0.0% |
| v10→? | 73 | 0.1% | 0.1% | 100.0% | 0.0% |
| v4.2026-02→? | 33 | 0.1% | 0.5% | 100.0% | 0.0% |
| v3.2026-02→? | 209 | 0.1% | 0.4% | 100.0% | 0.0% |
| ?→? | 131 | 1.1% | 29.5% | 71.8% | 27.5% |
| ?→v10 | 1,095 | 5.9% | 5.5% | 99.9% | 0.0% |
| v10→12 | 5,022 | 6.3% | 6.8% | 99.4% | 0.0% |
| v10→v1 | 1,140 | 6.5% | 9.7% | 95.7% | 0.2% |
| v3.2026-02→v2 | 69 | 7.0% | 8.9% | 97.1% | 0.0% |
| ?→v5.1.2026-03b | 163 | 7.8% | 10.3% | 98.8% | 0.0% |
| v3.2026-02→v5.1.2026-03b | 257 | 10.8% | 11.5% | 99.6% | 0.0% |
| 11→v11-retx | 52 | 11.2% | 14.3% | 98.1% | 0.0% |
| v10→v10 | 47,505 | 13.2% | 31.5% | 70.5% | 0.3% |
| v1→11 | 41 | 18.4% | 23.6% | 87.8% | 0.0% |
| v10→11 | 291 | 20.3% | 24.8% | 88.0% | 0.0% |
| 11→11 | 57,031 | 27.2% | 34.8% | 63.4% | 1.4% |
| v2→11 | 94 | 44.4% | 38.3% | 61.7% | 0.0% |
| v11→v10 | 105 | 59.1% | 57.8% | 5.7% | 0.0% |
| ?→11 | 442 | 59.9% | 46.4% | 44.8% | 0.0% |
| v2→v10 | 678 | 60.5% | 58.9% | 14.8% | 0.0% |
| v1→v1 | 4,610 | 81.0% | 66.7% | 23.4% | 13.7% |
| v5.2026-02→v2 | 4,775 | 83.0% | 75.3% | 18.5% | 49.7% |
| ?→v2 | 1,679 | 100.0% | 81.3% | 20.5% | 74.6% |
| ?→v1 | 153 | 100.0% | 63.3% | 36.6% | 62.1% |
| v5.2026-02→v5.2026-02 | 87 | 100.0% | 94.9% | 3.5% | 88.5% |

### By language × year bucket

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| Pahlavi | 1800-1899 | 100 | 4.0% | 4.2% | 100.0% | 0.0% |
| ? | unknown | 1,092 | 6.2% | 12.3% | 93.0% | 7.0% |
| German | 1800-1899 | 812 | 6.2% | 14.0% | 87.9% | 0.9% |
| Sanskrit | 1800-1899 | 697 | 6.5% | 17.5% | 87.4% | 12.0% |
| German | 1500-1599 | 456 | 6.7% | 15.1% | 89.7% | 3.1% |
| Sanskrit | 1900+ | 2,511 | 7.0% | 17.6% | 88.9% | 5.5% |
| Latin | 1500-1599 | 25,379 | 8.5% | 21.7% | 79.6% | 2.8% |
| French | 1800-1899 | 700 | 8.5% | 30.7% | 70.4% | 1.7% |
| Latin | 1600-1699 | 27,428 | 8.8% | 21.2% | 81.1% | 1.8% |
| English | 1900+ | 2,661 | 8.8% | 38.2% | 59.3% | 9.8% |
| Greek | 1500-1599 | 564 | 8.9% | 22.7% | 88.1% | 3.9% |
| French | 1600-1699 | 1,372 | 9.3% | 30.3% | 66.8% | 1.0% |
| German | 1600-1699 | 1,337 | 9.3% | 29.5% | 66.7% | 0.7% |
| Latin | 1700-1799 | 5,877 | 9.7% | 24.4% | 76.2% | 0.7% |
| Greek | 1600-1699 | 875 | 9.8% | 19.9% | 85.5% | 0.6% |
| Italian | 1500-1599 | 1,054 | 10.4% | 28.9% | 69.8% | 1.2% |
| German | 1700-1799 | 7,189 | 10.9% | 37.7% | 56.0% | 2.4% |
| Hebrew | 1700-1799 | 579 | 21.1% | 25.8% | 84.8% | 2.3% |
| Japanese | pre-1500 | 103 | 35.4% | 35.4% | 98.1% | 0.0% |
| Classical Chinese | pre-1500 | 164 | 38.6% | 40.1% | 68.3% | 0.0% |
| Persian | 1900+ | 399 | 40.2% | 40.0% | 77.2% | 0.0% |
| Hindi | 1900+ | 399 | 40.3% | 43.2% | 68.9% | 1.0% |
| Persian | 1800-1899 | 335 | 40.6% | 40.3% | 69.0% | 0.0% |
| Avestan | 1800-1899 | 143 | 41.9% | 42.0% | 65.0% | 2.1% |
| Japanese | 1900+ | 114 | 42.6% | 40.7% | 78.1% | 0.0% |
| Greek | pre-1500 | 309 | 44.0% | 49.4% | 57.6% | 26.2% |
| Tibetan | 1700-1799 | 16,724 | 44.5% | 44.8% | 65.3% | 0.1% |
| Hebrew | 1900+ | 551 | 46.1% | 43.4% | 59.2% | 0.5% |
| Hebrew | 1500-1599 | 160 | 46.3% | 43.7% | 53.8% | 23.8% |
| Arabic | 1500-1599 | 197 | 50.0% | 48.7% | 49.8% | 0.0% |
| Nahuatl-Spanish | 1500-1599 | 185 | 50.2% | 48.2% | 49.2% | 0.0% |
| Ge'ez | pre-1500 | 784 | 51.2% | 48.2% | 47.4% | 0.4% |
| Middle High German | pre-1500 | 129 | 52.6% | 52.5% | 37.2% | 0.0% |
| Ge'ez | 1700-1799 | 111 | 53.0% | 47.9% | 45.1% | 0.0% |
| Korean | 1700-1799 | 520 | 53.3% | 51.9% | 33.5% | 0.0% |
| Sanskrit | pre-1500 | 215 | 54.6% | 54.8% | 46.1% | 17.7% |
| Arabic | pre-1500 | 1,376 | 55.0% | 51.8% | 37.4% | 0.8% |
| Tibetan | pre-1500 | 457 | 55.9% | 55.6% | 32.6% | 0.0% |
| Ge'ez | 1500-1599 | 107 | 57.1% | 55.1% | 23.4% | 0.0% |
| Tibetan | 1500-1599 | 267 | 57.4% | 56.8% | 28.8% | 0.8% |
| Korean | 1800-1899 | 1,066 | 57.5% | 56.2% | 24.3% | 0.1% |
| Chinese | 1800-1899 | 606 | 59.9% | 64.8% | 33.0% | 12.9% |
| auto-detect | 1700-1799 | 459 | 63.0% | 55.5% | 28.8% | 0.0% |
| Greek | 1900+ | 701 | 64.5% | 64.2% | 15.4% | 8.7% |
| Latin | pre-1500 | 5,972 | 65.5% | 57.1% | 29.5% | 11.2% |
| Greek | 1800-1899 | 1,208 | 65.8% | 61.3% | 21.4% | 3.2% |
| Arabic | 1800-1899 | 124 | 67.0% | 66.8% | 11.3% | 3.2% |
| French | 1500-1599 | 394 | 69.0% | 66.7% | 5.3% | 0.8% |
| Latin | 1800-1899 | 418 | 69.5% | 61.1% | 20.3% | 4.8% |
| Dutch | 1600-1699 | 631 | 69.7% | 65.8% | 14.3% | 0.5% |
| Italian | pre-1500 | 439 | 73.8% | 62.4% | 30.3% | 26.4% |
| Swahili | 1800-1899 | 199 | 73.9% | 66.0% | 14.6% | 1.5% |
| Russian | 1800-1899 | 294 | 74.0% | 53.9% | 34.4% | 0.0% |
| Dutch | 1500-1599 | 206 | 75.5% | 75.1% | 0.5% | 4.4% |
| Dutch | 1900+ | 246 | 76.3% | 63.1% | 28.1% | 0.0% |
| English | 1600-1699 | 1,419 | 79.3% | 63.4% | 25.9% | 7.0% |
| French | 1700-1799 | 1,036 | 81.2% | 75.8% | 8.5% | 1.5% |
| Spanish | 1800-1899 | 198 | 81.2% | 75.1% | 8.1% | 0.5% |
| Russian | 1900+ | 140 | 82.5% | 82.2% | 3.6% | 8.6% |
| e | 1900+ | 122 | 83.2% | 78.9% | 9.0% | 21.3% |
| English | 1700-1799 | 1,074 | 84.4% | 76.2% | 16.3% | 10.5% |
| Danish | 1800-1899 | 185 | 85.2% | 84.2% | 0.5% | 1.6% |
| English | 1800-1899 | 2,400 | 85.5% | 81.3% | 5.5% | 24.8% |
| Chinese | 1500-1599 | 118 | 93.3% | 82.1% | 11.9% | 39.8% |
| Thai | 1700-1799 | 101 | 98.4% | 96.6% | 0.0% | 74.3% |
| Turkish | 1800-1899 | 168 | 99.7% | 98.1% | 0.0% | 88.7% |
| Dutch | 1700-1799 | 532 | 100.0% | 93.8% | 1.3% | 67.7% |
| English | pre-1500 | 159 | 100.0% | 97.2% | 3.1% | 95.0% |
| Sanskrit | 1500-1599 | 131 | 100.0% | 99.5% | 0.8% | 99.2% |

### By language × model pair

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| Latin | gemini-3-flash-preview→? | 120 | 0.3% | 3.6% | 97.5% | 2.5% |
| Latin | gemini-3.1-flash-lite→gemini-3-flash-preview | 121 | 2.1% | 18.9% | 79.3% | 0.0% |
| Hebrew | gemini-2.5-flash→gemini-3-flash-preview | 226 | 5.5% | 6.2% | 100.0% | 0.0% |
| Latin | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 1,245 | 5.9% | 8.4% | 97.3% | 0.0% |
| German | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 670 | 5.9% | 5.8% | 100.0% | 0.0% |
| ? | ?→gemini-3.1-flash-lite-preview | 999 | 6.0% | 5.8% | 100.0% | 0.0% |
| Sanskrit | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 2,607 | 6.5% | 7.2% | 99.5% | 0.0% |
| English | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 1,128 | 6.5% | 9.7% | 95.6% | 0.2% |
| German | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 4,658 | 7.0% | 7.8% | 99.4% | 0.1% |
| German | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 424 | 7.0% | 16.2% | 87.5% | 0.0% |
| Italian | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 500 | 7.1% | 8.4% | 99.4% | 0.0% |
| French | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 463 | 7.8% | 7.3% | 100.0% | 0.0% |
| Latin | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 50,633 | 8.2% | 16.0% | 87.8% | 0.1% |
| French | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 1,075 | 8.3% | 21.8% | 81.3% | 0.2% |
| Greek | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 1,208 | 8.6% | 14.1% | 95.7% | 0.0% |
| Italian | gemini-3-flash-preview→gemini-3-flash-preview | 286 | 15.3% | 42.9% | 63.3% | 31.8% |
| Greek | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 156 | 18.6% | 23.5% | 93.6% | 0.0% |
| Classical Chinese | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 164 | 38.6% | 40.1% | 68.3% | 0.0% |
| Japanese | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 234 | 40.1% | 38.8% | 85.0% | 0.0% |
| Persian | gemini-3-flash-preview→gemini-3-flash-preview | 399 | 40.2% | 40.0% | 77.2% | 0.0% |
| Hindi | gemini-3-flash-preview→gemini-3-flash-preview | 394 | 40.2% | 42.6% | 69.8% | 0.0% |
| Persian | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 335 | 40.6% | 40.3% | 69.0% | 0.0% |
| Avestan | gemini-3-flash-preview→gemini-3-flash-preview | 143 | 41.9% | 42.0% | 65.0% | 2.1% |
| Hebrew | gemini-3-flash-preview→gemini-3-flash-preview | 980 | 42.9% | 40.0% | 65.6% | 0.1% |
| Tibetan | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 15,410 | 43.5% | 43.6% | 68.6% | 0.1% |
| Sanskrit | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 332 | 49.3% | 47.7% | 52.7% | 1.2% |
| Nahuatl-Spanish | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 185 | 50.2% | 48.2% | 49.2% | 0.0% |
| Arabic | gemini-3-flash-preview→gemini-3-flash-preview | 1,084 | 51.5% | 48.5% | 45.5% | 0.0% |
| Ge'ez | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 889 | 51.8% | 48.5% | 46.8% | 0.3% |
| Middle High German | gemini-3-flash-preview→gemini-3-flash-preview | 129 | 52.6% | 52.5% | 37.2% | 0.0% |
| Korean | gemini-3-flash-preview→gemini-3-flash-preview | 1,644 | 56.0% | 54.9% | 27.0% | 0.1% |
| Ge'ez | gemini-3-flash-preview→gemini-3-flash-preview | 106 | 57.1% | 55.7% | 22.6% | 0.0% |
| Chinese | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 643 | 58.4% | 63.1% | 34.5% | 10.6% |
| Tibetan | gemini-3-flash-preview→gemini-3-flash-preview | 2,033 | 59.6% | 58.1% | 27.0% | 0.4% |
| Latin | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 4,256 | 62.6% | 54.9% | 27.3% | 0.6% |
| Arabic | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 589 | 63.4% | 59.3% | 21.2% | 0.2% |
| Greek | gemini-3-flash-preview→gemini-3-flash-preview | 2,075 | 64.3% | 60.7% | 21.4% | 2.1% |
| auto-detect | gemini-3-flash-preview→gemini-3-flash-preview | 546 | 65.3% | 57.9% | 26.7% | 0.0% |
| Latin | gemini-2.5-flash→gemini-3.1-flash-lite-preview | 401 | 65.3% | 49.5% | 39.6% | 0.0% |
| Latin | gemini-3-flash-preview→gemini-3-flash-preview | 7,500 | 70.2% | 68.2% | 17.1% | 18.1% |
| Italian | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 546 | 73.0% | 66.5% | 13.9% | 0.0% |
| German | gemini-3-flash-preview→gemini-3-flash-preview | 3,919 | 73.7% | 70.9% | 7.4% | 4.2% |
| Swahili | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 198 | 73.9% | 66.4% | 14.1% | 1.5% |
| English | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 1,575 | 75.3% | 55.8% | 40.4% | 25.7% |
| French | gemini-3-flash-preview→gemini-3-flash-preview | 1,821 | 75.4% | 72.8% | 7.4% | 1.1% |
| Dutch | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 246 | 76.3% | 63.1% | 28.1% | 0.0% |
| English | gemini-3-flash-preview→gemini-3-flash-preview | 1,853 | 77.8% | 72.7% | 15.8% | 10.6% |
| Dutch | gemini-3-flash-preview→gemini-3-flash-preview | 1,358 | 79.7% | 78.0% | 7.1% | 26.7% |
| Russian | gemini-3-flash-preview→gemini-3-flash-preview | 204 | 79.8% | 75.5% | 5.4% | 0.0% |
| Spanish | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 198 | 81.2% | 75.1% | 8.1% | 0.5% |
| Russian | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 140 | 82.5% | 82.2% | 3.6% | 8.6% |
| e | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 122 | 83.2% | 78.9% | 9.0% | 21.3% |
| Danish | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 185 | 85.2% | 84.2% | 0.5% | 1.6% |
| English | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 2,936 | 85.8% | 81.2% | 5.3% | 17.4% |
| Chinese | gemini-3-flash-preview→gemini-3-flash-preview | 110 | 91.8% | 75.1% | 22.7% | 28.2% |
| Thai | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 101 | 98.4% | 96.6% | 0.0% | 74.3% |
| Turkish | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 168 | 99.7% | 98.1% | 0.0% | 88.7% |
| Latin | ?→gemini-3-flash-preview | 555 | 100.0% | 91.9% | 7.9% | 90.6% |
| Sanskrit | gemini-3-flash-preview→gemini-3-flash-preview | 386 | 100.0% | 74.3% | 32.1% | 54.1% |
| Sanskrit | ?→gemini-3-flash-preview | 293 | 100.0% | 74.1% | 25.6% | 72.7% |
| Greek | ?→gemini-3-flash-preview | 175 | 100.0% | 98.0% | 2.3% | 93.7% |
| English | ?→gemini-3-flash-preview | 152 | 100.0% | 78.6% | 20.4% | 74.3% |

## Which side is broken? (direction)
A regression queue assumes the prior text was good. Sampling the near-zero-overlap
tail showed that is often false: the stored "OCR" is sometimes the model thinking
out loud (`-> wait, "croire a ma lague:" is on the same line as…`, `I'll provide the
transcription now`). When the prior side is commentary and the current side is clean,
the re-run REPAIRED the page.
A second, larger prior-side failure is DEGENERATION: the model loops. One Tibetan
page carried 8,104 words with 40 unique (`तथा तथा तथा…`); a Kircher page carried
24,692 characters of `&nbsp;` padding around 73 real words. Both scored as huge
text losses when the re-run replaced them with a correct short read — they ranked
1st and 5th in an earlier build of the audit queue. Detected by type/token ratio
below 0.15 on texts over 120 words, and treated as prior-side damage.
- pairs with a degenerate (looping) side: **3,091** (2.45%)
- `both-transcription`: **121,625** (96.4%)
- `both-broken`: **1,805** (1.4%)
- `repair`: **1,472** (1.2%)
- `degraded`: **1,247** (1.0%)
- pairs where two substantial texts share almost no words (agreement < 5%, both sides ≥ 40 body words): **11,095** (8.80%)
  These are not one failure mode. Verified samples include genuinely divergent reads of
  hard scripts (Hebrew cursive), commentary-as-transcription on the prior side, and at
  least one cross-book contamination (an Armenian book's page carrying Middle Dutch
  text). Treat the class as a triage bucket, not a diagnosis.
### Agreement by direction

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| degraded | 1,247 | 12.7% | 24.8% | 82.8% | 0.6% |
| repair | 1,472 | 13.6% | 23.9% | 84.0% | 0.2% |
| both-transcription | 121,625 | 17.6% | 35.2% | 64.3% | 4.3% |
| both-broken | 1,805 | 59.1% | 58.6% | 36.2% | 5.3% |

## Marginalia
Marginal notes are the hardest marks on the page: small, rotated, in the gutter,
often a different hand. Whether a re-run recovers the SAME notes is a sharper
quality signal than bulk agreement, which the easy body block dominates.
- pairs where at least one side marked marginalia: **104,058**
- mean agreement on the marginal text alone: **17.7%** (vs 35.3% on the full page)
- fate across the revision: kept 73,917 · lost 13,850 · gained 16,871 · none 21,511
`lost` = the prior pass marked marginalia and the re-run marked none. Those are
the pages where a re-OCR quietly dropped the annotation layer.
### Full-page agreement by marginalia fate

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| gained | 16,871 | 9.4% | 25.7% | 76.9% | 0.9% |
| lost | 13,850 | 10.4% | 27.6% | 75.0% | 1.0% |
| none | 21,511 | 30.6% | 37.0% | 62.8% | 3.6% |
| kept | 73,917 | 33.9% | 38.4% | 59.9% | 5.9% |

## Envelope-tag covariates
The OCR envelope (`<columns>`, `<page-type>`, `<lang>`) is metadata the model writes
about the scan. A transition that *changes* one of these is a disagreement about what
the page even is — which should predict low text agreement.
### By current `<page-type>`

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| title-page | 37 | 13.2% | 16.3% | 97.3% | 0.0% |
| text | 98 | 14.5% | 33.6% | 62.2% | 11.2% |
| (none) | 125,993 | 19.9% | 35.3% | 64.3% | 4.3% |

### By current `<columns>`

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| 2 | 184 | 10.4% | 32.6% | 64.1% | 5.4% |
| (none) | 125,959 | 19.8% | 35.3% | 64.3% | 4.3% |

### `<columns>` changed across the revision

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| true | 316 | 7.5% | 18.8% | 82.6% | 0.0% |
| false | 125,833 | 20.1% | 35.3% | 64.3% | 4.3% |

### `<page-type>` changed across the revision

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| true | 427 | 6.3% | 12.6% | 89.9% | 0.0% |
| false | 125,722 | 20.3% | 35.4% | 64.3% | 4.3% |

### `<lang>` changed across the revision

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| true | 503 | 5.9% | 7.2% | 98.4% | 0.0% |
| false | 125,646 | 20.5% | 35.4% | 64.2% | 4.3% |

### Current side is the live `pages.ocr` (vs an intermediate revision)

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| true | 124,915 | 18.1% | 35.0% | 64.8% | 4.3% |
| false | 1,234 | 71.0% | 67.0% | 13.9% | 6.9% |

## Regression candidates
Top 200 by severity → `revision-agreement-regressions-translation-2026-08-02.md` (reviewable list with page URLs).
Rows: `revision-agreement-corpus-translation-2026-08-02.jsonl` · summary: `revision-agreement-corpus-translation-2026-08-02.json`