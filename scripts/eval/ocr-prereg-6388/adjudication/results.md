## #6388 Amendment 2 — model-adjudicated key (no human)

Scored under normalizeForScript v4; verdicts re-attached to current spans by candidate readings (span_remap in results.json).

### latin-print (n = 30 works) — model-adjudicated key (no human)

| key | engine | baseline | n | CER engine | CER baseline | gap [95% CI] | margin | verdict |
|---|---|---|---:|---:|---:|---|---:|---|
| family | G (opus) | L1 (opus) | 30 | 2.4 | 3.5 | 1.1 [-0.5, 2.5] | 1.0 | cannot be told apart |
| family | G (opus) | P (opus) | 30 | 2.4 | 3.5 | 1.1 [-0.1, 2.2] | 1.0 | cannot be told apart |
| family | S (gpro) | L1 (opus) | 30 | 1.3 | 3.5 | 2.2 [1.1, 3.4] | 1.0 | switch |
| family | S (gpro) | P (opus) | 30 | 1.3 | 3.5 | 2.2 [0.9, 3.8] | 1.0 | cannot be told apart |
| family | O (cons) | L1 (opus) | 30 | 9.0 | 3.5 | -5.5 [-13.1, -0.8] | 1.0 | no change |
| family | O (cons) | P (opus) | 30 | 9.0 | 3.5 | -5.5 [-13.1, -0.7] | 1.0 | no change |
| family | IA (cons) | L1 (opus) | 15 | 34.7 | 3.8 | -30.9 [-47.7, -17.6] | 1.0 | no change |
| family | IA (cons) | P (opus) | 15 | 34.7 | 3.9 | -30.8 [-47.6, -17.4] | 1.0 | no change |
| neutral | G (neutral) | L1 (neutral) | 30 | 1.8 | 3.4 | 1.6 [0.6, 2.6] | 1.0 | cannot be told apart |
| neutral | G (neutral) | P (neutral) | 30 | 1.8 | 3.2 | 1.4 [0.5, 2.4] | 1.0 | cannot be told apart |
| neutral | S (neutral) | L1 (neutral) | 30 | 0.3 | 3.4 | 3.0 [1.5, 5.2] | 1.0 | switch |
| neutral | S (neutral) | P (neutral) | 30 | 0.3 | 3.2 | 2.9 [1.1, 5.5] | 1.0 | switch |
| neutral | O (neutral) | L1 (neutral) | 30 | 8.6 | 3.4 | -5.2 [-12.7, -0.6] | 1.0 | no change |
| neutral | O (neutral) | P (neutral) | 30 | 8.6 | 3.2 | -5.3 [-13.0, -0.6] | 1.0 | no change |
| neutral | IA (neutral) | L1 (neutral) | 15 | 34.4 | 3.7 | -30.7 [-47.5, -17.4] | 1.0 | no change |
| neutral | IA (neutral) | P (neutral) | 15 | 34.4 | 3.6 | -30.8 [-47.6, -17.4] | 1.0 | no change |
| family_uncentered | G (opus) | L1 (opus) | 30 | 2.4 | 3.5 | 1.1 [-0.5, 2.5] | 1.0 | cannot be told apart |
| family_uncentered | G (opus) | P (opus) | 30 | 2.4 | 3.5 | 1.1 [-0.1, 2.2] | 1.0 | cannot be told apart |
| family_uncentered | S (gpro) | L1 (opus) | 30 | 1.3 | 3.5 | 2.2 [1.1, 3.4] | 1.0 | switch |
| family_uncentered | S (gpro) | P (opus) | 30 | 1.3 | 3.5 | 2.2 [0.9, 3.8] | 1.0 | cannot be told apart |
| family_uncentered | O (cons) | L1 (opus) | 30 | 9.0 | 3.5 | -5.5 [-13.1, -0.8] | 1.0 | no change |
| family_uncentered | O (cons) | P (opus) | 30 | 9.0 | 3.5 | -5.5 [-13.1, -0.7] | 1.0 | no change |
| family_uncentered | IA (cons) | L1 (opus) | 15 | 34.7 | 3.8 | -30.9 [-47.7, -17.6] | 1.0 | no change |
| family_uncentered | IA (cons) | P (opus) | 15 | 34.7 | 3.9 | -30.8 [-47.6, -17.4] | 1.0 | no change |
| neutral_uncentered | G (neutral) | L1 (neutral) | 30 | 1.8 | 3.4 | 1.6 [0.6, 2.6] | 1.0 | cannot be told apart |
| neutral_uncentered | G (neutral) | P (neutral) | 30 | 1.8 | 3.2 | 1.4 [0.5, 2.4] | 1.0 | cannot be told apart |
| neutral_uncentered | S (neutral) | L1 (neutral) | 30 | 0.3 | 3.4 | 3.0 [1.5, 5.2] | 1.0 | switch |
| neutral_uncentered | S (neutral) | P (neutral) | 30 | 0.3 | 3.2 | 2.9 [1.1, 5.5] | 1.0 | switch |
| neutral_uncentered | O (neutral) | L1 (neutral) | 30 | 8.6 | 3.4 | -5.2 [-12.7, -0.6] | 1.0 | no change |
| neutral_uncentered | O (neutral) | P (neutral) | 30 | 8.6 | 3.2 | -5.3 [-13.0, -0.6] | 1.0 | no change |
| neutral_uncentered | IA (neutral) | L1 (neutral) | 15 | 34.4 | 3.7 | -30.7 [-47.5, -17.4] | 1.0 | no change |
| neutral_uncentered | IA (neutral) | P (neutral) | 15 | 34.4 | 3.6 | -30.8 [-47.6, -17.4] | 1.0 | no change |

