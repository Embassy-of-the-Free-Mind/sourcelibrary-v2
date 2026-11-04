# Wave 2 analysis — translation-corpus-audit-wave2-2026-10-30

measure = `judged`; 365 books, one interior page each. Rates post-stratified by language × model arm unless marked "lang".

| judge | n | ≥4 | major defect | ≥4 (lang) | major (lang) | fidelity 5 | ≤2 | OCR misread (image) | wrong leaf | image read (first words found in OCR) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| opus | 365 | 86.3% (81.3–90.9) | 13.6% (9–18.7) | 87.1% (82.7–91.1) | 12.8% (8.9–17.1) | 46.8% (40.1–53.7) | 2.9% (0.8–5.4) | 21.3% (15.6–26.9) | 6 | 334/365 |
| gemini-flash-low | 365 | 90.3% (85.6–94.1) | 8.7% (5.1–13.1) | 91.3% (87.8–94.5) | 7.9% (4.9–11.2) | 72.5% (65.7–78.9) | 4.1% (1.6–7.3) | 14.3% (10–19.2) | 5 | 343/365 |

## Judge reliability (opus vs gemini-flash-low, 365 books)
exact 61.4%, within one 96.2%, mean(A−B) -0.255

- fidelity (ordinal): α 0.53 [0.44, 0.61], 365 books — not settled
- fidelity_ge4 (nominal): α 0.53 [0.39, 0.65], 365 books — not settled
- major_defect (nominal): α 0.52 [0.38, 0.65], 365 books — not settled
- omission (nominal): α 0.53 [0.40, 0.65], 365 books — not settled
- invention (nominal): α 0.50 [0.34, 0.64], 365 books — not settled
- ocr_misread (nominal): α 0.54 [0.44, 0.64], 365 books — not settled

## Self-preference
```
{
 "judge_a": "opus",
 "judge_b": "gemini-flash-low",
 "n_claude": 54,
 "n_gemini": 311,
 "fidelity": {
  "claude_gap": -0.13,
  "gemini_gap": -0.277,
  "did": 0.147,
  "ci": [
   -0.03,
   0.342
  ]
 },
 "ge4_share": {
  "claude_gap": -0.019,
  "gemini_gap": -0.045,
  "did": 0.026,
  "ci": [
   -0.051,
   0.098
  ]
 },
 "major_share": {
  "claude_gap": -0.019,
  "gemini_gap": -0.055,
  "did": 0.036,
  "ci": [
   -0.042,
   0.109
  ]
 },
 "fidelity_matched": {
  "cells": 15,
  "n_claude": 54,
  "n_gemini": 167,
  "did": 0.16,
  "ci": [
   -0.02,
   0.345
  ]
 }
}
```

## Wave 1 → wave 2
```
{
 "note": "wave 1 = 2026-09-30, Opus text-only; wave 2 = this run, Opus WITH the page image (the instrument changed as well as the corpus). lang×arm uses each run's own arm shares; \"lite/flash only\" restricts wave 2 to the two arms wave 1 could see.",
 "wave1": {
  "n": 311,
  "ge4_lang_x_arm": {
   "est": 87.2,
   "ci": [
    82,
    92.1
   ],
   "n": 311
  },
  "major_lang_x_arm": {
   "est": 14.4,
   "ci": [
    9,
    20.1
   ],
   "n": 311
  },
  "ge4_lang": {
   "est": 89.1,
   "ci": [
    85.5,
    92.5
   ],
   "n": 311
  },
  "major_lang": {
   "est": 11.4,
   "ci": [
    7.7,
    15.6
   ],
   "n": 311
  }
 },
 "wave2": {
  "n": 365,
  "ge4_lang_x_arm": {
   "est": 86.3,
   "ci": [
    81.3,
    90.9
   ],
   "n": 365
  },
  "major_lang_x_arm": {
   "est": 13.6,
   "ci": [
    9,
    18.7
   ],
   "n": 365
  },
  "ge4_lang": {
   "est": 87.1,
   "ci": [
    82.7,
    91.1
   ],
   "n": 365
  },
  "major_lang": {
   "est": 12.8,
   "ci": [
    8.9,
    17.1
   ],
   "n": 365
  },
  "ge4_lite_flash_only": {
   "est": 85,
   "ci": [
    79.6,
    90.1
   ],
   "n": 263
  },
  "major_lite_flash_only": {
   "est": 14.8,
   "ci": [
    9.8,
    19.9
   ],
   "n": 263
  }
 },
 "delta": {
  "ge4_lang_x_arm": {
   "est": -0.9,
   "ci": [
    -7.8,
    6.1
   ]
  },
  "major_lang_x_arm": {
   "est": -0.8,
   "ci": [
    -8.5,
    6.4
   ]
  },
  "ge4_lang": {
   "est": -2,
   "ci": [
    -7.4,
    3.5
   ]
  },
  "major_lang": {
   "est": 1.4,
   "ci": [
    -4.3,
    7.1
   ]
  },
  "ge4_lite_flash_only": {
   "est": -2.2,
   "ci": [
    -8.9,
    5
   ]
  },
  "major_lite_flash_only": {
   "est": 0.4,
   "ci": [
    -7.3,
    8
   ]
  }
 }
}
```

## Oct-1 monthly draw
```
{
 "n": 103,
 "note": "Oct-1 draw (seed 20261001, monthly design: language quotas, lite/flash only), judged 2026-10-30 by Opus text-only (JUDGE-PROMPT.md verbatim)",
 "ge4_lang": {
  "est": 83.3,
  "ci": [
   74.4,
   91.5
  ],
  "n": 103
 },
 "major_lang": {
  "est": 14.8,
  "ci": [
   6.8,
   23.8
  ],
  "n": 103
 }
}
```

## Breakdowns — opus

### by language
| cell | n | mean | ≥4 | major |
|---|---:|---:|---:|---:|
| Latin | 58 | 4.19 | 84.5 | 15.5 |
| Greek | 35 | 4.4 | 88.6 | 8.6 |
| German | 35 | 4.63 | 94.3 | 5.7 |
| English | 35 | 4.54 | 91.4 | 8.6 |
| Arabic | 24 | 4.25 | 83.3 | 16.7 |
| Tibetan | 24 | 4.42 | 91.7 | 8.3 |
| French | 24 | 4.83 | 100 | 0 |
| Chinese | 24 | 4.08 | 75 | 25 |
| Sanskrit | 18 | 3.5 | 44.4 | 55.6 |
| Spanish | 18 | 4.61 | 94.4 | 5.6 |
| Italian | 17 | 4.18 | 88.2 | 17.6 |
| Dutch | 17 | 4.71 | 100 | 0 |
| Korean | 12 | 4.08 | 83.3 | 16.7 |
| Japanese | 12 | 2.25 | 25 | 66.7 |
| Hebrew | 12 | 3.67 | 66.7 | 33.3 |

