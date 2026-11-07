---
stage: ocr
measure: agreement
languages: [la]
scripts: [Latn]
canons: []
n_books: 99
n_pages: 99
verdict: "No open engine is ADOPTABLE for Latin print in either century under the brief's bar (median CER within 0.2 pt of flash-lite, no more catastrophic pages). GLM-OCR and olmOCR-2 have lower medians than raw lite, but they loop on 1–4 pages where lite has none. Against lite + the long-s pass (0.66% / 1.49%), every engine is 1.6–9 points behind. A second temperature-0 read gives the same verdict for every engine."
status: rejected
decision: "No GPU lane for Latin print. Latin stays on flash-lite + the long-s pass (job longs-apply-5924). No production lane changed; adopting one is Derek's call (#6871 row 2)"
superseded_by: null
issue: [5924, 6871]
---
## 2026-10-23 · Can an open engine on the GEX45 replace flash-lite for 1500s and 1600s Latin print? (#6871 row 2, #5924)
<!-- PRIOR ART: 2026-10-18-latin-gex45-bakeoff-5924.md (Amendment 4: the same 99 leaves, fed images, harness and scorer; it asked "better than lite", and its M / O arms were never posted); 2026-10-22-latin-longs-pass-5924.md (LP, the lite lane as now served); 2026-10-20-latin-print-distill-glm-ocr-6871.md (a distilled GLM, not one of the brief's engines). -->

**No.** No open engine clears the brief's bar in either century, in either read. The lane stays flash-lite + the long-s pass.

**Design.** Preregistered as Amendment 5 of `PREREGISTRATION-open-engine-print-5660.md` (commit ecc4b8bbb). It was
committed before the binding read existed.
- **Disclosed, not blind.** Run 1 (2026-10-18) had been scored on gex45 before this. Its MinerU and olmOCR rows were never
  posted, and this job read them before writing the bar. The bar is the brief's own text, copied. **Run 2** is binding:
  the same four engines, the same 99 fed images, the same flags, read again on 2026-10-23 (gpu-queue task `15-latin-rep-5924`, 19 min).
- **Pages.** 99 Latin leaves, one per book (PR #6883): 59 from the 1600s and 40 from the 1500s. The references are three Opus reads.
- **Metric.** Page CER, view N (latin-norm@1; ſ→s, v→u, j→i, letters only; order-tolerant), `score.mjs` unchanged.
  Catastrophic = CER > 0.5 or a loop (more than 2× the reference's letters).
- **Comparators.** No new Gemini calls:
  - `L`: the stored flash-lite reads, T 0. This is the brief's comparator.
  - `LP`: L after the long-s pass. This is the lane as served once `longs-apply-5924` lands.
- **Bar, per century and per comparator.** Two conditions:
  1. median(engine) − median(comparator) ≤ +0.2 pt;
  2. catastrophic pages ≤ the comparator's.
- **ADOPTABLE** = passes against both L and LP, in run 2 and in run 1.

### Run 2 (binding), view N. Median page CER %; Δ = difference of medians in points, 95% paired bootstrap CI (10,000, seed 5924)

| engine | 1600s (n = 59) | cat. | Δ vs L | Δ vs LP | 1500s (n = 40) | cat. | Δ vs L | Δ vs LP | verdict |
|---|---|---|---|---|---|---|---|---|---|
| **L** flash-lite | 4.21 | 0 | — | | 5.60 | 0 | — | | |
| **LP** lite + long-s pass | **0.66** | 0 | | — | **1.49** | 0 | | — | |
| P0 PaddleOCR-VL-1.6, layout off | 8.52 | 6 | +4.31 [+2.88, +6.63] | +7.86 | 10.76 | 3 | +5.16 [+3.35, +6.91] | +9.27 | no / no |
| P1 PaddleOCR-VL-1.6, layout on | 7.86 | 1 | +3.65 [+2.64, +4.78] | +7.20 | 8.55 | 1 | +2.95 [+2.16, +4.90] | +7.06 | no / no |
| M MinerU2.5-Pro 1.2B | 6.53 | 0 | +2.32 [+1.14, +3.42] | +5.87 | 6.93 | 0 | +1.33 [+0.07, +2.67] | +5.44 | no / no |
| G GLM-OCR 0.9B | 2.79 | **4** | −1.42 [−2.14, −0.41] | +2.13 [+1.64, +2.67] | 3.12 | **2** | −2.48 [−3.10, −0.55] | +1.64 [+0.49, +3.37] | no / no |
| O olmOCR-2 7B FP8 | 3.12 | **1** | −1.09 [−2.18, −0.11] | +2.46 [+1.57, +3.19] | 4.76 | **1** | −0.84 [−2.10, +0.03] | +3.27 [+1.70, +4.02] | no / no |

**ADOPTABLE: none in the 1600s, none in the 1500s.** Run 1 gives the same verdict for every engine and century
(`bar-a5.json` holds both runs).

**Why each engine fails.**
- **Against raw lite**, GLM-OCR and olmOCR-2 clear the median clause in both centuries. The CI's upper end is under +0.2 pt
  too. They fail the catastrophic clause only: lite has 0 catastrophic pages, GLM has 4 and 2, olmOCR 1 and 1.
  - GLM's catastrophic pages are loops to the 6,000-token cap: p715, p84, p406 and p353 in the 1600s; p67 (Greek) and
    p600 in the 1500s.
  - olmOCR's are p353 (a dense two-column page with side-notes, a loop) and p108 (CER 0.53).
- **Against LP**, nothing is close. The best engine is 1.6 points behind in the 1500s (GLM) and 2.1 in the 1600s (GLM).
  Every CI lies wholly above +0.2.
- **MinerU and both Paddle configurations** miss the median clause even against raw lite. MinerU writes ſ as f as often
  as lite does (2,968 of 3,983 reference ſ, 1600s), and with ſ folded it is still 2.2–2.4 points behind.
- **Post hoc `--fold-f` view** (ſ-as-f not counted, so L = LP = 0.66 / 1.39): every engine is 1.6–6.3 points behind.
  This is the view where an engine's real letter reading shows. No engine is within 0.2 there either.

**The two reads agree.**
- The median |run 1 − run 2| page CER is 0–0.18 points per engine.
- The medians move by ≤ 0.2 pt.
- Catastrophic pages that differ between runs: G 2 + 1 (p406 and p600 loop in run 2, p9 in run 1 only), P0 1, the rest 0.
  So GLM's loops come and go, while its count stays above lite's 0.

### The market comparison: the holding library's own free OCR (Amendment 5a, descriptive, Derek's inbox note 08:21Z)

The leaf is scored against the same Opus reference with the same scorer, as arm X. The mapping rule was committed before
any text was fetched (d9429d156): the text is tied to the fed leaf by identifier, and leaves k ± 1 are a check only.
- **Coverage.** 78 of 99 leaves have a published per-leaf text: Archive 30/30, MDZ 19/19, e-rara 29/47, Heidelberg 0/3.
  Archive's text is the hOCR derivative where one exists and the older DjVu XML otherwise.
- **Dropped.** 3 leaves, all Archive, where the next leaf's text matches the reference far better: an off-by-one leaf map in
  those items. That leaves **75 leaves, 1600s 50 and 1500s 25**.

**Median view-N CER % [95% CI] (catastrophic pages), the same 75 leaves for every arm:**

| arm | 1600s (n = 50) | 1500s (n = 25) | 1600s, ſ-as-f folded | 1500s, folded |
|---|---|---|---|---|
| **X legacy library OCR** | **9.2** [6.3, 12.1] (3) | **15.9** [11.6, 20.1] (1) | 6.9 | 13.0 |
| L flash-lite | 4.3 [3.4, 4.7] (0) | 5.3 [3.9, 5.9] (0) | 0.4 | 1.2 |
| **LP lite + long-s pass (served)** | **0.5** [0.2, 0.9] (0) | **1.2** [0.6, 3.9] (0) | 0.4 | 1.2 |
| F Gemini 3.8 Flash | 0.4 (0) | 1.0 (1) | 0.3 | 0.8 |
| G GLM-OCR | 2.5 (2) | 3.0 (2) | 2.3 | 2.7 |
| O olmOCR-2 | 2.9 (0) | 4.4 (1) | 2.7 | 4.2 |
| M MinerU2.5-Pro | 6.4 (0) | 6.4 (0) | 2.7 | 3.6 |

**By source (median view N):**

| source | 1600s | 1500s |
|---|---|---|
| Archive (n 16 / 11) | X **21.8** vs LP 0.7 | X **18.4** vs LP 1.0 |
| e-rara (n 23 / 6) | X 7.0 vs LP 0.4 | X 15.9 vs LP 1.4 |
| MDZ (n 11 / 8) | X **4.5** vs L 4.0, LP 2.7 | X 6.1 vs L 6.0, LP 2.3 |

- **The served lane is a step change over the free text.** In the 1600s the median page is 0.5% off where the library's
  own OCR is 9.2% off, roughly 18× fewer letter errors. In the 1500s it is 1.2% against 15.9%, about 13×. Even raw
  lite, ſ habit included, is 2–3× better than the free text.
- **The free texts differ a lot by library.**
  - **Archive** is the weakest: 18–22% CER. Four of its 30 leaves came out in Cyrillic (`УКСІРІТ ГЕЫ.` for *INCIPIT
    FELI-*), because the OCR ran with the wrong language.
  - **MDZ** reads about as well as raw lite (4.5 vs 4.0 in the 1600s). LP still beats it, by 1.8 and 3.8 points at the
    medians, on 11 and 8 pages with wide CIs.
- **This is descriptive and was added after the bar.** The texts are what each library serves today, and
  "legacy" covers OCR of different engines and vintages. The 21 leaves with no free text
  (e-rara 18, Heidelberg 3) are a market fact too: those readers get no text at all.

### Throughput on the card (run 2; run 1 in brackets) and the backlog

Each engine ran alone on the card at util 0.6 (olmOCR 0.85), with 16 clients (8 Paddle runners) and the model already loaded.
GPU-days = pages / (pages/h × 24). Backlog sizes are #5924's: 1500s 2.21M, 1600s 2.81M, all Latin 7.5M.

| engine | pages/h | peak VRAM | 1500s | 1600s | all Latin |
|---|---:|---:|---:|---:|---:|
| P0 Paddle, layout off | 2,504 (4,041) | 9.9 GB | 23 d* | 29 d* | 77 d* |
| P1 Paddle, layout on | 2,663 (4,178) | 17.3 GB | 22 d* | 28 d* | 75 d* |
| M MinerU2.5-Pro | 3,335 (3,560) | 14.6 GB | 28 d | 35 d | 94 d |
| G GLM-OCR | 1,757 (1,734) | 17.1 GB | 52 d | 67 d | 178 d |
| O olmOCR-2 FP8 | 1,331 (1,328) | 19.9 GB | 69 d | 88 d | 235 d |

\* At run 1's rate. In run 2, two CPU `ketos train` jobs from another session (16 threads) started on the box during the Paddle arm, and
Paddle's runners are CPU-bound, so its run-2 rate is low for that reason. The GPU engines' rates repeat within 7%.

### What this does not show
- **The references are Opus ×3**, so this measures agreement with Opus, not accuracy against a human transcription.
  The LP vs engine gaps (1.6–9 points) are far larger than the reference slips the 10-18 by-eye read found (about 1 per 3 pages).
- **There is no gothic cell.** Only 4 of the 40 1500s pages are blackletter, so nothing here covers blackletter.
- **The comparators are stored reads with the generic prompt** (Amendment 4), not production's prompt. The 10-22 prompt test
  measured production lite writing ſ as f far less often. That would move L toward LP, which only widens every engine's
  gap.
- **Only stock engines were tested.** The distilled GLM-OCR (#6871 row D) is a separate row: it failed its own bar on 10-20
  and waits for a 3.8-Flash teacher.

*Spend:* $0. No Gemini calls (stored L / LP reads). The owned GPU ran 19 min for run 2 (run 1 ≈ 15 min on 10-18).
*Artifacts* in `scripts/eval/latin-bakeoff-5924/`:
- `reads/{M,O}.jsonl.gz`: the run-1 reads, now committed.
- `reads-rep/{P0,P1,M,G,O}.jsonl.gz`: run 2, with `drive.log`.
- `results-a5.json.gz` and `results-a5-posthoc-fold-f.json.gz`: every arm's per-page scores.
- `bar-a5.json` and `bar-a5-posthoc-fold-f.json`: the bar's output.
- `bar-a5.mjs` and `rep-task.sh`.
- Legacy column: `legacy-ocr-fetch.py` (run on gex45, because e-rara 403s the ARM hosts), `legacy-table.mjs`,
  `reads-legacy/` (X = leaf k, with Xm1 / Xp1 and `legacy-log.jsonl`), `legacy-a5a.json` and `results-a5a-legacy.json.gz`.

No write to `pages`, `books` or any production store, and no lane changed.
