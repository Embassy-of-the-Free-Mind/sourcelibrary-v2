---
stage: ocr
measure: accuracy
languages: [syc]
scripts: [Syrc]
canons: []
n_books: null
n_pages: 80
verdict: "On 80 fresh Syriac folios every prediction held: sauvola -3.8 pp CER on dark spreads, flatten -10.6 pp on clean leaves, unsharp helps both; flatten hurts dark spreads."
status: informational
decision: "No lane change; per-stratum routing was then tested on library pages and did not transfer (#5277)"
superseded_by: null
issue: [5250, 5277]
---
## 2026-09-29 — Round 3 of #5250: do the round-2 Kraken photometric gains hold on FRESH Syriac pages? (#5250, follow-up #5277)

**Headline: YES, every pre-registered prediction confirmed, per stratum.** Kraken Sophro Mhiro, order-free line CER N2
(lower is better), 80 fresh published-GT folios (40 Jerusalem SMMJ 36 dark spreads, 40 ÖNB Cod. Syr. 1 clean leaves;
overlap with rounds 1–2: 0, asserted by `syriac-draw-r3.py`), A/A floor 0 in both strata (15 + 15 repeat reads, 30/30
byte-identical: Kraken on CPU is deterministic too).
- **Dark spreads** (baseline median 0.162): **sauvola 38–2, −3.8 pp** (0.111); **unsharp 37–3, −2.1 pp**; **denoise 35–4–1,
  −1.5 pp**. All three confirm. `flatten` had no prediction and **hurts** here: 11–29, +1.4 pp worse (round 2 had it null,
  8–12). Its losses go as far as +8.4 pp on a page.
- **Clean leaves** (baseline median 0.248): **flatten 40–0, −10.6 pp** (0.248 → 0.138; the round-2 figure was −10.0 pp) and
  **unsharp 39–0–1, −4.2 pp** confirm. `denoise` was predicted null and is null (18–22, p 0.64). Flatten reads more of the
  page: median 834 characters against 736 for `none` (GT 912), and every one of the 40 pages gains (min −2.0 pp, max −27 pp).
- **The pre-registration's text said "flatten HURTS clean".** That contradicts round 2's own measurement (20–0 helps), so
  the amendments comment (posted before any read) judged the cell against round 2's direction. Against the literal text the
  cell would read "denied"; the results JSON carries both (`prediction_note`).
- **By eye** (image opened, `onb-syr1-0228_00000243`): flatten strips the yellow paper cast and evens the background, the
  red rubric points survive, the ink comes out lighter and browner. Consistent with round 2's reading.
- **Design.** Pre-registered on #5250 ("Round 3", 2026-09-29) + amendments (comment 5890832946). Arms none / unsharp /
  denoise / flatten, sauvola on dark only; predictions written down before the run. Decision rule: sign matches the
  prediction AND |median Δ| > the stratum's A/A p90 AND sign test p < 0.05.
- **Scope, still.** One manuscript per stratum, external pages, so the strata stay `exploratory` on the dashboard and the
  confirmation is *within-manuscript*: fresh folios of the same two codices. Whether "dark spread" and "clean leaf"
  transfer to library captures is untested, and the two winning arms are opposite in kind (flatten hurts dark; round 1:
  sauvola hurts clean 6–14), so a misclassified page gets the arm that hurts it. **No lane change in this round**; the
  per-stratum step behind a capture-class classifier is #5277.
- **Replicated?** This IS the replication of round 2's exploratory result, on disjoint pages. Not yet replicated on a third
  manuscript or on library captures.
- **Spend.** $0. Hetzner CPU, one Kraken worker at nice 10, 390 reads in 9.25 h (13:08–22:23Z; Jerusalem spreads ≈ 115 s,
  ÖNB leaves ≈ 50 s), 0 errors, 0 empty reads.
- **Artifact.** `scripts/eval/results/ocr-preprocessing-2026-09-29-r3.json` (+ `-r3/` texts, timings, prep meta, GT manifest,
  draw log). Store run_id `5250r3-syriac-kraken-2026-09-29`. Dashboard cells
  `image-arms/syriac-estrangela-{dark,clean}-fresh/line_cer_n2/<arm>` with the new "Predicted → verdict" column.
