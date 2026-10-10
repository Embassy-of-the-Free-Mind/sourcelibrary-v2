---
stage: ocr
measure: [judged, accuracy]
languages: [syc]
scripts: [Syrc]
canons: []
n_books: 38
n_pages: 40
verdict: "The #5250 Syriac preprocessing gains do not transfer to library pages: the classifier finds 0/6 dark pages and routed auto vs production is +0.7% letters read, p 0.26."
status: rejected
decision: "Preprocess flag ships OFF (--preprocess none); no re-read; #4883 re-translation proceeds on existing reads"
superseded_by: null
issue: [5277, 5250]
---
## 2026-09-30 — Syriac per-stratum preprocessing on LIBRARY pages: does the #5250 result transfer? NO (#5277)

**2026-09-30 · Hetzner CPU, $0.** Question: the #5250 round-3 arms (sauvola on dark spreads −3.8 pp CER, flatten on clean leaves −10.6 pp) were confirmed within two external manuscripts. Do they transfer to the library's 38 Kraken-read manuscript books, behind a capture-class classifier?
- **Classifier** (`scripts/workers/syriac-kraken-preprocess.py`, dark iff near-black share ≥ 0.20 and aspect ≥ 1.2; clean iff ≤ 0.12): splits the 120 GT pages 60/60. On 40 library pages (one per book + 2) against by-eye labels from opened thumbnails: agrees on 26/40. All 6 by-eye dark/stained pages were called clean (dark recall 0/6); 3 bilevel microfilm scans and 2 covers were called clean; 3 clean leaves came out unsure. Cohort sample (190 pages, ≤5 per book): 173 clean, 16 unsure, 1 dark. The Jerusalem "dark spread" is a capture (two leaves on black), not a reading difficulty the library shares.
- **Reads** (Kraken Sophro, lane path incl. gutter cut; production read vs downscale-only, flatten, sauvola). No library reference exists, so the metric is Syriac letters read, validated first as a CER sign proxy on round 3 (233/274 pairs agree; 40/40 flatten-clean, 38/40 sauvola-dark). A lexicon hit-rate proxy was tried and REJECTED (141/276, chance). Floor = downscale-only vs production, p90 1.5 %.
  - `auto` (the classifier's routing) vs production: 13-7-20, median +0.7 % letters, p 0.26 — does not count.
  - flatten on by-eye clean leaves: 10-5-14, +0.8 %, p 0.30 — the −10.6 pp GT gain is not visible on library leaves.
  - sauvola: +2.7 % letters, 26-3, p < 0.001, but the proxy was never validated for sauvola on clean leaves, round 1 measured sauvola HURTING clean-leaf CER (6-14), and by eye it erases faded ink (page 8, full-res crop). Not evidence to ship.
- **GT, classifier-routed `auto`:** Jerusalem 38-2, −3.8 pp (0.162→0.111); ÖNB 40-0, −10.6 pp (0.249→0.142) — the round-3 cells, now under real routing.
- **Verdict: REJECTED for the lane.** The flag ships OFF (`--preprocess none`); no re-read of applied pages; #4883 re-translation proceeds on the existing reads. *Replicated?* No (one draw). Artifacts: `scripts/eval/results/syriac-preproc-5277-2026-09-30/`, driver `scripts/eval/ocr-preprocessing/syriac-lib-r4.py`.
