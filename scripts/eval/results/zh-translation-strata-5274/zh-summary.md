# Chinese translation strata — zh-translation-strata-5274

Judge opus with the page image; weights = pages; 120 books, 45766 English words. Gate: PASS.

## Weighted
| cut | books | fidelity ≥ 4 % | major % | major / 1k words | misread seen % | wrong end to end % | inherited % of major |
|---|---:|---:|---:|---:|---:|---:|---:|
| all | 120 | 63.8 [50.8–77.7] | 32.5 [19.2–45.9] | 0.99 [0.64–1.35] | 39.1 [25.4–52.3] | 56 [44.7–65.8] | 48.1 [18.9–75.7] |
| model: 3-flash | 36 | 43.2 [20.6–67.2] | 49.5 [25.5–73.2] | 1.13 [0.6–1.66] | 53.3 [30.2–76.3] | 80.9 [59.6–96.5] | 44.2 [0–79.8] |
| model: 3.8-flash | 36 | 92.3 [77–100] | 7.7 [0–23] | 0.23 [0–0.67] | 8.8 [0–25.2] | 8.8 [0–25.2] | 100 [100–100] |
| model: flash-lite | 24 | 62.3 [45.5–79] | 37.7 [21–54.5] | 2.54 [1.19–4.1] | 54 [37.2–70.9] | 75.1 [58.3–91.7] | 44.2 [12.5–74.9] |
| model: opus | 24 | 100 [100–100] | 0 [0–0] | 0 [0–0] | 33.3 [12.5–56.9] | 33.3 [12.5–56.9] | — |
| engine: gemini | 48 | 74.6 [60.3–88.1] | 25.4 [11.9–39.7] | 0.93 [0.41–1.59] | 40.3 [25.8–54.8] | 58.2 [42–73.6] | 29.6 [0–55.8] |
| engine: other | 24 | 88.9 [72.3–100] | 11.1 [0–27.7] | 0.21 [0–0.49] | 16.6 [0–33.2] | 27.7 [11.1–44.3] | 0 [0–0] |
| engine: paddle | 48 | 61.4 [46.1–78.1] | 34.2 [18.2–49.8] | 1.02 [0.61–1.42] | 39.2 [23.3–54.9] | 56 [42.8–67.3] | 50.8 [17.6–82.3] |
| kind: prose | 91 | 79.5 [64.7–91.2] | 20.5 [8.8–35.3] | 0.9 [0.44–1.46] | 33.5 [18.9–50] | 46.3 [31.3–61.3] | 37.4 [8.8–72.8] |
| kind: reference | 29 | 40.1 [15.9–66.5] | 50.7 [23.7–77.7] | 1.08 [0.54–1.6] | 47.5 [20.6–73.7] | 70.6 [47.7–90.3] | 54.5 [0–92.3] |
| hand tag: manuscript | 55 | 62.4 [45.6–79.9] | 32.9 [15.9–50] | 0.83 [0.42–1.23] | 40.8 [23.8–57.7] | 55.9 [41.4–68.4] | 54.1 [17.6–92.1] |
| hand tag: print | 40 | 69.8 [49.7–86.4] | 30.2 [13.6–50.4] | 2.21 [0.85–3.93] | 37.2 [19.4–58.1] | 54.6 [34.1–76.9] | 42.5 [0–79.8] |
| hand tag: untagged | 25 | 67.2 [45.4–85.8] | 32.8 [14.2–54.6] | 1.01 [0.36–2.03] | 27 [7.8–47.9] | 59.8 [37.5–82.3] | 0 [0–0] |
| kind × engine: prose · gemini | 43 | 84.5 [69.8–96.6] | 15.5 [3.4–30.4] | 0.57 [0.11–1.21] | 46.3 [29.7–63.1] | 53.2 [35.8–70.1] | 55.8 [0–100] |
| kind × engine: prose · other | 14 | 84.6 [61.6–100] | 15.4 [0–38.4] | 0.29 [0–0.69] | 23.1 [0–48] | 38.4 [14.8–66.6] | 0 [0–0] |
| kind × engine: prose · paddle | 34 | 78 [58.7–92.6] | 22 [7.4–41.3] | 1.02 [0.43–1.77] | 29.9 [10.7–50.5] | 44.5 [24.3–63.5] | 34 [0–77.2] |
| kind × engine: reference · gemini | 5 | 8 [0–31.6] | 92 [68.4–100] | 3.05 [1.8–4.5] | 0 [0–0] | 92 [68.4–100] | 0 [0–0] |
| kind × engine: reference · other | 10 | 100 [100–100] | 0 [0–0] | 0 [0–0] | 0 [0–0] | 0 [0–0] | — |
| kind × engine: reference · paddle | 14 | 41.3 [16.1–69.8] | 48.9 [20.1–77.5] | 1.01 [0.45–1.56] | 50.5 [22.1–79.4] | 70 [45.5–91] | 60 [0–100] |

fidelity 1/2/3/4/5 (books): 4 / 6 / 15 / 43 / 52; weighted %: 1.8 / 3.3 / 31.1 / 38.7 / 25

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
| mistranslation | 9 | 15.2 | 3 | '發屋折木者糴大貴' (grain prices soar) rendered 'indicate a fear of a great uprising' with a note on a non-existent '大首 … rebel leader' |
| omission | 4 | 5.4 | 0 | 功成而天下安之矣此根之難拔者不輕動以激其變惡之既稔者 collapsed into 'When the achievement is ripe, do not delay the cure' — drops 'the realm is at peace' and 'what is deep-rooted is not moved lightly so as to provoke upheaval' |
| invention | 10 | 5.1 | 4 | source carries only heading 牽牛子 and an illustration -> translation adds a full 'Chinese Clematis' (威靈仙) entry: habitat, morphology, harvest days, running-water rule |
| name | 2 | 4.3 | 1 | 上謂王曰…王頓首謝曰 (the Emperor to King Xiao of Liang, the father) rendered 'The Emperor said to the Prince…The Prince bowed' |
| garble_passthrough | 1 | 3.7 | 1 | 李白詩吾亦 遊詩原是人間 陸 (fragmented, headword marks lost) -> fluent 'I am also an inhabitant of the world' |
| inversion | 4 | 2.4 | 0 | 梵天言誰能見法答言不逆諸因緣法者 (Who can see the Dharma? Those who do not go against dependent origination) rendered as a question 'Who can go against the dharma of dependent origination?' with the answer dropped |
| number | 1 | 0.6 | 0 | 半夏十二枚以水一升煮取半升…甘草如指大一枚以水一升煮取半升…以蜜半升…合一升半煎取八合 → 'using 6 sheng of water… boil in 6 sheng of water'; 芍藥 and the honey dropped |
