PRIOR ART: none — no paper draft for #7818 existed; `scripts/eval/experiments/2026-10-31-correction-pass-paired-7818.md` (the preregistration, amendments and results this outline is built from) and `METHODS-REVIEW.md` / `RELATED-WORK-SOURCES.md` beside this file (the related-work basis).

# Paper outline (#7818)

## Working title
*Does a cheap correction pass help? Image-grounded LLM judging of OCR post-correction on early-modern European print, checked against human proofreading.*

## Abstract (draft, from the measured numbers, 2026-10-31)

**Setting.** A digital library serves Flash-Lite OCR of early-modern German and French print. A cheap second pass, Gemini Flash (low thinking) through a subscription CLI, rereads each page image together with the draft and returns a correction. The pass returns UNCHANGED, or the library's guards refuse the correction, on about a quarter of pages.

**Production test.** We drew one page per book from every page the pass processed (60 German books, 43 French). Opus judged each text separately against the page image, blind to which arm it came from. The pass raised acceptance:
- German: 62% → 75%, +13 points (95% CI +5 to +22); 8 pages gained, 0 lost.
- French: 63% → 79%, +16 points (+7 to +28); 7 gained, 0 lost.

It added no wrong text. In German it cut wrong-text defects from 2.0 to 0.6 per 1,000 words.

**Ground-truth test.** On 78 human-validated Wikisource pages that the library does not hold:
- German CER fell from 1.5% to 1.1% (p < 0.001), with no page worse.
- French CER did not move (1.5%); its drafts were already accepted on 95% of pages.

**The instrument.**
- Test-retest κ 0.87; 8/8 wrong-page controls and 8/8 planted errors caught.
- Acceptance tracks CER (AUC 0.74–0.86).
- Against a model-free severity rule on the human reference, the judge flags only 39% of the texts that contain a wrong-text span (a lower bound). Planted-error catch rates overstate real recall.
- A same-model second judge agrees at κ 0.44.

**GPU route.** A PERO-OCR draft corrected by the same pass, with a put-back of flagged numbers and negations, reaches the Flash-Lite route on French (CER 0.5% against 1.5%). It falls short of the preregistered margin on German.

## Sections
1. **Introduction.** The cheap pass, the question "does it help on the population it actually serves?", and why the conditioned evidence (changed pages only) disagreed (H4).
2. **Data.**
   - Arm P: the lane's ledger frame, one page per book, seeded, and the changed/unchanged shares.
   - Arm W: the Wikisource harvest, its selection biases, and the pages held back.
3. **Systems.** The Flash-Lite production OCR, the correction pass (template 0601ef30e816f7a7) and its apply guards, and the PERO-OCR GPU route with its put-back.
4. **Instrument.**
   - The image-grounded judge (accept, fidelity, defects with taxonomy class and severity).
   - Pairwise blind preference.
   - Controls: wrong-page, planted, test-retest.
   - The second judge.
   - The model-free span-severity rule, FCA, and the normalisation level ("Level 1 + case/punctuation + diacritics").
5. **Results.** H1, H2, H3 (synthetic and real errors), H6, severity.
6. **Reconciliation (H4, H5).** Router test vs lane; the latin-blank stratum.
7. **Discussion.** Guards matter as much as the model: refused corrections serve the draft. The pass helps where the draft is weakest (German). It is close to neutral where the draft is already clean (French Wikisource). Severity reporting.
8. **Limitations.**
9. **Data release.**

## Figures and tables (each with the file that makes it)
| # | What | Made by |
|---|---|---|
| T1 | Arm P frame: processed pages by outcome, changed share by language | `frame.mjs draw` → `results/data/frame.json` |
| T2 | H1: accepted draft/served, gained/lost, McNemar, effect with CI, fidelity, wrong text | `analyze.mjs score` → `results/tables.md` (first table), `results/score.json` `.H1` |
| T3 | H2: CER/WER draft vs served on Wikisource, better/worse pages, unexplained words | `analyze.mjs score` → `results/tables.md` (second table), `.H2` |
| T4 | Four rows per Wikisource page: CER / FCA / span severity / accept (lite, lite+corr, gpu, gpu+corr) | `analyze.mjs score` → `.amendment_1.A2_W`, `results/arm-w-four-rows.json` |
| T5 | Defects per 1,000 words (misleads, wrong_text), every arm and row | `.amendment_2` |
| T6 | Instrument validity: test-retest κ/α, wrong-page and planted controls, Opus vs agy | `.H3`, `.amendment_1.agreement` |
| T7 | Router test vs lane (H4): models, template, frame, outcomes | `analyze.mjs h4` → `results/h4.json` |
| F1 | Paired acceptance flow (draft → served) per language, a 2×2 per language | `.H1` gained/lost |
| F2 | Acceptance against CER (scatter, both arms of Arm W), with the AUC | `results/arm-w-pages.json`, `.H3.cer_vs_accept` |
| F3 | Judge wrong_text against span-rule wrong_text (confusion), and named spans by kind | `.amendment_1.H3_real` |
| F4 | Per-page CER change, lite → lite+corr and lite+corr → gpu+corr | `results/arm-w-four-rows.json` |
| F5 | Severity sensitivity: MQM 1/5/25, 1/5/10, 1/10/100 | `.amendment_1.A1_P.*.severity_per100` |