### by script
| cell | n | mean | ≥4 | major |
|---|---:|---:|---:|---:|
| print | 184 | 4.27 | 83.2 | 16.3 |
| unknown | 108 | 4.39 | 88.9 | 11.1 |
| manuscript | 73 | 4.07 | 79.5 | 20.5 |

### by period
| cell | n | mean | ≥4 | major |
|---|---:|---:|---:|---:|
| 1700-1900 | 144 | 4.28 | 82.6 | 16.7 |
| 1500-1700 | 120 | 4.29 | 86.7 | 14.2 |
| 1900+ | 50 | 4.4 | 90 | 10 |
| pre-1500 | 31 | 3.97 | 71 | 25.8 |
| unknown | 20 | 4.15 | 85 | 15 |

### by arm
| cell | n | mean | ≥4 | major |
|---|---:|---:|---:|---:|
| lite | 146 | 4.14 | 79.5 | 20.5 |
| flash | 117 | 4.2 | 82.9 | 16.2 |
| opus | 54 | 4.65 | 92.6 | 7.4 |
| agy-flash | 42 | 4.38 | 92.9 | 7.1 |
| gemini-legacy | 6 | 4.33 | 83.3 | 16.7 |

### by engine_api
| cell | n | mean | ≥4 | major |
|---|---:|---:|---:|---:|
| (none recorded) | 226 | 4.15 | 81 | 19 |
| cli | 95 | 4.53 | 92.6 | 7.4 |
| batch | 39 | 4.21 | 79.5 | 17.9 |
| realtime | 5 | 4.8 | 100 | 0 |

### by prompt_version
| cell | n | mean | ≥4 | major |
|---|---:|---:|---:|---:|
| lite/v10 | 65 | 4.03 | 78.5 | 21.5 |
| agy-flash/13 | 42 | 4.38 | 92.9 | 7.1 |
| opus/13 | 42 | 4.88 | 100 | 0 |
| lite/13 | 40 | 4.28 | 80 | 17.5 |
| flash/v2 | 40 | 4.28 | 82.5 | 17.5 |
| lite/11 | 27 | 4.04 | 74.1 | 25.9 |
| flash/v10 | 23 | 4.3 | 87 | 13 |
| flash/13 | 16 | 4.19 | 87.5 | 12.5 |
| flash/11 | 13 | 3.31 | 53.8 | 38.5 |
| opus/1 | 11 | 3.73 | 63.6 | 36.4 |
| flash/v5.2026-02 | 10 | 4.7 | 100 | 0 |
| flash/v5.1.2026-03b | 9 | 4.56 | 100 | 0 |
| lite/v1 | 9 | 4.67 | 100 | 11.1 |
| gemini-legacy/(none) | 6 | 4.33 | 83.3 | 16.7 |
| flash/12 | 3 | 3 | 33.3 | 66.7 |
| flash/v1 | 2 | 4.5 | 100 | 0 |
| lite/2 | 2 | 4.5 | 100 | 0 |
| lite/1 | 2 | 4 | 50 | 50 |
| opus/v1 | 1 | 5 | 100 | 0 |
| flash/(none) | 1 | 5 | 100 | 0 |
| lite/12 | 1 | 4 | 100 | 0 |

### by language_script
| cell | n | mean | ≥4 | major |
|---|---:|---:|---:|---:|
| Latin/print | 39 | 4.1 | 82.1 | 17.9 |
| German/print | 26 | 4.5 | 92.3 | 7.7 |
| Greek/print | 20 | 4.4 | 95 | 5 |
| Chinese/manuscript | 19 | 4.16 | 78.9 | 21.1 |
| English/print | 19 | 4.68 | 89.5 | 10.5 |
| French/print | 18 | 4.83 | 100 | 0 |
| Latin/unknown | 17 | 4.29 | 88.2 | 11.8 |
| Arabic/manuscript | 16 | 4 | 75 | 25 |
| English/unknown | 15 | 4.4 | 93.3 | 6.7 |
| Tibetan/manuscript | 13 | 4.31 | 84.6 | 15.4 |
| Greek/unknown | 11 | 4.27 | 72.7 | 18.2 |
| Spanish/print | 11 | 4.82 | 100 | 0 |
| Tibetan/unknown | 11 | 4.55 | 100 | 0 |
| Dutch/unknown | 10 | 4.6 | 100 | 0 |
| Sanskrit/print | 9 | 3.22 | 33.3 | 66.7 |
| Italian/print | 9 | 4.33 | 88.9 | 11.1 |
| Sanskrit/unknown | 8 | 3.63 | 50 | 50 |
| German/unknown | 8 | 5 | 100 | 0 |
| Japanese/print | 8 | 2.5 | 25 | 62.5 |
| Hebrew/unknown | 7 | 4.14 | 85.7 | 14.3 |
| Italian/unknown | 7 | 4 | 85.7 | 28.6 |
| Dutch/print | 7 | 4.86 | 100 | 0 |
| Korean/manuscript | 6 | 4 | 83.3 | 16.7 |
| Korean/print | 6 | 4.17 | 83.3 | 16.7 |
| Arabic/print | 5 | 4.6 | 100 | 0 |
| Spanish/unknown | 5 | 4.6 | 100 | 0 |
| French/unknown | 5 | 4.8 | 100 | 0 |
| Greek/manuscript | 4 | 4.75 | 100 | 0 |
| Japanese/manuscript | 4 | 1.75 | 25 | 75 |
| Chinese/print | 4 | 3.75 | 50 | 50 |
| Hebrew/print | 3 | 2.33 | 0 | 100 |
| Arabic/unknown | 3 | 5 | 100 | 0 |
| Spanish/manuscript | 2 | 3.5 | 50 | 50 |
| Hebrew/manuscript | 2 | 4 | 100 | 0 |
| Latin/manuscript | 2 | 5 | 100 | 0 |
| Sanskrit/manuscript | 1 | 5 | 100 | 0 |
| French/manuscript | 1 | 5 | 100 | 0 |
| Italian/manuscript | 1 | 4 | 100 | 0 |
| Chinese/unknown | 1 | 4 | 100 | 0 |
| German/manuscript | 1 | 5 | 100 | 0 |
| English/manuscript | 1 | 4 | 100 | 0 |

