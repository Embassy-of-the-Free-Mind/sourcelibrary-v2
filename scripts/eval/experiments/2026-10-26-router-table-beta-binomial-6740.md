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

## Amendment 2026-10-26 · the pick by cost per accepted page, idle quota free, page size (PR #7455)

Derek, 2026-10-26: "and this takes cost into account?" → "yes". Before this amendment the cost column never decided:
the pick among qualifying routes was the lowest share of the channel's free week per RAW page. Table:
`scripts/eval/estimator/router-table/2026-10-26b.md` (the 2026-10-26 table above is kept as it was).

**What changed in `build.py` / `rules.json`.**
- **One unit.** Among routes that pass the unchanged gate (within 0.05 of the best with P ≥ 0.9, wrong text ≤ 2%) and
  the HOLD floor, the pick is the lowest median expected dollars per ACCEPTED page: points (or agy calls) × the plan's
  price per point (or call), a paid API at list, a made draft 0, ÷ the acceptance draw. Fees: the private fee file
  when `--fees` is given, else each plan at the default fee v2 used. Dollars go to stdout only.
- **Idle quota is free in a second decision.** This week: 34.2 Claude points projected unused at the resets
  (allocate_v2.idle_shares over the 2026-10-25 23:40Z climits snapshot; the live meter was not read on gex45), 31.1
  after the three proposed tests. agy idle is 0, because its meter is on Hetzner main.
- **Opus per lane.** correct.mjs batches 10 pages a call; the Chinese (#6561) and Tibetan (#6560) harnesses send one.
  The Opus translation lane is `claude-translate.mjs --per-call=10`, not cli-translate.mjs (that is agy, one page a call).
- **Page size** (inbox 17:21Z and 17:22Z: "10 pages are not the same in all books"; "maybe 5 when it is multi column").
  A Claude page costs k × (overhead / pages per call + the page's own tokens). Tokens are weighted input + 5 × output.
  Page sizes come from `page-size.mjs`: a read-only sample of 200 live books per language, up to 30 pages each, about
  1,000 to 5,000 pages per cell (`page-sizes-2026-10-26.json`).
  - Draft text per page, median: Chinese Paddle about 230 characters, Chinese 3 Flash 640, Latin lite 2,265 (p90 6,443).
  - Most scans hit Claude's image cap of about 1,530 tokens.
  - Multi-column share: 0 (Tibetan, Chinese Paddle) to 0.32 (Arabic).
  - Pages per call: 10 single-column, 5 multi-column, mixed by that share. Neither lane switches on layout today.
- **k, Claude points per weighted token, by meter reading.** Pilot one-page image calls 5.6e-7 (an upper bound);
  correct.mjs at 10 Latin pages a call 5.4e-7; claude-translate.mjs at 10 German pages a call 1.8e-7. Each kind of call
  is priced at its own readings' median; the range spans all three. **The Claude weekly quota is not published per
  token, so k is an estimate.** The 66 Sonnet calls (2 points) are not used: a different model, and no token counts.

**Result** (rebased on #7434's router tests and #7461's relative wrong-text bar; `--before` = `2026-10-26-router-tests.json`).
- **No decision changes** against the router-tests table, under any reading:
  - flat or size-based price, steady or this week, margin 0.05 or 0.10;
  - Latin lite keeps lite > Opus; French lite still switches to agy Flash-low; German lite and German 3 Flash keep Opus;
  - Latin 3 Flash, Tibetan, the German translation cells and the Chinese Paddle cells are HOLD before cost enters.
- **Why cost per accepted page changes no pick today.** Where two routes pass the gate, the one cheaper per raw page is
  also cheaper per accepted page. Where the cheaper route is better per accepted page, it fails the gate:
  - **German lite:** agy Flash-low is 28/30, as Opus is, at $0.97 against $1.78 per 1K accepted pages. It fails the gate
    twice. Its chance of being within 0.05 of Opus is 0.81, short of 0.9 (0.95 at margin 0.10). It also has one
    wrong-text page more than the relative bar allows (2/30, against Opus's 1/30 + 2%). This is the nearest flip: one
    more clean wrong-text test would decide it.
  - **German 3 Flash:** the free draft (29/30) has P = 0.53 of being within 0.05 of Opus (29/29), 0.85 at 0.10.
  - **Margin 0.10** flips nothing: no measured route 0.05–0.10 below the best and ≥ 5× cheaper passes.
- **Idle quota flips nothing this week.** 31 points cover about 1% of Latin lite's 861K pages.
- **Prices change with page size.** Size price against the flat per-page figure, median $/accepted page relative:

| Route | Size price vs flat |
|---|---|
| Tibetan > Opus | +39% (2,171-character pages, one a call) |
| Hebrew > Opus | +22% |
| Latin lite > Opus | +8% |
| Latin 3 Flash, German, French > Opus | 4–14% cheaper |
| Chinese > Opus | 11–18% cheaper (short pages) |
| German translation | +2% (3 Flash cell), −17% (Flash-Lite cell) |
- **Weeks to clear.** Opus at correct.mjs's 10 a call cuts Latin lite's weeks to clear from 53 to 19.
- **The cost ratio.** Tibetan Opus now costs 9× agy Flash-low per accepted page (was 6.6×). When Tibetan clears HOLD,
  the gate decides, not the price.

**Checks.** `test_pick.py`, 7 tests:
- a route cheaper per raw page loses per accepted page;
- idle quota flips agy → Opus, and back at 40% fit;
- a free tie goes to the higher acceptance;
- HOLD;
- batching saves the overhead only;
- a bigger page costs more;
- the units.

Negative control: keying the pick on the per-raw-page price fails 3 tests; restored, all pass.

*Replicated?* No. One page-size sample ($sample, not seeded); k from three readings, two of them integer-meter.
