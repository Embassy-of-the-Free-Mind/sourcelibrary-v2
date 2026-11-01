# Translation corpus audit — run

Judge: opus (source-grounded, reference-free, single candidate; measure = judge rating, NOT accuracy). 365 pages from 365 books, one interior page per book, seed 20261030.

**Controls gate: PASS** (swap ≥ 93% rated ≤2, drop ≥ 87% flagged omission, repeat ≥ 93% within one; ≥ 10 of each).

## Controls (read first)
- swap (translation of another page): 15/15 rated ≤2, 15/15 flagged wrong_page
- drop (middle ~35% removed): 14/15 flagged omission, 13/15 rated ≤3
- repeat (same item twice): 13/15 exact, 15/15 within 1, 11/15 identical flags

## Corpus estimate (post-stratified by language; 95% CI)
| statistic | est % | CI |
|---|---:|---|
| fidelity 5 | 51.6 | 46.2–57.2 |
| fidelity ≥ 4 | 87.1 | 82.6–90.7 |
| fidelity ≤ 2 | 3 | 1.3–5.3 |
| any major defect | 12.8 | 9–16.9 |
| omission | 15.7 | 11.2–20.5 |
| invention | 11.8 | 8–15.9 |
| inversion | 4.9 | 2.2–8.1 |
| untranslated | 0.2 | 0–0.7 |
| wrong_language | 0 | 0–0 |
| wrong_page | 0.4 | 0–1.2 |
| garble_passthrough | 5.9 | 3.5–8.9 |
| truncated | 0.6 | 0–1.9 |
| repetition | 0 | 0–0.1 |

## By language
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin | 58 | 4.19 | 4 | 1 / 1 / 7 / 26 / 23 | 39.7 | 84.5 | 3.4 | 20.7 | 15.5 | 0 | 15.5 |
| Greek | 35 | 4.4 | 5 | 0 / 0 / 4 / 13 / 18 | 51.4 | 88.6 | 0 | 20 | 0 | 2.9 | 8.6 |
| German | 35 | 4.63 | 5 | 1 / 1 / 0 / 6 / 27 | 77.1 | 94.3 | 5.7 | 5.7 | 8.6 | 0 | 5.7 |
| English | 35 | 4.54 | 5 | 0 / 0 / 3 / 10 / 22 | 62.9 | 91.4 | 0 | 5.7 | 11.4 | 0 | 8.6 |
| Arabic | 24 | 4.25 | 4 | 0 / 1 / 3 / 9 / 11 | 45.8 | 83.3 | 4.2 | 16.7 | 16.7 | 0 | 16.7 |
| Tibetan | 24 | 4.42 | 4.5 | 0 / 0 / 2 / 10 / 12 | 50 | 91.7 | 0 | 12.5 | 4.2 | 0 | 8.3 |
| French | 24 | 4.83 | 5 | 0 / 0 / 0 / 4 / 20 | 83.3 | 100 | 0 | 4.2 | 0 | 0 | 0 |
| Chinese | 24 | 4.08 | 4 | 0 / 0 / 6 / 10 / 8 | 33.3 | 75 | 0 | 29.2 | 20.8 | 0 | 25 |
| Sanskrit | 18 | 3.5 | 3 | 0 / 3 / 7 / 4 / 4 | 22.2 | 44.4 | 16.7 | 33.3 | 33.3 | 0 | 55.6 |
| Spanish | 18 | 4.61 | 5 | 0 / 0 / 1 / 5 / 12 | 66.7 | 94.4 | 0 | 5.6 | 11.1 | 0 | 5.6 |
| Italian | 17 | 4.18 | 4 | 1 / 1 / 0 / 7 / 8 | 47.1 | 88.2 | 11.8 | 11.8 | 17.6 | 0 | 17.6 |
| Dutch | 17 | 4.71 | 5 | 0 / 0 / 0 / 5 / 12 | 70.6 | 100 | 0 | 11.8 | 5.9 | 0 | 0 |
| Korean | 12 | 4.08 | 4 | 0 / 0 / 2 / 7 / 3 | 25 | 83.3 | 0 | 25 | 8.3 | 0 | 16.7 |
| Japanese | 12 | 2.25 | 2 | 5 / 2 / 2 / 3 / 0 | 0 | 25 | 58.3 | 58.3 | 75 | 0 | 66.7 |
| Hebrew | 12 | 3.67 | 4 | 0 / 2 / 2 / 6 / 2 | 16.7 | 66.7 | 16.7 | 25 | 8.3 | 0 | 33.3 |

