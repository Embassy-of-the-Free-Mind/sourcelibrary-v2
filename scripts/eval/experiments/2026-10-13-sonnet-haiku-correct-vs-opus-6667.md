---
stage: ocr
measure: [accuracy]
languages: [lzh, bo]
scripts: [Hani, Tibt]
canons: [tibetan]
n_books: 130
n_pages: 130
verdict: "Neither Sonnet nor Haiku corrects a draft as well as Opus. On the 40 Paddle table pages Sonnet gains half of what Opus gains (mean CER 7.6% vs 5.1%; +2.5 pt [+1.5, +3.6] against Opus) and makes 10 pages worse where Opus makes 1. On the 30 Tibetan folios Sonnet returns the draft unchanged on 29 and leaves 28 of 30 planted errors. Haiku rewrites about a fifth of the Chinese pages into scrambled tables or loops (mean CER 35% on tables) and duplicates text on 2 Tibetan folios. Sonnet costs about half of Opus per page on the subscription, not a small fraction."
status: rejected
decision: "table-correct-6561 stays on Opus; Tibetan correction does not move to Sonnet or Haiku (#6667)"
superseded_by: null
issue: [6667, 6561, 6560]
---
## 2026-10-13 · Can Sonnet or Haiku correct a draft as well as Opus, on the #6561 Chinese pages and the #6560 Tibetan folios? (#6667)

PRIOR ART: `2026-10-12-paddle-zh-correct-vs-redo-6561.md` and `2026-10-12-tibetan-yigdzin-correct-vs-redo-6560.md`.
Both harnesses, prompts, page sets and scorers are reused; this entry only adds two arms to each. The Opus and Gemini
rows below are the committed outputs of those runs, not re-run. #6182 tested Sonnet at translation, never at correction.

