# Translation corpus audit — translation-on-7866-draw

Judge: opus (source-grounded, reference-free, single candidate; measure = judge rating, NOT accuracy). 481 pages from 102 books, one interior page per book, seed 7968.

**Controls gate: PASS** (swap ≥ 93% rated ≤2, drop ≥ 87% flagged omission, repeat ≥ 93% within one; ≥ 10 of each).

## Controls (read first)
- swap (translation of another page): 15/15 rated ≤2, 15/15 flagged wrong_page
- drop (middle ~35% removed): 15/15 flagged omission, 15/15 rated ≤3
- repeat (same item twice): 13/15 exact, 15/15 within 1, 12/15 identical flags

## Corpus estimate (post-stratified by language; 95% CI)
| statistic | est % | CI |
|---|---:|---|
| fidelity 5 | 39.7 | 35.5–43.9 |
| fidelity ≥ 4 | 85.1 | 82.3–87.8 |
| fidelity ≤ 2 | 4.5 | 2.8–6.3 |
| any major defect | 14.9 | 12.2–17.8 |
| omission | 16.2 | 13–19.6 |
| invention | 15.6 | 12.6–18.6 |
| inversion | 3.3 | 1.7–5 |
| untranslated | 0 | 0–0 |
| wrong_language | 0 | 0–0 |
| wrong_page | 0.5 | 0–1.3 |
| garble_passthrough | 9.7 | 7.5–12.1 |
| truncated | 0.2 | 0–0.5 |
| repetition | 0 | 0–0 |

## By language
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin | 125 | 4.26 | 4 | 1 / 4 / 6 / 64 / 50 | 40 | 91.2 | 4 | 17.6 | 8 | 0 | 9.6 |
| Chinese | 66 | 3.92 | 4 | 0 / 5 / 14 / 28 / 19 | 28.8 | 71.2 | 7.6 | 13.6 | 27.3 | 0 | 28.8 |
| German | 64 | 4.39 | 5 | 1 / 1 / 5 / 22 / 35 | 54.7 | 89.1 | 3.1 | 15.6 | 14.1 | 0 | 12.5 |
| English | 46 | 4.63 | 5 | 0 / 1 / 1 / 12 / 32 | 69.6 | 95.7 | 2.2 | 15.2 | 19.6 | 0 | 4.3 |
| Tibetan | 37 | 4.24 | 4 | 0 / 0 / 2 / 24 / 11 | 29.7 | 94.6 | 0 | 16.2 | 8.1 | 0 | 5.4 |
| Greek | 30 | 4.03 | 4 | 0 / 0 / 6 / 17 / 7 | 23.3 | 80 | 0 | 16.7 | 13.3 | 0 | 16.7 |
| Sanskrit | 15 | 3 | 3 | 0 / 4 / 7 / 4 / 0 | 0 | 26.7 | 26.7 | 60 | 40 | 0 | 73.3 |
| French | 15 | 4.73 | 5 | 0 / 0 / 0 / 4 / 11 | 73.3 | 100 | 0 | 6.7 | 13.3 | 0 | 0 |
| Russian | 15 | 4.27 | 4 | 0 / 1 / 1 / 6 / 7 | 46.7 | 86.7 | 6.7 | 26.7 | 6.7 | 0 | 26.7 |
| Korean | 13 | 3.08 | 3 | 0 / 5 / 3 / 4 / 1 | 7.7 | 38.5 | 38.5 | 7.7 | 61.5 | 0 | 61.5 |
| Arabic | 10 | 3.7 | 4 | 0 / 0 / 3 / 7 / 0 | 0 | 70 | 0 | 10 | 0 | 0 | 10 |
| Armenian | 10 | 3.7 | 4 | 0 / 0 / 3 / 7 / 0 | 0 | 70 | 0 | 0 | 50 | 0 | 40 |
| Italian | 10 | 4.2 | 4 | 0 / 0 / 0 / 8 / 2 | 20 | 100 | 0 | 10 | 0 | 0 | 0 |
| Danish | 5 | 4.6 | 5 | 0 / 0 / 0 / 2 / 3 | 60 | 100 | 0 | 0 | 0 | 0 | 0 |
| Demotic | 5 | 4 | 4 | 0 / 0 / 0 / 5 / 0 | 0 | 100 | 0 | 40 | 40 | 0 | 0 |
| Yucatec Maya | 5 | 3.2 | 3 | 0 / 0 / 4 / 1 / 0 | 0 | 20 | 0 | 0 | 60 | 0 | 20 |
| Latin-English | 5 | 5 | 5 | 0 / 0 / 0 / 0 / 5 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Dutch | 5 | 4 | 4 | 0 / 0 / 0 / 5 / 0 | 0 | 100 | 0 | 0 | 20 | 0 | 0 |

