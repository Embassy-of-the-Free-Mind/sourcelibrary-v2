# #6038 run 3 report (generated 2026-10-07T04:58:45.527Z)

## Layer A gates

| control | works ≥1 hit | works ≥2 hits | passages |
|---|---|---|---|
| pweb | 96.3% [81.7–99.3] (26/27) | 88.9% [71.9–96.1] (24/27) | 77.3% [69.4–83.6] (102/132) |
| pours | 64.3% [45.8–79.3] (18/28) | 46.4% [29.5–64.2] (13/28) | 40.9% [33.0–49.2] (56/137) |
| pia | 11.3% [5.3–22.6] (6/53) | 9.4% [4.1–20.3] (5/53) | 5.3% [3.2–8.7] (14/265) |
| neg | 0.0% [0.0–0.8] (0/496) | 0.0% [0.0–0.8] (0/496) | 0.0% [0.0–0.8] (0/496) |

A broken: **false**; strict headline (A++): false. Indexes complete for main: v2_cc-2025-30, v2_cc-2025-05, v4_olmo-mix-1124_llama, v4_dolma-v1_7_llama, v4_rpj_llama_s4, v4_piletrain_llama

| index family | P-web works | P-ours works | P-IA works | negatives (passages) | the 500 (works) |
|---|---|---|---|---|---|
| any (completed indexes) | 96.3% [81.7–99.3] (26/27) | 64.3% [45.8–79.3] (18/28) | 11.3% [5.3–22.6] (6/53) | 0.0% [0.0–0.8] (0/496) | 14.5% [11.7–17.9] (72/496) |
| CC 2025-30 | 85.2% [67.5–94.1] (23/27) | 42.9% [26.5–60.9] (12/28) | 5.7% [1.9–15.4] (3/53) | 0.0% [0.0–0.8] (0/496) | 9.9% [7.6–12.8] (49/496) |
| CC 2025-05 | 81.5% [63.3–91.8] (22/27) | 50.0% [32.6–67.4] (14/28) | 5.7% [1.9–15.4] (3/53) | 0.0% [0.0–0.8] (0/496) | 9.7% [7.4–12.6] (48/496) |
| OLMo-2 mix (incl. DCLM-baseline) | 70.4% [51.5–84.1] (19/27) | 35.7% [20.7–54.2] (10/28) | 7.5% [3.0–17.9] (4/53) | 0.0% [0.0–0.8] (0/496) | 4.6% [3.1–6.9] (23/496) |
| Dolma 1.7 | 77.8% [59.2–89.4] (21/27) | 42.9% [26.5–60.9] (12/28) | 9.4% [4.1–20.3] (5/53) | 0.0% [0.0–0.8] (0/496) | 8.7% [6.5–11.5] (43/496) |
| RedPajama | 59.3% [40.7–75.5] (16/27) | 42.9% [26.5–60.9] (12/28) | 7.5% [3.0–17.9] (4/53) | 0.0% [0.0–0.8] (0/496) | 6.7% [4.8–9.2] (33/496) |
| Pile | 55.6% [37.3–72.4] (15/27) | 32.1% [17.9–50.7] (9/28) | 1.9% [0.3–9.9] (1/53) | 0.0% [0.0–0.8] (0/496) | 4.6% [3.1–6.9] (23/496) |

## Layer A presence (the 500)

- A+ (≥1 passage): 14.5% [11.7–17.9] (72/496); A++: 6.3% [4.4–8.7] (31/496); of W: 13.9% [10.9–17.6] (58/416); sensitivity-adjusted upper bound 22.6%
- provenance (by eye, seeded hits on CC 2025-30): {"same work":15,"shared quotation":11,"boilerplate":1,"doc not retrieved":12,"bibliographic record":1}; same-work share 53.6% [35.8–70.5] (15/28); A+ discounted to same-work 7.8%
- by language: Latin 6.8% [4.4–10.4] (19/278); German 3.6% [1.0–12.3] (2/55); English 61.4% [46.6–74.3] (27/44); Tibetan/Sanskrit/Pali 16.2% [7.7–31.1] (6/37); other European 16.2% [7.7–31.1] (6/37); other 19.2% [8.5–37.9] (5/26); CJK 36.8% [19.1–59.0] (7/19)
- by provider: internet_archive 26.9% [21.0–33.8] (49/182); mdz 6.2% [3.3–11.3] (9/146); other 8.5% [4.8–14.5] (11/130); e-rara 7.9% [2.7–20.8] (3/38)
- by visible/held: visible 18.5% [14.3–23.6] (50/270); held 9.7% [6.5–14.3] (22/226)
- by century: unknown 9.9% [6.8–14.2] (25/253); 18th c. 11.9% [6.2–21.8] (8/67); 17th c. 12.3% [6.1–23.2] (7/57); 16th c. 13.2% [5.8–27.3] (5/38); 19th c. 33.3% [20.2–49.7] (12/36); 1900+ 37.9% [22.7–56.0] (11/29); 15th c. 10.0% [1.8–40.4] (1/10); before 1400 50.0% [18.8–81.2] (3/6)
- by genre: other 16.4% [13.0–20.6] (60/365); disputatio/oratio/dissertatio 3.8% [1.3–10.6] (3/79); scripture/commentary 18.2% [9.5–32.0] (8/44); manuscript 12.5% [2.2–47.1] (1/8)
- by run-2 recall (W): not recalled 6.0% [3.5–10.0] (13/217); recalled 22.6% [17.4–28.9] (45/199)

