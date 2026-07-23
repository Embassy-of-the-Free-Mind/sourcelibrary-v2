# Calibration scorecard — how accurate is the text we serve? (2026-07-23)

Agreement→accuracy calibration fitted on the pinned anchor pages (non-canonical
rows only), applied to the same-page double-OCR corpus
(`revision-agreement-corpus-2026-07-20.jsonl`). Estimates are calibrated inferences, not
measurements — see caveats at the end. Free to rebuild:
`node scripts/eval/calibration-scorecard.mjs`.

## 1. The calibration (anchors: 44 pages, 2023 cross-model pairs)

| stratum | n pairs | r (agreement, accuracy) | r windowed |
|---|---:|---:|---:|
| noncanon · spaced | 1421 | 0.688 | 0.749 |
| noncanon · spaceless | 0 | — | — |
| noncanon · all | 1421 | 0.688 | 0.749 |
| canon · spaced | 301 | 0.618 | 0.646 |
| canon · spaceless | 301 | 0.415 | 0.582 |
| canon · all | 602 | 0.516 | 0.569 |

The canon/noncanon r split is the consensus-failure result: on canonical text,
models reciting the same memorized passage agree while both misreport the page,
so agreement stops predicting accuracy. Only non-canonical pairs calibrate.

Fit (isotonic, noncanon only): spaced n=1421 over agreement
[0,1], scripts: armenian, greek, hebrew, latin.
OLS sensitivity: acc ≈ 0.7504 + 0.2763·agr
(windowed: 0.6684 + 0.3624·agr).

**No spaceless fit exists**: the anchor set holds ZERO non-canonical
space-less-script rows — every Chinese anchor is a canonical classic, exactly
the rows the consensus-failure result disqualifies. Until non-canonical CJK
anchors land (ctext plumbing, see paper doc), Chinese/Japanese/Tibetan cells
report agreement only. This gap is a finding, not an omission.

### Binned curve (noncanon, spaced)

| agreement bin | n | mean true accuracy |
|---|---:|---:|
| [0–0.3) | 438 | 77.8% |
| [0.3–0.5) | 190 | 89.8% |
| [0.5–0.7) | 121 | 93.3% |
| [0.7–0.8) | 121 | 96.3% |
| [0.8–0.9) | 114 | 98.1% |
| [0.9–0.95) | 182 | 99.1% |
| [0.95–0.99) | 172 | 99.6% |
| [0.99–1.001) | 83 | 99.9% |

## 2. The scorecard (corpus: 87,235 live eligible pairs)

Scope: pairs whose current side is the live `pages.ocr` — the text readers see.
`est. accuracy` = mean of the calibrated per-pair estimates. † = extrapolated
(no same-script anchors; nearest-family fit). ⚠ = unsupported (no defensible
fit — agreement shown, accuracy estimate suppressed). `(x%)*` = unstable: >25%
of the cell's pairs sit below agreement 0.5, where the anchor curve has only
its soft floor — read those cells as "flagged for audit", not as a rating.
`% flagged` = pairs where a side is degenerate/refusal/commentary (direction ≠
both-transcription). Language is book metadata (edition language) and can be
wrong on individual books.

### By language

