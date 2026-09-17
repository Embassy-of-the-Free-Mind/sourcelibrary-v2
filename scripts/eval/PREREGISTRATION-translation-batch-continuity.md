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

### 2026-09-17, after the draw and before any paid call — n is 58, not 60

The Chinese stratum gave 4 of its 6 boundaries after six rounds and was not padded from
another language. 209 candidate seams were rejected, by reason, in the pinned sample
file: 103 had an untranslatable page inside the 16-page window, 44 had a block over
20,000 OCR chars, 38 had a seam page under 400 chars of prose, 12 opened block k on a
heading, 7 ran off the book, 4 had a non-prose seam page, 1 had a page under 200 chars.
40 of the 58 seams end mid-sentence. Estimated spend from the drawn text: $1.98.
||||||| f90cbd83

### 2026-09-17 — ordering note on Amendment 1 (below)

Amendment 1 was written on the preregistration branch while the A/B/C run was already in
progress on the pinned sample above, and was merged here before any arm output had been
read or scored. It adds rungs D and E beneath C and leaves A, B, C, their margins and their
run order untouched, so it changes nothing about the run it arrived during. If D is ever
needed it reuses the same 58 boundaries and the same shared block k−1.

### 2026-09-17, during the run, before any output was read — a harness control

Not an outcome. 72% of block-k pages already carry a stored translation, but from eight
prompt generations, so they are **not** a scoring reference and no arm is scored against
them. On the subset written by the *current* prompt (matched on prompt hash) and model,
arm A should reproduce production's stored text about as closely as two runs of this
harness reproduce each other. Similarity is word-bigram Dice over reader text. **Pass:**
median sim(A, stored) ≥ 0.75 × median sim(A, B) on the same pages, and above the 95th
percentile of sim(A, another page's stored text). Fewer than 5 such pages is reported as
unmeasurable, not as a pass. A failure invalidates the run. Comparison against *published*
translations was considered and excluded: it is a different estimand (absolute quality,
not production-vs-batch), covered by #4883 and the Tibetan benchmark.

### 2026-09-17, after A/B/C were scored on H1 and H3 — rung D is triggered

B and C both **fail H1** on the pre-registered bound (paired lower bounds −13.9pp and
−10.0pp against a −5pp margin; 17 of 57 boundaries carry an eligible term), so under
Amendment 1 (below) arm D runs on the same 58 boundaries and the same shared block k−1.
Spend so far $1.74; D is estimated at about $0.55, total inside the $5 ceiling. **D,
operationally:** block k−1's last page is sent as the first page of block k's prompt (nine
pages, no seed), its duplicate translation is discarded before scoring, and D is compared
with A on H1, H2 and H3 exactly as B and C are. The H2 judge is still run for A/B and A/C,
because both were pre-registered outcomes and are reported whatever H1 said.

### 2026-09-17, after B, C and D were scored and judged — rung E is triggered, and defined

Results so far, on 57 usable boundaries (one dropped: arm C lost its seam page). H2, blind
judge, A's share with ties split: **B 76.3%, C 64.0%, D 57.9%** against a 60% limit — B
and C fail, D passes. H1: B, C and D all fail the −5pp bound (paired lower bounds −13.9,
−10.0 and −23.5pp), on only 17 boundaries that carry an eligible term. H3 passes for all
three. So B, C and D each fail at least one co-primary and Amendment 1 sends this to E.
Spend so far $2.21; E is one small call per boundary, estimated under $0.25.

**E, operationally** — fixed here, before any E output exists:

- E is a second pass over **the first page of block k only**, starting from arm B's
  output. It is shown the same 2,000-char slice of block k−1's last-page translation that
  arm A is seeded with, the **source OCR** of the seam page (so it has something to verify
  against — the prior against E is a text-only pass that invented), and B's translation of
  that page. It is told to change only what continuity requires and to return the page
  unchanged otherwise. Same model, thinking off. Prompt: `seamRepairPrompt()` in the harness.
- **E's block k = E's page 1 + B's pages 2–8, untouched.** Amendment 1's added outcome,
  "E must not change text outside the seam", therefore holds by construction: E is never
  shown those pages. What is measured instead, and reported, is how much of the seam page
  E rewrote (word-bigram similarity to B's page) and H3 on the repaired page, since
  invention there is the live risk.
- E is compared with A on H1, H2 and H3 with the same margins. H2's A/E packet is emitted
  on its own (`--judge-packet --pairs AE`) so no earlier pair's blinding key moves.

---

## Amendment 1 — 2026-09-17: the seam-repair option, and why it is last

Derek asked whether a second LLM pass could blend the seams and still come out cheaper.
It can. It is still the worst of the four options, and the arithmetic says so before any
judgement is applied.

Measured from `gemini_usage`, September, translation successes with pages and output
(n = 17,308 calls, 110,136 pages): **1,237 input tokens and 757 output tokens per page**,
modelled $0.001445/page against $0.001486 logged — so **output is 79% of the cost**, and
anything that adds output tokens is expensive while anything that adds only input tokens
is nearly free. At the September run rate of ~206,500 pages/month:

| option | $/page | $/mo | vs today | rewrites text? |
|---|---|---|---|---|
| today — realtime, chained | $0.001445 | $298 | — | no |
| **B** plain batch, no seam handling | $0.000723 | $149 | −$149 | no |
| **C** source-seeded (input only) | ~$0.000742 | ~$153 | −$145 | no |
| **D** overlap: re-translate 1 page per 8, discard the duplicate | $0.000813 | $168 | −$131 | no |
| **E** second LLM pass blending seams | $0.000832 | $172 | −$127 | **yes** |

**E is dominated by D.** Overlap costs less *and* gives stronger continuity than a repair
pass: the model sees genuinely adjacent source text inside one prompt and writes the
transition itself, rather than being handed a previous translation and asked to match it.
Nothing already-good gets rewritten.

**And there is a measured prior against E's shape on this stack.** A text-only flash-lite
cleanup pass over OCR was run on 60 pages for $0.076 (`scripts/eval/ia-ocr-cleanup-exp.mjs`,
EXPERIMENTS.md 2026-09-12): it gained +0.02–0.09 agreement, no rejected band reached 0.85,
and **it invented on input it could not read** — an ink-blotted "Toparch" became "Lord of",
and 7 of 8 index author names were fabricated. A seam-blender is the same shape: text in,
text out, flash-lite, rewriting content it cannot verify against a source. The difference
is that here it would be rewriting text that is *already correct*, so every fabrication is
a pure loss with no offsetting gain.

**Therefore the decision ladder is extended, not replaced:**

1. B passes → plain batch. (unchanged)
2. B fails, C passes → source-seeded batch. (unchanged)
3. **C fails, D passes → overlap.** D is added as the third rung because it is cheaper
   than E and carries no rewrite risk. Test D against A on H1 and H2 with the same margins.
4. **All of B, C and D fail → E is the only remaining way to keep the discount**, and it
   is then tested with an added pre-registered outcome: **E must not change text outside
   the seam.** Measure the edit distance between E's output and B's output on pages that
   are not the first page of a block; a pass that edits elsewhere is rejected regardless
   of how the seam reads.
5. Nothing passes → do not migrate; report the cost of the quality.

**Run order is unchanged — A, B, C first.** D and E are contingencies and are only paid
for if the rung above them fails. If B passes, none of this is ever spent.
