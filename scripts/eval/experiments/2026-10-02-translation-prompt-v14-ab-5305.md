---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: null
n_pages: 107
verdict: "v14 prompt fails its rule: judged invention 38.3% vs 47.7% (p 0.13, needs <0.10) and controls breach +12 pp; it halves page-boundary invention; Tibetan leaf lines unsupported."
status: rejected
decision: "Not flipped: v14 failed its rule; its seam items re-tested alone also failed (2026-10-03-translation-seam-confirm-5305.md)"
superseded_by: null
issue: [5305, 4523]
---
## 2026-10-02 · Does the v14 candidate translation prompt cut invention, cross-page bridging and seam duplication without raising omission? With a Tibetan multi-leaf stratum (#5305, #4523)

**Question.** The #5305 v14 candidate list (items 1, 3–7 of the 2026-10-02T11:21Z comment, plus the bare continuity
marker #5376 and the #5137 misread line) against the live v13, and on Tibetan EAP frames three leaf lines and a
no-seed sub-arm, because #4523's QA found the commonest defect at the leaf seam. Item 2 (illegible trigger) stayed
with PR #5638.

**Design.** Pre-registered (`PREREGISTRATION-translation-prompt-v14.md`, committed before the draw). Arms v13a,
v13b (A-vs-A noise floor), v14; Tibetan adds v14ns. Chained-lane door (seed + adjacent OCR + `PAGE_BREAK_SCOPED`),
Batch API. 107 pages on Flash-Lite (45 #5274-audit invention/garble pages, 12 Sanskrit, 25 chained-lane page breaks
sent as N+N+1 blocks, 25 clean controls), judged blind by 24 Opus subagent packets (audit rubric + neighbour pages +
invention kind; 16 repeats). 21 Tibetan units on Flash (16 page groups from the #4523 QA, 5 dropped-leaf pages),
read blind by the job against the #4523 answer key. $0.667.

**Result.**
- **#5305 strata, rule output: no measurable effect on judged invention, and a control-guard breach.** Invention
  47.7 % (v13a) / 42.1 % (v13b) / 38.3 % (v14); v14 vs v13a 13 vs 23 discordant, p 0.13 (rule needs < 0.10; noise
  16 vs 22). Omission 15.9 / 15.9 / 14.0 %, fidelity ≥ 4 61.7 / 72.9 / 75.7 %, apparatus omissions 6 / 8 / 8: hold.
  Control invention 24 / 24 / 36 % breaches G3 (+12 pp; six pages, all minor).
- **What v14 does measurably:** removes text from the continuity `<meta>` (32 / 31 / 0 pages, p < 1e-9) and halves
  page-boundary invention (20 / 17 / 8 pages; 16 vs 4 discordant, p 0.012; noise 10 vs 7). On chained-lane page
  breaks, invention 36 / 28 / 16 % (p 0.063). Wrong added facts (item 5), Sanskrit English condensation (item 6;
  only 3 of 12 pages are bilingual), square brackets (item 7) and unmarked open ends do not move.
- **Tibetan, rule output: neither the leaf lines nor no-seed is supported.** Seam defects 3 / 7 / 3 / 3
  (v13a / v13b / v14 / v14ns): the two v13 draws differ by more than any arm does. Guard errors 2 / 2 / 1 / 2.
  Qualitatively, on rNying rgyud Nga p.41 the seed already holds the page's leaf 0; both v13 draws drop that leaf
  (the production dropped-leaf defect), and v14 and v14ns translate it. Line (b) marked the split word རྡོ་|རྗེ་ཅན
  on one draw and not on the other draw of the same prompt. Line (c) did not stop "Upananda" for ཉེ་སྡེ.

**Replicated?** No. One draw per arm; the A-vs-A arm is the only replication, and on Tibetan seams it says
single-draw counts this small are noise.

**Artifact.** `scripts/eval/results/translation-prompt-v14-ab-2026-10-02/` (README, report.json, verdicts,
tibetan-reading.json), harness `scripts/eval/translation-prompt-v14-ab.mjs`. Recommendation and the flip question:
#5305 (Derek's call).