| language | n pairs | median agr | est. accuracy | % agr<0.5 | % flagged |
|---|---:|---:|---:|---:|---:|
| occitan † | 137 | 100.0% | 99.9% | 0.0% | 0.0% |
| polish † | 308 | 99.5% | 99.6% | 0.7% | 0.0% |
| zulu † | 54 | 100.0% | 99.3% | 1.8% | 0.0% |
| yoruba † | 133 | 98.8% | 99.3% | 0.8% | 0.8% |
| english † | 14,614 | 100.0% | 99.2% | 1.8% | 1.4% |
| auto-detect † | 1,985 | 98.0% | 99.2% | 0.3% | 0.1% |
| german | 20,667 | 98.9% | 99.1% | 1.2% | 0.4% |
| hausa † | 129 | 99.2% | 99.1% | 4.7% | 0.0% |
| lb † | 491 | 93.2% | 98.7% | 0.4% | 0.0% |
| multiple † | 143 | 94.0% | 98.7% | 0.7% | 0.0% |
| armenian | 236 | 99.8% | 98.6% | 3.0% | 0.0% |
| french † | 4,277 | 97.5% | 98.5% | 2.3% | 1.1% |
| dutch † | 1,184 | 92.5% | 98.3% | 3.3% | 0.7% |
| russian † | 219 | 94.2% | 98.2% | 2.7% | 0.0% |
| middle english † | 442 | 95.5% | 97.5% | 7.5% | 0.0% |
| latin | 29,309 | 91.6% | 96.9% | 10.1% | 0.8% |
| english; chinese † | 57 | 99.1% | 96.7% | 12.3% | 0.0% |
| sanskrit † | 399 | 90.3% | 96.7% | 14.4% | 2.8% |
| persian † | 541 | 79.7% | 96.2% | 8.1% | 1.5% |
| nahuatl † | 124 | 80.0% | 95.6% | 17.7% | 0.0% |
| arabic † | 430 | 72.3% | 95.3% | 15.7% | 2.3% |
| greek | 5,322 | 86.1% | 95.3% | 23.0% | 1.7% |
| italian † | 1,273 | 59.4% | (91.1%)* | 45.0% | 2.4% |
| hebrew | 325 | 49.0% | (89.3%)* | 50.6% | 17.8% |
| unknown † | 1,135 | 0.9% | (70.4%)* | 74.2% | 0.7% |
| chinese ⚠ | 686 | 93.5% | ⚠ no fit | 9.1% | 17.9% |
| ge'ez ⚠ | 65 | 100.0% | ⚠ no fit | 15.6% | 30.8% |
| maya hieroglyphs ⚠ | 119 | 30.3% | ⚠ no fit | 85.6% | 0.8% |
| tibetan ⚠ | 1,343 | 27.5% | ⚠ no fit | 76.5% | 57.3% |
| korean ⚠ | 95 | 72.0% | ⚠ no fit | 28.4% | 7.4% |
| burmese ⚠ | 127 | 99.7% | ⚠ no fit | 0.0% | 0.0% |
| javanese ⚠ | 203 | 37.8% | ⚠ no fit | 54.1% | 58.1% |
| old javanese ⚠ | 64 | 100.0% | ⚠ no fit | 0.0% | 1.6% |
| egyptian hieroglyphs ⚠ | 55 | 100.0% | ⚠ no fit | 2.6% | 29.1% |

### By language × century (cells with ≥50 pairs)