Each figure is to be drawn by a small script reading only `results/` (not written yet; `results/` holds every number).

## Related work (slots; sources checked in RELATED-WORK-SOURCES.md)
- **OCR post-correction with LLMs:**
  - text-only correction: Boros et al. 2024 (negative), Kanerva et al. 2025 (mixed), Thomas et al. 2024 (BLN600);
  - image plus draft, our setting: Greif et al. 2025;
  - low CER hiding invention: Gardella et al. 2026;
  - ICDAR 2017 and 2019 post-OCR competitions (Chiron et al.; Rigaud et al.).
- **Metrics:**
  - CER/WER;
  - Flexible Character Accuracy (Clausner, Pletschacher & Antonacopoulos 2020);
  - OCR-D transcription levels;
  - downstream impact (van Strien et al. 2020; Hamdi et al.).
- **Severity:** MQM (Lommel et al. 2024; Freitag et al. 2021), ESA (Kocmi et al. 2024), GEMBA-MQM, AutoMQM, xCOMET.
- **LLM-as-judge validity:**
  - Zheng et al. 2023;
  - self-preference (Panickssery et al. 2024);
  - perturbation meta-evaluation (FBI, Doddapaneni et al. 2024);
  - reliability without validity (Norman et al. 2026).
- **Statistics:** paired bootstrap (Koehn 2004), Bayesian comparison (Benavoli et al. 2017).
- **Internal:** #5924/#7269 (Flash-low correction of Latin lite, misleading 100 → 30), #7611 (planted 143/144), #7824 (defect-rate unit), #7807 (Gemini vs Opus judge).

## Limitations (to write out)
- **Wikisource selects easier pages.** Volunteer-chosen works, 600+ characters, middle of the book, legible scans. Level 4 throughout; the French drafts were already 95% accepted.
- **The judge is an LLM.** Its real-error recall against the span rule is 0.39, a lower bound. The span rule itself is noisy on numbers, because Wikisource keeps footnote markers and line counts. It cannot see German names.
- **One model family for the pass.** The second judge is the corrector's own model (Gemini Flash-low), so self-preference is possible. Cross-family agreement belongs to #7807.
- **Arm P French has 43 books,** the whole frame, not 60.
- **One page per book,** so intervals are page = book bootstraps.
- **Opus is the bar** and was not tested against human proofreaders on Arm P pages.
- **Typeface (Fraktur or Antiqua) is not recorded** per page.
- **The correction call is restated, not imported** (`cli-ocr.mjs` is a script). The restatement was checked 320/320 against the lane's own outcomes. The arm-c rule was restated without a replica check.
- **The judge calls ran outside the box's pace-guard slots** (`CLAUDE_PACE_OFF`, one call at a time), under the study's own meter stop.

## Data release plan
- **Page ids and verdicts.** `results/data/` holds:
  - `frame.json` (Arm P page ids, books, outcomes, text hashes);
  - `items.json` (text hashes per role);
  - every Opus verdict (`verdicts-opus.jsonl.gz`), pairwise answer with its key (`pairs-opus.jsonl.gz`, `pairs-key.json`), and agy verdict (`verdicts-agy.jsonl.gz`);
  - `wikisource-set.json` (Wikisource page URLs, Commons files, years, levels);
  - the correction ledgers.
- **Texts.**
  - Arm P drafts and served texts are library text: the drafts are in `page_revisions`, the served texts on the pages, by id and hash.
  - The Arm W drafts, corrections, GPU drafts and Wikisource references are in `$JOB_SCRATCH/correction-pass-7818/correction-pass-7818-texts.tar.gz` (archived to R2 with the job's scratch). For a public release, the Wikisource references go out under CC BY-SA with page-level attribution (the `source_url` per page).
- **Images.** Arm P images are the library's public-domain scans (`image` per item). Arm W images are the Commons renders (`image_url`); the underlying files are public domain.
- **Code.** `scripts/eval/correction-pass-7818/` (AGPL), with the preregistration and both amendments in `scripts/eval/experiments/2026-10-31-correction-pass-paired-7818.md`.
