---
stage: ocr
measure: agreement
languages: [grc]
scripts: [Grek]
canons: []
n_books: 5
n_pages: 2600
verdict: "Full Kraken reads carry both Proclus In Timaeum codices past the 80% bar (97.7% and 98.7% located against Schneider); the alchemical codices plateau near 48%, limited by the edition."
status: undecided
decision: null
superseded_by: null
issue: 5619
---
## 2026-10-06 · Greek manuscripts: full Kraken read + edition fit on the five public-domain-edition codices (#5619)
<!-- PRIOR ART: 2026-10-02-greek-manuscripts-fit-open-edition-5619.md (#5635) is the pilot this completes — same scripts, same fold, same edition files; sefaria-fit (#5560, FIT_RULES v2 since #5637) is the fitting code. -->

**Question.** The pilot (#5635) fitted a public-domain edition we hold to three manuscripts. Grec 1841 reached 76.5 % located against Schneider, but Flash's reading was too poor to verify a span; Kraken verified 5 of 5 sampled spreads. Does a Kraken read of *every* page carry the five public-domain-edition manuscripts past the issue's 80 % bar? Scope as approved on 2026-10-02: the five codices that match prints we hold. **First1KGreek/Perseus editions were not used**: their CC BY-SA 4.0 licence is an open decision for Derek.

**Design.** Read-only. Nothing was written to `pages`/`books`/`page_translations`.
- **Reads.** `scripts/eval/greek-ms-kraken-5619.sh` ran Kraken 7.1 `greek-cllg` (print-trained, non-generative, CPU) over every page image of the five books: 2,600 images, 0 failures. Caps: 3 processes, `nice -n 10`, 2 threads each, a per-page checkpoint, and a 4 h timeout (starved spreads exceeded the pilot's 45 min).
- **Fit.** `scripts/eval/greek-ms-fit-5619.mjs fit --reads kraken`: the pilot's fit unchanged, with the page's Kraken read in place of the stored Flash reading. The code is #5560's `locate`/`anchorAt`/`gramBag`/`fitClass` at the current **FIT_RULES v2**. The Flash fits were re-run on v2 so both readings use the same code; Grec 1841 and Marcianus reproduce the pilot's figures.
- **Chance** = the same book's same reads fitted to the *wrong* public-domain edition (Schneider ↔ Berthelot–Ruelle).
- **Located** = coarse position in order with its text neighbours (#5560 `monotoneAt`). **Edges within 1 line** = start(N+1) − end(N) between consecutive pages with confident edges, ≤ the book's median letters per line. **Verified** = #5560's neighbour method: span [end(N−1), start(N+1)] scored against the page's own reading with shifted and far controls (`fitClass`), at 4-grams and at 6-grams.

**Result.**

| book (images) | edition | reading | located in order | chance | edges within 1 line (median gap, letters) | neighbour span verified, 4-gram / 6-gram | drift ½-page, k = 1 / 5 / 20 |
|---|---|---|---|---|---|---|---|
| **Grec 1841**, Proclus *In Tim.* (355 spreads) | Schneider 1847 | **Kraken** | **340/348 = 97.7 %** | 13.8 % | 275/310 = 88.7 % (0) | **232/299 = 78 % / 283/299 = 95 %** | 95 / 69 / 16 % |
| | | Flash | 267/349 = 76.5 % | 10.9 % | 39/50 = 78 % (4) | 0/46 / 5/46 | 94 / 75 / 26 % |
| **Grec 1839**, *Procli Opera* (1,060) | Schneider 1847 | **Kraken** | **1,029/1,043 = 98.7 %** | 13.3 % | 769/974 = 79 % (8) | **940/948 = 99 % / 941/948** | 98 / 76 / 35 % |
| | | Flash | 1,027/1,043 = 98.5 % | 13.5 % | 875/970 = 90 % (1) | 889/944 = 94 % / 938/944 | 98 / 77 / 35 % |
| **Marcianus gr. 299** (432) | Berthelot–Ruelle | Kraken | 183/385 = 47.5 % | 10.6 % | 84/122 = 69 % (8) | 83/104 = 80 % / 83/104 | 86 / 39 / 24 % |
| | | Flash | 180/387 = 46.5 % | 14.2 % | 93/118 = 79 % (2) | 83/104 = 80 % / 84/104 | 86 / 40 / 22 % |
| **Ars sacra**, Laurenziana (660) | Berthelot–Ruelle | Kraken | 307/631 = 48.7 % | 12.8 % | 139/197 = 71 % (3) | 105/179 = 59 % / 105/179 | 88 / 48 / 14 % |
| | | Flash | 307/631 = 48.7 % | 12.7 % | 146/196 = 74 % (2) | 126/178 = 71 % / 126/178 | 87 / 48 / 13 % |
| **Psellos**, Cambridge (93) | Schneider 1847 | Kraken | 9/22 = 41 % | 23 % | 1/2 | 0/1 | — |
| | | Flash | 17/46 = 37 % | 2 % | 7/7 | 4/5 | — |

- **Proclus *In Timaeum* (Grec 1841, Grec 1839).** With an independent reader, the fit holds across nearly the whole codex, so the pilot's ceiling was Flash's reading, not the method. On Grec 1841, Flash's own text still verifies essentially no span (0/46 at 4-grams): the text readers are given for this manuscript is mostly not what the page says, which confirms #5575. The 20-page drift is low because the page-to-edition rate varies, so each page needs its own anchor (and gets one). Grec 1839 is a different case. Flash already reads it well (94 % of spans verified by its own text, edges median 1 letter), and Kraken, which cannot recite, verifies the same spans (99 %). So the census flag "Flash matches the edition closely: clean read or recitation?" resolves to a clean read for this codex. Kraken edges are looser here (127 overlaps beyond a line vs 2), because Kraken drops or merges line ends; Flash gives the sharper edges.
- **The two alchemical codices plateau at ~48 % whichever reader is used.** The limit is the edition, not the reading. Located pages come in runs, treatise by treatise; Berthelot–Ruelle selects and orders the treatises differently, so about half of each codex has no matching stretch in order. Inside a run, Marcianus spans verify 80 %.
- **Kraken's print-trained model reads the alchemical minuscule worse than Flash does**: looser edges (median gap 8 vs 2 letters on Marcianus) and more `coverage` verdicts (Ars sacra 62 vs 40). Kraken is decisive where the hand is regular (Grec 1841, Grec 1839), not everywhere.
- **The Psellos is not an edition match.** Flash locates in two short runs (pp. 32–36 and 41–55 → Schneider pp. 468–493): Psellos excerpting Proclus, a citation overlap. Kraken segments these Cambridge scans badly (≈ 300 letters a page, colour-bar text read as lines).

**Decision rule (issue): propose a write if a book aligns ≥ 80 %.** **Two books cross it: Grec 1841 and Grec 1839, both Proclus *In Timaeum* against Schneider 1847.** Grec 1841: 97.7 % located, 95 % of neighbour spans verified by Kraken at 6-grams (78 % at 4-grams). Grec 1839: 98.7 % located, 99 % verified. Marcianus and the Ars sacra do not (~48 %, edition-limited). The Psellos is not an edition match. The issue asks for a DECISIONS-PENDING row on a crossing; that row is for Derek to open, because what a write would *be* is undecided (next bullet).
- **What a fitted span is.** It is *the edition's text for this page*: Schneider's readings, orthography and punctuation, not the scribe's. It belongs in a separate layer beside `ocr.data` (an "edition text" field with its edition, span and verdict), never as the page's transcription and never as input that replaces OCR. That layer's design has not been made; this entry does not make it.
- Nothing here touches the CC BY-SA question for the 85 First1K/Perseus matches.

*Grade.* Full run over the five books (2,600 images); a single pass, not replicated. *Cost:* $0 (CPU only), about 78 h wall-clock on a shared box, starved at load 15–37 for much of it. *Artifacts:* `scripts/eval/greek-ms-kraken-5619.sh`, `scripts/eval/greek-ms-fit-5619.mjs` (`--reads kraken`), `scripts/eval/results/greek-ms-align-5619/full-fit-summaries.json` (20 runs: 5 books × {Kraken, Flash} × {edition, wrong edition}). Kraken reads and per-page fits: `hetzner:/mnt/HC_Volume_105839809/greek-ms-align-5619/{kraken-full,fit-*.json}`.
