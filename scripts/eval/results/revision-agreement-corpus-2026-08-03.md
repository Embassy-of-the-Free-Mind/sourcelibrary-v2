# OCR revision agreement — full corpus (2026-08-03)
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
| eligible | max body ≥ 40 words | 108,468 | 58.7% | 86.6% |
| micro_text | 15–40 words (title pages, colophons) | 2,485 | 1.3% | 66.7% |
| image_only | < 15 words on both sides (covers, plates) | 7,891 | 4.3% | 59.8% |
| not_comparable | not two reads of one leaf (#3473) | 65,848 | 35.7% | 8.1% |
### Pairs that are not double reads (#3473)
A stored revision looks like "the same page transcribed twice" from inside the row,
and sometimes is not. The e-rara shift-repair sweep MOVED existing text between pages
rather than transcribing an image, so its revision is the neighbouring leaf verbatim —
same model, same prompt version, and the revision's `original_date` equals the live
text's `updated_at`, because the moved subdocument carried its own timestamp. Nothing
in the metadata distinguishes it; only the source label and the printed page number do.
These score as near-total disagreement and would read as OCR failure.
| reason | pairs |
|---|---:|
| `text-move-source` | 56,703 |
| `different-leaf` | 5,325 |
| `different-script` | 3,809 |
| `human-edit` | 10 |
| `derived-text` | 1 |
Filter: `scripts/lib/revision-pairs.mjs`. Note this script is single-pass and streams by
`page_id`, so it applies the PER-PAIR checks only. The per-BOOK shift verdict — which is
the only thing that reaches a uniform slide through unnumbered leaves — needs every page
of a book in hand and lives in `double-ocr-pages.mjs`. Pairs surviving here with
`leaf: "unverified"` are therefore weaker evidence than the count suggests.
Only **eligible** pairs enter the headline, the strata and the regression queue.
`image_only` pairs disagree by construction: both sides are AI descriptions of the
same picture, so a low score there means two different sentences about one engraving,
not lost text. `micro_text` is real but the metric is unstable on a few dozen words.
Pairs where either side is an untagged AI refusal or preamble: **59** —
kept (a refusal replacing a transcription is a genuine regression), counted here.
**Eligible pairs: 108,468.**
- **median agreement 98.3%** (p25 85.3%, p75 100.0%) — primary metric: char-level on space-less scripts, word-level elsewhere
- mean agreement 86.6% — QUOTE THE MEDIAN, not this. The distribution is heavily left-tailed: a catastrophic minority drags the mean ~11pp below the typical pair.
- mean agreement, pilot-parity word metric on every script: 86.4% — the gap is the CJK/Tibetan tokenization artifact
- agreement distribution: [0–0.5) 5.3% · [0.5–0.7) 3.4% · [0.7–0.85) 5.9% · [0.85–0.95) 8.3% · [0.95–1) 35.9%
- regression candidates (agreement<0.5 AND current <60% of prior length): **872** (0.80% of eligible)
## Stratified agreement
### By position in the book

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| 1 front (0-5%) | 7,941 | 95.3% | 85.4% | 7.8% | 50.6% |
| 5 back (95-100%) | 3,078 | 96.3% | 80.3% | 15.5% | 52.6% |
| 4 late (75-95%) | 14,683 | 97.5% | 84.0% | 11.1% | 57.0% |
| 2 early (5-25%) | 29,620 | 98.2% | 86.7% | 8.9% | 61.3% |
| 3 middle (25-75%) | 46,250 | 98.6% | 87.4% | 8.3% | 62.7% |
| unknown | 6,896 | 99.9% | 90.0% | 7.0% | 75.3% |

### Soft-hidden pages (negative page_number)

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| false | 74,866 | 96.4% | 82.7% | 12.3% | 53.5% |
| true | 33,602 | 99.7% | 95.2% | 1.4% | 78.2% |

### By script class (space-less scripts need the char metric)

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| spaceless | 1,512 | 34.1% | 49.0% | 57.4% | 14.7% |
| spaced | 106,956 | 98.3% | 87.1% | 8.3% | 61.9% |

### Image-only pages (no transcribed body text on either side)

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| false | 108,468 | 98.3% | 86.6% | 8.9% | 61.2% |

### By language

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| Pahlavi | 43 | 0.1% | 0.4% | 100.0% | 0.0% |
| (unknown) | 578 | 1.3% | 36.6% | 63.1% | 33.4% |
| Javanese | 198 | 6.3% | 26.4% | 76.8% | 10.6% |
| Georgian | 37 | 14.8% | 18.2% | 94.6% | 0.0% |
| Tibetan | 1,159 | 20.1% | 24.7% | 86.8% | 1.8% |
| Maya hieroglyphs | 117 | 30.3% | 33.7% | 85.5% | 0.0% |
| Hebrew | 506 | 61.1% | 58.9% | 39.7% | 32.0% |
| Italian | 1,312 | 61.4% | 54.6% | 43.9% | 21.6% |
| Arabic | 430 | 72.0% | 71.1% | 17.4% | 24.2% |
| Korean | 79 | 76.8% | 67.4% | 25.3% | 24.1% |
| Persian | 516 | 79.8% | 76.4% | 7.8% | 9.5% |
| Nahuatl | 123 | 80.5% | 72.5% | 17.9% | 8.1% |
| Sanskrit | 539 | 84.8% | 61.8% | 35.1% | 31.2% |
| Greek | 5,099 | 85.8% | 72.5% | 23.9% | 38.4% |
| Chinese | 558 | 91.8% | 69.7% | 27.1% | 28.8% |
| Latin | 35,032 | 92.8% | 82.1% | 10.8% | 45.0% |
| Lb | 476 | 93.2% | 90.7% | 0.4% | 32.1% |
| Dutch | 1,866 | 93.8% | 88.2% | 4.9% | 46.8% |
| Russian | 217 | 94.2% | 87.8% | 3.2% | 45.2% |
| Middle English | 442 | 95.5% | 85.0% | 7.5% | 50.2% |
| Armenian | 317 | 97.5% | 68.3% | 28.1% | 53.0% |
| Ge'ez | 65 | 98.3% | 60.8% | 40.0% | 52.3% |
| auto-detect | 2,412 | 98.4% | 95.0% | 0.4% | 69.4% |
| Yoruba | 131 | 98.8% | 95.8% | 0.8% | 80.2% |
| French | 5,988 | 99.0% | 91.4% | 3.8% | 68.4% |
| Multiple | 303 | 99.0% | 93.5% | 2.3% | 65.0% |
| English; Chinese | 57 | 99.1% | 84.2% | 12.3% | 68.4% |
| German | 29,738 | 99.5% | 94.9% | 1.6% | 78.0% |
| Polish | 387 | 99.5% | 98.0% | 0.5% | 92.5% |
| Egyptian hieroglyphs | 55 | 99.5% | 72.1% | 27.3% | 58.2% |
| Hausa | 144 | 99.6% | 94.8% | 4.2% | 78.5% |
| Burmese | 137 | 99.7% | 97.5% | 0.0% | 85.4% |
| Hawaiian | 74 | 99.7% | 95.2% | 2.7% | 73.0% |
| Kanuri | 32 | 99.7% | 93.8% | 6.3% | 84.4% |
| K'iche' Maya | 33 | 99.9% | 98.3% | 0.0% | 90.9% |
| English | 18,497 | 100.0% | 94.1% | 3.5% | 82.7% |
| Occitan | 137 | 100.0% | 99.6% | 0.0% | 98.5% |
| Zulu | 91 | 100.0% | 97.8% | 1.1% | 94.5% |
| Unknown | 66 | 100.0% | 99.3% | 0.0% | 95.5% |
| Old Javanese | 64 | 100.0% | 97.8% | 0.0% | 87.5% |
| Swahili | 41 | 100.0% | 99.3% | 0.0% | 97.6% |
| Thai | 33 | 100.0% | 99.7% | 0.0% | 100.0% |

### By year bucket

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| pre-1500 | 6,369 | 70.0% | 61.6% | 31.9% | 11.4% |
| 1500-1599 | 18,565 | 90.5% | 79.0% | 13.8% | 39.5% |
| unknown | 2,231 | 93.7% | 71.4% | 24.4% | 46.0% |
| 1600-1699 | 28,432 | 97.5% | 87.3% | 7.1% | 58.6% |
| 1700-1799 | 26,473 | 99.3% | 92.0% | 4.5% | 72.2% |
| 1800-1899 | 16,371 | 99.8% | 92.2% | 5.8% | 80.3% |
| 1900+ | 10,027 | 100.0% | 94.0% | 4.2% | 83.4% |

### By model pair (prior → current)

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| ?→gemini-3.1-flash-lite-preview | 660 | 1.3% | 32.2% | 67.7% | 29.2% |
| gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 2,230 | 43.5% | 41.5% | 50.5% | 3.6% |
| gemini-3-flash-preview→gemini-3.1-flash-lite | 317 | 52.1% | 53.1% | 46.7% | 9.2% |
| gemini-3-flash-preview→gemini-3.1-flash-lite-preview | 330 | 76.4% | 74.3% | 13.6% | 30.3% |
| gemini-2.5-flash→gemini-3-flash-preview | 556 | 95.3% | 89.6% | 4.3% | 52.2% |
| gemini-2.5-flash→claude-sonnet-4-6 | 47 | 95.9% | 92.5% | 0.0% | 59.6% |
| gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 41,281 | 97.3% | 88.2% | 6.7% | 58.8% |
| gemini-3-flash-preview→gemini-3-flash-preview | 51,190 | 98.8% | 86.4% | 9.3% | 62.0% |
| gemini-3.1-flash-lite→gemini-3.1-flash-lite | 11,213 | 99.8% | 94.6% | 2.9% | 81.7% |
| gemini-3.1-flash-lite→gemini-3-flash-preview | 605 | 100.0% | 90.1% | 10.1% | 79.5% |

### By prompt-version transition

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| ?→v10 | 447 | 0.9% | 0.9% | 100.0% | 0.0% |
| v5.2026-02→v5.2026-02 | 1,698 | 1.5% | 33.6% | 63.9% | 21.9% |
| 12→v14-lacuna | 37 | 8.3% | 14.3% | 94.6% | 0.0% |
| 12→v5.2026-02 | 43 | 22.9% | 27.3% | 86.1% | 2.3% |
| v5.2026-02→12 | 32 | 23.2% | 22.0% | 100.0% | 0.0% |
| 14→14 | 383 | 51.1% | 47.6% | 44.9% | 0.0% |
| ?→v5.2026-02 | 12,678 | 68.8% | 60.8% | 31.3% | 10.7% |
| v5.1.2026-03→v10 | 378 | 81.7% | 77.4% | 10.1% | 32.3% |
| v10→v5.2026-02 | 883 | 82.3% | 78.4% | 4.6% | 3.1% |
| v5.1.2026-03→v5.2026-02 | 174 | 86.7% | 60.0% | 39.1% | 34.5% |
| v3.2026-02→v5.2026-02 | 151 | 87.4% | 72.9% | 25.8% | 23.8% |
| v4.2026-02→spread-v2+ocr-v10 | 538 | 87.8% | 78.6% | 17.8% | 29.0% |
| v5.1.2026-03→spread-v2+ocr-v10 | 1,497 | 87.8% | 83.1% | 4.2% | 29.9% |
| v5.2026-02→spread-v2+ocr-v10 | 486 | 89.5% | 84.7% | 3.5% | 29.0% |
| v10→v10 | 38,333 | 97.4% | 88.2% | 6.9% | 59.2% |
| v5.1.2026-03→12 | 1,052 | 97.9% | 94.6% | 0.7% | 63.3% |
| ?→11 | 213 | 98.7% | 97.9% | 0.0% | 90.6% |
| v6.2026-03→v6.2026-03 | 701 | 98.8% | 95.5% | 0.4% | 75.0% |
| 12→12 | 18,032 | 99.5% | 93.1% | 3.4% | 74.7% |
| spread-v2+ocr-v10→spread-v2+ocr-v10 | 30,354 | 100.0% | 96.6% | 1.0% | 85.1% |
| 15→15 | 222 | 100.0% | 96.8% | 1.4% | 86.5% |
| v5.1.2026-03→v5.1.2026-03 | 95 | 100.0% | 90.6% | 10.5% | 81.0% |

### By language × year bucket

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| ? | unknown | 578 | 1.3% | 36.6% | 63.1% | 33.4% |
| Javanese | 1800-1899 | 198 | 6.3% | 26.4% | 76.8% | 10.6% |
| Chinese | pre-1500 | 183 | 14.1% | 32.1% | 70.5% | 8.7% |
| Tibetan | 1700-1799 | 814 | 16.7% | 15.7% | 99.1% | 0.4% |
| Italian | pre-1500 | 840 | 16.8% | 33.9% | 67.5% | 0.8% |
| Sanskrit | 1800-1899 | 150 | 26.3% | 38.1% | 64.0% | 9.3% |
| Maya hieroglyphs | pre-1500 | 117 | 30.3% | 33.7% | 85.5% | 0.0% |
| Tibetan | pre-1500 | 319 | 43.6% | 47.7% | 54.9% | 5.6% |
| Greek | 1500-1599 | 1,263 | 44.8% | 46.1% | 56.0% | 5.9% |
| Greek | unknown | 383 | 51.1% | 47.6% | 44.9% | 0.0% |
| Greek | pre-1500 | 803 | 59.6% | 57.6% | 34.1% | 2.9% |
| Hebrew | 1500-1599 | 207 | 64.6% | 60.8% | 37.2% | 38.6% |
| Arabic | pre-1500 | 276 | 64.8% | 62.4% | 21.0% | 2.5% |
| Hebrew | 1600-1699 | 247 | 65.3% | 62.9% | 33.6% | 32.4% |
| Middle English | pre-1500 | 185 | 68.3% | 66.4% | 17.8% | 0.0% |
| Persian | pre-1500 | 463 | 79.3% | 76.8% | 5.2% | 4.5% |
| Nahuatl | 1500-1599 | 123 | 80.5% | 72.5% | 17.9% | 8.1% |
| Latin | pre-1500 | 2,773 | 81.3% | 71.6% | 20.7% | 18.3% |
| English | pre-1500 | 138 | 83.4% | 78.5% | 12.3% | 21.7% |
| Dutch | 1500-1599 | 904 | 87.2% | 80.8% | 9.7% | 19.9% |
| Latin | 1500-1599 | 11,653 | 89.1% | 78.3% | 12.9% | 36.6% |
| Italian | 1500-1599 | 153 | 89.3% | 84.0% | 4.6% | 24.2% |
| Latin | 1600-1699 | 14,635 | 92.3% | 81.9% | 11.2% | 44.5% |
| Lb | unknown | 476 | 93.2% | 90.7% | 0.4% | 32.1% |
| French | 1900+ | 217 | 94.0% | 83.6% | 11.5% | 49.3% |
| Russian | 1800-1899 | 217 | 94.2% | 87.8% | 3.2% | 45.2% |
| Chinese | 1900+ | 283 | 94.3% | 90.3% | 2.8% | 38.2% |
| Dutch | 1700-1799 | 214 | 94.5% | 90.9% | 1.4% | 47.7% |
| Sanskrit | 1900+ | 302 | 94.8% | 74.0% | 21.9% | 49.7% |
| French | 1500-1599 | 996 | 95.0% | 87.1% | 4.4% | 50.2% |
| auto-detect | 1700-1799 | 1,082 | 96.3% | 92.4% | 0.7% | 55.5% |
| English | 1500-1599 | 509 | 97.2% | 87.6% | 7.3% | 62.7% |
| Greek | 1800-1899 | 1,837 | 98.2% | 92.8% | 2.5% | 65.2% |
| German | 1500-1599 | 2,577 | 98.4% | 94.5% | 0.9% | 69.5% |
| English | 1600-1699 | 2,783 | 98.5% | 86.3% | 7.5% | 60.6% |
| Italian | 1600-1699 | 291 | 98.5% | 95.0% | 0.3% | 73.2% |
| Greek | 1900+ | 782 | 98.8% | 94.8% | 2.4% | 83.9% |
| Yoruba | 1800-1899 | 131 | 98.8% | 95.8% | 0.8% | 80.2% |
| Latin | 1700-1799 | 4,270 | 99.0% | 94.4% | 0.8% | 70.7% |
| Multiple | 1700-1799 | 303 | 99.0% | 93.5% | 2.3% | 65.0% |
| French | 1600-1699 | 1,646 | 99.1% | 93.1% | 1.4% | 68.5% |
| German | 1600-1699 | 6,784 | 99.2% | 96.2% | 0.4% | 80.3% |
| auto-detect | 1600-1699 | 1,245 | 99.3% | 97.2% | 0.2% | 81.5% |
| Dutch | 1600-1699 | 671 | 99.4% | 96.7% | 0.1% | 83.0% |
| German | 1700-1799 | 15,472 | 99.5% | 95.1% | 1.2% | 77.1% |
| English | 1700-1799 | 1,728 | 99.5% | 92.1% | 4.8% | 76.4% |
| Polish | 1800-1899 | 387 | 99.5% | 98.0% | 0.5% | 92.5% |
| Armenian | 1800-1899 | 278 | 99.5% | 67.1% | 31.6% | 59.4% |
| French | 1700-1799 | 2,397 | 99.6% | 95.7% | 0.8% | 78.0% |
| Latin | 1800-1899 | 984 | 99.6% | 94.0% | 4.5% | 85.1% |
| French | 1800-1899 | 705 | 99.6% | 81.8% | 16.4% | 68.1% |
| German | 1800-1899 | 3,716 | 99.7% | 91.1% | 6.3% | 79.0% |
| Latin | 1900+ | 532 | 99.7% | 98.2% | 0.2% | 88.3% |
| Burmese | 1800-1899 | 117 | 99.7% | 97.3% | 0.0% | 85.5% |
| English | 1800-1899 | 6,399 | 100.0% | 98.1% | 0.7% | 92.5% |
| English | 1900+ | 6,398 | 100.0% | 94.5% | 4.2% | 86.4% |
| German | 1900+ | 1,169 | 100.0% | 98.2% | 0.3% | 92.7% |
| English | unknown | 542 | 100.0% | 98.5% | 0.2% | 91.1% |
| Middle English | 1800-1899 | 257 | 100.0% | 98.3% | 0.0% | 86.4% |
| Latin | unknown | 185 | 100.0% | 98.5% | 0.0% | 94.0% |
| Occitan | 1800-1899 | 137 | 100.0% | 99.6% | 0.0% | 98.5% |

### By language × model pair

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| Sanskrit | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 103 | 0.1% | 0.5% | 100.0% | 0.0% |
| English | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 301 | 0.7% | 1.5% | 99.3% | 0.3% |
| German | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 229 | 0.9% | 29.9% | 66.8% | 9.6% |
| ? | ?→gemini-3.1-flash-lite-preview | 578 | 1.3% | 36.6% | 63.1% | 33.4% |
| French | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 136 | 1.5% | 21.4% | 74.3% | 0.7% |
| Javanese | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 198 | 6.3% | 26.4% | 76.8% | 10.6% |
| Hebrew | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 127 | 16.9% | 28.6% | 78.7% | 2.4% |
| Italian | gemini-3-flash-preview→gemini-3-flash-preview | 855 | 17.1% | 40.1% | 64.7% | 19.7% |
| Tibetan | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 1,159 | 20.1% | 24.7% | 86.8% | 1.8% |
| Maya hieroglyphs | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 117 | 30.3% | 33.7% | 85.5% | 0.0% |
| Latin | gemini-3-flash-preview→gemini-3.1-flash-lite | 141 | 44.6% | 45.7% | 63.1% | 0.0% |
| Greek | gemini-3-flash-preview→gemini-3-flash-preview | 1,856 | 51.5% | 51.9% | 47.2% | 3.7% |
| Chinese | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 258 | 51.9% | 50.4% | 49.2% | 20.2% |
| Latin | gemini-3-flash-preview→gemini-3.1-flash-lite-preview | 104 | 68.8% | 67.7% | 7.7% | 1.9% |
| Hebrew | gemini-3-flash-preview→gemini-3-flash-preview | 379 | 71.7% | 69.1% | 26.7% | 41.9% |
| Arabic | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 430 | 72.0% | 71.1% | 17.4% | 24.2% |
| Latin | gemini-3.1-flash-lite-preview→gemini-3-flash-preview | 1,417 | 75.9% | 58.1% | 30.1% | 4.0% |
| Persian | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 500 | 80.2% | 77.8% | 5.2% | 9.8% |
| Nahuatl | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 123 | 80.5% | 72.5% | 17.9% | 8.1% |
| Italian | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 111 | 83.8% | 82.0% | 1.8% | 14.4% |
| Sanskrit | gemini-3-flash-preview→gemini-3-flash-preview | 193 | 85.2% | 65.0% | 35.8% | 24.3% |
| Latin | gemini-3-flash-preview→gemini-3-flash-preview | 16,495 | 87.1% | 76.4% | 16.9% | 41.1% |
| Middle English | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 375 | 89.8% | 82.5% | 8.5% | 41.6% |
| Italian | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 278 | 91.1% | 86.4% | 3.2% | 35.6% |
| Russian | gemini-3-flash-preview→gemini-3-flash-preview | 187 | 92.2% | 86.6% | 3.2% | 38.0% |
| Lb | gemini-3-flash-preview→gemini-3-flash-preview | 476 | 93.2% | 90.7% | 0.4% | 32.1% |
| Dutch | gemini-3-flash-preview→gemini-3-flash-preview | 1,371 | 93.8% | 90.4% | 1.4% | 47.0% |
| Chinese | gemini-3-flash-preview→gemini-3-flash-preview | 273 | 94.5% | 91.2% | 1.8% | 39.2% |
| Latin | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 15,829 | 95.7% | 90.6% | 2.0% | 52.8% |
| English | gemini-2.5-flash→gemini-3-flash-preview | 515 | 95.8% | 91.0% | 4.3% | 56.1% |
| Dutch | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 420 | 95.9% | 92.3% | 0.7% | 54.5% |
| Greek | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 2,264 | 96.2% | 81.3% | 13.8% | 51.2% |
| Sanskrit | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 194 | 96.5% | 89.0% | 7.2% | 62.4% |
| Latin | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 1,024 | 97.0% | 81.9% | 15.6% | 55.8% |
| auto-detect | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 2,412 | 98.4% | 95.0% | 0.4% | 69.4% |
| French | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 1,809 | 98.5% | 92.5% | 2.5% | 68.5% |
| German | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 11,189 | 98.7% | 93.7% | 2.0% | 71.8% |
| Greek | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 895 | 98.8% | 92.8% | 2.4% | 78.4% |
| Yoruba | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 131 | 98.8% | 95.8% | 0.8% | 80.2% |
| German | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 620 | 99.3% | 96.0% | 0.7% | 78.4% |
| Multiple | gemini-3-flash-preview→gemini-3-flash-preview | 298 | 99.3% | 93.7% | 2.4% | 66.1% |
| Polish | gemini-3-flash-preview→gemini-3-flash-preview | 387 | 99.5% | 98.0% | 0.5% | 92.5% |
| Hausa | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 144 | 99.6% | 94.8% | 4.2% | 78.5% |
| French | gemini-3-flash-preview→gemini-3-flash-preview | 3,907 | 99.7% | 93.5% | 1.9% | 71.6% |
| Burmese | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 137 | 99.7% | 97.5% | 0.0% | 85.4% |
| German | gemini-3-flash-preview→gemini-3-flash-preview | 17,645 | 99.8% | 96.6% | 0.4% | 82.9% |
| Armenian | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 234 | 99.8% | 91.6% | 3.0% | 71.4% |
| English | gemini-3.1-flash-lite→gemini-3.1-flash-lite | 7,889 | 100.0% | 97.6% | 0.9% | 89.7% |
| English | gemini-3-flash-preview→gemini-3-flash-preview | 6,816 | 100.0% | 94.3% | 2.4% | 81.0% |
| English | gemini-3.1-flash-lite-preview→gemini-3.1-flash-lite-preview | 2,328 | 100.0% | 94.1% | 3.5% | 80.2% |
| English | gemini-3.1-flash-lite→gemini-3-flash-preview | 523 | 100.0% | 97.7% | 1.1% | 91.0% |
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
- pairs with a degenerate (looping) side: **1,362** (1.26%)
- `both-transcription`: **106,458** (98.1%)
- `both-broken`: **759** (0.7%)
- `repair`: **643** (0.6%)
- `degraded`: **608** (0.6%)
- pairs where two substantial texts share almost no words (agreement < 5%, both sides ≥ 40 body words): **2,020** (1.86%)
  These are not one failure mode. Verified samples include genuinely divergent reads of
  hard scripts (Hebrew cursive), commentary-as-transcription on the prior side, and at
  least one cross-book contamination (an Armenian book's page carrying Middle Dutch
  text). Treat the class as a triage bucket, not a diagnosis.
### Agreement by direction

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| repair | 643 | 8.6% | 21.0% | 83.4% | 2.6% |
| degraded | 608 | 9.4% | 16.8% | 90.8% | 4.0% |
| both-broken | 759 | 26.3% | 48.1% | 59.6% | 35.0% |
| both-transcription | 106,458 | 98.4% | 87.6% | 7.7% | 62.1% |

## Marginalia
Marginal notes are the hardest marks on the page: small, rotated, in the gutter,
often a different hand. Whether a re-run recovers the SAME notes is a sharper
quality signal than bulk agreement, which the easy body block dominates.
- pairs where at least one side marked marginalia: **25,640**
- mean agreement on the marginal text alone: **55.2%** (vs 86.6% on the full page)
- fate across the revision: kept 19,055 · lost 2,595 · gained 6,660 · none 80,158
`lost` = the prior pass marked marginalia and the re-run marked none. Those are
the pages where a re-OCR quietly dropped the annotation layer.
### Full-page agreement by marginalia fate

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| gained | 6,660 | 64.3% | 56.6% | 38.4% | 16.5% |
| lost | 2,595 | 89.3% | 72.2% | 21.3% | 38.0% |
| kept | 19,055 | 96.9% | 88.4% | 5.5% | 56.5% |
| none | 80,158 | 98.9% | 89.1% | 6.9% | 66.8% |

## Envelope-tag covariates
The OCR envelope (`<columns>`, `<page-type>`, `<lang>`) is metadata the model writes
about the scan. A transition that *changes* one of these is a disagreement about what
the page even is — which should predict low text agreement.
### By current `<page-type>`

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| diagram | 135 | 32.4% | 42.8% | 63.0% | 14.8% |
| illustration | 393 | 62.1% | 54.3% | 43.8% | 14.0% |
| colophon | 36 | 77.8% | 72.8% | 16.7% | 25.0% |
| frontispiece | 154 | 85.0% | 75.7% | 14.9% | 32.5% |
| blank | 1,395 | 86.3% | 68.0% | 26.0% | 38.8% |
| title-page | 497 | 87.2% | 75.9% | 18.1% | 37.8% |
| (none) | 697 | 88.0% | 84.3% | 3.0% | 3.9% |
| toc | 773 | 94.8% | 85.1% | 8.0% | 49.8% |
| dedication | 734 | 96.7% | 90.4% | 1.6% | 54.6% |
| errata | 160 | 97.0% | 86.4% | 9.4% | 58.8% |
| index | 3,374 | 97.8% | 87.3% | 8.4% | 62.6% |
| text | 96,858 | 98.4% | 86.9% | 8.7% | 62.3% |
| preface | 2,982 | 98.4% | 90.7% | 4.0% | 64.5% |
| appendix | 161 | 99.8% | 90.8% | 6.8% | 79.5% |
| bibliography | 36 | 100.0% | 99.3% | 0.0% | 97.2% |

### By current `<columns>`

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| 4 | 30 | 76.1% | 66.6% | 33.3% | 33.3% |
| 3 | 686 | 78.1% | 63.8% | 30.2% | 20.4% |
| 1 | 153 | 89.8% | 76.2% | 19.6% | 30.1% |
| 2 | 17,136 | 94.3% | 80.5% | 14.6% | 48.1% |
| (none) | 90,442 | 98.7% | 87.9% | 7.7% | 64.1% |

### `<columns>` changed across the revision

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| true | 7,223 | 72.9% | 60.3% | 33.5% | 14.6% |
| false | 101,245 | 98.7% | 88.4% | 7.2% | 64.5% |

### `<page-type>` changed across the revision

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| true | 14,728 | 69.3% | 60.2% | 32.1% | 12.7% |
| false | 93,740 | 99.1% | 90.7% | 5.3% | 68.8% |

### `<lang>` changed across the revision

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| true | 18,680 | 72.0% | 61.7% | 31.0% | 16.6% |
| false | 89,788 | 99.2% | 91.7% | 4.4% | 70.5% |

### Current side is the live `pages.ocr` (vs an intermediate revision)

| stratum | n | median | mean | % <0.5 | % ≥0.95 |
|---|---:|---:|---:|---:|---:|
| true | 86,312 | 96.9% | 84.2% | 10.8% | 55.4% |
| false | 22,156 | 100.0% | 95.8% | 1.7% | 83.9% |

## Regression candidates
Top 200 by severity → `revision-agreement-regressions-2026-08-03.md` (reviewable list with page URLs).
Rows: `revision-agreement-corpus-2026-08-03.jsonl` · summary: `revision-agreement-corpus-2026-08-03.json`