# Translation corpus audit — run

Judge: gemini-flash-low (source-grounded, reference-free, single candidate; measure = judge rating, NOT accuracy). 365 pages from 365 books, one interior page per book, seed 20261030.

**Controls gate: FAIL — this run is not reported** (swap ≥ 93% rated ≤2, drop ≥ 87% flagged omission, repeat ≥ 93% within one; ≥ 10 of each).

## Controls (read first)
- swap (translation of another page): 15/15 rated ≤2, 15/15 flagged wrong_page
- drop (middle ~35% removed): 15/15 flagged omission, 15/15 rated ≤3
- repeat (same item twice): 10/15 exact, 13/15 within 1, 11/15 identical flags

## Corpus estimate (post-stratified by language; 95% CI)
| statistic | est % | CI |
|---|---:|---|
| fidelity 5 | 75.1 | 69.6–80.3 |
| fidelity ≥ 4 | 91.3 | 87.7–94.3 |
| fidelity ≤ 2 | 4 | 1.9–6.5 |
| any major defect | 7.9 | 4.9–11.1 |
| omission | 9.9 | 6.3–14.1 |
| invention | 6.5 | 3.8–9.6 |
| inversion | 1.7 | 0.2–3.7 |
| untranslated | 0.5 | 0–1.3 |
| wrong_language | 0 | 0–0 |
| wrong_page | 0.7 | 0.1–1.7 |
| garble_passthrough | 0.6 | 0.1–1.2 |
| truncated | 1.5 | 0–3.5 |
| repetition | 0 | 0–0 |

## By language
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin | 58 | 4.57 | 5 | 1 / 1 / 3 / 12 / 41 | 70.7 | 91.4 | 3.4 | 13.8 | 6.9 | 0 | 6.9 |
| Greek | 35 | 4.49 | 5 | 1 / 1 / 2 / 7 / 24 | 68.6 | 88.6 | 5.7 | 5.7 | 8.6 | 2.9 | 11.4 |
| German | 35 | 4.71 | 5 | 1 / 0 / 1 / 4 / 29 | 82.9 | 94.3 | 2.9 | 5.7 | 5.7 | 0 | 5.7 |
| English | 35 | 4.74 | 5 | 0 / 1 / 0 / 6 / 28 | 80 | 97.1 | 2.9 | 11.4 | 5.7 | 0 | 2.9 |
| Arabic | 24 | 4.63 | 5 | 0 / 1 / 0 / 6 / 17 | 70.8 | 95.8 | 4.2 | 4.2 | 4.2 | 0 | 4.2 |
| Tibetan | 24 | 4.63 | 5 | 0 / 2 / 1 / 1 / 20 | 83.3 | 87.5 | 8.3 | 4.2 | 4.2 | 0 | 12.5 |
| French | 24 | 4.96 | 5 | 0 / 0 / 0 / 1 / 23 | 95.8 | 100 | 0 | 0 | 0 | 0 | 0 |
| Chinese | 24 | 4.5 | 5 | 0 / 1 / 3 / 3 / 17 | 70.8 | 83.3 | 4.2 | 8.3 | 8.3 | 4.2 | 16.7 |
| Sanskrit | 18 | 4.06 | 4.5 | 0 / 2 / 4 / 3 / 9 | 50 | 66.7 | 11.1 | 27.8 | 22.2 | 0 | 27.8 |
| Spanish | 18 | 4.56 | 5 | 0 / 0 / 2 / 4 / 12 | 66.7 | 88.9 | 0 | 5.6 | 5.6 | 0 | 11.1 |
| Italian | 17 | 4.47 | 5 | 0 / 1 / 1 / 4 / 11 | 64.7 | 88.2 | 5.9 | 5.9 | 11.8 | 0 | 11.8 |
| Dutch | 17 | 4.94 | 5 | 0 / 0 / 0 / 1 / 16 | 94.1 | 100 | 0 | 0 | 0 | 0 | 0 |
| Korean | 12 | 4.42 | 5 | 0 / 0 / 2 / 3 / 7 | 58.3 | 83.3 | 0 | 25 | 0 | 0 | 8.3 |
| Japanese | 12 | 2.67 | 3 | 5 / 0 / 3 / 2 / 2 | 16.7 | 33.3 | 41.7 | 58.3 | 33.3 | 0 | 58.3 |
| Hebrew | 12 | 4 | 4.5 | 1 / 1 / 1 / 3 / 6 | 50 | 75 | 16.7 | 16.7 | 8.3 | 0 | 25 |

