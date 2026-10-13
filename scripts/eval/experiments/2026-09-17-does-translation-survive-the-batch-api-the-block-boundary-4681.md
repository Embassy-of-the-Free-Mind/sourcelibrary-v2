---
stage: translation
measure: preference
languages: []
scripts: []
canons: []
n_books: 57
n_pages: null
verdict: "Unseeded batch loses to chained production at the block seam 41-11 (blind judge); a one-page seam repair ties production 27-27 at +15% cost; prereg rule fired 'do not migrate'"
status: superseded
decision: null
superseded_by: "2026-09-25-late-seam-fidelity-judge-source-beside-both-translations-gated-4681.md"
issue: [4681, 4905]
---
## 2026-09-17 — Does translation survive the Batch API? The block-boundary continuity A/B (#4681, prereg #4905) — RESULT

**Headline: by the rule as written, nothing passes (rung 5, "do not migrate") — but the
rule's H1 bound turned out to be unreachable, and production run twice against itself
fails it by more than any arm did. What the experiment actually established: the
cross-block seed is NOT buying nothing. A blind judge prefers chained production over
naive batch 41–11 at the seam. A one-page second pass that repairs only the seam page
(arm E) ties production 27–27, touches nothing outside the seam, and costs +15% on top of
batch. Migration is Derek's call; the evidence points at "batch + seam repair", not at
"stay" and not at "plain batch".**

*Question.* Production translates 8 pages per prompt and hands the next block the first
2,000 chars of the previous block's last-page translation. The Batch API (half price,
≈ $149/mo saved) cannot do that. Does anything measurable get lost at that one seam in
eight, and if so what is the cheapest way to get it back?

