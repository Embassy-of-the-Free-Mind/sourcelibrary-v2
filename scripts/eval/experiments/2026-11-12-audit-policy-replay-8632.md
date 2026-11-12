---
stage: ocr
measure: [judged]
languages: [la, de, zh, grc, fr, it, nl, bo]
scripts: [Latn, Hani, Grek, Tibt]
canons: []
n_books: 1249
n_pages: 1249
status: informational
feeds: [detector]
superseded_by: null
router_evidence: "none — compares ways of choosing audit pages, not routes"
defect_rates: "none — replays stored audit labels"
verdict: "Replayed on the weekly audit's 1,249 random-stratum pages (serious OCR error or wrong leaf, 18%), 8 weeks × 40 checks, 300 simulations: top decile finds 18.7 per 40 (2.54× random), probability-proportional 11.1 (1.51×), the same sharpened (score³) 16.8 (2.27×), a per-cell Thompson bandit 12.1 (1.64×), the oracle 28.5. Cell indicators add nothing to the score (cross-validated AUC 0.843 vs 0.841). The proportional draw's Hajek estimate is unbiased (17.1% vs 18.3%), the sharpened one noisy (16.0%, sd 3.1). Decision: keep 40 random (the unbiased headline) + 40 top decile (the finds); no bandit until cells start to add to the score."
decision: "No change to the draw deployed in PR #8629. The replay is the standing test: rerun it when the labels grow; a cell bandit is worth building only when cell indicators raise cross-validated AUC."
---

PRIOR ART: `2026-11-12-is-serious-predictable-6420.md` (the target: serious OCR error or wrong leaf); PR #8629 (the 40 + 40 draw).

## 2026-11-12 · Does a bandit beat "top decile + random"? (#8632)

Script: `scripts/eval/error-zoo/policy-replay.py`; report: `scripts/eval/error-zoo/policy-replay-2026-11-12.md`.

**Frame.** The weekly audit's random stratum, served, text unchanged since judged: 1,249 pages, 228 with a serious OCR
error or wrong leaf. Scores are the predictor's out-of-book scores. Each policy draws 40 pages a week for 8 weeks
without replacement; 300 simulations.

| policy | serious pages per 40 checks | vs random |
|---|---|---|
| random | 7.4 | 1.00× |
| top decile (deployed) | 18.7 | 2.54× |
| proportional to score | 11.1 | 1.51× |
| proportional to score³ | 16.8 | 2.27× |
| Thompson over cells (language × OCR family), within-cell proportional | 12.1 | 1.64× |
| oracle | 28.5 | 3.87× |

- **Cells add nothing the score lacks**: cross-validated AUC 0.843 with the score alone, 0.841 with 12 cell indicators.
  The largest per-cell gaps (Dutch, Italian, Chinese "other") are 15–35 pages each: noise-sized.
- **Unbiased estimates from the adaptive half**: the proportional draw's Hájek estimate averages 17.1% against the
  true 18.3%; score³ averages 16.0% with sd 3.1%. A top-decile draw gives no estimate (zero inclusion probability
  outside the decile), but the random half already supplies the headline rate.

**So** the sophistication of the chooser matters little at 80 checks a week; the score's ranking and whether
findings reach repair matter more. The repair queue built in the same round (`repair-queue.mjs`) shows the second:
of 2,646 flagged pages, 1,891 sit in cells where the router binds no route.
