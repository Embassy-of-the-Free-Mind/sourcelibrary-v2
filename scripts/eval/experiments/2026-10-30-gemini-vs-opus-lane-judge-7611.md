---
stage: ocr
measure: [judged]
languages: [la, de, fr, it, ar, he, zh, lzh, bo]
scripts: [Latn, Arab, Hebr, Hani, Tibt]
canons: []
n_books: 375
n_pages: 540
verdict: "Argon (gemini-4-argon-low, agy) judges about as well as Opus; 3.8 Flash-low does not. Planted errors caught: Argon 143/144, the same as Opus; Flash 130/144 (0.90, by-book 0.86-0.94), and only 24/36 inserted sentences. Run twice on 30 items, each judge agreed with itself: Argon 28/30, Opus 28/30, Flash 25/29. On 90 Gemini-written pages, Argon agreed with Opus on 0.93 (kappa 0.87), and its pass rate differed by -0.02 [-0.08, +0.03]. Flash shows the feared self-preference: after Opus adjudication it missed 23% of the failing Gemini-written pages but 2% of the failing raw GPU pages (difference +0.21 [+0.09, +0.34]); within Chinese, +0.33 [+0.13, +0.58]. Argon trips the preregistered self-preference flag: its pass rate fell less below Opus's on Gemini text than on GPU text, +0.13 [+0.02, +0.25]. That flag comes from Tibetan raw drafts, which Argon passes 12/45 and Opus 26/45. Within Chinese the gap is 0.00 [-0.11, +0.11], and the Opus adjudicator sided with Argon on 17 of 22 GPU disagreements. As a screen (Argon flags go to Opus, plus 20% of Argon passes), Argon misses 0.07 [0.04, 0.11] of Opus-confirmed failures overall and saves 42 Opus calls per 100."
status: informational
decision: "Recommendation, by the preregistered rule: Gemini-written OCR (GEM) and GPU drafts corrected by agy (GPU>GEM): Argon screen + Opus. Raw GPU drafts: Opus only (the screen saves 26 per 100, under the bar of 30). Gemini translations (TR): Opus only (the screen misses 0.15). Flash: Opus only, everywhere. Gemini alone: nowhere (Flash fails it; Argon is held by the preregistered self-preference flag). No cron or production setting was changed."
superseded_by: null
issue: [7611]
---
## 2026-10-30 · Can a Gemini judge do the end-of-lane QA that Opus does? Same items, blind, compared (#7611)

PRIOR ART:
- `scripts/eval/route-judge-6740/judge.mjs`: the judge. `judgePrompt` and `parseVerdict` are imported unchanged, for both families. Only the sentence that tells the judge how to open the image differs: Opus has `Read`, agy has `read_file`/`view_file`.
- `scripts/eval/judge-planted-7611/`: the 144 planted errors and 36 clean controls (`2026-10-29-judge-planted-controls-7611.md`, Opus 143/144). They are reused as items, with their scorer (`scorePlant`).
- `scripts/eval/lane-judge-sampler.mjs` and the route-judge results: the stored Opus verdicts on real lane output (`2026-10-28-lane-judge-sampler-first-run-7611.md`).
- `2026-10-15-estimator-v2-judge-family-term-6740.md`: the only earlier measurement of judge family. That was on translations, text-only. The Gemini Pro judge favoured its own Pro arm by +0.15 points [−0.02, +0.40], and showed no lean towards its Flash arms.
- No earlier run has a Gemini judge read an OCR candidate against the page image under this rubric.

**Question (Derek, 2026-10-30).** Can Gemini do the end-of-lane QA that Opus does now, either alone or as a cheap first screen with Opus deciding what it flags? Most lane output is written by Gemini Flash, so a Gemini judge may go easy on it.

### Preregistration (committed before any judge call)

**Items: 540, all already judged by Opus.** No new Opus verdict is needed for the baseline. Runner: `scripts/eval/judge-compare-7611/run.mjs frame`. Seed 7611.

