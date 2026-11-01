---
stage: ocr
measure: [judged]
languages: [la, de, fr, it, ar, he, zh, lzh, bo]
scripts: [Latn, Arab, Hebr, Hani, Tibt]
canons: []
n_books: 375
n_pages: 540
verdict: "Preregistered 2026-11-01; no judge call made yet. Results follow below the preregistration."
status: undecided
decision: "Owed: which Flash thinking tier (if any) can judge or screen stored transcriptions for every live book (#7611, #7896)."
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
