# Routing eval — engine-contest-5870 (#5870)

measure: judged against a human reference: two blind Opus judges score the Lite (prompt v13) English made from each engine's read, fidelity 1–5, source = the by-eye corrected transcription; not accuracy.

| group | pages (with text) | label yes / text [Wilson 95 %] | catastrophic flash / kraken | rate difference [95 %] | by eye: wins / losses | invented by candidate | **translation-lift-v1** |
|---|---:|---|---|---|---|---|---|
| greek-print-le1699 | 11 (11) | — | 5 / 3 | — | pending | — | a ✗ b ✓ → **undecided: interval wider than the margin at this n (Flash stays)** |
| arabic-script-print | 15 (15) | — | 1 / 7 | — | pending | — | a ✗ b ✗ → **Flash re-read** |

## Negative control

A candidate inferior by construction: it fails every page the baseline fails, plus a further 20 % of the pages (at least 2). A rule must refuse it; one that does not has no power at this n.

| group | translation-lift-v1 |
|---|---|
| greek-print-le1699 | 10 failures against 5; fidelity: 3 pages set to 1, Δ -0.955 [-1.727, -0.273] → refused ✓ |
| arabic-script-print | 11 failures against 1; fidelity: 3 pages set to 1, Δ -1.567 [-2.067, -1.033] → refused ✓ |

## Translation lift against a human reference

Mean judge fidelity (1–5) of the Lite English made from each engine's read; Δ = candidate − baseline, paired by page, seeded bootstrap. Passes when the lower bound is at or above −margin.

| rule | group | n | candidate | baseline | Δ [95 %] | better / same / worse | margin | passes for any margin ≥ |
|---|---|---:|---:|---:|---|---|---:|---:|
| translation-lift-v1 | greek-print-le1699 | 11 | 3.5 | 3.273 | 0.227 [-0.318, 0.727] | 7 / 1 / 3 | 0.25 | 0.318 |
| translation-lift-v1 | arabic-script-print | 15 | 2.3 | 3.633 | -1.333 [-1.8, -0.833] | 1 / 2 / 12 | 0.25 | 1.8 |
