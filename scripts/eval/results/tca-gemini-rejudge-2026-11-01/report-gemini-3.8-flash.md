# Translation corpus audit — run

Judge: gemini-3.8-flash (source-grounded, reference-free, single candidate; measure = judge rating, NOT accuracy). 365 pages from 365 books, one interior page per book, seed 20261030.

**Controls gate: PASS** (swap ≥ 93% rated ≤2, drop ≥ 87% flagged omission, repeat ≥ 93% within one; ≥ 10 of each).

## Controls (read first)
- swap (translation of another page): 15/15 rated ≤2, 15/15 flagged wrong_page
- drop (middle ~35% removed): 15/15 flagged omission, 14/15 rated ≤3
- repeat (same item twice): 12/15 exact, 15/15 within 1, 13/15 identical flags

## Corpus estimate (post-stratified by language; 95% CI)
| statistic | est % | CI |
|---|---:|---|
| fidelity 5 | 62.7 | 56.8–68.7 |
| fidelity ≥ 4 | 91.1 | 87.5–94.2 |
| fidelity ≤ 2 | 5.1 | 2.8–7.8 |
| any major defect | 8.6 | 5.5–12.3 |
| omission | 16.2 | 11.8–20.9 |
| invention | 5.4 | 2.8–8.4 |
| inversion | 3 | 0.9–5.5 |
| untranslated | 0.2 | 0–0.7 |
| wrong_language | 0 | 0–0 |
| wrong_page | 0.4 | 0–1.1 |
| garble_passthrough | 4.4 | 2.2–7.1 |
| truncated | 1 | 0–2.5 |
| repetition | 0 | 0–0 |

## By language
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin | 58 | 4.38 | 5 | 1 / 1 / 3 / 23 / 30 | 51.7 | 91.4 | 3.4 | 19 | 5.2 | 0 | 8.6 |
| Greek | 35 | 4.4 | 5 | 0 / 3 / 1 / 10 / 21 | 60 | 88.6 | 8.6 | 17.1 | 2.9 | 2.9 | 11.4 |
| German | 35 | 4.6 | 5 | 1 / 1 / 0 / 7 / 26 | 74.3 | 94.3 | 5.7 | 8.6 | 5.7 | 0 | 5.7 |
| English | 35 | 4.77 | 5 | 0 / 1 / 0 / 5 / 29 | 82.9 | 97.1 | 2.9 | 8.6 | 5.7 | 0 | 2.9 |
| Arabic | 24 | 4.42 | 5 | 0 / 1 / 1 / 9 / 13 | 54.2 | 91.7 | 4.2 | 4.2 | 12.5 | 0 | 8.3 |
| Tibetan | 24 | 4.38 | 5 | 0 / 2 / 0 / 9 / 13 | 54.2 | 91.7 | 8.3 | 20.8 | 4.2 | 0 | 8.3 |
| French | 24 | 4.92 | 5 | 0 / 0 / 0 / 2 / 22 | 91.7 | 100 | 0 | 0 | 0 | 0 | 0 |
| Chinese | 24 | 4.33 | 5 | 0 / 2 / 2 / 6 / 14 | 58.3 | 83.3 | 8.3 | 29.2 | 8.3 | 0 | 12.5 |
| Sanskrit | 18 | 3.78 | 3.5 | 0 / 2 / 7 / 2 / 7 | 38.9 | 50 | 11.1 | 38.9 | 11.1 | 0 | 50 |
| Spanish | 18 | 4.61 | 5 | 0 / 0 / 1 / 5 / 12 | 66.7 | 94.4 | 0 | 5.6 | 0 | 0 | 5.6 |
| Italian | 17 | 4.24 | 5 | 0 / 2 / 1 / 5 / 9 | 52.9 | 82.4 | 11.8 | 11.8 | 11.8 | 0 | 17.6 |
| Dutch | 17 | 4.82 | 5 | 0 / 0 / 0 / 3 / 14 | 82.4 | 100 | 0 | 11.8 | 0 | 0 | 0 |
| Korean | 12 | 4.25 | 4 | 0 / 0 / 1 / 7 / 4 | 33.3 | 91.7 | 0 | 41.7 | 8.3 | 0 | 8.3 |
| Japanese | 12 | 2.5 | 2 | 3 / 4 / 2 / 2 / 1 | 8.3 | 25 | 58.3 | 83.3 | 41.7 | 0 | 75 |
| Hebrew | 12 | 4.08 | 4.5 | 0 / 2 / 1 / 3 / 6 | 50 | 75 | 16.7 | 33.3 | 8.3 | 0 | 25 |

