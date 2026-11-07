# Chinese translation strata — zh-translation-strata-5274

Judge opus with the page image; weights = books; 120 books, 45766 English words. Gate: PASS.

## Weighted
| cut | books | fidelity ≥ 4 % | major % | major / 1k words | misread seen % | wrong end to end % | inherited % of major |
|---|---:|---:|---:|---:|---:|---:|---:|
| all | 120 | 67.3 [55–80] | 29.4 [17–42] | 0.88 [0.56–1.21] | 35.5 [22.9–48.2] | 50.4 [39.9–60.2] | 49.3 [19–77.2] |
| model: 3-flash | 36 | 44.2 [22.2–67.7] | 48.6 [25–71.7] | 1.1 [0.59–1.61] | 52.6 [29.7–75.3] | 79.9 [58.7–95.3] | 43.8 [0–79.6] |
| model: 3.8-flash | 36 | 92.5 [77.4–100] | 7.5 [0–22.6] | 0.23 [0–0.65] | 8.9 [0–25.4] | 8.9 [0–25.4] | 100 [100–100] |
| model: flash-lite | 24 | 62.6 [46–79.3] | 37.4 [20.7–54] | 2.51 [1.18–4.05] | 54.2 [37.5–71] | 74.9 [58.2–91.6] | 44.6 [12.6–75.1] |
| model: opus | 24 | 100 [100–100] | 0 [0–0] | 0 [0–0] | 33.3 [12.9–56.8] | 33.3 [12.9–56.8] | — |
| engine: gemini | 48 | 76.7 [64.7–88.5] | 23.3 [11.5–35.3] | 0.85 [0.37–1.44] | 36.3 [23.3–49.5] | 53.4 [38.9–67.5] | 26.2 [0–51.6] |
| engine: other | 24 | 86.1 [65.4–100] | 13.9 [0–34.6] | 0.26 [0–0.6] | 20.8 [0–41.6] | 34.6 [13.9–55.4] | 0 [0–0] |
| engine: paddle | 48 | 65.1 [50.4–80.4] | 30.9 [16–46] | 0.91 [0.54–1.28] | 35.8 [21–50.6] | 50.3 [38–61.7] | 52.9 [18.1–84.4] |
| kind: prose | 91 | 81.9 [67.2–93] | 18.1 [7–32.8] | 0.74 [0.34–1.22] | 30 [16.1–46] | 40.8 [26.1–56] | 40.6 [7.8–76.8] |
| kind: reference | 29 | 43.8 [18.7–69] | 47.5 [21.8–74.5] | 1.04 [0.52–1.55] | 44.4 [18.9–71.2] | 66 [43.1–88] | 54.6 [0–92.3] |
| hand tag: manuscript | 55 | 65.4 [49.6–81.8] | 30.4 [14.3–46.4] | 0.78 [0.4–1.15] | 37.2 [21.6–53.4] | 50.8 [37.1–63.5] | 55.2 [17.8–92] |
| hand tag: print | 40 | 76.9 [59.2–90.1] | 23.1 [9.9–40.8] | 1.65 [0.62–3.03] | 31.1 [15.6–51] | 44.2 [26–66.7] | 43.1 [0–80.1] |
| hand tag: untagged | 25 | 69.6 [50–86.7] | 30.4 [13.3–50.1] | 0.91 [0.33–1.75] | 26.8 [9.3–45.9] | 57.2 [37–77.8] | 0 [0–0] |
| kind × engine: prose · gemini | 43 | 86.4 [73.7–96.8] | 13.6 [3.2–26.4] | 0.5 [0.09–1.08] | 41.8 [27.2–57.1] | 48.4 [33–63.8] | 51.6 [0–100] |
| kind × engine: prose · other | 14 | 83.9 [59.7–100] | 16.1 [0–40.3] | 0.3 [0–0.69] | 24.2 [0–49.2] | 40.3 [15.9–66.7] | 0 [0–0] |
| kind × engine: prose · paddle | 34 | 80.6 [61.8–94.7] | 19.4 [5.3–38.3] | 0.83 [0.32–1.46] | 27.1 [8.8–47.2] | 38.8 [19.4–58.2] | 39.9 [0–83.1] |
| kind × engine: reference · gemini | 5 | 13.5 [0–45.4] | 86.5 [54.6–100] | 2.85 [1.52–4.44] | 0 [0–0] | 86.5 [54.6–100] | 0 [0–0] |
| kind × engine: reference · other | 10 | 100 [100–100] | 0 [0–0] | 0 [0–0] | 0 [0–0] | 0 [0–0] | — |
| kind × engine: reference · paddle | 14 | 44.9 [18.3–72.3] | 45.9 [18.6–74.7] | 0.98 [0.43–1.51] | 47.1 [20.2–76.1] | 65.5 [41–89] | 60 [0–100] |

