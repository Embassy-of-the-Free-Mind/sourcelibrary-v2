# Gemini re-judge of wave 2 — analysis (2026-11-01)

measure = `judged`; rates of BOOKS (one interior page each), post-stratified by language × model arm unless marked "lang". Opus and gemini-flash-low verdicts are wave 2's; the others are this run's.

## Gate (score.mjs --gate)
| judge | swap ≤2 | drop → omission | repeat within one | pass |
|---|---|---|---|---|
| opus | 15/15 | 14/15 | 15/15 | PASS |
| gemini-flash-low | 15/15 | 15/15 | 13/15 | FAIL |
| gemini-3.8-flash | 15/15 | 15/15 | 15/15 | PASS |
| gemini-4-argon-medium | 5/5 | 5/5 | 5/5 | FAIL |

## Headline per judge (only a passing judge's rates are corpus estimates)
| judge | gate | n | ≥4 | major | ≥4 (lang) | major (lang) | fidelity 5 (raw) | wrong leaf |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| opus | PASS | 365 | 86.3% (81.3–90.9) | 13.6% (9–18.7) | 87.1% (82.7–91.1) | 12.8% (8.9–17.1) | 49.9% | 6 |
| gemini-flash-low | FAIL | 365 | 90.3% (85.6–94.1) | 8.7% (5.1–13.1) | 91.3% (87.8–94.5) | 7.9% (4.9–11.2) | 71.8% | 5 |
| gemini-3.8-flash | PASS | 365 | 90.4% (86–94.1) | 9% (5.4–13.4) | 91.1% (87.5–94.2) | 8.6% (5.5–12.2) | 60.5% | 4 |
| gemini-4-argon-medium | FAIL | 25 | raw 56% | raw 40% | — | — | 20% | 3 |

Opus − gemini-flash-low (paired bootstrap): ≥4 -4 pp [-9.1, 1.4], major 4.9 pp [0.2, 9.6]  
Opus − gemini-3.8-flash (paired bootstrap): ≥4 -4.1 pp [-9.3, 0.5], major 4.6 pp [-0.1, 9.3]

## α Opus vs gemini-flash-low — all (365 books)
exact 61.4%, within one 96.2%, mean(Opus − gemini-flash-low) -0.255

- fidelity (ordinal): α 0.53 [0.44, 0.61], 365 books — not settled
- fidelity_ge4 (nominal): α 0.53 [0.39, 0.65], 365 books — not settled
- major_defect (nominal): α 0.52 [0.38, 0.65], 365 books — not settled
- omission (nominal): α 0.53 [0.40, 0.65], 365 books — not settled
- invention (nominal): α 0.50 [0.34, 0.64], 365 books — not settled
- ocr_misread (nominal): α 0.54 [0.44, 0.64], 365 books — not settled

## α Opus vs gemini-flash-low — no_spread (335 books)
exact 60.6%, within one 95.8%, mean(Opus − gemini-flash-low) -0.257

- fidelity (ordinal): α 0.54 [0.45, 0.63], 335 books — not settled
- fidelity_ge4 (nominal): α 0.52 [0.39, 0.65], 335 books — not settled
- major_defect (nominal): α 0.51 [0.39, 0.64], 335 books — not settled
- omission (nominal): α 0.54 [0.41, 0.66], 335 books — not settled
- invention (nominal): α 0.52 [0.36, 0.66], 335 books — not settled
- ocr_misread (nominal): α 0.53 [0.42, 0.63], 335 books — not settled

## α Opus vs gemini-flash-low — subset (25 books)
exact 12%, within one 44%, mean(Opus − gemini-flash-low) -0.16

- fidelity (ordinal): α 0.10 [−0.31, 0.42], 25 books — not settled
- fidelity_ge4 (nominal): α −0.11 [−0.50, 0.25], 25 books — not settled
- major_defect (nominal): α −0.10 [−0.50, 0.28], 25 books — not settled
- omission (nominal): α 0.35 [−0.08, 0.72], 25 books — not settled
- invention (nominal): α 0.20 [−0.23, 0.60], 25 books — not settled
- ocr_misread (nominal): α 0.45 [0.06, 0.76], 25 books — not settled

## α Opus vs gemini-3.8-flash — all (365 books)
exact 70.1%, within one 98.4%, mean(Opus − gemini-3.8-flash) -0.129

- fidelity (ordinal): α 0.68 [0.61, 0.74], 365 books — tentative
- fidelity_ge4 (nominal): α 0.71 [0.60, 0.81], 365 books — tentative
- major_defect (nominal): α 0.70 [0.59, 0.81], 365 books — tentative
- omission (nominal): α 0.69 [0.58, 0.78], 365 books — tentative
- invention (nominal): α 0.52 [0.36, 0.65], 365 books — not settled
- ocr_misread (nominal): α 0.61 [0.51, 0.70], 365 books — not settled

