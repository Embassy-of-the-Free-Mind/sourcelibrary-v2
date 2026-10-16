# PREREGISTRATION — seam prompt candidate on the #6742 300-junction set (#6742, job seam-prevent)

PRIOR ART: `PREREGISTRATION-translation-restraint*.md` (#5349: "stop where the page stops", judged on page-level
invention, null), #5675 (seam lines alone, null on block-door invention), #5678 (folio markers, p 0.105). Those judged
invention or seam defects on the paid flash-lite lane. This one judges the production CLI lane (Gemini 3.8 Flash low via
`agy`, prompt v13, single page) with the #6742 join judge. Committed before any arm runs.

## Who this is for

Readers turning pages. #6742 measured 31% of served prose joins defective. The nightly lean runner repairs the
backlog; this asks whether new translations can be made with fewer broken joins.

## The change under test

`candidate.mjs` `withSeamRule(v13)`: one instruction (`1a`) inserted after v13's instruction 1. It names the three edge
shapes the pilot found: an ellipsis at the foot or head of a page, a sentence closed that the source carries on, and a
catchword rendered. Nothing else in the request changes.

## Arms (one page per call, the production request)

- **P**: production. `buildTranslationPrompt` (translate-core) with the v13 default, `PAGE_BREAK_SCOPED`, neighbour OCR,
  plus the CLI suffix (`TRANSLATE_SUFFIX`), through `gatedTextCall`, model `gemini-3.8-flash-low`: the request
  `cli-translate.mjs` and `stale-retranslate-6567.mjs` send.
- **P2**: production again, an independent sample: the A-vs-A floor.
- **C**: the same request with the base prompt replaced by `withSeamRule(v13)`.

Per junction (N, N+1), each arm translates page N seeded with the STORED translation of N−1 (as the writers seed when
nothing is read yet), then page N+1 seeded with that arm's own read of N (as `cli-translate.mjs` seeds in sequence).

## Sample

The 300 junctions of `scripts/eval/results/seams-6742/` (one per book; 254 Latin script, 46 other scripts). Planted
items are re-translated from the stored OCR like any other (their planted break was in the stored English only). A
junction is dropped before any call if N or N+1 is no longer translatable (`isTranslatablePage`, `sameLanguageReason`);
the count is reported. A junction where any arm's read fails after the runner's retries is reported as a failure and
dropped from the paired comparisons.

## Measures

**Join judge (primary).** The blind pairwise Opus judge of `judge-repairs.mjs` (`JUDGE`, `pairText`), as
`seam-repair.mjs verify` runs it: excerpts of ≤ 1,500 characters at the turn (sources from the current OCR via
`sourceProse`, English via `translationProse`), both orders in different calls, 10 pairs per call. Comparisons: **C vs P**
and **P2 vs P**, plus 20 byte-identical pairs in both orders (judge floor).
- A version is **defective at the join** when the judge flags it (`X_defect`) in BOTH orders.
- Primary: Δ = defect rate(P) − defect rate(C), paired by junction, in the C-vs-P comparison.
- Floor: the same Δ for P vs P2 in the P2-vs-P comparison.

**Whole-page fidelity (guard).** A seeded half of the junctions (150), one page each (N or N+1, seeded coin). The blind
Opus judge sees the full source page and two full translations (`<summary>`/`<keywords>` removed) and says which is the
more faithful and complete translation of the whole page (omissions, additions, mistranslations), or tie. Both orders,
different calls, 5 pairs per call. Comparisons C vs P and P2 vs P, plus 10 identical pairs.

## Decision rule (fixed now; eval-design §10.2, card 3)

**Ship C** (a migration script in a `tier:hold` PR; the flip is Derek's) only if ALL hold:

1. **Effect:** the 95% book-bootstrap interval of Δ (10,000 resamples, seed 6742) excludes 0; Δ lies outside the
   P2-vs-P 95% interval; and Δ ≥ 8 per 100 joins (the card's minimum effect for a rate).
2. **Script groups:** Δ has the same sign in Latin script and in other scripts (46 junctions; directional only).
3. **Whole-page non-inferiority:** L − W, where L is the share of pages on which P is preferred in both orders and W the
   share on which C is, has an upper 95% bound (bootstrap) ≤ **0.10** (margin-v1), and the point estimate ≤ the
   P2-vs-P value + 0.05.
4. **Guards:** C's failed reads ≤ P's + 2; median whole-page English length C/P ≥ 0.95.
5. **Judge:** identical pairs called tie ≥ 80%.

If 1 fails with the guards holding: **no measurable effect**, not shipped. If 1 holds and a guard fails: **effect with a
cost**, not shipped, reported with both numbers.

## Not covered

- A translation regression set (#5913) does not exist yet; none is run. The candidate carries no specimen text, so the
  example-text lint (#5686) has nothing to catch.
- Block-door lanes (the Batch chained lane, flash-lite) are not measured; a shipped prompt would reach them too, so the
  PR names that.
- Opus is the reference, not ground truth; no image check.

## Budget

agy (subscription, $0): ≈ 300 × 2 pages × 3 arms = 1,800 calls at 4 in flight, paused on lockout. Claude CLI
(subscription, $0): ≈ 124 join-judge calls + ≈ 124 page-judge calls.
