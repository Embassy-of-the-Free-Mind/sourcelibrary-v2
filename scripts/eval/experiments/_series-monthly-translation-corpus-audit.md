## Monthly translation corpus audit (#5301) — does the served defect rate move?

One entry for the series, one row per month (newest first); the row is written by the stage-2 routine
(`scripts/eval/translation-corpus-audit/MONTHLY.md`). Design: ~100 books, one interior page each, 15 languages,
post-stratified by live translated pages, no arm quota, fresh seed, 45 blinded controls, Opus subagent judge.
A month whose controls fail gets no row. Baseline is the 2026-09-30 one-off below (311 books, arm-quota draw —
compare with its arm-corrected column: ≥ 4 87.2%, major 14.4%). measure = judged, never accuracy.

| month | books | ≥ 4 % (CI) | ≤ 2 % | any major % (CI) | omission % | invention % | garble % | Latin-script / non-Latin ≥ 4 | controls swap / drop / repeat |
|---|---:|---|---:|---|---:|---:|---:|---|---|
| 2026-10 | 103 | 83.3 (74.5–91.8) | 3.1 | 14.8 (7–24.2) | 12.6 | 14.6 | 9.6 | 87.7 / 76.3 | 15/15 · 15/15 · 15/15 within 1 · draw 2026-10-01, judged late on 2026-10-30 (#5274 wave 2) |
| 2026-09 | 103 | 85.6 (77.4–92.8) | 2.9 | 14.3 (7.4–22.3) | 12.7 | 15.7 | 9.3 | 93.8 / 63.2 | 15/15 · 15/15 · 15/15 within 1 · CI recomputed 2026-09-30, #5373 (was 76.9–93, 7.1–22.5) |
