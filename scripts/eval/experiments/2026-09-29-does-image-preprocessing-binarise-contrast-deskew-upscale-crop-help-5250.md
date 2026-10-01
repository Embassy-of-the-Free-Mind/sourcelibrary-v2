## 2026-09-29 — Does image preprocessing (binarise / contrast / deskew / upscale / crop) help any OCR engine on our pages? Paired, four scripts, three engines (#5250)

**Headline: cropping helps Yigdzin; no enhancement helps any engine. Per-leaf crop is the only arm that beats the
current input anywhere. On Tibetan (100 Derge-referenced books) it recovers a median +46 matched Derge syllables per
page (98–2) and brings the 18 hand-verified "1 short" controls to 18/18. Leafcrop has been production since 09-28.
Otsu binarisation HURTS on every engine where it is measured: Yigdzin identity −0.028 (16–81), flash-lite Latin
−0.6 pp CER (7–30), flash-lite CJK −0.5 pp (14–29). Sauvola, CLAHE, deskew and 2× Lanczos upscaling are null or
negligible for Yigdzin and flash-lite. On Kraken (Syriac, 40 external pages) CLAHE and a native page crop HURT
(3–37, 1–39). Binarisation splits by manuscript, post hoc: Sauvola 20–0 −4.2 pp on the dark Jerusalem spreads,
6–14 worse on the clean ÖNB leaves. Decision: add no preprocessing step to the OCR crop path. The Syriac Sauvola
split is a hypothesis for a pre-registered follow-up on library pages.**

