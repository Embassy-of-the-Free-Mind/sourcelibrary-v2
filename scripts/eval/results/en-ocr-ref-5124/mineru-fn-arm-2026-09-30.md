# Modern English OCR — MinerU + footnotes vs lite (and flash), paired, on the #5216 reference pages (#5182, #3389)

> **POST-HOC RE-ANALYSIS, not a preregistered result.** The decision rule below was fixed in `PREREGISTRATION-mineru-english-5182.md` before the footnote step existed; the step (PR #5299: MinerU's `page_footnote` blocks from `middle.json` appended below the body) was added AFTER the preregistered arm showed every catastrophic page was a dropped footnote. MinerU was re-run for this arm (the first run's raw output was not kept), so body text can differ slightly from `en-mineru-5182-2026-09` (MinerU is not byte-deterministic — §1). Read the rule output as "what the fixed rule says of the fixed worker", not as a confirmation.

measure: **accuracy** (CER against an independent human reference) · scorer `en-ocr-ref-scorer@1` unchanged · post-processing: the production worker's `sanitize()` (lifted verbatim from `scripts/workers/mineru-ocr-worker.mjs`), then `en-ocr-ref-normalise@3` — the same normaliser as every other engine · preregistered in `scripts/eval/PREREGISTRATION-mineru-english-5182.md` · $0 (no model call; lite and flash rows are the existing store runs, not re-read)

Runs: mineru-fn `en-mineru-fn-5182-2026-09` 122/122 text rows, mineru, version 3.4.0, median 22 s/page CPU · mineru-repeat `en-mineru-repeat-5182-2026-09` 20/20 text rows, mineru, version 3.4.0, median 23 s/page CPU

References dropped after the #5182 by-eye check: 8 (stay dropped)

## 1. Noise floor first — MinerU vs MinerU (A-vs-A, the same 20 seed-5182 pages as the lite floor)

| pages | both read text | byte-identical text | outcome flips | median \|Δ\| CER (pp) | max \|Δ\| (pp) | pairs outside the 0.2 pp tie band |
|---|---|---|---|---|---|---|
| 20 | 20 | 12 | 0 | 0.00 | 0.10 | 0 of 20 |

## 2. Each engine on its own pages (failed reads counted, not dropped)

MinerU's failed read = what the production worker would refuse to write: empty (< 40 letters/digits after `sanitize()`), low-quality (`lowQuality()`), or error. Gemini's = refusal after retry, truncation, loop. The Archive's text (ABBYY) is shown for context.

| cell | books | engine | text reads | failed (kinds) | text with CER > 50% | **catastrophic** | median CER | pooled CER [95% CI] | silent number misreads (verified) / numbers printed |
|---|---|---|---|---|---|---|---|---|---|
| S1 pre-1880 prose | 24 | mineru | 24/24 | 0 | 0 | **0 (0.0%)** | 0.84% | 1.82% [1.01%, 2.73%] | 0 / 7 |
| S1 pre-1880 prose | 24 | lite | 22/24 | 2 (refusal 2) | 0 | **2 (8.3%)** | 0.11% | 0.69% [0.22%, 1.27%] | 0 / 7 |
| S1 pre-1880 prose | 24 | flash | 22/24 | 2 (refusal 2) | 0 | **2 (8.3%)** | 0.07% | 0.53% [0.11%, 1.06%] | 0 / 7 |
| S1 pre-1880 prose | 24 | archive | 24/24 | 0 | 1 | **1 (4.2%)** | 0.97% | 6.18% [1.19%, 15.79%] | 1 / 7 |
| S2 pre-1880 date-dense | 20 | mineru | 20/20 | 0 | 0 | **0 (0.0%)** | 3.62% | 3.90% [1.97%, 6.48%] | 0 / 236 |
| S2 pre-1880 date-dense | 20 | lite | 17/20 | 3 (refusal 3) | 0 | **3 (15.0%)** | 0.45% | 1.31% [0.40%, 2.39%] | 0 / 165 |
| S2 pre-1880 date-dense | 20 | flash | 15/20 | 5 (refusal 5) | 0 | **5 (25.0%)** | 0.11% | 1.12% [0.13%, 2.44%] | 0 / 147 (+1 unchecked) |
| S2 pre-1880 date-dense | 20 | archive | 20/20 | 0 | 0 | **0 (0.0%)** | 2.17% | 4.25% [2.19%, 6.77%] | 1 / 236 |
| S3 1880–1930 prose | 41 | mineru | 41/41 | 0 | 0 | **0 (0.0%)** | 0.16% | 0.54% [0.32%, 0.80%] | 0 / 12 |
| S3 1880–1930 prose | 41 | lite | 36/41 | 5 (refusal 5) | 0 | **5 (12.2%)** | 0.11% | 0.34% [0.19%, 0.51%] | 0 / 12 |
| S3 1880–1930 prose | 41 | flash | 35/41 | 6 (error 1, refusal 5) | 0 | **6 (14.6%)** | 0.15% | 0.33% [0.18%, 0.53%] | 0 / 12 |
| S3 1880–1930 prose | 41 | archive | 41/41 | 0 | 0 | **0 (0.0%)** | 0.38% | 0.62% [0.41%, 0.85%] | 0 / 12 |
| S4 1880–1930 date-dense | 29 | mineru | 29/29 | 0 | 0 | **0 (0.0%)** | 0.48% | 1.66% [0.48%, 3.79%] | 2 / 564 |
| S4 1880–1930 date-dense | 29 | lite | 23/29 | 6 (refusal 6) | 1 | **7 (24.1%)** | 0.51% | 3.66% [0.48%, 10.46%] | 0 / 505 |
| S4 1880–1930 date-dense | 29 | flash | 22/29 | 7 (refusal 7) | 0 | **7 (24.1%)** | 0.57% | 0.73% [0.36%, 1.19%] | 0 / 386 (+1 unchecked) |
| S4 1880–1930 date-dense | 29 | archive | 29/29 | 0 | 0 | **0 (0.0%)** | 0.82% | 2.13% [0.90%, 4.28%] | 9 / 564 |
| printed before 1820 (S1+S2) | 19 | mineru | 19/19 | 0 | 0 | **0 (0.0%)** | 4.48% | 4.06% [3.07%, 4.89%] | 0 / 112 |
| printed before 1820 (S1+S2) | 19 | lite | 18/19 | 1 (refusal 1) | 0 | **1 (5.3%)** | 0.75% | 1.86% [0.84%, 2.90%] | 0 / 102 |
| printed before 1820 (S1+S2) | 19 | flash | 15/19 | 4 (refusal 4) | 0 | **4 (21.1%)** | 0.17% | 1.75% [0.44%, 3.08%] | 0 / 84 |
| printed before 1820 (S1+S2) | 19 | archive | 19/19 | 0 | 0 | **0 (0.0%)** | 4.71% | 5.06% [3.56%, 6.55%] | 1 / 112 |
| 1820–1879 (S1+S2) | 25 | mineru | 25/25 | 0 | 0 | **0 (0.0%)** | 0.19% | 2.08% [0.54%, 4.48%] | 0 / 131 |
| 1820–1879 (S1+S2) | 25 | lite | 21/25 | 4 (refusal 4) | 0 | **4 (16.0%)** | 0.11% | 0.35% [0.12%, 0.70%] | 0 / 70 |
| 1820–1879 (S1+S2) | 25 | flash | 22/25 | 3 (refusal 3) | 0 | **3 (12.0%)** | 0.03% | 0.25% [0.05%, 0.64%] | 0 / 70 (+1 unchecked) |
| 1820–1879 (S1+S2) | 25 | archive | 25/25 | 0 | 1 | **1 (4.0%)** | 0.38% | 5.26% [0.62%, 13.34%] | 1 / 131 |
| pre-1880 (S1+S2) | 44 | mineru | 44/44 | 0 | 0 | **0 (0.0%)** | 1.08% | 2.90% [1.81%, 4.37%] | 0 / 243 |
| pre-1880 (S1+S2) | 44 | lite | 39/44 | 5 (refusal 5) | 0 | **5 (11.4%)** | 0.20% | 1.00% [0.47%, 1.60%] | 0 / 172 |
| pre-1880 (S1+S2) | 44 | flash | 37/44 | 7 (refusal 7) | 0 | **7 (15.9%)** | 0.10% | 0.80% [0.25%, 1.46%] | 0 / 154 (+1 unchecked) |
| pre-1880 (S1+S2) | 44 | archive | 44/44 | 0 | 1 | **1 (2.3%)** | 1.24% | 5.18% [2.20%, 10.00%] | 2 / 243 |
| 1880–1930 (S3+S4) | 70 | mineru | 70/70 | 0 | 0 | **0 (0.0%)** | 0.24% | 1.07% [0.49%, 2.06%] | 2 / 576 |
| 1880–1930 (S3+S4) | 70 | lite | 59/70 | 11 (refusal 11) | 1 | **12 (17.1%)** | 0.22% | 1.83% [0.37%, 4.76%] | 0 / 517 |
| 1880–1930 (S3+S4) | 70 | flash | 57/70 | 13 (error 1, refusal 12) | 0 | **13 (18.6%)** | 0.22% | 0.51% [0.32%, 0.74%] | 0 / 398 (+1 unchecked) |
| 1880–1930 (S3+S4) | 70 | archive | 70/70 | 0 | 0 | **0 (0.0%)** | 0.51% | 1.34% [0.72%, 2.28%] | 9 / 576 |
| ALL | 114 | mineru | 114/114 | 0 | 0 | **0 (0.0%)** | 0.45% | 1.84% [1.18%, 2.68%] | 2 / 819 |
| ALL | 114 | lite | 98/114 | 16 (refusal 16) | 1 | **17 (14.9%)** | 0.20% | 1.46% [0.53%, 3.13%] | 0 / 689 |
| ALL | 114 | flash | 94/114 | 20 (error 1, refusal 19) | 0 | **20 (17.5%)** | 0.14% | 0.63% [0.37%, 0.94%] | 0 / 552 (+2 unchecked) |
| ALL | 114 | archive | 114/114 | 0 | 1 | **1 (0.9%)** | 0.60% | 2.95% [1.55%, 5.10%] | 11 / 819 |

## 3. Paired — MinerU vs lite, same page, both read text

Δ = MinerU CER − lite CER, in percentage points; **positive = lite better**. Tie band ±0.2 pp. MinerU's own floor (§1): median |Δ| 0.00 pp.

| cell | grade (books) | pairs | excluded: MinerU failed / lite failed / both | MinerU better | lite better | tie | sign-test p | median Δ (pp) [95% CI] |
|---|---|---|---|---|---|---|---|---|
| S1 pre-1880 prose | exploratory (24) | 22 | 0 / 2 / 0 | 1 | 12 | 9 | 0.003 | 0.41 [0.05, 1.75] |
| S2 pre-1880 date-dense | exploratory (20) | 17 | 0 / 3 / 0 | 3 | 7 | 7 | 0.344 | 0.17 [0.00, 2.59] |
| S3 1880–1930 prose | directional (41) | 36 | 0 / 5 / 0 | 4 | 9 | 23 | 0.267 | 0.00 [0.00, 0.10] |
| S4 1880–1930 date-dense | exploratory (29) | 23 | 0 / 6 / 0 | 2 | 6 | 15 | 0.289 | 0.07 [0.00, 0.18] |
| printed before 1820 (S1+S2) | exploratory (19) | 18 | 0 / 1 / 0 | 1 | 14 | 3 | 0.001 | 2.05 [0.71, 3.72] |
| 1820–1879 (S1+S2) | exploratory (25) | 21 | 0 / 4 / 0 | 3 | 5 | 13 | 0.727 | 0.06 [0.00, 0.11] |
| pre-1880 (S1+S2) | directional (44) | 39 | 0 / 5 / 0 | 4 | 19 | 16 | 0.003 | 0.19 [0.06, 1.69] |
| 1880–1930 (S3+S4) | decision (70) | 59 | 0 / 11 / 0 | 6 | 15 | 38 | 0.078 | 0.00 [0.00, 0.11] |
| ALL | decision (114) | 98 | 0 / 16 / 0 | 10 | 34 | 54 | 0.000 | 0.08 [0.00, 0.15] |

## 4. The ladder question — MinerU on the pages Gemini refused (the population tier 3 serves)

| population | pages | MinerU text reads | MinerU failed | MinerU median CER | MinerU pooled CER | lite pooled CER on its own text reads (ALL) | ratio | grade |
|---|---|---|---|---|---|---|---|---|
| lite refused | 16 | 16 | 0 | 0.21% | 1.39% | 1.46% | 0.95× | exploratory |
| flash refused | 19 | 19 | 0 | 0.24% | 2.10% | 1.46% | 1.44× | exploratory |
| both refused | 14 | 14 | 0 | 0.21% | 1.47% | 1.46% | 1.01× | exploratory |

## 5. The preregistered rule (ALL cell, decision grade)

| condition | met? |
|---|---|
| PEER (a): paired median Δ within ±0.2 pp | yes (0.08 pp) |
| PEER (b): MinerU catastrophic ≤ 2% | yes (0.0%) |
| FALLBACK (a): MinerU pooled CER on lite-refused pages ≤ 2× lite's pooled CER | yes (0.95×) |
| FALLBACK (b): MinerU reads at least half of them | yes (16 of 16) |

**Rule output: PEER.** Per period (quoted, not the rule): printed before 1820 (S1+S2) median Δ 2.05 pp, MinerU catastrophic 0.0% (exploratory, 19 books); 1820–1879 (S1+S2) median Δ 0.06 pp, MinerU catastrophic 0.0% (exploratory, 25 books); 1880–1930 (S3+S4) median Δ 0.00 pp, MinerU catastrophic 0.0% (decision, 70 books).

## 6. Long s (ſ read as f), per period

Count of MinerU words not in the reference that become a reference word when an f is read as s (fecond → second). A proxy; the by-eye note in §8 says what the image shows.

| period | pages | pages with ≥ 3 ſ→f words | ſ→f words per 1,000 words | examples |
|---|---|---|---|---|
| printed before 1820 (S1+S2) | 19 | 12 | 81.3 | en-6a0b25-pg77434p155: ftand→stand, alfo→also, largeft→largest; en-69af0a-pg77434p252: fome→some, adminiftred→administred, fhall→shall; en-6a0b25-pg77434p282: fo→so, reft→rest, fame→same |
| 1820–1879 (S1+S2) | 25 | 0 | 0.0 | – |
| 1880–1930 (S3+S4) | 70 | 0 | 0.0 | – |

## 7. Number misreads (the #5186 measure)

Silent misreads = a printed number read as another number, verified off the image (digitcheck.jsonl; MinerU-only candidates in mineru-digitcheck.jsonl, where `split` = digits right but spaced apart by the engine). ALL cell: MinerU 2 / 819 (0.24%), lite 0 / 689 (0.00%), Archive 11 / 819 (1.34%). Candidates that could still be silent and are unchecked: 0. Visibly garbled numbers in MinerU's text (o for 0, i for 1 — not silent, not in the rate): 41.

## 8. Pages to read by eye

- best five, MinerU: en-6aa1d4-ws78 (0.00%; lite 0.00%); en-69e41e-ws298 (0.00%; lite 0.00%); en-6ab22e-ws55 (0.00%; lite 0.00%); en-6ab6d1-ws76 (0.00%; lite –); en-69d149-ws303 (0.00%; lite 0.00%)
- worst five, MinerU: en-6aa1d5-ws52 (30.4%; lite 5.2%; len ratio 0.7798); en-699200-ws404 (21.8%; lite 0.1%; len ratio 0.9905); en-6a58a3-pg35687p276 (10.3%; lite –; len ratio 0.964); en-69ee64-ws183 (10.2%; lite 0.0%; len ratio 1.0679); en-6aa734-pg72452p172 (6.5%; lite 0.0%; len ratio 0.9812)
- pages where MinerU emits < 80% of the reference's words and the Archive text ≥ 90%: 1 of 114 — en-6aa1d5-ws52 (78% of words, CER 30.4%)
- MinerU failed reads: none

## 9. Before / after the footnote step (ALL cell, same pages)

| | catastrophic | text with CER > 50% | median CER | pooled CER | paired vs lite: MinerU better / lite better | paired median Δ (pp) |
|---|---|---|---|---|---|---|
| preregistered arm (no footnotes) | 2.6% | 3 | 0.66% | 6.17% | 10 / 49 | 0.19 |
| this arm (footnotes appended) | 0.0% | 0 | 0.45% | 1.84% | 10 / 34 | 0.08 |

Pages where the step appended at least one footnote: 26 of 122.

| omission page (preregistered arm) | CER before → after | share of reference words before → after | footnotes appended |
|---|---|---|---|
| en-69ae66-ws159 | 54.7% → 1.1% | 46% → 100% | 1 |
| en-69ae90-ws101 | 27.5% → 0.5% | 73% → 101% | 2 |
| en-6ab22a-ws62 | 23.5% → 0.0% | 75% → 100% | 2 |
| en-699249-ws259 | 77.2% → 0.6% | 36% → 101% | 4 |
| en-6aa1d5-ws52 | 30.4% → 30.4% | 78% → 78% | 0 |
| en-69ad66-ws43 | 29.4% → 1.6% | 70% → 103% | 7 |
| en-69b9a2-ws132 | 46.7% → 0.0% | 54% → 100% | 1 |
| en-699200-ws404 | 28.8% → 21.8% | 70% → 99% | 2 |
| en-6a58ed-ws52 | 62.8% → 1.0% | 36% → 103% | 3 |
| en-6ab22a-ws164 | 32.3% → 0.2% | 69% → 100% | 1 |