### arms within language|script|period cells (cells < 10 books are exploratory)
| cell | arm | n | mean | ≥4 | major |
|---|---|---:|---:|---:|---:|
| Greek|print|1500-1700 | agy-flash | 1 | 5 | 100 | 0 |
| Greek|print|1500-1700 | flash | 1 | 4 | 100 | 0 |
| Greek|print|1500-1700 | lite | 2 | 4 | 100 | 0 |
| Greek|print|1700-1900 | agy-flash | 1 | 5 | 100 | 0 |
| Greek|print|1700-1900 | opus | 4 | 4.75 | 100 | 0 |
| Greek|print|1700-1900 | flash | 2 | 4.5 | 100 | 0 |
| Greek|print|1700-1900 | lite | 3 | 3.67 | 66.7 | 33.3 |
| Greek|print|1900+ | agy-flash | 2 | 4 | 100 | 0 |
| Greek|print|1900+ | opus | 1 | 5 | 100 | 0 |
| Greek|print|1900+ | flash | 1 | 5 | 100 | 0 |
| Greek|print|1900+ | lite | 2 | 4.5 | 100 | 0 |
| Greek|unknown|1500-1700 | agy-flash | 1 | 5 | 100 | 0 |
| Greek|unknown|1500-1700 | flash | 1 | 5 | 100 | 0 |
| Greek|unknown|1500-1700 | lite | 2 | 3.5 | 50 | 50 |
| Greek|unknown|1900+ | agy-flash | 1 | 4 | 100 | 0 |
| Greek|unknown|1900+ | flash | 1 | 5 | 100 | 0 |
| Greek|unknown|1900+ | lite | 1 | 5 | 100 | 0 |
| Arabic|manuscript|1700-1900 | agy-flash | 3 | 3 | 33.3 | 66.7 |
| Arabic|manuscript|1700-1900 | opus | 1 | 5 | 100 | 0 |
| Arabic|manuscript|1700-1900 | flash | 2 | 4 | 100 | 0 |
| Arabic|manuscript|1700-1900 | lite | 2 | 4 | 50 | 50 |
| Arabic|manuscript|pre-1500 | agy-flash | 1 | 4 | 100 | 0 |
| Arabic|manuscript|pre-1500 | flash | 1 | 4 | 100 | 0 |
| Arabic|manuscript|pre-1500 | lite | 1 | 3 | 0 | 100 |
| Arabic|print|1700-1900 | agy-flash | 2 | 4.5 | 100 | 0 |
| Arabic|print|1700-1900 | flash | 1 | 5 | 100 | 0 |
| Arabic|print|1700-1900 | lite | 1 | 4 | 100 | 0 |
| Tibetan|manuscript|1700-1900 | lite | 6 | 4 | 66.7 | 33.3 |
| Tibetan|manuscript|1700-1900 | opus | 3 | 4.67 | 100 | 0 |
| Tibetan|manuscript|1700-1900 | flash | 4 | 4.5 | 100 | 0 |
| Korean|manuscript|1500-1700 | lite | 1 | 4 | 100 | 0 |
| Korean|manuscript|1500-1700 | flash | 1 | 4 | 100 | 0 |
| Korean|manuscript|1700-1900 | lite | 1 | 4 | 100 | 0 |
| Korean|manuscript|1700-1900 | flash | 2 | 3.5 | 50 | 50 |
| French|print|1500-1700 | opus | 1 | 5 | 100 | 0 |
| French|print|1500-1700 | agy-flash | 1 | 4 | 100 | 0 |
| French|print|1500-1700 | flash | 1 | 5 | 100 | 0 |
| French|print|1500-1700 | lite | 1 | 5 | 100 | 0 |
| French|print|1700-1900 | opus | 5 | 5 | 100 | 0 |
| French|print|1700-1900 | agy-flash | 4 | 4.75 | 100 | 0 |
| French|print|1700-1900 | flash | 1 | 5 | 100 | 0 |
| French|print|1700-1900 | lite | 3 | 4.67 | 100 | 0 |
| Sanskrit|print|1700-1900 | opus | 2 | 3 | 50 | 50 |
| Sanskrit|print|1700-1900 | lite | 2 | 3 | 0 | 100 |
| Sanskrit|print|1900+ | opus | 2 | 4 | 50 | 50 |
| Sanskrit|print|1900+ | lite | 2 | 3.5 | 50 | 50 |
| Sanskrit|print|1900+ | flash | 1 | 2 | 0 | 100 |
| Sanskrit|unknown|1700-1900 | opus | 1 | 2 | 0 | 100 |
| Sanskrit|unknown|1700-1900 | lite | 1 | 3 | 0 | 100 |
| Sanskrit|unknown|1700-1900 | flash | 2 | 4 | 50 | 50 |
| Sanskrit|unknown|pre-1500 | opus | 1 | 5 | 100 | 0 |
| Sanskrit|unknown|pre-1500 | flash | 1 | 4 | 100 | 0 |
| Spanish|print|1700-1900 | opus | 4 | 5 | 100 | 0 |
| Spanish|print|1700-1900 | flash | 1 | 5 | 100 | 0 |
| Spanish|print|1700-1900 | lite | 2 | 5 | 100 | 0 |
| Latin|print|1500-1700 | gemini-legacy | 1 | 5 | 100 | 0 |
| Latin|print|1500-1700 | opus | 2 | 4 | 50 | 50 |
| Latin|print|1500-1700 | agy-flash | 4 | 4.25 | 75 | 25 |
| Latin|print|1500-1700 | flash | 4 | 3.25 | 75 | 25 |
| Latin|print|1500-1700 | lite | 15 | 4.27 | 86.7 | 13.3 |
| Latin|unknown|1500-1700 | gemini-legacy | 5 | 4.2 | 80 | 20 |
| Latin|unknown|1500-1700 | opus | 3 | 4.67 | 100 | 0 |
| Latin|unknown|1500-1700 | flash | 4 | 4.5 | 100 | 0 |
| Latin|unknown|1500-1700 | lite | 1 | 4 | 100 | 0 |
| Greek|manuscript|pre-1500 | opus | 1 | 5 | 100 | 0 |
| Greek|manuscript|pre-1500 | lite | 2 | 4.5 | 100 | 0 |
| German|print|1500-1700 | agy-flash | 1 | 5 | 100 | 0 |
| German|print|1500-1700 | flash | 4 | 3.75 | 75 | 25 |
| German|print|1500-1700 | lite | 4 | 4 | 75 | 25 |
| German|print|1700-1900 | agy-flash | 2 | 5 | 100 | 0 |
| German|print|1700-1900 | opus | 3 | 5 | 100 | 0 |
| German|print|1700-1900 | flash | 5 | 4.4 | 100 | 0 |
| German|print|1700-1900 | lite | 2 | 5 | 100 | 0 |
| German|print|1900+ | agy-flash | 2 | 4.5 | 100 | 0 |
| German|print|1900+ | opus | 2 | 5 | 100 | 0 |
| German|print|1900+ | lite | 1 | 5 | 100 | 0 |
| German|unknown|1700-1900 | agy-flash | 1 | 5 | 100 | 0 |
| German|unknown|1700-1900 | flash | 3 | 5 | 100 | 0 |
| German|unknown|1700-1900 | lite | 1 | 5 | 100 | 0 |
| Spanish|print|1500-1700 | flash | 1 | 4 | 100 | 0 |
| Spanish|print|1500-1700 | lite | 2 | 4.5 | 100 | 0 |
| Spanish|unknown|1500-1700 | flash | 3 | 4.33 | 100 | 0 |
| Spanish|unknown|1500-1700 | lite | 1 | 5 | 100 | 0 |
| Latin|unknown|pre-1500 | opus | 1 | 4 | 100 | 0 |
| Latin|unknown|pre-1500 | flash | 1 | 3 | 0 | 100 |
| German|unknown|1500-1700 | opus | 1 | 5 | 100 | 0 |
| German|unknown|1500-1700 | flash | 2 | 5 | 100 | 0 |
| Tibetan|unknown|1700-1900 | opus | 3 | 5 | 100 | 0 |
| Tibetan|unknown|1700-1900 | flash | 2 | 4.5 | 100 | 0 |
| Latin|print|1700-1900 | agy-flash | 1 | 5 | 100 | 0 |
| Latin|print|1700-1900 | flash | 1 | 4 | 100 | 0 |
| Latin|print|1700-1900 | lite | 3 | 4.33 | 100 | 0 |
| Latin|print|pre-1500 | agy-flash | 1 | 4 | 100 | 0 |
| Latin|print|pre-1500 | lite | 3 | 4 | 66.7 | 33.3 |
| Japanese|manuscript|1700-1900 | flash | 1 | 1 | 0 | 100 |
| Japanese|manuscript|1700-1900 | lite | 2 | 1 | 0 | 100 |
| Japanese|print|1700-1900 | flash | 2 | 2.5 | 0 | 50 |
| Japanese|print|1700-1900 | lite | 2 | 3.5 | 50 | 50 |
| Japanese|print|pre-1500 | flash | 1 | 2 | 0 | 100 |
| Japanese|print|pre-1500 | lite | 1 | 1 | 0 | 100 |
| Hebrew|print|1500-1700 | flash | 1 | 3 | 0 | 100 |
| Hebrew|print|1500-1700 | lite | 1 | 2 | 0 | 100 |
| Hebrew|unknown|1500-1700 | flash | 1 | 5 | 100 | 0 |
| Hebrew|unknown|1500-1700 | lite | 2 | 4 | 100 | 0 |
| Hebrew|unknown|1700-1900 | flash | 1 | 4 | 100 | 0 |
| Hebrew|unknown|1700-1900 | lite | 1 | 5 | 100 | 0 |
| Hebrew|unknown|pre-1500 | flash | 1 | 4 | 100 | 0 |
| Hebrew|unknown|pre-1500 | lite | 1 | 3 | 0 | 100 |
| Italian|print|1500-1700 | flash | 1 | 4 | 100 | 0 |
| Italian|print|1500-1700 | lite | 6 | 4.17 | 83.3 | 16.7 |
| Italian|unknown|1500-1700 | flash | 2 | 4.5 | 100 | 0 |
| Italian|unknown|1500-1700 | lite | 1 | 4 | 100 | 100 |
| Italian|unknown|pre-1500 | flash | 1 | 5 | 100 | 0 |
| Italian|unknown|pre-1500 | lite | 1 | 4 | 100 | 0 |
| Arabic|unknown|1700-1900 | flash | 1 | 5 | 100 | 0 |
| Arabic|unknown|1700-1900 | lite | 1 | 5 | 100 | 0 |
| Dutch|print|1500-1700 | flash | 3 | 4.67 | 100 | 0 |
| Dutch|print|1500-1700 | lite | 2 | 5 | 100 | 0 |
| Dutch|unknown|1500-1700 | flash | 4 | 4.75 | 100 | 0 |
| Dutch|unknown|1500-1700 | lite | 2 | 5 | 100 | 0 |
| Dutch|unknown|1700-1900 | flash | 2 | 4.5 | 100 | 0 |
| Dutch|unknown|1700-1900 | lite | 2 | 4 | 100 | 0 |
| Chinese|manuscript|1700-1900 | opus | 1 | 5 | 100 | 0 |
| Chinese|manuscript|1700-1900 | lite | 1 | 3 | 0 | 100 |
| Chinese|manuscript|unknown | opus | 5 | 4.8 | 100 | 0 |
| Chinese|manuscript|unknown | agy-flash | 4 | 4 | 100 | 0 |
| Chinese|manuscript|unknown | flash | 4 | 3.5 | 50 | 50 |
| French|unknown|1500-1700 | flash | 1 | 5 | 100 | 0 |
| French|unknown|1500-1700 | lite | 1 | 5 | 100 | 0 |
| Chinese|manuscript|1500-1700 | lite | 1 | 4 | 100 | 0 |
| Chinese|manuscript|1500-1700 | agy-flash | 2 | 5 | 100 | 0 |
| Chinese|manuscript|1500-1700 | flash | 1 | 3 | 0 | 100 |
| Greek|unknown|pre-1500 | flash | 1 | 5 | 100 | 0 |
| Greek|unknown|pre-1500 | lite | 2 | 4 | 50 | 0 |
| English|print|1700-1900 | flash | 3 | 4.33 | 66.7 | 33.3 |
| English|print|1700-1900 | lite | 8 | 4.75 | 100 | 0 |
| English|print|1900+ | flash | 1 | 5 | 100 | 0 |
| English|print|1900+ | lite | 6 | 4.67 | 83.3 | 16.7 |
| English|unknown|1500-1700 | flash | 2 | 4.5 | 100 | 0 |
| English|unknown|1500-1700 | lite | 1 | 5 | 100 | 0 |
| English|unknown|1700-1900 | flash | 4 | 4.5 | 100 | 0 |
| English|unknown|1700-1900 | lite | 2 | 4 | 100 | 0 |
| English|unknown|1900+ | flash | 3 | 4.67 | 100 | 0 |
| English|unknown|1900+ | lite | 2 | 4.5 | 100 | 0 |
| Latin|unknown|1700-1900 | flash | 1 | 5 | 100 | 0 |
| Latin|unknown|1700-1900 | lite | 1 | 4 | 100 | 0 |

