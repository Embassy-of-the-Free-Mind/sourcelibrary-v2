# Pre-registration — does translation survive the Batch API? The continuity question

_Written 2026-09-17, **before any paid run**. Issue: to be filed. Harness:
`scripts/eval/translation-batch-continuity-ab.mjs` (to be written, extending
`translation-prompt-ab.mjs`). The decision rule below is fixed now so it cannot be
chosen after seeing the numbers._

PRIOR ART: `PREREGISTRATION-translation-prompt-v15.md` (house format, paired arms,
one-page-per-book, blinded judge packet as a separate gate — all reused);
`scripts/eval/translation-prompt-ab.mjs` (the draw/run/score/judge-packet harness this
extends — its estimand is a note-verification RATE on single pages, which cannot see a
cross-block effect, so the unit changes from page to BOUNDARY); `lib/paired-stats.mjs`
(`diffCI`, `binomTwoSided`) and `lib/sampling.mjs` (`sampleOnePagePerBook`) are used, not
reimplemented. Checked and rejected: `qa-eval.mjs` (no arm concept),
`scripts/eval/translation-model-ab` work of 2026-09-13 (model arms, not context arms).

## The decision this changes

One binary: **move production translation from the realtime API to the Batch API, or
leave it.** Batch is exactly 50% of realtime list price. Translation is the largest
realtime lane we run — `worker/hetzner-translate-batch` billed $133.36 over
2026-09-01..15, about $267/mo, and it is realtime despite the name
(`scripts/workers/translate-worker.mjs:855` logs `mode: 'realtime'`).

## What batch actually costs us — stated precisely, because it is narrower than it sounds

The worker translates in blocks of 8 pages (`BATCH_SIZE`, line 56). All 8 pages go into
**one** prompt, so pages inside a block share context. The Batch API preserves that
exactly — a block is one request either way.

The only thing batch loses is the **cross-block continuity seed**: production prepends
the first 2,000 characters of block k−1's *freshly translated output* to block k's prompt
(lines 330–338). Under batch every block is submitted at once, so block k cannot see
block k−1's output. Note that the seed for the **first** block is read from the database
(lines 631–638) and is therefore still available in batch.

**So the loss is one page transition in eight.** Any effect must be found at that seam or
it does not exist. A design that samples random pages cannot see it — this is why the
unit here is a BOUNDARY, not a page.

## Arms

Paired: all arms translate the **same** blocks, same model (`gemini-3.1-flash-lite`, the
production translation route), same prompt, same block size 8.

- **A — chained** (production today): block k seeded with block k−1's fresh output.
- **B — unseeded** (naive batch): block k with no continuity seed.
- **C — source-seeded** (batch-compatible): block k seeded with the OCR **source text**
  of block k−1's last page. This is available before any translation runs, so it works
  under batch. C exists so that a loss under B does not end the enquiry.

Block k−1 is translated once and shared by all three arms; only block k is re-run.

## Hypotheses and outcomes

- **H1 (primary, objective).** Cross-boundary **terminology consistency**: for content
  terms whose source form occurs in both block k−1 and block k, the English rendering in
  block k matches the rendering block k−1 used. B is not worse than A by more than **5
  percentage points** (paired, `diffCI`).
- **H2 (co-primary, blind judge).** At the junction — last page of block k−1 followed by
  first page of block k, concatenated with no marker — a blind judge is asked which of two
  continuations reads as the same translator continuing. A is preferred over B **no more
  often than 60/40**. Left/right randomised per pair; the key is withheld from the judge.
- **H3 (regression floor).** B does not lose content: body length not more than 10% below
  A, and no increase in invented or housekeeping tags (reuse the v15 scorers).
- **H4 (the fallback arm).** If B fails H1 or H2, C is tested against A on the same two
  outcomes with the same margins.

The null that matters: **continuity may be buying nothing.** Seven of eight transitions
already keep their context, and the seed is a 2,000-character prefix of a *previous*
page, not a glossary. "It obviously helps" is not a result; neither is "batch is cheaper".

## Decision rule — fixed now

1. **B passes H1, H2 and H3** → migrate translation to the Batch API with no continuity
   seed. Expected saving ~$130/mo at the 2026-09 run rate.
2. **B fails, C passes** → migrate to batch with the source-text seed (arm C).
3. **Both fail** → do not migrate; report the measured quality cost of the 50% saving and
   let Derek weigh it. Quantified refusal is a result, not a failure.

An amendment to this file after the run must be logged at the bottom with its date and
reason, per house convention.

## Population and sample

Books the production pipeline would translate, with at least 16 consecutive translatable
pages (`translatablePageFilter()` from `scripts/lib/translate-core.mjs`) so that a real
block boundary exists. **One boundary per book** — pages within a book share a hand, a
scan and a vocabulary, so they are one observation (`sampleOnePagePerBook` discipline).

**n = 60 books**, stratified by source language in proportion to the live translation
queue. Drawn and pinned to `results/translation-batch-continuity-sample.json` **before**
any arm runs.

## Cost — estimated before the run, per the house rule

Measured production rate: $133.36 for 85,590 pages = **$0.00156 per page translated**.
Per book: 1 block (k−1, shared) + 3 blocks (k, one per arm) = 4 blocks = 32 pages.
60 books × 32 pages × $0.00156 = **$3.00**. Judge gate is Claude, not metered Gemini.

**Ceiling: $5.** If a run would exceed that, stop and report rather than continue.

## Where it runs

**Hetzner, not the laptop** — paid Gemini is geo-blocked here, and this is the standing
rule for every paid eval. `set -a; source .env.production.local; set +a` with semicolons.

## What it must not do

**It writes nothing to `pages`.** Every translation produced here is eval output and
lands in `scripts/eval/results/`, never in the corpus. The translate worker's write path
is not called; only its prompt construction is reused. A page in the sample must come out
of this experiment byte-identical to how it went in.