## By translation model arm (unpaired: different pages per arm, model follows the book)
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| agy-flash | 42 | 4.67 | 5 | 0 / 1 / 1 / 9 / 31 | 73.8 | 95.2 | 2.4 | 7.1 | 9.5 | 0 | 4.8 |
| lite | 146 | 4.18 | 4 | 3 / 10 / 12 / 53 / 68 | 46.6 | 82.9 | 8.9 | 26 | 7.5 | 0.7 | 17.1 |
| opus | 54 | 4.72 | 5 | 0 / 2 / 2 / 5 / 45 | 83.3 | 92.6 | 3.7 | 11.1 | 3.7 | 0 | 7.4 |
| gemini-legacy | 6 | 4.33 | 5 | 0 / 1 / 0 / 1 / 4 | 66.7 | 83.3 | 16.7 | 16.7 | 16.7 | 0 | 16.7 |
| flash | 117 | 4.41 | 5 | 2 / 7 / 5 / 30 / 73 | 62.4 | 88 | 7.7 | 16.2 | 6 | 0 | 11.1 |

## By language × arm
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Greek / agy-flash | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Greek / opus | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 0 | 0 | 0 | 0 |
| Greek / flash | 7 | 4.71 | 5 | 0 / 0 / 0 / 2 / 5 | 71.4 | 100 | 0 | 14.3 | 0 | 0 | 0 |
| Greek / lite | 16 | 3.88 | 4 | 0 / 3 / 1 / 7 / 5 | 31.3 | 75 | 18.8 | 31.3 | 6.3 | 6.3 | 25 |
| Arabic / agy-flash | 6 | 3.83 | 4 | 0 / 1 / 1 / 2 / 2 | 33.3 | 66.7 | 16.7 | 16.7 | 33.3 | 0 | 33.3 |
| Arabic / opus | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Arabic / flash | 6 | 4.33 | 4 | 0 / 0 / 0 / 4 / 2 | 33.3 | 100 | 0 | 0 | 16.7 | 0 | 0 |
| Arabic / lite | 6 | 4.5 | 4.5 | 0 / 0 / 0 / 3 / 3 | 50 | 100 | 0 | 0 | 0 | 0 | 0 |
| Tibetan / lite | 6 | 3.83 | 4 | 0 / 1 / 0 / 4 / 1 | 16.7 | 83.3 | 16.7 | 50 | 16.7 | 0 | 16.7 |
| Tibetan / opus | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 16.7 | 0 | 0 | 0 |
| Tibetan / agy-flash | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 0 | 0 | 0 | 0 |
| Tibetan / flash | 6 | 4 | 4 | 0 / 1 / 0 / 3 / 2 | 33.3 | 83.3 | 16.7 | 16.7 | 0 | 0 | 16.7 |
| Korean / lite | 6 | 4.17 | 4 | 0 / 0 / 1 / 3 / 2 | 33.3 | 83.3 | 0 | 33.3 | 0 | 0 | 16.7 |
| Korean / flash | 6 | 4.33 | 4 | 0 / 0 / 0 / 4 / 2 | 33.3 | 100 | 0 | 50 | 16.7 | 0 | 0 |
| French / opus | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| French / agy-flash | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 0 | 0 | 0 | 0 |
| French / flash | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| French / lite | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 0 | 0 | 0 | 0 |
| Sanskrit / opus | 6 | 3.67 | 4 | 0 / 2 / 1 / 0 / 3 | 50 | 50 | 33.3 | 50 | 33.3 | 0 | 50 |
| Sanskrit / lite | 6 | 3.83 | 3.5 | 0 / 0 / 3 / 1 / 2 | 33.3 | 50 | 0 | 50 | 0 | 0 | 50 |
| Sanskrit / flash | 6 | 3.83 | 3.5 | 0 / 0 / 3 / 1 / 2 | 33.3 | 50 | 0 | 16.7 | 0 | 0 | 50 |
| Spanish / opus | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Spanish / flash | 6 | 4.67 | 5 | 0 / 0 / 0 / 2 / 4 | 66.7 | 100 | 0 | 0 | 0 | 0 | 0 |
| Spanish / lite | 6 | 4.17 | 4 | 0 / 0 / 1 / 3 / 2 | 33.3 | 83.3 | 0 | 16.7 | 0 | 0 | 16.7 |
| Latin / gemini-legacy | 6 | 4.33 | 5 | 0 / 1 / 0 / 1 / 4 | 66.7 | 83.3 | 16.7 | 16.7 | 16.7 | 0 | 16.7 |
| Latin / opus | 6 | 4.33 | 4.5 | 0 / 0 / 1 / 2 / 3 | 50 | 83.3 | 0 | 16.7 | 0 | 0 | 16.7 |
| Latin / agy-flash | 6 | 4.5 | 4.5 | 0 / 0 / 0 / 3 / 3 | 50 | 100 | 0 | 16.7 | 16.7 | 0 | 0 |
| Latin / flash | 11 | 4.36 | 5 | 1 / 0 / 0 / 3 / 7 | 63.6 | 90.9 | 9.1 | 18.2 | 9.1 | 0 | 9.1 |
| Latin / lite | 29 | 4.38 | 4 | 0 / 0 / 2 / 14 / 13 | 44.8 | 93.1 | 0 | 20.7 | 0 | 0 | 6.9 |
| German / agy-flash | 6 | 4.67 | 5 | 0 / 0 / 0 / 2 / 4 | 66.7 | 100 | 0 | 16.7 | 16.7 | 0 | 0 |
| German / opus | 6 | 4.83 | 5 | 0 / 0 / 0 / 1 / 5 | 83.3 | 100 | 0 | 16.7 | 0 | 0 | 0 |
| German / flash | 15 | 4.53 | 5 | 1 / 0 / 0 / 3 / 11 | 73.3 | 93.3 | 6.7 | 0 | 6.7 | 0 | 6.7 |
| German / lite | 8 | 4.5 | 5 | 0 / 1 / 0 / 1 / 6 | 75 | 87.5 | 12.5 | 12.5 | 0 | 0 | 12.5 |
| Japanese / flash | 6 | 3.17 | 3 | 0 / 3 / 0 / 2 / 1 | 16.7 | 50 | 50 | 83.3 | 16.7 | 0 | 50 |
| Japanese / lite | 6 | 1.83 | 1.5 | 3 / 1 / 2 / 0 / 0 | 0 | 0 | 66.7 | 83.3 | 66.7 | 0 | 100 |
| Hebrew / flash | 6 | 4.17 | 5 | 0 / 1 / 1 / 0 / 4 | 66.7 | 66.7 | 16.7 | 33.3 | 0 | 0 | 33.3 |
| Hebrew / lite | 6 | 4 | 4 | 0 / 1 / 0 / 3 / 2 | 33.3 | 83.3 | 16.7 | 33.3 | 16.7 | 0 | 16.7 |
| Italian / flash | 6 | 4.33 | 5 | 0 / 1 / 0 / 1 / 4 | 66.7 | 83.3 | 16.7 | 16.7 | 16.7 | 0 | 16.7 |
| Italian / lite | 11 | 4.18 | 4 | 0 / 1 / 1 / 4 / 5 | 45.5 | 81.8 | 9.1 | 9.1 | 9.1 | 0 | 18.2 |
| Dutch / flash | 10 | 4.9 | 5 | 0 / 0 / 0 / 1 / 9 | 90 | 100 | 0 | 0 | 0 | 0 | 0 |
| Dutch / lite | 7 | 4.71 | 5 | 0 / 0 / 0 / 2 / 5 | 71.4 | 100 | 0 | 28.6 | 0 | 0 | 0 |
| Chinese / opus | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Chinese / lite | 6 | 3.17 | 3.5 | 0 / 2 / 1 / 3 / 0 | 0 | 50 | 33.3 | 83.3 | 33.3 | 0 | 50 |
| Chinese / agy-flash | 6 | 5 | 5 | 0 / 0 / 0 / 0 / 6 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Chinese / flash | 6 | 4.17 | 4 | 0 / 0 / 1 / 3 / 2 | 33.3 | 83.3 | 0 | 33.3 | 0 | 0 | 0 |
| English / flash | 14 | 4.71 | 5 | 0 / 1 / 0 / 1 / 12 | 85.7 | 92.9 | 7.1 | 7.1 | 7.1 | 0 | 7.1 |
| English / lite | 21 | 4.81 | 5 | 0 / 0 / 0 / 4 / 17 | 81 | 100 | 0 | 9.5 | 4.8 | 0 | 0 |

