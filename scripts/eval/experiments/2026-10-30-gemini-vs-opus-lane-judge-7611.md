---
stage: ocr
measure: [judged]
languages: [la, de, fr, it, ar, he, zh, lzh, bo]
scripts: [Latn, Arab, Hebr, Hani, Tibt]
canons: []
n_books: null
n_pages: 540
verdict: "PREREGISTERED, not yet run."
status: informational
decision: "None yet. No cron or production setting changes from this experiment."
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

### Results

Pending.