## By translation model arm (unpaired: different pages per arm, model follows the book)
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| agy-flash | 42 | 4.38 | 4 | 0 / 1 / 2 / 19 / 20 | 47.6 | 92.9 | 2.4 | 2.4 | 9.5 | 0 | 7.1 |
| lite | 146 | 4.14 | 4 | 4 / 3 / 23 / 54 / 62 | 42.5 | 79.5 | 4.8 | 26.7 | 9.6 | 0.7 | 20.5 |
| opus | 54 | 4.65 | 5 | 0 / 2 / 2 / 9 / 41 | 75.9 | 92.6 | 3.7 | 9.3 | 14.8 | 0 | 7.4 |
| gemini-legacy | 6 | 4.33 | 5 | 0 / 1 / 0 / 1 / 4 | 66.7 | 83.3 | 16.7 | 16.7 | 16.7 | 0 | 16.7 |
| flash | 117 | 4.2 | 4 | 4 / 4 / 12 / 42 / 55 | 47 | 82.9 | 6.8 | 13.7 | 18.8 | 0 | 16.2 |

## By language × arm
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Greek / agy-flash | 6 | 4.5 | 4.5 | 0 / 0 / 0 / 3 / 3 | 50 | 100 | 0 | 0 | 0 | 0 | 0 |
| Greek / opus | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 0 | 0 | 0 | 0 |
| Greek / flash | 7 | 4.71 | 5 | 0 / 0 / 0 / 2 / 5 | 71.4 | 100 | 0 | 0 | 0 | 0 | 0 |
| Greek / lite | 16 | 4.06 | 4 | 0 / 0 / 4 / 7 / 5 | 31.3 | 75 | 0 | 43.8 | 0 | 6.3 | 18.8 |
| Arabic / agy-flash | 6 | 3.67 | 4 | 0 / 1 / 1 / 3 / 1 | 16.7 | 66.7 | 16.7 | 16.7 | 33.3 | 0 | 33.3 |
| Arabic / opus | 6 | 4.67 | 5 | 0 / 0 / 0 / 2 / 4 | 66.7 | 100 | 0 | 16.7 | 16.7 | 0 | 0 |
| Arabic / flash | 6 | 4.5 | 4.5 | 0 / 0 / 0 / 3 / 3 | 50 | 100 | 0 | 16.7 | 16.7 | 0 | 0 |
| Arabic / lite | 6 | 4.17 | 4.5 | 0 / 0 / 2 / 1 / 3 | 50 | 66.7 | 0 | 16.7 | 0 | 0 | 33.3 |
| Tibetan / lite | 6 | 4 | 4 | 0 / 0 / 2 / 2 / 2 | 33.3 | 66.7 | 0 | 33.3 | 0 | 0 | 33.3 |
| Tibetan / opus | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 16.7 | 16.7 | 0 | 0 |
| Tibetan / agy-flash | 6 | 4.33 | 4 | 0 / 0 / 0 / 4 / 2 | 33.3 | 100 | 0 | 0 | 0 | 0 | 0 |
| Tibetan / flash | 6 | 4.5 | 4.5 | 0 / 0 / 0 / 3 / 3 | 50 | 100 | 0 | 0 | 0 | 0 | 0 |
| Korean / lite | 6 | 4.33 | 4 | 0 / 0 / 0 / 4 / 2 | 33.3 | 100 | 0 | 33.3 | 16.7 | 0 | 0 |
| Korean / flash | 6 | 3.83 | 4 | 0 / 0 / 2 / 3 / 1 | 16.7 | 66.7 | 0 | 16.7 | 0 | 0 | 33.3 |
| French / opus | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| French / agy-flash | 6 | 4.67 | 5 | 0 / 0 / 0 / 2 / 4 | 66.7 | 100 | 0 | 0 | 0 | 0 | 0 |
| French / flash | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| French / lite | 6 | 4.67 | 5 | 0 / 0 / 0 / 2 / 4 | 66.7 | 100 | 0 | 16.7 | 0 | 0 | 0 |
| Sanskrit / opus | 6 | 3.5 | 3.5 | 0 / 2 / 1 / 1 / 2 | 33.3 | 50 | 33.3 | 33.3 | 33.3 | 0 | 50 |
| Sanskrit / lite | 6 | 3.5 | 3 | 0 / 0 / 4 / 1 / 1 | 16.7 | 33.3 | 0 | 50 | 16.7 | 0 | 66.7 |
| Sanskrit / flash | 6 | 3.5 | 3.5 | 0 / 1 / 2 / 2 / 1 | 16.7 | 50 | 16.7 | 16.7 | 50 | 0 | 50 |
| Spanish / opus | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 0 | 16.7 | 0 | 0 |
| Spanish / flash | 6 | 4.5 | 4.5 | 0 / 0 / 0 / 3 / 3 | 50 | 100 | 0 | 0 | 16.7 | 0 | 0 |
| Spanish / lite | 6 | 4.5 | 5 | 0 / 0 / 1 / 1 / 4 | 66.7 | 83.3 | 0 | 16.7 | 0 | 0 | 16.7 |
| Latin / gemini-legacy | 6 | 4.33 | 5 | 0 / 1 / 0 / 1 / 4 | 66.7 | 83.3 | 16.7 | 16.7 | 16.7 | 0 | 16.7 |
| Latin / opus | 6 | 4.33 | 4.5 | 0 / 0 / 1 / 2 / 3 | 50 | 83.3 | 0 | 16.7 | 50 | 0 | 16.7 |
| Latin / agy-flash | 6 | 4.33 | 4.5 | 0 / 0 / 1 / 2 / 3 | 50 | 83.3 | 0 | 0 | 16.7 | 0 | 16.7 |
| Latin / flash | 11 | 3.91 | 4 | 1 / 0 / 1 / 6 / 3 | 27.3 | 81.8 | 9.1 | 36.4 | 27.3 | 0 | 18.2 |
| Latin / lite | 29 | 4.21 | 4 | 0 / 0 / 4 / 15 / 10 | 34.5 | 86.2 | 0 | 20.7 | 3.4 | 0 | 13.8 |
| German / agy-flash | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 0 | 16.7 | 0 | 0 |
| German / opus | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| German / flash | 15 | 4.47 | 5 | 1 / 0 / 0 / 4 / 10 | 66.7 | 93.3 | 6.7 | 6.7 | 13.3 | 0 | 6.7 |
| German / lite | 8 | 4.5 | 5 | 0 / 1 / 0 / 1 / 6 | 75 | 87.5 | 12.5 | 12.5 | 0 | 0 | 12.5 |
| Japanese / flash | 6 | 2.67 | 2.5 | 1 / 2 / 1 / 2 / 0 | 0 | 33.3 | 50 | 50 | 66.7 | 0 | 50 |
| Japanese / lite | 6 | 1.83 | 1 | 4 / 0 / 1 / 1 / 0 | 0 | 16.7 | 66.7 | 66.7 | 83.3 | 0 | 83.3 |
| Hebrew / flash | 6 | 3.67 | 4 | 0 / 1 / 1 / 3 / 1 | 16.7 | 66.7 | 16.7 | 16.7 | 0 | 0 | 33.3 |
| Hebrew / lite | 6 | 3.67 | 4 | 0 / 1 / 1 / 3 / 1 | 16.7 | 66.7 | 16.7 | 33.3 | 16.7 | 0 | 33.3 |
| Italian / flash | 6 | 4 | 4.5 | 1 / 0 / 0 / 2 / 3 | 50 | 83.3 | 16.7 | 16.7 | 33.3 | 0 | 16.7 |
| Italian / lite | 11 | 4.27 | 4 | 0 / 1 / 0 / 5 / 5 | 45.5 | 90.9 | 9.1 | 9.1 | 9.1 | 0 | 18.2 |
| Dutch / flash | 10 | 4.7 | 5 | 0 / 0 / 0 / 3 / 7 | 70 | 100 | 0 | 0 | 10 | 0 | 0 |
| Dutch / lite | 7 | 4.71 | 5 | 0 / 0 / 0 / 2 / 5 | 71.4 | 100 | 0 | 28.6 | 0 | 0 | 0 |
| Chinese / opus | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 0 | 0 | 0 | 0 |
| Chinese / lite | 6 | 3.5 | 3.5 | 0 / 0 / 3 / 3 / 0 | 0 | 50 | 0 | 66.7 | 33.3 | 0 | 50 |
| Chinese / agy-flash | 6 | 4.33 | 4 | 0 / 0 / 0 / 4 / 2 | 33.3 | 100 | 0 | 0 | 0 | 0 | 0 |
| Chinese / flash | 6 | 3.67 | 3.5 | 0 / 0 / 3 / 2 / 1 | 16.7 | 50 | 0 | 50 | 50 | 0 | 50 |
| English / flash | 14 | 4.43 | 5 | 0 / 0 / 2 / 4 / 8 | 57.1 | 85.7 | 0 | 0 | 14.3 | 0 | 14.3 |
| English / lite | 21 | 4.62 | 5 | 0 / 0 / 1 / 6 / 14 | 66.7 | 95.2 | 0 | 9.5 | 9.5 | 0 | 4.8 |