## By period
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1500-1700 | 120 | 4.39 | 5 | 3 / 4 / 5 / 39 / 69 | 57.5 | 90 | 5.8 | 17.5 | 5.8 | 0 | 10 |
| 1700-1900 | 144 | 4.32 | 5 | 1 / 14 / 8 / 36 / 85 | 59 | 84 | 10.4 | 21.5 | 9 | 0.7 | 16 |
| 1900+ | 50 | 4.6 | 5 | 0 / 1 / 4 / 9 / 36 | 72 | 90 | 2 | 12 | 6 | 0 | 10 |
| pre-1500 | 31 | 4.32 | 5 | 1 / 2 / 1 / 9 / 18 | 58.1 | 87.1 | 9.7 | 16.1 | 6.5 | 0 | 12.9 |
| unknown | 20 | 4.55 | 5 | 0 / 0 / 2 / 5 / 13 | 65 | 90 | 0 | 20 | 0 | 0 | 5 |

## By arm / prompt label
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| agy-flash/13 | 42 | 4.67 | 5 | 0 / 1 / 1 / 9 / 31 | 73.8 | 95.2 | 2.4 | 7.1 | 9.5 | 0 | 4.8 |
| lite/13 | 40 | 4.3 | 4 | 0 / 2 / 3 / 16 / 19 | 47.5 | 87.5 | 5 | 20 | 5 | 0 | 12.5 |
| lite/11 | 27 | 3.96 | 4 | 1 / 3 / 4 / 7 / 12 | 44.4 | 70.4 | 14.8 | 29.6 | 7.4 | 0 | 29.6 |
| lite/v10 | 65 | 4.08 | 4 | 2 / 5 / 5 / 27 / 26 | 40 | 81.5 | 10.8 | 33.8 | 9.2 | 1.5 | 18.5 |
| opus/13 | 42 | 4.95 | 5 | 0 / 0 / 0 / 2 / 40 | 95.2 | 100 | 0 | 4.8 | 0 | 0 | 0 |
| opus/1 | 11 | 3.82 | 4 | 0 / 2 / 2 / 3 / 4 | 36.4 | 63.6 | 18.2 | 36.4 | 18.2 | 0 | 36.4 |
| gemini-legacy/? | 6 | 4.33 | 5 | 0 / 1 / 0 / 1 / 4 | 66.7 | 83.3 | 16.7 | 16.7 | 16.7 | 0 | 16.7 |
| flash/v10 | 23 | 4.26 | 5 | 1 / 1 / 1 / 8 / 12 | 52.2 | 87 | 8.7 | 17.4 | 8.7 | 0 | 13 |
| flash/v2 | 40 | 4.63 | 5 | 1 / 1 / 2 / 4 / 32 | 80 | 90 | 5 | 5 | 5 | 0 | 10 |
| flash/v5.2026-02 | 10 | 4.9 | 5 | 0 / 0 / 0 / 1 / 9 | 90 | 100 | 0 | 0 | 0 | 0 | 0 |
| opus/v1 | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/11 | 13 | 3.92 | 4 | 0 / 2 / 1 / 6 / 4 | 30.8 | 76.9 | 15.4 | 53.8 | 15.4 | 0 | 23.1 |
| flash/12 | 3 | 3 | 2 | 0 / 2 / 0 / 0 / 1 | 33.3 | 33.3 | 66.7 | 66.7 | 0 | 0 | 66.7 |
| flash/13 | 16 | 4.19 | 4 | 0 / 1 / 1 / 8 / 6 | 37.5 | 87.5 | 6.3 | 18.8 | 6.3 | 0 | 6.3 |
| flash/v5.1.2026-03b | 9 | 4.78 | 5 | 0 / 0 / 0 / 2 / 7 | 77.8 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/? | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/v1 | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 50 | 0 | 0 | 0 |
| lite/v1 | 9 | 4.78 | 5 | 0 / 0 / 0 / 2 / 7 | 77.8 | 100 | 0 | 0 | 0 | 0 | 0 |
| lite/2 | 2 | 5 | 5 | 0 / 0 / 0 / 0 / 2 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| lite/1 | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 0 | 50 | 0 | 0 |
| lite/12 | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |

