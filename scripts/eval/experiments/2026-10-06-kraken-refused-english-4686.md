---
stage: ocr
measure: accuracy
languages: [en]
scripts: [Latn]
canons: []
n_books: 6
n_pages: 20
verdict: "Kraken reads the English pages Gemini refuses at median CER 0.009 but reproduces only 78.5% of digit strings (bar 90%), so the gate stopped and nothing was written."
status: rejected
decision: "Gate stopped; Derek chose option (b), GLM digit repair, re-gated in 2026-10-06-glm-digit-repair-4686.md"
superseded_by: null
issue: 4686
---
<!-- PRIOR ART: 2026-10-04 round 3 of #5660 (PR #5786) scored Kraken CATMuS-Print against human-keyed EEBO-TCP English (1600–1699 CER 0.046 vs lite 0.053), but on pages Gemini ANSWERED; #4686's own probe read 5 refused pages with no reference. 2026-10-05-engine-contest-5870.md is the preregistration pattern followed here. No earlier run measured any engine on the pages Gemini refuses. -->
## 2026-10-06 · Can Kraken fill the English pages Gemini refuses as RECITATION? (#4686)

- **Question.** Gemini (lite and flash, every tier) returns nothing, with finishReason RECITATION, on 712 pages of four hidden *Philosophical Transactions* volumes (4, 5, 6, 11–12; 1669–1678) and 3 pages of Birch's *History of the Royal Society* (1756), all needed for the Drebbel collection (#5811). Is a free engine's read good enough to serve on these pages?
- **Answer.** **The text, yes; the numbers, not by the preregistered bar. So the gate STOPS and nothing was written.** Kraken CATMuS-Print reads the refused pages at a median **CER 0.009 [0.006, 0.018]**. That is better than lite manages on English 1600s print that Gemini *does* answer (0.053 against EEBO-TCP). It drops no lines and has no catastrophic page. But it reproduces only **78.5 % of printed digit strings** (73/93; G4 needs 90 %). In the body text, leaving out running heads and stacked split-years, the figure is **81 %** (55/68). The misses are 17th-century old-style figures read as letters ("66 or 67" → "cé or éy", "10." → "io.", "5°" → "g°", "2½" → "22"), plus a dropped or misread page number on 3 of 20 pages. On *Philosophical Transactions* the numbers are measurements, dates and cross-references. The other free arms are worse on every count: the Archive's ABBYY text has CER 0.069 and 64 % of digits, and reads 64 of every 100 ſ as f; MinerU has CER 0.050, 73 % of digits, and 85 of every 100 ſ as f.
- **measure:** accuracy, CER against a same-leaf reference, `benchmark-score.mjs` unchanged. The reference is a **blind by-eye full-page transcription by a model (Claude), not a human key**. It was committed (c029dff3c) before any arm's output was opened. No EEBO-TCP or ECCO-TCP transcription of these editions exists: the 61,315-row TCP catalogue was searched. The human-keyed figure for the same engine on the same kind of print is #5660 r3's, quoted above.

### Design (preregistered in c527b1e41, pushed before any arm ran)

`PREREGISTRATION-kraken-refused-4686.md`.
- **Stratum** `refused-en-4686` (`benchmark/refused-en-4686.json`, seed 4686): 20 pages that carry `ocr.recitation_blocked` and have no text. Phil Trans pages were drawn as 4/4/4/5 seeded picks over page-number bins; all 3 Birch pages are included. Six books: a census of the books at stake, not a sample of a language.
- **Arms:**
  - Kraken 7.1 with CATMuS-Print large (`catmus-print-fondue-large`, CC-BY-4.0, S. Gabay);
  - the same with the #5730 EEBO fine-tune;
  - the Archive's ABBYY text of the same leaf (vol. 5's `_djvu.xml` returns HTTP 500, so n = 16);
  - MinerU 3.4.0 pipeline on CPU;
  - Gemini's recorded refusal, not re-run, scored as a refusal (#5581).
  - Kraken ran on the archived master image at `nice 19`, two processes on the shared box: **88 s/page** on average.