- **Question.** Pre-registered on #5250 (Derek, "do it"). Leaf-splitting was the only image-side change ever
  tested (#4722: 6/18 → 18/18). Does binarisation, contrast, deskew or upscaling help, above all for the GPU engines,
  and above all for the 50,210 Tibetan pages marked `ocr.unreadable`?
- **Design.** `measure: accuracy`, paired: same page, same engine, same prompt and decode; only the image differs.
  Arms: none (production 2400 px Lanczos cap), otsu, sauvola (w 25, k 0.2), clahe (clip 2, tile 8), deskew
  (projection profile ±5°), upscale2x (Lanczos). Crops: Tibetan `leafcrop` (production partition crops) plus
  exploratory leaf+enhancement combos; Syriac `gutter` (the lane's `findGutter`) and `pagecrop` (native crop,
  spreads split at the fold, added before any read because the gutter never fires on this set).
  **A/A noise floor first on 30 pages per stratum.** An arm counts iff |median Δ| > p90 |Δ_AA| and the sign
  test p < 0.05; the rule was posted before any arm was read. Strata:
  - Tibetan: Yigdzin-v1 @ 50506eb6 on sl-mitra-1 (production per-leaf worker, image source swapped). 100 books,
    one interior page each, seed 5250. A page counts as referenced when production text hits Derge at identity
    ≥ 0.85 in the window. The locus is fixed at draw time. Metrics: identity (precision), matched syllables,
    lines. Plus the 18 #4722 controls and 50 MARK pages (one per book).
  - Syriac: Kraken 7.1 Sophro Mhiro, default segmenter, RTL, on 40 published-GT MS pages (HTR Winter School,
    external). Metric: order-free line CER N2 (09-16 instrument).
  - Greek+Latin: flash-lite (production OCR prompt v16, hash 360c5a07…, T 0). 50 Greek benchmark pages with refs
    (canonical, not leaf-checked) + 50 la.wikisource proofread pages (leaf-exact, external).
  - CJK: flash-lite on 96 benchmark Chinese pages with Kanripo/CBETA refs (canonical, not leaf-checked).
  - Scoring for both flash-lite strata: windowed CER (`scoreAgainstReference`). A page abstains when its `none`
    read fails the guard; any other failed or unaligned read scores 1.0.
- **Noise floor.** 0 on every stratum. Yigdzin whole-page A/A has 28/30 identical, and leaf A/A p90 is
  0.002 identity. Kraken is 30/30 identical. flash-lite at T 0 is 24/24 and 21/21 identical on scored pairs.
- **Result: Tibetan** (n=100 books; gains vs `none` unless noted).
  - leafcrop: matched +46 (98–2), identity +0.011 (84–16), lines +1 (92–2).
  - otsu: identity −0.028 (16–81), so HURTS.
  - clahe: matched +2 (60–36, p 0.02), counts but is ~0.4% of a page.
  - sauvola, deskew, upscale2x: null.
  - vs leafcrop: leaf+otsu matched −3 (18–74), HURTS. leaf+sauvola/clahe/deskew null.
  - Controls at 14 lines: leafcrop 18/18, none 2/18, whole-page enhancements 3–8/18.
  - MARK structural acceptance: none 25/50, leafcrop 45/50, leaf+sauvola/clahe 46/50. By eye (10 accepted
    leafcrop pages, read from image, line-start level): 5/10 dbu-can read correctly; 5/10 dbu-med cursive, which I
    cannot verify. **Structure is not correctness**, and 6/10 already passed on the whole-page read.
- **Result: Syriac** (n=40, baseline 0.186, which reproduces the 09-16 figure of 0.188).
  - clahe +4.0 pp (3–37) and pagecrop +7.0 pp (1–39), both HURT. Pagecrop reads 15% fewer characters on the
    Jerusalem spreads.
  - upscale2x −0.2 pp (28–11): counts, negligible.
  - sauvola −2.0 pp (26–14, p 0.08) and otsu (20–20): no.
  - Post hoc by manuscript: Jerusalem sauvola 20–0 −4.2 pp, ÖNB 6–14 worse.
- **Result: Greek+Latin** (84 scored, 16 abstained; baseline Greek 0.068, Latin 0.008).
  - Latin: otsu +0.6 pp (7–30) and sauvola +0.06 pp (10–23), both HURT.
  - Greek: every arm null.
  - clahe, deskew, upscale2x: null.
- **Result: CJK** (53 scored, 43 abstained on wide canonical windows; baseline 0.168).
  - otsu +0.5 pp (14–29), HURTS.
  - Everything else null.
- **Deviations.**
  - Syriac: 40 pages, not 50, because the published GT has 40.
  - Syriac reads ran on the sl-mitra-1 GPU. Hetzner CPU OOM-killed three Kraken processes, and the laptop slept
    mid-run. All 330 reads are from one device.
  - Greek/Latin is canonical Greek plus external Latin.
  - The Tibetan leaf+enhancement combos were exploratory additions.
- **Replicated?** No; k=1 per arm. The A/A floors are 0, so per-page differences are the arm, not decode noise.
  The Tibetan positive control reproduced #4722.
- **Grade.**
  - Tibetan: decision-grade (100 books), canonical-dependent.
  - Syriac: exploratory (external, 2 MSS).
  - Greek+Latin: directional (84).
  - CJK: directional (53 scored), canonical-dependent.
- **Decision.** No preprocessing step for the OCR path. Keep leafcrop. Do not binarise for Yigdzin or flash-lite.
  The cursive (dbu-med) part of the MARK cohort stays MARK: no arm makes it verifiable. Taken on #5250, pending
  Derek.
- **Cost.**
  - Gemini: **$2.55 metered** (1,257 `gemini_usage` rows, endpoint `eval/ocr-preprocessing-5250`; realtime,
    because the metered client has no batch path).
  - GPU: **3.88 h L4 ≈ €3.06**, €0.06 over the €3 cap, because the box restarted to pull the Syriac outputs.
  - Hetzner/laptop CPU: free.
- **run_ids.** `5250-tibetan-yigdzin-2026-09-29`, `5250-syriac-kraken-2026-09-29`,
  `5250-greek-latin-flash-lite-2026-09-29`, `5250-cjk-woodblock-flash-lite-2026-09-29`.
- **Artifacts.**
  - Results: `results/ocr-preprocessing-2026-09-29.json` (tables + one row per page × arm) and
    `results/ocr-preprocessing-2026-09-29/` (raw texts, draws, prep meta, call log).
  - Store: `store/outputs/{bdrc-yigdzin-v1,kraken-sophro-mhiro,gemini-3.1-flash-lite}/2026-09.jsonl` and
    `store/scores/ocr-preproc-5250@1/`.
  - Scripts: `ocr-preprocessing/`.
  - Dashboard: `/platform/admin/ocr-evidence#image-arms` (cells `image-arms/<stratum>/<metric>/<arm>`).
