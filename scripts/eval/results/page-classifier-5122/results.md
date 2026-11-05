
## script


### script · arm `stats`

**held gold labels, book-grouped CV (reference census; IA English; #6561 Opus; #5771 frames)** — n = 1914, accuracy 0.651

| true \ predicted | Arab | Armn | Deva | Grek | Hani | Hebr | Jpan | Latn | Mong | Syrc | Tibt | n | recall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Arab** | 7 | 3 | 2 | 1 | 1 | 2 | · | · | · | 5 | · | 21 | 0.33 |
| **Deva** | 1 | 2 | 7 | 1 | 1 | · | · | 1 | · | 1 | · | 14 | 0.50 |
| **Grek** | 7 | 8 | 5 | 77 | · | 9 | 2 | 28 | · | 10 | · | 146 | 0.53 |
| **Hani** | 10 | 1 | · | · | 558 | 1 | 10 | 1 | 38 | 8 | · | 627 | 0.89 |
| **Hebr** | 1 | · | · | 1 | · | · | 1 | 3 | · | · | · | 6 | 0.00 |
| **Latn** | 35 | 63 | 46 | 187 | · | 94 | 13 | 350 | 2 | 58 | · | 848 | 0.41 |
| **Mong** | · | · | · | · | 4 | · | · | · | 168 | · | · | 172 | 0.98 |
| **Tibt** | · | · | · | · | · | · | 1 | · | · | · | 79 | 80 | 0.99 |

precision — Arab: 0.11 (of 61); Armn: 0.00 (of 77); Deva: 0.12 (of 60); Grek: 0.29 (of 267); Hani: 0.99 (of 564); Hebr: 0.00 (of 106); Jpan: 0.00 (of 27); Latn: 0.91 (of 383); Mong: 0.81 (of 208); Syrc: 0.00 (of 82); Tibt: 1.00 (of 79)

****Opus by-eye check set** (fresh random draw, trained on everything else)** — n = 100, accuracy 0.590

| true \ predicted | Arab | Armn | Cyrl | Deva | Grek | Hani | Hebr | Jpan | Latn | Mong | Syrc | Tibt | n | recall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Armn** | · | 1 | · | · | · | · | · | · | · | · | · | · | 1 | 1.00 |
| **Cyrl** | · | 1 | · | · | · | · | · | · | · | · | · | · | 1 | 0.00 |
| **Deva** | · | 1 | · | 1 | · | · | · | · | · | · | · | · | 2 | 0.50 |
| **Hani** | · | 1 | · | · | 2 | 40 | · | 1 | · | 1 | · | · | 45 | 0.89 |
| **Latn** | 2 | 1 | · | 2 | 10 | 1 | 8 | 4 | 12 | 1 | 1 | 1 | 43 | 0.28 |
| **Mong** | · | · | · | · | · | 1 | · | · | · | · | · | · | 1 | 0.00 |
| **Tibt** | · | · | · | 1 | · | · | · | 1 | · | · | · | 5 | 7 | 0.71 |

precision — Arab: 0.00 (of 2); Armn: 0.20 (of 5); Deva: 0.25 (of 4); Grek: 0.00 (of 12); Hani: 0.95 (of 42); Hebr: 0.00 (of 8); Jpan: 0.00 (of 6); Latn: 1.00 (of 12); Mong: 0.00 (of 2); Syrc: 0.00 (of 1); Tibt: 0.83 (of 6)

check set at confidence ≥ 0.6: coverage 61/100, accuracy 0.770

check set at confidence ≥ 0.8: coverage 49/100, accuracy 0.878

check set at confidence ≥ 0.9: coverage 40/100, accuracy 0.925

### script · arm `siglip2-base+stats`

**held gold labels, book-grouped CV (reference census; IA English; #6561 Opus; #5771 frames)** — n = 1914, accuracy 0.981

| true \ predicted | Arab | Armn | Deva | Grek | Hani | Hebr | Jpan | Latn | Mong | Syrc | Tibt | n | recall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Arab** | 21 | · | · | · | · | · | · | · | · | · | · | 21 | 1.00 |
| **Deva** | · | · | 13 | · | · | · | · | · | · | · | 1 | 14 | 0.93 |
| **Grek** | · | · | · | 129 | · | · | · | 17 | · | · | · | 146 | 0.88 |
| **Hani** | · | 1 | · | · | 625 | · | 1 | · | · | · | · | 627 | 1.00 |
| **Hebr** | · | · | · | · | · | 5 | · | · | · | 1 | · | 6 | 0.83 |
| **Latn** | · | 2 | · | 12 | · | · | · | 834 | · | · | · | 848 | 0.98 |
| **Mong** | · | · | · | · | 1 | · | · | · | 171 | · | · | 172 | 0.99 |
| **Tibt** | · | · | · | · | · | · | · | · | · | · | 80 | 80 | 1.00 |

precision — Arab: 1.00 (of 21); Armn: 0.00 (of 3); Deva: 1.00 (of 13); Grek: 0.91 (of 141); Hani: 1.00 (of 626); Hebr: 1.00 (of 5); Jpan: 0.00 (of 1); Latn: 0.98 (of 851); Mong: 1.00 (of 171); Syrc: 0.00 (of 1); Tibt: 0.99 (of 81)

****Opus by-eye check set** (fresh random draw, trained on everything else)** — n = 100, accuracy 0.940

| true \ predicted | Armn | Cyrl | Deva | Grek | Hani | Latn | Mong | Tibt | n | recall |
|---|---|---|---|---|---|---|---|---|---|---|
| **Armn** | 1 | · | · | · | · | · | · | · | 1 | 1.00 |
| **Cyrl** | · | · | · | · | · | 1 | · | · | 1 | 0.00 |
| **Deva** | · | · | 2 | · | · | · | · | · | 2 | 1.00 |
| **Hani** | · | · | · | · | 44 | 1 | · | · | 45 | 0.98 |
| **Latn** | · | · | · | 3 | · | 40 | · | · | 43 | 0.93 |
| **Mong** | · | · | · | · | · | · | 1 | · | 1 | 1.00 |
| **Tibt** | 1 | · | · | · | · | · | · | 6 | 7 | 0.86 |

precision — Armn: 0.50 (of 2); Deva: 1.00 (of 2); Grek: 0.00 (of 3); Hani: 1.00 (of 44); Latn: 0.95 (of 42); Mong: 1.00 (of 1); Tibt: 1.00 (of 6)

check set at confidence ≥ 0.6: coverage 99/100, accuracy 0.949

check set at confidence ≥ 0.8: coverage 96/100, accuracy 0.948

check set at confidence ≥ 0.9: coverage 94/100, accuracy 0.957

### script · arm `siglip2-so400m+tiles+stats`

**held gold labels, book-grouped CV (reference census; IA English; #6561 Opus; #5771 frames)** — n = 1914, accuracy 0.996

| true \ predicted | Arab | Deva | Grek | Hani | Hebr | Latn | Mong | Syrc | Tibt | n | recall |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Arab** | 20 | · | · | · | · | · | · | 1 | · | 21 | 0.95 |
| **Deva** | · | 13 | · | · | · | · | · | · | 1 | 14 | 0.93 |
| **Grek** | · | · | 144 | · | · | 2 | · | · | · | 146 | 0.99 |
| **Hani** | · | · | · | 626 | · | · | 1 | · | · | 627 | 1.00 |
| **Hebr** | · | · | · | · | 5 | · | · | 1 | · | 6 | 0.83 |
| **Latn** | · | 2 | · | · | · | 846 | · | · | · | 848 | 1.00 |
| **Mong** | · | · | · | · | · | · | 172 | · | · | 172 | 1.00 |
| **Tibt** | · | · | · | · | · | · | · | · | 80 | 80 | 1.00 |

precision — Arab: 1.00 (of 20); Deva: 0.87 (of 15); Grek: 1.00 (of 144); Hani: 1.00 (of 626); Hebr: 1.00 (of 5); Latn: 1.00 (of 848); Mong: 0.99 (of 173); Syrc: 0.00 (of 2); Tibt: 0.99 (of 81)

****Opus by-eye check set** (fresh random draw, trained on everything else)** — n = 100, accuracy 0.980

| true \ predicted | Armn | Cyrl | Deva | Hani | Latn | Mong | Syrc | Tibt | n | recall |
|---|---|---|---|---|---|---|---|---|---|---|
| **Armn** | 1 | · | · | · | · | · | · | · | 1 | 1.00 |
| **Cyrl** | · | · | · | · | 1 | · | · | · | 1 | 0.00 |
| **Deva** | · | · | 2 | · | · | · | · | · | 2 | 1.00 |
| **Hani** | · | · | · | 45 | · | · | · | · | 45 | 1.00 |
| **Latn** | · | · | · | · | 43 | · | · | · | 43 | 1.00 |
| **Mong** | · | · | · | · | · | 1 | · | · | 1 | 1.00 |
| **Tibt** | · | · | · | · | · | · | 1 | 6 | 7 | 0.86 |

precision — Armn: 1.00 (of 1); Deva: 1.00 (of 2); Hani: 1.00 (of 45); Latn: 0.98 (of 44); Mong: 1.00 (of 1); Syrc: 0.00 (of 1); Tibt: 1.00 (of 6)

check set at confidence ≥ 0.6: coverage 100/100, accuracy 0.980

check set at confidence ≥ 0.8: coverage 98/100, accuracy 0.990

check set at confidence ≥ 0.9: coverage 98/100, accuracy 0.990

### script · arm `qwen3-vl-8b zero-shot`

**held gold labels, book-grouped CV (reference census; IA English; #6561 Opus; #5771 frames)** — n = 1914, accuracy 0.972

| true \ predicted | Arab | Deva | Grek | Hani | Hebr | Jpan | Latn | Mong | Tibt | none | other | n | recall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Arab** | 21 | · | · | · | · | · | · | · | · | · | · | 21 | 1.00 |
| **Deva** | · | 12 | · | · | · | · | · | · | 1 | · | 1 | 14 | 0.86 |
| **Grek** | · | · | 146 | · | · | · | · | · | · | · | · | 146 | 1.00 |
| **Hani** | · | · | · | 625 | · | 2 | · | · | · | · | · | 627 | 1.00 |
| **Hebr** | · | · | · | · | 6 | · | · | · | · | · | · | 6 | 1.00 |
| **Latn** | 5 | · | 19 | 19 | 2 | 2 | 799 | · | · | 2 | · | 848 | 0.94 |
| **Mong** | · | · | · | · | · | · | · | 172 | · | · | · | 172 | 1.00 |
| **Tibt** | · | · | · | · | · | · | · | · | 80 | · | · | 80 | 1.00 |

precision — Arab: 0.81 (of 26); Deva: 1.00 (of 12); Grek: 0.88 (of 165); Hani: 0.97 (of 644); Hebr: 0.75 (of 8); Jpan: 0.00 (of 4); Latn: 1.00 (of 799); Mong: 1.00 (of 172); Tibt: 0.99 (of 81); none: 0.00 (of 2); other: 0.00 (of 1)

****Opus by-eye check set** (fresh random draw, trained on everything else)** — n = 100, accuracy 0.940

| true \ predicted | Armn | Cyrl | Deva | Grek | Hani | Latn | Mong | Tibt | other | n | recall |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Armn** | · | · | · | · | · | · | · | · | 1 | 1 | 0.00 |
| **Cyrl** | · | 1 | · | · | · | · | · | · | · | 1 | 1.00 |
| **Deva** | · | · | 2 | · | · | · | · | · | · | 2 | 1.00 |
| **Hani** | · | · | · | · | 45 | · | · | · | · | 45 | 1.00 |
| **Latn** | · | · | 2 | 2 | · | 39 | · | · | · | 43 | 0.91 |
| **Mong** | · | · | · | · | · | · | 1 | · | · | 1 | 1.00 |
| **Tibt** | · | · | · | · | · | · | · | 6 | 1 | 7 | 0.86 |

precision — Cyrl: 1.00 (of 1); Deva: 0.50 (of 4); Grek: 0.00 (of 2); Hani: 1.00 (of 45); Latn: 1.00 (of 39); Mong: 1.00 (of 1); Tibt: 1.00 (of 6); other: 0.00 (of 2)

### script · arm `agree(siglip2-so400m+tiles+stats, qwen3-vl)`

**held gold labels, book-grouped CV (reference census; IA English; #6561 Opus; #5771 frames)** — n = 1914, accuracy 0.969

| true \ predicted | Arab | Deva | Grek | Hani | Hebr | Latn | Mong | Tibt | abstain | n | recall |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Arab** | 20 | · | · | · | · | · | · | · | 1 | 21 | 0.95 |
| **Deva** | · | 12 | · | · | · | · | · | 1 | 1 | 14 | 0.86 |
| **Grek** | · | · | 144 | · | · | · | · | · | 2 | 146 | 0.99 |
| **Hani** | · | · | · | 624 | · | · | · | · | 3 | 627 | 1.00 |
| **Hebr** | · | · | · | · | 5 | · | · | · | 1 | 6 | 0.83 |
| **Latn** | · | · | · | · | · | 797 | · | · | 51 | 848 | 0.94 |
| **Mong** | · | · | · | · | · | · | 172 | · | · | 172 | 1.00 |
| **Tibt** | · | · | · | · | · | · | · | 80 | · | 80 | 1.00 |

precision — Arab: 1.00 (of 20); Deva: 1.00 (of 12); Grek: 1.00 (of 144); Hani: 1.00 (of 624); Hebr: 1.00 (of 5); Latn: 1.00 (of 797); Mong: 1.00 (of 172); Tibt: 0.99 (of 81); abstain: 0.00 (of 59)

****Opus by-eye check set** (fresh random draw, trained on everything else)** — n = 100, accuracy 0.930

| true \ predicted | Armn | Cyrl | Deva | Hani | Latn | Mong | Tibt | abstain | n | recall |
|---|---|---|---|---|---|---|---|---|---|---|
| **Armn** | · | · | · | · | · | · | · | 1 | 1 | 0.00 |
| **Cyrl** | · | · | · | · | · | · | · | 1 | 1 | 0.00 |
| **Deva** | · | · | 2 | · | · | · | · | · | 2 | 1.00 |
| **Hani** | · | · | · | 45 | · | · | · | · | 45 | 1.00 |
| **Latn** | · | · | · | · | 39 | · | · | 4 | 43 | 0.91 |
| **Mong** | · | · | · | · | · | 1 | · | · | 1 | 1.00 |
| **Tibt** | · | · | · | · | · | · | 6 | 1 | 7 | 0.86 |

precision — Deva: 1.00 (of 2); Hani: 1.00 (of 45); Latn: 1.00 (of 39); Mong: 1.00 (of 1); Tibt: 1.00 (of 6); abstain: 0.00 (of 7)

check set at confidence ≥ 0.6: coverage 100/100, accuracy 0.930

check set at confidence ≥ 0.8: coverage 100/100, accuracy 0.930

check set at confidence ≥ 0.9: coverage 100/100, accuracy 0.930

## page kind


### page kind · arm `stats`

**#4763 English strata: date-dense vs prose, book-grouped CV** — n = 183, accuracy 0.404

| true \ predicted | date-dense | music | plate | prose | table | n | recall |
|---|---|---|---|---|---|---|---|
| **date-dense** | 59 | 10 | 1 | 11 | · | 81 | 0.73 |
| **prose** | 78 | 8 | · | 15 | 1 | 102 | 0.15 |

precision — date-dense: 0.43 (of 137); music: 0.00 (of 18); plate: 0.00 (of 1); prose: 0.58 (of 26); table: 0.00 (of 1)

**#6561 Chinese Paddle-flagged pages, Opus layout call, book-grouped CV** — n = 858, accuracy 0.374

| true \ predicted | date-dense | diagram | mixed | plate | prose | table | n | recall |
|---|---|---|---|---|---|---|---|---|
| **diagram** | · | · | · | 89 | 2 | 29 | 120 | 0.00 |
| **mixed** | · | · | · | 14 | 1 | 105 | 120 | 0.00 |
| **plate** | · | · | · | 15 | 2 | 1 | 18 | 0.83 |
| **prose** | · | · | · | 18 | 105 | 177 | 300 | 0.35 |
| **table** | 1 | · | · | 81 | 17 | 201 | 300 | 0.67 |

precision — date-dense: 0.00 (of 1); plate: 0.07 (of 217); prose: 0.83 (of 127); table: 0.39 (of 513)

**sealed benchmark pages, #4763 rule on the reference text, book-grouped CV** — n = 901, accuracy 0.578

| true \ predicted | date-dense | music | plate | prose | table | n | recall |
|---|---|---|---|---|---|---|---|
| **date-dense** | 86 | 6 | 1 | 45 | 1 | 139 | 0.62 |
| **prose** | 277 | 14 | 6 | 435 | 27 | 759 | 0.57 |
| **table** | · | · | · | 3 | · | 3 | 0.00 |

precision — date-dense: 0.24 (of 363); music: 0.00 (of 20); plate: 0.00 (of 7); prose: 0.90 (of 483); table: 0.00 (of 28)

**music transcription pages (positives only), book-grouped CV** — n = 78, accuracy 0.000

| true \ predicted | date-dense | music | prose | n | recall |
|---|---|---|---|---|---|
| **music** | 70 | · | 8 | 78 | 0.00 |

precision — date-dense: 0.00 (of 70); prose: 0.00 (of 8)

****Opus by-eye check set** (fresh random draw, trained on everything else)** — n = 100, accuracy 0.290

| true \ predicted | blank | date-dense | music | plate | prose | table | n | recall |
|---|---|---|---|---|---|---|---|---|
| **blank** | · | · | · | · | 1 | · | 1 | 0.00 |
| **date-dense** | · | 3 | · | · | 9 | 2 | 14 | 0.21 |
| **music** | · | · | 1 | · | · | · | 1 | 1.00 |
| **plate** | · | · | · | · | 1 | · | 1 | 0.00 |
| **prose** | · | 20 | 2 | 3 | 25 | 32 | 82 | 0.30 |
| **table** | · | · | · | · | 1 | · | 1 | 0.00 |

precision — date-dense: 0.13 (of 23); music: 0.33 (of 3); plate: 0.00 (of 3); prose: 0.68 (of 37); table: 0.00 (of 34)

check set at confidence ≥ 0.6: coverage 76/100, accuracy 0.224

check set at confidence ≥ 0.8: coverage 27/100, accuracy 0.148

check set at confidence ≥ 0.9: coverage 9/100, accuracy 0.222

### page kind · arm `siglip2-base+stats`

**#4763 English strata: date-dense vs prose, book-grouped CV** — n = 183, accuracy 0.645

| true \ predicted | date-dense | music | prose | n | recall |
|---|---|---|---|---|---|
| **date-dense** | 42 | · | 39 | 81 | 0.52 |
| **prose** | 25 | 1 | 76 | 102 | 0.75 |

precision — date-dense: 0.63 (of 67); music: 0.00 (of 1); prose: 0.66 (of 115)

**#6561 Chinese Paddle-flagged pages, Opus layout call, book-grouped CV** — n = 858, accuracy 0.585

| true \ predicted | diagram | mixed | plate | prose | table | n | recall |
|---|---|---|---|---|---|---|---|
| **diagram** | · | · | 96 | · | 24 | 120 | 0.00 |
| **mixed** | · | · | 7 | 27 | 86 | 120 | 0.00 |
| **plate** | · | · | 18 | · | · | 18 | 1.00 |
| **prose** | · | · | · | 210 | 90 | 300 | 0.70 |
| **table** | · | · | 8 | 18 | 274 | 300 | 0.91 |

precision — plate: 0.14 (of 129); prose: 0.82 (of 255); table: 0.58 (of 474)

**sealed benchmark pages, #4763 rule on the reference text, book-grouped CV** — n = 901, accuracy 0.789

| true \ predicted | date-dense | music | plate | prose | table | n | recall |
|---|---|---|---|---|---|---|---|
| **date-dense** | 68 | · | · | 70 | 1 | 139 | 0.49 |
| **prose** | 107 | 1 | 1 | 641 | 9 | 759 | 0.84 |
| **table** | · | · | · | 1 | 2 | 3 | 0.67 |

precision — date-dense: 0.39 (of 175); music: 0.00 (of 1); plate: 0.00 (of 1); prose: 0.90 (of 712); table: 0.17 (of 12)

**music transcription pages (positives only), book-grouped CV** — n = 78, accuracy 0.244

| true \ predicted | date-dense | music | prose | n | recall |
|---|---|---|---|---|---|
| **music** | 49 | 19 | 10 | 78 | 0.24 |

precision — date-dense: 0.00 (of 49); music: 1.00 (of 19); prose: 0.00 (of 10)

****Opus by-eye check set** (fresh random draw, trained on everything else)** — n = 100, accuracy 0.740

| true \ predicted | blank | date-dense | music | plate | prose | table | n | recall |
|---|---|---|---|---|---|---|---|---|
| **blank** | · | 1 | · | · | · | · | 1 | 0.00 |
| **date-dense** | · | 7 | · | · | 5 | 2 | 14 | 0.50 |
| **music** | · | · | · | · | 1 | · | 1 | 0.00 |
| **plate** | · | · | · | 1 | · | · | 1 | 1.00 |
| **prose** | · | 9 | · | 2 | 66 | 5 | 82 | 0.80 |
| **table** | · | 1 | · | · | · | · | 1 | 0.00 |

precision — date-dense: 0.39 (of 18); plate: 0.33 (of 3); prose: 0.92 (of 72); table: 0.00 (of 7)

check set at confidence ≥ 0.6: coverage 95/100, accuracy 0.758

check set at confidence ≥ 0.8: coverage 72/100, accuracy 0.819

check set at confidence ≥ 0.9: coverage 63/100, accuracy 0.810

### page kind · arm `siglip2-so400m+tiles+stats`

**#4763 English strata: date-dense vs prose, book-grouped CV** — n = 183, accuracy 0.732

| true \ predicted | date-dense | plate | prose | n | recall |
|---|---|---|---|---|---|
| **date-dense** | 50 | 1 | 30 | 81 | 0.62 |
| **prose** | 17 | 1 | 84 | 102 | 0.82 |

precision — date-dense: 0.75 (of 67); plate: 0.00 (of 2); prose: 0.74 (of 114)

**#6561 Chinese Paddle-flagged pages, Opus layout call, book-grouped CV** — n = 858, accuracy 0.597

| true \ predicted | diagram | mixed | plate | prose | table | n | recall |
|---|---|---|---|---|---|---|---|
| **diagram** | · | · | 91 | 1 | 28 | 120 | 0.00 |
| **mixed** | · | · | 9 | 24 | 87 | 120 | 0.00 |
| **plate** | · | · | 15 | · | 3 | 18 | 0.83 |
| **prose** | · | · | · | 224 | 76 | 300 | 0.75 |
| **table** | · | · | 7 | 20 | 273 | 300 | 0.91 |

precision — plate: 0.12 (of 122); prose: 0.83 (of 269); table: 0.58 (of 467)

**sealed benchmark pages, #4763 rule on the reference text, book-grouped CV** — n = 901, accuracy 0.848

| true \ predicted | date-dense | plate | prose | table | n | recall |
|---|---|---|---|---|---|---|
| **date-dense** | 75 | · | 63 | 1 | 139 | 0.54 |
| **prose** | 68 | 1 | 688 | 2 | 759 | 0.91 |
| **table** | 1 | · | 1 | 1 | 3 | 0.33 |

precision — date-dense: 0.52 (of 144); plate: 0.00 (of 1); prose: 0.91 (of 752); table: 0.25 (of 4)

**music transcription pages (positives only), book-grouped CV** — n = 78, accuracy 0.064

| true \ predicted | date-dense | music | prose | n | recall |
|---|---|---|---|---|---|
| **music** | 44 | 5 | 29 | 78 | 0.06 |

precision — date-dense: 0.00 (of 44); music: 1.00 (of 5); prose: 0.00 (of 29)

****Opus by-eye check set** (fresh random draw, trained on everything else)** — n = 100, accuracy 0.740

| true \ predicted | blank | date-dense | music | plate | prose | table | n | recall |
|---|---|---|---|---|---|---|---|---|
| **blank** | · | 1 | · | · | · | · | 1 | 0.00 |
| **date-dense** | · | 10 | · | · | 3 | 1 | 14 | 0.71 |
| **music** | · | 1 | · | · | · | · | 1 | 0.00 |
| **plate** | · | · | · | 1 | · | · | 1 | 1.00 |
| **prose** | · | 11 | · | 1 | 63 | 7 | 82 | 0.77 |
| **table** | · | 1 | · | · | · | · | 1 | 0.00 |

precision — date-dense: 0.42 (of 24); plate: 0.50 (of 2); prose: 0.95 (of 66); table: 0.00 (of 8)

check set at confidence ≥ 0.6: coverage 97/100, accuracy 0.763

check set at confidence ≥ 0.8: coverage 89/100, accuracy 0.787

check set at confidence ≥ 0.9: coverage 84/100, accuracy 0.798

### page kind · arm `qwen3-vl-8b zero-shot`

**#4763 English strata: date-dense vs prose, book-grouped CV** — n = 183, accuracy 0.585

| true \ predicted | blank | date-dense | prose | table | n | recall |
|---|---|---|---|---|---|---|
| **date-dense** | 2 | 10 | 67 | 2 | 81 | 0.12 |
| **prose** | · | 5 | 97 | · | 102 | 0.95 |

precision — blank: 0.00 (of 2); date-dense: 0.67 (of 15); prose: 0.59 (of 164); table: 0.00 (of 2)

**#6561 Chinese Paddle-flagged pages, Opus layout call, book-grouped CV** — n = 858, accuracy 0.635

| true \ predicted | date-dense | diagram | mixed | music | plate | prose | table | n | recall |
|---|---|---|---|---|---|---|---|---|---|
| **diagram** | 3 | · | · | 2 | 65 | 26 | 24 | 120 | 0.00 |
| **mixed** | 2 | · | · | · | 3 | 112 | 3 | 120 | 0.00 |
| **plate** | 1 | · | · | · | 16 | 1 | · | 18 | 0.89 |
| **prose** | 1 | · | · | · | · | 294 | 5 | 300 | 0.98 |
| **table** | 9 | · | · | · | 1 | 55 | 235 | 300 | 0.78 |

precision — date-dense: 0.00 (of 16); music: 0.00 (of 2); plate: 0.19 (of 85); prose: 0.60 (of 488); table: 0.88 (of 267)

**sealed benchmark pages, #4763 rule on the reference text, book-grouped CV** — n = 901, accuracy 0.852

| true \ predicted | date-dense | plate | prose | table | n | recall |
|---|---|---|---|---|---|---|
| **date-dense** | 12 | · | 125 | 2 | 139 | 0.09 |
| **prose** | 2 | 1 | 756 | · | 759 | 1.00 |
| **table** | · | · | 3 | · | 3 | 0.00 |

precision — date-dense: 0.86 (of 14); plate: 0.00 (of 1); prose: 0.86 (of 884); table: 0.00 (of 2)

**music transcription pages (positives only), book-grouped CV** — n = 78, accuracy 0.962

| true \ predicted | music | prose | n | recall |
|---|---|---|---|---|
| **music** | 75 | 3 | 78 | 0.96 |

precision — music: 1.00 (of 75); prose: 0.00 (of 3)

****Opus by-eye check set** (fresh random draw, trained on everything else)** — n = 100, accuracy 0.880

| true \ predicted | blank | date-dense | music | plate | prose | table | n | recall |
|---|---|---|---|---|---|---|---|---|
| **blank** | · | · | · | · | 1 | · | 1 | 0.00 |
| **date-dense** | · | 3 | · | · | 11 | · | 14 | 0.21 |
| **music** | · | · | 1 | · | · | · | 1 | 1.00 |
| **plate** | · | · | · | 1 | · | · | 1 | 1.00 |
| **prose** | · | · | · | · | 82 | · | 82 | 1.00 |
| **table** | · | · | · | · | · | 1 | 1 | 1.00 |

precision — date-dense: 1.00 (of 3); music: 1.00 (of 1); plate: 1.00 (of 1); prose: 0.87 (of 94); table: 1.00 (of 1)

### page kind · arm `agree(siglip2-so400m+tiles+stats, qwen3-vl)`

**#4763 English strata: date-dense vs prose, book-grouped CV** — n = 183, accuracy 0.492

| true \ predicted | abstain | date-dense | prose | n | recall |
|---|---|---|---|---|---|
| **date-dense** | 43 | 9 | 29 | 81 | 0.11 |
| **prose** | 19 | 2 | 81 | 102 | 0.79 |

precision — abstain: 0.00 (of 62); date-dense: 0.82 (of 11); prose: 0.74 (of 110)

**#6561 Chinese Paddle-flagged pages, Opus layout call, book-grouped CV** — n = 858, accuracy 0.536

| true \ predicted | abstain | diagram | mixed | plate | prose | table | n | recall |
|---|---|---|---|---|---|---|---|---|
| **diagram** | 58 | · | · | 52 | · | 10 | 120 | 0.00 |
| **mixed** | 91 | · | · | 3 | 24 | 2 | 120 | 0.00 |
| **plate** | 4 | · | · | 14 | · | · | 18 | 0.78 |
| **prose** | 75 | · | · | · | 222 | 3 | 300 | 0.74 |
| **table** | 63 | · | · | · | 13 | 224 | 300 | 0.75 |

precision — abstain: 0.00 (of 291); plate: 0.20 (of 69); prose: 0.86 (of 259); table: 0.94 (of 239)

**sealed benchmark pages, #4763 rule on the reference text, book-grouped CV** — n = 901, accuracy 0.770

| true \ predicted | abstain | date-dense | prose | table | n | recall |
|---|---|---|---|---|---|---|
| **date-dense** | 71 | 9 | 59 | · | 139 | 0.06 |
| **prose** | 74 | · | 685 | · | 759 | 0.90 |
| **table** | 2 | · | 1 | · | 3 | 0.00 |

precision — abstain: 0.00 (of 147); date-dense: 1.00 (of 9); prose: 0.92 (of 745)

**music transcription pages (positives only), book-grouped CV** — n = 78, accuracy 0.064

| true \ predicted | abstain | music | prose | n | recall |
|---|---|---|---|---|---|
| **music** | 70 | 5 | 3 | 78 | 0.06 |

precision — abstain: 0.00 (of 70); music: 1.00 (of 5); prose: 0.00 (of 3)

****Opus by-eye check set** (fresh random draw, trained on everything else)** — n = 100, accuracy 0.670

| true \ predicted | abstain | blank | date-dense | music | plate | prose | table | n | recall |
|---|---|---|---|---|---|---|---|---|---|
| **blank** | 1 | · | · | · | · | · | · | 1 | 0.00 |
| **date-dense** | 8 | · | 3 | · | · | 3 | · | 14 | 0.21 |
| **music** | 1 | · | · | · | · | · | · | 1 | 0.00 |
| **plate** | · | · | · | · | 1 | · | · | 1 | 1.00 |
| **prose** | 19 | · | · | · | · | 63 | · | 82 | 0.77 |
| **table** | 1 | · | · | · | · | · | · | 1 | 0.00 |

precision — abstain: 0.00 (of 30); date-dense: 1.00 (of 3); plate: 1.00 (of 1); prose: 0.95 (of 66)

check set at confidence ≥ 0.6: coverage 100/100, accuracy 0.670

check set at confidence ≥ 0.8: coverage 100/100, accuracy 0.670

check set at confidence ≥ 0.9: coverage 100/100, accuracy 0.670

## leaf count


### leaf count · arm `stats`

**script-class spread labels (#5122 Sonnet by eye), book-grouped CV** — n = 902, accuracy 0.986

| true \ predicted | 1 | 2 | 3+ | n | recall |
|---|---|---|---|---|---|
| **1** | 869 | 7 | 1 | 877 | 0.99 |
| **2** | 4 | 20 | 1 | 25 | 0.80 |

precision — 1: 1.00 (of 873); 2: 0.74 (of 27); 3+: 0.00 (of 2)

**#5771 split-leaves pilot pecha frames, book-grouped CV** — n = 80, accuracy 0.487

| true \ predicted | 2 | 3+ | n | recall |
|---|---|---|---|---|
| **2** | 20 | 36 | 56 | 0.36 |
| **3+** | 5 | 19 | 24 | 0.79 |

precision — 2: 0.80 (of 25); 3+: 0.35 (of 55)

**user-split images, book-grouped CV** — n = 250, accuracy 0.996

| true \ predicted | 1 | 2 | n | recall |
|---|---|---|---|---|
| **2** | 1 | 249 | 250 | 1.00 |

precision — 1: 0.00 (of 1); 2: 1.00 (of 249)

**IA per-leaf English, book-grouped CV** — n = 183, accuracy 1.000

| true \ predicted | 1 | n | recall |
|---|---|---|---|
| **1** | 183 | 183 | 1.00 |

precision — 1: 1.00 (of 183)

****Opus by-eye check set** (fresh random draw, trained on everything else)** — n = 100, accuracy 0.920

| true \ predicted | 1 | 2 | 3+ | n | recall |
|---|---|---|---|---|---|
| **1** | 87 | 4 | 1 | 92 | 0.95 |
| **2** | 1 | 2 | 1 | 4 | 0.50 |
| **3+** | · | 1 | 3 | 4 | 0.75 |

precision — 1: 0.99 (of 88); 2: 0.29 (of 7); 3+: 0.60 (of 5)

check set at confidence ≥ 0.6: coverage 96/100, accuracy 0.938

check set at confidence ≥ 0.8: coverage 89/100, accuracy 0.955

check set at confidence ≥ 0.9: coverage 78/100, accuracy 0.962

### leaf count · arm `siglip2-base+stats`

**script-class spread labels (#5122 Sonnet by eye), book-grouped CV** — n = 902, accuracy 0.994

| true \ predicted | 1 | 2 | n | recall |
|---|---|---|---|---|
| **1** | 876 | 1 | 877 | 1.00 |
| **2** | 4 | 21 | 25 | 0.84 |

precision — 1: 1.00 (of 880); 2: 0.95 (of 22)

**#5771 split-leaves pilot pecha frames, book-grouped CV** — n = 80, accuracy 1.000

| true \ predicted | 2 | 3+ | n | recall |
|---|---|---|---|---|
| **2** | 56 | · | 56 | 1.00 |
| **3+** | · | 24 | 24 | 1.00 |

precision — 2: 1.00 (of 56); 3+: 1.00 (of 24)

**user-split images, book-grouped CV** — n = 250, accuracy 0.996

| true \ predicted | 1 | 2 | n | recall |
|---|---|---|---|---|
| **2** | 1 | 249 | 250 | 1.00 |

precision — 1: 0.00 (of 1); 2: 1.00 (of 249)

**IA per-leaf English, book-grouped CV** — n = 183, accuracy 1.000

| true \ predicted | 1 | n | recall |
|---|---|---|---|
| **1** | 183 | 183 | 1.00 |

precision — 1: 1.00 (of 183)

****Opus by-eye check set** (fresh random draw, trained on everything else)** — n = 100, accuracy 0.940

| true \ predicted | 1 | 2 | 3+ | n | recall |
|---|---|---|---|---|---|
| **1** | 87 | 5 | · | 92 | 0.95 |
| **2** | 1 | 3 | · | 4 | 0.75 |
| **3+** | · | · | 4 | 4 | 1.00 |

precision — 1: 0.99 (of 88); 2: 0.38 (of 8); 3+: 1.00 (of 4)

check set at confidence ≥ 0.6: coverage 97/100, accuracy 0.959

check set at confidence ≥ 0.8: coverage 94/100, accuracy 0.968

check set at confidence ≥ 0.9: coverage 88/100, accuracy 0.989

### leaf count · arm `siglip2-so400m+tiles+stats`

**script-class spread labels (#5122 Sonnet by eye), book-grouped CV** — n = 902, accuracy 0.992

| true \ predicted | 1 | 2 | n | recall |
|---|---|---|---|---|
| **1** | 874 | 3 | 877 | 1.00 |
| **2** | 4 | 21 | 25 | 0.84 |

precision — 1: 1.00 (of 878); 2: 0.88 (of 24)

**#5771 split-leaves pilot pecha frames, book-grouped CV** — n = 80, accuracy 0.988

| true \ predicted | 2 | 3+ | n | recall |
|---|---|---|---|---|
| **2** | 55 | 1 | 56 | 0.98 |
| **3+** | · | 24 | 24 | 1.00 |

precision — 2: 1.00 (of 55); 3+: 0.96 (of 25)

**user-split images, book-grouped CV** — n = 250, accuracy 0.996

| true \ predicted | 1 | 2 | n | recall |
|---|---|---|---|---|
| **2** | 1 | 249 | 250 | 1.00 |

precision — 1: 0.00 (of 1); 2: 1.00 (of 249)

**IA per-leaf English, book-grouped CV** — n = 183, accuracy 1.000

| true \ predicted | 1 | n | recall |
|---|---|---|---|
| **1** | 183 | 183 | 1.00 |

precision — 1: 1.00 (of 183)

****Opus by-eye check set** (fresh random draw, trained on everything else)** — n = 100, accuracy 0.960

| true \ predicted | 1 | 2 | 3+ | n | recall |
|---|---|---|---|---|---|
| **1** | 89 | 3 | · | 92 | 0.97 |
| **2** | 1 | 3 | · | 4 | 0.75 |
| **3+** | · | · | 4 | 4 | 1.00 |

precision — 1: 0.99 (of 90); 2: 0.50 (of 6); 3+: 1.00 (of 4)

check set at confidence ≥ 0.6: coverage 100/100, accuracy 0.960

check set at confidence ≥ 0.8: coverage 98/100, accuracy 0.980

check set at confidence ≥ 0.9: coverage 95/100, accuracy 0.979

### leaf count · arm `aspect 1.05–2.2 (spread-screen rule)`

**script-class spread labels (#5122 Sonnet by eye), book-grouped CV** — n = 902, accuracy 0.992

| true \ predicted | 1 | 2 | n | recall |
|---|---|---|---|---|
| **1** | 874 | 3 | 877 | 1.00 |
| **2** | 4 | 21 | 25 | 0.84 |

precision — 1: 1.00 (of 878); 2: 0.88 (of 24)

**#5771 split-leaves pilot pecha frames, book-grouped CV** — n = 80, accuracy 0.700

| true \ predicted | 1 | 2 | 3+ | n | recall |
|---|---|---|---|---|---|
| **2** | · | 56 | · | 56 | 1.00 |
| **3+** | 1 | 23 | · | 24 | 0.00 |

precision — 1: 0.00 (of 1); 2: 0.71 (of 79)

**user-split images, book-grouped CV** — n = 250, accuracy 0.996

| true \ predicted | 1 | 2 | n | recall |
|---|---|---|---|---|
| **2** | 1 | 249 | 250 | 1.00 |

precision — 1: 0.00 (of 1); 2: 1.00 (of 249)

**IA per-leaf English, book-grouped CV** — n = 183, accuracy 1.000

| true \ predicted | 1 | n | recall |
|---|---|---|---|
| **1** | 183 | 183 | 1.00 |

precision — 1: 1.00 (of 183)

****Opus by-eye check set** (fresh random draw, trained on everything else)** — n = 100, accuracy 0.940

| true \ predicted | 1 | 2 | 3+ | n | recall |
|---|---|---|---|---|---|
| **1** | 91 | 1 | · | 92 | 0.99 |
| **2** | 1 | 3 | · | 4 | 0.75 |
| **3+** | · | 4 | · | 4 | 0.00 |

precision — 1: 0.99 (of 92); 2: 0.38 (of 8)

### leaf count · arm `qwen3-vl-8b zero-shot`

**script-class spread labels (#5122 Sonnet by eye), book-grouped CV** — n = 902, accuracy 0.987

| true \ predicted | 1 | 2 | n | recall |
|---|---|---|---|---|
| **1** | 867 | 10 | 877 | 0.99 |
| **2** | 2 | 23 | 25 | 0.92 |

precision — 1: 1.00 (of 869); 2: 0.70 (of 33)

**#5771 split-leaves pilot pecha frames, book-grouped CV** — n = 80, accuracy 0.975

| true \ predicted | 1 | 2 | 3+ | n | recall |
|---|---|---|---|---|---|
| **2** | 2 | 54 | · | 56 | 0.96 |
| **3+** | · | · | 24 | 24 | 1.00 |

precision — 1: 0.00 (of 2); 2: 1.00 (of 54); 3+: 1.00 (of 24)

**user-split images, book-grouped CV** — n = 250, accuracy 0.996

| true \ predicted | 1 | 2 | n | recall |
|---|---|---|---|---|
| **2** | 1 | 249 | 250 | 1.00 |

precision — 1: 0.00 (of 1); 2: 1.00 (of 249)

**IA per-leaf English, book-grouped CV** — n = 183, accuracy 1.000

| true \ predicted | 1 | n | recall |
|---|---|---|---|
| **1** | 183 | 183 | 1.00 |

precision — 1: 1.00 (of 183)

****Opus by-eye check set** (fresh random draw, trained on everything else)** — n = 100, accuracy 0.980

| true \ predicted | 1 | 2 | 3+ | n | recall |
|---|---|---|---|---|---|
| **1** | 90 | 2 | · | 92 | 0.98 |
| **2** | · | 4 | · | 4 | 1.00 |
| **3+** | · | · | 4 | 4 | 1.00 |

precision — 1: 1.00 (of 90); 2: 0.67 (of 6); 3+: 1.00 (of 4)

### leaf count · arm `agree(siglip2-so400m+tiles+stats, qwen3-vl)`

**script-class spread labels (#5122 Sonnet by eye), book-grouped CV** — n = 902, accuracy 0.981

| true \ predicted | 1 | 2 | abstain | n | recall |
|---|---|---|---|---|---|
| **1** | 865 | 1 | 11 | 877 | 0.99 |
| **2** | 1 | 20 | 4 | 25 | 0.80 |

precision — 1: 1.00 (of 866); 2: 0.95 (of 21); abstain: 0.00 (of 15)

**#5771 split-leaves pilot pecha frames, book-grouped CV** — n = 80, accuracy 0.963

| true \ predicted | 2 | 3+ | abstain | n | recall |
|---|---|---|---|---|---|
| **2** | 53 | · | 3 | 56 | 0.95 |
| **3+** | · | 24 | · | 24 | 1.00 |

precision — 2: 1.00 (of 53); 3+: 1.00 (of 24); abstain: 0.00 (of 3)

**user-split images, book-grouped CV** — n = 250, accuracy 0.996

| true \ predicted | 1 | 2 | n | recall |
|---|---|---|---|---|
| **2** | 1 | 249 | 250 | 1.00 |

precision — 1: 0.00 (of 1); 2: 1.00 (of 249)

**IA per-leaf English, book-grouped CV** — n = 183, accuracy 1.000

| true \ predicted | 1 | n | recall |
|---|---|---|---|
| **1** | 183 | 183 | 1.00 |

precision — 1: 1.00 (of 183)

****Opus by-eye check set** (fresh random draw, trained on everything else)** — n = 100, accuracy 0.940

| true \ predicted | 1 | 2 | 3+ | abstain | n | recall |
|---|---|---|---|---|---|---|
| **1** | 87 | · | · | 5 | 92 | 0.95 |
| **2** | · | 3 | · | 1 | 4 | 0.75 |
| **3+** | · | · | 4 | · | 4 | 1.00 |

precision — 1: 1.00 (of 87); 2: 1.00 (of 3); 3+: 1.00 (of 4); abstain: 0.00 (of 6)

check set at confidence ≥ 0.6: coverage 100/100, accuracy 0.940

check set at confidence ≥ 0.8: coverage 100/100, accuracy 0.940

check set at confidence ≥ 0.9: coverage 100/100, accuracy 0.940

## print or manuscript


### print or manuscript · arm `stats`

**script-class print technique (#5122 Sonnet by eye; Chinese and Greek only), book-grouped CV** — n = 875, accuracy 0.942

| true \ predicted | manuscript | print | n | recall |
|---|---|---|---|---|
| **manuscript** | 594 | 26 | 620 | 0.96 |
| **print** | 25 | 230 | 255 | 0.90 |

precision — manuscript: 0.96 (of 619); print: 0.90 (of 256)

### print or manuscript · arm `siglip2-base+stats`

**script-class print technique (#5122 Sonnet by eye; Chinese and Greek only), book-grouped CV** — n = 875, accuracy 0.960

| true \ predicted | manuscript | print | n | recall |
|---|---|---|---|---|
| **manuscript** | 602 | 18 | 620 | 0.97 |
| **print** | 17 | 238 | 255 | 0.93 |

precision — manuscript: 0.97 (of 619); print: 0.93 (of 256)

### print or manuscript · arm `siglip2-so400m+tiles+stats`

**script-class print technique (#5122 Sonnet by eye; Chinese and Greek only), book-grouped CV** — n = 875, accuracy 0.967

| true \ predicted | manuscript | print | n | recall |
|---|---|---|---|---|
| **manuscript** | 605 | 15 | 620 | 0.98 |
| **print** | 14 | 241 | 255 | 0.95 |

precision — manuscript: 0.98 (of 619); print: 0.94 (of 256)
