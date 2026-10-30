# How Source Library measures OCR and translation quality, and how others do (2026-10-30, #7818)

PRIOR ART: `.claude/docs/eval-design.md` (the rules), `scripts/eval/measurement-validity.md` (audit of 2026-10-11), `.claude/docs/quality-research-system.md` (MQM design, never built). This file is the survey both of them lacked: every method family we have used beside the field's practice, written as the related-work and methods basis for #7818.

Each external citation was checked against the source on 2026-10-30 (`RELATED-WORK-SOURCES.md` beside this file); citations that could not be confirmed were removed and the ones that were wrong were corrected.

## 1. What we have done (14 method families, 507 experiment entries)

| Family | Measures (eval-design §2) | Validated by | Feeds the router | Severity |
|---|---|---|---|---|
| F1 CER/WER against human or typed references (Wikisource, DTA, EEBO-TCP, Kanripo, CBETA, VRI, Derge, Ganjoor) | accuracy, the only "quality" | reference error measured (Wikisource level 3→4: 0.06% de, 1.15% la; two human keyings 0.14–0.43%); by-eye rank check ρ 0.40–0.64 | no (`rules.json` excludes it) | none; a digit channel since 10-12 |
| F2 Cross-engine agreement, MCR | agreement / stability, screen only | mixed (fabrication detector 51/51 recitation pages; two-read screen precision 0.3–0.45) | screen | none |
| F3 Repeat stability over page_revisions | stability | the calibration fit holds on non-canonical pages only (r 0.71) | 30-day watch | none |
| F4 Leaf identity (wrong-leaf, neighbour-leaf, Clef) | judged / agreement | Clef AUC 0.996; the write gate caught 12/12 | write gates, containment | always serious |
| F5 Blank-leaf and show-through tests | judged | the v19.1 prompt test was significant (p 0.019) | prompt choice | — |
| F6 Rule-bound text (planetary hours, numbers checked against the image) | accuracy, model-free | 5 of 14 flags real by eye | review lists | implicitly high |
| F7 Embedding hallucination outliers | — | **none** | no | none |
| F8 Image-grounded Opus judge → k/n → Beta-binomial router (#6740) | judged | wrong-page controls 10/10; planted errors 143/144 (la/de/fr); Opus-vs-Opus κ 0.85–0.92 | **yes, the only feed** | recorded as cosmetic / misleads / wrong_text; only accept and wrong_text are kept |
| F9 Planted-error and wrong-page controls | judge validity | — | disqualifies a route | — |
| F10 Pairwise preference judges | preference | the A/A floor reads 79% ties; Chinese test-retest only 52% | excluded | none |
| F11 Text-only translation audits (#5274, #5301, #5695) | judged / judged_vs_reference | controls 15/15 | decision cards | major/minor; only "any major" is reported |
| F12 By-eye spot checks, shelf overviews | judged | a second reader confirmed 35/35 serious calls | containment, reader warnings; not the router | serious/moderate/minor; only "serious" is used |
| F13 Span-diff QA of corrections | judged per span | Latin diff-QA put back 20/20 plants | lane gates | span risk tiers |
| F14 Text-only detectors | screen | most fail precision; the markup-leak census, leaf-shift gate and Paddle table rule hold | some gates | none |

Full catalogue with every path and number: `review-internal` (session scratch; the numbers above are copied from it).

## 2. What others do (seven areas)

1. **OCR/HTR metrics.** CER/WER, plus Flexible Character Accuracy, which does not depend on reading order (Clausner et al. 2020). The ICDAR 2017 and 2019 post-OCR competitions measure the relative CER reduction from correction. OCR-D defines transcription levels (diplomatic → normalised) that must be declared before scoring.
2. **Reference-free estimation.** Language-model perplexity (Booth 2022), supervised quality estimators at national libraries (Luxembourg), engine confidence (Springmann 2016). Used to triage a whole collection, never to decide a route alone.
3. **Downstream impact.** van Strien et al. 2020 and Hamdi et al.: errors matter unequally by task. This is the field's evidence for weighting by severity: names, numbers and dates cost more.
4. **LLM post-correction, 2023–26.** Boros 2024 is negative for text-only correction. Kanerva 2025 is mixed. Greif 2025 is positive when the image is included, the setup closest to ours. Several papers warn that a low CER can hide fluent invention, which is exactly why a CER-only evaluation is not enough.
5. **Severity in MT.** MQM (Freitag et al. 2021): spans tagged by severity and weighted. Freitag 2021 uses Minor = 1 and Major = 5 (Major chosen from a range of 1–10 by ranking stability), 0.1 for minor fluency/punctuation errors, and 25 for a single Non-translation category (a segment too garbled to annotate, "equivalent to five Major errors"). It drops the Critical level. So "1/5/25" is minor / major / non-translation there, not minor / major / critical. ESA, GEMBA-MQM, AutoMQM and xCOMET automate span marking with LLMs or learned models. **No prior transfer of MQM-style severity to OCR was found.** That is our contribution.
6. **LLM-as-judge validity.**
   - Agreement with humans and position bias (Zheng et al. 2023).
   - Self-preference within a model family (Panickssery et al. 2024).
   - Perturbation meta-evaluation, where errors are planted and the judge is checked for catching them (FBI). This is the precedent for our planted errors.
   - Test-retest reliability.
7. **Statistics.**
   - Paired bootstrap (Koehn 2004).
   - Bayesian comparison (Benavoli et al. 2017).
   - Resampling by document. The field does it, but no primary source was found to cite yet.

## 3. Where we are ahead
- **The judge sees the page image.** Most post-correction work scores text against a reference only. Our judge reads the leaf, and so catches invention that CER on an easy reference set rewards.
- **Severity is tagged per defect, with a quoted span.** This is MQM in practice for OCR, which appears new.
- **The judge is tested on every route.** Planted errors and wrong-page controls run as a standing control (2 per cell × route per week), not once.
- **One page per book**, with intervals resampled by book. Live production output is sampled, not only a test set.
- **Our references carry a measured error.** The reference error itself has been measured (0.06–1.15%). Rare in the field.

## 4. Where we are behind, and how #7818 closes each gap

| Gap | Evidence | How #7818 closes it |
|---|---|---|
| The router decides on an uncalibrated judge, against our own §10.2 | §10.2 needs human calibration for absolute bars and for judging its own family; the router does both | Arm W: judge verdicts against human-proofread text (H3). Calibration against a human reference, not human hours. |
| Planted catch rates overstate real recall | 48/49 planted vs 4/15 real (#5647); 98% vs 27% (§10.2) | H3 on real errors: the judge's accept and wrong_text against the reference diff's own severity, per span |
| Judges of different families disagree on "serious" | Opus vs Gemini α 0.02 | The second judge (agy) is reported as an agreement figure, beside Opus test-retest |
| Severity is recorded and then dropped | build.py keeps only accept and wrong_text; the spot checks keep only "serious" | Severity-weighted score per page (1 / 5 / 25 per 100 words), made-worse by severity, a model-free severity rule on the reference diff |
| No order-independent metric | FCA is standard | Flexible Character Accuracy beside CER in Arm W |
| Normalisation not declared | OCR-D levels | The level is declared in the preregistration (Wikisource ≈ normalised: long-s and ligatures folded) |
| Accuracy is excluded from the router | rules.json | Arm W gives accuracy and judged acceptance on the same pages; the paper reports whether they agree |
| No external benchmark | ICDAR 2019 post-OCR (has de/fr) | Optional arm if time allows (step 4b); otherwise listed as future work |
| Detectors never validated (embeddings, MCR) | measurement-validity.md | Out of scope; the qa-eval skill still calls them "research-grade" and needs a fix (separate PR) |
