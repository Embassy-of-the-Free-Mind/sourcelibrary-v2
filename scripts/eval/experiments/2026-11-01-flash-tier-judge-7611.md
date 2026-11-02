---
stage: ocr
measure: [judged]
languages: [la, de, fr, it, ar, he, zh, lzh, bo]
scripts: [Latn, Arab, Hebr, Hani, Tibt]
canons: []
n_books: 375
n_pages: 540
verdict: "Neither higher Flash tier can stand in for Opus on transcriptions. Both catch the plants (143/144 each, against low's 130), and neither shows self-preference by the miss measure (medium +0.01 [-0.06, +0.08]; high +0.06 [-0.01, +0.14], which still fails the < 0.10 bar). But both are far stricter than Opus: they pass 116 and 113 of the 360 real pages, where Opus passes 215. Their kappa with Opus is 0.22-0.65 by stratum, against a bar of 0.75. Medium passes only as a SCREEN, and only on agy-corrected GPU drafts: it misses 0.077 of failing pages and clears 0.48. Thinking makes the calls dear: medium costs 4.5x Flash-low per call ($0.0025) and high 9.2x ($0.0050), both above Opus's $0.0022. That screen therefore costs about $0.0036 a page, more than Opus alone."
status: rejected
decision: "Opus stays the only judge for the all-books transcription check (#7896): 237K judgements, about $520. No Flash tier and no Flash screen is adopted. No cron, router rules.json or book_checks change."
superseded_by: null
issue: [7611, 7896]
router_evidence: "none — a judge comparison on items whose Opus verdicts are already router evidence; it adds no route k/n"
defect_rates: "none — a judge comparison: it measures the judges, not the routes; the routes' defect rates are unchanged"
---
## 2026-11-01 · Can Gemini 3.8 Flash at MEDIUM or HIGH thinking judge stored transcriptions as well as Opus? (#7611)

