
### setA (76 pages)


**Key: reference**

| arm | read / given | did not read (by kind) | mean page CER [95% CI by work] | failed = 1.0 | pooled CER | WER | s/page | bentham-r0 | cremma-medii-aevi | htromance-modern | rasam |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Flash-Lite (production) | 72 / 76 | duplicated 4 | 16.1 [12.1, 20.3] | 20.5 [14.4, 27.3] | 21.7 [15.5, 27.6] | 46.7 [35.0, 57.1] | 7 | 3.8 (20) | 34.5 (14) | 8.4 (20) | 24.0 (18) |
| 3.8 Flash low (CLI) | 67 / 76 | filter_cut 2, refusal 6, restarted 1 | 13.9 [9.2, 19.7] | 24.1 [16.8, 31.4] | 21.1 [11.5, 31.4] | 42.8 [28.5, 54.9] | 41 | 4.5 (18) | 31.9 (15) | 6.3 (17) | 15.5 (17) |
| 3.8 Flash high (CLI) | 69 / 76 | cli_error 1, filter_cut 3, refusal 2, timeout 1 | 12.6 [9.0, 16.8] | 20.6 [13.9, 28.3] | 19.5 [11.4, 27.2] | 42.5 [28.5, 53.9] | 183 | 4.3 (17) | 26.0 (15) | 6.3 (20) | 16.3 (17) |
| 3.1 Pro (CLI) | 73 / 76 | restarted 3 | 14.0 [9.6, 19.2] | 17.4 [11.9, 23.7] | 22.3 [12.6, 32.4] | 60.7 [30.6, 90.2] | 151 | 3.3 (17) | 29.5 (18) | 6.5 (20) | 17.1 (18) |
| Opus (claude -p) | 75 / 76 | restarted 1 | 9.9 [7.2, 12.9] | 11.1 [7.4, 15.5] | 14.5 [9.4, 19.6] | 33.5 [24.2, 41.3] | 23 | 4.1 (20) | 18.9 (17) | 4.9 (20) | 13.4 (18) |
| Pro corrects Opus draft *partly measured* | 61 / 62 | restarted 1 | 9.5 [6.6, 13.0] | 11.0 [7.3, 15.7] | 15.1 [9.0, 21.5] | 35.1 [21.9, 47.4] | 124 | 3.8 (20) | 19.3 (17) | 5.6 (19) | 14.3 (5) |
| Opus corrects Pro draft | 76 / 76 | 0 | 9.6 [6.9, 12.9] | 9.6 [6.9, 12.9] | 15.3 [8.4, 22.9] | 35.4 [23.0, 46.2] | 25 | 3.8 (20) | 19.9 (18) | 5.7 (20) | 10.1 (18) |
| Disagreement (Pro+Opus, 3.8 high settles) *partly measured* | 23 / 29 | primary_or_second_unread 4, restarted 2 | 5.5 [2.9, 8.2] | 25.1 [10.2, 41.6] | 7.7 [3.7, 10.5] | 18.0 [6.1, 26.2] | 128 | 3.4 (17) | 11.5 (6) | — (0) | — (0) |

Paired mean page CER difference (points; negative = first arm better), pages both read, 95% CI by work:

| pair | diff [95% CI] | n |
|---|---|---|
| pro-lite | -4.7 [-6.9, -2.6] | 69 |
| f38h-lite | -5.4 [-7.5, -3.5] | 65 |
| f38l-lite | -4.7 [-6.9, -2.5] | 64 |
| opus-lite | -6.8 [-9.6, -4.0] | 71 |
| f38h-f38l | -1.8 [-4.1, +0.1] | 62 |
| pro-f38h | +1.4 [-0.1, +3.2] | 66 |
| opus-pro | -3.3 [-5.9, -0.9] | 72 |
| corr-opus-pro | -4.3 [-6.6, -2.5] | 73 |
| corr-opus-opus | -1.0 [-2.6, +0.2] | 75 |
| corr-pro-opus | +0.2 [-0.5, +0.9] | 61 |
| corr-pro-pro | -3.1 [-4.6, -1.6] | 58 |
| disagree-pro | -1.3 [-3.1, +0.0] | 23 |
| disagree-opus | -0.6 [-1.5, +0.0] | 23 |

Pro corrects Opus draft — pooled CER of the draft (opus) → corrected, on 61 pages: 14.3 [8.9, 20.1] → 15.1 [9.0, 21.5]; pages better 14, worse 31; convention/style part (strict − folded) 9.3 → 10.1.

