# OCR revision agreement — full corpus (2026-07-19)
Corpus-scale extension of the agreement→accuracy calibration pilot (#3235).
Every consecutive rewrite transition in `page_revisions` (field `ocr`), plus the
final stored revision against the live `pages.ocr`. Metric: wrapper-stripped,
letters-only, word-level normalized Levenshtein similarity (cap 800 words) —
identical to `revision-agreement-pilot.mjs`. No model calls; Mongo reads only.
## Corpus summary
- revisions read: **126,551**
- pages with revisions: **100,992** (5,185 live page docs not found — book purged; their rev→rev pairs are still included)
- computable pairs: **120,650** (1,402 skipped: single-element chain or empty after stripping)
### Pair eligibility
Stated before the analysis, not filtered after it. Body-word count excludes
annotation (`<image-desc>`, inline marks, headings) — it is what was actually
*transcribed*. Every computable pair lands in exactly one class:
| class | criterion | n | share | mean agreement |
|---|---|---:|---:|---:|
| eligible | max body ≥ 40 words | 109,953 | 91.1% | 87.0% |
| micro_text | 15–40 words (title pages, colophons) | 2,606 | 2.2% | 66.5% |
| image_only | < 15 words on both sides (covers, plates) | 8,091 | 6.7% | 59.9% |
Only **eligible** pairs enter the headline, the strata and the regression queue.
`image_only` pairs disagree by construction: both sides are AI descriptions of the
same picture, so a low score there means two different sentences about one engraving,
not lost text. `micro_text` is real but the metric is unstable on a few dozen words.
Pairs where either side is an untagged AI refusal or preamble: **55** —
kept (a refusal replacing a transcription is a genuine regression), counted here.
**Eligible pairs: 109,953.**
- mean agreement (primary — char-level on space-less scripts, word-level elsewhere): **87.0%**
- mean agreement, pilot-parity word metric on every script: 86.7% — the gap is the CJK/Tibetan tokenization artifact
- agreement distribution: [0–0.5) 7.8% · [0.5–0.7) 5.3% · [0.7–0.85) 9.2% · [0.85–0.95) 13.2% · [0.95–1) 55.7%
- regression candidates (agreement<0.5 AND current <60% of prior length): **580** (0.53% of eligible)
## Stratified agreement
### By position in the book

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| 5 back (95-100%) | 2,968 | 83.2% | 12.3% | 54.8% |
| unknown | 7,536 | 84.3% | 12.8% | 69.8% |
| 4 late (75-95%) | 14,403 | 85.6% | 9.5% | 58.5% |
| 1 front (0-5%) | 8,510 | 86.5% | 6.6% | 50.9% |
| 2 early (5-25%) | 30,179 | 87.0% | 8.5% | 60.9% |
| 3 middle (25-75%) | 46,357 | 88.1% | 7.6% | 63.0% |

### Soft-hidden pages (negative page_number)

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| false | 75,159 | 83.4% | 11.8% | 54.1% |
| true | 34,794 | 94.7% | 1.5% | 76.3% |

### By script class (space-less scripts need the char metric)

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| spaceless | 1,730 | 50.4% | 54.8% | 14.9% |
| spaced | 108,223 | 87.5% | 7.8% | 61.9% |

### Image-only pages (no transcribed body text on either side)

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| false | 109,953 | 87.0% | 8.5% | 61.1% |

### By language

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| Georgian | 38 | 17.9% | 94.7% | 0.0% |
| (unknown) | 1,069 | 21.0% | 79.0% | 19.0% |
| Tibetan | 1,346 | 21.7% | 88.6% | 1.6% |
| Javanese | 203 | 25.8% | 77.3% | 10.3% |
| Japanese | 34 | 32.1% | 70.6% | 2.9% |
| Maya hieroglyphs | 119 | 33.6% | 85.7% | 0.0% |
| Armenian | 408 | 53.4% | 43.9% | 41.2% |
| Italian | 1,371 | 55.3% | 43.0% | 21.5% |
| Hebrew | 548 | 57.2% | 41.6% | 29.7% |
| Ge'ez | 65 | 60.8% | 40.0% | 52.3% |
| Korean | 95 | 61.0% | 32.6% | 21.1% |
| Arabic | 437 | 70.8% | 17.8% | 23.8% |
| Egyptian hieroglyphs | 55 | 72.1% | 27.3% | 58.2% |
| Greek | 5,322 | 72.3% | 24.2% | 38.1% |
| Chinese | 686 | 72.3% | 23.6% | 27.8% |
| Nahuatl | 124 | 72.3% | 17.7% | 8.1% |
| Persian | 543 | 75.4% | 9.2% | 9.0% |
| Sanskrit | 400 | 78.6% | 16.3% | 35.8% |
| Latin | 34,735 | 83.8% | 9.2% | 46.5% |
| English; Chinese | 57 | 84.2% | 12.3% | 68.4% |
| Middle English | 442 | 85.0% | 7.5% | 50.2% |
| Dutch | 1,878 | 88.1% | 5.0% | 46.7% |
| Russian | 219 | 88.1% | 2.7% | 45.2% |
| Lb | 491 | 90.8% | 0.4% | 32.2% |
| French | 6,344 | 92.3% | 2.0% | 65.1% |
| Multiple | 311 | 93.5% | 2.3% | 64.6% |
| Kanuri | 32 | 93.8% | 6.3% | 84.4% |
| Hausa | 145 | 94.7% | 4.1% | 77.9% |
| auto-detect | 2,446 | 94.9% | 0.4% | 69.5% |
| Hawaiian | 74 | 95.2% | 2.7% | 73.0% |
| German | 30,169 | 95.3% | 1.1% | 77.7% |
| English | 18,282 | 95.5% | 2.0% | 83.9% |
| Yoruba | 133 | 95.8% | 0.8% | 80.5% |
| Burmese | 139 | 97.4% | 0.0% | 84.2% |
| Old Javanese | 64 | 97.8% | 0.0% | 87.5% |
| Zulu | 91 | 97.8% | 1.1% | 94.5% |
| Polish | 388 | 98.0% | 0.5% | 92.5% |
| K'iche' Maya | 33 | 98.3% | 0.0% | 90.9% |
| Swahili | 41 | 99.3% | 0.0% | 97.6% |
| Unknown | 66 | 99.3% | 0.0% | 95.5% |
| Occitan | 137 | 99.6% | 0.0% | 98.5% |
| Thai | 36 | 99.7% | 0.0% | 100.0% |

### By year bucket

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| pre-1500 | 5,558 | 58.4% | 36.7% | 12.1% |
| unknown | 2,746 | 59.2% | 37.4% | 38.0% |
| 1500-1599 | 18,904 | 81.3% | 10.9% | 40.0% |
| 1600-1699 | 29,151 | 87.8% | 6.5% | 58.0% |
| 1700-1799 | 27,279 | 91.3% | 5.2% | 71.0% |
| 1800-1899 | 16,367 | 93.4% | 4.5% | 80.9% |
| 1900+ | 9,948 | 96.3% | 1.8% | 84.8% |

### By model pair (prior → current)

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| ?→gemini-3.1-flash-lite-preview | 1,240 | 18.2% | 81.9% | 16.4% |
| gemini-3-flash-preview→gemini-3.1-flash-lite | 364 | 52.8% | 46.4% | 8.2% |
| gemini-3-flash-preview→gemini-3.1-flash-lite-preview | 377 | 73.4% | 15.4% | 28.6% |
| gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 1,301 | 85.3% | 1.8% | 20.8% |
| gemini-3-flash-preview→gemini-3-flash-preview | 51,413 | 86.7% | 8.9% | 61.9% |
| gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 42,693 | 87.7% | 7.2% | 58.1% |
| gemini-2.5-flash→gemini-3-flash-preview | 575 | 88.9% | 5.0% | 51.6% |
| gemini-3.1-flash-lite→gemini-3-flash-preview | 588 | 90.6% | 10.0% | 81.0% |
| gemini-2.5-flash→claude-sonnet-4-6 | 47 | 92.5% | 0.0% | 59.6% |
| gemini-3.1-flash-lite→gemini-3.1-flash-lite | 11,308 | 94.5% | 3.0% | 81.4% |

### By prompt-version transition

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| ?→v10 | 1,017 | 0.7% | 100.0% | 0.0% |
| 12→v14-lacuna | 53 | 18.9% | 90.6% | 0.0% |
| 12→v5.2026-02 | 33 | 21.4% | 100.0% | 0.0% |
| v5.2026-02→12 | 33 | 22.4% | 100.0% | 0.0% |
| 14→14 | 389 | 47.7% | 44.7% | 0.0% |
| ?→v5.2026-02 | 12,478 | 62.1% | 29.7% | 11.1% |
| v3.2026-02→v5.2026-02 | 193 | 70.1% | 28.5% | 20.7% |
| v4.2026-02→spread-v2+ocr-v10 | 684 | 73.4% | 28.1% | 23.8% |
| v5.1.2026-03→v10 | 426 | 76.3% | 12.0% | 30.5% |
| v5.1.2026-03→spread-v2+ocr-v10 | 1,660 | 83.5% | 4.3% | 31.3% |
| v5.2026-02→spread-v2+ocr-v10 | 1,572 | 85.3% | 2.0% | 22.7% |
| v10→v10 | 39,693 | 87.7% | 7.3% | 58.4% |
| v5.2026-02→v5.2026-02 | 553 | 89.8% | 0.7% | 57.1% |
| v5.1.2026-03→v5.1.2026-03 | 96 | 90.0% | 11.5% | 80.2% |
| 12→12 | 18,305 | 92.9% | 3.6% | 74.2% |
| v5.1.2026-03→12 | 1,071 | 94.5% | 0.7% | 62.8% |
| v6.2026-03→v6.2026-03 | 718 | 95.5% | 0.4% | 74.8% |
| spread-v2+ocr-v10→spread-v2+ocr-v10 | 30,523 | 96.5% | 1.0% | 84.8% |
| ?→11 | 224 | 97.9% | 0.0% | 90.6% |
| 15→15 | 176 | 99.5% | 0.0% | 98.9% |

### By language × year bucket

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| Tibetan | 1700-1799 | 998 | 13.4% | 99.3% | 0.3% |
| ? | unknown | 1,069 | 21.0% | 79.0% | 19.0% |
| Javanese | 1800-1899 | 203 | 25.8% | 77.3% | 10.3% |
| Chinese | pre-1500 | 188 | 31.9% | 70.7% | 8.5% |
| Maya hieroglyphs | pre-1500 | 119 | 33.6% | 85.7% | 0.0% |
| Italian | pre-1500 | 869 | 34.5% | 66.7% | 0.8% |
| Greek | 1500-1599 | 1,340 | 46.0% | 56.2% | 5.8% |
| Tibetan | pre-1500 | 322 | 47.4% | 55.3% | 5.6% |
| Greek | unknown | 389 | 47.7% | 44.7% | 0.0% |
| Armenian | 1800-1899 | 369 | 50.9% | 48.2% | 44.7% |
| Greek | pre-1500 | 817 | 57.3% | 34.4% | 2.8% |
| Hebrew | 1500-1599 | 223 | 59.5% | 38.6% | 35.9% |
| Hebrew | 1600-1699 | 262 | 61.8% | 34.7% | 30.5% |
| Arabic | pre-1500 | 282 | 62.3% | 21.3% | 2.5% |
| Sanskrit | 1800-1899 | 120 | 64.8% | 36.7% | 12.5% |
| Middle English | pre-1500 | 185 | 66.4% | 17.8% | 0.0% |
| Latin | pre-1500 | 1,864 | 67.5% | 29.1% | 23.9% |
| Nahuatl | 1500-1599 | 124 | 72.3% | 17.7% | 8.1% |
| Persian | pre-1500 | 485 | 75.9% | 6.4% | 4.3% |
| English | pre-1500 | 138 | 78.5% | 12.3% | 21.7% |
| Dutch | 1500-1599 | 910 | 80.7% | 9.9% | 19.8% |
| Latin | 1500-1599 | 11,465 | 82.4% | 8.1% | 38.8% |
| Latin | 1600-1699 | 15,311 | 82.5% | 10.6% | 43.9% |
| French | 1900+ | 229 | 83.5% | 10.9% | 47.2% |
| Italian | 1500-1599 | 180 | 84.8% | 3.9% | 26.7% |
| French | 1500-1599 | 1,335 | 85.7% | 3.4% | 37.6% |
| English | 1500-1599 | 524 | 86.2% | 9.0% | 60.9% |
| Russian | 1800-1899 | 219 | 88.1% | 2.7% | 45.2% |
| English | 1600-1699 | 2,653 | 89.7% | 3.7% | 62.6% |
| Chinese | 1900+ | 387 | 90.6% | 2.3% | 35.1% |
| Lb | unknown | 491 | 90.8% | 0.4% | 32.2% |
| Dutch | 1700-1799 | 215 | 90.9% | 1.4% | 47.4% |
| English | 1700-1799 | 1,761 | 91.5% | 5.3% | 75.3% |
| auto-detect | 1700-1799 | 1,085 | 92.3% | 0.7% | 55.4% |
| Greek | 1800-1899 | 1,891 | 92.5% | 2.6% | 64.4% |
| Latin | 1800-1899 | 1,009 | 92.9% | 5.7% | 83.8% |
| Sanskrit | 1900+ | 200 | 93.2% | 1.0% | 62.0% |
| French | 1600-1699 | 1,644 | 93.2% | 1.2% | 68.8% |
| Multiple | 1700-1799 | 311 | 93.5% | 2.3% | 64.6% |
| Latin | 1700-1799 | 4,351 | 94.2% | 1.0% | 70.2% |
| German | 1500-1599 | 2,595 | 94.5% | 1.0% | 69.2% |
| Greek | 1900+ | 835 | 94.5% | 2.8% | 83.4% |
| German | 1800-1899 | 3,609 | 94.8% | 2.5% | 81.9% |
| Italian | 1600-1699 | 294 | 94.9% | 0.3% | 72.8% |
| German | 1700-1799 | 15,859 | 94.9% | 1.2% | 76.4% |
| French | 1800-1899 | 616 | 95.0% | 2.8% | 79.1% |
| French | 1700-1799 | 2,493 | 95.3% | 0.7% | 75.9% |
| Yoruba | 1800-1899 | 133 | 95.8% | 0.8% | 80.5% |
| auto-detect | 1500-1599 | 109 | 95.8% | 0.0% | 73.4% |
| German | 1600-1699 | 6,910 | 96.1% | 0.4% | 79.3% |
| Dutch | 1600-1699 | 675 | 96.7% | 0.1% | 82.7% |
| auto-detect | 1600-1699 | 1,252 | 97.1% | 0.2% | 81.3% |
| Burmese | 1800-1899 | 118 | 97.2% | 0.0% | 84.8% |
| English | 1900+ | 6,216 | 97.4% | 1.2% | 89.3% |
| Latin | 1900+ | 550 | 97.8% | 0.4% | 86.7% |
| Polish | 1800-1899 | 388 | 98.0% | 0.5% | 92.5% |
| English | 1800-1899 | 6,446 | 98.1% | 0.7% | 92.4% |
| German | 1900+ | 1,170 | 98.2% | 0.3% | 92.7% |
| Middle English | 1800-1899 | 257 | 98.3% | 0.0% | 86.4% |
| English | unknown | 544 | 98.5% | 0.2% | 91.2% |
| Latin | unknown | 185 | 98.5% | 0.0% | 94.0% |
| Occitan | 1800-1899 | 137 | 99.6% | 0.0% | 98.5% |

### By language × model pair

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| Armenian | ?→gemini-3.1-flash-lite-preview | 172 | 1.1% | 100.0% | 0.0% |
| ? | ?→gemini-3.1-flash-lite-preview | 1,068 | 21.0% | 79.0% | 19.0% |
| Tibetan | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 1,346 | 21.7% | 88.6% | 1.6% |
| Javanese | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 203 | 25.8% | 77.3% | 10.3% |
| Hebrew | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 152 | 30.9% | 75.0% | 2.6% |
| Maya hieroglyphs | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 119 | 33.6% | 85.7% | 0.0% |
| Italian | gemini-3-flash-preview→gemini-3-flash-preview | 856 | 40.2% | 64.6% | 19.7% |
| Latin | gemini-3-flash-preview→gemini-3.1-flash-lite | 145 | 46.1% | 62.1% | 0.0% |
| Chinese | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 275 | 50.2% | 48.7% | 19.3% |
| Greek | gemini-3-flash-preview→gemini-3-flash-preview | 1,941 | 51.7% | 47.7% | 3.5% |
| Sanskrit | gemini-3-flash-preview→gemini-3-flash-preview | 133 | 66.4% | 33.1% | 9.8% |
| Latin | gemini-3-flash-preview→gemini-3.1-flash-lite-preview | 108 | 67.2% | 9.3% | 1.8% |
| Hebrew | gemini-3-flash-preview→gemini-3-flash-preview | 394 | 67.6% | 28.4% | 40.4% |
| Arabic | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 437 | 70.8% | 17.8% | 23.8% |
| Nahuatl | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 124 | 72.3% | 17.7% | 8.1% |
| Persian | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 518 | 77.0% | 6.4% | 9.5% |
| Latin | gemini-3-flash-preview→gemini-3-flash-preview | 16,282 | 77.5% | 15.8% | 41.6% |
| Italian | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 123 | 79.8% | 5.7% | 13.0% |
| Greek | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 2,330 | 81.0% | 14.0% | 50.7% |
| Latin | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 1,043 | 81.9% | 15.3% | 55.4% |
| French | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 446 | 82.2% | 0.4% | 3.8% |
| Middle English | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 375 | 82.5% | 8.5% | 41.6% |
| Latin | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 543 | 85.7% | 2.2% | 24.1% |
| Russian | gemini-3-flash-preview→gemini-3-flash-preview | 188 | 86.5% | 3.2% | 37.8% |
| Italian | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 307 | 86.6% | 2.9% | 35.8% |
| Sanskrit | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 214 | 87.9% | 8.4% | 60.8% |
| German | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 310 | 88.8% | 2.9% | 39.0% |
| Dutch | gemini-3-flash-preview→gemini-3-flash-preview | 1,379 | 90.4% | 1.4% | 46.9% |
| Latin | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 16,579 | 90.5% | 2.1% | 52.3% |
| Lb | gemini-3-flash-preview→gemini-3-flash-preview | 491 | 90.8% | 0.4% | 32.2% |
| English | gemini-2.5-flash→gemini-3-flash-preview | 522 | 91.1% | 4.2% | 56.5% |
| Chinese | gemini-3-flash-preview→gemini-3-flash-preview | 376 | 91.3% | 1.6% | 35.9% |
| Armenian | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 235 | 91.4% | 3.0% | 71.1% |
| Dutch | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 422 | 92.2% | 0.7% | 54.5% |
| French | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 1,845 | 92.3% | 2.5% | 67.7% |
| Greek | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 953 | 92.8% | 2.2% | 78.0% |
| French | gemini-3-flash-preview→gemini-3-flash-preview | 3,959 | 93.5% | 1.9% | 71.3% |
| Multiple | gemini-3-flash-preview→gemini-3-flash-preview | 306 | 93.6% | 2.3% | 65.7% |
| German | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 11,346 | 93.6% | 2.0% | 71.6% |
| English | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 2,354 | 93.7% | 3.8% | 79.6% |
| English | gemini-3-flash-preview→gemini-3-flash-preview | 6,851 | 94.1% | 2.5% | 80.7% |
| Hausa | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 145 | 94.7% | 4.1% | 77.9% |
| auto-detect | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 2,446 | 94.9% | 0.4% | 69.5% |
| Yoruba | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 133 | 95.8% | 0.8% | 80.5% |
| German | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 625 | 96.0% | 0.6% | 78.4% |
| German | gemini-3-flash-preview→gemini-3-flash-preview | 17,815 | 96.5% | 0.4% | 82.3% |
| Burmese | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 139 | 97.4% | 0.0% | 84.2% |
| English | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 7,911 | 97.5% | 1.0% | 89.7% |
| Polish | gemini-3-flash-preview→gemini-3-flash-preview | 388 | 98.0% | 0.5% | 92.5% |
| English | gemini-3.1-flash-lite→gemini-3-flash-preview | 518 | 98.6% | 0.2% | 91.9% |
| Occitan | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 137 | 99.6% | 0.0% | 98.5% |

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
- pairs with a degenerate (looping) side: **1,454** (1.32%)
- `both-transcription`: **107,871** (98.1%)
- `both-broken`: **783** (0.7%)
- `repair`: **656** (0.6%)
- `degraded`: **643** (0.6%)
- pairs where two substantial texts share almost no words (agreement < 5%, both sides ≥ 40 body words): **1,895** (1.72%)
  These are not one failure mode. Verified samples include genuinely divergent reads of
  hard scripts (Hebrew cursive), commentary-as-transcription on the prior side, and at
  least one cross-book contamination (an Armenian book's page carrying Middle Dutch
  text). Treat the class as a triage bucket, not a diagnosis.
### Agreement by direction

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| degraded | 643 | 16.5% | 91.1% | 4.0% |
| repair | 656 | 21.4% | 82.9% | 2.6% |
| both-broken | 783 | 47.0% | 60.4% | 34.1% |
| both-transcription | 107,871 | 88.1% | 7.2% | 62.0% |

## Marginalia
Marginal notes are the hardest marks on the page: small, rotated, in the gutter,
often a different hand. Whether a re-run recovers the SAME notes is a sharper
quality signal than bulk agreement, which the easy body block dominates.
- pairs where at least one side marked marginalia: **25,695**
- mean agreement on the marginal text alone: **56.9%** (vs 87.0% on the full page)
- fate across the revision: kept 19,696 · lost 2,477 · gained 6,235 · none 81,545
`lost` = the prior pass marked marginalia and the re-run marked none. Those are
the pages where a re-OCR quietly dropped the annotation layer.
### Full-page agreement by marginalia fate

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| gained | 6,235 | 59.1% | 35.6% | 17.8% |
| lost | 2,477 | 75.8% | 18.0% | 40.8% |
| kept | 19,696 | 88.5% | 5.1% | 55.1% |
| none | 81,545 | 89.1% | 7.0% | 66.5% |

## Envelope-tag covariates
The OCR envelope (`<columns>`, `<page-type>`, `<lang>`) is metadata the model writes
about the scan. A transition that *changes* one of these is a disagreement about what
the page even is — which should predict low text agreement.
### By current `<page-type>`

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| diagram | 128 | 46.1% | 59.4% | 15.6% |
| illustration | 375 | 59.5% | 37.6% | 14.9% |
| blank | 1,324 | 72.3% | 21.3% | 41.0% |
| title-page | 551 | 78.4% | 15.1% | 40.1% |
| colophon | 33 | 79.4% | 9.1% | 27.3% |
| frontispiece | 146 | 79.8% | 10.3% | 34.3% |
| (none) | 690 | 84.5% | 2.8% | 3.6% |
| toc | 774 | 86.7% | 6.1% | 50.0% |
| text | 98,252 | 87.1% | 8.5% | 62.1% |
| index | 3,421 | 88.0% | 7.5% | 62.4% |
| errata | 153 | 89.6% | 5.9% | 60.8% |
| dedication | 791 | 90.7% | 1.1% | 54.1% |
| preface | 3,036 | 92.9% | 1.8% | 66.0% |
| appendix | 158 | 96.0% | 1.3% | 82.9% |
| bibliography | 36 | 99.3% | 0.0% | 97.2% |

### By current `<columns>`

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| 3 | 671 | 67.6% | 25.6% | 20.9% |
| 1 | 154 | 76.8% | 18.8% | 29.9% |
| 2 | 17,314 | 80.5% | 14.5% | 47.8% |
| (none) | 91,765 | 88.3% | 7.2% | 64.0% |

### `<columns>` changed across the revision

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| true | 8,081 | 66.0% | 26.8% | 16.6% |
| false | 101,872 | 88.6% | 7.1% | 64.7% |

### `<page-type>` changed across the revision

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| true | 13,965 | 63.8% | 28.0% | 13.7% |
| false | 95,988 | 90.3% | 5.7% | 68.0% |

### `<lang>` changed across the revision

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| true | 19,680 | 64.4% | 28.0% | 17.5% |
| false | 90,273 | 91.9% | 4.3% | 70.7% |

### Current side is the live `pages.ocr` (vs an intermediate revision)

| stratum | n | mean agreement | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|
| true | 87,235 | 84.8% | 10.2% | 55.6% |
| false | 22,718 | 95.2% | 2.1% | 82.3% |

## Regression candidates
Top 200 by severity → `revision-agreement-regressions-2026-07-19.md` (reviewable list with page URLs).
Rows: `revision-agreement-corpus-2026-07-19.jsonl` · summary: `revision-agreement-corpus-2026-07-19.json`