fidelity 1/2/3/4/5 (books): 4 / 6 / 15 / 43 / 52; weighted %: 1.7 / 2.6 / 28.5 / 39 / 28.3

## By stratum (unweighted)
| stratum | % of pages | books | 1/2/3/4/5 | ≥4 % | major % | major / 1k | misread % | wrong e2e % | inherited |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 3-flash|gemini | 5.5 | 12 | 4/2/0/4/2 | 50 | 50 | 1.43 | 16.7 | 66.7 | 0/6 |
| 3-flash|other | 0.8 | 12 | 0/0/2/7/3 | 83.3 | 16.7 | 0.3 | 25 | 41.7 | 0/2 |
| 3-flash|paddle | 44.1 | 12 | 0/0/7/5/0 | 41.7 | 50 | 1.11 | 58.3 | 83.3 | 3/6 |
| 3.8-flash|gemini | 1.9 | 12 | 0/0/0/4/8 | 100 | 0 | 0 | 16.7 | 16.7 | 0/0 |
| 3.8-flash|other | 0.4 | 12 | 0/0/0/7/5 | 100 | 0 | 0 | 0 | 0 | 0/0 |
| 3.8-flash|paddle | 26.9 | 12 | 0/0/1/5/6 | 91.7 | 8.3 | 0.25 | 8.3 | 8.3 | 1/1 |
| flash-lite|gemini | 7 | 12 | 0/0/2/5/5 | 83.3 | 16.7 | 0.7 | 66.7 | 66.7 | 2/2 |
| flash-lite|paddle | 7.1 | 12 | 0/4/3/5/0 | 41.7 | 58.3 | 3.89 | 41.7 | 83.3 | 2/7 |
| opus|gemini | 1 | 12 | 0/0/0/1/11 | 100 | 0 | 0 | 33.3 | 33.3 | 0/0 |
| opus|paddle | 5.2 | 12 | 0/0/0/0/12 | 100 | 0 | 0 | 33.3 | 33.3 | 0/0 |

## Major defect kinds
| type | pages | weighted % of pages | on reference pages | example |
|---|---:|---:|---:|---|
| mistranslation | 9 | 14.3 | 3 | '發屋折木者糴大貴' (grain prices soar) rendered 'indicate a fear of a great uprising' with a note on a non-existent '大首 … rebel leader' |
| omission | 4 | 4.6 | 0 | 功成而天下安之矣此根之難拔者不輕動以激其變惡之既稔者 collapsed into 'When the achievement is ripe, do not delay the cure' — drops 'the realm is at peace' and 'what is deep-rooted is not moved lightly so as to provoke upheaval' |
| invention | 10 | 4.2 | 4 | source carries only heading 牽牛子 and an illustration -> translation adds a full 'Chinese Clematis' (威靈仙) entry: habitat, morphology, harvest days, running-water rule |
| name | 2 | 3.8 | 1 | 上謂王曰…王頓首謝曰 (the Emperor to King Xiao of Liang, the father) rendered 'The Emperor said to the Prince…The Prince bowed' |
| garble_passthrough | 1 | 3.3 | 1 | 李白詩吾亦 遊詩原是人間 陸 (fragmented, headword marks lost) -> fluent 'I am also an inhabitant of the world' |
| inversion | 4 | 1.7 | 0 | 梵天言誰能見法答言不逆諸因緣法者 (Who can see the Dharma? Those who do not go against dependent origination) rendered as a question 'Who can go against the dharma of dependent origination?' with the answer dropped |
| number | 1 | 0.4 | 0 | 半夏十二枚以水一升煮取半升…甘草如指大一枚以水一升煮取半升…以蜜半升…合一升半煎取八合 → 'using 6 sheng of water… boil in 6 sheng of water'; 芍藥 and the honey dropped |