## By translation model arm (unpaired: different pages per arm, model follows the book)
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| agy-flash | 42 | 4.81 | 5 | 0 / 1 / 0 / 5 / 36 | 85.7 | 97.6 | 2.4 | 0 | 4.8 | 0 | 2.4 |
| lite | 146 | 4.31 | 5 | 5 / 3 / 18 / 36 / 84 | 57.5 | 82.2 | 5.5 | 19.2 | 8.2 | 0.7 | 15.8 |
| opus | 54 | 4.78 | 5 | 0 / 2 / 1 / 4 / 47 | 87 | 94.4 | 3.7 | 5.6 | 7.4 | 1.9 | 5.6 |
| gemini-legacy | 6 | 4.33 | 5 | 0 / 1 / 0 / 1 / 4 | 66.7 | 83.3 | 16.7 | 16.7 | 16.7 | 0 | 16.7 |
| flash | 117 | 4.57 | 5 | 4 / 4 / 4 / 14 / 91 | 77.8 | 89.7 | 6.8 | 6 | 6.8 | 0 | 9.4 |

## By language × arm
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Greek / agy-flash | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Greek / opus | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 0 | 16.7 | 0 | 0 |
| Greek / flash | 7 | 5 | 5 | 0 / 0 / 0 / 0 / 7 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Greek / lite | 16 | 3.94 | 4 | 1 / 1 / 2 / 6 / 6 | 37.5 | 75 | 12.5 | 12.5 | 12.5 | 6.3 | 25 |
| Arabic / agy-flash | 6 | 4.17 | 4.5 | 0 / 1 / 0 / 2 / 3 | 50 | 83.3 | 16.7 | 0 | 16.7 | 0 | 16.7 |
| Arabic / opus | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Arabic / flash | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 0 | 0 | 0 | 0 |
| Arabic / lite | 6 | 4.5 | 4.5 | 0 / 0 / 0 / 3 / 3 | 50 | 100 | 0 | 16.7 | 0 | 0 | 0 |
| Tibetan / lite | 6 | 4 | 4.5 | 0 / 1 / 1 / 1 / 3 | 50 | 66.7 | 16.7 | 16.7 | 16.7 | 0 | 33.3 |
| Tibetan / opus | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Tibetan / agy-flash | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Tibetan / flash | 6 | 4.5 | 5 | 0 / 1 / 0 / 0 / 5 | 83.3 | 83.3 | 16.7 | 0 | 0 | 0 | 16.7 |
| Korean / lite | 6 | 4.5 | 5 | 0 / 0 / 1 / 1 / 4 | 66.7 | 83.3 | 0 | 33.3 | 0 | 0 | 0 |
| Korean / flash | 6 | 4.33 | 4.5 | 0 / 0 / 1 / 2 / 3 | 50 | 83.3 | 0 | 16.7 | 0 | 0 | 16.7 |
| French / opus | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| French / agy-flash | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 0 | 0 | 0 | 0 |
| French / flash | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| French / lite | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Sanskrit / opus | 6 | 4 | 4.5 | 0 / 1 / 1 / 1 / 3 | 50 | 66.7 | 16.7 | 33.3 | 33.3 | 0 | 33.3 |
| Sanskrit / lite | 6 | 4 | 4 | 0 / 0 / 2 / 2 / 2 | 33.3 | 66.7 | 0 | 50 | 16.7 | 0 | 16.7 |
| Sanskrit / flash | 6 | 4.17 | 5 | 0 / 1 / 1 / 0 / 4 | 66.7 | 66.7 | 16.7 | 0 | 16.7 | 0 | 33.3 |
| Spanish / opus | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 0 | 0 | 0 | 0 |
| Spanish / flash | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 0 | 16.7 | 0 | 0 |
| Spanish / lite | 6 | 4 | 4 | 0 / 0 / 2 / 2 / 2 | 33.3 | 66.7 | 0 | 16.7 | 0 | 0 | 33.3 |
| Latin / gemini-legacy | 6 | 4.33 | 5 | 0 / 1 / 0 / 1 / 4 | 66.7 | 83.3 | 16.7 | 16.7 | 16.7 | 0 | 16.7 |
| Latin / opus | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 16.7 | 16.7 | 0 | 0 |
| Latin / agy-flash | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 0 | 0 | 0 | 0 |
| Latin / flash | 11 | 4.45 | 5 | 1 / 0 / 1 / 0 / 9 | 81.8 | 81.8 | 9.1 | 18.2 | 18.2 | 0 | 18.2 |
| Latin / lite | 29 | 4.55 | 5 | 0 / 0 / 2 / 9 / 18 | 62.1 | 93.1 | 0 | 13.8 | 0 | 0 | 3.4 |
| German / agy-flash | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 0 | 16.7 | 0 | 0 |
| German / opus | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| German / flash | 15 | 4.6 | 5 | 1 / 0 / 0 / 2 / 12 | 80 | 93.3 | 6.7 | 0 | 6.7 | 0 | 6.7 |
| German / lite | 8 | 4.63 | 5 | 0 / 0 / 1 / 1 / 6 | 75 | 87.5 | 0 | 25 | 0 | 0 | 12.5 |
| Japanese / flash | 6 | 3.67 | 4 | 1 / 0 / 1 / 2 / 2 | 33.3 | 66.7 | 16.7 | 50 | 16.7 | 0 | 16.7 |
| Japanese / lite | 6 | 1.67 | 1 | 4 / 0 / 2 / 0 / 0 | 0 | 0 | 66.7 | 66.7 | 50 | 0 | 100 |
| Hebrew / flash | 6 | 3.83 | 4 | 1 / 0 / 0 / 3 / 2 | 33.3 | 83.3 | 16.7 | 0 | 0 | 0 | 16.7 |
| Hebrew / lite | 6 | 4.17 | 5 | 0 / 1 / 1 / 0 / 4 | 66.7 | 66.7 | 16.7 | 33.3 | 16.7 | 0 | 33.3 |
| Italian / flash | 6 | 4.5 | 5 | 0 / 1 / 0 / 0 / 5 | 83.3 | 83.3 | 16.7 | 0 | 16.7 | 0 | 16.7 |
| Italian / lite | 11 | 4.45 | 5 | 0 / 0 / 1 / 4 / 6 | 54.5 | 90.9 | 0 | 9.1 | 9.1 | 0 | 9.1 |
| Dutch / flash | 10 | 5 | 5 | 0 / 0 / 0 / 0 / 10 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Dutch / lite | 7 | 4.86 | 5 | 0 / 0 / 0 / 1 / 6 | 85.7 | 100 | 0 | 0 | 0 | 0 | 0 |
| Chinese / opus | 6 | 4.5 | 5 | 0 / 1 / 0 / 0 / 5 | 83.3 | 83.3 | 16.7 | 0 | 0 | 16.7 | 16.7 |
| Chinese / lite | 6 | 3.83 | 3.5 | 0 / 0 / 3 / 1 / 2 | 33.3 | 50 | 0 | 33.3 | 33.3 | 0 | 50 |
| Chinese / agy-flash | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Chinese / flash | 6 | 4.67 | 5 | 0 / 0 / 0 / 2 / 4 | 66.7 | 100 | 0 | 0 | 0 | 0 | 0 |
| English / flash | 14 | 4.71 | 5 | 0 / 1 / 0 / 1 / 12 | 85.7 | 92.9 | 7.1 | 7.1 | 7.1 | 0 | 7.1 |
| English / lite | 21 | 4.76 | 5 | 0 / 0 / 0 / 5 / 16 | 76.2 | 100 | 0 | 14.3 | 4.8 | 0 | 0 |