- **Gate:** G1 median CER ≤ 0.08 with upper 95 % bound ≤ 0.12; G2 catastrophic ≤ 2/20; G3 dropped lines ≤ 5 % pooled and ≤ 20 % on any page; G4 ≥ 90 % of reference digit strings reproduced. All four pass → write; any fail → stop.
- **Adjudication:** one pass after scoring. Every page where both Kraken arms agreed against the reference, and every missed digit, was reopened on the image. **6 reference corrections in 43,726 characters (0.14 per 1,000):** four stacked split-years ("166⁰₁") left as `[?]` in the blind pass, and two Latin place names. No headline figure moved; the blind-reference result is in `results/kraken-refused-4686/gate-blind.json`.

### Result (n = 20 pages, 6 books)

| arm | median CER [95 %] | catastrophic | ſ read as f, per 100 ſ-words | digit strings reproduced | lines dropped |
|---|---|---:|---:|---:|---:|
| Gemini lite (production) | refused 20/20 | 20 | — | 0 % | 100 % |
| **Kraken CATMuS-Print** | **0.009 [0.006, 0.018]** | 0 | 1.7 (18/1,079) | **78.5 % (73/93)** | 0 % |
| Kraken #5730 fine-tune | 0.005 [0.003, 0.017] | 0 | 0.2 (2/1,079) | 77.4 % (72/93) | 0 % |
| MinerU 3.4.0 (CPU) | 0.050 [0.045, 0.064] | 0 | 85 (918/1,079) | 73.1 % (68/93) | 0.6 % |
| Archive ABBYY (n = 16) | 0.069 [0.060, 0.114] | 0 | 64 (580/904) | 63.6 % (49/77) | 0.9 % |

Gate, applied to stock CATMuS, the preregistered arm: G1 pass, G2 pass, G3 pass, **G4 fail (0.785) → STOP**. The fine-tune is better on CER (paired median Δ −0.003 [−0.005, 0.000], 13 better / 5 worse). Its interval touches 0, so by the preregistered choice it is not selected. It fails G4 too (0.774).

**Read by eye (worst pages and every digit miss):**
- Kraken's errors are letter-level: f read as ſ ("sour" for "four", "aster", "sirm"), an occasional m/w confusion ("mritten"), and a dropped drop-cap or catchword.
- Its worst page is Birch II p. 343 (CER 0.072). It reads the running-head year "166⁴₅" as "1664.1" and "p. 882" as "88-".
- Kraken never writes plausible invented prose, and no line order failed (median gap 0).
- The digit misses are a typeface problem, not a layout one. Old-style 6, 7 and 5 sit on or below the line like letters, and the model reads them as letters.

### Implication

- Kraken is the best free reader of these refused pages by a wide margin, and as text it is better than what we already serve on 17th-c. English print.
- What fails is the number rule, which was set before the run because these volumes are full of measurements.
- The three choices are Derek's (decision line on #4686):
  1. write the Kraken text with the pages marked as having unverified numbers;
  2. write the text and repair digits with a second engine (GLM-OCR, the best open English reader in #5660 r3, needs a GPU: about 715 pages at 2 s/page, under $1);
  3. keep the pages empty.
- No pages were written. The lane script that would write them (`scripts/maintenance/kraken-refused-lane.mjs`: fill-only, provenance block, revision, sweep_log) is in a separate draft PR, waiting on that decision.

- **Replicated?** No: one run per arm, deterministic engines.
- **Artifacts:** `results/benchmark/refused-en-4686-2026-10-06.json` (scored; also on /platform/admin/ocr-evidence, stratum rows only; the stratum is kept out of the pooled English cells because it was drawn on Gemini's refusal); `results/kraken-refused-4686/` (gate, blind gate, blind references, all arm outputs, Gemini meter); references `benchmark/refs/rf-*` (CC0); driver `kraken-refused-4686/` (draw, prep, run-arms, analyze).
- **Cost:** $0. Gemini was not called. About 1 CPU-hour of Kraken and 10 minutes of MinerU.
- *run_id:* `kraken-refused-4686`.