## α Opus vs gemini-3.8-flash — no_spread (335 books)
exact 70.1%, within one 98.2%, mean(Opus − gemini-3.8-flash) -0.131

- fidelity (ordinal): α 0.69 [0.62, 0.77], 335 books — tentative
- fidelity_ge4 (nominal): α 0.70 [0.59, 0.80], 335 books — tentative
- major_defect (nominal): α 0.70 [0.59, 0.80], 335 books — tentative
- omission (nominal): α 0.69 [0.58, 0.78], 335 books — tentative
- invention (nominal): α 0.56 [0.41, 0.71], 335 books — not settled
- ocr_misread (nominal): α 0.61 [0.52, 0.70], 335 books — not settled

## α Opus vs gemini-3.8-flash — subset (25 books)
exact 48%, within one 92%, mean(Opus − gemini-3.8-flash) -0.28

- fidelity (ordinal): α 0.76 [0.47, 0.89], 25 books — tentative
- fidelity_ge4 (nominal): α 0.45 [0.06, 0.76], 25 books — not settled
- major_defect (nominal): α 0.53 [0.15, 0.84], 25 books — not settled
- omission (nominal): α 0.75 [0.44, 1.00], 25 books — tentative
- invention (nominal): α 0.60 [−0.04, 1.00], 25 books — not settled
- ocr_misread (nominal): α 0.32 [−0.08, 0.67], 25 books — not settled

## α Opus vs gemini-4-argon-medium — all (25 books)
exact 60%, within one 100%, mean(Opus − gemini-4-argon-medium) -0.24

- fidelity (ordinal): α 0.86 [0.69, 0.93], 25 books — reliable
- fidelity_ge4 (nominal): α 0.69 [0.36, 0.92], 25 books — tentative
- major_defect (nominal): α 0.69 [0.36, 0.92], 25 books — tentative
- omission (nominal): α 0.76 [0.45, 1.00], 25 books — tentative
- invention (nominal): α 0.76 [0.34, 1.00], 25 books — tentative
- ocr_misread (nominal): α 0.21 [−0.21, 0.58], 25 books — not settled

## α vs Opus, gemini-3.8-flash − gemini-flash-low (paired bootstrap, 365 books)
- fidelity: Δα 0.15 [0.072, 0.229]
- fidelity_ge4: Δα 0.179 [0.066, 0.3]
- major_defect: Δα 0.183 [0.067, 0.312]

## α gemini-flash-low vs gemini-3.8-flash (365 books)
exact 71.8%, within one 97.3%, mean(A − B) 0.126

- fidelity (ordinal): α 0.65 [0.56, 0.73], 365 books — not settled
- fidelity_ge4 (nominal): α 0.65 [0.52, 0.77], 365 books — not settled
- major_defect (nominal): α 0.65 [0.51, 0.77], 365 books — not settled
- omission (nominal): α 0.54 [0.41, 0.66], 365 books — not settled
- invention (nominal): α 0.59 [0.40, 0.74], 365 books — not settled
- ocr_misread (nominal): α 0.49 [0.39, 0.59], 365 books — not settled

## α gemini-flash-low vs gemini-4-argon-medium (25 books)
exact 24%, within one 60%, mean(A − B) -0.08

- fidelity (ordinal): α 0.11 [−0.32, 0.49], 25 books — not settled
- fidelity_ge4 (nominal): α 0.21 [−0.18, 0.58], 25 books — not settled
- major_defect (nominal): α 0.20 [−0.21, 0.58], 25 books — not settled
- omission (nominal): α 0.32 [−0.08, 0.67], 25 books — not settled
- invention (nominal): α 0.34 [−0.14, 0.76], 25 books — not settled
- ocr_misread (nominal): α 0.28 [−0.14, 0.66], 25 books — not settled

## α gemini-3.8-flash vs gemini-4-argon-medium (25 books)
exact 76%, within one 96%, mean(A − B) 0.04

- fidelity (ordinal): α 0.89 [0.71, 0.97], 25 books — reliable
- fidelity_ge4 (nominal): α 0.76 [0.45, 1.00], 25 books — tentative
- major_defect (nominal): α 0.84 [0.56, 1.00], 25 books — reliable
- omission (nominal): α 0.68 [0.35, 0.92], 25 books — tentative
- invention (nominal): α 0.51 [−0.09, 1.00], 25 books — not settled
- ocr_misread (nominal): α 0.60 [−0.04, 1.00], 25 books — not settled