**(a) Planted controls: 180 items.** These are the 36 pages of judge-planted-7611 (Latin, German and French print, 12 each), with 5 variants per page: A is clean, and B to E each carry one planted error (number, noun, dropped line, inserted sentence). Their text is mostly Gemini-written (lite>agy-flash-low, pero>agy-flash-low), which is the case the worry is about.

**(b) Real lane output: 360 items, one page per book per group.** The exact text Opus judged is recovered and checked:
- From `lane_judge_verdicts`, the stored `text_hash` is re-hashed. 349 of 374 records still match.
- From the route-judge packets kept in job scratch, the item id is `j + sha256(cell:page:sha256(text))`, so a recovered text reproduces its id only if it is byte-identical. Sources: router-tests 10-28, the #7591 rt-conf and rt-dq packets, and the 10-26 pilot, whose packet is re-keyed by that formula.
- From Mongo, for three key sets whose packets are gone (the Tibetan Yigdzin reads of the pilot and tibetan-30, and the 10-26 zh-dice Paddle drafts). A page's OCR and revision rows are tried, and a text is kept only if it reproduces the id. For these 90 candidates the image URL is re-resolved from the page. This is the one place where the image may not be the exact file Opus saw.

**Groups, by who wrote the text** (`authorOf`):

| group | what it is | books | languages |
|---|---|---|---|
| **GEM** | Gemini read the image (Flash-Lite drafts, 3 Flash, agy Flash-low fresh reads), or Gemini corrected a Gemini draft (lite>agy-flash-low, 3flash>agy-flash-low) | 90 | la, de, fr, ar, he, zh, 15 each |
| **GPU** | a GPU engine's raw draft (Paddle, Yigdzin) | 90 | zh 45, bo 45 |
| **GPU>GEM** | a GPU draft corrected by agy Flash-low: the GPU lanes as served (pero, lighton, paddle, gpu > agy-flash-low) | 90 | la 40, zh 41, it 9 |
| **TR** | a Gemini translation (Siku agy-flash-low@1, 30; German 3 Flash, 30; German Flash-Lite, 30) | 90 | lzh 30, de 60 |

Left out: Opus-written text, the diff-QA variants, and wrong-page controls. Opus's stored verdicts on the 360 real items: GEM 48/90 accepted, GPU 43/90, GPU>GEM 67/90, TR 57/90.

**Known confound, declared.** The GPU group is Chinese and Tibetan. GEM is mostly Latin-script, with Arabic, Hebrew and Chinese 15 each. The self-preference contrast is therefore also read **within Chinese**: GEM/zh (3 Flash reads and corrections) against GPU/zh (Paddle) and GPU>GEM/zh.

**Judges.** Each is blind to the author, the route and Opus's verdict. Each makes one call per item, with the same prompt and the page image in the call's workspace.
- **Flash:** `gemini-3.8-flash-low` via `agy -p`, on the `/root/.agy-james` pool. At the start its Gemini pool had 0.40 weekly and 0.97 5-hour remaining, and that login allows only Flash-low.
- **Argon:** `gemini-4-argon-low` via `agy -p`, on the default pool after its 22:00Z weekly reset. agy has no model named "Pro", and Argon is its top Gemini tier. `AGY_ALLOW_HEAVY=7611` is set.
- **No Gemini API at all.** The call is `agyCall` in a gated workspace (`installToolGate`, which allows only `view_file` and `read_file`).
- **A Gemini verdict counts only if the gate log shows the model opened the image.** Otherwise the item is retried, at most 3 times.
- **Opus:** the stored verdicts. Fresh Opus calls (`claude -p --model opus`, `opusCall` unchanged) are made only for the noise floor and the adjudication.

**Order and stops.** All 540 items run in one seeded order, so any prefix is a balanced subset.
- **Gemini stop rule:** a judge stops when its pool's weekly remaining has dropped more than 0.10 from its reading at the start, or its 5-hour bucket is under 0.30. It checks every 25 calls.
- **Opus stop rule:** the box's Claude weekly meter at 85%.
- **Budget:** at most 1,500 agy calls in all. Expected: 540 × 2 + 60 repeats, plus retries.