## By period
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1500-1700 | 120 | 4.29 | 5 | 3 / 4 / 9 / 43 / 61 | 50.8 | 86.7 | 5.8 | 16.7 | 11.7 | 0 | 14.2 |
| 1700-1900 | 144 | 4.28 | 5 | 4 / 4 / 17 / 42 / 77 | 53.5 | 82.6 | 5.6 | 18.8 | 13.9 | 0.7 | 16.7 |
| 1900+ | 50 | 4.4 | 5 | 0 / 2 / 3 / 18 / 27 | 54 | 90 | 4 | 14 | 14 | 0 | 10 |
| pre-1500 | 31 | 3.97 | 4 | 1 / 1 / 7 / 11 / 11 | 35.5 | 71 | 6.5 | 9.7 | 19.4 | 0 | 25.8 |
| unknown | 20 | 4.15 | 4 | 0 / 0 / 3 / 11 / 6 | 30 | 85 | 0 | 25 | 10 | 0 | 15 |

## By arm / prompt label
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| agy-flash/13 | 42 | 4.38 | 4 | 0 / 1 / 2 / 19 / 20 | 47.6 | 92.9 | 2.4 | 2.4 | 9.5 | 0 | 7.1 |
| lite/13 | 40 | 4.28 | 4.5 | 0 / 1 / 7 / 12 / 20 | 50 | 80 | 2.5 | 25 | 5 | 0 | 17.5 |
| lite/11 | 27 | 4.04 | 4 | 2 / 1 / 4 / 7 / 13 | 48.1 | 74.1 | 11.1 | 29.6 | 11.1 | 0 | 25.9 |
| lite/v10 | 65 | 4.03 | 4 | 2 / 1 / 11 / 30 / 21 | 32.3 | 78.5 | 4.6 | 32.3 | 12.3 | 1.5 | 21.5 |
| opus/13 | 42 | 4.88 | 5 | 0 / 0 / 0 / 5 / 37 | 88.1 | 100 | 0 | 4.8 | 7.1 | 0 | 0 |
| opus/1 | 11 | 3.73 | 4 | 0 / 2 / 2 / 4 / 3 | 27.3 | 63.6 | 18.2 | 27.3 | 45.5 | 0 | 36.4 |
| gemini-legacy/? | 6 | 4.33 | 5 | 0 / 1 / 0 / 1 / 4 | 66.7 | 83.3 | 16.7 | 16.7 | 16.7 | 0 | 16.7 |
| flash/v10 | 23 | 4.3 | 5 | 1 / 0 / 2 / 8 / 12 | 52.2 | 87 | 4.3 | 17.4 | 21.7 | 0 | 13 |
| flash/v2 | 40 | 4.28 | 5 | 2 / 0 / 5 / 11 / 22 | 55 | 82.5 | 5 | 7.5 | 20 | 0 | 17.5 |
| flash/v5.2026-02 | 10 | 4.7 | 5 | 0 / 0 / 0 / 3 / 7 | 70 | 100 | 0 | 0 | 0 | 0 | 0 |
| opus/v1 | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/11 | 13 | 3.31 | 4 | 1 / 2 / 3 / 6 / 1 | 7.7 | 53.8 | 23.1 | 30.8 | 30.8 | 0 | 38.5 |
| flash/12 | 3 | 3 | 2 | 0 / 2 / 0 / 0 / 1 | 33.3 | 33.3 | 66.7 | 33.3 | 33.3 | 0 | 66.7 |
| flash/13 | 16 | 4.19 | 4 | 0 / 0 / 2 / 9 / 5 | 31.3 | 87.5 | 0 | 25 | 18.8 | 0 | 12.5 |
| flash/v5.1.2026-03b | 9 | 4.56 | 5 | 0 / 0 / 0 / 4 / 5 | 55.6 | 100 | 0 | 0 | 11.1 | 0 | 0 |
| flash/? | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/v1 | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 0 | 0 | 0 | 0 |
| lite/v1 | 9 | 4.67 | 5 | 0 / 0 / 0 / 3 / 6 | 66.7 | 100 | 0 | 0 | 0 | 0 | 11.1 |
| lite/2 | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 0 | 0 | 0 | 0 |
| lite/1 | 2 | 4 | 4 | 0 / 0 / 1 / 0 / 1 | 50 | 50 | 0 | 0 | 50 | 0 | 50 |
| lite/12 | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |

