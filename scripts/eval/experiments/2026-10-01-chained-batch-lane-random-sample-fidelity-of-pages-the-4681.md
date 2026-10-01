## 2026-10-01 · Chained Batch lane: random-sample fidelity of pages the lane wrote (#4681)

- **Question.** What is the judged defect rate of pages the chained Batch translation lane wrote, and do block-first (seam) pages do worse?
- **Design.** 75 books, 60 seeded / 15 seam (one page per book), weighted by the lane's page count per language; Claude Opus judge (`JUDGE-PROMPT.md`), 15+15+15 blinded controls. `measure: judged`.
- **Result.** Controls pass: swap 15/15, drop 15/15, repeat 15/15 within one (13/15 exact). Post-stratified: fidelity ≥ 4 **85.4%** (81.5–88.6), any major defect **6.9%** (3–11.7), omission 3.9% (0.8–7.9), invention 6.6% (2.7–10.6). Seam split (raw): seeded ≥ 4 88.3% (53/60), major 11.7% (7/60), omission 8.3%, invention 13.3%; seam ≥ 4 93.3% (14/15), major 13.3% (2/15), omission 0%, invention 6.7%. Comparison: the seam stratum's major-defect rate (13.3%, n=15) is below the 38% device-break rate (2026-09-25 round 4); the seeded stratum (11.7%) sits beside the 2026-09-30 corpus audit's 14.4%. With n=15 the seam CI is wide. A text-only judge cannot see a wrong leaf (#4790).
- **Replicated?** No, first run.
- **Artifact.** `scripts/eval/results/translation-corpus-audit-chained-2026-10-01/` (report.md, seam-split.json).
