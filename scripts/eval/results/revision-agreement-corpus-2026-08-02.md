# OCR revision agreement — full corpus (2026-08-02)
Corpus-scale extension of the agreement→accuracy calibration pilot (#3235).
Every consecutive rewrite transition in `page_revisions` (field `ocr`), plus the
final stored revision against the live `pages.ocr`. Metric: wrapper-stripped,
letters-only, word-level normalized Levenshtein similarity (cap 800 words) —
identical to `revision-agreement-pilot.mjs`. No model calls; Mongo reads only.
## Corpus summary
- revisions read: **191,221**
- pages with revisions: **164,664** (5,185 live page docs not found — book purged; their rev→rev pairs are still included)
- computable pairs: **184,692** (2,011 skipped: single-element chain or empty after stripping)
### Pair eligibility
Stated before the analysis, not filtered after it. Body-word count excludes
annotation (`<image-desc>`, inline marks, headings) — it is what was actually
*transcribed*. Every computable pair lands in exactly one class:
| class | criterion | n | share | mean agreement |
|---|---|---:|---:|---:|
| eligible | max body ≥ 40 words | 171,325 | 92.8% | 57.5% |
| micro_text | 15–40 words (title pages, colophons) | 3,232 | 1.7% | 56.3% |
| image_only | < 15 words on both sides (covers, plates) | 10,135 | 5.5% | 52.0% |
Only **eligible** pairs enter the headline, the strata and the regression queue.
`image_only` pairs disagree by construction: both sides are AI descriptions of the
same picture, so a low score there means two different sentences about one engraving,
not lost text. `micro_text` is real but the metric is unstable on a few dozen words.
Pairs where either side is an untagged AI refusal or preamble: **59** —
kept (a refusal replacing a transcription is a genuine regression), counted here.
**Eligible pairs: 171,325.**
- **median agreement 83.2%** (p25 3.1%, p75 99.4%) — primary metric: char-level on space-less scripts, word-level elsewhere
- mean agreement 57.5% — QUOTE THE MEDIAN, not this. The distribution is heavily left-tailed: a catastrophic minority drags the mean ~11pp below the typical pair.
- mean agreement, pilot-parity word metric on every script: 57.3% — the gap is the CJK/Tibetan tokenization artifact
- agreement distribution: [0–0.5) 37.6% · [0.5–0.7) 3.6% · [0.7–0.85) 6.3% · [0.85–0.95) 8.9% · [0.95–1) 36.5%
- regression candidates (agreement<0.5 AND current <60% of prior length): **5,798** (3.38% of eligible)
## Did the two passes read the same leaf? (#3473)
The printed page number is transcribed *from the leaf the model was shown*, so it
identifies which image a pass read independently of how well it read it. Two passes
printing different numbers did not look at the same page — their disagreement is
re-archiving, not reading difficulty. This matters because the corpus is consumed as
a double-OCR dataset: `calibration-scorecard.mjs` fits agreement→accuracy on anchor
pages and applies it here, which assumes both sides read one image.
- same leaf (both numbers present and equal): **68,356** · median agreement 99.5%
- DIFFERENT leaf: **42,445** · median agreement 2.5%
- unmeasurable (no printed number on one side): **60,524** — counted as neither, never folded into "same"
- shifted share of measurable pairs: **38.3%**
- most common offsets (current − prior): `+1` ×36,198 · `-1` ×345 · `+2` ×239 · `+3` ×198 · `+101` ×198 · `-99` ×196 · `-9` ×187 · `+21` ×148
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
| true | 53,281 | 2.5% | 3.2% | 99.8% | 0.0% |
| false | 118,044 | 97.5% | 82.0% | 13.7% | 57.1% |

### By `source` on the prior side — the stored mechanism label

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| system | 1 | 0.1% | 0.0% | 100.0% | 0.0% |
| (none) | 1,241 | 0.9% | 18.3% | 81.9% | 16.4% |
| shift-repair-erara-2026-07 | 53,278 | 2.5% | 3.2% | 99.8% | 0.0% |
| mineru | 1 | 2.9% | 2.9% | 100.0% | 0.0% |
| reocr-download-failure-fix-2026-07 | 2 | 3.6% | 3.9% | 100.0% | 0.0% |
| unknown | 1,876 | 74.2% | 69.6% | 9.9% | 1.0% |
| manual | 7 | 87.5% | 78.4% | 0.0% | 14.3% |
| ai | 7,030 | 88.6% | 79.6% | 11.0% | 30.2% |
| pipeline_preview | 11,250 | 92.0% | 79.1% | 15.2% | 41.1% |
| batch_api | 96,639 | 98.6% | 83.5% | 12.9% | 62.5% |

### By whether the passes read the same leaf

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| true | 42,445 | 2.5% | 4.0% | 98.9% | 0.4% |
| (no printed number) | 60,524 | 70.3% | 54.1% | 42.2% | 26.2% |
| false | 68,356 | 99.5% | 93.7% | 2.7% | 75.2% |

## Stratified agreement
### By position in the book

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| 5 back (95-100%) | 5,406 | 44.1% | 48.0% | 50.8% | 30.3% |
| 4 late (75-95%) | 26,333 | 53.4% | 49.0% | 49.4% | 32.1% |
| 3 middle (25-75%) | 77,760 | 77.3% | 54.4% | 44.1% | 37.7% |
| 1 front (0-5%) | 10,936 | 89.3% | 68.6% | 26.6% | 39.6% |
| 2 early (5-25%) | 42,811 | 89.6% | 62.8% | 34.8% | 43.0% |
| unknown | 8,079 | 99.2% | 78.8% | 18.6% | 65.1% |

### Soft-hidden pages (negative page_number)

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| false | 136,524 | 46.8% | 48.0% | 50.4% | 29.9% |
| true | 34,801 | 99.6% | 94.7% | 1.5% | 76.3% |

### By script class (space-less scripts need the char metric)

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| spaceless | 1,730 | 36.5% | 50.4% | 54.8% | 14.9% |
| spaced | 169,595 | 83.5% | 57.6% | 40.3% | 39.6% |

### Image-only pages (no transcribed body text on either side)

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| false | 171,325 | 83.2% | 57.5% | 40.5% | 39.3% |

### By language

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| Sanskrit | 3,146 | 0.1% | 13.2% | 86.5% | 5.9% |
| Pahlavi | 111 | 0.1% | 0.2% | 100.0% | 0.0% |
| (unknown) | 1,069 | 0.8% | 21.0% | 79.0% | 19.0% |
| Latin | 82,538 | 4.7% | 38.0% | 60.4% | 19.7% |
| Javanese | 203 | 5.9% | 25.8% | 77.3% | 10.3% |
| Georgian | 38 | 14.6% | 17.9% | 94.7% | 0.0% |
| Tibetan | 1,346 | 17.2% | 21.7% | 88.6% | 1.6% |
| Italian | 1,863 | 17.6% | 41.7% | 58.0% | 15.8% |
| Japanese | 34 | 20.8% | 32.1% | 70.6% | 2.9% |
| Maya hieroglyphs | 119 | 30.3% | 33.6% | 85.7% | 0.0% |
| Hebrew | 548 | 60.4% | 57.2% | 41.6% | 29.7% |
| Korean | 95 | 70.8% | 61.0% | 32.6% | 21.1% |
| Greek | 6,333 | 71.7% | 61.0% | 36.3% | 32.0% |
| Arabic | 437 | 72.0% | 70.8% | 17.8% | 23.8% |
| Armenian | 408 | 73.2% | 53.4% | 43.9% | 41.2% |
| Persian | 543 | 79.3% | 75.4% | 9.2% | 9.0% |
| Nahuatl | 124 | 80.0% | 72.3% | 17.7% | 8.1% |
| Russian | 314 | 82.3% | 61.5% | 32.2% | 31.5% |
| Chinese | 686 | 92.2% | 72.3% | 23.6% | 27.8% |
| Lb | 491 | 93.2% | 90.8% | 0.4% | 32.2% |
| Dutch | 1,878 | 93.8% | 88.1% | 5.0% | 46.7% |
| Middle English | 442 | 95.5% | 85.0% | 7.5% | 50.2% |
| French | 7,767 | 96.5% | 76.5% | 19.4% | 53.4% |
| Ge'ez | 65 | 98.3% | 60.8% | 40.0% | 52.3% |
| auto-detect | 2,446 | 98.4% | 94.9% | 0.4% | 69.5% |
| Multiple | 311 | 98.7% | 93.5% | 2.3% | 64.6% |
| German | 35,916 | 98.8% | 80.8% | 16.9% | 65.2% |
| Yoruba | 133 | 98.8% | 95.8% | 0.8% | 80.5% |
| English; Chinese | 57 | 99.1% | 84.2% | 12.3% | 68.4% |
| Polish | 388 | 99.5% | 98.0% | 0.5% | 92.5% |
| Egyptian hieroglyphs | 55 | 99.5% | 72.1% | 27.3% | 58.2% |
| Hausa | 145 | 99.6% | 94.7% | 4.1% | 77.9% |
| Burmese | 139 | 99.7% | 97.4% | 0.0% | 84.2% |
| Hawaiian | 74 | 99.7% | 95.2% | 2.7% | 73.0% |
| Kanuri | 32 | 99.7% | 93.8% | 6.3% | 84.4% |
| Thai | 36 | 99.8% | 99.7% | 0.0% | 100.0% |
| English | 20,226 | 99.9% | 87.0% | 11.0% | 76.1% |
| K'iche' Maya | 33 | 99.9% | 98.3% | 0.0% | 90.9% |
| Occitan | 137 | 100.0% | 99.6% | 0.0% | 98.5% |
| Zulu | 91 | 100.0% | 97.8% | 1.1% | 94.5% |
| Unknown | 66 | 100.0% | 99.3% | 0.0% | 95.5% |
| Old Javanese | 64 | 100.0% | 97.8% | 0.0% | 87.5% |
| Swahili | 41 | 100.0% | 99.3% | 0.0% | 97.6% |

### By year bucket

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| 1500-1599 | 39,998 | 6.7% | 40.3% | 57.5% | 18.9% |
| 1600-1699 | 53,502 | 59.4% | 49.4% | 48.8% | 31.7% |
| pre-1500 | 7,561 | 62.1% | 53.4% | 41.4% | 9.7% |
| unknown | 2,746 | 86.7% | 59.2% | 37.4% | 38.0% |
| 1700-1799 | 35,513 | 97.2% | 71.1% | 27.1% | 54.5% |
| 1900+ | 13,585 | 99.0% | 71.8% | 27.1% | 62.6% |
| 1800-1899 | 18,420 | 99.6% | 83.0% | 15.2% | 71.9% |

### By model pair (prior → current)

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 8,454 | 0.7% | 22.2% | 74.3% | 3.5% |
| ?→gemini-3.1-flash-lite-preview | 1,240 | 0.9% | 18.2% | 81.9% | 16.4% |
| gemini-3.1-flash-lite-preview→gemini-2.5-flash | 47 | 1.8% | 2.4% | 100.0% | 0.0% |
| gemini-2.5-flash→gemini-3.1-flash-lite-preview | 47 | 2.1% | 2.4% | 100.0% | 0.0% |
| gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 95,150 | 5.5% | 41.1% | 58.3% | 26.1% |
| gemini-3-flash-preview→gemini-3.1-flash-lite | 364 | 52.5% | 52.8% | 46.4% | 8.2% |
| gemini-3-flash-preview→gemini-3.1-flash-lite-preview | 381 | 77.0% | 72.7% | 16.3% | 28.3% |
| gemini-2.5-flash→gemini-3-flash-preview | 580 | 95.2% | 88.3% | 5.7% | 51.2% |
| gemini-2.5-flash→claude-sonnet-4-6 | 47 | 95.9% | 92.5% | 0.0% | 59.6% |
| gemini-3-flash-preview→gemini-3-flash-preview | 52,944 | 98.6% | 84.9% | 10.9% | 60.3% |
| gemini-3.1-flash-lite→gemini-3-flash-preview | 681 | 99.5% | 81.8% | 19.2% | 70.6% |
| gemini-3.1-flash-lite→gemini-3.1-flash-lite | 11,331 | 99.8% | 94.5% | 3.0% | 81.4% |

### By prompt-version transition

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| ?→v10 | 1,023 | 0.4% | 0.7% | 100.0% | 0.0% |
| v10→v5.1.2026-03 | 47 | 0.5% | 0.7% | 100.0% | 0.0% |
| v5.2026-02→v5.2026-02 | 13,658 | 1.1% | 5.8% | 95.3% | 2.7% |
| v5.2026-02→v10 | 102 | 1.3% | 2.1% | 100.0% | 0.0% |
| v10→12 | 95 | 2.9% | 4.1% | 99.0% | 0.0% |
| 12→v10 | 78 | 3.0% | 3.4% | 100.0% | 0.0% |
| v5.1.2026-03→v5.1.2026-03 | 1,901 | 3.3% | 8.4% | 94.8% | 4.1% |
| ?→? | 35 | 3.5% | 7.2% | 97.1% | 2.9% |
| 12→v5.2026-02 | 109 | 11.5% | 16.4% | 94.5% | 0.9% |
| 12→v14-lacuna | 53 | 12.8% | 18.9% | 90.6% | 0.0% |
| v10→v10 | 77,096 | 17.8% | 46.7% | 52.2% | 30.0% |
| v5.2026-02→12 | 33 | 23.4% | 22.4% | 100.0% | 0.0% |
| v5.1.2026-03→v5.2026-02 | 332 | 37.0% | 47.6% | 52.4% | 22.6% |
| 14→14 | 389 | 51.1% | 47.7% | 44.7% | 0.0% |
| ?→v5.2026-02 | 12,918 | 69.0% | 60.9% | 31.2% | 10.8% |
| v5.1.2026-03→v10 | 474 | 77.6% | 68.6% | 20.9% | 27.4% |
| v10→v5.2026-02 | 1,015 | 80.3% | 70.0% | 15.2% | 2.7% |
| v4.2026-02→spread-v2+ocr-v10 | 684 | 84.5% | 73.4% | 28.1% | 23.8% |
| v3.2026-02→v5.2026-02 | 194 | 84.8% | 70.1% | 28.3% | 20.6% |
| v5.1.2026-03→spread-v2+ocr-v10 | 1,660 | 88.6% | 83.5% | 4.3% | 31.3% |
| v5.2026-02→spread-v2+ocr-v10 | 1,572 | 89.3% | 85.3% | 2.0% | 22.7% |
| 12→12 | 25,015 | 97.3% | 69.0% | 29.4% | 54.3% |
| v5.1.2026-03→12 | 1,071 | 97.8% | 94.5% | 0.7% | 62.8% |
| ?→11 | 224 | 98.6% | 97.9% | 0.0% | 90.6% |
| v6.2026-03→v6.2026-03 | 718 | 98.8% | 95.5% | 0.4% | 74.8% |
| spread-v2+ocr-v10→spread-v2+ocr-v10 | 30,523 | 100.0% | 96.5% | 1.0% | 84.8% |
| 15→15 | 222 | 100.0% | 96.8% | 1.4% | 86.5% |

### By language × year bucket

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| Sanskrit | 1900+ | 2,277 | 0.1% | 12.1% | 87.4% | 7.3% |
| Sanskrit | 1800-1899 | 761 | 0.1% | 10.6% | 90.0% | 2.0% |
| Pahlavi | 1800-1899 | 111 | 0.1% | 0.2% | 100.0% | 0.0% |
| ? | unknown | 1,069 | 0.8% | 21.0% | 79.0% | 19.0% |
| Greek | 1600-1699 | 711 | 0.9% | 5.6% | 94.9% | 1.3% |
| Latin | 1500-1599 | 31,362 | 3.5% | 32.3% | 65.9% | 14.2% |
| Latin | 1600-1699 | 36,870 | 4.3% | 36.0% | 62.7% | 18.2% |
| Italian | 1500-1599 | 672 | 4.8% | 25.5% | 74.3% | 7.1% |
| Javanese | 1800-1899 | 203 | 5.9% | 25.8% | 77.3% | 10.3% |
| Tibetan | 1700-1799 | 998 | 12.8% | 13.4% | 99.3% | 0.3% |
| Chinese | pre-1500 | 188 | 14.1% | 31.9% | 70.7% | 8.5% |
| Italian | pre-1500 | 869 | 17.3% | 34.5% | 66.7% | 0.8% |
| Latin | 1700-1799 | 8,695 | 27.9% | 48.7% | 50.4% | 35.1% |
| Maya hieroglyphs | pre-1500 | 119 | 30.3% | 33.6% | 85.7% | 0.0% |
| Greek | 1500-1599 | 1,679 | 33.6% | 37.2% | 65.0% | 4.6% |
| Tibetan | pre-1500 | 322 | 43.0% | 47.4% | 55.3% | 5.6% |
| Greek | unknown | 389 | 51.1% | 47.7% | 44.7% | 0.0% |
| Armenian | 1800-1899 | 369 | 55.5% | 50.9% | 48.2% | 44.7% |
| Greek | pre-1500 | 817 | 59.6% | 57.3% | 34.4% | 2.8% |
| Hebrew | 1500-1599 | 223 | 62.1% | 59.5% | 38.6% | 35.9% |
| Hebrew | 1600-1699 | 262 | 63.8% | 61.8% | 34.7% | 30.5% |
| Arabic | pre-1500 | 282 | 64.6% | 62.3% | 21.3% | 2.5% |
| Latin | pre-1500 | 3,867 | 66.3% | 53.0% | 42.2% | 13.1% |
| Middle English | pre-1500 | 185 | 68.3% | 66.4% | 17.8% | 0.0% |
| Persian | pre-1500 | 485 | 79.1% | 75.9% | 6.4% | 4.3% |
| Nahuatl | 1500-1599 | 124 | 80.0% | 72.3% | 17.7% | 8.1% |
| Russian | 1800-1899 | 314 | 82.3% | 61.5% | 32.2% | 31.5% |
| English | pre-1500 | 138 | 83.4% | 78.5% | 12.3% | 21.7% |
| Dutch | 1500-1599 | 910 | 87.2% | 80.7% | 9.9% | 19.8% |
| French | 1800-1899 | 1,109 | 88.8% | 53.2% | 46.0% | 43.9% |
| French | 1600-1699 | 2,574 | 89.0% | 62.7% | 35.2% | 44.6% |
| French | 1500-1599 | 1,335 | 90.0% | 85.7% | 3.4% | 37.6% |
| French | 1900+ | 229 | 91.8% | 83.5% | 10.9% | 47.2% |
| Lb | unknown | 491 | 93.2% | 90.8% | 0.4% | 32.2% |
| Chinese | 1900+ | 387 | 94.0% | 90.6% | 2.3% | 35.1% |
| Dutch | 1700-1799 | 215 | 94.5% | 90.9% | 1.4% | 47.4% |
| auto-detect | 1700-1799 | 1,085 | 96.3% | 92.3% | 0.7% | 55.4% |
| English | 1500-1599 | 524 | 97.0% | 86.2% | 9.0% | 60.9% |
| English | 1600-1699 | 3,037 | 97.5% | 79.9% | 14.4% | 55.8% |
| German | 1500-1599 | 2,961 | 97.5% | 83.3% | 13.1% | 60.7% |
| auto-detect | 1500-1599 | 109 | 97.9% | 95.8% | 0.0% | 73.4% |
| Greek | 1800-1899 | 1,891 | 98.0% | 92.5% | 2.6% | 64.4% |
| Italian | 1600-1699 | 294 | 98.5% | 94.9% | 0.3% | 72.8% |
| German | 1700-1799 | 19,721 | 98.6% | 77.4% | 20.5% | 61.4% |
| Multiple | 1700-1799 | 311 | 98.7% | 93.5% | 2.3% | 64.6% |
| German | 1600-1699 | 7,716 | 98.8% | 86.5% | 10.8% | 71.0% |
| Greek | 1900+ | 835 | 98.8% | 94.5% | 2.8% | 83.4% |
| Yoruba | 1800-1899 | 133 | 98.8% | 95.8% | 0.8% | 80.5% |
| auto-detect | 1600-1699 | 1,252 | 99.3% | 97.1% | 0.2% | 81.3% |
| German | 1800-1899 | 4,322 | 99.4% | 79.3% | 18.6% | 68.4% |
| French | 1700-1799 | 2,493 | 99.4% | 95.3% | 0.7% | 75.9% |
| Dutch | 1600-1699 | 675 | 99.4% | 96.7% | 0.1% | 82.7% |
| English | 1700-1799 | 1,761 | 99.5% | 91.5% | 5.3% | 75.3% |
| Latin | 1800-1899 | 1,009 | 99.5% | 92.9% | 5.7% | 83.8% |
| Polish | 1800-1899 | 388 | 99.5% | 98.0% | 0.5% | 92.5% |
| Latin | 1900+ | 550 | 99.7% | 97.8% | 0.4% | 86.7% |
| Burmese | 1800-1899 | 118 | 99.7% | 97.2% | 0.0% | 84.8% |
| English | 1900+ | 7,776 | 99.9% | 79.0% | 20.4% | 71.6% |
| English | 1800-1899 | 6,446 | 100.0% | 98.1% | 0.7% | 92.4% |
| German | 1900+ | 1,170 | 100.0% | 98.2% | 0.3% | 92.7% |
| English | unknown | 544 | 100.0% | 98.5% | 0.2% | 91.2% |
| Middle English | 1800-1899 | 257 | 100.0% | 98.3% | 0.0% | 86.4% |
| Latin | unknown | 185 | 100.0% | 98.5% | 0.0% | 94.0% |
| Occitan | 1800-1899 | 137 | 100.0% | 99.6% | 0.0% | 98.5% |

### By language × model pair

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| Sanskrit | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 2,539 | 0.1% | 0.3% | 100.0% | 0.0% |
| Pahlavi | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 111 | 0.1% | 0.2% | 100.0% | 0.0% |
| English | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 1,191 | 0.5% | 1.0% | 99.8% | 0.1% |
| ? | ?→gemini-3.1-flash-lite-preview | 1,068 | 0.8% | 21.0% | 79.0% | 19.0% |
| German | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 1,023 | 1.3% | 27.5% | 70.6% | 11.8% |
| Armenian | ?→gemini-3.1-flash-lite-preview | 172 | 1.3% | 1.1% | 100.0% | 0.0% |
| French | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 936 | 2.9% | 39.7% | 52.6% | 1.8% |
| Latin | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 61,319 | 3.1% | 26.7% | 73.4% | 14.1% |
| Italian | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 799 | 5.3% | 35.6% | 62.7% | 13.8% |
| Javanese | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 203 | 5.9% | 25.8% | 77.3% | 10.3% |
| Italian | gemini-3-flash-preview→gemini-3-flash-preview | 856 | 17.1% | 40.2% | 64.6% | 19.7% |
| Tibetan | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 1,346 | 17.2% | 21.7% | 88.6% | 1.6% |
| Hebrew | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 152 | 20.5% | 30.9% | 75.0% | 2.6% |
| Maya hieroglyphs | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 119 | 30.3% | 33.6% | 85.7% | 0.0% |
| Latin | gemini-3-flash-preview→gemini-3.1-flash-lite | 145 | 44.6% | 46.1% | 62.1% | 0.0% |
| Greek | gemini-3-flash-preview→gemini-3-flash-preview | 1,941 | 51.3% | 51.7% | 47.7% | 3.5% |
| Chinese | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 275 | 53.1% | 50.2% | 48.7% | 19.3% |
| Sanskrit | gemini-3-flash-preview→gemini-3-flash-preview | 340 | 63.0% | 53.4% | 47.3% | 16.5% |
| Latin | gemini-3-flash-preview→gemini-3.1-flash-lite-preview | 112 | 67.8% | 64.8% | 12.5% | 1.8% |
| Latin | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 2,559 | 68.3% | 47.2% | 44.4% | 6.2% |
| Hebrew | gemini-3-flash-preview→gemini-3-flash-preview | 394 | 70.0% | 67.6% | 28.4% | 40.4% |
| Greek | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 3,341 | 71.4% | 57.0% | 40.0% | 35.4% |
| Arabic | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 437 | 72.0% | 70.8% | 17.8% | 23.8% |
| Persian | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 518 | 79.8% | 77.0% | 6.4% | 9.5% |
| Nahuatl | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 124 | 80.0% | 72.3% | 17.7% | 8.1% |
| Italian | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 123 | 82.0% | 79.8% | 5.7% | 13.0% |
| Latin | gemini-3-flash-preview→gemini-3-flash-preview | 17,224 | 85.4% | 74.3% | 19.5% | 39.5% |
| Middle English | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 375 | 89.8% | 82.5% | 8.5% | 41.6% |
| Russian | gemini-3-flash-preview→gemini-3-flash-preview | 188 | 90.8% | 86.5% | 3.2% | 37.8% |
| French | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 2,729 | 91.5% | 64.0% | 34.1% | 45.8% |
| Lb | gemini-3-flash-preview→gemini-3-flash-preview | 491 | 93.2% | 90.8% | 0.4% | 32.2% |
| Dutch | gemini-3-flash-preview→gemini-3-flash-preview | 1,379 | 93.7% | 90.4% | 1.4% | 46.9% |
| Chinese | gemini-3-flash-preview→gemini-3-flash-preview | 376 | 94.0% | 91.3% | 1.6% | 35.9% |
| German | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 16,088 | 95.3% | 67.6% | 30.8% | 50.5% |
| English | gemini-2.5-flash→gemini-3-flash-preview | 523 | 95.8% | 91.1% | 4.2% | 56.4% |
| Dutch | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 422 | 95.9% | 92.2% | 0.7% | 54.5% |
| Sanskrit | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 214 | 96.4% | 87.9% | 8.4% | 60.8% |
| Latin | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 1,043 | 97.0% | 81.9% | 15.3% | 55.4% |
| auto-detect | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 2,446 | 98.4% | 94.9% | 0.4% | 69.5% |
| Greek | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 953 | 98.7% | 92.8% | 2.2% | 78.0% |
| Yoruba | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 133 | 98.8% | 95.8% | 0.8% | 80.5% |
| Multiple | gemini-3-flash-preview→gemini-3-flash-preview | 306 | 98.9% | 93.6% | 2.3% | 65.7% |
| English | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 2,942 | 99.1% | 76.1% | 23.1% | 63.7% |
| German | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 625 | 99.3% | 96.0% | 0.6% | 78.4% |
| Polish | gemini-3-flash-preview→gemini-3-flash-preview | 388 | 99.5% | 98.0% | 0.5% | 92.5% |
| French | gemini-3-flash-preview→gemini-3-flash-preview | 3,959 | 99.6% | 93.5% | 1.9% | 71.3% |
| Hausa | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 145 | 99.6% | 94.7% | 4.1% | 77.9% |
| Burmese | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 139 | 99.7% | 97.4% | 0.0% | 84.2% |
| German | gemini-3-flash-preview→gemini-3-flash-preview | 18,102 | 99.8% | 95.0% | 2.0% | 81.0% |
| Armenian | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 235 | 99.8% | 91.4% | 3.0% | 71.1% |
| English | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 7,911 | 100.0% | 97.5% | 1.0% | 89.7% |
| English | gemini-3-flash-preview→gemini-3-flash-preview | 6,946 | 100.0% | 94.1% | 2.6% | 80.4% |
| English | gemini-3.1-flash-lite→gemini-3-flash-preview | 588 | 100.0% | 87.8% | 12.1% | 81.0% |
| Occitan | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 137 | 100.0% | 99.6% | 0.0% | 98.5% |

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
- pairs with a degenerate (looping) side: **1,655** (0.97%)
- `both-transcription`: **168,742** (98.5%)
- `degraded`: **932** (0.5%)
- `repair`: **867** (0.5%)
- `both-broken`: **784** (0.5%)
- pairs where two substantial texts share almost no words (agreement < 5%, both sides ≥ 40 body words): **50,695** (29.59%)
  These are not one failure mode. Verified samples include genuinely divergent reads of
  hard scripts (Hebrew cursive), commentary-as-transcription on the prior side, and at
  least one cross-book contamination (an Armenian book's page carrying Middle Dutch
  text). Treat the class as a triage bucket, not a diagnosis.
### Agreement by direction

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| degraded | 932 | 4.3% | 12.9% | 93.3% | 2.9% |
| repair | 867 | 5.3% | 17.4% | 87.0% | 2.0% |
| both-broken | 784 | 25.4% | 46.9% | 60.5% | 34.1% |
| both-transcription | 168,742 | 84.0% | 58.0% | 39.9% | 39.8% |

## Marginalia
Marginal notes are the hardest marks on the page: small, rotated, in the gutter,
often a different hand. Whether a re-run recovers the SAME notes is a sharper
quality signal than bulk agreement, which the easy body block dominates.
- pairs where at least one side marked marginalia: **53,193**
- mean agreement on the marginal text alone: **29.1%** (vs 57.5% on the full page)
- fate across the revision: kept 34,618 · lost 9,425 · gained 12,707 · none 114,575
`lost` = the prior pass marked marginalia and the re-run marked none. Those are
the pages where a re-OCR quietly dropped the annotation layer.
### Full-page agreement by marginalia fate

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| lost | 9,425 | 2.9% | 22.7% | 77.3% | 10.7% |
| gained | 12,707 | 7.2% | 31.6% | 67.1% | 8.8% |
| kept | 34,618 | 70.7% | 51.5% | 45.8% | 31.4% |
| none | 114,575 | 93.3% | 65.0% | 32.9% | 47.5% |

## Envelope-tag covariates
The OCR envelope (`<columns>`, `<page-type>`, `<lang>`) is metadata the model writes
about the scan. A transition that *changes* one of these is a disagreement about what
the page even is — which should predict low text agreement.
### By current `<page-type>`

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| illustration | 1,078 | 3.5% | 22.6% | 78.3% | 5.2% |
| colophon | 84 | 5.5% | 34.0% | 63.1% | 10.7% |
| diagram | 250 | 9.0% | 25.3% | 79.2% | 8.0% |
| title-page | 979 | 44.9% | 47.7% | 51.3% | 22.8% |
| blank | 1,682 | 77.0% | 57.3% | 38.0% | 32.3% |
| frontispiece | 173 | 80.3% | 68.5% | 23.7% | 28.9% |
| text | 153,666 | 83.0% | 57.4% | 40.7% | 39.8% |
| errata | 253 | 84.0% | 57.5% | 41.1% | 37.5% |
| dedication | 1,209 | 84.8% | 61.1% | 34.4% | 35.4% |
| index | 5,340 | 85.2% | 57.5% | 40.5% | 40.0% |
| toc | 1,187 | 87.2% | 63.1% | 33.5% | 34.5% |
| (none) | 721 | 87.8% | 81.5% | 6.2% | 3.7% |
| preface | 4,310 | 93.5% | 67.8% | 29.0% | 47.1% |
| appendix | 229 | 97.8% | 67.7% | 31.9% | 57.2% |
| bibliography | 37 | 100.0% | 96.6% | 2.7% | 94.6% |

### By current `<columns>`

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| 1 | 335 | 5.7% | 37.3% | 62.1% | 14.0% |
| 3 | 1,236 | 9.6% | 37.6% | 59.6% | 11.3% |
| 4 | 44 | 29.3% | 48.2% | 54.5% | 22.7% |
| 2 | 25,335 | 77.0% | 56.4% | 41.1% | 32.8% |
| (none) | 144,352 | 84.9% | 57.9% | 40.2% | 40.8% |

### `<columns>` changed across the revision

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| true | 16,755 | 6.5% | 33.9% | 63.7% | 8.1% |
| false | 154,570 | 88.0% | 60.1% | 38.0% | 42.7% |

### `<page-type>` changed across the revision

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| true | 20,567 | 49.4% | 44.7% | 50.3% | 9.4% |
| false | 150,758 | 89.0% | 59.2% | 39.1% | 43.4% |

### `<lang>` changed across the revision

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| true | 31,819 | 32.6% | 41.2% | 54.7% | 10.9% |
| false | 139,506 | 91.5% | 61.2% | 37.3% | 45.8% |

### Current side is the live `pages.ocr` (vs an intermediate revision)

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| true | 147,783 | 67.8% | 51.5% | 46.6% | 32.7% |
| false | 23,542 | 100.0% | 94.8% | 2.2% | 80.9% |

## Regression candidates
Top 200 by severity → `revision-agreement-regressions-2026-08-02.md` (reviewable list with page URLs).
Rows: `revision-agreement-corpus-2026-08-02.jsonl` · summary: `revision-agreement-corpus-2026-08-02.json`