| draft noise tertile | pages | draft CER range | draft → corrected (pooled) | change [95% CI] |
|---|---|---|---|---|
| clean | 20 | 0.0 – 2.7 | 1.0 [0.6, 1.4] → 1.1 [0.7, 1.6] | +0.1 [-0.1, +0.4] |
| middle | 20 | 2.8 – 10.4 | 5.9 [5.0, 7.1] → 6.2 [4.9, 8.1] | +0.3 [-0.4, +1.2] |
| noisy | 21 | 11.3 – 56.0 | 22.1 [14.8, 31.5] → 23.3 [14.9, 33.7] | +1.2 [-1.3, +4.1] |

Opus corrects Pro draft — pooled CER of the draft (pro) → corrected, on 73 pages: 22.3 [12.3, 31.9] → 15.5 [8.5, 22.9]; pages better 50, worse 4; convention/style part (strict − folded) 13.5 → 9.7.

| draft noise tertile | pages | draft CER range | draft → corrected (pooled) | change [95% CI] |
|---|---|---|---|---|
| clean | 24 | 0.0 – 4.4 | 1.5 [1.0, 2.1] → 1.4 [0.9, 1.9] | -0.1 [-0.2, -0.1] |
| middle | 24 | 5.2 – 14.2 | 9.1 [8.0, 10.3] → 7.3 [6.3, 8.7] | -1.8 [-2.5, -1.0] |
| noisy | 25 | 14.6 – 77.9 | 36.6 [23.1, 50.7] → 24.9 [15.2, 35.7] | -11.6 [-16.4, -7.6] |