## Self-preference (Opus − judge on Claude-translated pages, minus the same on Gemini-translated pages)
```
{
 "gemini-flash-low": {
  "judge_a": "opus",
  "judge_b": "gemini-flash-low",
  "n_claude": 54,
  "n_gemini": 311,
  "fidelity": {
   "claude_gap": -0.13,
   "gemini_gap": -0.277,
   "did": 0.147,
   "ci": [
    -0.03,
    0.342
   ]
  },
  "ge4_share": {
   "claude_gap": -0.019,
   "gemini_gap": -0.045,
   "did": 0.026,
   "ci": [
    -0.051,
    0.098
   ]
  },
  "major_share": {
   "claude_gap": -0.019,
   "gemini_gap": -0.055,
   "did": 0.036,
   "ci": [
    -0.042,
    0.109
   ]
  },
  "fidelity_matched": {
   "cells": 15,
   "did": 0.16,
   "ci": [
    -0.02,
    0.345
   ]
  }
 },
 "gemini-3.8-flash": {
  "judge_a": "opus",
  "judge_b": "gemini-3.8-flash",
  "n_claude": 54,
  "n_gemini": 311,
  "fidelity": {
   "claude_gap": -0.074,
   "gemini_gap": -0.138,
   "did": 0.064,
   "ci": [
    -0.065,
    0.183
   ]
  },
  "ge4_share": {
   "claude_gap": 0,
   "gemini_gap": -0.039,
   "did": 0.039,
   "ci": [
    0.006,
    0.071
   ]
  },
  "major_share": {
   "claude_gap": 0,
   "gemini_gap": -0.039,
   "did": 0.039,
   "ci": [
    0.006,
    0.071
   ]
  },
  "fidelity_matched": {
   "cells": 15,
   "did": 0.068,
   "ci": [
    -0.064,
    0.196
   ]
  }
 }
}
```

## The 20 disputed books (wave 2 eye-notes.md §1)
| # | item | lang | by eye | opus | gemini-flash-low | gemini-3.8-flash | gemini-4-argon-medium |
|---:|---|---|---|---:|---:|---:|---:|
| 1 | 53eba5b610 | Greek | opus | 4 | 1 | 5 | 5 |
| 2 | a1be80bcb2 | Tibetan | opus | 5 | 2 | 4 | 4 |
| 3 | cf92626d76 | Chinese | split | 5 | 2 | 5 | 5 |
| 4 | 5357b9fcbd | Greek | opus | 5 | 2 | 5 | 5 |
| 5 | fb4d166c33 | Japanese | opus | 2 | 4 | 2 | 2 |
| 6 | e86406e2a9 | Hebrew | opus | 4 | 2 | 5 | 5 |
| 7 | 0d9b5a6e26 | Tibetan | opus | 4 | 2 | 2 | 4 |
| 8 | 4ab28b7b9c | Tibetan | unsettled | 3 | 5 | 4 | 3 |
| 9 | 7b0cd73b41 | Japanese | unsettled | 3 | 5 | 5 | 4 |
| 10 | 6ccbdcc374 | Hebrew | opus | 3 | 5 | 4 | 4 |
| 11 | bfef3a4a94 | Sanskrit | unsettled | 3 | 5 | 3 | 3 |
| 12 | 75a963a5f2 | Greek | opus | 3 | 5 | 4 | 4 |
| 13 | de3204af00 | Chinese | unsettled | 3 | 5 | 4 | 4 |
| 14 | cfdd57497d | Latin | opus (closer) | 3 | 5 | 4 | 3 |
| 15 | 785ecdc0f1 | Hebrew | opus | 2 | 1 | 2 | 2 |
| 16 | 974ae0ae78 | Italian | opus | 1 | 2 | 2 | 2 |
| 17 | 64e631dc91 | Sanskrit | tie | 2 | 3 | 2 | 2 |
| 18 | 369d2b577c | Japanese | tie | 2 | 3 | 2 | 3 |
| 19 | b883cdf746 | Hebrew | opus | 2 | 3 | 2 | 2 |
| 20 | 7209ac2836 | Italian | tie | 2 | 3 | 2 | 2 |

```
{
 "gemini-flash-low": {
  "judged": 20,
  "opus_side": {
   "n": 12,
   "agree": 0,
   "exact_opus": 0
  },
  "tie": {
   "n": 3,
   "agree": 3
  },
  "other": 5
 },
 "gemini-3.8-flash": {
  "judged": 20,
  "opus_side": {
   "n": 12,
   "agree": 10,
   "exact_opus": 4
  },
  "tie": {
   "n": 3,
   "agree": 3
  },
  "other": 5
 },
 "gemini-4-argon-medium": {
  "judged": 20,
  "opus_side": {
   "n": 12,
   "agree": 11,
   "exact_opus": 6
  },
  "tie": {
   "n": 3,
   "agree": 3
  },
  "other": 5
 }
}
```
