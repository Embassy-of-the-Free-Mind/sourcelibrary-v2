## 2026-09-11 — Google Cloud Vision as a cheaper OCR lane?

**Headline: no lane. Parity on the pages it reads, but it reads fewer of them —
and on Tibetan it is the worst engine we have tested on our own scans.**

- **Question.** Cloud Vision DOCUMENT_TEXT_DETECTION is $1.50/1K pages against
  $3.42/1K measured on flash realtime and $0.85/1K on lite batch; BDRC's Tibetan
  leaderboard ranks it 3rd of 46. Is it a viable cheaper lane for any of our
  languages, and is its failure mode "garble, not invent"?
- **Design.** All 55 pinned ground-truth pages (the July v0.3 set plus the
  September Latin/Greek/German additions), per-page language hints, same
  `scoreAgainstReference` + normalisation as the July post, paired per page
  against the stored `gemini-3-flash-preview` and `gemini-3.1-flash-lite` runs
  (page = mean over aligned runs, exact sign test). Positive control: the
  Copernicus reference passage rendered as a clean modern page → **CER 0.00 %**.
  Plus 20 pages of the #4523 pilot book (`69e7abd05f1a22ab19a9e929`) scored on
  Derge identity with `kanjur_align.py` on clawdbot against the three Tibetan arms
  already on disk. 78 Vision units, $0 (free tier).
- **Result.**
  - Coverage: Vision aligns **37/55**; lite aligns 52/55 on the same pages. Where
    both align, Vision loses: vs lite 3W/19T/15L, sign p=0.0075, mean −1.09 pp;
    vs flash-preview 1W/13T/11L, p=0.0063, mean −0.51 pp. Per language, on
    aligned pages Vision is at parity on Greek print (median CER 0.21 % vs 0.19 %)
    and near it on German (0.71 % vs 0 %), behind on Latin (3.7 % vs 1.1 %),
    Armenian (4.9 % vs 3.1 %) and Chinese (8.2 % vs 1.7 %).
  - Coverage is the finding: 7/12 Latin pages fail the word guard (early-modern
    long-s, ligatures, abbreviations), 3/6 Chinese (interlinear commentary read in
    the wrong order), both Greek manuscripts (Greek minuscule read as Latin letters
    — the output on the Iliad pages begins `Inches cm 1 2`, the ruler in the
    photograph).
  - Failure mode, read by eye on the five worst pages: **garble, wrong reading
    order and non-text (rulers) — zero invention.** Every disputed string was on
    the page. Gemini's worst pages are a different kind: RECITATION refusals
    (8/8 runs on Hero 178 for flash-preview), a MAX_TOKENS loop of quote marks
    (Zohrab John 1), truncation. The novel-word proxy (output words absent from
    the reference passage) does not separate the two — it runs 0.30–0.81 for
    both engines because the reference is a passage, not the page — so the
    "garbles rather than invents" claim rests on the human read, n=5, and is
    consistent with but not proven by this run.
  - Tibetan: Vision median Derge identity **0.339** vs Gemini woodblock-prompt
    0.453, dbu-can-prompt 0.426, BDRC Yigdzin 0.51 (control 0.968, chance 0.083).
    Vision loses **20/20** to the woodblock arm and to Yigdzin. The leaderboard
    rank does not transfer to this manuscript Kanjur.
  - What Vision has that no VLM does: a per-block confidence. Mean block
    confidence tracks the guard loosely (0.98 on the control, 0.6–0.7 on the
    worst pages) — worth a look as a *triage* signal, not as a lane.
- **Decision.** No routing change. Vision is not a lane for any language here.
  Its one plausible use is as a non-generative *second reader* for triage
  (confidence + disagreement with Gemini flags a page), which is a different
  experiment. The per-language lite-suitability question this was a proxy for is
  now pre-registered in `PREREGISTRATION-per-language-ocr-suitability.md`.
- **Side finding.** `latin-la-praetorius-syntagma1-p120` is unpinnable: the
  stored pipeline OCR (printed p.72) aligns with the reference, but the archived
  image at `page_number 131` is printed p.73 and every engine run over it since
  (lite, Vision, Kraken, Surya, CHURRO) reads p.73 — a one-leaf image/text shift
  on book `69ef2b4685daccce30f2e066`. Filed as an issue; the page must be excluded
  from cross-engine rollups until repaired.
- *Replicated?* Single run (Vision is deterministic; the control re-scored
  identically on a second call). *Artifact:* `results/vision-vs-gemini-2026-09-11.{json,md}`,
  raw outputs in `results/scorecard-outputs-2026-09-11.jsonl` (model `google-vision`),
  transcripts in `results/vision-transcripts-2026-09-11/`, runner
  `google-vision-baseline.mjs`, `runGoogleVision()` in `lib/runners.mjs`.
