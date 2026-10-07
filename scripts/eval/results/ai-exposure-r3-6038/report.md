# #6038 run 3 report (generated 2026-10-07T00:10:14.211Z)

## Layer A gates

| control | works ≥1 hit | works ≥2 hits | passages |
|---|---|---|---|
| pweb | 92.6% [76.6–97.9] (25/27) | 81.5% [63.3–91.8] (22/27) | 68.2% [59.8–75.5] (90/132) |
| pours | 57.1% [39.1–73.5] (16/28) | 42.9% [26.5–60.9] (12/28) | 38.0% [30.3–46.3] (52/137) |
| pia | — | — | — |
| neg | 0.0% [0.0–0.8] (0/496) | 0.0% [0.0–0.8] (0/496) | 0.0% [0.0–0.8] (0/496) |

A broken: **false**; strict headline (A++): false. Indexes complete for main: 

| index family | P-web works | P-ours works | P-IA works | negatives (passages) | the 500 (works) |
|---|---|---|---|---|---|
| any (completed indexes) | 92.6% [76.6–97.9] (25/27) | 57.1% [39.1–73.5] (16/28) | — | 0.0% [0.0–0.8] (0/496) | — |
| CC 2025-30 | 85.2% [67.5–94.1] (23/27) | 42.9% [26.5–60.9] (12/28) | — | 0.0% [0.0–0.8] (0/496) | — |
| CC 2025-05 | — | — | — | — | — |
| OLMo-2 mix (incl. DCLM-baseline) | 70.4% [51.5–84.1] (19/27) | 35.7% [20.7–54.2] (10/28) | — | 0.0% [0.0–0.8] (0/496) | — |
| Dolma 1.7 | 77.8% [59.2–89.4] (21/27) | 42.9% [26.5–60.9] (12/28) | — | 0.0% [0.0–0.8] (0/496) | — |
| RedPajama | 59.3% [40.7–75.5] (16/27) | 42.9% [26.5–60.9] (12/28) | — | — | — |
| Pile | — | — | — | — | — |

## Layer A presence (the 500)

- A+ (≥1 passage): 0.0% [0.0–0.8] (0/496); A++: 0.0% [0.0–0.8] (0/496); of W: 0.0% [0.0–0.9] (0/416); sensitivity-adjusted upper bound 0.0%
- by language: Latin 0.0% [0.0–1.4] (0/278); German 0.0% [0.0–6.5] (0/55); English 0.0% [0.0–8.0] (0/44); Tibetan/Sanskrit/Pali 0.0% [0.0–9.4] (0/37); other European 0.0% [0.0–9.4] (0/37); other 0.0% [0.0–12.9] (0/26); CJK 0.0% [0.0–16.8] (0/19)
- by provider: internet_archive 0.0% [0.0–2.1] (0/182); mdz 0.0% [0.0–2.6] (0/146); other 0.0% [0.0–2.9] (0/130); e-rara 0.0% [0.0–9.2] (0/38)
- by visible/held: visible 0.0% [0.0–1.4] (0/270); held 0.0% [0.0–1.7] (0/226)
- by century: unknown 0.0% [0.0–1.5] (0/253); 18th c. 0.0% [0.0–5.4] (0/67); 17th c. 0.0% [0.0–6.3] (0/57); 16th c. 0.0% [0.0–9.2] (0/38); 19th c. 0.0% [0.0–9.6] (0/36); 1900+ 0.0% [0.0–11.7] (0/29); 15th c. 0.0% [0.0–27.8] (0/10); before 1400 0.0% [0.0–39.0] (0/6)
- by genre: other 0.0% [0.0–1.0] (0/365); disputatio/oratio/dissertatio 0.0% [0.0–4.6] (0/79); scripture/commentary 0.0% [0.0–8.0] (0/44); manuscript 0.0% [0.0–32.4] (0/8)
- by run-2 recall (W): not recalled 0.0% [0.0–1.7] (0/217); recalled 0.0% [0.0–1.9] (0/199)

## Layer B (content knowledge)

Broken: **true**. Famous controls: valid 99; guessable 62.6% [52.8–71.5] (62/99); closed-book all 67.7% [58.0–76.1] (67/99); closed-book non-guessable 24.3% [13.4–40.1] (9/37). Gate {"nonguess_ge_60":false,"guessable_le_40":false,"margin_ge_25":false}. Judge vs eye: 96% κ 0.92 (n 50). Open-book valid 98.6% [97.6–99.1] (959/973).

## Layer C (public e-text)

- any 73.8% [69.8–77.5] (369/500); curated 6.0% [4.2–8.4] (30/500); raw OCR only 67.8% [63.6–71.7] (339/500); provider OCR unknown 21.4% [18.0–25.2] (107/500); of W 81.0% [77.0–84.5] (337/416)
- by provider: internet_archive 100.0% [97.9–100.0] (182/182); mdz 98.6% [95.1–99.6] (144/146); other 11.9% [7.5–18.5] (16/134); e-rara 71.1% [55.2–83.0] (27/38)
- by language: Latin 84.2% [79.4–88.0] (234/278); German 50.9% [38.1–63.6] (28/55); English 86.4% [73.3–93.6] (38/44); Tibetan/Sanskrit/Pali 37.8% [24.1–53.9] (14/37); other European 54.1% [38.4–69.0] (20/37); other 63.3% [45.5–78.1] (19/30); CJK 84.2% [62.4–94.5] (16/19)

## Agreement

- R_vs_Aplus_W: n 416, both 0, only first 199, only second 0, neither 217, agree 52.2%, κ 0.00
- R_vs_C_W: n 416, both 171, only first 28, only second 166, neither 51, agree 53.4%, κ 0.09
- Aplus_vs_C_500: n 496, both 0, only first 0, only second 365, neither 131, agree 26.4%, κ 0.00

## Fused: strongest offer

- primary (W): works 12.3% [9.4–15.8] (51/416); volumes 9.1% [6.3%–12.6%]; pages 6.5% [3.5%–10.2%]
- conservative (W, provider OCR unknown excluded): works 4.8% [3.1–7.3] (20/416); volumes 3.4% [1.9%–5.2%]; pages 2.8% [0.6%–6.0%]
- without A (W): works 12.3% [9.4–15.8] (51/416); volumes 9.1% [6.3%–12.6%]; pages 6.5% [3.5%–10.2%]
- unrestricted (500): works 20.6% [17.3–24.4] (103/500); volumes 15.5% [11.6%–19.9%]; pages 10.9% [7.3%–15.3%]
- by language: Latin 10.0% [6.9–14.1] (27/271); German 23.1% [12.6–38.3] (9/39); English 5.9% [1.6–19.1] (2/34); other European 20.0% [9.5–37.3] (6/30); other 16.7% [5.8–39.2] (3/18); CJK 5.9% [1.0–27.0] (1/17); Tibetan/Sanskrit/Pali 42.9% [15.8–75.0] (3/7)
- by visible/held: visible 14.8% [10.9–19.9] (35/236); held 8.9% [5.5–14.0] (16/180)
- by provider: internet_archive 0.0% [0.0–2.3] (0/160); mdz 1.4% [0.4–5.0] (2/142); other 54.4% [43.5–65.0] (43/79); e-rara 17.1% [8.1–32.7] (6/35)
- by genre: other 13.2% [9.8–17.4] (40/304); disputatio/oratio/dissertatio 11.4% [6.1–20.3] (9/79); scripture/commentary 6.1% [1.7–19.6] (2/33)

Gemini spend: $6.65 (endpoint eval/ai-exposure-r3).