## Breakdowns — gemini-flash-low

### by language
| cell | n | mean | ≥4 | major |
|---|---:|---:|---:|---:|
| Latin | 58 | 4.57 | 91.4 | 6.9 |
| Greek | 35 | 4.49 | 88.6 | 11.4 |
| German | 35 | 4.71 | 94.3 | 5.7 |
| English | 35 | 4.74 | 97.1 | 2.9 |
| Arabic | 24 | 4.63 | 95.8 | 4.2 |
| Tibetan | 24 | 4.63 | 87.5 | 12.5 |
| French | 24 | 4.96 | 100 | 0 |
| Chinese | 24 | 4.5 | 83.3 | 16.7 |
| Sanskrit | 18 | 4.06 | 66.7 | 27.8 |
| Spanish | 18 | 4.56 | 88.9 | 11.1 |
| Italian | 17 | 4.47 | 88.2 | 11.8 |
| Dutch | 17 | 4.94 | 100 | 0 |
| Korean | 12 | 4.42 | 83.3 | 8.3 |
| Japanese | 12 | 2.67 | 33.3 | 58.3 |
| Hebrew | 12 | 4 | 75 | 25 |

### by script
| cell | n | mean | ≥4 | major |
|---|---:|---:|---:|---:|
| print | 184 | 4.5 | 87.5 | 10.9 |
| unknown | 108 | 4.69 | 93.5 | 5.6 |
| manuscript | 73 | 4.32 | 82.2 | 17.8 |