| language | century | n pairs | median agr | est. accuracy | % agr<0.5 | % flagged |
|---|---|---:|---:|---:|---:|---:|
| arabic † | pre-1500 | 275 | 65.3% | 93.7% | 20.4% | 0.4% |
| arabic † | 1800-1899 | 98 | 99.7% | 99.4% | 1.0% | 1.0% |
| armenian | 1800-1899 | 197 | 100.0% | 99.0% | 3.0% | 0.0% |
| auto-detect † | 1500-1599 | 109 | 97.9% | 99.4% | 0.0% | 0.0% |
| auto-detect † | 1600-1699 | 965 | 99.3% | 99.5% | 0.2% | 0.0% |
| auto-detect † | 1700-1799 | 911 | 94.8% | 98.8% | 0.4% | 0.1% |
| burmese ⚠ | 1800-1899 | 106 | 99.7% | ⚠ no fit | 0.0% | 0.0% |
| chinese ⚠ | pre-1500 | 188 | 53.8% | ⚠ no fit | 39.5% | 59.6% |
| chinese ⚠ | 1800-1899 | 86 | 93.5% | ⚠ no fit | 9.6% | 3.5% |
| chinese ⚠ | 1900+ | 387 | 94.0% | ⚠ no fit | 1.8% | 1.3% |
| dutch † | 1500-1599 | 536 | 87.3% | 97.3% | 6.6% | 1.3% |
| dutch † | 1600-1699 | 378 | 99.0% | 99.4% | 0.3% | 0.0% |
| dutch † | 1700-1799 | 215 | 94.3% | 98.6% | 1.4% | 0.5% |
| dutch † | 1800-1899 | 55 | 90.1% | 98.4% | 0.0% | 0.0% |
| english † | pre-1500 | 138 | 83.4% | 96.7% | 11.8% | 1.5% |
| english † | 1500-1599 | 461 | 96.2% | 97.0% | 9.6% | 0.7% |
| english † | 1600-1699 | 2,029 | 97.5% | 98.0% | 4.0% | 1.7% |
| english † | 1700-1799 | 1,063 | 99.0% | 99.1% | 2.1% | 4.2% |
| english † | 1800-1899 | 5,129 | 100.0% | 99.6% | 0.6% | 1.3% |
| english † | 1900+ | 5,250 | 100.0% | 99.5% | 1.2% | 0.8% |
| english † | unknown | 544 | 100.0% | 99.7% | 0.2% | 2.9% |
| english; chinese † | 1800-1899 | 57 | 99.1% | 96.7% | 12.3% | 0.0% |
| french † | 1500-1599 | 932 | 86.0% | 97.2% | 4.3% | 3.3% |
| french † | 1600-1699 | 1,230 | 97.8% | 98.7% | 1.6% | 0.6% |
| french † | 1700-1799 | 1,624 | 98.9% | 99.2% | 0.7% | 0.2% |
| french † | 1800-1899 | 363 | 99.6% | 98.9% | 3.6% | 1.1% |
| french † | 1900+ | 101 | 89.8% | 97.1% | 12.1% | 2.0% |
| german | 1500-1599 | 1,626 | 97.0% | 98.9% | 1.5% | 0.0% |
| german | 1600-1699 | 3,909 | 98.5% | 99.3% | 0.4% | 0.4% |
| german | 1700-1799 | 11,678 | 98.9% | 99.1% | 1.2% | 0.3% |
| german | 1800-1899 | 2,609 | 99.7% | 99.1% | 2.1% | 1.7% |
| german | 1900+ | 819 | 100.0% | 99.8% | 0.2% | 0.1% |
| greek | pre-1500 | 817 | 60.2% | (92.9%)* | 31.9% | 4.2% |
| greek | 1500-1599 | 1,340 | 46.6% | (90.6%)* | 54.6% | 3.7% |
| greek | 1800-1899 | 1,891 | 98.0% | 98.7% | 2.6% | 0.1% |
| greek | 1900+ | 835 | 98.8% | 99.0% | 2.8% | 0.0% |
| greek | unknown | 389 | 51.1% | (90.3%)* | 44.9% | 0.3% |
| hausa † | 1800-1899 | 98 | 98.7% | 98.8% | 6.1% | 0.0% |
| hebrew | 1500-1599 | 139 | 47.3% | (87.2%)* | 53.7% | 13.0% |
| hebrew | 1600-1699 | 123 | 56.6% | (91.5%)* | 39.6% | 13.8% |
| italian † | pre-1500 | 869 | 17.9% | (87.6%)* | 65.6% | 3.2% |
| italian † | 1500-1599 | 180 | 89.3% | 97.8% | 3.4% | 0.6% |
| italian † | 1600-1699 | 196 | 96.7% | 99.0% | 0.5% | 0.0% |
| javanese ⚠ | 1800-1899 | 203 | 37.8% | ⚠ no fit | 54.1% | 58.1% |
| korean ⚠ | 1700-1799 | 67 | 64.5% | ⚠ no fit | 37.1% | 7.5% |
| latin | pre-1500 | 1,849 | 80.3% | (94.7%)* | 26.8% | 3.5% |
| latin | 1500-1599 | 9,260 | 87.5% | 96.2% | 9.4% | 0.4% |
| latin | 1600-1699 | 13,078 | 90.3% | 96.8% | 11.5% | 0.8% |
| latin | 1700-1799 | 3,491 | 98.2% | 99.0% | 1.0% | 0.3% |
| latin | 1800-1899 | 896 | 99.2% | 98.3% | 6.4% | 0.6% |
| latin | 1900+ | 550 | 99.7% | 99.6% | 0.4% | 0.0% |
| latin | unknown | 185 | 100.0% | 99.7% | 0.0% | 0.0% |
| lb † | unknown | 491 | 93.2% | 98.7% | 0.4% | 0.0% |
| maya hieroglyphs ⚠ | pre-1500 | 119 | 30.3% | ⚠ no fit | 85.6% | 0.8% |
| middle english † | pre-1500 | 185 | 68.3% | 94.5% | 17.8% | 0.0% |
| middle english † | 1800-1899 | 257 | 100.0% | 99.7% | 0.0% | 0.0% |
| multiple † | 1700-1799 | 143 | 94.0% | 98.7% | 0.7% | 0.0% |
| nahuatl † | 1500-1599 | 124 | 80.0% | 95.6% | 17.7% | 0.0% |
| occitan † | 1800-1899 | 137 | 100.0% | 99.9% | 0.0% | 0.0% |
| old javanese ⚠ | pre-1500 | 64 | 100.0% | ⚠ no fit | 0.0% | 1.6% |
| persian † | pre-1500 | 484 | 79.3% | 96.3% | 6.0% | 0.6% |
| polish † | 1800-1899 | 308 | 99.5% | 99.6% | 0.7% | 0.0% |
| russian † | 1800-1899 | 219 | 94.2% | 98.2% | 2.7% | 0.0% |
| sanskrit † | 1800-1899 | 120 | 73.4% | (94.1%)* | 36.7% | 0.0% |
| sanskrit † | 1900+ | 200 | 96.5% | 99.0% | 1.0% | 0.0% |
| tibetan ⚠ | pre-1500 | 322 | 51.7% | ⚠ no fit | 48.0% | 22.4% |
| tibetan ⚠ | 1700-1799 | 995 | 10.3% | ⚠ no fit | 99.1% | 68.0% |
| unknown † | 1700-1799 | 66 | 100.0% | 99.8% | 0.0% | 0.0% |
| unknown † | unknown | 1,069 | 0.8% | (68.6%)* | 78.8% | 0.8% |
| yoruba † | 1800-1899 | 133 | 98.8% | 99.3% | 0.8% | 0.8% |

