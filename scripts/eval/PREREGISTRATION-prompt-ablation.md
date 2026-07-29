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

## Design — a 2×2 factorial, plus two reference arms

Two interventions are on the table and they are **crossed, not run separately**. A
factorial costs the same as two one-factor-at-a-time experiments but additionally
recovers the **interaction**, which is the question we would most regret not asking:
*does the required metadata field cost more accuracy when the model is also juggling
four pages?* Run apart, that is unanswerable.

**Factor 1 — prompt:** B (live production) vs C (B + provenance grouping + **required**
`<page-conditions>`).
**Factor 2 — grouping:** 1 page vs 4 pages, target LAST, preceded by its three real
predecessors from the same book.

|  | 1 page | 4 pages |
|---|---|---|
| **B** current | B·g1 | B·g4 |
| **C** required | C·g1 | C·g4 |

Reference arms, **outside** the factorial and always ungrouped so they mean the same
thing in every cell: **A** (transcribe-only — accuracy ceiling) and **D** (A for text,
then a separate classify call — the two-call interference control).

### Why grouping is worth testing at all

Production OCR sends **one image per call** and therefore has **no cross-page context**
— so a marginal note running over a page break, a word hyphenated across a leaf, a table
continuing overleaf, and a running header already seen 200 times are all invisible to
it. Translation, by contrast, sends 8 pages per call *and* prepends the previous page's
translation. Ars Astronomica groups 4 pages for printed books on the same reasoning.
Given marginalia agreement sits at **56.9%** against 87.0% for body text, missing
context is a live candidate explanation.

### Grouped-arm mechanics

The model transcribes **all four pages** (the deployable form — cost amortizes across
pages) and **only the target page is scored**.

**The delimiting convention is copied from the production translation batcher, not
invented for this study.** `translate-worker.mjs:369` asks for **labelled** tags —
`<translation page="491">…</translation>` — and this harness uses the same shape,
`<page n="491">…</page>`. The difference from a bare separator is a correctness one:
a bare delimiter can only *count* segments, so a model that **reorders** pages would
have the wrong segment scored against the target's ground truth with nothing to catch
it — the "paired artifacts must be verified, never assumed" failure, reproduced inside
the instrument meant to detect it. A labelled tag lets the scorer assert that the
segment it scores is the page it thinks it is.

Two failure modes the translation batcher already learned, carried over as **recorded
outcomes rather than silent repairs**:

- **Models renumber pages** (emitting 1..N instead of the real numbers). Production
  falls back to position when the count matches exactly; so does this harness, but it
  records `recovery: byLabel | byPosition | null` per run, because "the model
  renumbers" is a finding about deployability, not an inconvenience.
- **Short pages make the model skip the tags entirely and emit garbage.** Production
  refuses to batch below `MIN_OCR_CHARS_FOR_BATCH`; grouped arms here skip any page
  whose predecessors are under 200 characters, so a known-bad configuration is not
  scored as if grouping had failed on its merits.

Pages with fewer than three real predecessors are **excluded from grouped arms rather
than padded** — a short group is a different treatment.

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

### Grouping factor

**H6 — segmentation is reliable.** Grouped runs yield exactly 4 segments on ≥95%.
→ *Below that, grouping is unusable in production no matter what it does to accuracy,
and H7/H8 are uninterpretable because the scored text is not reliably the target page.*
This is the gate: check it first.

**H7 — grouping does not hurt accuracy.** On segmented runs, `g4` accuracy ≥ `g1` − 1.0pp.
→ *A model attending to four pages may transcribe each less carefully. If it does, that
is the finding and grouping does not ship for accuracy's sake.*

**H8 — grouping helps marginalia.** `g4` marginalia flag rate ≥ `g1`, and cross-page
artifacts (a hyphenated word completed from the previous page, a running header
correctly suppressed) appear more often. **This is the directional hypothesis with the
weakest instrument** — 44 pinned pages were chosen for reference coverage, not for
marginalia density, so a null here is weak evidence of absence and must be reported as
such rather than as "grouping doesn't help."

### Interaction — the reason to cross them

**H9 — no interaction.** (C·g4 − B·g4) ≈ (C·g1 − B·g1), within 1.0pp.
→ *If the required field costs more under grouping, the two interventions compete for
the same attention budget and cannot be shipped together without re-testing. This is
the effect that two separate experiments could not have detected, and the reason for
the factorial.*

**Analysis order is fixed:** H6 gates H7–H9. H1 gates H2 and H5. Report every
hypothesis regardless of outcome.

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
- **The grouped arm confounds context with position.** The target is always last, so
  "grouping helped" could mean the model benefited from three pages of prior text, or
  simply that its output for the final page differs systematically (recency, budget
  exhaustion, drift). Distinguishing them needs a target-first replicate, which is not
  in this run. Do not claim a *continuity* mechanism from a positive H8 alone.
- **Marginalia density is not controlled.** The pinned set was assembled for
  reference-etext coverage. If few of its pages carry marginal notes at all, H8 has
  almost no power and its null says nothing.
- **44 pages is enough for char-weighted accuracy contrasts, not for flag rates.**
  Accuracy aggregates over ~44 passages of real length; a flag rate is 44 Bernoulli
  draws per cell. Treat rate differences under ~15pp as suggestive only.

## Follow-up study (designed, not run): validating the vocabulary itself

This study measures a **firing rate on a sample chosen for something else** — the 44
pinned pages exist for reference-etext coverage. A firing rate tells you neither
precision nor recall, and `marginalia` fired twice in the first 96 rows, so H8 has
almost no power here. That is a sampling limitation, not a data limitation: a bounded
sample of 6,000 OCR'd pages found **24.4% with at least one `<margin>` tag and 12.6%
with three or more.**

**The obvious positive sample is biased and must not be used naively.** `<margin>` in
stored OCR is *itself model output*, so selecting on it selects pages where the model
**already succeeded**. It can measure whether an intervention improves capture relative
to what single-page OCR already found; it structurally cannot surface the pages where
the model missed marginalia entirely — which is the failure that matters.

**The revision corpus supplies an unbiased positive sample.** PR #3273 tracked
marginalia across re-OCR revisions: **kept 19,696 / gained 6,235 / lost 2,477.** The
6,235 *gained* pages are **proven false negatives** — a later pass found marginal text an
earlier pass missed, so presence is established by evidence independent of the run being
scored. The 2,477 *lost* are the mirror case and belong in the same sample as a
stability check.

Design, **reference-free throughout** (capture hypotheses need no ground truth — only
the accuracy hypotheses do), therefore cheap:

| condition | positive sample | negative sample |
|---|---|---|
| `marginalia` | the 6,235 revision-gained pages | pages both passes agree carry none |
| `handwritten` | BPH manuscripts | printed books of the same era |
| `obscured` | the synthetic masks already generated | the unmasked originals |
| `non-latin-script` | known script-tagged books | Latin-script controls |

Outcome is **precision and recall per vocabulary term**, not a firing rate. Terms that
cannot be measured this way, or that score near chance, should be cut from the closed
list before it ships — a vocabulary entry that fires unreliably is worse than its
absence, because downstream consumers will treat it as a signal.

## Pre-committed reporting

Every arm and every hypothesis gets reported **whether or not it supports shipping**,
including a null result. If H1 fails, that is the finding and the prompt change does
not ship. Raw model outputs are the durable artifact
(`results/ablation-outputs-<date>.jsonl`) so scoring can be redone offline.

**Blog post is conditional on the result, not on the direction.** A clean null ("making
fields required does not help, and here is what we measured") is publishable and more
useful to other projects than silence.