AA (L1 − L2), family keys: -0.2 [-0.6, 0.1], band 0.6.
AA (L1 − L2), neutral keys: -0.1 [-0.4, 0.1], band 0.4.
AA (L1 − L2), family_uncentered keys: -0.2 [-0.6, 0.1], band 0.6.
AA (L1 − L2), neutral_uncentered keys: -0.1 [-0.4, 0.1], band 0.4.

### zh-manuscript (n = 30 works) — model-adjudicated key (no human)

| key | engine | baseline | n | CER engine | CER baseline | gap [95% CI] | margin | verdict |
|---|---|---|---:|---:|---:|---|---:|---|
| family | P (cons/opus) | L1 (opus) | 30 | 14.9 | 38.8 | 23.9 [11.7, 37.1] | 3.7 | switch |
| family | G (opus) | L1 (opus) | 30 | 11.0 | 38.8 | 27.8 [16.4, 40.6] | 3.7 | switch |
| family | G (opus) | P (cons/opus) | 30 | 11.0 | 14.9 | 4.0 [0.3, 7.6] | 3.7 | cannot be told apart |
| family | S (gpro) | L1 (opus) | 30 | 12.0 | 38.8 | 26.8 [16.3, 38.2] | 3.7 | switch |
| family | S (gpro) | P (cons/opus) | 30 | 12.0 | 14.9 | 2.9 [-1.9, 9.1] | 3.7 | cannot be told apart |
| neutral | P (neutral) | L1 (neutral) | 30 | 12.6 | 36.8 | 24.2 [12.0, 37.5] | 3.9 | switch |
| neutral | G (neutral) | L1 (neutral) | 30 | 8.1 | 36.8 | 28.6 [16.9, 41.9] | 3.9 | switch |
| neutral | G (neutral) | P (neutral) | 30 | 8.1 | 12.6 | 4.4 [1.1, 7.7] | 3.9 | cannot be told apart |
| neutral | S (neutral) | L1 (neutral) | 30 | 8.3 | 36.8 | 28.4 [17.5, 40.4] | 3.9 | switch |
| neutral | S (neutral) | P (neutral) | 30 | 8.3 | 12.6 | 4.2 [-0.6, 10.5] | 3.9 | cannot be told apart |
| family_uncentered | P (cons/opus) | L1 (opus) | 30 | 14.9 | 38.8 | 23.9 [11.7, 37.1] | 3.7 | switch |
| family_uncentered | G (opus) | L1 (opus) | 30 | 10.7 | 38.8 | 28.1 [16.8, 40.7] | 3.7 | switch |
| family_uncentered | G (opus) | P (cons/opus) | 30 | 10.7 | 14.9 | 4.2 [0.5, 8.0] | 3.7 | cannot be told apart |
| family_uncentered | S (gpro) | L1 (opus) | 30 | 12.0 | 38.8 | 26.8 [16.3, 38.2] | 3.7 | switch |
| family_uncentered | S (gpro) | P (cons/opus) | 30 | 12.0 | 14.9 | 2.9 [-1.9, 9.1] | 3.7 | cannot be told apart |
| neutral_uncentered | P (neutral) | L1 (neutral) | 30 | 12.6 | 36.8 | 24.2 [12.0, 37.5] | 3.9 | switch |
| neutral_uncentered | G (neutral) | L1 (neutral) | 30 | 7.9 | 36.8 | 28.9 [17.2, 41.9] | 3.9 | switch |
| neutral_uncentered | G (neutral) | P (neutral) | 30 | 7.9 | 12.6 | 4.7 [1.3, 8.2] | 3.9 | cannot be told apart |
| neutral_uncentered | S (neutral) | L1 (neutral) | 30 | 8.3 | 36.8 | 28.4 [17.5, 40.4] | 3.9 | switch |
| neutral_uncentered | S (neutral) | P (neutral) | 30 | 8.3 | 12.6 | 4.2 [-0.6, 10.5] | 3.9 | cannot be told apart |

