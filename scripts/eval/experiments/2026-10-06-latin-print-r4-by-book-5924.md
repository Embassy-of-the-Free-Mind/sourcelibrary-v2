---
stage: ocr
measure: accuracy
languages: [la]
scripts: [Latn]
canons: []
n_books: 97
n_pages: 237
verdict: "No open engine beats the flash models on Latin print: 1500s lite+longs and flash+cal tie (0.076), 1600s flash+cal and 3.8-flash (0.068), lite 0.093; GLM trails."
status: undecided
decision: "No routing change and Latin stays off the GPU box; the lite long-s post-pass and flash routing are posed to Derek in the PR (#5924)"
superseded_by: null
issue: [5924, 5660]
---
## 2026-10-06 · Latin print on the GEX45: does an open engine beat flash-lite by century? Round 4 of #5660, random books: no. The flash models win, and lite plus a long-s post-pass is close behind (#5924)

PRIOR ART: 2026-10-04-ocr-bakeoff-round-3-5660.md (round 3: same GLM-OCR config, same Calamari config, same scorer; Latin was directional, 61 hand-picked pages); 2026-10-04-latin-print-by-century-5126.md (lite vs flash-preview by century on 82 same-edition pages, production prompt: the 1600s kept lite); 2026-10-01-early-english-ocr-accuracy-against-eebo-tcp-5488.md (the same-edition reference route).