### by period
| cell | n | mean | ≥4 | major |
|---|---:|---:|---:|---:|
| 1700-1900 | 144 | 4.44 | 84 | 14.6 |
| 1500-1700 | 120 | 4.54 | 90 | 9.2 |
| 1900+ | 50 | 4.74 | 94 | 6 |
| pre-1500 | 31 | 4.29 | 83.9 | 12.9 |
| unknown | 20 | 4.8 | 100 | 0 |

### by arm
| cell | n | mean | ≥4 | major |
|---|---:|---:|---:|---:|
| lite | 146 | 4.31 | 82.2 | 15.8 |
| flash | 117 | 4.57 | 89.7 | 9.4 |
| opus | 54 | 4.78 | 94.4 | 5.6 |
| agy-flash | 42 | 4.81 | 97.6 | 2.4 |
| gemini-legacy | 6 | 4.33 | 83.3 | 16.7 |

### by engine_api
| cell | n | mean | ≥4 | major |
|---|---:|---:|---:|---:|
| (none recorded) | 226 | 4.42 | 84.5 | 13.7 |
| cli | 95 | 4.79 | 95.8 | 4.2 |
| batch | 39 | 4.54 | 92.3 | 7.7 |
| realtime | 5 | 4 | 80 | 20 |

### by prompt_version
| cell | n | mean | ≥4 | major |
|---|---:|---:|---:|---:|
| lite/v10 | 65 | 4.14 | 76.9 | 20 |
| agy-flash/13 | 42 | 4.81 | 97.6 | 2.4 |
| opus/13 | 42 | 4.88 | 97.6 | 2.4 |
| lite/13 | 40 | 4.47 | 90 | 10 |
| flash/v2 | 40 | 4.72 | 92.5 | 7.5 |
| lite/11 | 27 | 4.22 | 74.1 | 22.2 |
| flash/v10 | 23 | 4.43 | 87 | 13 |
| flash/13 | 16 | 4.63 | 93.8 | 6.3 |
| flash/11 | 13 | 4 | 76.9 | 23.1 |
| opus/1 | 11 | 4.36 | 81.8 | 18.2 |
| flash/v5.2026-02 | 10 | 5 | 100 | 0 |
| flash/v5.1.2026-03b | 9 | 4.89 | 100 | 0 |
| lite/v1 | 9 | 4.89 | 100 | 0 |
| gemini-legacy/(none) | 6 | 4.33 | 83.3 | 16.7 |
| flash/12 | 3 | 3 | 33.3 | 33.3 |
| flash/v1 | 2 | 5 | 100 | 0 |
| lite/2 | 2 | 4.5 | 100 | 0 |
| lite/1 | 2 | 4.5 | 100 | 0 |
| opus/v1 | 1 | 5 | 100 | 0 |
| flash/(none) | 1 | 5 | 100 | 0 |
| lite/12 | 1 | 5 | 100 | 0 |