## Layer B (content knowledge)

Broken: **true**. Famous controls: valid 99; guessable 62.6% [52.8–71.5] (62/99); closed-book all 67.7% [58.0–76.1] (67/99); closed-book non-guessable 24.3% [13.4–40.1] (9/37). Gate {"nonguess_ge_60":false,"guessable_le_40":false,"margin_ge_25":false}. Judge vs eye: 96% κ 0.92 (n 50). Open-book valid 98.6% [97.6–99.1] (959/973).

## Layer C (public e-text)

- any 73.8% [69.8–77.5] (369/500); curated 6.0% [4.2–8.4] (30/500); raw OCR only 67.8% [63.6–71.7] (339/500); provider OCR unknown 21.4% [18.0–25.2] (107/500); of W 81.0% [77.0–84.5] (337/416)
- by provider: internet_archive 100.0% [97.9–100.0] (182/182); mdz 98.6% [95.1–99.6] (144/146); other 11.9% [7.5–18.5] (16/134); e-rara 71.1% [55.2–83.0] (27/38)
- by language: Latin 84.2% [79.4–88.0] (234/278); German 50.9% [38.1–63.6] (28/55); English 86.4% [73.3–93.6] (38/44); Tibetan/Sanskrit/Pali 37.8% [24.1–53.9] (14/37); other European 54.1% [38.4–69.0] (20/37); other 63.3% [45.5–78.1] (19/30); CJK 84.2% [62.4–94.5] (16/19)

## Agreement

- R_vs_Aplus_W: n 416, both 45, only first 154, only second 13, neither 204, agree 59.9%, κ 0.17
- R_vs_C_W: n 416, both 171, only first 28, only second 166, neither 51, agree 53.4%, κ 0.09
- Aplus_vs_C_500: n 496, both 62, only first 10, only second 303, neither 121, agree 36.9%, κ 0.05

## Fused: strongest offer

- primary (W): works 11.5% [8.8–15.0] (48/416); volumes 8.6% [5.8%–12.0%]; pages 6.4% [3.4%–10.1%]
- conservative (W, provider OCR unknown excluded): works 4.6% [2.9–7.0] (19/416); volumes 3.2% [1.8%–5.0%]; pages 2.8% [0.6%–6.0%]
- without A (W): works 12.3% [9.4–15.8] (51/416); volumes 9.1% [6.3%–12.6%]; pages 6.5% [3.5%–10.2%]
- unrestricted (500): works 19.2% [16.0–22.9] (96/500); volumes 14.3% [10.7%–18.6%]; pages 10.7% [7.1%–15.0%]
- POST HOC: not recalled and not in crawl (W): works 49.0% [44.3–53.8] (204/416); volumes 36.5% [28.1%–45.6%]; pages 33.8% [25.7%–42.6%]
- POST HOC: not recalled, not in crawl, no curated e-text (W): works 48.8% [44.0–53.6] (203/416); volumes 36.3% [28.0%–45.5%]; pages 33.6% [25.6%–42.5%]
- by language: Latin 9.6% [6.6–13.7] (26/271); German 23.1% [12.6–38.3] (9/39); English 2.9% [0.5–14.9] (1/34); other European 20.0% [9.5–37.3] (6/30); other 16.7% [5.8–39.2] (3/18); CJK 5.9% [1.0–27.0] (1/17); Tibetan/Sanskrit/Pali 28.6% [8.2–64.1] (2/7)
- by visible/held: visible 14.0% [10.1–19.0] (33/236); held 8.3% [5.1–13.3] (15/180)
- by provider: internet_archive 0.0% [0.0–2.3] (0/160); mdz 1.4% [0.4–5.0] (2/142); other 50.6% [39.8–61.4] (40/79); e-rara 17.1% [8.1–32.7] (6/35)
- by genre: other 12.2% [9.0–16.3] (37/304); disputatio/oratio/dissertatio 11.4% [6.1–20.3] (9/79); scripture/commentary 6.1% [1.7–19.6] (2/33)

Gemini spend: $6.65 (endpoint eval/ai-exposure-r3).