## By translation model arm (unpaired: different pages per arm, model follows the book)
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite | 228 | 4.15 | 4 | 2 / 10 / 19 / 117 / 80 | 35.1 | 86.4 | 5.3 | 21.9 | 10.1 | 0 | 15.4 |
| flash | 218 | 4.15 | 4 | 0 / 11 / 31 / 91 / 85 | 39 | 80.7 | 5 | 12.8 | 24.3 | 0 | 18.3 |
| agy-flash | 25 | 4.52 | 5 | 0 / 0 / 1 / 10 / 14 | 56 | 96 | 0 | 0 | 4 | 0 | 4 |
| opus | 5 | 4.8 | 5 | 0 / 0 / 0 / 1 / 4 | 80 | 100 | 0 | 0 | 20 | 0 | 0 |
| argon | 5 | 3.2 | 3 | 0 / 0 / 4 / 1 / 0 | 0 | 20 | 0 | 0 | 60 | 0 | 20 |

## By language × arm
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin / lite | 95 | 4.17 | 4 | 1 / 3 / 4 / 58 / 29 | 30.5 | 91.6 | 4.2 | 22.1 | 6.3 | 0 | 9.5 |
| Latin / flash | 30 | 4.57 | 5 | 0 / 1 / 2 / 6 / 21 | 70 | 90 | 3.3 | 3.3 | 13.3 | 0 | 10 |
| English / lite | 19 | 4.47 | 5 | 0 / 1 / 1 / 5 / 12 | 63.2 | 89.5 | 5.3 | 31.6 | 10.5 | 0 | 10.5 |
| English / flash | 27 | 4.74 | 5 | 0 / 0 / 0 / 7 / 20 | 74.1 | 100 | 0 | 3.7 | 25.9 | 0 | 0 |
| Chinese / flash | 37 | 3.41 | 4 | 0 / 5 / 13 / 18 / 1 | 2.7 | 51.4 | 13.5 | 24.3 | 45.9 | 0 | 48.6 |
| Chinese / agy-flash | 24 | 4.54 | 5 | 0 / 0 / 1 / 9 / 14 | 58.3 | 95.8 | 0 | 0 | 0 | 0 | 4.2 |
| Chinese / opus | 5 | 4.8 | 5 | 0 / 0 / 0 / 1 / 4 | 80 | 100 | 0 | 0 | 20 | 0 | 0 |
| Greek / lite | 20 | 4.15 | 4 | 0 / 0 / 4 / 9 / 7 | 35 | 80 | 0 | 15 | 0 | 0 | 15 |
| Greek / flash | 9 | 3.78 | 4 | 0 / 0 / 2 / 7 / 0 | 0 | 77.8 | 0 | 22.2 | 33.3 | 0 | 22.2 |
| Greek / agy-flash | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 100 | 0 | 0 |
| Tibetan / flash | 37 | 4.24 | 4 | 0 / 0 / 2 / 24 / 11 | 29.7 | 94.6 | 0 | 16.2 | 8.1 | 0 | 5.4 |
| Sanskrit / lite | 5 | 2.2 | 2 | 0 / 4 / 1 / 0 / 0 | 0 | 0 | 80 | 100 | 20 | 0 | 100 |
| Sanskrit / flash | 10 | 3.4 | 3 | 0 / 0 / 6 / 4 / 0 | 0 | 40 | 0 | 40 | 50 | 0 | 60 |
| German / lite | 39 | 4.13 | 4 | 1 / 1 / 5 / 17 / 15 | 38.5 | 82.1 | 5.1 | 25.6 | 17.9 | 0 | 20.5 |
| German / flash | 25 | 4.8 | 5 | 0 / 0 / 0 / 5 / 20 | 80 | 100 | 0 | 0 | 8 | 0 | 0 |
| French / flash | 10 | 4.6 | 5 | 0 / 0 / 0 / 4 / 6 | 60 | 100 | 0 | 10 | 20 | 0 | 0 |
| French / lite | 5 | 5 | 5 | 0 / 0 / 0 / 0 / 5 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Korean / flash | 13 | 3.08 | 3 | 0 / 5 / 3 / 4 / 1 | 7.7 | 38.5 | 38.5 | 7.7 | 61.5 | 0 | 61.5 |
| Arabic / flash | 10 | 3.7 | 4 | 0 / 0 / 3 / 7 / 0 | 0 | 70 | 0 | 10 | 0 | 0 | 10 |
| Russian / lite | 15 | 4.27 | 4 | 0 / 1 / 1 / 6 / 7 | 46.7 | 86.7 | 6.7 | 26.7 | 6.7 | 0 | 26.7 |
| Danish / lite | 5 | 4.6 | 5 | 0 / 0 / 0 / 2 / 3 | 60 | 100 | 0 | 0 | 0 | 0 | 0 |
| Demotic / flash | 5 | 4 | 4 | 0 / 0 / 0 / 5 / 0 | 0 | 100 | 0 | 40 | 40 | 0 | 0 |
| Armenian / lite | 10 | 3.7 | 4 | 0 / 0 / 3 / 7 / 0 | 0 | 70 | 0 | 0 | 50 | 0 | 40 |
| Italian / lite | 10 | 4.2 | 4 | 0 / 0 / 0 / 8 / 2 | 20 | 100 | 0 | 10 | 0 | 0 | 0 |
| Yucatec Maya / argon | 5 | 3.2 | 3 | 0 / 0 / 4 / 1 / 0 | 0 | 20 | 0 | 0 | 60 | 0 | 20 |
| Latin-English / flash | 5 | 5 | 5 | 0 / 0 / 0 / 0 / 5 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Dutch / lite | 5 | 4 | 4 | 0 / 0 / 0 / 5 / 0 | 0 | 100 | 0 | 0 | 20 | 0 | 0 |