### by language_script
| cell | n | mean | ≥4 | major |
|---|---:|---:|---:|---:|
| Latin/print | 39 | 4.54 | 92.3 | 7.7 |
| German/print | 26 | 4.62 | 92.3 | 7.7 |
| Greek/print | 20 | 4.65 | 95 | 5 |
| Chinese/manuscript | 19 | 4.63 | 89.5 | 10.5 |
| English/print | 19 | 4.74 | 94.7 | 5.3 |
| French/print | 18 | 4.94 | 100 | 0 |
| Latin/unknown | 17 | 4.59 | 88.2 | 5.9 |
| Arabic/manuscript | 16 | 4.56 | 93.8 | 6.3 |
| English/unknown | 15 | 4.73 | 100 | 0 |
| Tibetan/manuscript | 13 | 4.31 | 76.9 | 23.1 |
| Greek/unknown | 11 | 4.64 | 90.9 | 9.1 |
| Spanish/print | 11 | 4.64 | 90.9 | 9.1 |
| Tibetan/unknown | 11 | 5 | 100 | 0 |
| Dutch/unknown | 10 | 4.9 | 100 | 0 |
| Sanskrit/print | 9 | 3.78 | 55.6 | 33.3 |
| Italian/print | 9 | 4.67 | 88.9 | 11.1 |
| Sanskrit/unknown | 8 | 4.25 | 75 | 25 |
| German/unknown | 8 | 5 | 100 | 0 |
| Japanese/print | 8 | 3 | 37.5 | 50 |
| Hebrew/unknown | 7 | 4.43 | 85.7 | 14.3 |
| Italian/unknown | 7 | 4.29 | 85.7 | 14.3 |
| Dutch/print | 7 | 5 | 100 | 0 |
| Korean/manuscript | 6 | 4.5 | 83.3 | 16.7 |
| Korean/print | 6 | 4.33 | 83.3 | 0 |
| Arabic/print | 5 | 4.6 | 100 | 0 |
| Spanish/unknown | 5 | 4.8 | 100 | 0 |
| French/unknown | 5 | 5 | 100 | 0 |
| Greek/manuscript | 4 | 3.25 | 50 | 50 |
| Japanese/manuscript | 4 | 2 | 25 | 75 |
| Chinese/print | 4 | 4 | 50 | 50 |
| Hebrew/print | 3 | 2.67 | 33.3 | 66.7 |
| Arabic/unknown | 3 | 5 | 100 | 0 |
| Spanish/manuscript | 2 | 3.5 | 50 | 50 |
| Hebrew/manuscript | 2 | 4.5 | 100 | 0 |
| Latin/manuscript | 2 | 5 | 100 | 0 |
| Sanskrit/manuscript | 1 | 5 | 100 | 0 |
| French/manuscript | 1 | 5 | 100 | 0 |
| Italian/manuscript | 1 | 4 | 100 | 0 |
| Chinese/unknown | 1 | 4 | 100 | 0 |
| German/manuscript | 1 | 5 | 100 | 0 |
| English/manuscript | 1 | 5 | 100 | 0 |

