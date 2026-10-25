| cell | pages waiting (read-weighted) | route chosen (§3a) | P(worse) at the gate instrument [90%] | net gain / page | P(clears bar) | capacity per 1K pages | share of the free week, week 1 | pages in the first quarter (by route) | weeks to drain | top 10% / 50% of reads done by week | what waits meanwhile |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Latin print read by Flash-Lite | 861,506 (1,568,440) | **opus-5.5** (provisional) | 0.028 [0.008, 0.076] | 0.80 | 0.83 | 0.0481 acct-wk | 99% agy, 15% claude | agy-3.8-flash-low 497,358 | 26 | 1 / 4 | 364,148 pages after the quarter stay on the lite text (Flash-Lite Batch read) |
| Latin print read by Gemini 3 Flash (most-read books) | 1,317,806 (4,949,396) | **opus-5.5** | 0.024 [0.009, 0.052] | 0.81 | 0.94 | 0.0481 acct-wk | 83% claude | opus-5.5 447,856 | 43 | 1 / 2 | 869,950 pages after the quarter stay on the Gemini 3 Flash text |
| German read by Gemini 3 Flash | 353,186 (1,359,293) | **none clears** (nearest: agy-3.8-flash-low, pooled) | 0.060 [0.005, 0.472] | 0.56 | 0.44 | 1.02e+03 agy calls + 0.00852 acct-wk | — | — | — | — | all on the Gemini 3 Flash text |
| Greek read by Gemini 3 Flash | 419,150 (894,950) | **held**: Derek 2026-10-14 (#6694): Greek stays on lane A (nearest: opus-5.5, measured) | 0.011 [0.001, 0.052] | 0.70 | 0.94 | 0.0487 acct-wk | — | — | — | — | all on the Gemini 3 Flash text |
| Chinese read by Gemini 3 Flash | 103,878 (121,280) | **opus-5.5** (provisional) | 0.022 [0.005, 0.066] | 0.40 | 0.84 | 0.0415 acct-wk | — | opus-5.5 10,628 | 43 | 4 / 13 | 93,250 pages after the quarter stay on the Gemini 3 Flash text |
| Arabic read by Gemini 3 Flash | 30,244 (201,378) | **none clears** (nearest: opus-5.5, pooled) | 0.014 [0.002, 0.072] | 0.69 | 0.88 | 0.0489 acct-wk | — | — | — | — | all on the Gemini 3 Flash text |
| Hebrew read by Gemini 3 Flash | 51,360 (290,359) | **none clears** (nearest: opus-5.5, pooled) | 0.019 [0.002, 0.142] | 0.66 | 0.77 | 0.048 acct-wk | — | — | — | — | all on the Gemini 3 Flash text |
| German read by Flash-Lite | 418,603 (843,556) | **none clears** (nearest: opus-5.5, pooled) | 0.024 [0.002, 0.217] | 0.70 | 0.69 | 0.0485 acct-wk | — | — | — | — | all on the lite text |
| French read by Flash-Lite | 151,443 (473,237) | **none clears** (nearest: opus-5.5, pooled) | 0.017 [0.001, 0.170] | 0.72 | 0.77 | 0.0486 acct-wk | — | — | — | — | all on the lite text |
| Chinese tables and mixed pages newly read by guarded Paddle (#6871) | 22,220 (7,410) | **opus-5.5** (provisional) | 0.041 [0.013, 0.104] | 0.66 | 0.62 | 0.0992 acct-wk | — | — | 52 | 52 / 52 | 22,220 pages after the quarter stay on the guarded Paddle text, Opus-translated by job zh-translate-route-6871 |
| Chinese Paddle pages whose Kanripo screen is below 0.90 dice | 453,715 (166,906) | **agy-3.8-flash-high** (provisional) | 0.027 [0.005, 0.083] | 0.28 | 0.80 | 1.02e+03 agy calls + 0.00147 acct-wk | — | — | 34 | 21 / 34 | 453,715 pages after the quarter stay on the Paddle text |
| Stale Siku pages, high old-vs-new change (#6561 item 1) | 24,834 (9,448) | **opus-5.5+siku-v2** (provisional) | 0.091 [0.051, 0.144] | 0.27 | 0.62 | 0.0915 acct-wk | — | — | 65 | 65 / 65 | 24,834 pages after the quarter stay on the Paddle text |
| Tibetan read by Yigdzin | 280,623 (194,496) | **opus-5.5** (provisional) | 0.024 [0.003, 0.141] | 0.43 | 0.74 | 0.0969 acct-wk | — | — | 65 | 26 / 43 | 280,623 pages after the quarter stay on the Yigdzin text |

Tests reserved from the same budget (one per cell: n pages through the cell's gate instrument):

| cell | route under test | basis | P(clears) now | n | instrument | draw |
|---|---|---|---|---|---|---|
| latin-lite | opus-5.5 | measured | 0.83 | 80 | blind-judge | 0.0032 acct-wk + 81.6 agy calls |
| chinese-flash3 | opus-5.5 | measured | 0.84 | 40 | blind-judge | 0.0016 acct-wk + 40.8 agy calls |
| arabic-flash3 | opus-5.5 | pooled | 0.88 | 40 | blind-judge | 0.0016 acct-wk + 40.8 agy calls |
| hebrew-flash3 | opus-5.5 | pooled | 0.77 | 80 | blind-judge | 0.0032 acct-wk + 81.6 agy calls |
| german-lite | opus-5.5 | pooled | 0.69 | 80 | blind-judge | 0.0032 acct-wk + 81.6 agy calls |
| french-lite | opus-5.5 | pooled | 0.77 | 40 | blind-judge | 0.0016 acct-wk + 40.8 agy calls |
| zh-paddle-dice-lt090 | agy-3.8-flash-high | measured | 0.80 | 80 | mechanical | 81.6 agy calls |
| tibetan-yigdzin | opus-5.5 | measured | 0.74 | 80 | leaf-audit-tiles | 0.0216 acct-wk |

Decisions, in capacity terms (each forces one route on one cell; the LP re-plans everything else):

| decision | cell, route | whole cell draws | top 10% / 25% / 50% / 100% of reads done by week (competing) | the same, with the channel to itself | pages in the first quarter | what it displaces in the quarter (pages; net pages improved) |
|---|---|---|---|---|---|---|
| 5924: Opus corrects lite Latin (by reads) | latin-lite, opus-5.5 | 41.4 acct-wk | 2 / 3 / 10 / 52 | 0.1 / 0.61 / 2.85 / 20.7 | 173,392 | chinese-flash3 -5,397 (-2,242); latin-flash3 -99,309 (-78,633); zh-paddle-dice-lt090 +453,715 (+124,273) |
| 5924: Opus corrects lite Latin, ahead of every other cell | latin-lite, opus-5.5 | 41.4 acct-wk | 1 / 1 / 3 / 21 | 0.1 / 0.61 / 2.85 / 20.7 | 540,354 | chinese-flash3 -10,628 (-4,416); latin-flash3 -447,856 (-354,613) |
| 6560: Flash-low correction pass over Yigdzin Tibetan, now | tibetan-yigdzin, agy-3.8-flash-low | 2.86e+05 agy calls + 1.93 acct-wk | 1 / 1 / 2 / 8 | 0.1 / 0.37 / 1.23 / 7.33 | 280,623 | latin-lite -237,490 (-178,113); latin-flash3 -36,202 (-28,665) |
| 6561/6871: Opus corrects the newly read Paddle tables (by reads) | zh-frame-6871, opus-5.5 | 2.2 acct-wk | 52 / 52 / 52 / 52 | 0.11 / 0.27 / 0.55 / 1.1 | 0 | nothing |
| 6561/6871: Opus corrects the newly read Paddle tables, now | zh-frame-6871, opus-5.5 | 2.2 acct-wk | 1 / 1 / 1 / 2 | 0.11 / 0.27 / 0.55 / 1.1 | 22,220 | latin-flash3 -45,874 (-36,323) |

Sensitivity (weeks to drain; pages in the first quarter):

| cell | base | agy x0.7 | agy x1.3 | Opus@10 draw low | Opus@10 draw high | harm weight 1 | harm weight 4 |
|---|---|---|---|---|---|---|---|
| latin-lite | 26 wk; 497,358 | 34 wk; 359,331 (opus-5.5 11,313, agy-3.8-flash-low 348,019) | 21 wk; 646,306 | 21 wk; 646,306 (opus-5.5 148,948, agy-3.8-flash-low 497,358) | 26 wk; 497,358 | 26 wk; 497,358 | 26 wk; 497,358 |
| latin-flash3 | 43 wk; 447,856 | 43 wk; 461,563 | 43 wk; 422,891 | 26 wk; 733,656 | 65 wk; 296,162 | 43 wk; 447,856 | 43 wk; 447,856 |
| chinese-flash3 | 43 wk; 10,628 | 52 wk; 10,628 | 43 wk; 10,628 | 26 wk; 20,793 | 65 wk; 5,231 | 43 wk; 10,628 | 52 wk; 10,628 |
| zh-frame-6871 | 52 wk; 0 | 52 wk; 0 | 52 wk; 0 | 34 wk; 0 | 65 wk; 0 | 52 wk; 0 | 52 wk; 0 |
| zh-paddle-dice-lt090 | 34 wk; 0 | 43 wk; 0 | 26 wk; 391 | 26 wk; 0 | 34 wk; 0 | 34 wk; 0 | 34 wk; 0 |
| zh-siku-stale | 65 wk; 0 | 65 wk; 0 | 65 wk; 0 | 43 wk; 0 | 104 wk; 0 | 65 wk; 0 | 78 wk; 0 |
| tibetan-yigdzin | 65 wk; 0 | 65 wk; 0 | 65 wk; 0 | 43 wk; 0 | 78 wk; 0 | 65 wk; 0 | 65 wk; 0 |

Proposed routing-table rows (for #7170; the tables are not edited here):

| id | draft → corrector (stage) | status | check | why |
|---|---|---|---|---|
| correct-latin-lite | flash-lite → agy-3.8-flash-low (agy@1) | provisional | made-worse bar 5% at the blind-judge instrument; P(clears) 0.68 | P(worse) 0.039 [0.014, 0.085], net pages improved per page 0.76; 861,506 pages waiting; most-read first; the allocation uses a different route from the §3a choice because the choice's channel is full |
| correct-latin-flash3 | stored-mixed → opus-5.5 (opus-5.5@10) | settled | made-worse bar 5% at the blind-judge instrument; P(clears) 0.94 | P(worse) 0.024 [0.009, 0.052], net pages improved per page 0.81; 1,317,806 pages waiting; most-read first |
| correct-chinese-flash3 | stored-mixed → opus-5.5 (opus-5.5@10) | provisional | made-worse bar 5% at the blind-judge instrument; P(clears) 0.84 | P(worse) 0.022 [0.005, 0.066], net pages improved per page 0.40; 103,878 pages waiting; most-read first |
| correct-zh-frame-6871 | paddleocr-vl → opus-5.5 (opus-5.5@1) | provisional | made-worse bar 5% at the mechanical instrument; P(clears) 0.62 | P(worse) 0.041 [0.013, 0.104], net pages improved per page 0.66; 22,220 pages waiting; most-read first |
| correct-zh-paddle-dice-lt090 | paddleocr-vl → agy-3.8-flash-high (agy@1) | provisional | made-worse bar 5% at the mechanical instrument; P(clears) 0.80 | P(worse) 0.027 [0.005, 0.083], net pages improved per page 0.28; 453,715 pages waiting; most-read first |
| correct-zh-siku-stale | paddleocr-vl → opus-5.5+siku-v2 (opus-5.5@1) | provisional | made-worse bar 10% at the mechanical instrument; P(clears) 0.62 | P(worse) 0.091 [0.051, 0.144], net pages improved per page 0.27; 24,834 pages waiting; most-read first |
| correct-tibetan-yigdzin | yigdzin → opus-5.5 (opus-5.5@1) | provisional | made-worse bar 5% at the leaf-audit-tiles instrument; P(clears) 0.74 | P(worse) 0.024 [0.003, 0.141], net pages improved per page 0.43; 280,623 pages waiting; most-read first |

Every route per cell:

| cell | corrector (stage) | basis | P(worse) [90%] | P(better) [90%] | net gain [90%] | P(clears) | tier | P(best) | capacity per 1K pages |
|---|---|---|---|---|---|---|---|---|---|
| latin-lite | opus-5.5 (opus-5.5@10) | measured | 0.028 [0.008, 0.076] | 0.87 [0.79, 0.92] | 0.80 [0.69, 0.88] | 0.83 | provisional | 0.641 | 0.0481 acct-wk |
| latin-lite | agy-3.8-flash-low (agy@1) | measured | 0.039 [0.014, 0.085] | 0.85 [0.77, 0.91] | 0.76 [0.65, 0.85] | 0.68 | provisional | 0.269 | 1.02e+03 agy calls + 0.00805 acct-wk |
| latin-lite | redo:agy-3.8-flash-low (agy-redo@1) | measured | 0.037 [0.012, 0.082] | 0.80 [0.71, 0.86] | 0.72 [0.60, 0.81] | 0.71 | provisional | 0.089 | 1.05e+03 agy calls + 0.00805 acct-wk |
| latin-lite | agy-gemini-4-argon-low (agy@1) | pooled | 0.045 [0.004, 0.405] | 0.90 [0.42, 0.99] | 0.74 [-0.07, 0.96] | 0.52 | provisional | — | 1.02e+03 agy calls + 0.00805 acct-wk |
| latin-lite | sonnet-5.5 (sonnet-5.5@1) | pooled | 0.037 [0.003, 0.308] | 0.75 [0.20, 0.98] | 0.61 [-0.06, 0.93] | 0.58 | provisional | — | 0.0581 acct-wk |
| latin-flash3 | opus-5.5 (opus-5.5@10) | measured | 0.024 [0.009, 0.052] | 0.87 [0.62, 0.99] | 0.81 [0.57, 0.94] | 0.94 | routable | 1.0 | 0.0481 acct-wk |
| latin-flash3 | agy-3.8-flash-low (agy@1) | pooled | 0.044 [0.004, 0.343] | 0.87 [0.29, 0.99] | 0.70 [-0.03, 0.95] | 0.53 | provisional | — | 1.02e+03 agy calls + 0.00805 acct-wk |
| german-flash3 | opus-5.5 (opus-5.5@10) | measured | 0.075 [0.029, 0.156] | 0.75 [0.22, 0.98] | 0.58 [0.04, 0.85] | 0.21 | no | 1.0 | 0.0485 acct-wk |
| german-flash3 | agy-3.8-flash-low (agy@1) | pooled | 0.060 [0.005, 0.472] | 0.81 [0.16, 0.99] | 0.56 [-0.30, 0.93] | 0.44 | no | — | 1.02e+03 agy calls + 0.00852 acct-wk |
| greek-flash3 | opus-5.5 (opus-5.5@10) | measured | 0.011 [0.001, 0.052] | 0.74 [0.14, 0.98] | 0.70 [0.11, 0.95] | 0.94 | routable | 1.0 | 0.0487 acct-wk |
| chinese-flash3 | opus-5.5 (opus-5.5@10) | measured | 0.022 [0.005, 0.066] | 0.46 [0.05, 0.92] | 0.40 [0.00, 0.87] | 0.84 | provisional | 1.0 | 0.0415 acct-wk |
| arabic-flash3 | opus-5.5 (opus-5.5@10) | pooled | 0.014 [0.002, 0.072] | 0.73 [0.15, 0.98] | 0.69 [0.09, 0.95] | 0.88 | provisional | — | 0.0489 acct-wk |
| hebrew-flash3 | opus-5.5 (opus-5.5@10) | pooled | 0.019 [0.002, 0.142] | 0.74 [0.15, 0.98] | 0.66 [0.05, 0.94] | 0.77 | provisional | — | 0.048 acct-wk |
| german-lite | opus-5.5 (opus-5.5@10) | pooled | 0.024 [0.002, 0.217] | 0.81 [0.18, 0.99] | 0.70 [0.03, 0.96] | 0.69 | provisional | — | 0.0485 acct-wk |
| german-lite | agy-3.8-flash-low (agy@1) | pooled | 0.051 [0.004, 0.425] | 0.86 [0.21, 0.99] | 0.66 [-0.22, 0.95] | 0.49 | no | — | 1.02e+03 agy calls + 0.00852 acct-wk |
| french-lite | opus-5.5 (opus-5.5@10) | pooled | 0.017 [0.001, 0.170] | 0.81 [0.15, 0.99] | 0.72 [0.05, 0.96] | 0.77 | provisional | — | 0.0486 acct-wk |
| french-lite | agy-3.8-flash-low (agy@1) | pooled | 0.038 [0.003, 0.370] | 0.85 [0.19, 0.99] | 0.68 [-0.10, 0.96] | 0.57 | provisional | — | 1.02e+03 agy calls + 0.0086 acct-wk |
| zh-frame-6871 | opus-5.5 (opus-5.5@1) | measured | 0.041 [0.013, 0.104] | 0.75 [0.63, 0.84] | 0.66 [0.50, 0.78] | 0.62 | provisional | 0.927 | 0.0992 acct-wk |
| zh-frame-6871 | agy-3.8-flash-high (agy@1) | measured | 0.061 [0.021, 0.134] | 0.59 [0.46, 0.71] | 0.46 [0.27, 0.61] | 0.37 | no | 0.073 | 1.02e+03 agy calls + 0.0092 acct-wk |
| zh-frame-6871 | sonnet-5.5 (sonnet-5.5@1) | measured | 0.243 [0.146, 0.365] | 0.50 [0.38, 0.62] | 0.01 [-0.25, 0.24] | 0.00 | no | 0.0 | 0.0592 acct-wk |
| zh-frame-6871 | flash-lite-p2 (lite-batch) | measured | 0.680 [0.552, 0.784] | 0.05 [0.01, 0.11] | -1.31 [-1.52, -1.05] | 0.00 | no | 0.0 | 1.5 $ + 0.0092 acct-wk |
| zh-frame-6871 | agy-3.8-flash-low (agy@1) | pooled | 0.213 [0.027, 0.744] | 0.41 [0.07, 0.88] | -0.04 [-1.11, 0.63] | 0.11 | no | — | 1.02e+03 agy calls + 0.0092 acct-wk |
| zh-frame-6871 | agy-gemini-4-argon-low (agy@1) | pooled | 0.257 [0.027, 0.799] | 0.42 [0.07, 0.89] | -0.11 [-1.22, 0.61] | 0.10 | no | — | 1.02e+03 agy calls + 0.0092 acct-wk |
| zh-paddle-dice-lt090 | opus-5.5 (opus-5.5@1) | measured | 0.063 [0.020, 0.148] | 0.40 [0.26, 0.54] | 0.26 [0.05, 0.44] | 0.35 | no | 0.46 | 0.0915 acct-wk |
| zh-paddle-dice-lt090 | agy-3.8-flash-high (agy@1) | measured | 0.027 [0.005, 0.083] | 0.34 [0.21, 0.48] | 0.28 [0.12, 0.43] | 0.80 | provisional | 0.535 | 1.02e+03 agy calls + 0.00147 acct-wk |
| zh-paddle-dice-lt090 | sonnet-5.5 (sonnet-5.5@1) | measured | 0.185 [0.094, 0.314] | 0.28 [0.17, 0.43] | -0.09 [-0.36, 0.14] | 0.00 | no | 0.004 | 0.0515 acct-wk |
| zh-paddle-dice-lt090 | flash-lite-p2 (lite-batch) | measured | 0.293 [0.175, 0.436] | 0.16 [0.08, 0.29] | -0.42 [-0.72, -0.16] | 0.00 | no | 0.0 | 1.5 $ + 0.00147 acct-wk |
| zh-siku-stale | opus-5.5 (opus-5.5@1) | measured | 0.139 [0.078, 0.223] | 0.41 [0.31, 0.52] | 0.13 [-0.06, 0.30] | 0.16 | no | 0.143 | 0.0915 acct-wk |
| zh-siku-stale | opus-5.5+siku-v2 (opus-5.5@1) | measured | 0.091 [0.051, 0.144] | 0.45 [0.38, 0.54] | 0.27 [0.14, 0.38] | 0.62 | provisional | 0.857 | 0.0915 acct-wk |
| tibetan-yigdzin | agy-3.8-flash-low (agy@1) | measured | 0.083 [0.019, 0.238] | 0.75 [0.53, 0.89] | 0.56 [0.22, 0.79] | 0.27 | no | 0.488 | 1.02e+03 agy calls + 0.00686 acct-wk |
| tibetan-yigdzin | agy-gemini-4-argon-low (agy@1) | measured | 0.130 [0.037, 0.319] | 0.68 [0.46, 0.85] | 0.40 [-0.03, 0.69] | 0.10 | no | 0.09 | 1.02e+03 agy calls + 0.00686 acct-wk |
| tibetan-yigdzin | opus-5.5 (opus-5.5@1) | measured | 0.024 [0.003, 0.141] | 0.50 [0.23, 0.78] | 0.43 [0.11, 0.72] | 0.74 | provisional | 0.132 | 0.0969 acct-wk |
| tibetan-yigdzin | agy-3.1-pro (agy@1) | measured | 0.253 [0.071, 0.588] | 0.59 [0.29, 0.85] | 0.07 [-0.64, 0.54] | 0.02 | no | 0.005 | 1.02e+03 agy calls + 0.00686 acct-wk |
| tibetan-yigdzin | flash-lite-p2 (lite-batch) | measured | 0.059 [0.008, 0.269] | 0.66 [0.34, 0.89] | 0.49 [0.03, 0.80] | 0.44 | no | 0.285 | 1.5 $ + 0.00686 acct-wk |
| tibetan-yigdzin | sonnet-5.5 (sonnet-5.5@1) | measured | 0.038 [0.005, 0.196] | 0.03 [0.01, 0.10] | -0.04 [-0.36, 0.05] | 0.23 | no | 0.0 | 0.0569 acct-wk |