## By period
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1501–1700 | 144 | 4.4 | 4 | 0 / 2 / 10 / 61 / 71 | 49.3 | 91.7 | 1.4 | 11.1 | 11.8 | 0 | 6.9 |
| after 1900 | 55 | 4.27 | 4 | 1 / 1 / 4 / 25 / 24 | 43.6 | 89.1 | 3.6 | 23.6 | 16.4 | 0 | 12.7 |
| no date | 129 | 3.88 | 4 | 0 / 10 / 23 / 69 / 27 | 20.9 | 74.4 | 7.8 | 16.3 | 23.3 | 0 | 24.8 |
| 1701–1900 | 101 | 4.22 | 4 | 1 / 6 / 13 / 31 / 50 | 49.5 | 80.2 | 6.9 | 16.8 | 18.8 | 0 | 22.8 |
| before 1501 | 52 | 4.04 | 4 | 0 / 2 / 5 / 34 / 11 | 21.2 | 86.5 | 3.8 | 21.2 | 11.5 | 0 | 9.6 |

## By arm / prompt label
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite/13 | 51 | 4.29 | 4 | 0 / 1 / 2 / 29 / 19 | 37.3 | 94.1 | 2 | 17.6 | 5.9 | 0 | 9.8 |
| lite/1 | 5 | 3.6 | 4 | 0 / 1 / 1 / 2 / 1 | 20 | 60 | 20 | 80 | 40 | 0 | 40 |
| flash/13 | 72 | 3.79 | 4 | 0 / 5 / 16 / 40 / 11 | 15.3 | 70.8 | 6.9 | 23.6 | 20.8 | 0 | 26.4 |
| lite/v10 | 98 | 4.15 | 4 | 2 / 4 / 8 / 47 / 37 | 37.8 | 85.7 | 6.1 | 18.4 | 9.2 | 0 | 15.3 |
| flash/v2 | 68 | 4.47 | 5 | 0 / 0 / 7 / 22 / 39 | 57.4 | 89.7 | 0 | 4.4 | 27.9 | 0 | 10.3 |
| flash/11 | 23 | 3.39 | 4 | 0 / 5 / 5 / 12 / 1 | 4.3 | 56.5 | 21.7 | 17.4 | 43.5 | 0 | 43.5 |
| agy-flash/13 | 24 | 4.54 | 5 | 0 / 0 / 1 / 9 / 14 | 58.3 | 95.8 | 0 | 0 | 0 | 0 | 4.2 |
| lite/11 | 51 | 3.88 | 4 | 0 / 4 / 8 / 29 / 10 | 19.6 | 76.5 | 7.8 | 33.3 | 15.7 | 0 | 25.5 |
| flash/v1 | 9 | 4.89 | 5 | 0 / 0 / 0 / 1 / 8 | 88.9 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/v5.2026-02 | 8 | 4.5 | 4.5 | 0 / 0 / 0 / 4 / 4 | 50 | 100 | 0 | 12.5 | 12.5 | 0 | 0 |
| lite/v1 | 8 | 4.63 | 5 | 0 / 0 / 0 / 3 / 5 | 62.5 | 100 | 0 | 25 | 0 | 0 | 0 |
| lite/2 | 10 | 4.5 | 4.5 | 0 / 0 / 0 / 5 / 5 | 50 | 100 | 0 | 0 | 10 | 0 | 0 |
| flash/3 | 5 | 4.8 | 5 | 0 / 0 / 0 / 1 / 4 | 80 | 100 | 0 | 0 | 0 | 0 | 0 |
| lite/v6 | 5 | 4.6 | 5 | 0 / 0 / 0 / 2 / 3 | 60 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/? | 6 | 3.83 | 4 | 0 / 0 / 1 / 5 / 0 | 0 | 83.3 | 0 | 16.7 | 50 | 0 | 16.7 |
| flash/v10 | 20 | 4.4 | 5 | 0 / 1 / 2 / 5 / 12 | 60 | 85 | 5 | 10 | 20 | 0 | 15 |
| opus/13 | 5 | 4.8 | 5 | 0 / 0 / 0 / 1 / 4 | 80 | 100 | 0 | 0 | 20 | 0 | 0 |
| argon/13 | 5 | 3.2 | 3 | 0 / 0 / 4 / 1 / 0 | 0 | 20 | 0 | 0 | 60 | 0 | 20 |
| flash/v12 | 5 | 4.8 | 5 | 0 / 0 / 0 / 1 / 4 | 80 | 100 | 0 | 0 | 20 | 0 | 0 |
| flash/v5.1.2026-03b | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| agy-flash/21 | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 100 | 0 | 0 |
| flash/v5.1.2026-03c | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |

