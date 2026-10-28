---
stage: ocr
measure: [accuracy, judged]
languages: [la, en, de, fr, it]
scripts: [Latn]
canons: []
n_books: 306
n_pages: 326
verdict: "A GPU draft corrected by agy Gemini 3.8 Flash low (image + draft) matches lite + the same correction on European print. On the 209 lite pages, GLM→Flash (b) and best-E1-draft→Flash (c) are within the A-vs-A noise floor of lite→Flash (a) by CER in Latin, English and German, and make no more worse-than-draft pages (judged): c leaves 3/211 pages misleading against a's 8/209 (a's own repeat 12/209). Two drafts in one call (d) fails English and German. No engine alone comes close: the best draft (LightOnOCR-3-1B, median folded CER 3.07%) leaves 115/324 pages misleading after (c)'s choice per language, GLM 203/324. The corrector reads the page: without the image it is worse on 35 of 58 judged pages (2 the other way). Ninety-one library pages were rewritten with the best judged read; one book was contained (OCR one leaf behind its images)."
status: undecided
decision: "Proposal: per-language cell GPU draft (la PERO-OCR, en/it LightOnOCR-3-1B, de CHURRO-3B, fr Surya 2) → agy Flash-low correction with the image replaces lite → Flash correction for Latin, English and German print, behind E3's guards; French and Italian only after a lite comparison exists (no lite reads there, $0 API). No lane changed; adopting is Derek's call (#7263 router table, cli-ocr-lane)."
superseded_by: null
issue: [7567, 7263, 5924, 7558]
---
## 2026-10-28 · Can a GPU draft corrected by Flash 3.8 (image + draft) replace lite on European print? (#7567, E0–E2)
<!-- PRIOR ART: 2026-10-23-latin-open-engines-adoption-bar-6871.md (no engine alone beats lite + long-s), 2026-10-24-latin-lite-flash-correct-four-arms-5924.md (lite→Flash-low correction, 11/250 worse), 2026-10-24-lite-corrects-gpu-drafts-7263.md (lite as corrector of GPU drafts, rejected; no-image control), 2026-10-26-ocr-pareto-chained-routes-6740.md (#6740's lite→Opus and lite→agy chains, reused here as arm f and a stored replicate of a), 2026-10-27-agy-ocr-pace-read-file-correct-lane-7558.md (the live lite→Flash correction lane). -->

**Yes, for Latin, English and German, by the issue's rule. Not decided for French and Italian (no lite comparator).**

### E0 · Panel (`panel.json`, `refs.jsonl.gz`, `build-panel.py`)
- **326 pages, 306 books, typed references only.** Non-canonical first.
  - EEBO-TCP 58 en + 15 la (`eebo-tcp-5488`).
  - latin-period-5126 77: CAMENA and Wikisource same-edition text; the corrected-OCR references were dropped.
  - Wikisource proofread `ref-ws`: la 34 (pre-1800) and de 30.
  - **DTA** German 1557–1780: 16 works × 2 interior pages, seed 7567, page-aligned diplomatic TEI with ſ.
  - **Wikisource validated fr 40, it 40** (1500–1800, `harvest-wikisource-gt.mjs` unchanged).
- **CATMuS was not used.** CATMuS/modern is line crops with no pages, and its Italian print is 266 lines. GT4HistOCR lines are shuffled. latin-r4-acc has no images or lite reads on this box.
- **16 pages are out of every CER table** (`excluded_from_scoring`, recorded before any judge or decision table):
  - **9 library pages whose served image is now another leaf than the reference's.** Every image reader reads the same other leaf at CER ≈ 0.70; the served image equals the read's image (corr ≥ 0.99).
  - **2 DTA Logau section-title pages.** My parser missed `[printed/scan]` markers; Walter's two references were cut at them by hand.
  - **2 pages of a DTA manuscript.**
  - **3 Wikisource pages:** 2 image/transcription mismatches and 1 wiki-table reference.
- **Scorer** (`score.py`): letters only, infix CER (free extra text at the ends). Two views:
  - raw;
  - folded: ſ/f/s, u/v, i/j, ß, æ/œ and the abbreviation marks merged.

  Loops and truncation are judged against the page's median arm, not the reference: a Wikisource newspaper page transcribes one article of several.

### E1 · Draft screen (median CER %, folded; pages every engine read; loops in brackets)

| engine | la (116) | en (58) | de (58) | fr (40) | it (38) | all (310) | raw all | pages/h beside the 14.5 GB Tibetan job |
|---|---|---|---|---|---|---|---|---|
| **LightOnOCR-3-1B** | 6.38 (1) | **3.31** | 2.18 | 0.64 | **2.16** (1) | **3.07** (2) | 5.39 | 2,556 |
| Surya 2 | 6.25 | 3.40 | 2.26 | **0.63** | 2.35 | 3.55 | 5.69 | 2,008 |
| PERO-OCR (eu print 2022, CPU 8 threads) | **5.99** | 3.50 | 2.49 | 1.61 | 2.80 | 3.59 | 7.28 | 707 (CPU) |
| CHURRO-3B (fp8 weights) | 7.26 (2) | 3.74 | **1.18** (1) | 0.80 (1) | 3.17 | 3.73 (4) | 7.49 | 1,069 |
| Infinity-Parser2-Flash | 6.88 (1) | 3.58 | 2.60 (1) | 1.34 | 2.78 | 3.81 (2) | 5.83 | 1,813 |
| GLM-OCR (anchor) | 6.81 | 3.69 | 3.21 (2) | 1.05 (1) | 2.79 | 3.96 (3) | 5.86 | 1,092 |
| dots.ocr (anchor) | 6.75 (2) | 3.92 | 1.92 | 1.11 (1) | 2.68 | 3.96 (3) | 6.60 | 1,459 |
| *lite (stored bench read, 199 pages)* | 5.39 | 3.36 | 0.87 | — | — | 4.13 | 6.67 | — |

- **Every engine installed.** PERO took about 1 minute (pip + the `pero_eu_cz_print_newspapers_2022-09-26` model).
- **The card was shared.** The Tibetan re-read held 14.5 GB at util 0.6 all night, outside the queue. Five of six vLLM servers OOM'd in the first pass at util 0.365, so `rerun-tight.sh` re-read the failed pages at util 0.30–0.35 with 8 sequences.
- **CHURRO bf16 no longer fitted**, so it ran with fp8 weights on every page. On the 91 pages read both ways, bf16 vs fp8 letter distance is median 0.08%.
- **Throughput is a beside-another-tenant number.** GLM ran 1,092/h here against 1,757/h alone on 10-23 (factor ≈ 0.62).
- **Latin medians are high in every arm** because CAMENA references expand abbreviations.
- **Arm (c)'s draft is the best non-GLM engine per language:** la PERO, en LightOnOCR, de CHURRO, fr Surya, it LightOnOCR (`c-pick.json`).

### E2 · Correction arms (agy Gemini 3.8 Flash low, main pool, one page per call; #6740 template `0601ef30`)
- **Arms:**
  - (a) lite→Flash; (a2) the same again;
  - (b) GLM→Flash; (c) X→Flash, where X is the best E1 draft for the page's language; (d) GLM + X→Flash (`e97253381edfd7e0`, the template with the draft sentence made plural);
  - (e) fresh Flash read (`63266ce8e814161e`, the template's own OCR prompt);
  - (f) lite→Opus, #6740's stored correction (`correct.mjs` instruction); not re-run.
- **No-image control (Derek, inbox 21:15Z)** for a, b, c and d.
  - Taken literally (no attachment), agy hunts for the file and answers CONTAIN/UNCHANGED: 10 CONTAIN of 20 pages. That measures nothing.
  - The control run everywhere puts one sentence where the image was ("could not be attached … correct as well as you can").
- **Decision rule** (`e2-table.py`, committed d1e26065a before arms c and d existed):
  - CER: δ = mean(arm − a), folded, with a 95% paired bootstrap CI. Within the noise floor when the CI's upper end ≤ NF, the larger |end| of a2 − a.
  - Judge: no more worse-than-draft pages than a.

**Decision table, the 209 lite pages** (`results/decision.json`; misleading = the judge did not call it usable; worse = worse than its own draft)

| lang (NF) | arm | δ CER vs a [95%] | misleading | worse than draft | verdict |
|---|---|---|---|---|---|
| la (±2.59 pt), n 125 | a / a2 | — | 6 / 10 | 5 / 6 | |
| | b GLM→F | −0.63 [−2.43, +0.35] | 7 | 0 | **pass** |
| | c X→F | −0.64 [−2.57, +0.52] | **2** | 2 | **pass** |
| | d 2 drafts | −0.79 [−2.63, +0.22] | 4 | 3 | pass |
| | f lite→Opus | −0.76 | 8 (all CONTAIN) | 3 | |
| en (±0.19), n 55 | a / a2 | — | 1 / 1 | 2 / 2 | |
| | b | −0.01 [−0.11, +0.08] | 0 | 1 | **pass** |
| | c | −0.01 [−0.13, +0.11] | 1 | 2 | **pass** |
| | d | −0.01 [−0.12, +0.11] | 1 | **4** | fail |
| de (±1.15), n 29 | a / a2 | — | 1 / 1 | 0 / 0 | |
| | b | −0.11 [−0.48, +0.13] | 0 | 0 | **pass** |
| | c | −0.35 [−0.91, +0.02] | 0 | 0 | **pass** |
| | d | +0.25 [−0.52, **+1.18**] | 0 | 1 | fail |
| all, n 209 | a / a2 | — | 8 / 12 | 7 / 8 | |
| | c | −0.42 [−1.55, +0.26] | **3** | 4 | pass |

**All pages, judged** (`results/judge-table.txt`). French and Italian have no (a):

| arm | misleading of 324 | fr (40) | it (40) |
|---|---|---|---|
| c | 5 | 1 | 0 |
| d | 5 | 0 | 0 |
| b | 12 | 1 | 1 |
| e fresh Flash | 30 (8 filter cuts / no answer) | 0 | 1 |
| X best draft alone | 115 | 9 | 13 |
| G GLM alone | 203 | 19 | 24 |

**Reading the tables:**
- **The draft barely matters once Flash has the image.** GLM is the worst draft, misleading on 63% of pages, yet b, c and d end within the noise floor of each other and of a.
- **The best draft still helps:** c has the fewest misleading pages in every language.
- **Worse-than-draft is measured against each arm's own draft.** A bad draft (GLM) makes "worse" rare, so the c/d counts are the comparable ones.
- **Fresh Flash with no draft (e) is weaker:** 30/324 misleading, 14/55 on English, from filter cuts and truncations.
- **The corrector reads the image.** On the judged sample of 60 pages (12 per language, both arms in one call), for b the image arm has fewer faults on 35 pages and the no-image arm on 2; misleading 2 with the image vs 11 without. For a: 12 vs 1, misleading 2 vs 4.
  - By CER, no-image is worse in de, fr and it for b and c (e.g. de c +3.42 [+1.27, +6.28]).
  - In la and en the CER difference is within ±0.5: the image pass adds marginalia and catchwords the references leave out.
  - This is unlike the #7263 Tibetan lite corrector, which gained as much with no image.
- **Judge controls:** 6 packets with one version holding a dropped line and one an inserted line from another page: **12/12 caught**, and the original was clean in 5/6.

**Cost.** $0 API.
- **agy:** about 3,100 calls; about 27K input and 0.7K output tokens per page with the image, 11K without.
  - The Gemini weekly bucket went 0.587 → 0.471 over 21:42–03:00Z, other pool traffic included. That is ≈ 3e-5 of a week per call (noisy, see #7558).
- **Opus judge:** 602 `claude -p` calls (210 lite, 326 GPU, 60 no-image, 6 controls) on dereklomas@ and, while that login's 5-hour window was at 88%, on the box's second login (milo).
- **GPU:** about 4 h on gex45, beside the Tibetan job.

### Useful output (Derek, inbox 21:15Z)
- **91 library pages rewritten** with the best judged read, through `cli-ocr.mjs apply --apply` with every guard: run `cli-ocr-20261028030021-609322`; undo with `revert-run.mjs --run-id`.
  - The rule is #7522's: clean (usable, no omission, addition, bleed or order error), fewest misreads, and it must beat the stored OCR **inside the same judge call**. Ties keep the stored text.
- **Picks by arm:** a 45, f 31, b 14, e 8, a2 4, c 3, d 3.
- **Refused before apply:**
  - 9 pages in held books, including the 8 image/reference-mismatch books, which were already held;
  - 1 Opus UNCHANGED;
  - at apply, 7 by the foreign-script guard.
- **Image check:** each read's image was checked to be the leaf the page serves (`image-check.py`, corr ≥ 0.95; same leaf 0.997, neighbouring leaf 0.17).
- **No `--mark-stale`.** The stale-translation sweep finds these pages; no re-translation queue was created. List: `results/written-page-ids.json`.
- **Contained (by eye, the brief's exception).** Velser, *Opera historica* (`6a0b351d…`, not visible): the stored OCR runs one leaf behind the images. Archived 17.jpg opens with stored p16's text; 18.jpg opens with p17's.
  - The book is held as `ocr-leaf-offset-7567`, and pp. 17–18 are withheld.
  - The repair is the #3368/#4790 leaf re-pointing.

### What this does not show
- **French and Italian have no lite comparator.** $0 API meant no new lite reads, so "replaces lite" is untested there. c leaves 1/40 and 0/40 pages misleading.
- **The references and the drafts are different texts on the lite side.** Lite here is the 10-03 bench read; the stored OCR is mostly `gemini-3-flash-preview`.
- **n is small per language** (de 29 lite pages, en 55), and the Latin noise floor is wide (±2.6 pt): the CER clause is weak there and the judge carries the call.
- **Throughput was measured beside another tenant.**

**Recommended next (not run here):**
- **E3 guards** (long-s pass, negation/numeral/expansion diffs) on arm c.
- **E4** only if the drafts matter. They barely do: skip, or fine-tune for speed alone.
- **E5:** 20 books × 25 pages per language, including a lite read for fr/it.

Files: `scripts/eval/euro-gpu-correct-7567/` (code, `panel.json`, `refs.jsonl.gz`, `results/`: E1 reads, E2 outputs and prompts, verdicts, key, tables, decision, write choice, apply summary).
