---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: 120
n_pages: 240
verdict: "Folio markers on Lite cut seam defects 26 to 19 per 100 breaks (p 0.105, misses the 0.10 bar; omissions rise); the defect is the model: Flash 16, Flash + markers 11."
status: rejected
decision: "TRANSLATE_FOLIO_MARKERS stays OFF by the registered rule; result used as evidence for Flash routing of the chained lane (#5678)"
superseded_by: null
issue: 5678
---
## 2026-10-04 · Do folio markers go on in the chained translation lane, and is the page-break defect the model or the markers? (#5678)

PRIOR ART: `2026-10-03-seam-ab-markers-5678.md` (#5701: unresolved by its registered rule; read by position, post
hoc, A 21 / A2 26 / Lite + markers 15 / Flash + markers 8, with no Flash arm without markers).
`2026-10-03-folio-positional-parse-5678.md` (#5719: the positional parser, no model run). This entry is the
registered confirmation of both.

**Question.** Where a source sentence runs across a page break, the chained Batch lane (Flash-Lite) closes,
repeats or imports text at the break. Do continuous English with `<pb n="N"/>` markers fix that on Lite well enough
to turn the flag on? And is the effect the model or the markers?

**Design.**
- Pre-registered in `PREREGISTRATION-seam-markers-confirm.md` before the draw, with two amendments, both before
  any output was read.
- A fresh frame: chained-lane pages, one per book, no book from #5701, #5675 or the v14 A/B. Each break was
  screened by eye on the source before any output existed, keeping:
  - **100 true mid-sentence breaks**: 70 Latin script (Latin 68, German 1, Italian 1) and 30 non-Latin (Tibetan
    10, Chinese 10, and 10 in Arabic, Hebrew, Greek, Cyrillic or Devanagari script);
  - **20 closed breaks** as controls (14 and 6).
- Every arm translates the same block (N, N+1) through production's door: v13, the stored seed of N−1,
  `PAGE_BREAK_SCOPED`, Batch, thinking 0. The arms are:
  - A: production Lite;
  - A2: production Lite again, the noise floor;
  - B: Lite + markers;
  - C: Flash + markers;
  - D: Flash without markers (the arm #5701 lacked).
- Marker arms are parsed by the lane's positional parser as on main. A block that leaves a page undrafted is a
  defect by construction.
- Judging used 16 blind Opus judges, 2 per break, with every arm's turn shown side by side and #5701's judge
  text unchanged. 64 plant readings and 16 repeated breaks were mixed in.
- Spend: $1.232.

**Result.**

| | A Lite | A2 Lite again | B Lite + markers | C Flash + markers | D Flash |
|---|---:|---:|---:|---:|---:|
| Real seam defects per 100 mid-sentence breaks (both judges) | 26 | 26 | 19 | 11 | 16 |
| Forced closure | 19 | 17 | 9 | 1 | 11 |
| Duplication | 8 | 7 | 4 | 0 | 3 |
| ≥6 words moved | 10 | 14 | 11 | 9 | 4 |
| Edge omission | 3 | 3 | 6 | 3 | 3 |
| Closed controls with a defect (of 20) | 0 | 1 | 1 | 0 | 0 |
| Blocks with a page left undrafted (of 120) | 0 | 2 | 2 | 0 | 1 |

- **Markers on for the chained lane: NO, by the registered rule.**
  - Lite + markers 19 vs production 26: 8 vs 15 discordant breaks, one-sided p 0.105. The bar was 0.10.
  - The omission guard also fails: edge omissions rise from 3 to 6 on Lite with markers.
  - The flag stays off. No adoption PR was opened.
- **Model or markers: MODEL.**
  - Flash without markers 16 vs Lite 26: 8 vs 18 discordant, p 0.038.
  - Flash + markers 11 vs Lite + markers 19: 5 vs 13, p 0.048.
  - Markers on Flash, 11 vs 16: 7 vs 12, p 0.18. Not shown.
  - Flash + markers vs production: 11 vs 26, 5 vs 20, p 0.002.
- **What markers change is the kind of defect.** On both models they cut forced closures (Lite 19 → 9, Flash
  11 → 1) and duplication (8 → 4, 3 → 0). They do not cut words landing on the wrong page (Lite 10 → 11, Flash
  4 → 9): the model puts the marker a clause early or late. Example, `6a4a4a7e…:3`: Lite with markers set the
  marker 45 words late, after a whole Ovid quotation that belongs to page N+1.
- **Noise.** A and A2 both score 26, but they disagree on 26 breaks, 13 each way. The count is stable; which
  breaks fail is not.
- **Non-Latin script (30 breaks; direction only):** A 10, A2 8, B 7, C 4, D 8. Latin script (70): 16, 18, 12, 7, 8.
- **Parser.** No block numbered a marker by the printed page (23 of 240 did in #5701): the `--- Page N ---`
  wording of #5719 holds. Lite still omitted the opening marker in 6 of 120 blocks, which the positional parser
  reads. 2 Lite + markers blocks left a page undrafted (one unmarked turn, one with four markers for two pages);
  Flash + markers left none.
- **Judges:** plants caught 64 of 64; inter-judge agreement 594 of 600; repeats 158 of 160.

**Three breaks, read against the source.**
- `69b62fca…:195` (Latin): "…fidem nostram, quæ meritum illud firmiter | miter apprehendit." Both Lite draws
  close page N with "which firmly grasps that merit." B, C and D all stop at "which firmly" and open N+1 with
  "apprehends that merit."
- `69b51cd0…:138` (Latin): "…in quibus est possibile sequaces | sequaces principijs & operibus". Only Lite with
  markers fails: "the works of nature and its | principles and works" drops "in which it is possible to follow".
- `69e7ab42…:214` (Tibetan): the page ends on "sngon gyi" (previous). Both Lite draws end "they..." and restart
  "They feel shame"; "previous" is lost. B and C carry "his previous | actions of defiled conduct".

**Replicated?** Partly.
- The Lite marker effect has now been measured twice with the same outcome: 15 vs 21 (5 vs 11 discordant, p
  0.105, post hoc) in #5701 and 19 vs 26 (8 vs 15, p 0.105) here. Each run misses the bar by itself. Pooled post
  hoc (13 vs 26, p 0.027) the direction is real, but that pooling was not registered and the first run's reading
  was post hoc.
- The model effect replicates: Flash + markers beat Lite + markers in both runs, and here Flash beats Lite
  without markers too.
- Post hoc, pooling both models: marker arms 30 defects vs page arms 42 (15 vs 27 discordant, p 0.044).

**What this cannot say.** Opus judges' flags on a window around the turn, not accuracy. Two-page blocks only.
The non-Latin stratum is 30 breaks. Where the source has no word spaces the "≥6 words moved" rule counts
characters or syllables, which makes it stricter for Chinese: `6a3c5fcd…:10` is flagged for six characters moved
though the English reads cleanly.

**Artifact.** `scripts/eval/results/seam-markers-confirm-5678/` (README, report.json, verdicts) and the harness
`scripts/eval/seam-markers-confirm-5678.mjs`.
