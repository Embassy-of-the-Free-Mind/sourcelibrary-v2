# Pre-registration — prompt ablation: do required metadata fields cost transcription accuracy?

_Written 2026-07-29, **before any paid run**. Issue #3444. Analysis implemented in
`report-ablation.mjs`; runner in `prompt-ablation.mjs`. The point of writing this first
is that the decision rules cannot be picked after seeing the numbers._

## Question

Our OCR prompt asks one model call to transcribe a page **and** emit structured
metadata. Two things are unknown:

1. **Does the metadata request degrade the transcription?** (If yes, the metadata
   should move to a second call and we should pay for it.)
2. **Does making a field REQUIRED actually make it fire?** (Every optional
   difficulty signal we have is near-absent — see below.)

The paper plan (`.claude/docs/ocr-memorization-paper.md`) lists the first as an open
contribution: *"the effect of annotation-format prompts on OCR character accuracy —
the dossier found no existing study; unclaimed territory worth a subsection."*

## Why now — the measurements that motivate it

| signal | coverage (n=4,000 OCR'd pages) |
|---|---|
| `<script>` | 7.3% (and 287 of 293 say `printed`) |
| `<warning>` | 3.8% |
| `pages.scan_quality` | 1.5% |

And the sharpest form, from the occlusion pilot (result 13): **1 of 28 runs mentioned
a mask covering 25% of the page.** Models transcribe straight through it.

All three signals are optional. The hypothesis is that optionality, not capability, is
the binding constraint.

## Design

Four arms, same pinned ground-truth passages, same image bytes per page:

| arm | prompt | purpose |
|---|---|---|
| **A** | transcribe-only, no tags | accuracy ceiling |
| **B** | the live production prompt | today's baseline |
| **C** | B + provenance grouping + **required** `<page-conditions>` | the proposal |
| **D** | A for text, then a second classify-only call | interference control |

Models: `lite` (gemini-3.1-flash-lite, the bulk lane), `flash` (gemini-3-flash-preview,
the BPH lane), and `lite35` (gemini-3.5-flash-lite) if budget allows. Two runs per cell.

An occluded replicate (`--occlude=x,y,w,h`, masks reused from
`occlusion-v2-masks-2026-07-24.json`) tests flag firing where we already know the
ground truth about what the model should notice.

**Scoring parity:** all arms are scored after stripping annotation tags, so arm A
(which emits none) and arm C (which emits many) are compared on the text alone.

**Does this match production?** Yes for OCR — verified in the worker code, not
inferred from usage rows. `scripts/workers/pipeline-orchestrator.mjs:1655` builds each
request as `parts: [{ text: prompt }, { inlineData: image }]` — **one prompt, one
image**. The constants `OCR_INLINE_BATCH_SIZE` (20), `OCR_FILE_BATCH_SIZE` (1000) and
`CROSS_BOOK_BATCH_SIZE` (250) are how many *requests* are bundled into a Gemini **batch
job**, never how many pages go into a prompt. So OCR grouping buys throughput and the
50% batch discount, and **never context**.

**Translation works differently, and the contrast matters.**
`scripts/workers/translate-worker.mjs:44` sets `BATCH_SIZE` to 8 by default and sends
all 8 pages in one call (`remaining.slice(0, batchSize)`), *plus* the previous page's
translation prepended for continuity (line 301). The usage rows confirm real multi-page
prompting: `page_count: 8` at 6,796 input tokens = **850 tokens/page against 2,224 for a
single-page translation call — 2.6× cheaper per page.**

**So OCR has no cross-page context at all, and translation does.** That asymmetry is a
live question this ablation does NOT answer and must not be read as answering: a
marginal note running across a page break, a hyphenated word split over a leaf, a table
continuing overleaf, or a running header the model has seen 200 times are all invisible
to a single-image OCR call. Ars Astronomica batches 4 pages for exactly this reason.
**"Does OCR page-grouping improve accuracy or marginalia capture?" deserves its own
experiment** — it is a different intervention from the metadata fields tested here, and
confounding the two would make both uninterpretable.

Remaining caveat: **realtime vs batch.** This harness uses realtime calls.
`scripts/experiments/batch-size-experiment.mjs` lists RECITATION rate among the things
it measures, so batch-mode behaviour should not be assumed identical — do not
generalize these results to the batch lane without checking.

**Metering caveat.** 6,960 batch-OCR rows covering 376,804 pages record
`input_tokens: 0` and `cost_usd: 0.00`, while 5,454 batch rows do carry tokens. Any
"what did OCR cost" figure drawn from `gemini_usage` is therefore an undercount, and the
per-page cost table below is derived from **realtime** rows only. Tracked separately.

## Hypotheses and decision rules — fixed in advance

**H1 — required fields fire.** Arm C emits `<page-conditions>` on ≥95% of runs.
→ *If <95%, the mandatory framing does not work and the whole proposal fails.*

**H2 — the flag is not vacuous.** On clean baseline pages arm C returns `none` on
≥50% of runs; on occluded pages it returns `obscured` on ≥80%.
→ *A model that flags everything has produced a useless signal. Both halves must hold.*

**H3 — accuracy tolerance.** Arm C's char-weighted accuracy is **no worse than 1.0pp
below arm A**, per model.
→ *Larger than 1.0pp means the metadata request is eating the transcription, and the
answer is arm D (a second call) despite the ~63% input surcharge.*

**H4 — no interference.** Arm C ≥ arm D − 1.0pp on accuracy.
→ *If D beats C by more than 1.0pp, one call is doing two jobs badly. Ship two calls.*

**H5 — required beats optional.** Arm C's marginalia flag rate exceeds arm B's
`<script>`-style signal rate by a wide margin (B's baseline is 3.8–7.3%).

## Cost

Measured medians from `gemini_usage` (single-page OCR, n=1,500): **3,272 input / 444
output tokens.** Input is 7.4× output and the page image dominates it — which is why a
second call is expensive: it re-sends the image.

| approach | added input | delta |
|---|---|---|
| inline required field | ~160 tok | **+5%** |
| separate call | ~2,070 tok | **+63%** |
| separate call, Batch API | same tokens at 50% off | +32% |

Per-page cost at measured token counts, by model:

| model | $/page | vs lite |
|---|---|---|
| gemini-3.1-flash-lite | $0.00038 | 1× |
| gemini-3.5-flash-lite | $0.00209 | 5.5× |
| gemini-3-flash-preview | $0.00297 | 7.9× |
| gemini-3.6-flash | $0.00824 | 21.8× |

Note **3.5-flash-lite is not a cheaper flash-lite** — it is 4× the input and 8× the
output price of 3.1-flash-lite. "Lite" names a size, not a price tier.

Run the estimator before spending: `node scripts/eval/prompt-ablation.mjs --dry-run --models=… --only=…`

## Threats to validity, named in advance

- **Ground-truth pages are canonical by construction.** Reference etexts exist for
  texts models have memorized, so accuracy on this set is an upper bound and the
  canonical/non-canonical split must be reported separately. This is the reflexive
  problem the memorization paper is about; it is not solved here.
- **Arm A has no page-structure instructions**, so its "ceiling" may be inflated on
  simple pages and depressed on multi-column ones (no `<column-break/>` guidance).
  Report reading-order failures separately rather than folding them into accuracy.
- **Flag rates on 44 pinned pages do not estimate corpus prevalence.** They test
  whether the mechanism fires, not how often each condition occurs.
- **A single model family.** Gemini-only results may not transfer to Claude-based
  lanes; treat any conclusion as scoped to the production models.
- **The occluded replicate uses masks chosen for a different study.** They target
  reference passages, which is right for fill-in but arbitrary for flag firing.

## Pre-committed reporting

Every arm and every hypothesis gets reported **whether or not it supports shipping**,
including a null result. If H1 fails, that is the finding and the prompt change does
not ship. Raw model outputs are the durable artifact
(`results/ablation-outputs-<date>.jsonl`) so scoring can be redone offline.

**Blog post is conditional on the result, not on the direction.** A clean null ("making
fields required does not help, and here is what we measured") is publishable and more
useful to other projects than silence.