**Why.** Claude quota bounds the Opus-correct lane (#6561). If a cheaper Claude model corrected nearly as well, the
same weekly allowance would cover more pages.

**Design.**
- **Arms:** `claude -p --model sonnet` (resolved `claude-sonnet-5-5` on every call) and `claude -p --model haiku`
  (resolved `claude-haiku-4-5-20251001` on every call). Same call shape as the Opus correct arm of each test: one page
  per call, Read as the only tool, the same prompt bytes. Subscription CLI on cloudlayer (derek@playpowerlabs), $0,
  at most 2 calls in flight, no Mongo writes, no Gemini.
- **Chinese (#6561):** set A (40 withheld table pages), set B (30 random ordinary pages + 30 where Paddle and the
  stored second read disagree), and the 10 planted-error drafts (30 plants). 110 calls per arm. The #6561 scratch
  directory was gone, so `paddle-correct-6561/rebuild.mjs` rebuilt the inputs from the committed draw, plant key and
  prompt hashes. Check: `score.mjs` over the committed Opus, Pro, Flash and redo outputs reproduces the committed
  `score.json` on all 3,000 page-level values and every summary row.
- **Tibetan (#6560):** the 30 Kangyur folios and the 10 planted-error drafts (30 plants), rebuilt with
  `prep.py --reuse-plants`. 40 calls per arm. `score.py` reproduces every committed summary row.
- **Paired with Opus correct** on the same pages. Chinese: difference in page CER, 95% bootstrap over books (4,000
  draws). Tibetan: difference in pooled identity, 95% bootstrap over folios (one per book), as #6560.
- **Not run:** the cross-family image read-off (recitation). Its settler would be Gemini (ruled out here) or Opus
  (same family). Toward-reference edit counts are given without a verdict on them.
- A pilot of 5 pages and 5 folios per arm ran first; its rows are part of the full sets.

### Chinese: Paddle pages (#6561 sets)

**Set A: 40 withheld table pages**

| arm | read / requested | did not read | median CER | mean CER | Δ mean CER vs Paddle | better / worse vs Paddle (> 0.5 pt) | over-count (pages ≥ 3) | pages with a column-order jump | median s/page | Δ mean CER vs Opus correct [95%] | better / worse vs Opus (> 0.5 pt) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Paddle (served) | 40 / 40 | 0 | 6.4% | 9.8% | — | — | 177 (13) | 7 | — | — | — |
| Opus correct (#6561) | 40 / 40 | 0 | 4.0% | 5.1% | −4.7 pt | 31 / 1 | 51 (7) | 1 | 28 | — | — |
| **Sonnet correct** | 40 / 40 | 0 | 5.5% | 7.6% | −2.2 pt | 21 / 10 | 56 (9) | 6 | 22 | +2.5 pt [+1.5, +3.6] | 4 / 28 |
| **Haiku correct** | 40 / 40 | 0 | 14.3% | 35.1% | +25.3 pt | 1 / 26 | 1,460 (19) | 6 | 35 | +30.0 pt [+19.4, +41.4] | 0 / 35 |
| 3.8 Flash high correct (#6561) | 40 / 40 | 0 | 5.5% | 6.7% | −3.1 pt | 24 / 2 | 100 (10) | 5 | 158 | +1.6 pt [+0.6, +2.6] | 8 / 21 |

**Set B random: 30 ordinary pages**

| arm | read / requested | did not read | median CER | mean CER | Δ mean CER vs Paddle | better / worse vs Paddle | over-count (pages ≥ 3) | pages with a jump | median s/page | Δ mean CER vs Opus correct [95%] | better / worse vs Opus |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Paddle (served) | 30 / 30 | 0 | 3.1% | 6.7% | — | — | 72 (7) | 1 | — | — | — |
| Opus correct (#6561) | 30 / 30 | 0 | 3.0% | 5.7% | −1.0 pt | 12 / 2 | 65 (7) | 0 | 17 | — | — |
| **Sonnet correct** | 30 / 30 | 0 | 2.8% | 6.1% | −0.6 pt | 9 / 6 | 70 (7) | 0 | 16 | +0.4 pt [+0.1, +0.9] | 3 / 11 |
| **Haiku correct** | 30 / 30 | 0 | 7.0% | 28.5% | +21.8 pt | 2 / 12 | 2,706 (15) | 3 | 52 | +22.8 pt [+10.0, +38.0] | 3 / 16 |
| 3.8 Flash high correct (#6561) | 30 / 30 | 0 | 2.8% | 5.8% | −0.9 pt | 10 / 0 | 66 (7) | 1 | 121 | +0.1 pt [−0.4, +0.6] | 5 / 7 |

**Set B disagree: 30 pages where Paddle and the stored second read differ (29 scored)**

| arm | read / requested | did not read | median CER | mean CER | Δ mean CER vs Paddle | better / worse vs Paddle | over-count (pages ≥ 3) | pages with a jump | median s/page | Δ mean CER vs Opus correct [95%] | better / worse vs Opus |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Paddle (served) | 30 / 30 | 0 | 2.9% | 4.1% | — | — | 50 (4) | 0 | — | — | — |
| Opus correct (#6561) | 30 / 30 | 0 | 2.7% | 3.8% | −0.4 pt | 7 / 3 | 45 (2) | 0 | 19 | — | — |
| **Sonnet correct** | 30 / 30 | 0 | 2.9% | 7.8% | +3.6 pt | 4 / 9 | 46 (3) | 1 | 17 | +4.0 pt [+0.5, +9.7] | 4 / 12 |
| **Haiku correct** | 30 / 30 | 0 | 2.5% | 16.0% | +11.9 pt | 3 / 7 | 119 (5) | 1 | 42 | +12.2 pt [+3.0, +24.1] | 3 / 11 |
| 3.8 Flash high correct (#6561) | 29 / 30 | 1 | 2.8% | 4.0% | −0.2 pt | 8 / 6 | 46 (3) | 0 | 118 | +0.1 pt [−0.2, +0.5] | 4 / 8 |

- **Calls per page:** 1.00 for Sonnet and Haiku. Every reply had the three sentinels. No did-not-read.
- **Over-correction (set B random):** Sonnet made 6 of 30 pages worse (mean 1.4 pt, worst 3.2 pt) and 9 better; Opus
  2 worse, 12 better. Haiku made 12 worse (mean 55 pt, worst 99 pt) and 2 better.
- **Anchoring (30 planted errors):** Sonnet fixed 29 and kept 1, the same as Opus. Haiku fixed 2 and kept 27.
- **Edits toward the Kanripo leaf** (no read-off): Opus 111, Sonnet 48, Haiku 5.

**What the numbers are made of.**
- **Sonnet is a weaker Opus on tables.** It edits about as much as Opus (median edit 0.7% of Paddle's characters on
  set B; Opus 0.6%) and removes Paddle's repeats almost as well (over-count 56 vs 51, from 177). But it leaves column
  order alone (6 pages with a jump; Paddle 7, Opus 1) and makes 10 of 40 table pages worse. Its table result sits
  near the Opus re-read that #6388 rejected (5.8% median, 7.5% mean, 22 better / 15 worse) and behind 3.8 Flash high.
- **One Sonnet page drives the set B disagree mean.** B049 is a two-row list of 16 painters' names. Sonnet re-ordered
  the names across the rows (CER 4.4% → 75.6%), which is 2.5 pt of the +3.6 pt. The median is level with Paddle.
- **Haiku fails on about one page in five.** 22 of 99 scored pages come back at CER ≥ 50%. On 20 pages it rewrote the
  page as a markdown table, with cells out of reading order, text repeated or one character per cell; other pages loop
  (one reply repeats a block to 1,944 extra characters). On the pages it does not rewrite it mostly returns the draft:
  37 of 100 replies match Paddle in every Han character (Sonnet 23, Opus 29), and 27 of 30 planted errors stay.
- **Scorer note.** The scorer reads every bar form as the ditto mark 丨, so a markdown `|` counts as a character.
  Re-scored with table pipes removed (a side check, not the committed scorer), Haiku's set A mean is 31.4% instead of
  35.1%, and 21 pages are still at CER ≥ 50%. Sonnet and Opus wrote no markdown tables.

### Tibetan: Yigdzin-read Kangyur folios (#6560 set)

| arm | read / requested | identity vs Derge [95%] | Δ vs baseline [95%] | folios better / worse | recall | folios returned unchanged | anchoring: planted errors left | moved toward Derge (spans) | s per page (median) | Δ vs Opus correct [95%] | folios better / worse vs Opus |
|---|---|---|---|---|---|---|---|---|---|---|---|
| served Yigdzin | 30 / 30 | 0.945 [0.939, 0.951] | — | — | 0.930 | — | — | — | — | — | — |
| Opus correct (#6560) | 30 / 30 | 0.960 [0.952, 0.967] | +0.015 [+0.008, +0.022] | 23 / 0 | 0.926 | 7 | 14 / 30 (47%) | 197 | 32 | — | — |
| **Sonnet correct** | 30 / 30 | 0.945 [0.939, 0.951] | +0.000 [+0.000, +0.000] | 1 / 0 | 0.930 | 29 | 28 / 30 (93%) | 1 | 21 | −0.015 [−0.022, −0.008] | 0 / 23 |
| **Haiku correct** | 30 / 30 | 0.935 [0.898, 0.962] | −0.010 [−0.044, +0.015] | 22 / 3 | 0.932 | 5 | 21 / 30 (70%) | 202 | 128 | −0.025 [−0.059, +0.002] | 10 / 17 |
| Pro correct (#6560) | 30 / 30 | 0.965 [0.957, 0.972] | +0.020 [+0.011, +0.029] | 25 / 5 | 0.936 | — | 3 / 30 (10%) | 431 | 135 | +0.005 [−0.004, +0.015] | 17 / 13 |

- **Anchoring folios, scored separately:** Sonnet 0.943 (−0.004 [−0.006, −0.002] against baseline: the planted errors
  are still there); Haiku 0.957 (+0.009 [−0.001, +0.020]); Opus 0.952 (+0.004).
- **Sonnet does not correct Tibetan.** It opened the image on every call (checked on one call with the stream output:
  one Read of `./page.jpg`, an image returned) and returned the draft with no syllable changed on 29 of 30 folios.
  It fixed 2 of 30 planted errors.
- **Haiku is erratic.** It improves 22 folios, some by more than Opus (seq 12, 16, 17, 19, 20: +0.02 to +0.04, where Opus gained 0.00 to +0.01), but
  on seq 3 and seq 29 it wrote 21 lines for a 14-line folio, repeating text (identity 0.672 and 0.733), and its
  interval spans zero. Its 202 moves toward Derge had no image read-off, so how many are recitation is not known.
  It takes 128 s a folio, four times Opus.

### Subscription cost

Read from `/root/.claude-limits/latest.json` (integer percent, polled every 5 minutes), account derek@playpowerlabs.

- **Weekly meter:** 25% before the pilot (11:50 UTC), 26% when the full runs started (12:10), 29% when Sonnet
  finished (13:00), 34% at the end (14:15).
- **The meter cannot be split by arm.** The same account ran the Opus batch (`table-correct-6561`, 2 calls in flight,
  $109 API-equivalent in the window), this job's own session and, from 13:04, another job. Sonnet's 150 calls and
  Haiku's 150 together are $22 API-equivalent of that.
- **Conversion used.** From 12:10 to 13:00, before the other job started, the weekly meter moved 3 points for $58 of
  known API-equivalent spend: about $19 a point (between $15 and $29 for an integer meter). Spend not counted (this
  job's own session) makes the true figure higher, so the percentages below are upper bounds.
- **Sonnet is metered at about its API-equivalent price.** The 5-hour meter moved one point per $2.5 of known spend
  while Sonnet ran and one per $2.2 after it stopped.

| | API-equivalent $ per page (mean) | share of Opus | weekly meter per 100 pages (upper bound) |
|---|---|---|---|
| Chinese: Opus correct (#6561 rows) | 0.173 | — | 0.9% |
| Chinese: Sonnet correct | 0.097 | 56% | 0.5% |
| Chinese: Haiku correct | 0.055 | 32% | 0.3% |
| Tibetan: Opus correct (#6560 rows) | 0.144 | — | 0.75% |
| Tibetan: Sonnet correct | 0.066 | 46% | 0.35% |
| Tibetan: Haiku correct | 0.067 | 47% | 0.35% |

A `claude -p` call carries a fixed overhead (the CLI's own context) whatever the model, which is why Sonnet costs
about half of Opus per page and not a small fraction. Switching to Sonnet would stretch the same allowance about
1.8 times on Chinese and 2.2 times on Tibetan.

### Recommendation

- **`table-correct-6561` stays on Opus.** Sonnet gives half the gain on table pages (−2.2 pt vs −4.7 pt), makes 10 of
  40 worse where Opus makes 1, and saves under half the quota per page. Haiku damages pages.
- **Tibetan correction does not use Sonnet** (it changes nothing) **or Haiku** (it duplicates text on 2 of 30 folios).
  #6560's options stand: Opus correct, or Pro correct with Opus settling its changes.

**Confidence:** high on Haiku (both scripts) and on Sonnet for Tibetan; moderate on Sonnet for Chinese tables (40
pages, one run, Kanripo CER as the only measure, no by-image review).

*Replicated?* No. One run per arm. Artifacts: `scripts/eval/paddle-correct-6561/results/` (`out-sonnet-correct`,
`out-haiku-correct`, `score-6667.json.gz`, `meter-6667.json`) and `scripts/eval/results/tibetan-correct-6560/`
(`out/sonnet-corr*`, `out/haiku-corr*`, `scores-6667.json.gz`).

### Run notes
- Calls: Sonnet 151 (150 plus the one stream-output check), Haiku 152 (two calls were cut off by a runner restart
  and repeated; no page has two rows).
  $0 cash. Nothing was written to Mongo.
- Haiku ran as two lanes of one call each once Sonnet had finished; never more than 2 of this job's calls in flight.