Disputed share (Pro's characters inside a Pro/Opus disagreement span): 44.9% overall; bentham-r0 3.1%, cremma-medii-aevi 76.0%, htromance-modern 16.7%, rasam 37.2%; pages with no dispute: 2.

Anchoring corr-pro: 2 of 26 planted errors survived (7.7%); by kind {'word': {'corrected': 11, 'other': 4, 'survived': 2, 'site_not_found': 1, 'invalid_plant': 1}, 'dropped_line': {'corrected': 8}, 'num': {'corrected': 1}}.

Anchoring corr-opus: 2 of 28 planted errors survived (7.1%); by kind {'word': {'corrected': 16, 'other': 2, 'invalid_plant': 2}, 'dropped_line': {'survived': 2, 'corrected': 8}}.

Calls: {'lite': 78, 'f38l': 78, 'f38h': 80, 'pro': 82, 'opus': 78, 'corr-pro': 64, 'corr-opus': 78, 'resolve': 28}

### setB (40 pages)


**Key: key-o**

| arm | read / given | did not read (by kind) | mean page CER [95% CI by work] | failed = 1.0 | pooled CER | WER | s/page | arabic | cjk | greek | hebrew | latin | syriac |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Flash-Lite (production) | 34 / 40 | duplicated 4, restarted 1 | 42.3 [30.7, 54.3] | 49.7 [37.2, 61.7] | 32.6 [21.9, 49.1] | 59.3 [41.6, 84.3] | 9 | 52.9 (4) | 26.7 (8) | 25.4 (2) | 100.0 (3) | 26.9 (14) | 95.0 (3) |
| 3.8 Flash low (CLI) | 34 / 40 | refusal 5 | 33.8 [22.7, 46.6] | 42.3 [30.2, 54.8] | 27.9 [14.2, 42.0] | 45.7 [27.9, 64.2] | 62 | 29.7 (6) | 14.4 (8) | 13.9 (3) | 84.7 (3) | 19.6 (10) | 91.2 (4) |
| 3.8 Flash high (CLI) | 35 / 40 | refusal 4 | 33.0 [21.8, 45.3] | 39.9 [28.1, 52.6] | 24.0 [14.2, 36.5] | 41.0 [27.5, 57.7] | 178 | 23.1 (5) | 13.6 (8) | 13.1 (3) | 86.2 (3) | 20.8 (12) | 96.1 (4) |
| 3.1 Pro (CLI) | 39 / 40 | 0 | 20.6 [11.6, 30.6] | 20.6 [11.6, 30.6] | 14.4 [6.8, 24.6] | 27.0 [14.4, 41.6] | 162 | 12.2 (6) | 11.6 (8) | 21.0 (3) | 69.1 (4) | 16.1 (14) | 18.5 (4) |
| Opus (claude -p) | 39 / 40 | duplicated 1 | 22.2 [11.9, 34.2] | 22.2 [11.9, 34.2] | 16.5 [4.7, 31.7] | 23.0 [9.2, 40.3] | 25 | 20.5 (6) | 8.3 (8) | 1.9 (3) | 26.3 (4) | 11.9 (14) | 100.0 (4) |
| Pro corrects Opus draft *partly measured* | 0 / 0 | 0 | — | — | — | — | — | — (0) | — (0) | — (0) | — (0) | — (0) | — (0) |
| Opus corrects Pro draft | 39 / 40 | 0 | 23.5 [13.5, 34.0] | 23.5 [13.5, 34.0] | 14.4 [7.5, 23.8] | 27.2 [16.8, 38.9] | 24 | 11.1 (6) | 10.7 (8) | 18.5 (3) | 57.8 (4) | 15.3 (14) | 65.3 (4) |
| Disagreement (Pro+Opus, 3.8 high settles) *partly measured* | 26 / 30 | primary_or_second_unread 1, refusal 1, restarted 2 | 11.1 [4.0, 20.8] | 20.3 [8.8, 33.6] | 5.9 [3.0, 9.5] | 12.3 [6.9, 18.8] | 141 | 15.3 (4) | 8.1 (8) | — (0) | — (0) | 12.4 (13) | 0.0 (1) |

Paired mean page CER difference (points; negative = first arm better), pages both read, 95% CI by work:

| pair | diff [95% CI] | n |
|---|---|---|
| pro-lite | -21.5 [-32.1, -12.0] | 34 |
| f38h-lite | -10.2 [-18.1, -3.6] | 31 |
| f38l-lite | -12.1 [-20.1, -5.7] | 29 |
| opus-lite | -22.3 [-32.5, -13.5] | 34 |
| f38h-f38l | +1.5 [-0.3, +3.8] | 33 |
| pro-f38h | -13.2 [-24.3, -3.9] | 35 |
| opus-pro | +1.6 [-11.9, +16.0] | 39 |
| corr-opus-pro | +2.8 [-2.9, +10.0] | 39 |
| corr-opus-opus | +1.2 [-10.7, +12.4] | 39 |
| disagree-pro | -3.5 [-6.4, -1.1] | 26 |
| disagree-opus | -2.9 [-11.9, +2.8] | 26 |

Opus corrects Pro draft — pooled CER of the draft (pro) → corrected, on 39 pages: 14.4 [6.9, 24.6] → 14.4 [7.3, 23.8]; pages better 23, worse 8; convention/style part (strict − folded) 6.2 → 5.5.

| draft noise tertile | pages | draft CER range | draft → corrected (pooled) | change [95% CI] |
|---|---|---|---|---|
| clean | 13 | 0.0 – 1.7 | 0.3 [0.1, 0.5] → 10.6 [1.1, 29.4] | +10.3 [+0.8, +29.4] |
| middle | 13 | 4.5 – 10.8 | 7.4 [5.8, 9.1] → 6.3 [3.5, 9.5] | -1.1 [-2.3, +0.6] |
| noisy | 13 | 12.2 – 184400.0 | 40.6 [20.6, 78.3] → 29.0 [14.5, 63.2] | -11.6 [-26.4, -2.8] |

**Key: key-g**

| arm | read / given | did not read (by kind) | mean page CER [95% CI by work] | failed = 1.0 | pooled CER | WER | s/page | arabic | cjk | greek | hebrew | latin | syriac |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Flash-Lite (production) | 35 / 40 | duplicated 4, restarted 1 | 48.3 [36.4, 60.5] | 54.8 [42.7, 66.8] | 40.7 [27.2, 59.7] | 67.0 [47.6, 93.0] | 9 | 49.1 (4) | 40.7 (8) | 44.2 (2) | 95.8 (3) | 30.3 (14) | 92.6 (4) |
| 3.8 Flash low (CLI) | 35 / 40 | refusal 5 | 40.1 [27.8, 53.8] | 47.5 [34.8, 60.5] | 37.1 [22.0, 53.6] | 55.5 [35.8, 76.7] | 62 | 27.3 (6) | 29.4 (8) | 17.0 (3) | 91.7 (3) | 23.0 (10) | 89.3 (5) |
| 3.8 Flash high (CLI) | 36 / 40 | refusal 4 | 38.5 [26.6, 52.0] | 44.7 [32.2, 57.9] | 32.2 [19.6, 48.3] | 50.8 [34.2, 72.9] | 178 | 20.4 (5) | 28.8 (8) | 15.2 (3) | 91.7 (3) | 20.7 (12) | 96.9 (5) |
| 3.1 Pro (CLI) | 40 / 40 | 0 | 13.8 [5.8, 23.2] | 13.8 [5.8, 23.2] | 10.0 [4.9, 17.5] | 18.7 [9.1, 30.0] | 162 | 6.1 (6) | 27.7 (8) | 5.5 (3) | 26.3 (4) | 6.2 (14) | 17.1 (5) |
| Opus (claude -p) | 39 / 40 | duplicated 1 | 37.3 [24.9, 50.3] | 38.9 [26.4, 52.0] | 30.9 [15.9, 47.6] | 42.2 [24.7, 61.4] | 25 | 24.8 (6) | 27.3 (8) | 21.3 (3) | 93.0 (4) | 17.9 (14) | 100.0 (4) |
| Pro corrects Opus draft *partly measured* | 0 / 0 | 0 | — | — | — | — | — | — (0) | — (0) | — (0) | — (0) | — (0) | — (0) |
| Opus corrects Pro draft | 40 / 40 | 0 | 25.6 [14.5, 38.1] | 25.6 [14.5, 38.1] | 17.7 [8.6, 30.4] | 29.4 [16.7, 45.8] | 24 | 9.3 (6) | 27.0 (8) | 5.4 (3) | 50.0 (4) | 13.7 (14) | 69.1 (5) |
| Disagreement (Pro+Opus, 3.8 high settles) *partly measured* | 26 / 30 | primary_or_second_unread 1, refusal 1, restarted 2 | 13.2 [4.3, 24.5] | 24.8 [12.3, 39.8] | 7.4 [3.4, 13.0] | 12.6 [6.9, 20.1] | 141 | 5.3 (4) | 26.7 (8) | — (0) | — (0) | 8.4 (13) | 0.0 (1) |

Paired mean page CER difference (points; negative = first arm better), pages both read, 95% CI by work:

| pair | diff [95% CI] | n |
|---|---|---|
| pro-lite | -33.5 [-45.0, -22.2] | 35 |
| f38h-lite | -12.0 [-19.2, -5.5] | 32 |
| f38l-lite | -13.4 [-21.0, -7.0] | 30 |
| opus-lite | -13.2 [-21.1, -6.5] | 34 |
| f38h-f38l | +0.8 [-1.1, +3.0] | 34 |
| pro-f38h | -26.2 [-38.8, -14.8] | 36 |
| opus-pro | +25.3 [+13.4, +38.9] | 39 |
| corr-opus-pro | +11.8 [+2.9, +21.9] | 40 |
| corr-opus-opus | -13.2 [-23.5, -4.8] | 39 |
| disagree-pro | +0.3 [-1.5, +2.4] | 26 |
| disagree-opus | -10.6 [-22.1, -1.6] | 26 |

Opus corrects Pro draft — pooled CER of the draft (pro) → corrected, on 40 pages: 10.0 [4.9, 17.8] → 17.7 [8.9, 30.4]; pages better 11, worse 20; convention/style part (strict − folded) 3.4 → 7.0.

| draft noise tertile | pages | draft CER range | draft → corrected (pooled) | change [95% CI] |
|---|---|---|---|---|
| clean | 13 | 0.0 – 0.3 | 0.1 [0.0, 0.2] → 14.5 [1.7, 39.9] | +14.4 [+1.7, +39.1] |
| middle | 13 | 0.6 – 4.6 | 2.9 [1.8, 3.8] → 3.4 [1.6, 6.7] | +0.5 [-1.1, +3.3] |
| noisy | 14 | 5.1 – 341.2 | 24.2 [12.9, 49.8] → 33.8 [15.4, 71.4] | +9.7 [-1.1, +37.1] |

**Key: key-f**

| arm | read / given | did not read (by kind) | mean page CER [95% CI by work] | failed = 1.0 | pooled CER | WER | s/page | arabic | cjk | greek | hebrew | latin | syriac |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Flash-Lite (production) | 35 / 40 | duplicated 4, restarted 1 | 43.9 [32.5, 55.7] | 49.7 [37.9, 61.0] | 38.1 [25.2, 55.8] | 64.5 [46.1, 88.4] | 9 | 51.6 (4) | 25.8 (8) | 44.0 (2) | 95.8 (3) | 27.1 (14) | 92.6 (4) |
| 3.8 Flash low (CLI) | 34 / 40 | refusal 5 | 34.5 [23.3, 46.9] | 42.9 [30.6, 54.9] | 33.8 [18.9, 48.6] | 53.1 [34.0, 71.3] | 62 | 27.9 (6) | 13.4 (8) | 13.8 (2) | 76.4 (3) | 19.4 (10) | 89.3 (5) |
| 3.8 Flash high (CLI) | 35 / 40 | refusal 4 | 34.3 [23.1, 46.7] | 41.1 [29.0, 53.8] | 31.3 [18.8, 45.5] | 50.6 [34.7, 68.2] | 178 | 21.4 (5) | 12.6 (8) | 14.0 (2) | 78.0 (3) | 20.6 (12) | 96.9 (5) |
| 3.1 Pro (CLI) | 39 / 40 | 0 | 13.9 [7.0, 22.3] | 13.9 [7.0, 22.3] | 13.8 [6.2, 24.4] | 22.4 [12.0, 36.4] | 162 | 8.2 (6) | 12.4 (8) | 3.9 (2) | 44.1 (4) | 8.9 (14) | 17.1 (5) |
| Opus (claude -p) | 38 / 40 | duplicated 1 | 27.7 [16.1, 40.2] | 29.5 [17.4, 42.6] | 24.0 [8.4, 40.4] | 32.3 [15.1, 50.6] | 25 | 25.6 (6) | 7.5 (8) | 23.9 (2) | 52.1 (4) | 13.0 (14) | 100.0 (4) |
| Pro corrects Opus draft *partly measured* | 0 / 0 | 0 | — | — | — | — | — | — (0) | — (0) | — (0) | — (0) | — (0) | — (0) |
| Opus corrects Pro draft | 39 / 40 | 0 | 21.4 [12.3, 31.8] | 21.4 [12.3, 31.8] | 15.2 [7.7, 24.8] | 24.7 [14.9, 36.6] | 24 | 10.9 (6) | 9.7 (8) | 2.9 (2) | 32.8 (4) | 15.0 (14) | 69.1 (5) |
| Disagreement (Pro+Opus, 3.8 high settles) *partly measured* | 26 / 30 | primary_or_second_unread 1, refusal 1, restarted 2 | 5.5 [2.3, 10.6] | 18.1 [7.1, 31.5] | 4.6 [2.4, 7.2] | 10.2 [5.9, 15.2] | 141 | 4.3 (4) | 7.3 (8) | — (0) | — (0) | 5.2 (13) | 0.0 (1) |

Paired mean page CER difference (points; negative = first arm better), pages both read, 95% CI by work:

| pair | diff [95% CI] | n |
|---|---|---|
| pro-lite | -30.9 [-42.9, -19.4] | 35 |
| f38h-lite | -11.2 [-18.7, -4.3] | 32 |
| f38l-lite | -13.8 [-21.3, -7.5] | 30 |
| opus-lite | -17.2 [-26.7, -9.2] | 34 |
| f38h-f38l | +2.3 [+0.2, +4.6] | 33 |
| pro-f38h | -22.0 [-35.2, -10.4] | 35 |
| opus-pro | +15.6 [+0.8, +31.3] | 38 |
| corr-opus-pro | +7.5 [-0.8, +17.0] | 39 |
| corr-opus-opus | -7.9 [-19.7, +2.7] | 38 |
| disagree-pro | -4.1 [-6.6, -2.2] | 26 |
| disagree-opus | -9.4 [-21.1, -0.4] | 26 |

Opus corrects Pro draft — pooled CER of the draft (pro) → corrected, on 39 pages: 13.8 [5.9, 24.5] → 15.2 [7.6, 24.9]; pages better 22, worse 9; convention/style part (strict − folded) 4.2 → 4.1.

| draft noise tertile | pages | draft CER range | draft → corrected (pooled) | change [95% CI] |
|---|---|---|---|---|
| clean | 13 | 0.0 – 0.9 | 0.3 [0.0, 0.6] → 11.3 [1.3, 31.6] | +11.0 [+1.0, +30.1] |
| middle | 13 | 1.2 – 8.4 | 5.2 [4.5, 6.1] → 4.6 [2.8, 8.0] | -0.6 [-2.3, +2.7] |
| noisy | 13 | 8.7 – 239.1 | 36.4 [16.6, 63.0] → 29.0 [15.0, 53.4] | -7.4 [-20.0, +0.5] |

Disputed share (Pro's characters inside a Pro/Opus disagreement span): 45.3% overall; arabic 59.4%, cjk 39.6%, greek 23.0%, hebrew 91.8%, latin 27.9%, syriac 97.3%; pages with no dispute: 1.

Calls: {'lite': 27, 'f38l': 40, 'f38h': 40, 'pro': 41, 'opus': 41, 'corr-pro': 0, 'corr-opus': 40, 'resolve': 28}