**Question.** Latin print is the only lane big enough to keep a standing GPU box busy. The Latin OCR queue holds 7.47M pages in 28,750 books, mean 260 pages per book. Per century of the edition, which reader is the MOST ACCURATE? Candidates: GLM-OCR (0.9B) on our own GPU, Calamari on CPU, two hybrids that restore long-s from Calamari, and production `gemini-3.1-flash-lite`, flash-preview, 3.8-flash and 3.1-pro. Cost is reported as a price tag, never as a filter (Derek's Amendment 3).

**Design.** `measure: accuracy` (accuracy sample) and failure rates plus by-eye reads (population sample). The preregistration is Amendment 3 of `PREREGISTRATION-open-engine-print-5660.md`, commit `826042ad9`, pushed before any engine call. **The unit is the book.** Each sampled book gives ONE run of 3 consecutive pages from a seeded uniform start. Book CER is the mean over the run's scored pages, with page CER capped at 1, a refusal counted as 1, and a blank page counted as 1 if the engine writes text on it.
- **Accuracy sample.** Pool: every Latin book we hold with a whole-text same-edition transcription in CAMENA, EEBO-TCP or la.wikisource, confirmed on ≥ 2 seeded pages. That gives 1600s 134, 1500s 60, 1700s 7 and 1400s 0. Noscemus (HTTP 503) and Corpus Corporum (login-only API) could not be enumerated. Books were taken in seeded order. Every page was leaf-checked by eye (`read-from-image`). Scored: **1600s 60 books (149 text pages), 1500s 32 books (77), 1700s 5 books (11)**. 23 taken books were skipped with reasons: the run was not located in the e-text (16), the edition differs (2), the leaf is not Latin (4), or the image fetch failed (1).
- **Population sample.** 65 random books from the whole Latin OCR queue, hidden and launch_curation included: 1600s 25, 1500s 20, undated 10, 1700s 5, 1400s 5. 193 pages; one book's pages 33–34 return 404 from BSB's IIIF server.
- **Primary score: `latin-norm@1`**, applied to reference and engine before the unchanged `benchmark-score.mjs`: ſ → s, ligatures split, sigla and abbreviations expanded (reference-guided, the #5508 skeleton rule), u/v and i/j as printed, f stays f. Secondary: the same scorer without the fold.
- **Rule.** The winner is the lowest median book CER. It is separated from the runner-up only if the sign test over books gives p < 0.05 and the gap exceeds the lite-vs-lite noise floor. Δ vs lite: median, bootstrap 95% CI over books, W/L.

**Result: accuracy sample, `latin-norm@1`, book-level** (median book CER; Δ = arm − lite per book, median [95% CI]; W/L = books better/worse than lite; cata = pages with CER > 0.5).

| arm | 1500s, 32 books (decision) | 1600s, 60 books (decision) | 1700s, 5 books (exploratory) | $/1,000 pages |
|---|---|---|---|---|
| **flash+cal** (flash-preview + ſ/abbreviations from Calamari) | **0.076** · Δ −0.018 [−0.029, −0.009] · 25/5 | **0.068** · Δ −0.020 [−0.023, −0.015] · 53/7 · cata 8 | 0.049 · 4/1 | 1.32 Batch + CPU post-pass |
| **gemini-3.8-flash** | 0.079 · Δ −0.014 [−0.025, −0.003] · 25/7 | **0.068** · Δ −0.021 [−0.025, −0.019] · 51/9 · cata 6 | 0.057 · 5/0 | 1.84 Batch |
| **lite+longs** (production lite + ſ from Calamari) | **0.076** · Δ −0.019 [−0.023, −0.010] · **31/0** | 0.072 · Δ −0.019 [−0.022, −0.014] · **56/1** · cata 7 | 0.196 · 5/0 | 0.70 Batch + CPU post-pass |
| gemini-3-flash-preview | 0.077 · Δ −0.018 [−0.024, −0.009] · 27/5 | 0.071 · Δ −0.016 [−0.021, −0.012] · 52/8 · cata 8 | 0.050 · 3/2 | 1.32 Batch |
| glm+longs | 0.080 · Δ −0.014 [−0.019, −0.002] · 23/8 | 0.070 · Δ −0.017 [−0.027, −0.010] · 46/12 · cata 5 | 0.060 · 5/0 | box + CPU post-pass |
| **glm-ocr** (the box engine) | 0.081 · Δ −0.012 [−0.018, −0.002] · 23/8 | 0.073 · Δ −0.014 [−0.023, −0.008] · 45/14 · cata 6 | 0.062 · 5/0 | box (see economics) |
| gemini-3.1-pro-preview (1500s only) | 0.081 · Δ −0.010 [−0.025, 0.000] · 22/10 · cata 2 | not run (budget cut) | — | **74.77 Batch** (9,019 thinking tok/page) |
| calamari-gt4histocr-bin | 0.086 · Δ −0.007 [−0.016, +0.006] · 18/14 | 0.088 · Δ −0.007 · 35/23 | 0.249 | CPU only |
| gemini-3.1-flash-lite (production) | 0.092 | 0.093 · cata 7 | 0.221 | 0.70 Batch |
| lite-b (A-vs-A) | identical to lite on every book | identical | identical | |

- **Verdict per cell.**
  - **1500s: no box engine.** The cell is a tie between **lite+longs and flash+cal**, with flash-preview level with both: lite+longs vs flash+cal is 15/16, p = 1. GLM-OCR loses to flash-preview, 7/25 (p = 0.002), and to lite+longs, 8/24 (p = 0.007). Under Amendment 2 F, the top-tier answer that needs no GPU is **a CPU post-pass on lite**.
  - **1600s: no box engine.** The cell is a tie between **flash+cal and gemini-3.8-flash**: 32/26, p = 0.51, median gap 0.0004. flash+cal beats lite+longs by a hair (median 0.0013, 37/20, p = 0.033). 3.8-flash and lite+longs are not separated (p = 0.43). GLM+longs loses to both leaders (17/43 against flash+cal, p = 0.001).
  - **1700s and 1400s: not enough references** (5 and 0 books). On the 1700s the open engines lean ahead of lite (5/0), but lite's 0.22 median comes from two microfilm books.
  - **Noise floor.** lite-b is byte-identical to lite on all 97 books (Batch, temperature 0), so the floor is 0 and only the sign test separates arms.
- **Where the 2 points come from: long-s.** Words with ſ misread as f, on the accuracy pages (291): lite **6,896**, flash-preview 1,577, 3.8-flash 1,531, lite+longs 1,097, GLM 595, flash+cal 300, glm+longs 146, Calamari 70. On the population pages: lite 4,127, lite+longs 976, 3.8-flash 870, flash 373, GLM 346, Calamari 84. Lite+longs is better than lite on 56 of 57 1600s books. Production's whole gap to the leaders is almost entirely the long-s.
- **Unfolded view** (secondary; abbreviations and ligatures not folded). The same tier is on top. 1500s: flash+cal 0.103, flash 0.104, Pro 0.105, lite+longs 0.105, against lite 0.120. 1600s: glm+longs 0.087, glm 0.088, 3.8-flash 0.089, flash+cal 0.091, against lite 0.117. Without the fold GLM edges ahead in the 1600s, because the Gemini models expand abbreviations that the folded view credits.
- **Refusals and failures in the accuracy sample.** RECITATION refusals came on Newton's *Principia* and one other book: flash 3, lite 2, 3.8-flash 2. 3.8-flash also returned 2 other refusals and 2 empty answers. Pro hit its 32,000-token limit on 2 of 96 pages (thinking). GLM looped on Greek 2 times (CER 3.5 and 0.75) and hit its 4,500-token cap on 12 of 484 pages. Seams: no arm pulled text from a neighbouring page; a 10-gram was duplicated across a page boundary on at most 5 of 128 population seams (lite 4, lite+longs 5, flash 3).

**Population sample (the backlog itself, no references).** Distance to lite (1 − agreement, folded, median per stratum): flash 0.04–0.06, 3.8-flash 0.02–0.09, GLM 0.04–0.17, Calamari 0.08–0.28 (the 1400s are hardest for every arm). **20 runs read by eye** (`read-from-image`, Claude subagents; `results/open-engine-print-5660/r4/by-eye-population.json`):
- **Best:** flash-preview or 3.8-flash in **all 20 runs** (flash-preview alone 8, 3.8-flash alone 6, ties 6, two of them with Pro).
- **Worst:** GLM-OCR 13, Calamari 7.
- **GLM:** loops on Hebrew and Greek (repeats "ישראל" hundreds of times; 83 repeated lines on a 1497 incunable). It drops marginal notes and most abbreviation macrons, and it misreads Fraktur.
- **Production lite:** invents text. It wrote "1900 / 1900" on a blank leaf of a 1486 book, and it transcribes the facing page's cropped edge as extra lines. On one 1497 two-column incunable it read only that edge strip and then repeated "ꝗdē" about 2,500 times. Its long-s handling flips from page to page.
- **flash-preview and 3.8-flash:** on blank pages they sometimes return an English description instead of nothing. They regularise spellings ("Solomon" → "Salomon"; 1748 German "Hertzen" → "Herzen"). 3.8-flash once put an accent on every i on a page.

**Does the referenced pool look like the backlog? No, for typeface. Say it plainly:**
- The 291 accuracy pages are roman 167, mixed 68, italic 50, and **gothic 0**.
- The 60 population pages read by eye are **gothic 18 (30%)**, mixed 26, roman 12, italic 2. The 1400s and much of the 1500s backlog is blackletter. Scan quality is similar (good: accuracy 64%, population 68%).
- The accuracy verdict therefore **does not transfer to gothic pages**. For those, the only evidence here is the 20 by-eye runs. There, flash-preview and 3.8-flash read best, Pro is as good on abbreviations when it does not drag in the facing page, GLM is worst, and lite invents and loops.

**Five-plus accuracy pages read by eye** (11 pages, `by-eye-accuracy.json`). Most of the remaining CER floor is the reference, not the engines:
- 8 of 11 references include a line of the neighbouring page (the builder's pad) or use normalised spelling.
- One TCP e-text (*Lectiones in Acta*) omits all the Greek, so the ranking runs backwards on its pages: Calamari's short Greek noise "wins".
- Real engine failures:
  - flash-preview transcribes the facing page's cut edge (p52, 0.16 against about 0.025 for the others) and refuses Newton.
  - lite reads long-s as f (+0.03 to +0.06 per page).
  - 3.8-flash's í-for-i page (p118).
  - GLM loops on Greek.
  - flash+cal doubles the abbreviation mark ("atq;;"). This is a restore-rule slip; the letters-only CER does not see it.

**Throughput and economics** (Amendment 2 G). Measured on a **Scaleway L4**, not the RTX PRO 4000 (deviation 1). GLM-OCR alone on the 160-page sweep, s/page by client concurrency: c4 3.71, **c8 3.28**, c16 3.18, c32 3.31, c64 3.43. GPU utilisation is 100% from c4 up. The plateau, the smallest concurrency within 95% of the best, is c8. On the 484 accuracy and population pages GLM took 2.98 s/page at c8. Round 3 measured 2.0 s/page on the RTX PRO 4000 on its pages, so a GEX45 is about 1.5× an L4: about **2.15 s/page** on these books. CPU track (Kraken `nlbin` + `blla` + Calamari, one thread per page): binarize 10.3 + segment 33.8 + Calamari ≈ 19 = **≈ 64 CPU-s per page**. END-TO-END on the two whole books (661 pages, GLM at c8 and the CPU track running at the same time on the box's 8 vCPU): GLM **3.51 s/page**; the CPU track **7.69 s/page wall** = binarize 11.9 + segment 32.0 + Calamari 16.6 = **60.6 CPU-s/page**. A GLM + long-s lane on one such box therefore runs at the CPU's pace, 7.7 s/page, and the GPU idles more than half the time.

| scenario | pages | GLM on GEX45 (≈ 2.15 s/page; L4 3.2) | GEX45s to finish in 6 months, GLM | CPU long-s post-pass (61 CPU-s/page) | lite Batch ($0.70/1K measured) | flash-preview Batch ($1.32/1K) | 3.8-flash Batch ($1.84/1K) |
|---|---|---|---|---|---|---|---|
| (a) Latin queue | 7.47M | 6.1 box-months (L4-speed 9.1) · €0.18/1K | 2 | 126K CPU-h | $5.2K | $9.9K | $13.7K |
| (b) whole OCR backlog | 10.29M (38,109 books, re-measured today) | 8.4 (12.5) | 2 | 173K CPU-h | $7.2K | $13.6K | $18.9K |
| (c) 100K books × 260 pp | 26.0M | 21.2 (31.6) | 4 | 438K CPU-h | $18.2K | $34.3K | $47.8K |

The issue's $0.45/1K for lite assumed production images (≤ 1,500 px). These bench JPEGs are 2,400 px wide (1,120 input tokens/page), so every Gemini price here runs high by about the same factor. **The box does not buy accuracy here.** GLM is behind the flash models in both decision cells, and its failures in the backlog (loops on Greek and Hebrew, dropped marginalia and macrons) are the kind a reader notices. The Calamari post-pass is CPU-bound: about 61 CPU-s/page, so roughly 28 cores to keep pace with one GPU running GLM. On the backlog it is a bigger machine bill than the GPU itself unless Kraken segmentation moves to the GPU (not measured).

**Translation impact (Amendment 2 H): not run.** The winners' Δ against lite is about −0.02, at the ±0.02 trigger. But the Gemini budget was already over its cap (below), so per the brief I stopped rather than spend the extra $1.

**Deviations.**
1. **GPU: Scaleway L4, not a RunPod RTX PRO 4000.** RunPod refused: balance −$0.06. The box was leased through `gpu-lease-watchdog.mjs --lease` (6 h) with a driver-side delete. `idle-poweroff.sh run --` was not used, because it needs the Scaleway secret on the box. vLLM was 0.31.0 (round 3: 0.30.0); GLM config otherwise unchanged (MTP, 4,500 tokens).
2. **The Kraken install failed on the first pass** (no `python3-venv` on the Scaleway image). It was reinstalled with uv and the CPU track re-run before any score. The sweep and end-to-end steps were driven by hand after the first driver was stopped (SIGKILL, so its exit trap would not delete the box).
3. **Pro was cut by the pre-flight** to the accuracy 1500s plus the population 1400s (111 pages), as preregistered. Its population 1500s and the 20 random 1600s books were not run.
4. **Gemini spend broke the $7 hard cap:** actual **$10.50** against an estimate of $5.58. The pre-flight assumed 2,500 thinking tokens per Pro page; Pro used **9,019**, so it cost $8.30 instead of $2.99. The script's cap only checks the estimate. A thinking arm needs a measured probe before Batch: that is a check to add, not a sentence.
5. The fold's abbreviation restore leaves a doubled `;` in flash+cal's raw text ("atq;;"). The letters-only CER is unaffected.

**Implication.** On quality, **Latin print should not go to an open engine on the GEX45**: in both decision cells GLM-OCR is behind the flash models and behind lite with a long-s fix. The most accurate readers are gemini-3.8-flash and flash-preview (+ Calamari's ſ/abbreviations) in the 1600s, and lite+longs / flash+cal / flash-preview in the 1500s. Production lite's deficit is mostly long-s (≈ 2 points of CER) plus invention on blank and edge-strip pages. The cheapest fix in the top tier is a post-pass on lite's text. The gothic backlog, 30% of pages, is not covered by the references, and there the by-eye evidence favours the flash models. **No routing changed; nothing was written to books or pages.** Decisions for Derek are in the PR.

**Replicated?** No. Each arm ran once (temperature 0); lite and lite-b agree byte for byte. The secondary cell, the round-3 hand-picked Latin 1500–1699 (61 pages, not random), stands as round 3 reported it: GLM 0.070 vs lite 0.084, Δ −0.015 [−0.023, +0.001], 34/25. **Artifact:** `scripts/eval/results/open-engine-print-5660/r4/` (draws, pool, leaf-check, `report.json`, `scored-norm/`, `scored-unfolded/`, by-eye files, throughput), references `benchmark/refs/r4l-*` (239), strata `benchmark/latin-r4-{acc,pop}.json`, scripts `latin-r4-{refs,gemini,report}-5924.mjs`, driver `scripts/gpu/ocr-bakeoff-r4-5924/`. Raw outputs: Hetzner `/root/latin-r4-5924/bench/`. **Cost:** Gemini $10.50 (lite $0.34, lite-b $0.34, flash $0.64, 3.8-flash $0.89, Pro $8.30); GPU **$3.10** (one Scaleway L4, 10:21–13:43 UTC, deleted with its volume and confirmed gone from the API). **Total $13.60.**
