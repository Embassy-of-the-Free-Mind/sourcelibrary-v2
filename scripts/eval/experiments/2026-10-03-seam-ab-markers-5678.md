## 2026-10-03 · Page breaks where the sentence runs on: is the chained lane's defect the model or the forcing, and do folio markers fix it on Lite? (#5678)

**Question.** The chained Batch lane (Flash-Lite) writes one self-contained `<translation page="N">` per page. Where
the source sentence runs on to the next page, it closes, duplicates or imports text at the break. Is that the model
(Lite vs Flash), or the forcing of each page to stand alone? And do continuous English with `<pb n="N"/>` markers
(#5682, flag off) fix it on cheap Lite?

**Design.**
- Pre-registered in `PREREGISTRATION-seam-ab-markers.md`, with two amendments, both before judging.
- The frame is chained-lane pages, one per book, Latin-script books not used by #5305. Each was screened by eye on
  the source before any output existed, keeping:
  - **100 true mid-sentence breaks**;
  - **20 closed breaks** as controls.
- Every arm translates the same block (N, N+1) through production's door: v13, the stored seed of N−1,
  `PAGE_BREAK_SCOPED`, Batch, thinking 0. The arms are:
  - A: production Lite;
  - A2: production Lite again, the noise floor;
  - B: Lite + markers;
  - C: Flash + markers.
- Judging used 8 blind Opus judges, 2 per break, with every arm's turn shown side by side. They flagged
  duplication, forced closure, edge omission and words moved, and could call a tie. 32 plants and 8 repeats were
  mixed in.
- Spend: $0.848.

**Result.**

| | A | A2 | B (Lite + markers) | C (Flash + markers) |
|---|---:|---:|---:|---:|
| Real seam defects, registered literal parse | 21 | 26 | 28 | 18 |
| Same, read positionally (post hoc) | 21 | 26 | 15 | 8 |

- **The registered rule says UNRESOLVED.** As shipped, the marker parse fails on 22 of 120 Lite blocks and 13 of
  120 Flash blocks. The model numbers the markers with the printed `<page-num>` (`<pb n="97"/>` for sequence page
  21), and Lite also often omits the opening marker.
- **Read by position, the answer is MODEL** (post hoc):
  - Flash + markers 8 vs production 21: 5 vs 18 discordant, p 0.005.
  - Flash + markers 8 vs Lite + markers 15: 2 vs 9, p 0.033.
  - Lite + markers 15 vs 21: 5 vs 11, p 0.105, just missing the 0.10 bar against a noise floor of 5.
- **By kind (A / A2 / B / C):**
  - forced closure: 12 / 15 / 6 / 1;
  - duplication: 5 / 8 / 1 / 0;
  - ≥6 words moved: 6 / 9 / 5 / 5.

  Removing the forcing halves closures and nearly removes duplication on Lite. Flash is what stops the closures
  that English word order invites: in "viri, feminae eum … quotdiebus | execrantur", Lite pulls the verb onto
  page N.
- **Controls stay clean once read positionally:** 1 / 1 / 0 / 0.
- **Judges:** plants caught 32 of 32; inter-judge agreement 475 of 480; repeats 59 of 64.

**Replicated?** No. This is one run. The direction matches the unpaired 3.18% vs 1.26% (#3918), but there is no
Flash arm without markers, so the model effect alone is not isolated.

**Artifact.** `scripts/eval/results/seam-ab-5678/` (README, report.json, verdicts) and the harness
`scripts/eval/seam-ab-5678.mjs`. Before any marker adoption, the marker numbering needs a fix: either sequence
numbers in the prompt or a positional parser.