## Script class
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| latin-script | 265 | 4.38 | 4 | 2 / 6 / 12 / 115 / 130 | 49.1 | 92.5 | 3 | 15.5 | 11.7 | 0 | 8.3 |
| non-latin-script | 216 | 3.91 | 4 | 0 / 15 / 43 / 105 / 53 | 24.5 | 73.1 | 6.9 | 17.1 | 23.1 | 0 | 25.5 |

## Defect types (primary judge, main items)
| type/severity | n |
|---|---:|
| mistranslation/minor | 268 |
| invention/minor | 83 |
| omission/minor | 65 |
| terminology/minor | 58 |
| garble_passthrough/minor | 42 |
| invention/major | 23 |
| omission/major | 23 |
| name/minor | 22 |
| number/minor | 19 |
| mistranslation/major | 17 |
| garble_passthrough/major | 17 |
| inversion/major | 8 |
| inversion/minor | 7 |
| number/major | 6 |
| terminology/major | 3 |
| name/major | 2 |
| wrong_page/major | 2 |
| truncated/major | 1 |
| untranslated/minor | 1 |

## Worst 25 (primary judge)
| fidelity | language | arm | flags | url | reason |
|---:|---|---|---|---|---|
| 1 | German | lite | omission, invention, wrong_page | https://sourcelibrary.org/book/69b51e05768235dc6598b5c1?page=16 | translation renders a different passage (the next page of the speech); none of the source's content (learned institutes, 'Karl der Geliebte', star of the first magnitude) appears |
| 1 | Latin | lite | omission, invention, wrong_page | https://sourcelibrary.org/book/69af49c4d6be7ec9cc3246fd?page=83 | Translation is of a different passage (head lice and Chapter V catarrh remedies); the source's ulcer remedies are entirely absent. |
| 2 | Sanskrit | lite | omission | https://sourcelibrary.org/book/69dea5f84d19ec2e9ba77e07?page=11 | verses 10–15 rendered faithfully apart from 'jitāsuḥ' as 'conquered his senses'; the commentary above and below the verses, roughly half the page, is dropped entirely; Sanskrit read moderately |
| 2 | Chinese | flash | garble_passthrough | https://sourcelibrary.org/book/6a3c648f39b4508b04e2814a?page=114 | repeat marks rendered literally as 'each and every one' make the first entry and many quotations nonsense; Feng Yi quotation garbled; later entries (五十難, 迫難) roughly right |
| 2 | Chinese | flash | omission | https://sourcelibrary.org/book/6a3c634a4daf85677d170c3e?page=123 | Each quoted line is roughly rendered, but from 雲咽 onward the headwords shift one entry against their citations, and four headwords are lost, so a reader learns the wrong compound for nearly every quot |
| 2 | Sanskrit | lite | omission, inversion | https://sourcelibrary.org/book/69dea5f84d19ec2e9ba77e07?page=33 | translates only the Bhagavata verses 25–33, loosely, and drops the whole commentary; v.33 'did not comprehend' inverted to 'attained this knowledge'; v.30 Hara clause and v.28 list dropped |
| 2 | Russian | lite | omission, truncated | https://sourcelibrary.org/book/69af202426ba85fcaeca5f8d?page=86 | First column rendered accurately, but the whole second column (about half the page) is absent |
| 2 | Korean | flash | invention, garble_passthrough | https://sourcelibrary.org/book/69f3273552a77bb28fdb6f93?page=27 | builds a fluent narrative (Choi clan woman, funeral, procession, 'Hyeon-ha' title) on a garbled transcription the source cannot support; only the Yeong dismissal and Nang-wang's arrogance track the so |
| 2 | German | lite | omission, invention | https://sourcelibrary.org/book/6a243d6f0f0e4f405e630221?page=13 | §9's opening is faithful, but the footnote is dropped and replaced by invented continuation text. |
| 2 | English | lite | omission, invention | https://sourcelibrary.org/book/69b99d166ed9e04909908b37?page=28 | Opening sentence and footnotes are dropped, and the second triad is completed from text that is not on this page. |
| 2 | Sanskrit | lite | omission | https://sourcelibrary.org/book/69dea5f84d19ec2e9ba77e07?page=16 | only the mūla verses 35–38 and ch.3 vv.1–2 are translated; roughly half the page (Śrīdhara commentary) is missing |
| 2 | Latin | flash | invention | https://sourcelibrary.org/book/69c4ec33a3a4a7c546ee6113?page=100 | pp. 188-189 rendered accurately, but about as much again of text from later pages is added after 'How wise'; that is imported content. |
| 2 | Latin | lite | omission | https://sourcelibrary.org/book/6a43999ec3ccb765a984106b?page=40 | What is translated (Clermont theses on infallibility, §24 on the Catechismus Gratiae 1650) is accurate, but the papal condemnation of Jansen's Augustinus and the 1661 Jesuit context that open the page |
| 2 | Chinese | flash | invention | https://sourcelibrary.org/book/6a3c64ab39b4508b04e28ee7?page=101 | The 熊虎狀, 毅狀 and 風雲狀 quotations are right, but the main headword 萬狀 is misunderstood across seven quotations and headings are invented. |
| 2 | Chinese | flash | invention, garble_passthrough | https://sourcelibrary.org/book/6a3c60d540c88a541d8eb14f?page=125 | The poets and titles are correct, but the lexicon's headword, which is the subject of the entry, is replaced throughout by an invented 'shanshan / field and mountain', so every quotation says somethin |
| 2 | Korean | flash | garble_passthrough | https://sourcelibrary.org/book/69f3273552a77bb28fdb6f93?page=52 | The source transcription is largely garble; the translation turns it into fluent but unsupported narrative (Dodang meeting wives, house of righteousness). My reading of the handwritten Korean is moder |
| 2 | Latin | lite | omission, invention, garble_passthrough | https://sourcelibrary.org/book/69dbca3a1040d1d5e20aa385?page=21 | Nutmeg and pepper are roughly right, but the rhaponticum/rhubarb chapter is misidentified with invented degrees, the pepper degrees and 'third class' are invented, and several clauses are misread. Abb |
| 2 | Korean | flash | invention, garble_passthrough | https://sourcelibrary.org/book/69f3296eaeeee0fa38c658ea?page=47 | The source is largely garble (repeated 츳). The translation turns it into fluent dialogue and adds a named speaker and a plot. Little of this is supportable. I read cursive Hangul weakly. |
| 2 | Sanskrit | lite | omission, invention | https://sourcelibrary.org/book/69dea5f84d19ec2e9ba77e07?page=46 | This is a loose summary of the opening commentary that drops verse 7's substance and all of the later commentary; I read the Sanskrit only moderately well |
| 2 | Korean | flash | invention, garble_passthrough | https://sourcelibrary.org/book/69f3273552a77bb28fdb6f93?page=51 | the source is a near-meaningless OCR string; the translation builds a coherent narrative of sacrifice, prosperity and wine that the source cannot support; my reading of this archaic hangul is weak |
| 2 | Korean | flash | invention, garble_passthrough | https://sourcelibrary.org/book/69f3296eaeeee0fa38c658ea?page=67 | The source is a garbled transcription of Korean cursive, and the translation turns it into fluent but unsupported sentences plus an invented summary. I read this handwritten script weakly. |
| 2 | Chinese | flash | omission, invention, garble_passthrough | https://sourcelibrary.org/book/6a3c60d540c88a541d8eb14f?page=72 | Only the 淵浩 and 淵曠 entries (Song shu, Qi shu, Wei shu Xu Zunming, Shen Yue) are rendered properly; a non-existent 'Yuan Chong' headword is invented and three entries are dropped. |
| 2 | Latin | lite |  | https://sourcelibrary.org/book/69dbc7d71040d1d5e2094b24?page=39 | Systematically renders ☋ (cauda draconis) as the zodiac sign in all four entries; also 'interfectionem' becomes 'intersection'. The ☊ and comet clauses are otherwise faithful. |
| 3 | English | lite | omission, invention | https://sourcelibrary.org/book/69b99d166ed9e04909908b37?page=107 | English-to-English; imports a clause from the previous page and drops a sentence, otherwise verbatim. |
| 3 | Chinese | flash |  | https://sourcelibrary.org/book/6a3c628e40c88a541d8f46a5?page=75 | Most compound entries are right (毗騫 kingdom, 騰騫, 低騫, 縶騫, 陳騫), but the whole 無騫 entry is misread as 'increase/decrease'. |