PRIOR ART:
- `2026-10-30-gemini-vs-opus-lane-judge-7611.md` (PR #7807): the frame, the runner and the Opus side, all reused. Flash-LOW failed there: 130/144 plants, 24/36 inserted sentences, and self-preference (after adjudication it missed 10/44 failing Gemini-written pages against 1/63 failing raw GPU pages, +0.21 [+0.09, +0.34]).
- `scripts/eval/judge-compare-7611/run.mjs`: the same `judge`, `adjudicate` and `score` stages, extended with two arms, a tier rule and a `cost` stage. `judgePrompt` / `parseVerdict` (route-judge-6740) unchanged.
- #7903 (#5274): Flash-MEDIUM passed where low failed for TRANSLATION judging (α 0.68 vs Opus, low 0.53). Nobody has tried medium or high on transcription.

**Question (Derek, 2026-11-01).** Every live book's transcription is to be judged, 5 pages a book (about 237K judgements), so each book page can say how it was checked (#7896). Opus costs about $0.0022 a judgement on the subscription and Flash-low about $0.00055. Flash-low is not good enough. Is Flash at medium or high thinking, and at what cost in agy quota?

### Preregistration: amendment to #7807's, committed before any judge call

**Items: the same 540**, unchanged (`results/2026-10-30/items.json`, seed 7611): 180 planted controls (36 clean, 144 single planted errors) and 360 real lane pages, 90 each of GEM (Gemini-written OCR), GPU (raw Paddle/Yigdzin drafts), GPU>GEM (GPU drafts corrected by agy Flash-low) and TR (Gemini translations). The texts are #7807's `texts.json.gz`, copied from the main box's job scratch via R2 (`cold/xfer/flash-judge-tier-7611/`) and checked: all 540 reproduce the committed `text_hash`, and all 540 carry their stored Opus verdict. **No Opus judge call is re-run.**

**Two new arms**, each blind to author, route and Opus's verdict, one call per item with the page image in a gated workspace (`installToolGate`: `view_file`/`read_file` only; a verdict counts only if the gate log shows the image was opened; at most 3 tries per item):
- `flash-medium` = `gemini-3.8-flash-medium` via `agy -p`, default pool.
- `flash-high` = `gemini-3.8-flash-high` via `agy -p`, default pool. (`-high` counts as heavy in `agy-cli.mjs` ledgerGate, so `AGY_HEAVY_DAILY_CAP` is raised for this job; agy-guard's box cap covers argon/pro only.)
- **No Argon arm. No Gemini API. Opus stays the judge of record.**
- **Noise floor:** each arm judges the same 30-item repeat subset (`frame.json` `noise`) a second time.

**Stops.** Read `agy /quota` before starting. A run stops when the default pool's Gemini weekly remaining is under **0.15**, or its 5-hour bucket is under 0.30 (resume after the 5-hour reset), checked every 25 calls. Budget: **at most 1,200 agy calls** in all (2 × 570 = 1,140 plus retries; if retries would cross 1,200, the high arm's repeat is cut first and that is reported).

**Adjudication (#7807's rule, with reuse).** Every real item where a new arm's accept differs from the stored Opus accept goes to the blind Opus adjudicator (`adjudicatePrompt` unchanged), at most 75 per arm in seeded order, **except** items an earlier adjudication already settled: every disagreement on an item is the same one (Opus's accept against its negation), so the adjudicator's own accept on that item is reused (Argon's adjudication first, all of whose disagreements were adjudicated, then Flash-low's). The number reused is reported per arm (`adjudication_borrowed`). Opus calls: only these.

**Measures**, as #7807 (`score` stage), for each new arm: planted recall (`scorePlant`), noise floor, accept agreement and κ against stored Opus per group, miss / false alarm against the adjudicated label, the screen, and self-preference.

**Decision rules (set now).** Strata: GEM, GPU (raw), GPU>GEM (agy-corrected GPU drafts). TR is reported, but the decision is about transcription.
- **Passes as THE judge for a stratum** when all three hold:
  1. plants caught **≥ 141/144** (judge-wide);
  2. accept/reject agreement with stored Opus **κ ≥ 0.75 on that stratum**;
  3. self-preference gap = (miss rate on failing GEM pages) − (miss rate on failing GPU pages), against the adjudicated label, has a **book-bootstrap 95% CI upper bound below 0.10** (judge-wide). GPU>GEM − GPU and the within-Chinese cut are reported beside it.
- **Passes as a SCREEN for a stratum** (Opus re-judges every page Flash fails; Flash passes are final) when Flash **misses ≤ 0.08 of the failing pages** (the share of adjudicated failures Flash passed; point estimate, CI reported) **and passes ≥ 40% of the stratum's pages** (the share Opus never sees).
- Otherwise neither: Opus only.

**Cost per call, per tier (second deliverable, `cost` stage).**
- Tokens per call (input, output, thinking, cache read) from agy's `--output-format json` usage, stored on every verdict row, for each new arm and for the stored Flash-low verdicts.
- Each call priced at the gemini-3.8-flash list rates in `model-pricing.mjs` ($0.75/M input, $3.75/M output; thinking is inside output; cache read at 10% of input), as the pool is charged by token cost. **$/call(tier) = $0.00055 × mean list cost(tier) ÷ mean list cost(Flash-low)**; $/judgement multiplies in the calls per parsed verdict.
- A `/quota` reading before and after each arm; the weekly delta per call is reported, flagged as noisy (other lanes share the default pool).
- For each passing option, the whole-library cost: 237K judgements by the tier alone, or "Flash screen + Opus ($0.0022) on the pages it fails" (Opus share = the stratum's measured fail rate under that tier).


### Results (judged 2026-11-01 22:46Z to 2026-11-02 03:05Z, after this preregistration was pushed at 7ffdc3c4f)

**Calls.**
- **agy, about 1,149 in all** (budget 1,200). That is 571 medium calls (540 items + 1 retry + 30 repeats), 572 high calls (540 + 2 retries + 30 repeats), 2 one-word probe calls to confirm both model names, and about 4 high calls in flight when the high run was restarted.
  - 1,140 of 1,143 recorded calls parsed; the 3 that did not (unparsed replies) were retried and parsed. Every counted verdict opened the image.
  - Medium took 47 s a call on average, and high 101 s. Flash-low takes 16 s.
- **Opus (`claude -p`), 67 adjudications.** Medium had 107 disagreements: 56 were settled by an earlier adjudication and 51 were new. High had 116: 100 settled earlier (including 39 by medium's run) and 16 new. Every disagreement of both arms is adjudicated. No Opus judge call was re-run.
- **Pool:** the default agy pool went from 0.687 to 0.630 weekly remaining across both arms, never near the 0.15 stop.
- **Deviations from the preregistration:**
  - The high arm was restarted once, from concurrency 4 to 6, after its first 33 verdicts (it was running at 3 calls a minute). The runner resumes, so no item was judged twice. The quota readings of the stopped slice are recorded by hand in `runs.json`.
  - In the first scoring, high borrowed adjudications only from Argon and Flash-low, as the code was first written. That left 39 of its disagreements unlabelled, though medium's run had already adjudicated them. The preregistration says to reuse any earlier adjudication, so the borrow list was corrected to include medium's (`ADJ_BORROW`) before anything below was written.

**1. Planted errors** (144 single errors on accepted pages; 36 clean pages).

| judge | caught B–E | by-book 95% | named | number | noun | line dropped | sentence inserted | clean page rejected |
|---|---|---|---|---|---|---|---|---|
| Opus (stored) | 143/144 | 0.98–1.00 | 142 | 36 | 36 | 36 | 35 | 1/36 |
| Flash low (#7807) | 130/144 | 0.86–0.94 | 126 | 35 | 35 | 36 | **24** | 6/36 |
| **Flash medium** | **143/144** | 0.98–1.00 | 141 | 35 | 36 | 36 | **36** | **13/36** |
| **Flash high** | **143/144** | 0.98–1.00 | 143 | 36 | 36 | 36 | 35 | **12/36** |

Thinking fixes the invented-sentence blind spot: 24/36 at low, 36/36 at medium. It also makes the judge reject a third of the clean pages.

**2. Noise floor** (the same 30 real items judged twice).

| judge | agrees with itself | κ | vs Opus on the same 30 |
|---|---|---|---|
| Opus | 28/30 | 0.86 | — |
| Flash low | 25/29 | 0.72 | 26/30 |
| Flash medium | 26/30 | 0.71 | 22/30 |
| Flash high | 24/30 | **0.53** | 20/30 |

**3. Agreement with stored Opus on real pages**, by who wrote the text. Pass counts are out of 90.

| group | **medium** pass / Opus | diff [95% book CI] | agree | **κ** | Flash passes, Opus fails / reverse | **high** pass | diff | agree | **κ** | Flash passes, Opus fails / reverse |
|---|---|---|---|---|---|---|---|---|---|---|
| GEM | 32 / 48 | −0.18 [−0.27, −0.10] | 0.80 | **0.61** | 1 / 17 | 34 | −0.16 [−0.23, −0.08] | 0.82 | **0.65** | 1 / 15 |
| GPU (raw) | 13 / 43 | −0.33 [−0.44, −0.23] | 0.64 | **0.27** | 1 / 31 | 13 | −0.33 | 0.62 | **0.22** | 2 / 32 |
| GPU>GEM | 43 / 67 | −0.27 [−0.37, −0.18] | 0.71 | **0.44** | 1 / 25 | 44 | −0.26 | 0.72 | **0.45** | 1 / 24 |
| TR | 28 / 57 | −0.32 [−0.42, −0.22] | 0.66 | 0.37 | 1 / 30 | 22 | −0.39 | 0.54 | 0.20 | 3 / 38 |
| all | 116 / 215 | −0.28 | 0.70 | 0.44 | 4 / 103 | 113 | −0.28 | 0.68 | 0.40 | 7 / 109 |

The disagreements run almost all one way: Flash fails a page that Opus passed (103 against 4 for medium).

**4. Adjudication** (blind Opus, image plus both reviews). Medium's 107 disagreements: where Flash failed a page Opus passed, the adjudicator sided with Flash on 25 of its own 51 new cases, with Opus on 22, and with neither on 3.
- **What Flash was right about:** a misread long-s name (Bourgueſi → Bourguefi), "hatē" read as "hat", 困學記 read as 周學記 in a running title, wrong Greek words in a Latin page, an invented `<vocab>` list, and a translation that adds the Freemasons where the page says only "des Ordens".
- **What Opus was right about:** variant forms (巳/已, 弟/第), dropped abbreviation marks, dynamics in a music page, and misreadings Flash claimed that are not on the page.

So both higher tiers find real failures that Opus passed. **Against the adjudicated label, stored Opus passed 71 of the 215 failing pages in medium's set**, where medium passed 8. Half of the extra rejections are also false alarms, which is why κ is low. The adjudicator is Opus, and it saw Flash's named defects. That is the declared limit: this is not a neutral referee.

**Against the adjudicated label** (all disagreements adjudicated: 0 unlabelled for either arm).

| group | medium miss | medium false alarm | high miss | high false alarm |
|---|---|---|---|---|
| GEM | 2/54 | 6/36 | 4/56 | 4/34 |
| GPU | 2/69 | 10/21 | 1/70 | 8/20 |
| GPU>GEM | 3/39 | 11/51 | 4/42 | 8/48 |
| TR | 1/53 | 10/37 | 3/56 | 15/34 |
| all | 8/215 | 37/145 | 12/224 | 35/136 |

**Self-preference (the preregistered measure:** miss rate on failing GEM pages minus that on failing GPU pages, against the adjudicated label).
- Medium: **+0.008 [−0.055, +0.077]** (passes, < 0.10).
- High: **+0.057 [−0.010, +0.136]** (fails: the upper bound is over 0.10).
- Flash-low (#7807): +0.21 [+0.09, +0.34].
- On #7807's other measure (pass difference against Opus, GEM minus GPU), medium shows +0.16 [+0.02, +0.29] and high +0.18 [+0.05, +0.32]. Both come from how much harder they are than Opus on raw GPU drafts (13 passes against 43), not from leniency on Gemini text: on GEM they pass fewer pages than Opus.

**5. Decision, by the preregistered rule.**

| stratum | medium as judge (plants ✓, self-pref ✓, κ ≥ 0.75?) | medium as screen (miss ≤ 0.08, clears ≥ 0.40) | high as judge (plants ✓, self-pref ✗) | high as screen |
|---|---|---|---|---|
| GEM | no (κ 0.61) | no: miss 0.037 [0, 0.09], clears **0.36** | no | no: miss 0.071, clears 0.38 |
| GPU (raw) | no (κ 0.27) | no: miss 0.029, clears **0.14** | no | no: clears 0.14 |
| **GPU>GEM** | no (κ 0.44) | **yes: miss 0.077 [0, 0.17], clears 0.48** | no | no: miss **0.095** |
| TR (reported) | no (κ 0.37) | no: clears 0.31 | no | no |

**6. Cost per call, per tier** (`cost.json`). Tokens are the mean per call, from agy's usage on every verdict row. Thinking is counted inside output.

| tier | input | output (of which thinking) | cache read | list cost ratio to low | **$ per call** | $ per judgement | default-pool week per call (noisy) |
|---|---|---|---|---|---|---|---|
| Flash low | 13,667 | 689 (193) | 6,570 | 1.00 | $0.00055 | $0.00057 | 2.2e-5 (james pool, not comparable) |
| Flash medium | 17,481 | 12,424 (12,124) | 3,659 | **4.50** | **$0.00248** | $0.00248 | 3.4e-5 |
| Flash high | 18,427 | 28,798 (28,498) | 2,252 | **9.15** | **$0.00503** | $0.00505 | 6.6e-5 |
| Opus (brief's figure) | | | | | | $0.0022 | Claude week |

- On the one pool both new arms ran on, the quota per call is high/medium = 1.95, against a token-cost ratio of 2.03. So the pricing method agrees with the meter where the two can be compared.
- Low ran on a different login, so its quota figure cannot be compared with the others.

**Whole library, 237K judgements.**
- Opus alone: about **$520** (the brief's ~$515, 11 account-weeks).
- Flash low alone: $134. It fails (#7807).
- Flash medium alone: $588. Flash high alone: $1,197. Both fail as judge in every stratum, and both cost more than Opus.
- **The one passing option, a medium screen with Opus on the pages it fails, on GPU>GEM:** $0.00248 + 0.52 × $0.0022 = **$0.0036 a page**. Applied to every judgement, that is about **$860**, 65% more than Opus alone. A screen saves money only when it is cheaper than the judge it screens for, and medium is not.

### Recommendation for judging every book (#7896)

- **Opus alone, as now: 5 pages a book, about $520.**
- No Flash tier passes as the judge, and the one screen that passes costs more than it saves.
- **Worth knowing for the book-page wording:** at medium and high, Flash finds failures that stored Opus passed. The adjudicator sided with medium on about half of its extra rejections, so "checked by Opus" is a pass rate with real misses in it (`quality-statements.md`). A cheap way to use that is a medium second opinion on Opus *passes*, on a sample. That is not tested here.

**Artifacts** are in `scripts/eval/judge-compare-7611/results/2026-11-01/`, beside #7807's `2026-10-30/`:
- `verdicts-flash-{medium,high}{,-repeat}.jsonl.gz`;
- this run's 67 adjudications (`adjudications.jsonl.gz`; to re-score, append them to 2026-10-30's);
- `score.json`, `cost.json`, and `runs.json` with the quota readings.

The texts stay in job scratch, as before. #7807's `texts.json.gz` is also at R2 `sl-corpus-snapshots/cold/xfer/flash-judge-tier-7611/judge-compare-7611-texts.tar.gz`.
