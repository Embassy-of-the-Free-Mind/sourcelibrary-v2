| cell | pages waiting (read-weighted) | route (cheapest that matches Opus; else Opus) | P(matches Opus) | net gain / page [90%] | P(worse) | capacity per 1K pages | share of the free week, week 1 | first quarter (pages by route) | weeks to drain | top 10% / 50% of reads done by week | what waits meanwhile |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Latin print read by Flash-Lite | 861,506 (1,568,440) | **opus-5.5** (Opus fallback) | 1.00 | 0.80 [0.71, 0.87] | 0.004 | 0.0481 acct-wk | — | opus-5.5 87,293 | 78 | 4 / 17 | 774,213 pages after the quarter stay on the lite text (Flash-Lite Batch read) |
| Latin print read by Gemini 3 Flash (most-read books) | 1,317,806 (4,949,396) | **opus-5.5** (Opus fallback) | 1.00 | 0.83 [0.60, 0.96] | 0.005 | 0.0481 acct-wk | 88% claude | opus-5.5 264,356 | 78 | 1 / 2 | 1,053,450 pages after the quarter stay on the Gemini 3 Flash text |
| German read by Gemini 3 Flash | 353,186 (1,359,293) | **opus-5.5** (Opus fallback) | 1.00 | 0.75 [0.23, 0.96] | 0.004 | 0.0485 acct-wk | — | opus-5.5 93,127 | 78 | 3 / 6 | 260,059 pages after the quarter stay on the Gemini 3 Flash text |
| Greek read by Gemini 3 Flash | 419,150 (894,950) | **held**: Derek 2026-10-14 (#6694): Greek stays on lane A | — | 0.73 (Opus) | 0.004 | 0.0487 acct-wk | — | — | — | — | all on the Gemini 3 Flash text |
| Chinese read by Gemini 3 Flash | 103,878 (121,280) | **opus-5.5** (Opus fallback) | 1.00 | 0.51 [0.07, 0.91] | 0.005 | 0.0415 acct-wk | — | opus-5.5 5,231 | 104 | 8 / 17 | 98,647 pages after the quarter stay on the Gemini 3 Flash text |
| Arabic read by Gemini 3 Flash | 30,244 (201,378) | **opus-5.5** (Opus fallback) | 1.00 | 0.72 [0.13, 0.97] | 0.004 | 0.0489 acct-wk | 4% claude | opus-5.5 7,608 | 104 | 1 / 1 | 22,636 pages after the quarter stay on the Gemini 3 Flash text |
| Hebrew read by Gemini 3 Flash | 51,360 (290,359) | **opus-5.5** (Opus fallback) | 1.00 | 0.71 [0.14, 0.96] | 0.005 | 0.048 acct-wk | 6% claude | opus-5.5 15,537 | 104 | 1 / 1 | 35,823 pages after the quarter stay on the Gemini 3 Flash text |
| German read by Flash-Lite | 418,603 (843,556) | **opus-5.5** (Opus fallback) | 1.00 | 0.77 [0.15, 0.97] | 0.005 | 0.0485 acct-wk | — | opus-5.5 42,094 | 104 | 3 / 17 | 376,509 pages after the quarter stay on the lite text |
| French read by Flash-Lite | 151,443 (473,237) | **opus-5.5** (Opus fallback) | 1.00 | 0.77 [0.14, 0.97] | 0.005 | 0.0486 acct-wk | — | opus-5.5 24,078 | 104 | 2 / 8 | 127,365 pages after the quarter stay on the lite text |
| Chinese tables and mixed pages newly read by guarded Paddle (#6871) | 22,220 (7,410) | **opus-5.5** (Opus fallback) | 1.00 | 0.67 [0.51, 0.79] | 0.038 | 0.0992 acct-wk | — | — | 104 | 104 / 104 | 22,220 pages after the quarter stay on the guarded Paddle text, Opus-translated by job zh-translate-route-6871 |
| Chinese Paddle pages whose Kanripo screen is below 0.90 dice | 453,715 (166,906) | **opus-5.5** (Opus fallback) | 1.00 | 0.27 [0.08, 0.45] | 0.058 | 0.0915 acct-wk | — | — | 130 | 104 / 104 | 453,715 pages after the quarter stay on the Paddle text |
| Stale Siku pages, high old-vs-new change (#6561 item 1) | 24,834 (9,448) | **opus-5.5+siku-v2** (Opus fallback) | 1.00 | 0.27 [0.14, 0.39] | 0.090 | 0.0915 acct-wk | — | — | 104 | 104 / 104 | 24,834 pages after the quarter stay on the Paddle text |
| Tibetan read by Yigdzin | 280,623 (194,496) | **opus-5.5** (Opus fallback) | 1.00 | 0.45 [0.15, 0.73] | 0.015 | 0.0969 acct-wk | — | — | 104 | 43 / 104 | 280,623 pages after the quarter stay on the Yigdzin text |

Tests reserved from the same budget (route-judge-6740 design: 30 pages per route, one Opus reader against Opus):

| cell | route under test | basis | P(matches Opus) now | n | draw |
|---|---|---|---|---|---|
| latin-lite | agy-3.8-flash-low | measured | 0.77 | 30 | 30.6 agy calls + 0.00338 acct-wk |
| latin-lite | redo:agy-3.8-flash-low | measured | 0.53 | 30 | 31.5 agy calls + 0.00338 acct-wk |
| latin-lite | agy-gemini-4-argon-low | pooled | 0.60 | 30 | 30.6 agy calls + 0.00338 acct-wk |
| latin-flash3 | agy-3.8-flash-low | pooled | 0.52 | 30 | 30.6 agy calls + 0.00338 acct-wk |
| german-flash3 | agy-3.8-flash-low | pooled | 0.55 | 30 | 30.6 agy calls + 0.00338 acct-wk |
| german-lite | agy-3.8-flash-low | pooled | 0.62 | 30 | 30.6 agy calls + 0.00338 acct-wk |
| french-lite | agy-3.8-flash-low | pooled | 0.59 | 30 | 30.6 agy calls + 0.00338 acct-wk |
| zh-paddle-dice-lt090 | agy-3.8-flash-high | measured | 0.65 | 30 | 30.6 agy calls + 0.00338 acct-wk |
| tibetan-yigdzin | agy-3.8-flash-low | measured | 0.80 | 30 | 30.6 agy calls + 0.00338 acct-wk |
| tibetan-yigdzin | agy-gemini-4-argon-low | measured | 0.54 | 30 | 30.6 agy calls + 0.00338 acct-wk |
| tibetan-yigdzin | flash-lite-p2 | measured | 0.72 | 30 | 0.045 $ + 0.00338 acct-wk |

This week: idle quota (projected unused at the reset, at the current pace), priced at 0:

| account | used | resets | projected at reset | idle (account-weeks) | to the tests | then (pages, by cell) |
|---|---|---|---|---|---|---|
| main (team@) | 88% | 2026-10-27T14:00Z (38.3 h) | 114.0% | 0.0 | — | — |
| gex45 (GM) | 52% | 2026-10-27T11:00Z (35.3 h) | 65.8% | 0.342 | 0.0371 | latin-flash3 2,106; arabic-flash3 1,560; hebrew-flash3 2,653 |
| l7a (SLd) | 66% | 2026-10-29T22:00Z (94.3 h) | 150.5% | 0.0 | — | — |
| cloudlayer (PP) | 20% | 2026-10-31T15:00Z (135.3 h) | 102.9% | 0.0 | — | — |

Decisions, in capacity terms (each forces one route on one cell; the LP re-plans everything else):

| decision | cell, route | whole cell draws | top 10% / 25% / 50% / 100% of reads done by week (competing) | the same, with the channel to itself | pages in the first quarter | what it displaces in the quarter (pages; net pages improved) |
|---|---|---|---|---|---|---|
| 5924: Opus corrects lite Latin (by reads) | latin-lite, opus-5.5 | 41.4 acct-wk | 4 / 4 / 17 / 78 | 0.1 / 0.61 / 2.85 / 20.7 | 87,293 | nothing |
| 5924: Opus corrects lite Latin, ahead of every other cell | latin-lite, opus-5.5 | 41.4 acct-wk | 1 / 1 / 3 / 21 | 0.1 / 0.61 / 2.85 / 20.7 | 540,330 | latin-flash3 -264,356 (-214,763); hebrew-flash3 -15,537 (-10,043); chinese-flash3 -5,231 (-2,637); german-flash3 -93,127 (-64,453); arabic-flash3 -7,608 (-4,958); french-lite -24,078 (-16,424); german-lite -42,094 (-29,108) |
| 6560: Flash-low correction pass over Yigdzin Tibetan, now | tibetan-yigdzin, agy-3.8-flash-low | 2.86e+05 agy calls + 1.93 acct-wk | 1 / 1 / 2 / 8 | 0.1 / 0.37 / 1.23 / 7.33 | 280,623 | latin-flash3 -2,809 (-2,282); hebrew-flash3 -4,568 (-2,953); german-flash3 -22,441 (-15,532); arabic-flash3 -1,386 (-903); french-lite -8,539 (-5,824) |
| 6561/6871: Opus corrects the newly read Paddle tables (by reads) | zh-frame-6871, opus-5.5 | 2.2 acct-wk | 104 / 104 / 104 / 104 | 0.11 / 0.27 / 0.55 / 1.1 | 0 | nothing |
| 6561/6871: Opus corrects the newly read Paddle tables, now | zh-frame-6871, opus-5.5 | 2.2 acct-wk | 1 / 1 / 1 / 2 | 0.11 / 0.27 / 0.55 / 1.1 | 22,220 | latin-flash3 -8,600 (-6,987); hebrew-flash3 -4,568 (-2,953); german-flash3 -22,441 (-15,532); arabic-flash3 -1,386 (-903); french-lite -8,539 (-5,824) |

Sensitivity (weeks to drain; pages in the first quarter):

| cell | base | agy x0.7 | agy x1.3 | if every test confirms | tests confirm, agy x0.7 | tests confirm, agy x1.3 | Opus@10 draw low | Opus@10 draw high | harm weight 1 | harm weight 4 |
|---|---|---|---|---|---|---|---|---|---|---|
| latin-lite | 78 wk; 87,293 | 78 wk; 87,293 | 78 wk; 87,293 | 43 wk; 241,384 | 43 wk; 208,699 | 34 wk; 258,738 | 43 wk; 258,738 | 130 wk; 43,133 | 26 wk; 455,295 | 78 wk; 87,293 |
| latin-flash3 | 78 wk; 264,356 | 78 wk; 264,356 | 78 wk; 264,356 | 43 wk; 395,877 (opus-5.5 303,598, agy-3.8-flash-low 92,279) | 52 wk; 329,890 (opus-5.5 328,878, agy-3.8-flash-low 1,012) | 43 wk; 451,685 (opus-5.5 273,946, agy-3.8-flash-low 177,740) | 43 wk; 461,563 | 130 wk; 197,806 | 65 wk; 264,356 | 78 wk; 264,356 |
| german-flash3 | 78 wk; 93,127 | 78 wk; 93,127 | 78 wk; 93,127 | 52 wk; 141,710 (opus-5.5 70,686, agy-3.8-flash-low 71,024) | 52 wk; 123,818 (opus-5.5 70,686, agy-3.8-flash-low 53,132) | 43 wk; 159,686 (opus-5.5 70,686, agy-3.8-flash-low 89,000) | 43 wk; 159,686 | 130 wk; 58,993 | 65 wk; 98,067 | 78 wk; 97,069 |
| chinese-flash3 | 104 wk; 5,231 | 104 wk; 5,231 | 104 wk; 5,231 | 52 wk; 10,628 | 65 wk; 10,628 | 52 wk; 10,628 | 43 wk; 10,628 | 130 wk; 5,231 | 65 wk; 5,231 | 104 wk; 5,231 |
| arabic-flash3 | 104 wk; 7,608 | 104 wk; 7,608 | 104 wk; 7,608 | 52 wk; 9,171 | 52 wk; 9,171 | 43 wk; 10,642 | 43 wk; 13,115 | 130 wk; 4,843 | 65 wk; 7,608 | 104 wk; 6,222 |
| hebrew-flash3 | 104 wk; 15,537 | 104 wk; 15,537 | 104 wk; 15,537 | 52 wk; 18,194 | 52 wk; 18,194 | 43 wk; 20,864 | 43 wk; 23,180 | 130 wk; 8,016 | 65 wk; 15,537 | 104 wk; 12,966 |
| german-lite | 104 wk; 42,094 | 104 wk; 42,094 | 104 wk; 42,094 | 52 wk; 83,721 (opus-5.5 21,590, agy-3.8-flash-low 62,131) | 52 wk; 83,721 (opus-5.5 21,590, agy-3.8-flash-low 62,131) | 43 wk; 104,749 (opus-5.5 21,590, agy-3.8-flash-low 83,159) | 43 wk; 90,105 | 130 wk; 21,590 | 65 wk; 42,094 | 104 wk; 42,094 |
| french-lite | 104 wk; 24,078 | 104 wk; 24,078 | 104 wk; 24,078 | 52 wk; 38,425 (opus-5.5 7,746, agy-3.8-flash-low 30,679) | 52 wk; 30,930 (opus-5.5 7,746, agy-3.8-flash-low 23,184) | 43 wk; 45,946 (opus-5.5 7,746, agy-3.8-flash-low 38,200) | 43 wk; 45,946 | 130 wk; 15,539 | 65 wk; 24,078 | 104 wk; 24,078 |
| zh-frame-6871 | 104 wk; 0 | 104 wk; 0 | 104 wk; 0 | 65 wk; 0 | 65 wk; 0 | 52 wk; 0 | 52 wk; 0 | 130 wk; 0 | 65 wk; 0 | 104 wk; 0 |
| zh-paddle-dice-lt090 | 130 wk; 0 | 130 wk; 0 | 130 wk; 0 | 52 wk; 0 | 65 wk; 0 | 52 wk; 0 | 78 wk; 0 | 208 wk; 0 | 104 wk; 0 | 130 wk; 0 |
| zh-siku-stale | 104 wk; 0 | 104 wk; 0 | 104 wk; 0 | 65 wk; 0 | 65 wk; 0 | 65 wk; 0 | 65 wk; 0 | 156 wk; 0 | 78 wk; 0 | 130 wk; 0 |
| tibetan-yigdzin | 104 wk; 0 | 104 wk; 0 | 104 wk; 0 | 21 wk; 98,233 | 26 wk; 98,233 | 21 wk; 98,233 | 65 wk; 0 | 156 wk; 0 | 34 wk; 42,202 | 104 wk; 0 |

Proposed routing-table rows (for #7170; the tables are not edited here):

| id | draft → route (fallback) | status | check | why |
|---|---|---|---|---|
| correct-latin-lite | flash-lite → opus-5.5 (opus-5.5) | Opus (the assumed reference; no cheaper route matches it at P >= 0.9 yet) | matches Opus: net gain within max(0.05, 10%) of Opus's in 1.00 of draws (blind-judge) | net pages improved per page 0.80 [0.71, 0.87], P(worse) 0.004; 861,506 pages waiting; most-read first |
| correct-latin-flash3 | stored-mixed → opus-5.5 (opus-5.5) | Opus (the assumed reference; no cheaper route matches it at P >= 0.9 yet) | matches Opus: net gain within max(0.05, 10%) of Opus's in 1.00 of draws (blind-judge) | net pages improved per page 0.83 [0.60, 0.96], P(worse) 0.005; 1,317,806 pages waiting; most-read first |
| correct-german-flash3 | stored-mixed → opus-5.5 (opus-5.5) | Opus (the assumed reference; no cheaper route matches it at P >= 0.9 yet) | matches Opus: net gain within max(0.05, 10%) of Opus's in 1.00 of draws (blind-judge) | net pages improved per page 0.75 [0.23, 0.96], P(worse) 0.004; 353,186 pages waiting; most-read first |
| correct-chinese-flash3 | stored-mixed → opus-5.5 (opus-5.5) | Opus (the assumed reference; no cheaper route matches it at P >= 0.9 yet) | matches Opus: net gain within max(0.05, 10%) of Opus's in 1.00 of draws (blind-judge) | net pages improved per page 0.51 [0.07, 0.91], P(worse) 0.005; 103,878 pages waiting; most-read first |
| correct-arabic-flash3 | stored-mixed → opus-5.5 (opus-5.5) | Opus (the assumed reference; no cheaper route matches it at P >= 0.9 yet) | matches Opus: net gain within max(0.05, 10%) of Opus's in 1.00 of draws (blind-judge) | net pages improved per page 0.72 [0.13, 0.97], P(worse) 0.004; 30,244 pages waiting; most-read first |
| correct-hebrew-flash3 | stored-mixed → opus-5.5 (opus-5.5) | Opus (the assumed reference; no cheaper route matches it at P >= 0.9 yet) | matches Opus: net gain within max(0.05, 10%) of Opus's in 1.00 of draws (blind-judge) | net pages improved per page 0.71 [0.14, 0.96], P(worse) 0.005; 51,360 pages waiting; most-read first |
| correct-german-lite | flash-lite → opus-5.5 (opus-5.5) | Opus (the assumed reference; no cheaper route matches it at P >= 0.9 yet) | matches Opus: net gain within max(0.05, 10%) of Opus's in 1.00 of draws (blind-judge) | net pages improved per page 0.77 [0.15, 0.97], P(worse) 0.005; 418,603 pages waiting; most-read first |
| correct-french-lite | flash-lite → opus-5.5 (opus-5.5) | Opus (the assumed reference; no cheaper route matches it at P >= 0.9 yet) | matches Opus: net gain within max(0.05, 10%) of Opus's in 1.00 of draws (blind-judge) | net pages improved per page 0.77 [0.14, 0.97], P(worse) 0.005; 151,443 pages waiting; most-read first |
| correct-zh-frame-6871 | paddleocr-vl → opus-5.5 (opus-5.5) | Opus (the assumed reference; no cheaper route matches it at P >= 0.9 yet) | matches Opus: net gain within max(0.05, 10%) of Opus's in 1.00 of draws (mechanical) | net pages improved per page 0.67 [0.51, 0.79], P(worse) 0.038; 22,220 pages waiting; most-read first |
| correct-zh-paddle-dice-lt090 | paddleocr-vl → opus-5.5 (opus-5.5) | Opus (the assumed reference; no cheaper route matches it at P >= 0.9 yet) | matches Opus: net gain within max(0.05, 10%) of Opus's in 1.00 of draws (mechanical) | net pages improved per page 0.27 [0.08, 0.45], P(worse) 0.058; 453,715 pages waiting; most-read first |
| correct-zh-siku-stale | paddleocr-vl → opus-5.5+siku-v2 (opus-5.5+siku-v2) | Opus (the assumed reference; no cheaper route matches it at P >= 0.9 yet) | matches Opus: net gain within max(0.05, 10%) of Opus's in 1.00 of draws (mechanical) | net pages improved per page 0.27 [0.14, 0.39], P(worse) 0.090; 24,834 pages waiting; most-read first |
| correct-tibetan-yigdzin | yigdzin → opus-5.5 (opus-5.5) | Opus (the assumed reference; no cheaper route matches it at P >= 0.9 yet) | matches Opus: net gain within max(0.05, 10%) of Opus's in 1.00 of draws (leaf-audit-tiles) | net pages improved per page 0.45 [0.15, 0.73], P(worse) 0.015; 280,623 pages waiting; most-read first |

Every route per cell:

| cell | route (stage) | basis | P(worse) [90%] | P(better) [90%] | net gain [90%] | P(matches Opus) | tier | P(best) | capacity per 1K pages |
|---|---|---|---|---|---|---|---|---|---|
| latin-lite | opus-5.5 (opus-5.5@10) | measured | 0.004 [0.001, 0.020] | 0.81 [0.73, 0.87] | 0.80 [0.71, 0.87] | 1.00 | opus | 0.572 | 0.0481 acct-wk |
| latin-lite | agy-3.8-flash-low (agy@1) | measured | 0.035 [0.011, 0.080] | 0.85 [0.77, 0.91] | 0.77 [0.66, 0.86] | 0.77 | to test | 0.327 | 1.02e+03 agy calls + 0.00805 acct-wk |
| latin-lite | redo:agy-3.8-flash-low (agy-redo@1) | measured | 0.034 [0.011, 0.081] | 0.80 [0.71, 0.87] | 0.72 [0.60, 0.81] | 0.53 | to test | 0.101 | 1.05e+03 agy calls + 0.00805 acct-wk |
| latin-lite | agy-gemini-4-argon-low (agy@1) | pooled | 0.021 [0.001, 0.264] | 0.88 [0.37, 0.99] | 0.79 [0.13, 0.97] | 0.60 | to test | — | 1.02e+03 agy calls + 0.00805 acct-wk |
| latin-lite | sonnet-5.5 (sonnet-5.5@1) | pooled | 0.015 [0.001, 0.156] | 0.72 [0.17, 0.97] | 0.65 [0.06, 0.95] | 0.41 | no | — | 0.0581 acct-wk |
| latin-lite | none (serve the draft) | measured | 0.000 [0.000, 0.000] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 | no | — | 0 |
| latin-flash3 | opus-5.5 (opus-5.5@10) | measured | 0.005 [0.001, 0.020] | 0.84 [0.61, 0.98] | 0.83 [0.60, 0.96] | 1.00 | opus | 1.0 | 0.0481 acct-wk |
| latin-flash3 | agy-3.8-flash-low (agy@1) | pooled | 0.019 [0.001, 0.207] | 0.86 [0.28, 0.99] | 0.76 [0.12, 0.96] | 0.52 | to test | — | 1.02e+03 agy calls + 0.00805 acct-wk |
| latin-flash3 | none (serve the draft) | measured | 0.000 [0.000, 0.000] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 | no | — | 0 |
| german-flash3 | opus-5.5 (opus-5.5@10) | measured | 0.004 [0.000, 0.023] | 0.77 [0.25, 0.98] | 0.75 [0.23, 0.96] | 1.00 | opus | 1.0 | 0.0485 acct-wk |
| german-flash3 | agy-3.8-flash-low (agy@1) | pooled | 0.021 [0.001, 0.234] | 0.81 [0.19, 0.99] | 0.71 [0.01, 0.96] | 0.55 | to test | — | 1.02e+03 agy calls + 0.00852 acct-wk |
| german-flash3 | none (serve the draft) | measured | 0.000 [0.000, 0.000] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 | no | — | 0 |
| greek-flash3 | opus-5.5 (opus-5.5@10) | measured | 0.004 [0.000, 0.028] | 0.75 [0.19, 0.98] | 0.73 [0.18, 0.97] | 1.00 | opus | 1.0 | 0.0487 acct-wk |
| greek-flash3 | none (serve the draft) | measured | 0.000 [0.000, 0.000] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.01 | no | — | 0 |
| chinese-flash3 | opus-5.5 (opus-5.5@10) | measured | 0.005 [0.001, 0.031] | 0.53 [0.08, 0.93] | 0.51 [0.07, 0.91] | 1.00 | opus | 1.0 | 0.0415 acct-wk |
| chinese-flash3 | none (serve the draft) | measured | 0.000 [0.000, 0.000] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.04 | no | — | 0 |
| arabic-flash3 | opus-5.5 (opus-5.5@10) | pooled | 0.004 [0.000, 0.039] | 0.75 [0.16, 0.98] | 0.72 [0.13, 0.97] | 1.00 | opus | — | 0.0489 acct-wk |
| arabic-flash3 | none (serve the draft) | measured | 0.000 [0.000, 0.000] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.02 | no | — | 0 |
| hebrew-flash3 | opus-5.5 (opus-5.5@10) | pooled | 0.005 [0.000, 0.049] | 0.73 [0.17, 0.98] | 0.71 [0.14, 0.96] | 1.00 | opus | — | 0.048 acct-wk |
| hebrew-flash3 | none (serve the draft) | measured | 0.000 [0.000, 0.000] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.02 | no | — | 0 |
| german-lite | opus-5.5 (opus-5.5@10) | pooled | 0.005 [0.000, 0.058] | 0.81 [0.19, 0.98] | 0.77 [0.15, 0.97] | 1.00 | opus | — | 0.0485 acct-wk |
| german-lite | agy-3.8-flash-low (agy@1) | pooled | 0.022 [0.002, 0.268] | 0.86 [0.23, 0.99] | 0.76 [0.04, 0.96] | 0.62 | to test | — | 1.02e+03 agy calls + 0.00852 acct-wk |
| german-lite | none (serve the draft) | measured | 0.000 [0.000, 0.000] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.02 | no | — | 0 |
| french-lite | opus-5.5 (opus-5.5@10) | pooled | 0.005 [0.000, 0.060] | 0.80 [0.17, 0.98] | 0.77 [0.14, 0.97] | 1.00 | opus | — | 0.0486 acct-wk |
| french-lite | agy-3.8-flash-low (agy@1) | pooled | 0.023 [0.002, 0.265] | 0.85 [0.22, 0.99] | 0.72 [0.02, 0.97] | 0.59 | to test | — | 1.02e+03 agy calls + 0.0086 acct-wk |
| french-lite | none (serve the draft) | measured | 0.000 [0.000, 0.000] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.02 | no | — | 0 |
| zh-frame-6871 | opus-5.5 (opus-5.5@1) | measured | 0.038 [0.010, 0.098] | 0.75 [0.63, 0.85] | 0.67 [0.51, 0.79] | 1.00 | opus | 0.942 | 0.0992 acct-wk |
| zh-frame-6871 | agy-3.8-flash-high (agy@1) | measured | 0.062 [0.023, 0.135] | 0.59 [0.46, 0.71] | 0.46 [0.28, 0.61] | 0.13 | no | 0.059 | 1.02e+03 agy calls + 0.0092 acct-wk |
| zh-frame-6871 | sonnet-5.5 (sonnet-5.5@1) | measured | 0.242 [0.154, 0.361] | 0.50 [0.37, 0.63] | 0.01 [-0.25, 0.24] | 0.00 | no | 0.0 | 0.0592 acct-wk |
| zh-frame-6871 | flash-lite-p2 (lite-batch) | measured | 0.678 [0.553, 0.787] | 0.05 [0.01, 0.11] | -1.31 [-1.53, -1.05] | 0.00 | no | 0.0 | 1.5 $ + 0.0092 acct-wk |
| zh-frame-6871 | agy-3.8-flash-low (agy@1) | pooled | 0.302 [0.040, 0.801] | 0.42 [0.07, 0.88] | -0.18 [-1.25, 0.58] | 0.05 | no | — | 1.02e+03 agy calls + 0.0092 acct-wk |
| zh-frame-6871 | agy-gemini-4-argon-low (agy@1) | pooled | 0.296 [0.036, 0.832] | 0.43 [0.07, 0.89] | -0.18 [-1.28, 0.58] | 0.05 | no | — | 1.02e+03 agy calls + 0.0092 acct-wk |
| zh-frame-6871 | none (serve the draft) | measured | 0.000 [0.000, 0.000] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 | no | — | 0 |
| zh-paddle-dice-lt090 | opus-5.5 (opus-5.5@1) | measured | 0.058 [0.017, 0.137] | 0.39 [0.26, 0.54] | 0.27 [0.08, 0.45] | 1.00 | opus | 0.487 | 0.0915 acct-wk |
| zh-paddle-dice-lt090 | agy-3.8-flash-high (agy@1) | measured | 0.028 [0.005, 0.088] | 0.34 [0.21, 0.48] | 0.27 [0.11, 0.43] | 0.65 | to test | 0.508 | 1.02e+03 agy calls + 0.00147 acct-wk |
| zh-paddle-dice-lt090 | sonnet-5.5 (sonnet-5.5@1) | measured | 0.186 [0.093, 0.313] | 0.29 [0.17, 0.43] | -0.09 [-0.38, 0.15] | 0.05 | no | 0.005 | 0.0515 acct-wk |
| zh-paddle-dice-lt090 | flash-lite-p2 (lite-batch) | measured | 0.297 [0.179, 0.435] | 0.16 [0.08, 0.28] | -0.43 [-0.72, -0.16] | 0.00 | no | 0.0 | 1.5 $ + 0.00147 acct-wk |
| zh-paddle-dice-lt090 | none (serve the draft) | measured | 0.000 [0.000, 0.000] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.03 | no | — | 0 |
| zh-siku-stale | opus-5.5 (opus-5.5@1) | measured | 0.136 [0.077, 0.213] | 0.41 [0.31, 0.52] | 0.14 [-0.05, 0.30] | 0.26 | no | 0.154 | 0.0915 acct-wk |
| zh-siku-stale | opus-5.5+siku-v2 (opus-5.5@1) | measured | 0.090 [0.050, 0.145] | 0.46 [0.38, 0.54] | 0.27 [0.14, 0.39] | 1.00 | opus | 0.846 | 0.0915 acct-wk |
| zh-siku-stale | none (serve the draft) | measured | 0.000 [0.000, 0.000] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 | no | — | 0 |
| tibetan-yigdzin | agy-3.8-flash-low (agy@1) | measured | 0.081 [0.019, 0.246] | 0.76 [0.55, 0.89] | 0.57 [0.21, 0.79] | 0.80 | to test | 0.449 | 1.02e+03 agy calls + 0.00686 acct-wk |
| tibetan-yigdzin | agy-gemini-4-argon-low (agy@1) | measured | 0.122 [0.032, 0.316] | 0.68 [0.47, 0.85] | 0.42 [0.02, 0.69] | 0.54 | to test | 0.092 | 1.02e+03 agy calls + 0.00686 acct-wk |
| tibetan-yigdzin | opus-5.5 (opus-5.5@1) | measured | 0.015 [0.002, 0.106] | 0.50 [0.23, 0.78] | 0.45 [0.15, 0.73] | 1.00 | opus | 0.148 | 0.0969 acct-wk |
| tibetan-yigdzin | agy-3.1-pro (agy@1) | measured | 0.228 [0.060, 0.555] | 0.60 [0.30, 0.85] | 0.12 [-0.57, 0.56] | 0.15 | no | 0.005 | 1.02e+03 agy calls + 0.00686 acct-wk |
| tibetan-yigdzin | flash-lite-p2 (lite-batch) | measured | 0.051 [0.007, 0.241] | 0.66 [0.35, 0.88] | 0.52 [0.09, 0.80] | 0.72 | to test | 0.306 | 1.5 $ + 0.00686 acct-wk |
| tibetan-yigdzin | sonnet-5.5 (sonnet-5.5@1) | measured | 0.032 [0.003, 0.180] | 0.03 [0.01, 0.10] | -0.03 [-0.33, 0.06] | 0.01 | no | 0.0 | 0.0569 acct-wk |
| tibetan-yigdzin | none (serve the draft) | measured | 0.000 [0.000, 0.000] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.02 | no | — | 0 |