AA (L1 − L2), family keys: -0.9 [-3.7, 1.1], band 3.7.
AA (L1 − L2), neutral keys: -1.0 [-3.9, 1.1], band 3.9.
AA (L1 − L2), family_uncentered keys: -0.9 [-3.7, 1.1], band 3.7.
AA (L1 − L2), neutral_uncentered keys: -1.0 [-3.9, 1.1], band 3.9.

### english-print (n = 30 works) — model-adjudicated key (no human)

| key | engine | baseline | n | CER engine | CER baseline | gap [95% CI] | margin | verdict |
|---|---|---|---:|---:|---:|---|---:|---|
| family | G (opus) | L1 (opus) | 29 | 10.9 | 5.5 | -5.4 [-18.6, 6.8] | 10.2 | no change |
| family | G (opus) | P (opus/cons) | 29 | 10.9 | 13.8 | 2.8 [-10.4, 15.9] | 10.2 | cannot be told apart |
| family | S (gpro) | L1 (opus) | 29 | 11.0 | 5.5 | -5.5 [-19.3, 7.9] | 10.2 | no change |
| family | S (gpro) | P (opus/cons) | 29 | 11.0 | 13.8 | 2.8 [-13.7, 18.7] | 10.2 | cannot be told apart |
| family | O (cons) | L1 (opus) | 29 | 4.8 | 5.5 | 0.7 [-5.3, 9.3] | 10.2 | no change |
| family | O (cons) | P (opus/cons) | 29 | 4.8 | 13.8 | 9.0 [-0.4, 20.4] | 10.2 | cannot be told apart |
| family | IA (cons) | L1 (opus) | 21 | 12.3 | 2.2 | -10.1 [-16.9, -4.0] | 10.2 | no change |
| family | IA (cons) | P (opus/cons) | 21 | 12.3 | 18.6 | 6.4 [-7.4, 22.3] | 10.2 | cannot be told apart |
| neutral | G (neutral) | L1 (neutral) | 29 | 10.7 | 5.5 | -5.2 [-18.3, 7.1] | 10.2 | no change |
| neutral | G (neutral) | P (neutral) | 29 | 10.7 | 13.8 | 3.1 [-10.1, 16.1] | 10.2 | cannot be told apart |
| neutral | S (neutral) | L1 (neutral) | 29 | 10.5 | 5.5 | -5.0 [-18.9, 8.4] | 10.2 | no change |
| neutral | S (neutral) | P (neutral) | 29 | 10.5 | 13.8 | 3.2 [-13.2, 19.2] | 10.2 | cannot be told apart |
| neutral | O (neutral) | L1 (neutral) | 29 | 4.6 | 5.5 | 0.9 [-5.2, 9.5] | 10.2 | no change |
| neutral | O (neutral) | P (neutral) | 29 | 4.6 | 13.8 | 9.1 [-0.2, 20.5] | 10.2 | cannot be told apart |
| neutral | IA (neutral) | L1 (neutral) | 21 | 12.3 | 2.2 | -10.1 [-16.9, -4.0] | 10.2 | no change |
| neutral | IA (neutral) | P (neutral) | 21 | 12.3 | 18.6 | 6.4 [-7.4, 22.3] | 10.2 | cannot be told apart |
| family_uncentered | G (opus) | L1 (opus) | 29 | 10.9 | 5.5 | -5.4 [-18.6, 6.8] | 10.2 | no change |
| family_uncentered | G (opus) | P (opus/cons) | 29 | 10.9 | 13.8 | 2.8 [-10.4, 15.9] | 10.2 | cannot be told apart |
| family_uncentered | S (gpro) | L1 (opus) | 29 | 11.0 | 5.5 | -5.5 [-19.3, 7.9] | 10.2 | no change |
| family_uncentered | S (gpro) | P (opus/cons) | 29 | 11.0 | 13.8 | 2.8 [-13.7, 18.7] | 10.2 | cannot be told apart |
| family_uncentered | O (cons) | L1 (opus) | 29 | 4.8 | 5.5 | 0.7 [-5.3, 9.3] | 10.2 | no change |
| family_uncentered | O (cons) | P (opus/cons) | 29 | 4.8 | 13.8 | 9.0 [-0.4, 20.4] | 10.2 | cannot be told apart |
| family_uncentered | IA (cons) | L1 (opus) | 21 | 12.3 | 2.2 | -10.1 [-16.9, -4.0] | 10.2 | no change |
| family_uncentered | IA (cons) | P (opus/cons) | 21 | 12.3 | 18.6 | 6.4 [-7.4, 22.3] | 10.2 | cannot be told apart |
| neutral_uncentered | G (neutral) | L1 (neutral) | 29 | 10.7 | 5.5 | -5.2 [-18.3, 7.1] | 10.2 | no change |
| neutral_uncentered | G (neutral) | P (neutral) | 29 | 10.7 | 13.8 | 3.1 [-10.1, 16.1] | 10.2 | cannot be told apart |
| neutral_uncentered | S (neutral) | L1 (neutral) | 29 | 10.5 | 5.5 | -5.0 [-18.9, 8.4] | 10.2 | no change |
| neutral_uncentered | S (neutral) | P (neutral) | 29 | 10.5 | 13.8 | 3.2 [-13.2, 19.2] | 10.2 | cannot be told apart |
| neutral_uncentered | O (neutral) | L1 (neutral) | 29 | 4.6 | 5.5 | 0.9 [-5.2, 9.5] | 10.2 | no change |
| neutral_uncentered | O (neutral) | P (neutral) | 29 | 4.6 | 13.8 | 9.1 [-0.2, 20.5] | 10.2 | cannot be told apart |
| neutral_uncentered | IA (neutral) | L1 (neutral) | 21 | 12.3 | 2.2 | -10.1 [-16.9, -4.0] | 10.2 | no change |
| neutral_uncentered | IA (neutral) | P (neutral) | 21 | 12.3 | 18.6 | 6.4 [-7.4, 22.3] | 10.2 | cannot be told apart |

AA (L1 − L2), family keys: 3.3 [-0.1, 10.2], band 10.2.
AA (L1 − L2), neutral keys: 3.3 [-0.1, 10.2], band 10.2.
AA (L1 − L2), family_uncentered keys: 3.3 [-0.1, 10.2], band 10.2.
AA (L1 − L2), neutral_uncentered keys: 3.3 [-0.1, 10.2], band 10.2.