## Caveats (do not quote a cell without them)

1. **Estimates lean high.** The curve is fitted on cross-model pairs; corpus
   pairs are mostly within-Gemini-family, and family self-agreement is
   optimistic (shared failure modes agree). Anchor accuracy is also the
   free-skip UPPER bound (passage-scoped; hallucinated additions outside the
   reference span are uncharged).
2. **The fit is script-class-stratified, not era-stratified** — anchor eras are
   too thin. Century rows share one curve per script class; era enters only
   through the agreement distribution.
3. **† rows borrow the fit** from the nearest anchored script family;
   ⚠ rows have no defensible fit at all. Space-less scripts are ⚠ across the
   board (zero non-canonical spaceless anchors); Tibetan is additionally a
   known OCR failure class (lesson_tibetan_lite_ocr_fails) — there the flag
   IS the scorecard entry.
4. **The curve's low end is soft.** Anchor pairs at agreement <0.3 still
   average ~78% free-skip accuracy (models disagree about NON-reference page
   material while both containing the passage). Corpus pairs at low agreement
   may instead be genuinely broken text — a failure shape the anchors never
   exhibit. Hence the `*` unstable marker.
5. **Agreement is not independence.** Both sides of a corpus pair come from
   the same model lineage on the same image; a systematic misread that both
   passes share is invisible. IA-OCR baseline (planned) adds the independent
   second reading.
6. Cells with <50 pairs are suppressed.
