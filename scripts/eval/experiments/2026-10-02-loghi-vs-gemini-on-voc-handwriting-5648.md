## 2026-10-02 · Loghi (GLOBALISE model) vs Gemini on 17th–18th c. Dutch handwriting (#5648)

PRIOR ART: scripts/eval/experiments/2026-09-15-does-any-current-specialist-ocr-engine-beat-flash-lite-4743.md — same question (does a specialist beat flash-lite?) over five scripts, none of them Dutch handwriting; this is a sixth stratum, and nothing in the repo mentioned Loghi.

- **Question.** On early modern Dutch cursive, does the open Loghi HTR stack (KNAW HuC; GLOBALISE's published Aug-2023 model) read better than our production Gemini OCR? Separately, can a Laypa baseline count flag pages where the VLM dropped lines?
- **Design.**
  - **Pages.** 20 pages, every other file of GLOBALISE's held-out set `Validation_All_Random_B2` (doi:10.34894/IQ0YMT), 749 GT lines. Images come from the Nationaal Archief via GLOBALISE IIIF manifests, at full resolution.
  - **Arms.**
    - Loghi: Laypa baseline model doi:10.34894/JPS8TB, then loghi-htr with the model at doi:10.34894/HHM4TE. The model was converted v2→v3 with `convert-v2-to-v3` and run on `docker.htr:2.2.22` with `TF_USE_LEGACY_KERAS=1`, on a CPU box (Hetzner ccx33).
    - Gemini: `bench2-run-model.mjs`, flash-lite (production) and flash.
  - **Scoring.**
    - Whole-page CER.
    - Best-line CER: each GT line matched to its closest engine line, so the score is order-free.
    - Bag-of-words recall.
    - Text is normalised for GLOBALISE's diplomatic marks (`,,` line-end hyphen, `_` superscript).
  - `measure: accuracy`, shared pages only.
- **Result.**

  | Arm | Best-line CER | Word recall (median) | GT lines >60% wrong | Whole-page CER |
  |---|---|---|---|---|
  | Loghi | **0.161** | **0.83** | 77/749 | 0.345 |
  | Gemini flash | 0.252 | 0.70 | 124/749 | 0.297 |
  | Gemini flash-lite | 0.305 | 0.58 | 150/749 | 0.348 |

  - Whole-page CER hides the gap. Laypa's reading order and extra baselines (one page: 184 baselines for 102 GT lines) penalise Loghi as much as misreads penalise Gemini.
  - **Omission screen.** Rule: flash-lite line count < 0.9 × Laypa baseline count. It flagged 9/20 pages. About 4 are real multi-line drops (1391_0699, 2630_1220, 3905_0580, 8970_1652; 11–18 GT lines lost each), 2 are marginal, and 3 are Laypa over-counts. It missed the largest drop (3283_0612: 31 lines output vs 56 GT), where Laypa also under-counted. Usable as a screen, not as a gate.
- **Caveat: home ground.** The pages are held out, but they come from the same archive and hands as Loghi's training data. Read this as Loghi's ceiling, not its expected score on our holdings. It is the positive control the issue asked for. The open half is a by-eye run on Dutch manuscripts we hold, which #5643's page profile has to find first; no `books` field marks manuscript vs print today.
- **Setup traps (for the next run).**
  - The images are amd64-only (~15 GB), so they will not run on the ARM Hetzner boxes.
  - `inference-pipeline.sh` hard-codes `docker run -it`; strip the TTY flags to run it headless.
  - The 2023 GLOBALISE model must be converted v2→v3, and the converted model only loads on `docker.htr:2.2.22` with legacy Keras.
- **Replicated?** No, first run.
- **Artifact.** The run lived in the session scratchpad and the box is deleted. Everything is re-derivable from the three DOIs above plus `bench2-run-model.mjs`. Cost ≈ $2: box €1.68, Gemini $0.06.