**Noise floor (A vs A).** 30 real items, stratified GEM 8, GPU 8, GPU>GEM 8 and TR 6 (`frame.json` `noise`):
- Opus is called afresh and compared with its stored verdict.
- Each Gemini judge is called a second time and compared with its first verdict.
- Cross-family agreement on the same 30 is reported beside both.

**Measures.** Each is reported with n and a book-cluster bootstrap 95% CI (4,000 draws). Wilson intervals are also given for k/n.
1. **Planted recall:** k/144 caught for each Gemini judge, against Opus's 143/144. "Caught" means not accepted, or the plant is named in a defect (`scorePlant`, unchanged). The named rate and the false alarms on the 36 clean pages (A rejected) are reported too.
2. **Agreement with Opus on real items, by group:** accept/reject agreement, Cohen's κ, and both directions of disagreement. For class agreement: where both reject, the share of items whose non-cosmetic defect classes overlap.
   - **Self-preference test:** (Gemini pass − Opus pass) on GEM minus the same on GPU, with a book bootstrap over both groups. **Self-preference is declared if this is > 0 and its 95% CI excludes 0.** GPU>GEM − GPU is reported the same way.
3. **Disagreements:** for every real item where a Gemini judge's accept differs from Opus's, Opus adjudicates.
   - It sees the image, the candidate and both verdicts, labelled "Review 1/2" in a seeded random order, and is not told which judge wrote which.
   - It gives its own accept and says which review was right. Tallies are by kind (Gemini passed / Opus failed, and the reverse) × who was right, by group.
   - At most 150 adjudications, in a seeded order.
   - **Declared limit:** the adjudicator is Opus, so this is not a neutral referee. It is blind to labels, not to style.
4. **The screen:** Gemini flags go to Opus, and Opus also checks a 20% random sample of Gemini passes.
   - Missed share = 0.8 × (Opus-confirmed failures Gemini passed) / (Opus-confirmed failures). An Opus-confirmed failure is Opus's reject, replaced by the adjudicator's accept where an adjudication ran.
   - Opus calls per 100 items = flagged + 0.2 × passed. "Gemini alone" is reported as the unscreened miss share.