## By period
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1500-1700 | 120 | 4.54 | 5 | 3 / 3 / 6 / 22 / 86 | 71.7 | 90 | 5 | 13.3 | 6.7 | 0 | 9.2 |
| 1700-1900 | 144 | 4.44 | 5 | 3 / 7 / 13 / 22 / 99 | 68.8 | 84 | 6.9 | 11.1 | 10.4 | 1.4 | 14.6 |
| 1900+ | 50 | 4.74 | 5 | 1 / 1 / 1 / 4 / 43 | 86 | 94 | 4 | 4 | 6 | 0 | 6 |
| pre-1500 | 31 | 4.29 | 5 | 2 / 0 / 3 / 8 / 18 | 58.1 | 83.9 | 6.5 | 16.1 | 3.2 | 0 | 12.9 |
| unknown | 20 | 4.8 | 5 | 0 / 0 / 0 / 4 / 16 | 80 | 100 | 0 | 0 | 0 | 0 | 0 |

## By arm / prompt label
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| agy-flash/13 | 42 | 4.81 | 5 | 0 / 1 / 0 / 5 / 36 | 85.7 | 97.6 | 2.4 | 0 | 4.8 | 0 | 2.4 |
| lite/13 | 40 | 4.47 | 5 | 0 / 1 / 3 / 12 / 24 | 60 | 90 | 2.5 | 12.5 | 5 | 0 | 10 |
| lite/11 | 27 | 4.22 | 5 | 2 / 0 / 5 / 3 / 17 | 63 | 74.1 | 7.4 | 25.9 | 7.4 | 0 | 22.2 |
| lite/v10 | 65 | 4.14 | 4 | 3 / 2 / 10 / 18 / 32 | 49.2 | 76.9 | 7.7 | 23.1 | 10.8 | 1.5 | 20 |
| opus/13 | 42 | 4.88 | 5 | 0 / 1 / 0 / 2 / 39 | 92.9 | 97.6 | 2.4 | 0 | 2.4 | 2.4 | 2.4 |
| opus/1 | 11 | 4.36 | 5 | 0 / 1 / 1 / 2 / 7 | 63.6 | 81.8 | 9.1 | 27.3 | 27.3 | 0 | 18.2 |
| gemini-legacy/? | 6 | 4.33 | 5 | 0 / 1 / 0 / 1 / 4 | 66.7 | 83.3 | 16.7 | 16.7 | 16.7 | 0 | 16.7 |
| flash/v10 | 23 | 4.43 | 5 | 1 / 1 / 1 / 4 / 16 | 69.6 | 87 | 8.7 | 8.7 | 17.4 | 0 | 13 |
| flash/v2 | 40 | 4.72 | 5 | 1 / 1 / 1 / 2 / 35 | 87.5 | 92.5 | 5 | 2.5 | 7.5 | 0 | 7.5 |
| flash/v5.2026-02 | 10 | 5 | 5 | 0 / 0 / 0 / 0 / 10 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| opus/v1 | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/11 | 13 | 4 | 4 | 1 / 1 / 1 / 4 / 6 | 46.2 | 76.9 | 15.4 | 23.1 | 7.7 | 0 | 23.1 |
| flash/12 | 3 | 3 | 3 | 1 / 0 / 1 / 0 / 1 | 33.3 | 33.3 | 33.3 | 33.3 | 0 | 0 | 33.3 |
| flash/13 | 16 | 4.63 | 5 | 0 / 1 / 0 / 3 / 12 | 75 | 93.8 | 6.3 | 0 | 0 | 0 | 6.3 |
| flash/v5.1.2026-03b | 9 | 4.89 | 5 | 0 / 0 / 0 / 1 / 8 | 88.9 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/? | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/v1 | 2 | 5 | 5 | 0 / 0 / 0 / 0 / 2 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| lite/v1 | 9 | 4.89 | 5 | 0 / 0 / 0 / 1 / 8 | 88.9 | 100 | 0 | 0 | 0 | 0 | 0 |
| lite/2 | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 50 | 0 | 0 | 0 |
| lite/1 | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 0 | 50 | 0 | 0 |
| lite/12 | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |

