# Translation corpus audit — zh-translation-strata-5274

Judge: opus (source-grounded, reference-free, single candidate; measure = judge rating, NOT accuracy). 0 pages from 0 books, one interior page per book, seed 20261103.

**Controls gate: PASS** (swap ≥ 93% rated ≤2, drop ≥ 87% flagged omission, repeat ≥ 93% within one; ≥ 10 of each).

## Controls (read first)
- swap (translation of another page): 15/15 rated ≤2, 15/15 flagged wrong_page
- drop (middle ~35% removed): 15/15 flagged omission, 15/15 rated ≤3
- repeat (same item twice): 11/15 exact, 15/15 within 1, 12/15 identical flags

## Corpus estimate (post-stratified by language; 95% CI)
| statistic | est % | CI |
|---|---:|---|
| fidelity 5 | 0 | 0–0 |
| fidelity ≥ 4 | 0 | 0–0 |
| fidelity ≤ 2 | 0 | 0–0 |
| any major defect | 0 | 0–0 |
| omission | 0 | 0–0 |
| invention | 0 | 0–0 |
| inversion | 0 | 0–0 |
| untranslated | 0 | 0–0 |
| wrong_language | 0 | 0–0 |
| wrong_page | 0 | 0–0 |
| garble_passthrough | 0 | 0–0 |
| truncated | 0 | 0–0 |
| repetition | 0 | 0–0 |

## Chinese strata oversample (#5274)
Chinese cell in the corpus estimate: fidelity ≥ 4 66.3% strata-weighted over 110 books (null% on the 0 main books alone); any major 30.4% (null%).

| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 3-flash|gemini | 12 | 2.83 | 3 | 4 / 2 / 0 / 4 / 2 | 16.7 | 50 | 50 | 0 | 58.3 | 0 | 50 |
| 3-flash|other | 3 | 3.33 | 3 | 0 / 0 / 2 / 1 / 0 | 0 | 33.3 | 0 | 66.7 | 33.3 | 0 | 66.7 |
| 3-flash|paddle | 12 | 3.42 | 3 | 0 / 0 / 7 / 5 / 0 | 0 | 41.7 | 0 | 50 | 25 | 0 | 50 |
| 3.8-flash|gemini | 12 | 4.67 | 5 | 0 / 0 / 0 / 4 / 8 | 66.7 | 100 | 0 | 8.3 | 0 | 0 | 0 |
| 3.8-flash|other | 12 | 4.42 | 4 | 0 / 0 / 0 / 7 / 5 | 41.7 | 100 | 0 | 0 | 41.7 | 0 | 0 |
| 3.8-flash|paddle | 12 | 4.42 | 4.5 | 0 / 0 / 1 / 5 / 6 | 50 | 91.7 | 0 | 8.3 | 16.7 | 0 | 8.3 |
| flash-lite|gemini | 11 | 4.27 | 4 | 0 / 0 / 2 / 4 / 5 | 45.5 | 81.8 | 0 | 18.2 | 9.1 | 0 | 18.2 |
| flash-lite|paddle | 12 | 3.08 | 3 | 0 / 4 / 3 / 5 / 0 | 0 | 41.7 | 33.3 | 50 | 50 | 0 | 58.3 |
| opus|gemini | 12 | 4.92 | 5 | 0 / 0 / 0 / 1 / 11 | 91.7 | 100 | 0 | 0 | 0 | 0 | 0 |
| opus|paddle | 12 | 5 | 5 | 0 / 0 / 0 / 0 / 12 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |

## By language
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|


## By translation model arm (unpaired: different pages per arm, model follows the book)
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|


## By language × arm
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|


## By period
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|


## By arm / prompt label
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|


## Script class
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|


## Defect types (primary judge, main items)
| type/severity | n |
|---|---:|


## Worst 25 (primary judge)
| fidelity | language | arm | flags | url | reason |
|---:|---|---|---|---|---|

