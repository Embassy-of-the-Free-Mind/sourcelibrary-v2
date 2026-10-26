---
stage: ocr
measure: [judged, none]
languages: [la, lzh, bo, de, fr, he, ar, grc]
scripts: [Latn, Hani, Tibt, Hebr, Arab, Grek]
canons: []
n_books: null
n_pages: 180
verdict: "The router's decision-maker is now one table per cell with Beta-binomial posteriors on acceptance against the image (route-judge pilot, #7376), with v1/v2 worth at most 5 pages of prior. Under the stated rules, Latin lite keeps its Opus correction (30/30, P(acc >= 0.8) 0.96). Tibetan, German translation and the served Chinese corrections are HOLD at n = 30: the best route in each (Flash-low 26/30, Opus CLI 26/30, Paddle > Opus 24/30) does not reach P(acc >= 0.8) >= 0.9. The 2% wrong-text bar passes only a route with 0 wrong-text pages in 30. v1's P(floors) is not acceptance: it gave lite Latin 0.04, and the judge accepted 17/30. The queue's next three tests are Chinese Paddle dice < 0.90, German lite OCR and German 3 Flash OCR."
status: undecided
decision: "Proposals only: scripts/eval/estimator/router-table/ (rules.json, build.py, 2026-10-26.md/.json). No routing-table edits (#6740)"
superseded_by: null
issue: [6740, 7376, 7393, 6560, 6561, 5924, 7263, 6871]
---
## 2026-10-26 · Router table: acceptance against the image as the decision-maker, Beta-binomial per cell (#6740)

PRIOR ART: `2026-10-25-estimator-v2-chained-routes-capacity-6740.md` (v2, PR #7393). Its pages waiting, channel
capacity and chain stages are kept, read from its committed outputs. Its decision rule is what this replaces.
`2026-10-25-route-judge-qualitative-pilot-6740.md` (#7376) is the data.

**What replaced what, and why.** v2 routed a cell to a cheaper route only if it "matches Opus": net gain within
max(0.05, 10%) of Opus's in at least 90% of draws. Otherwise the cell went to Opus. Opus was the assumed reference,
so every cell routed to Opus. The route-judge pilot measured routes by whether a reader would accept the output as the
page's text, with Opus as the judge reading against the image and not as the reference reader. On that measure, cheaper
chains win or tie:
- Tibetan: Yigdzin → Flash-low 26/30, against Yigdzin → Opus 25/30.
- German: Opus CLI 26/30, 3 Flash 22/30, Flash-Lite 15/30.

v2's net-gain fit stays as a prior only.

**Design.** Per route per cell: accepted k of n from the pilot's verdicts.
- Posterior: Beta(a + k, b + n − k), with k and n scaled by books / pages where a route's pages share books (Latin: 30
  pages in 9 books).
- Prior mean, for a draft served as-is: v1's P(passes the absolute floors) for that engine in that chart.
- Prior mean, for a draft plus corrector: d + (1 − d) × v2's median net gain.
- Prior weight: 4 pages when every input is measured, 2 when any is pooled. Flat Beta(1, 1) where neither model covers
  the route.
- Cost: marginal, since the draft is already paid. Claude weekly points or agy calls per accepted page; idle quota at 0;
  API list price.
- Rules, all in `rules.json`:
  - **switch** to the cheapest measured route with P(acc ≥ acc_best − 0.05) ≥ 0.9 and wrong-text pages ≤ 2%, else
    **keep**;
  - **HOLD** when no measured route has P(acc ≥ 0.8) ≥ 0.9;
  - **test next** ranks cells by pages waiting × share of the channel's free week per page × Var(acceptance).

`build.py` is stdlib Python, about 100 lines, seeded, no model calls.

**Result** (full table: `scripts/eval/estimator/router-table/2026-10-26.md`)

| cell | pages waiting | decision | best measured route | acceptance (posterior mean [90%]) | wrong text |
|---|---|---|---|---|---|
| Latin, Flash-Lite text | 861,506 | keep lite > Opus | lite > Opus | 30/30 → 0.94 [0.81, 1.00] | 0/30 |
| Tibetan, Yigdzin (Kangyur) | 280,623 | HOLD | Yigdzin > Flash-low | 26/30 → 0.86 [0.75, 0.95] | 3/30 |
| German translation, 3 Flash | 306,784 | HOLD | Opus CLI | 26/30 → 0.84 [0.73, 0.93] | 3/30 |
| German translation, Flash-Lite | 151,361 | HOLD | Opus CLI | 26/30 → 0.84 [0.73, 0.93] | 3/30 |
| Chinese Paddle, served #6561 correction | (4,379 served) | HOLD (upper bound) | Paddle > Opus | 24/30 → 0.78 [0.66, 0.89] | 3/30 |
| 9 other cells (Latin 3 Flash, German/French OCR, Chinese, Hebrew, Arabic) | 2.9M | keep (UNTESTED) | — | prior only | — |
| Greek, 3 Flash | 419,150 | held (#6694) | — | — | — |

**What it shows**
- **HOLD is mostly sample size.** At the same rates, 60 pages would lift Tibetan Flash-low to P(acc ≥ 0.8) = 0.92 and
  German Opus CLI to 0.89. The Chinese correction would stay at 0.45.
- **The 2% wrong-text bar passes only a route with zero wrong-text pages in 30** (1/30 is 3.3%). Tibetan Flash-low and
  Opus both have 3/30. With HOLD cleared, the bar keeps the current route. Read relative to the best route (≤ its rate +
  2%), it would switch to Flash-low. `rules.json` holds both readings.
- **v1's P(floors) is not acceptance.** Lite Latin had prior 0.04 and the judge accepted 17/30. The prior is worth 4
  pages against 9 effective, so it pulls that posterior to 0.40. With a 5-page cap that is tolerable, but a v1 floor
  should not be read as a reader's acceptance.
- **Chinese acceptance is an upper bound.** The judge accepted a correction that turns 章德懋 into 童德懋 (by eye, 1 of 3
  pages read). Kanripo's CER agrees with the judge on order (16/16), but cannot see a one-character name change. Every
  Chinese row carries the caveat until a by-eye or Kanripo name check confirms it.
- **Weeks to clear** use the pilot's 0.0124 points per Opus image page, an upper bound. correct.mjs at 10 pages a call
  measured 0.004, so Latin lite's 53 weeks alone on the Claude channel may be nearer 17.

**Next three tests** (proposals: 30 pages per route, judged against the image; about 1.5 Claude points, 0.74% of the
free Claude week, plus 31 agy calls each):
1. Chinese Paddle, dice < 0.90: Paddle, Paddle > Opus, Paddle > agy Flash high. Add a by-eye name check.
2. German OCR, Flash-Lite: lite, lite > Opus, lite > agy Flash-low.
3. German OCR, 3 Flash: 3 Flash, 3 Flash > Opus, 3 Flash > agy Flash-low.

**Not done.** No model calls, no data writes, no routing-table edits. Retranslation of pages a correction makes stale
is not in the cost; v2 adds it. Siku stale (24,834 pages) is left out.

*Replicated?* No. Every acceptance count is one pilot run with one judge.