### arms within language|script|period cells (cells < 10 books are exploratory)
| cell | arm | n | mean | ≥4 | major |
|---|---|---:|---:|---:|---:|
| Greek|print|1500-1700 | agy-flash | 1 | 5 | 100 | 0 |
| Greek|print|1500-1700 | flash | 1 | 5 | 100 | 0 |
| Greek|print|1500-1700 | lite | 2 | 4 | 100 | 0 |
| Greek|print|1700-1900 | agy-flash | 1 | 5 | 100 | 0 |
| Greek|print|1700-1900 | opus | 4 | 4.75 | 100 | 0 |
| Greek|print|1700-1900 | flash | 2 | 5 | 100 | 0 |
| Greek|print|1700-1900 | lite | 3 | 3.67 | 66.7 | 33.3 |
| Greek|print|1900+ | agy-flash | 2 | 5 | 100 | 0 |
| Greek|print|1900+ | opus | 1 | 5 | 100 | 0 |
| Greek|print|1900+ | flash | 1 | 5 | 100 | 0 |
| Greek|print|1900+ | lite | 2 | 5 | 100 | 0 |
| Greek|unknown|1500-1700 | agy-flash | 1 | 5 | 100 | 0 |
| Greek|unknown|1500-1700 | flash | 1 | 5 | 100 | 0 |
| Greek|unknown|1500-1700 | lite | 2 | 4.5 | 100 | 0 |
| Greek|unknown|1900+ | agy-flash | 1 | 5 | 100 | 0 |
| Greek|unknown|1900+ | flash | 1 | 5 | 100 | 0 |
| Greek|unknown|1900+ | lite | 1 | 5 | 100 | 0 |
| Arabic|manuscript|1700-1900 | agy-flash | 3 | 3.67 | 66.7 | 33.3 |
| Arabic|manuscript|1700-1900 | opus | 1 | 5 | 100 | 0 |
| Arabic|manuscript|1700-1900 | flash | 2 | 4.5 | 100 | 0 |
| Arabic|manuscript|1700-1900 | lite | 2 | 4.5 | 100 | 0 |
| Arabic|manuscript|pre-1500 | agy-flash | 1 | 5 | 100 | 0 |
| Arabic|manuscript|pre-1500 | flash | 1 | 5 | 100 | 0 |
| Arabic|manuscript|pre-1500 | lite | 1 | 4 | 100 | 0 |
| Arabic|print|1700-1900 | agy-flash | 2 | 4.5 | 100 | 0 |
| Arabic|print|1700-1900 | flash | 1 | 5 | 100 | 0 |
| Arabic|print|1700-1900 | lite | 1 | 4 | 100 | 0 |
| Tibetan|manuscript|1700-1900 | lite | 6 | 4 | 66.7 | 33.3 |
| Tibetan|manuscript|1700-1900 | opus | 3 | 5 | 100 | 0 |
| Tibetan|manuscript|1700-1900 | flash | 4 | 4.25 | 75 | 25 |
| Korean|manuscript|1500-1700 | lite | 1 | 5 | 100 | 0 |
| Korean|manuscript|1500-1700 | flash | 1 | 5 | 100 | 0 |
| Korean|manuscript|1700-1900 | lite | 1 | 5 | 100 | 0 |
| Korean|manuscript|1700-1900 | flash | 2 | 4 | 50 | 50 |
| French|print|1500-1700 | opus | 1 | 5 | 100 | 0 |
| French|print|1500-1700 | agy-flash | 1 | 5 | 100 | 0 |
| French|print|1500-1700 | flash | 1 | 5 | 100 | 0 |
| French|print|1500-1700 | lite | 1 | 5 | 100 | 0 |
| French|print|1700-1900 | opus | 5 | 5 | 100 | 0 |
| French|print|1700-1900 | agy-flash | 4 | 4.75 | 100 | 0 |
| French|print|1700-1900 | flash | 1 | 5 | 100 | 0 |
| French|print|1700-1900 | lite | 3 | 5 | 100 | 0 |
| Sanskrit|print|1700-1900 | opus | 2 | 4 | 50 | 50 |
| Sanskrit|print|1700-1900 | lite | 2 | 3.5 | 50 | 0 |
| Sanskrit|print|1900+ | opus | 2 | 4.5 | 100 | 0 |
| Sanskrit|print|1900+ | lite | 2 | 4 | 50 | 50 |
| Sanskrit|print|1900+ | flash | 1 | 2 | 0 | 100 |
| Sanskrit|unknown|1700-1900 | opus | 1 | 2 | 0 | 100 |
| Sanskrit|unknown|1700-1900 | lite | 1 | 4 | 100 | 0 |
| Sanskrit|unknown|1700-1900 | flash | 2 | 4 | 50 | 50 |
| Sanskrit|unknown|pre-1500 | opus | 1 | 5 | 100 | 0 |
| Sanskrit|unknown|pre-1500 | flash | 1 | 5 | 100 | 0 |
| Spanish|print|1700-1900 | opus | 4 | 5 | 100 | 0 |
| Spanish|print|1700-1900 | flash | 1 | 5 | 100 | 0 |
| Spanish|print|1700-1900 | lite | 2 | 4.5 | 100 | 0 |
| Latin|print|1500-1700 | gemini-legacy | 1 | 5 | 100 | 0 |
| Latin|print|1500-1700 | opus | 2 | 4.5 | 100 | 0 |
| Latin|print|1500-1700 | agy-flash | 4 | 4.75 | 100 | 0 |
| Latin|print|1500-1700 | flash | 4 | 4 | 75 | 25 |
| Latin|print|1500-1700 | lite | 15 | 4.67 | 100 | 0 |
| Latin|unknown|1500-1700 | gemini-legacy | 5 | 4.2 | 80 | 20 |
| Latin|unknown|1500-1700 | opus | 3 | 5 | 100 | 0 |
| Latin|unknown|1500-1700 | flash | 4 | 5 | 100 | 0 |
| Latin|unknown|1500-1700 | lite | 1 | 4 | 100 | 0 |
| Greek|manuscript|pre-1500 | opus | 1 | 5 | 100 | 0 |
| Greek|manuscript|pre-1500 | lite | 2 | 3 | 50 | 50 |
| German|print|1500-1700 | agy-flash | 1 | 5 | 100 | 0 |
| German|print|1500-1700 | flash | 4 | 3.75 | 75 | 25 |
| German|print|1500-1700 | lite | 4 | 4.25 | 75 | 25 |
| German|print|1700-1900 | agy-flash | 2 | 5 | 100 | 0 |
| German|print|1700-1900 | opus | 3 | 5 | 100 | 0 |
| German|print|1700-1900 | flash | 5 | 4.8 | 100 | 0 |
| German|print|1700-1900 | lite | 2 | 5 | 100 | 0 |
| German|print|1900+ | agy-flash | 2 | 4.5 | 100 | 0 |
| German|print|1900+ | opus | 2 | 5 | 100 | 0 |
| German|print|1900+ | lite | 1 | 5 | 100 | 0 |
| German|unknown|1700-1900 | agy-flash | 1 | 5 | 100 | 0 |
| German|unknown|1700-1900 | flash | 3 | 5 | 100 | 0 |
| German|unknown|1700-1900 | lite | 1 | 5 | 100 | 0 |
| Spanish|print|1500-1700 | flash | 1 | 4 | 100 | 0 |
| Spanish|print|1500-1700 | lite | 2 | 4 | 50 | 50 |
| Spanish|unknown|1500-1700 | flash | 3 | 5 | 100 | 0 |
| Spanish|unknown|1500-1700 | lite | 1 | 4 | 100 | 0 |
| Latin|unknown|pre-1500 | opus | 1 | 5 | 100 | 0 |
| Latin|unknown|pre-1500 | flash | 1 | 5 | 100 | 0 |
| German|unknown|1500-1700 | opus | 1 | 5 | 100 | 0 |
| German|unknown|1500-1700 | flash | 2 | 5 | 100 | 0 |
| Tibetan|unknown|1700-1900 | opus | 3 | 5 | 100 | 0 |
| Tibetan|unknown|1700-1900 | flash | 2 | 5 | 100 | 0 |
| Latin|print|1700-1900 | agy-flash | 1 | 5 | 100 | 0 |
| Latin|print|1700-1900 | flash | 1 | 3 | 0 | 100 |
| Latin|print|1700-1900 | lite | 3 | 4.67 | 100 | 0 |
| Latin|print|pre-1500 | agy-flash | 1 | 5 | 100 | 0 |
| Latin|print|pre-1500 | lite | 3 | 4.33 | 66.7 | 33.3 |
| Japanese|manuscript|1700-1900 | flash | 1 | 1 | 0 | 100 |
| Japanese|manuscript|1700-1900 | lite | 2 | 1 | 0 | 100 |
| Japanese|print|1700-1900 | flash | 2 | 4.5 | 100 | 0 |
| Japanese|print|1700-1900 | lite | 2 | 3 | 0 | 100 |
| Japanese|print|pre-1500 | flash | 1 | 3 | 0 | 0 |
| Japanese|print|pre-1500 | lite | 1 | 1 | 0 | 100 |
| Hebrew|print|1500-1700 | flash | 1 | 4 | 100 | 0 |
| Hebrew|print|1500-1700 | lite | 1 | 3 | 0 | 100 |
| Hebrew|unknown|1500-1700 | flash | 1 | 5 | 100 | 0 |
| Hebrew|unknown|1500-1700 | lite | 2 | 3.5 | 50 | 50 |
| Hebrew|unknown|1700-1900 | flash | 1 | 5 | 100 | 0 |
| Hebrew|unknown|1700-1900 | lite | 1 | 5 | 100 | 0 |
| Hebrew|unknown|pre-1500 | flash | 1 | 4 | 100 | 0 |
| Hebrew|unknown|pre-1500 | lite | 1 | 5 | 100 | 0 |
| Italian|print|1500-1700 | flash | 1 | 5 | 100 | 0 |
| Italian|print|1500-1700 | lite | 6 | 4.5 | 83.3 | 16.7 |
| Italian|unknown|1500-1700 | flash | 2 | 5 | 100 | 0 |
| Italian|unknown|1500-1700 | lite | 1 | 4 | 100 | 0 |
| Italian|unknown|pre-1500 | flash | 1 | 5 | 100 | 0 |
| Italian|unknown|pre-1500 | lite | 1 | 4 | 100 | 0 |
| Arabic|unknown|1700-1900 | flash | 1 | 5 | 100 | 0 |
| Arabic|unknown|1700-1900 | lite | 1 | 5 | 100 | 0 |
| Dutch|print|1500-1700 | flash | 3 | 5 | 100 | 0 |
| Dutch|print|1500-1700 | lite | 2 | 5 | 100 | 0 |
| Dutch|unknown|1500-1700 | flash | 4 | 5 | 100 | 0 |
| Dutch|unknown|1500-1700 | lite | 2 | 5 | 100 | 0 |
| Dutch|unknown|1700-1900 | flash | 2 | 5 | 100 | 0 |
| Dutch|unknown|1700-1900 | lite | 2 | 4.5 | 100 | 0 |
| Chinese|manuscript|1700-1900 | opus | 1 | 2 | 0 | 100 |
| Chinese|manuscript|1700-1900 | lite | 1 | 3 | 0 | 100 |
| Chinese|manuscript|unknown | opus | 5 | 5 | 100 | 0 |
| Chinese|manuscript|unknown | agy-flash | 4 | 5 | 100 | 0 |
| Chinese|manuscript|unknown | flash | 4 | 4.75 | 100 | 0 |
| French|unknown|1500-1700 | flash | 1 | 5 | 100 | 0 |
| French|unknown|1500-1700 | lite | 1 | 5 | 100 | 0 |
| Chinese|manuscript|1500-1700 | lite | 1 | 5 | 100 | 0 |
| Chinese|manuscript|1500-1700 | agy-flash | 2 | 5 | 100 | 0 |
| Chinese|manuscript|1500-1700 | flash | 1 | 4 | 100 | 0 |
| Greek|unknown|pre-1500 | flash | 1 | 5 | 100 | 0 |
| Greek|unknown|pre-1500 | lite | 2 | 4.5 | 100 | 0 |
| English|print|1700-1900 | flash | 3 | 4 | 66.7 | 33.3 |
| English|print|1700-1900 | lite | 8 | 4.88 | 100 | 0 |
| English|print|1900+ | flash | 1 | 5 | 100 | 0 |
| English|print|1900+ | lite | 6 | 4.83 | 100 | 0 |
| English|unknown|1500-1700 | flash | 2 | 5 | 100 | 0 |
| English|unknown|1500-1700 | lite | 1 | 4 | 100 | 0 |
| English|unknown|1700-1900 | flash | 4 | 5 | 100 | 0 |
| English|unknown|1700-1900 | lite | 2 | 4 | 100 | 0 |
| English|unknown|1900+ | flash | 3 | 5 | 100 | 0 |
| English|unknown|1900+ | lite | 2 | 5 | 100 | 0 |
| Latin|unknown|1700-1900 | flash | 1 | 5 | 100 | 0 |
| Latin|unknown|1700-1900 | lite | 1 | 3 | 0 | 0 |