## Script class
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| non-latin-script | 161 | 3.99 | 4 | 5 / 8 / 28 / 62 / 58 | 36 | 74.5 | 8.1 | 24.8 | 16.8 | 0.6 | 24.2 |
| latin-script | 204 | 4.48 | 5 | 3 / 3 / 11 / 63 / 124 | 60.8 | 91.7 | 2.9 | 10.8 | 10.8 | 0 | 8.8 |

## Defect types (primary judge, main items)
| type/severity | n |
|---|---:|
| mistranslation/minor | 141 |
| omission/minor | 50 |
| invention/minor | 41 |
| terminology/minor | 32 |
| garble_passthrough/minor | 28 |
| omission/major | 24 |
| invention/major | 20 |
| name/minor | 16 |
| garble_passthrough/major | 14 |
| mistranslation/major | 12 |
| number/minor | 11 |
| inversion/minor | 9 |
| inversion/major | 9 |
| wrong_page/major | 3 |
| truncated/major | 1 |
| repetition/minor | 1 |
| terminology/major | 1 |
| untranslated/minor | 1 |

## Worst 25 (primary judge)
| fidelity | language | arm | flags | url | reason |
|---:|---|---|---|---|---|
| 1 | Japanese | flash | omission, invention | https://sourcelibrary.org/book/69f3276f52a77bb28fdb7316?page=3 | Source discusses 山の神石, viewing 築山 from the waterfall mouth, incense burner and 銚子/盃 placement; translation gives two invented lines and declares the rest illegible. |
| 1 | Japanese | lite | omission, invention, garble_passthrough | https://sourcelibrary.org/book/69e75ccc3f15c712bdb8f04e?page=40 | Only scraps (Mount Hiei, becoming a monk, the capital) echo the source; the rest is invented lines with bogus glosses, not a translation of this text |
| 1 | Japanese | lite | omission, invention | https://sourcelibrary.org/book/69e726a9a409200ea79efa80?page=17 | Translation is a fabricated murder scene sharing only 'seventeen or eighteen' and 'mountain' with a source about choosing a beautiful girl from passing women; not a translation of this text. |
| 1 | Japanese | lite | omission, invention, wrong_page | https://sourcelibrary.org/book/69e4207471f02ebac6264a46?page=7 | Translation is of a different text (Afumiya gossip); source's servant girl, Yonosuke's nightgown and priest's letter are absent |
| 1 | Japanese | lite | omission, invention, wrong_page, repetition | https://sourcelibrary.org/book/69e014d927a1381d255992b7?page=32 | Translation renders a different text (Genji Kiritsubo opening, duplicated); none of the poems or poet attributions in the source appear. |
| 1 | Italian | flash | invention | https://sourcelibrary.org/book/6991eadd2f801130a473ea3c?page=31 | Label 'FEUILLETS INÉDITS DE LÉONARD DE VINCI … Feuillet n° 4 Verso' rendered correctly, but most of the output is invented anatomical text not on the page. |
| 1 | German | flash | omission, invention, wrong_page | https://sourcelibrary.org/book/69c7fdea6c6f3cc53c84359c?page=143 | Translation renders a different page of the same book; none of the source's content (Betrüger as Messiahs, 2 Thess 2:10-11, Irenaeus) appears |
| 1 | Latin | flash | omission, invention | https://sourcelibrary.org/book/695201a9ab34727b1f041826?page=82 | Only the Resolut. Theolog. intellect/reason line is genuinely translated; the rest is short invented prose hung on a few citations from the page. |
| 2 | Arabic | agy-flash | invention, garble_passthrough | https://sourcelibrary.org/book/6a2032ad18654bf8e1903546?page=22 | only the veil couplet ('حجابي لا يزال من صفاتي' = my veil is ever among my attributes) and the gist of the last Malay gloss can be tied to the source; the other couplets are smooth mystical paraphrase |
| 2 | Sanskrit | opus | omission | https://sourcelibrary.org/book/69ee89f34501bec896546e1d?page=770 | Heavily abridged: Sāyaṇa's verse-5 comment, padapāṭha and all grammar notes dropped; verses 6–7 and their glosses kept in reduced form |
| 2 | Sanskrit | opus | omission, invention | https://sourcelibrary.org/book/69920beee0a548a13d887aeb?page=519 | the hymn verses, padapāṭha and verse-4 commentary are faithful, but the page's first paragraph of Sāyaṇa is dropped and about four sentences of commentary not on this page are added at the end |
| 2 | Latin | gemini-legacy | omission, truncated | https://sourcelibrary.org/book/69522ff2ab34727b1f044362?page=584 | what is translated (geometry doubling question, sailors' eight winds) is accurate, but it ends about a quarter into the page, dropping the navigation method, music and astronomy questions |
| 2 | Japanese | flash | omission, invention, inversion | https://sourcelibrary.org/book/6a0aca8b676a42ccd9775261?page=19 | mechanism of the mercury-weight tumbling doll is garbled: lid/cylinder invented, the head (首) never named, the small-hole condition inverted, and the flip-over result replaced by an invented settling |
| 2 | Japanese | flash | invention, garble_passthrough | https://sourcelibrary.org/book/69dfede68d34461cbe7f4df4?page=71 | Source is an OCR repetition loop ('の三の三' x1344); translation treats it as a real collation list and explains it with an invented classification note. |
| 2 | Hebrew | flash | omission, inversion, garble_passthrough | https://sourcelibrary.org/book/6a357f1ac6e2d5bb56a64539?page=204 | Mishnah/Gemara of BB 3:11 and 4:1 rendered recognisably, but 'ויתר' (waived) is turned into 'permitted' reversing both views, and large commentary blocks (Amudei Yerushalayim, most of Mareh haPanim) a |
| 2 | Hebrew | lite | omission, invention | https://sourcelibrary.org/book/69b4cd3dd5b6c3815e1a504b?page=154 | Hebrew column (Lev 23:32-42) rendered correctly; the Aramaic column is dropped and replaced with Lev 23:43-44 imported from elsewhere. |
| 2 | Sanskrit | flash | invention, garble_passthrough | https://sourcelibrary.org/book/69de98eb1b234a773e439877?page=63 | Narrative and vv.137-139, 141 reasonably rendered, but v.143 is replaced by an invented physician/poison simile, v.136 ends in an invented lion's mouth, and the garbled vv.140, 144-145 are papered ove |
| 2 | Italian | lite | omission | https://sourcelibrary.org/book/6a084e0949638a50931b4b3d?page=422 | drops the first ~7 lines (harassing the river-diverting works, supply raid killing the tribune, ~1,400 killed with their officer); remainder from 'Per le quali rovine' to 'dubitava di' is faithful |
| 2 | German | lite | omission | https://sourcelibrary.org/book/6a267b7a6c1f37c9c4f31db9?page=58 | Drops the first eight lines (art not for sale, one cheat teaches another, whole world deceived); remainder = source |
| 3 | Arabic | agy-flash | garble_passthrough | https://sourcelibrary.org/book/6a2032fa18654bf8e1903f74?page=17 | Opening and Ibn al-Ḥājib passage follow the source; the garbled sentence on what is exempt from mabnī becomes fluent invented-sense prose; ism fiʿl given as 'verbal noun' |
| 3 | Tibetan | lite | omission, inversion, garble_passthrough | https://sourcelibrary.org/book/69e7aba95f1a22ab19a9be00?page=385 | Line-scrambled, partly garbled Tibetan sutra on the formless spheres and views on perception; core gist rendered but who-rebuts-whom is confused and garbled tail reconstructed fluently; I read Tibetan |
| 3 | Tibetan | lite | garble_passthrough | https://sourcelibrary.org/book/69e78a8a4a6785cfd60d3a96?page=2657 | The ending ('these are the ten paper scrolls', snake seal, a sign to be abandoned) follows the source, but the garbled divination lines are rendered as fluent instructions; I read this corrupted Tibet |
| 3 | Sanskrit | opus | invention | https://sourcelibrary.org/book/6a0eb379283b678bc95b9611?page=31 | Verses 40–45 and the English commentary are rendered correctly, but two verses (38–39) from the previous page are added at the top and the Vajroli verse is rendered loosely ('like a bow'). |
| 3 | Latin | opus | omission, invention | https://sourcelibrary.org/book/69b51e1f768235dc6598c9e7?page=88 | Lamp-of-life passage from 'Ex hoc itaque fundo' onward is faithful, but the four-line opening sentence (blood as guardian of Nature) is dropped and a main verb is supplied at the end |
| 3 | Latin | agy-flash | inversion | https://sourcelibrary.org/book/69bd9c7d6120d54bd036f555?page=235 | Ovid/Juvenal passage on dangerous secrets is accurate, but the opening of ch. XIII is inverted, garbling the argument about flatterers working through wives |