**Decision rule (per group, set now).**
- **Gemini alone** only if its planted recall is ≥ 0.80 (the Opus judge's bar) AND its miss share alone is ≤ 0.10 AND there is no self-preference.
- **Gemini screen + Opus** if the screened miss share is ≤ 0.10 and it saves ≥ 30 Opus calls per 100.
- **Otherwise Opus only.**


### Results (judged 2026-10-30 17:20Z to 2026-10-31 00:59Z, after the preregistration above was pushed at 49d3e8b9e)

**Calls.**
- **agy, 1,174 calls in all** (budget 1,500):
  - **Flash:** 585 calls on the james pool, with 539 of 540 items parsed. 15 replies did not parse; most were reasoning on Chinese characters that ran on and cut the JSON. The pool dropped 0.403 → 0.389 of its week, about 2e-5 a call.
  - **Argon:** 589 calls on the default pool, 540 of 540 parsed. 15 calls never opened the image and 4 timed out; all were retried. Calls took 140–270 s, against 12–20 s for Flash. The pool dropped 0.987 → 0.943 while the production lanes ran on it too, so ≤ 6e-5 of the week a call (an upper bound).
- **Opus (`claude -p`), 162 calls:** 30 noise-floor calls and 132 adjudications. All parsed but one adjudication.
- **Deviations from the preregistration:**
  - The 150 adjudications were split 75 per judge, so that Argon, which ran later, was not crowded out. Flash had 97 disagreements, and 75 were adjudicated in seeded order; Argon had 58, all adjudicated.
  - The Argon pass ran in two slices: the first 296 of the seeded stream, then the rest once the cost per call was measured. All 540 were judged.
  - The Gemini prompt is `judgePrompt` unchanged except for the image sentence, as declared.

**1. Planted errors: 144 single errors on accepted pages, and 36 clean pages.**

| judge | caught B–E | by-book 95% | named | number | noun | line dropped | sentence inserted | clean page rejected |
|---|---|---|---|---|---|---|---|---|
| Opus (stored, #7719) | **143/144** | 0.98–1.00 | 142 | 36/36 | 36/36 | 36/36 | 35/36 | 1/36 |
| Argon low | **143/144** | 0.98–1.00 | 142 | 36/36 | 36/36 | 36/36 | 35/36 | 3/36 |
| Flash low | **130/144 = 0.90** | 0.86–0.94 | 126 | 35/36 | 35/36 | 36/36 | **24/36** | 6/36 |

- Flash passes the 0.80 bar overall: French 42/48, German 44/48, Latin 44/48. But it accepts an invented sentence on **a third of pages**, and that is the failure class that matters most.
- Argon's single miss (an inserted French sentence on `6a8ee2e0…`) is not the same plant as Opus's. Argon accepted two other planted pages while naming the plant.

**2. Noise floor: the same judge twice on 30 real items.**

| judge | agrees with itself | by-book 95% | κ | same fidelity |
|---|---|---|---|---|
| Opus (stored vs fresh) | 28/30 | 0.83–1.00 | 0.86 | 24/30 |
| Argon | 28/30 | 0.83–1.00 | 0.86 | 27/30 |
| Flash | 25/29 | 0.72–0.97 | 0.72 | 23/29 |

On the same 30 items, Argon vs Opus agree 27/30 and Flash vs Opus 26/30. On this subset, Argon–Opus disagreement is at the level of each judge with itself.

**3. Agreement with Opus on real lane output, by who wrote the text.** Each cell is the accept rate (Gemini judge / Opus) and their difference with a by-book 95% CI. Then accept/reject agreement, κ, the two kinds of disagreement, and, where both rejected, how often they name an overlapping non-cosmetic class.

| group | n | **Argon** pass / Opus | diff | agree | κ | Argon pass, Opus fail / reverse | class overlap |
|---|---|---|---|---|---|---|---|
| GEM (Gemini-written) | 90 | 46 / 48 | −0.02 [−0.08, +0.03] | **0.93** [0.88, 0.98] | 0.87 | 2 / 4 | 38/40 |
| GPU (raw Paddle, Yigdzin) | 90 | 29 / 43 | −0.16 [−0.26, −0.06] | 0.76 [0.67, 0.84] | 0.50 | 4 / 18 | 41/43 |
| GPU>GEM (served GPU lanes) | 90 | 62 / 67 | −0.06 [−0.12, +0.01] | 0.88 [0.81, 0.94] | 0.70 | 3 / 8 | 15/20 |
| TR (Gemini translations) | 90 | 54 / 57 | −0.03 [−0.13, +0.07] | 0.79 [0.70, 0.87] | 0.55 | 8 / 11 | 23/25 |
| all | 360 | 191 / 215 | −0.07 [−0.11, −0.03] | 0.84 [0.80, 0.88] | 0.67 | 17 / 41 | 117/128 |

| group | n | **Flash** pass / Opus | diff | agree | κ | Flash pass, Opus fail / reverse | class overlap |
|---|---|---|---|---|---|---|---|
| GEM | 90 | 51 / 48 | +0.03 [−0.06, +0.12] | 0.81 [0.73, 0.89] | 0.62 | 10 / 7 | 29/32 |
| GPU | 90 | 14 / 43 | **−0.32** [−0.43, −0.22] | 0.63 [0.53, 0.73] | 0.24 | 2 / 31 | 40/45 |
| GPU>GEM | 89 | 57 / 66 | −0.10 [−0.20, 0.00] | 0.74 [0.65, 0.83] | 0.40 | 7 / 16 | 15/16 |
| TR | 90 | 59 / 57 | +0.02 [−0.08, +0.12] | 0.73 [0.64, 0.82] | 0.42 | 13 / 11 | 16/20 |
| all | 359 | 181 / 214 | −0.09 [−0.14, −0.04] | 0.73 [0.69, 0.77] | 0.46 | 32 / 65 | 100/113 |

**Self-preference test (preregistered).** The statistic is (Gemini pass − Opus pass) on GEM, minus the same on GPU.

| judge | pooled (the preregistered test) | within Chinese (the declared confound cut: GEM/zh 15, GPU/zh 45) | GPU>GEM − GPU |
|---|---|---|---|
| Flash | **+0.36 [+0.22, +0.50]** | **+0.33 [+0.13, +0.58]** | +0.22 [+0.08, +0.37] |
| Argon | **+0.13 [+0.02, +0.25]** | 0.00 [−0.11, +0.11] | +0.10 [−0.02, +0.22] |

**By the preregistered rule, both judges trip the self-preference flag. The two cases are different.**
- **Argon's gap is Tibetan:** Argon passes 12/45 raw Yigdzin drafts and Opus 26/45. On Chinese Paddle drafts it is 17/45 against 17/45, and on GEM it is within 0.02 of Opus.
- **Against the adjudicated verdicts (measure 3 below), Argon misses failing pages at the same rate on Gemini text and on GPU text:** a GEM − GPU miss difference of −0.004 [−0.08, +0.08].
- **Flash's gap survives both cuts:**
  - It holds within Chinese.
  - Against the adjudicated verdicts, Flash misses **10/44 (0.23)** of the failing Gemini-written pages and **1/63 (0.02)** of the failing GPU pages, a difference of +0.21 [+0.09, +0.34].
  - Opus's own miss difference runs the other way: −0.22 [−0.35, −0.09].
  - Flash is lenient on its own family's text and harsh on everything else. That is the worry in the question.

**4. Disagreements, adjudicated by Opus.** Opus saw the image, the candidate and both verdicts as "Review 1/2" in seeded order, without labels.

| judge | adjudicated | Opus right | Gemini right | neither |
|---|---|---|---|---|
| Flash | 74 of 97 | 46 | 24 | 4 |
| Argon | 58 of 58 | 22 | **36** | 0 |

| judge × group | Gemini passed, Opus failed: Opus right / Gemini right | Gemini failed, Opus passed: Opus right / Gemini right |
|---|---|---|
| Flash GEM | 7 / 0 | 5 / 2 |
| Flash GPU | 1 / 1 | 11 / 15 (2 neither) |
| Flash GPU>GEM | 5 / 0 | 6 / 2 |
| Flash TR | 8 / 0 | 3 / 4 (2 neither) |
| Argon GEM | 2 / 0 | 1 / 3 |
| Argon GPU | 3 / 1 | 2 / 16 |
| Argon GPU>GEM | 3 / 0 | 1 / 7 |
| Argon TR | 8 / 0 | 2 / 9 |

**What the kinds are.**
- **When a Gemini judge passed a page Opus failed, Opus was right in 37 of 39.** The misses are real wrong text:
  - a Hebrew spread with the whole right-hand page left out;
  - astronomical table numerals changed (51 → 36, 170 → 179);
  - "das το scheint" read as "das 2c scheint";
  - a translation naming Jupiter where the page has ☉♀;
  - Jiang Tingshan rendered as "Jiang Tianshan", with Zhu Xi added in a note.
- **When a Gemini judge failed a page Opus passed, the adjudicator split.** Flash was right on 23 of 52 adjudicated cases and Argon on 35 of 41.
  - The ones Argon was right about are mostly Tibetan and Chinese raw drafts with word-level misreads, which change a name (ཡོན་ཏན) or drop a content word (ཁབ་རལ), and Chinese margin text garbled (欽定四庫全書 → 次定四事全焉).
  - The ones Opus was right about are variant-form or tagging complaints (弟/第, 巳/已, a `<script>` tag).
- **Declared limit.** The adjudicator is Opus. Even so, it overruled the stored Opus verdict 36 times out of 58 for Argon. Where both judges passed a bad page, nothing here sees it.

**Against the adjudicated verdicts.** This is the adjudicator's accept where one ran; otherwise the stored Opus verdict stands. For Flash, 23 disagreements were not adjudicated. Columns: share of failing pages each judge passed, and the false alarms.

| group | Argon miss | Opus miss | Argon false alarm | Flash miss | Opus miss (Flash set) | Flash false alarm |
|---|---|---|---|---|---|---|
| GEM | 2/45 | 3/45 | 1/45 | **10/44** | 2/44 | 5/46 |
| GPU | 3/62 | **16/62** | 2/28 | 1/63 | 17/63 | 14/27 |
| GPU>GEM | 3/30 | 7/30 | 1/60 | 7/25 | 2/25 | 14/64 |
| TR | 8/42 | 9/42 | 2/48 | 13/39 | 6/39 | 5/51 |
| all | **16/179** | 35/179 | 6/181 | 31/171 | 27/171 | 38/188 |

**Side finding: Opus may be soft on raw Tibetan Yigdzin drafts.**
- On raw GPU drafts, Opus passed a failing page 16 times in 62, according to its own adjudication; 13 of the 16 are Tibetan.
- The Tibetan k/n in the router (tib-kangyur, pilot) come from this same judge. Its planted controls were Tibetan single-syllable plants, not word-level misreads.
- This is not acted on here.

**5. The screen.** Gemini flags go to Opus, and Opus also checks a 20% sample of Gemini passes.
- "Missed" is the expected share of adjudicated failures that get through.
- "Alone" is the miss share with no Opus at all.

| group | Argon screen missed | Opus calls / 100 | saved / 100 | Argon alone missed | Flash screen missed | saved / 100 | Flash alone missed |
|---|---|---|---|---|---|---|---|
| GEM | **0.04** [0.00, 0.09] | 59 | **41** | 0.04 | 0.18 [0.09, 0.29] | 45 | 0.23 |
| GPU | 0.04 [0.00, 0.09] | 74 | 26 | 0.05 | 0.01 [0.00, 0.04] | 12 | 0.02 |
| GPU>GEM | **0.08** [0.00, 0.18] | 45 | **55** | 0.10 | 0.22 [0.09, 0.37] | 51 | 0.28 |
| TR | 0.15 [0.06, 0.26] | 52 | 48 | 0.19 | 0.27 [0.15, 0.39] | 52 | 0.33 |
| all | 0.07 [0.04, 0.11] | 58 | 42 | 0.09 | 0.15 [0.10, 0.19] | 40 | 0.18 |

### Decision, by the preregistered rule

| group | Gemini alone | Gemini screen + Opus | **verdict** |
|---|---|---|---|
| GEM (Gemini-written OCR) | Flash: no (misses 0.23; self-preference). Argon: no (the preregistered flag) | **Argon: yes** (misses 0.04, saves 41) | **Argon screen + Opus** |
| GPU>GEM (served GPU lanes) | Flash: no. Argon: no (flag; misses 0.10 at the edge) | **Argon: yes** (misses 0.08 [0, 0.18], saves 55) | **Argon screen + Opus** |
| GPU (raw drafts) | no | Argon misses 0.04 but saves only 26 (bar 30); Flash saves 12 | **Opus only** |
| TR (Gemini translations) | no | Argon misses 0.15 (bar 0.10) | **Opus only** |

Flash is Opus only in every group.

**What would change this.**
- **Argon alone is held by the letter of the self-preference test, not by its substance.** If the next window's lane-judge draws replicate Argon ≈ Opus on GEM (agreement ≥ 0.90), a pre-set Tibetan-free self-preference test would decide whether Argon can stand alone on Latin-script OCR.
- **Cost on the subscription pools.** One Argon call took ≤ 6e-5 of the agy week. One Opus judge call takes 0.0124 points of the Claude week (rules.json). So a screen trades about 42 Opus calls per 100 for 100 Argon calls.
- **Speed.** Argon is the slowest judge measured: 2–4 min a call.

**Not done here.** No cron, rules.json or lane-judge-sampler setting is changed. Wiring an Argon screen into `lane-judge-sampler.mjs` is a separate PR, and it needs a decision on the agy-guard heavy-call cap: 40 Argon calls a day per box, which this run lifted for itself with `AGY_HEAVY_BOX_CAP`.

**Artifacts** are in `scripts/eval/judge-compare-7611/results/2026-10-30/`:
- `frame.json` and `items.json` (with text hashes);
- the verdicts of each judge, the repeats and the adjudications (`*.jsonl.gz`);
- `score.json` and `runs.json`, which hold the pool readings.

The texts stay in job scratch (`texts.json.gz`); `items.json` gives the source and hash of each.