## 20 most disputed books
| id | language | arm | opus | gemini-flash-low | url |
|---|---|---|---:|---:|---|
| 53eba5b610 | Greek | lite | 4 | 1 | https://sourcelibrary.org/book/69938985ce1538706594752c?page=233 |
| a1be80bcb2 | Tibetan | lite | 5 | 2 | https://sourcelibrary.org/book/69e7abec5f1a22ab19aa0707?page=712 |
| cf92626d76 | Chinese | opus | 5 | 2 | https://sourcelibrary.org/book/6a3ceaf795fcd45563052360?page=25 |
| 5357b9fcbd | Greek | lite | 5 | 2 | https://sourcelibrary.org/book/699388ea1075be7d320551a0?page=101 |
| fb4d166c33 | Japanese | flash | 2 | 4 | https://sourcelibrary.org/book/6a0aca8b676a42ccd9775261?page=19 |
| e86406e2a9 | Hebrew | lite | 4 | 2 | https://sourcelibrary.org/book/69c1bb2e8522835be845d575?page=46 |
| 0d9b5a6e26 | Tibetan | flash | 4 | 2 | https://sourcelibrary.org/book/69e7613ccc48e59ad74ee65d?page=144 |
| 4ab28b7b9c | Tibetan | lite | 3 | 5 | https://sourcelibrary.org/book/69e78a8a4a6785cfd60d3a96?page=2657 |
| 7b0cd73b41 | Japanese | flash | 3 | 5 | https://sourcelibrary.org/book/6a08e2ce50bd891addfb51e6?page=23 |
| 6ccbdcc374 | Hebrew | lite | 3 | 5 | https://sourcelibrary.org/book/69c1ba908522835be845944d?page=230 |
| bfef3a4a94 | Sanskrit | flash | 3 | 5 | https://sourcelibrary.org/book/69906d1964d44bd0a0ef5210?page=8 |
| 75a963a5f2 | Greek | lite | 3 | 5 | https://sourcelibrary.org/book/69938a93d5a98fd66f42d3fa?page=113 |
| de3204af00 | Chinese | flash | 3 | 5 | https://sourcelibrary.org/book/6a3c5ebb40c88a541d8e5477?page=73 |
| cfdd57497d | Latin | flash | 3 | 5 | https://sourcelibrary.org/book/59e68f94-49d0-4ed7-a610-b1f53e55b2f8?page=369 |
| 785ecdc0f1 | Hebrew | flash | 2 | 1 | https://sourcelibrary.org/book/6a357f1ac6e2d5bb56a64539?page=204 |
| 974ae0ae78 | Italian | flash | 1 | 2 | https://sourcelibrary.org/book/6991eadd2f801130a473ea3c?page=31 |
| 64e631dc91 | Sanskrit | opus | 2 | 3 | https://sourcelibrary.org/book/69ee89f34501bec896546e1d?page=770 |
| 369d2b577c | Japanese | flash | 2 | 3 | https://sourcelibrary.org/book/69dfede68d34461cbe7f4df4?page=71 |
| b883cdf746 | Hebrew | lite | 2 | 3 | https://sourcelibrary.org/book/69b4cd3dd5b6c3815e1a504b?page=154 |
| 7209ac2836 | Italian | lite | 2 | 3 | https://sourcelibrary.org/book/6a084e0949638a50931b4b3d?page=422 |