## Script class
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| non-latin-script | 161 | 4.14 | 4 | 3 / 16 / 15 / 48 / 79 | 49.1 | 78.9 | 11.8 | 28 | 9.9 | 0.6 | 20.5 |
| latin-script | 204 | 4.59 | 5 | 2 / 5 / 5 / 50 / 142 | 69.6 | 94.1 | 3.4 | 10.8 | 4.4 | 0 | 5.9 |

## Defect types (primary judge, main items)
| type/severity | n |
|---|---:|
| mistranslation/minor | 67 |
| omission/minor | 50 |
| omission/major | 28 |
| garble_passthrough/minor | 19 |
| terminology/minor | 13 |
| invention/major | 13 |
| invention/minor | 12 |
| garble_passthrough/major | 9 |
| name/minor | 6 |
| inversion/minor | 6 |
| mistranslation/major | 6 |
| number/minor | 5 |
| inversion/major | 4 |
| truncated/major | 2 |
| wrong_page/major | 2 |
| truncated/minor | 1 |
| untranslated/major | 1 |

## Worst 25 (primary judge)
| fidelity | language | arm | flags | url | reason |
|---:|---|---|---|---|---|
| 1 | Japanese | lite | omission, invention | https://sourcelibrary.org/book/69e726a9a409200ea79efa80?page=17 | Completely hallucinates an unrelated story about a man threatening murder from a carriage, omitting the actual source text describing women passing by and the arrival of a beautiful lady. |
| 1 | Japanese | lite | omission, invention, inversion | https://sourcelibrary.org/book/69e4207471f02ebac6264a46?page=7 | Pervasive hallucination: invents the protagonist 'Afumiya' throughout, drops Yonosuke (世之介) and the monk (御出家), and fabricates most of the text. |
| 1 | Japanese | lite | omission, invention, wrong_page | https://sourcelibrary.org/book/69e014d927a1381d255992b7?page=32 | Source text consists of classical waka poems, but the translation renders the Kiritsubo chapter of The Tale of Genji. |
| 1 | German | flash | wrong_page | https://sourcelibrary.org/book/69c7fdea6c6f3cc53c84359c?page=143 | Translation is of a different page/text (discussing Antichrist in Babylon and Holy Fathers rather than Christ's prophecy, Paul, and Irenaeus on p. 117). |
| 1 | Latin | flash | omission, invention | https://sourcelibrary.org/book/695201a9ab34727b1f041826?page=82 | Omits ~90% of the Latin text, translating only one short clause from Resolut. Theolog. while fabricating commentary and misreading isolated words into anatomical/moral claims. |
| 2 | Arabic | agy-flash | invention, garble_passthrough | https://sourcelibrary.org/book/6a2032ad18654bf8e1903546?page=22 | Garbled OCR in couplets 1–2 is smoothed into fluent confident prose with terms not present in the source lines; couplets 3–5 partially track the OCR text. |
| 2 | Tibetan | lite | omission, invention, garble_passthrough, truncated | https://sourcelibrary.org/book/69e7aba95f1a22ab19a9be00?page=385 | Patches scrambled lines by inventing repetitive clauses, omits entire clauses, papers over heavily garbled OCR as fluent prose, and truncates before the end |
| 2 | Sanskrit | opus | omission | https://sourcelibrary.org/book/69ee89f34501bec896546e1d?page=770 | omits the opening commentary paragraph, Śrautasūtra ritual citations, and extensive grammatical analysis throughout; translates only verses and simplified paraphrase |
| 2 | Sanskrit | opus | omission, invention | https://sourcelibrary.org/book/69920beee0a548a13d887aeb?page=519 | omits the first five sentences of verse 3 commentary and imports the continuation of verse 5 commentary from the next page |
| 2 | Latin | gemini-legacy | omission, truncated | https://sourcelibrary.org/book/69522ff2ab34727b1f044362?page=584 | Translation is truncated mid-sentence in the first column, omitting more than two thirds of the page (rest of navigation, Music, and Astronomy). |
| 2 | Japanese | flash | omission, truncated | https://sourcelibrary.org/book/69f3276f52a77bb28fdb7316?page=3 | Truncates after the first two clauses and omits approximately 80% of the page text under the pretext of water damage, along with mistranslating the opening lines. |
| 2 | Japanese | flash | omission, invention, inversion, garble_passthrough | https://sourcelibrary.org/book/6a0aca8b676a42ccd9775261?page=19 | Invents diagram descriptions in notes; inverts warning about small hole; misidentifies neck as cylinder and mangles flipping mechanism description. |
| 2 | Japanese | flash | omission | https://sourcelibrary.org/book/69dfede68d34461cbe7f4df4?page=71 | omits repeated formula items (51) through (1343) of 'の三の三', summarizing them in a note instead of translating; otherwise follows source |
| 2 | Hebrew | flash | omission, truncated | https://sourcelibrary.org/book/6a357f1ac6e2d5bb56a64539?page=204 | Substantial omission: truncates 'סליק פירקא' commentary and entirely drops the 'עמודי ירושלים חנינא' commentary section. |
| 2 | Japanese | lite | omission, invention, garble_passthrough | https://sourcelibrary.org/book/69e75ccc3f15c712bdb8f04e?page=40 | Substantial mistranslations and omissions throughout; invents musical gloss tags and turns garbled OCR into fluent nonsense. |
| 2 | Italian | flash | invention | https://sourcelibrary.org/book/6991eadd2f801130a473ea3c?page=31 | Translates the publisher label faithfully, but invents extensive anatomical notes on nerves and the spinal cord with no counterpart in source. |
| 2 | Hebrew | lite | omission, invention | https://sourcelibrary.org/book/69b4cd3dd5b6c3815e1a504b?page=154 | Entire second column (Targum Onkelos) is omitted, and translation imports Leviticus 23:43-44 not present in the source text |
| 2 | Italian | lite | omission | https://sourcelibrary.org/book/6a084e0949638a50931b4b3d?page=422 | drops the entire opening passage (~8 lines, from 'tando gli impacciavano' through 'insieme col caporale'); the remainder faithfully translates the source |
| 2 | Chinese | lite | omission | https://sourcelibrary.org/book/69e788094a6785cfd60ceb41?page=53 | Major omissions of medicinal properties, indications, and author attributions in 無風獨搖草 and 筋子根, plus month number error in 倚待草 |
| 2 | Chinese | lite | omission, invention | https://sourcelibrary.org/book/69aebb3439a4307877772f55?page=253 | Translates left leaf before right; inserts 'rarely associated with true virtue' from Analects 1.3; omits commentary '衣服之也裘皮服敝壞也憾恨也' and citation '易曰勞而不伐是也'. |
| 2 | Greek | lite | omission, untranslated | https://sourcelibrary.org/book/69942af7d607f8e57e4b5faa?page=418 | Leaves Greek Psalm 43:16-34 entirely untranslated in Greek and omits the Vatican codex addenda apparatus at the bottom; Latin Psalm and Athanasius commentary are translated. |
| 2 | Greek | lite | omission, invention | https://sourcelibrary.org/book/69d144c11c2a66dc094b1de5?page=222 | Omits the entire Latin critical apparatus (~14 lines) to a summary note; invents continuation 'they say that ... the tyrant' for truncated clause 'τὸν γὰρ Διονύ-' |
| 2 | Greek | lite | omission | https://sourcelibrary.org/book/699379e3b0a84a57639666b4?page=367 | Omits the entire critical apparatus (lines 7–21) and skips the commentary note on line 17 (τὸν . . . ἔμμεναι) and gloss on μέρος; translated portions are otherwise faithful. |
| 2 | English | flash | omission, invention | https://sourcelibrary.org/book/69c886236c6f3cc53c859d1d?page=303 | Completely omits the first column of the source text; invents an unstated subject at the start and an imported sentence completion with citation at the end. |
| 2 | German | lite | omission | https://sourcelibrary.org/book/6a267b7a6c1f37c9c4f31db9?page=58 | Omits the first 9 lines of main text ('schrieben worden...' through '...beschissen'); remainder is translated faithfully. |