*Design.* Paired, `gemini-3.1-flash-lite`, production prompts (Standard Translation v13,
English Modernization v1), block size 8, unit = one block BOUNDARY per book. **58
boundaries** (60 planned; Chinese gave 4 of 6) stratified on what production translated
2026-09-01..17: English 23, Latin 16, Chinese 4, Arabic 4, French/Hebrew/German 2 each,
Spanish/Dutch/Tibetan/Greek/Malay 1 each. 57 scored (one lost arm C's seam page). Block
k−1 translated once and shared. Arms: **A** chained (production) · **B** unseeded (naive
batch) · **C** seeded with the previous page's OCR source · **D** previous page re-sent as
an overlap and discarded · **E** second pass repairing B's seam page only. D and E were
added by Amendment 1 and each ran only after the rung above failed.

*The draw is explained, which is how an inert probe is ruled out.* 209 candidate seams
rejected: 103 untranslatable page in the 16-page window, 44 a block over 20,000 OCR chars,
38 a seam page under 400 chars of prose, 12 block k opening on a heading, 7 off the end of
the book, 4 non-prose seam page, 1 page under 200 chars. 40 of 58 seams end mid-sentence.

*Controls.* (1) **H1's probe fires:** real cross-boundary consistency is 73.8% against
3.8% [1.4, 7.1] when the same pages are scored on another same-language book's terms
(CI recomputed 2026-09-30, #5373 — was [1.5, 6.8]).
(2) **The harness runs production's configuration:** on block-k pages already translated
by the current prompt and model, arm A reproduces the stored text as closely as two
harness runs reproduce each other (strict match 8 pages/1 book, 0.986 vs 0.985; looser
version-label match 32 pages/4 books, 0.57 vs 0.70; floor 0.06). Stored translations were
NOT used as a scoring reference — they span eight prompt generations. (3) **Nothing was
written to `pages`:** sha256 over all 928 sample page documents identical before and
after. (4) Positive-control unit tests for the term scorer, the seam filter and the prompt
builder (`tests/unit/translation-batch-continuity-ab.test.ts`).

*Result.*

| arm | H2: judge prefers A / arm / tie | A's share (limit 60%) | H1 whole block k | H1 seam page only | H3 body vs A |
|---|---|---|---|---|---|
| A production | — | — | 73.8% | 72% | — |
| B unseeded | 41 / 11 / 5 | **76.3% FAIL** | 66.7% | 40% | +0.4% |
| C source-seeded | 32 / 16 / 9 | **64.0% FAIL** | 71.4% | 48% | −0.1% |
| D overlap | 30 / 21 / 6 | 57.9% pass | 64.3% | 32% | −2.0% |
| E seam repair | 27 / 27 / 3 | **50.0% pass** | 69.0% | 72% | +0.5% |
| *A2: A run again* | *not judged* | — | *64.3%* | *80%* | *+0.9%* |

- **H1 cannot discriminate at this n, and the rule needed it to.** Only 17 of 57
  boundaries carry a term block k−1 tagged whose source form recurs in block k (42 terms).
  Every arm fails the −5pp paired bound (B −13.1, C −10.0, D −23.9, E −11.8 lower bounds) —
  and so does **A2, production run a second time: −12.0pp [−26.5, −2.0], 0 better / 4
  worse.** A bound that production fails against itself is not a quality bar. A2 was post
  hoc and descriptive; it is the most useful number here for reading the rest.
  (CI recomputed 2026-09-30, #5373 — was B −13.9, D −23.5 and A2 [−25.5, −1.2]; C and E unchanged; every
  arm still fails the bound.)
- **The seam-page column is where the signal is**, and it agrees with the judge: arms that
  see the previous page's *translation* (A, A2, E) sit at 72–80%; arms that do not (B, C,
  D) sit at 32–48%. Seeing the previous page's *source* (C, D) does not carry renderings
  across — which is why D, rated above E before the run, measured below it.
- **H2 is decisive for B.** 41–11 (sign p < 0.001), no left/right bias (25 of 52 LEFT).
  The judge's reasons are concrete: a dangling clause picked up or dropped, "Allah" kept vs
  switched to "God", "powers" vs "faculties", header and gloss conventions.
- **E did not show the invention its prior predicted**, with the source page in the prompt:
  median seam page 96% similar to B's (p10 63%), length ratio 0.997, invented tags
  unchanged, **zero pages outside the seam altered** (by construction: it never sees
  them). One caveat: the A/E judges picked LEFT 34 of 54 — a mild position lean the
  randomised sides mostly cancel, but it makes 27–27 softer than it looks.
- H3 passes everywhere. One outlier worth knowing: a single Arabic boundary under C emitted
  534 `<foreign>` tags; the gate was (correctly) not decisive on one book.

*Decision-rule branch that fired:* **rung 5 — nothing passes; do not migrate; report the
cost of the quality.** Reported as written. The honest reading is that the rule's H1 leg
was mis-specified for n = 17, so E "fails" on a leg production also fails; on the two legs
that can discriminate (H2, H3) **E passes and D passes, B and C fail.** A re-run to confirm
E before shipping it should drop whole-block H1 for the seam-page rate and judge A2 as
well, so H2 has a noise floor too.

*What E costs in production.* A second batch job over one page in eight: measured +15% of
B's spend here at realtime rates. It needs block k−1's output first, so it is a two-stage
batch (translate everything unseeded, then repair seam pages), not a single submission.

*Considered and excluded:* scoring against published translations — a different estimand
(absolute quality, not production-vs-batch), covered by #4883 and the Tibetan benchmark.

*A trap caught in-run:* re-emitting judge packets AB and AC alongside the new AD pair moved
their left/right flips (one seeded stream), so the key on disk stopped matching what the
judges had read — 59 of 114 entries would have been wrong. Caught before any verdict was
scored; packets verified byte-identical to the files the judges read; `--pairs/--only` now
makes emission order-stable.

*Spend:* **$2.72** metered at `eval/translation-batch-continuity` (A/B/C $1.74, D $0.47,
E $0.07, A2 $0.44) against a $3.00 estimate and a $5 ceiling. It counted against the
2026-09-17 daily dial. Judge: 8 blind Claude subagents, not metered Gemini.
*Replicated?* No — single run, k = 1 per arm; A2 is the only replicate and it is why H1 is
read the way it is. *Artifacts:* `translation-batch-continuity-ab.mjs`,
`PREREGISTRATION-translation-batch-continuity.md` (eight dated amendments, each before the
output it governs), `results/translation-batch-continuity-{sample,arms,report-2026-09-17,
judge-packet-*,judge-key,judge-verdicts,harness-control*,e-rewrite}`.
