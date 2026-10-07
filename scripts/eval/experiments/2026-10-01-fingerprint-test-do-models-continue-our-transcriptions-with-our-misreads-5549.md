## 2026-10-01 · Fingerprint test: do models continue our transcriptions with OUR misreads? No signal, and no power to show one: our served text postdates every model's cutoff, and the models do not reproduce even the Archive's pre-cutoff misreads (#5549)

**Question.** A canary GUID is weak evidence (§3.4). A misread that exists only in our served text is a natural fingerprint. Given the words before it, does a model continue with our misread rather than the printed reading?

**Design.** `measure: agreement` with our text. It is never a quality claim. Misreads were taken only from adjudicated sources:
- **ours** (13 items, 9 books). (a) The #5224 numbers fixture: `printed` was read blind from the image, and the place was located in the *served* `pages.ocr` text (read-only Mongo, 2026-10-01). We kept the items where the served text differs from the print and the Archive's text does not have the same wrong value (6 items). (b) The #5313 by-eye anchors, where the reader named the served letter's reading and the image's reading (7 items, copied by hand into `EYE` with the anchor quoted). Three Japanese anchors dropped out because those pages were re-OCR'd after the eye check.
- **ours-shared-with-archive** (9 items, 5 books): served misreads that are also in the Archive's own text, because we serve the Archive's OCR for that book.
- **archive-control** (46 items, 20 books): the **positive control**. These are the Archive's confirmed number misreads, continued from its `_djvu` text. That text has been public on archive.org since 2008–2025 (42 items before the models' cutoffs). If a model has memorised any OCR text, this is the most likely place.
- Each prompt gives the 40 words before the misread (80 characters for CJK) and asks for a verbatim continuation of 15 words. Scoring compares the first tokens with our misread, then with the printed reading. Temperature 0, one item per Gemini call. Models: `gemini-3.1-flash-lite`, `gemini-3-flash-preview` (both through `gemini-script-client`, thinking off), and **Claude Haiku via subscription subagents** (the box's API key returns 401). Rates are given with Wilson and book-cluster bootstrap intervals.
- **Exclusions, decided after the first pass (both are instrument findings):**
  1. **Split numbers**, where one value contains the other. The Archive writes `1916` as `19 16`, so the prefix already holds `19` and continuing `16` is forced. 14 items were dropped.
  2. **Sequence-predictable misreads.** The value is last + 1, last + the last step, or already in the prefix (`52. … 53.`). We report these separately rather than drop them.

**Result.**

| arm (band) | n (books) | Lite: our misread / printed | Flash: our misread / printed | Haiku: our misread / printed |
|---|---:|---|---|---|
| ours, all (all public 2026-02 → 09, **after** every cutoff) | 13 (9) | 3 / 1 | 3 / 0 | 3 / 0 |
| ours, misread not sequence-predictable | 9 (8) | **0** [0–30%] / 0 | **0** [0–30%] / 0 | **0** [0–30%] / 0 |
| ours-shared-with-archive (after cutoff; 7 public < 30 days) | 9 (5) | 0 / 1 | 0 / 3 | 0 / 1 |
| archive-control, before cutoff | 42 (18) | 2 / 13 | 0 / 13 | 2 / 5 |
| archive-control, before cutoff, **not predictable** | 36 (17) | **1 (2.8%)** [0.5–14%] / 11 (31%) | **0** [0–10%] / 11 (31%) | **0** [0–10%] / 5 (14%) |
| archive-control, after cutoff | 4 (2) | 0 / 0 | 0 / 0 | 0 / 0 |

- **Every "hit" on our own text is a list the model can predict from the prefix**: `36. → 37.`, `52. … 53.`, `74. → 75.`. On those pages the served text misread `87`, `89` and `58` (confirmed on the #5224 crops) into the sequential number. A model with no exposure produces the same value. These texts became public after all three cutoffs (Gemini 3.x January 2025; Haiku 4.5 February 2025), so the 3/13 is the **chance floor** of this instrument and not a training signal.
- **The positive control does not fire.** On 36 unpredictable Archive misreads that were public for 1–17 years before the cutoff, the models reproduced 1, 0 and 0 of them. They recovered the *printed* number on 5–11 of the 36 (for example the abjad value of Nun, or a sequence of years), which is general knowledge and prior, not recall of this document. A single crawled copy of an obscure OCR page is not memorised verbatim by these models at a level this test can see.
- **Our own corpus cannot carry the signal for these models yet.** Every served misread we found went public in 2026, after the models' cutoffs. The issue's 30-day band is therefore the wrong cut: the useful negative control is publication after a model's training cutoff, and for every current model that covers all our text.
- **Instrument finding: packet leakage.** The first Haiku pass gave each subagent 40 items, including several from the same page. Haiku copied later items' prefixes, which carry the misread (`1312, April 28`), into earlier items' continuations, and scored 6/36 "unpredictable hits". Re-run with no two items from one book in a packet, it scored 0/36. Any batched-subagent arm must keep sibling items apart. The v1 outputs are kept as `v1-leaky-continuations-claude-haiku.jsonl` and are not scored.

**What this does not cover.** Larger models (Opus, Gemini Pro, GPT-class), which memorise more. Text published before the cutoffs. Repeated exposure, since one page crawled once is the weakest case. Sampling with temperature > 0, or prompts with a title or attribution. The sample is far below the issue's 50 books, because only 13 adjudicated misreads in our served text are unique to us. We do not invent misreads.

**When to re-run.** Re-run when a model whose training cutoff falls after a corpus batch went public is released (Gemini or Claude with a 2026 cutoff): the same items and `--stage=gemini`, about $0.02. To have power, it needs ≥ 50 unpredictable unique misreads. The cheapest source is the #5224 disagreement set extended to `ours` pages served for ≥ 6 months before the new cutoff.

*Grade.* Exploratory (9 books ours, 20 control). `run_id` fingerprint-5549-2026-10-01. *Decision.* None. No routing, field or publish rule changes. §3.4 still calls fingerprint tests "the stronger detector". This run says they are unpowered for now. The correction is proposed in the PR, because the doc edit was not permitted from this session. *Replicated?* No. Haiku ran twice, but the first run was leaky. *Cost.* Gemini $0.023 (about 170 realtime calls, `gemini_usage` endpoint `eval/fingerprint-5549`). Haiku ran on the subscription (11 subagents). Mongo was read-only. *Artifacts:* `scripts/eval/fingerprint-5549.mjs`, `results/fingerprint-5549-2026-10-01/` (README, items, drops, continuations per model, scores, report). This run is not in the eval store or the dashboard, because it scores exposure, not an engine against a reference.