## Script class
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| non-latin-script | 161 | 4.3 | 5 | 7 / 8 / 16 / 28 / 102 | 63.4 | 80.7 | 9.3 | 14.3 | 9.9 | 1.2 | 17.4 |
| latin-script | 204 | 4.69 | 5 | 2 / 3 / 7 / 32 / 160 | 78.4 | 94.1 | 2.5 | 7.8 | 5.4 | 0 | 5.4 |

## Defect types (primary judge, main items)
| type/severity | n |
|---|---:|
| mistranslation/minor | 61 |
| omission/minor | 30 |
| invention/major | 15 |
| omission/major | 14 |
| invention/minor | 14 |
| garble_passthrough/major | 6 |
| wrong_page/major | 5 |
| mistranslation/major | 5 |
| inversion/minor | 4 |
| truncated/major | 3 |
| name/minor | 3 |
| garble_passthrough/minor | 2 |
| inversion/major | 2 |
| terminology/minor | 2 |
| untranslated/major | 2 |
| number/minor | 1 |

## Worst 25 (primary judge)
| fidelity | language | arm | flags | url | reason |
|---:|---|---|---|---|---|
| 1 | Japanese | flash | omission, invention, truncated | https://sourcelibrary.org/book/69f3276f52a77bb28fdb7316?page=3 | Drops almost the entire text after the first two clauses and hallucinates content/water damage not matching the source transcription |
| 1 | Hebrew | flash | wrong_page | https://sourcelibrary.org/book/6a357f1ac6e2d5bb56a64539?page=204 | The source transcription is from a completely different folio/leaf than image.jpg (Ch. 3 Halakha 11 / Ch. 4 Halakha 1 vs. Ch. 4 Halakhot 2–4). |
| 1 | Japanese | lite | invention | https://sourcelibrary.org/book/69e75ccc3f15c712bdb8f04e?page=40 | Complete hallucination/mistranslation throughout: misinterprets classical Japanese Kuzushiji transcription as isolated character fragments, producing nonsense poetry with no counterpart in the source  |
| 1 | Japanese | lite | omission, invention | https://sourcelibrary.org/book/69e726a9a409200ea79efa80?page=17 | Source describes watching women aged 17-20 pass by all day and finding one lovely woman; translation invents a narrative about riding in a carriage and shouting murder threats. |
| 1 | Japanese | lite | omission, invention, wrong_page | https://sourcelibrary.org/book/69e4207471f02ebac6264a46?page=7 | Translation fabricates a completely unrelated text about a woman named 'Afumiya' instead of translating the source text about Yonosuke and the servant girl. |
| 1 | Japanese | lite | omission, wrong_page | https://sourcelibrary.org/book/69e014d927a1381d255992b7?page=32 | Source text contains waka poetry selections, whereas the translation is of the opening of Genji Monogatari (Kiritsubo); completely wrong page/text. |
| 1 | Greek | lite | wrong_page | https://sourcelibrary.org/book/69938985ce1538706594752c?page=233 | Faithfully translates the provided Greek source text throughout with high accuracy, but evaluating strictly against source text. |
| 1 | German | flash | wrong_page | https://sourcelibrary.org/book/69c7fdea6c6f3cc53c84359c?page=143 | translation is entirely from a different page/text; none of the source text appears in the translation |
| 1 | Latin | flash | omission, invention, truncated | https://sourcelibrary.org/book/695201a9ab34727b1f041826?page=82 | Drops the vast majority of the text and replaces it with brief, largely invented notes and summaries based on misunderstood fragments ('sedi' as 'fedi', 'se rationem' as 'ferationem'). |
| 2 | Arabic | agy-flash | invention, garble_passthrough | https://sourcelibrary.org/book/6a2032ad18654bf8e1903546?page=22 | papers over garbled/phonetic OCR transcription of Persian/Jawi verses as fluent philosophical poetry |
| 2 | Tibetan | lite | invention, garble_passthrough | https://sourcelibrary.org/book/69e7abec5f1a22ab19aa0707?page=712 | Line 1 in transcription is a severe garble/hallucination replacing line 1 of the leaf, which translation papers over with fluent nonsense, while lines 2-7 are translated accurately. |
| 2 | Sanskrit | opus | omission, invention | https://sourcelibrary.org/book/69920beee0a548a13d887aeb?page=519 | Omits initial commentary lines on verse 3 present in source; invents extensive completion of commentary on verse 5 not present in source |
| 2 | Latin | gemini-legacy | omission, truncated | https://sourcelibrary.org/book/69522ff2ab34727b1f044362?page=584 | Severely truncated: stops midway through the navigation passage in column 1, completely omitting over half the source page including both entire sections on Music and Astronomy. |
| 2 | Italian | flash | invention | https://sourcelibrary.org/book/6991eadd2f801130a473ea3c?page=31 | Faithfully translates the publisher label text, but invents four paragraphs of anatomical notes about the spine and nerves not present in the source. |
| 2 | Hebrew | lite | omission, invention | https://sourcelibrary.org/book/69c1bb2e8522835be845d575?page=46 | Source is a litany of praise phrases (signs 68 and 69) which translation systematically expands into full copular assertions ('is the preciousness...'); otherwise matches Hebrew attributes listed in t |
| 2 | Chinese | opus | untranslated | https://sourcelibrary.org/book/6a3ceaf795fcd45563052360?page=25 | Transliterates the entire page into pinyin instead of translating it into English, relegating the English text to house notes |
| 2 | Sanskrit | flash | garble_passthrough | https://sourcelibrary.org/book/69de98eb1b234a773e439877?page=63 | Papers over multiple heavily garbled/corrupted OCR verses (notably v. 140, 142, 143, 144) as fluent, polished prose reconstructing the classical text. |
| 2 | Greek | lite | invention | https://sourcelibrary.org/book/699388ea1075be7d320551a0?page=101 | Transfers star descriptions faithfully from source Greek but invents identical tabular coordinate values (24, 1/3, 44, 1/3, 1, 4) down the entirety of both tables. |
| 2 | English | flash | omission, invention | https://sourcelibrary.org/book/69c886236c6f3cc53c859d1d?page=303 | Drops the entire first column of source text and invents a concluding sentence and citation not present in the source. |
| 2 | Tibetan | flash |  | https://sourcelibrary.org/book/69e7613ccc48e59ad74ee65d?page=144 | Translates the text accurately section by section but in reverse page/leaf order (leaf 3 -> leaf 2 -> leaf 1). |
| 3 | Tibetan | lite | omission, truncated | https://sourcelibrary.org/book/69e7aafc5f1a22ab19a90d9c?page=323 | Faithfully renders most similes of how a bodhisattva views beings, but cuts off at the truncated ninth simile and drops the opening clause. |
| 3 | Korean | lite | omission | https://sourcelibrary.org/book/69e014d647b76785d4ec821c?page=174 | Transliterates the Chinese/Sanskrit characters phonetically (partially via Mandarin pinyin for first line, Korean reading for the rest), but accurately tracks the OCR text except for missing portions  |
| 3 | Sanskrit | opus | omission | https://sourcelibrary.org/book/69ee89f34501bec896546e1d?page=770 | Translates verse lines and essential commentary for verses 6 and 7, but completely drops the preceding lines of text/commentary before the colophon and Sāyaṇa's grammatical notes |
| 3 | Japanese | flash | omission | https://sourcelibrary.org/book/69dfede68d34461cbe7f4df4?page=71 | Faithfully translates items ①–㊿ and (1344), but replaces entries (51)–(1343) with an interpretive summary note. |
| 3 | Spanish | lite | omission | https://sourcelibrary.org/book/69f33acf876dd827cbc5823d?page=80 | Drops the entire opening clause identifying the litigant Tofiño de la Canal, his father, and the period the witness had known them; resumes translation at 'in the said town of San Martin'; otherwise f |
