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

## Amendments

### 2026-09-17, before the draw and before any paid call — operational definitions

Written while building the harness, with no arm output in existence. None of these
changes an arm, a margin or the decision rule; each pins something the text above left
open, so that it cannot be chosen after seeing numbers either.

1. **What the production seed actually is.** The text above says "the first 2,000
   characters of block k−1's freshly translated output". Read against the code, the worker
   overwrites `prevTranslation` once per page as it walks the block, so what reaches block
   k is the first 2,000 characters of block k−1's **last page's** translation. Arm A
   reproduces the code, not the sentence.
2. **Strata come from throughput, not the instantaneous queue.** The live queue held 22
   books (English 15, Tibetan 5, Latin 2) when measured — the daily dial keeps it drained,
   so it cannot define 60-book strata and would say nothing about Chinese or Arabic. The
   allocation is proportional to the 104,008 pages production translated 2026-09-01..17
   (usage rows at `worker/hetzner-translate-batch`, joined to `books.language`): English
   23, Latin 16, Chinese 6, Arabic 4, French 2, Hebrew 2, German 2, and one each of
   Spanish, Dutch, Tibetan, Greek, Malay. **English is kept** (38% of the lane): it runs
   through the same worker as modernization and would move to batch with everything else.
   BPH books are excluded — they are the one route not on `gemini-3.1-flash-lite`.
3. **A seam must be one production could produce, and must be mid-flow.** All 16 pages
   consecutive and translatable, each ≥200 OCR chars and each block ≤20,000 OCR chars
   (below/above those the worker would not send a block of 8). The seam pages must be
   prose by `page_type`, carry ≥400 chars of prose each, block k−1 must not end at a
   section terminator and block k must not open on a heading. Every rejected candidate is
   counted by reason in the pinned sample file. Whether the seam ends mid-sentence is
   recorded and reported as a descriptive subgroup.
4. **H1, operationally.** A *content term* is a `<term>` block k−1 tagged (parsed by
   `parseTranslationTerms`). Its *rendering* is each `/`- or `;`-separated alternative of
   its `<gloss>`, or the term as kept when it has no gloss. It is *eligible* when its
   source form recurs in block k's OCR — so the denominator depends on the shared block
   and the source, never on the arm. It is *consistent* in an arm when block k's
   translation contains every content word of at least one rendering. The per-boundary
   rate is consistent/eligible; boundaries with no eligible term are excluded from H1 and
   counted. **Pass:** the lower bound of the bootstrap 95% CI on the paired per-boundary
   differences (arm − A) is above −5pp. The unpaired `diffCI` is printed beside it; the
   paired interval governs, because the design is paired and `diffCI` resamples the arms
   independently.
5. **H1's positive control.** The same block k is scored against the committed terms of a
   *different* book in the same language. If arm A's real rate is not above that chance
   band, the probe is inert and a null is void — reported as such, not as a pass.
6. **H2, operationally.** The judge sees the last page of block k−1 and two translations
   of the first page of block k, page wrappers and notes removed, left/right randomised
   from the seeded PRNG, the key withheld. Answers LEFT, RIGHT or TIE. A's share is
   (A wins + ½ ties)/n; **pass** at ≤60%. A/C is judged only if B fails.
7. **Arm C's seed** sits in the same prompt slot as production's, same 2,000-char slice,
   labelled "Previous page (untranslated source text) for continuity".
8. **Block k−1** is seeded from the database's existing translation of the page before it
   when one exists, as production's first block is; otherwise unseeded. One retry is
   allowed when a block fails to return its seam page. A boundary whose seam page is
   missing in any arm is dropped and counted, never padded.
9. **The spend is logged to the usage meter** under `eval/translation-batch-continuity`.
   The daily dial sums every row, so this run counts against that day's dial like any
   other spend.
