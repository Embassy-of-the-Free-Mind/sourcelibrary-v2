# Translation corpus audit — translation-corpus-audit-2026-09-30

Judge: opus (source-grounded, reference-free, single candidate; measure = judge rating, NOT accuracy). 311 pages from 311 books, one interior page per book, seed 20260930.

**Controls gate: PASS** (swap ≥ 93% rated ≤2, drop ≥ 87% flagged omission, repeat ≥ 93% within one; ≥ 10 of each).

## Controls (read first)
- swap (translation of another page): 15/15 rated ≤2, 15/15 flagged wrong_page
- drop (middle ~35% removed): 15/15 flagged omission, 15/15 rated ≤3
- repeat (same item twice): 11/15 exact, 15/15 within 1, 13/15 identical flags

## Corpus estimate (post-stratified by language; 95% CI)
| statistic | est % | CI |
|---|---:|---|
| fidelity 5 | 41.4 | 35.4–47.8 |
| fidelity ≥ 4 | 89.1 | 85.5–92.5 |
| fidelity ≤ 2 | 3.4 | 1.5–5.8 |
| any major defect | 11.4 | 7.6–15.6 |
| omission | 14.8 | 10.4–19.6 |
| invention | 11.2 | 7.6–15.1 |
| inversion | 3.9 | 1.4–6.8 |
| untranslated | 0 | 0–0 |
| wrong_language | 0 | 0–0 |
| wrong_page | 0.4 | 0–1.3 |
| garble_passthrough | 6.6 | 4–9.6 |
| truncated | 0 | 0–0.1 |
| repetition | 0 | 0–0 |

## By language
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin | 60 | 4.25 | 4 | 0 / 1 / 3 / 36 / 20 | 33.3 | 93.3 | 1.7 | 16.7 | 6.7 | 0 | 10 |
| English | 36 | 4.33 | 5 | 2 / 0 / 1 / 14 / 19 | 52.8 | 91.7 | 5.6 | 13.9 | 19.4 | 0 | 8.3 |
| German | 36 | 4.56 | 5 | 0 / 0 / 1 / 14 / 21 | 58.3 | 97.2 | 0 | 11.1 | 8.3 | 0 | 5.6 |
| Greek | 36 | 3.89 | 4 | 1 / 3 / 5 / 17 / 10 | 27.8 | 75 | 11.1 | 22.2 | 19.4 | 0 | 22.2 |
| French | 24 | 4.54 | 5 | 0 / 0 / 1 / 9 / 14 | 58.3 | 95.8 | 0 | 0 | 8.3 | 0 | 4.2 |
| Italian | 18 | 4.44 | 5 | 0 / 0 / 2 / 6 / 10 | 55.6 | 88.9 | 0 | 5.6 | 11.1 | 0 | 11.1 |
| Dutch | 18 | 4.44 | 5 | 0 / 0 / 3 / 4 / 11 | 61.1 | 83.3 | 0 | 5.6 | 11.1 | 0 | 16.7 |
| Chinese | 18 | 3.94 | 4 | 0 / 2 / 2 / 9 / 5 | 27.8 | 77.8 | 11.1 | 5.6 | 22.2 | 0 | 16.7 |
| Sanskrit | 12 | 3.5 | 3.5 | 0 / 1 / 5 / 5 / 1 | 8.3 | 50 | 8.3 | 58.3 | 16.7 | 0 | 41.7 |
| Hebrew | 12 | 4.25 | 5 | 0 / 2 / 0 / 3 / 7 | 58.3 | 83.3 | 16.7 | 25 | 8.3 | 0 | 16.7 |
| Arabic | 12 | 4.25 | 4.5 | 0 / 0 / 3 / 3 / 6 | 50 | 75 | 0 | 16.7 | 0 | 0 | 0 |
| Tibetan | 11 | 3.91 | 4 | 0 / 0 / 4 / 4 / 3 | 27.3 | 63.6 | 0 | 27.3 | 0 | 0 | 27.3 |
| Korean | 6 | 3.5 | 3.5 | 0 / 0 / 3 / 3 / 0 | 0 | 50 | 0 | 0 | 16.7 | 0 | 33.3 |
| Spanish | 6 | 4.33 | 4 | 0 / 0 / 0 / 4 / 2 | 33.3 | 100 | 0 | 0 | 0 | 0 | 0 |
| Japanese | 6 | 3.83 | 4 | 0 / 1 / 1 / 2 / 2 | 33.3 | 66.7 | 16.7 | 0 | 16.7 | 0 | 33.3 |

## By translation model arm (unpaired: different pages per arm, model follows the book)
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite | 154 | 4.15 | 4 | 2 / 4 / 21 / 69 / 58 | 37.7 | 82.5 | 3.9 | 20.1 | 8.4 | 0 | 18.2 |
| flash | 157 | 4.29 | 4 | 1 / 6 / 13 / 64 / 73 | 46.5 | 87.3 | 4.5 | 8.9 | 14.6 | 0 | 8.9 |

## By language × arm
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin / lite | 30 | 4.13 | 4 | 0 / 1 / 3 / 17 / 9 | 30 | 86.7 | 3.3 | 30 | 3.3 | 0 | 20 |
| Latin / flash | 30 | 4.37 | 4 | 0 / 0 / 0 / 19 / 11 | 36.7 | 100 | 0 | 3.3 | 10 | 0 | 0 |
| English / flash | 18 | 4.33 | 4.5 | 1 / 0 / 0 / 8 / 9 | 50 | 94.4 | 5.6 | 5.6 | 27.8 | 0 | 5.6 |
| English / lite | 18 | 4.33 | 5 | 1 / 0 / 1 / 6 / 10 | 55.6 | 88.9 | 5.6 | 22.2 | 11.1 | 0 | 11.1 |
| German / lite | 18 | 4.44 | 4.5 | 0 / 0 / 1 / 8 / 9 | 50 | 94.4 | 0 | 11.1 | 11.1 | 0 | 11.1 |
| German / flash | 18 | 4.67 | 5 | 0 / 0 / 0 / 6 / 12 | 66.7 | 100 | 0 | 11.1 | 5.6 | 0 | 0 |
| Greek / flash | 18 | 4.06 | 4 | 0 / 2 / 2 / 7 / 7 | 38.9 | 77.8 | 11.1 | 16.7 | 22.2 | 0 | 16.7 |
| Greek / lite | 18 | 3.72 | 4 | 1 / 1 / 3 / 10 / 3 | 16.7 | 72.2 | 11.1 | 27.8 | 16.7 | 0 | 27.8 |
| French / flash | 12 | 4.67 | 5 | 0 / 0 / 0 / 4 / 8 | 66.7 | 100 | 0 | 0 | 16.7 | 0 | 0 |
| French / lite | 12 | 4.42 | 4.5 | 0 / 0 / 1 / 5 / 6 | 50 | 91.7 | 0 | 0 | 0 | 0 | 8.3 |
| Italian / lite | 9 | 4.44 | 5 | 0 / 0 / 1 / 3 / 5 | 55.6 | 88.9 | 0 | 0 | 11.1 | 0 | 11.1 |
| Italian / flash | 9 | 4.44 | 5 | 0 / 0 / 1 / 3 / 5 | 55.6 | 88.9 | 0 | 11.1 | 11.1 | 0 | 11.1 |
| Dutch / lite | 9 | 4.11 | 4 | 0 / 0 / 3 / 2 / 4 | 44.4 | 66.7 | 0 | 11.1 | 22.2 | 0 | 33.3 |
| Dutch / flash | 9 | 4.78 | 5 | 0 / 0 / 0 / 2 / 7 | 77.8 | 100 | 0 | 0 | 0 | 0 | 0 |
| Chinese / flash | 9 | 3.89 | 4 | 0 / 1 / 1 / 5 / 2 | 22.2 | 77.8 | 11.1 | 11.1 | 33.3 | 0 | 22.2 |
| Chinese / lite | 9 | 4 | 4 | 0 / 1 / 1 / 4 / 3 | 33.3 | 77.8 | 11.1 | 0 | 11.1 | 0 | 11.1 |
| Sanskrit / flash | 6 | 3.5 | 3.5 | 0 / 1 / 2 / 2 / 1 | 16.7 | 50 | 16.7 | 16.7 | 16.7 | 0 | 33.3 |
| Sanskrit / lite | 6 | 3.5 | 3.5 | 0 / 0 / 3 / 3 / 0 | 0 | 50 | 0 | 100 | 16.7 | 0 | 50 |
| Hebrew / lite | 6 | 4.33 | 5 | 0 / 1 / 0 / 1 / 4 | 66.7 | 83.3 | 16.7 | 16.7 | 0 | 0 | 16.7 |
| Hebrew / flash | 6 | 4.17 | 4.5 | 0 / 1 / 0 / 2 / 3 | 50 | 83.3 | 16.7 | 33.3 | 16.7 | 0 | 16.7 |
| Arabic / lite | 6 | 4.33 | 4.5 | 0 / 0 / 1 / 2 / 3 | 50 | 83.3 | 0 | 16.7 | 0 | 0 | 0 |
| Arabic / flash | 6 | 4.17 | 4.5 | 0 / 0 / 2 / 1 / 3 | 50 | 66.7 | 0 | 16.7 | 0 | 0 | 0 |
| Tibetan / flash | 5 | 4 | 4 | 0 / 0 / 2 / 1 / 2 | 40 | 60 | 0 | 20 | 0 | 0 | 20 |
| Tibetan / lite | 6 | 3.83 | 4 | 0 / 0 / 2 / 3 / 1 | 16.7 | 66.7 | 0 | 33.3 | 0 | 0 | 33.3 |
| Korean / flash | 5 | 3.4 | 3 | 0 / 0 / 3 / 2 / 0 | 0 | 40 | 0 | 0 | 20 | 0 | 40 |
| Korean / lite | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |
| Spanish / lite | 3 | 4 | 4 | 0 / 0 / 0 / 3 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |
| Spanish / flash | 3 | 4.67 | 5 | 0 / 0 / 0 / 1 / 2 | 66.7 | 100 | 0 | 0 | 0 | 0 | 0 |
| Japanese / flash | 3 | 3.67 | 4 | 0 / 1 / 0 / 1 / 1 | 33.3 | 66.7 | 33.3 | 0 | 33.3 | 0 | 33.3 |
| Japanese / lite | 3 | 4 | 4 | 0 / 0 / 1 / 1 / 1 | 33.3 | 66.7 | 0 | 0 | 0 | 0 | 33.3 |

## By period
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| pre-1500 | 28 | 3.86 | 4 | 0 / 1 / 6 / 17 / 4 | 14.3 | 75 | 3.6 | 28.6 | 3.6 | 0 | 25 |
| 1600s | 54 | 4.22 | 4 | 0 / 2 / 4 / 28 / 20 | 37 | 88.9 | 3.7 | 14.8 | 9.3 | 0 | 9.3 |
| unknown | 36 | 4.03 | 4 | 0 / 3 / 6 / 14 / 13 | 36.1 | 75 | 8.3 | 11.1 | 13.9 | 0 | 13.9 |
| 1800s | 47 | 4.02 | 4 | 2 / 2 / 6 / 20 / 17 | 36.2 | 78.7 | 8.5 | 17 | 21.3 | 0 | 21.3 |
| 1500s | 48 | 4.35 | 4 | 0 / 0 / 4 / 23 / 21 | 43.8 | 91.7 | 0 | 8.3 | 2.1 | 0 | 6.3 |
| 1700s | 56 | 4.54 | 5 | 0 / 1 / 4 / 15 / 36 | 64.3 | 91.1 | 1.8 | 5.4 | 14.3 | 0 | 10.7 |
| 1900+ | 42 | 4.26 | 4 | 1 / 1 / 4 / 16 / 20 | 47.6 | 85.7 | 4.8 | 23.8 | 14.3 | 0 | 14.3 |

## By arm / prompt label
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite/11 | 54 | 4.11 | 4 | 0 / 0 / 12 / 24 / 18 | 33.3 | 77.8 | 0 | 22.2 | 5.6 | 0 | 24.1 |
| lite/v1 | 16 | 4.19 | 4 | 1 / 0 / 1 / 7 / 7 | 43.8 | 87.5 | 6.3 | 25 | 12.5 | 0 | 12.5 |
| lite/v10 | 78 | 4.18 | 4 | 0 / 4 / 7 / 38 / 29 | 37.2 | 85.9 | 5.1 | 17.9 | 9 | 0 | 14.1 |
| flash/v1 | 6 | 4.17 | 4 | 0 / 0 / 0 / 5 / 1 | 16.7 | 100 | 0 | 16.7 | 0 | 0 | 0 |
| flash/v10 | 28 | 4.29 | 4 | 0 / 1 / 0 / 17 / 10 | 35.7 | 96.4 | 3.6 | 14.3 | 25 | 0 | 3.6 |
| flash/v5.2026-02 | 8 | 4.5 | 4.5 | 0 / 0 / 0 / 4 / 4 | 50 | 100 | 0 | 0 | 25 | 0 | 0 |
| flash/v2 | 74 | 4.42 | 5 | 1 / 3 / 3 / 24 / 43 | 58.1 | 90.5 | 5.4 | 4.1 | 12.2 | 0 | 6.8 |
| flash/v5.1.2026-03b | 8 | 4.38 | 4.5 | 0 / 0 / 1 / 3 / 4 | 50 | 87.5 | 0 | 12.5 | 0 | 0 | 12.5 |
| flash/v5.1.2026-03c | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |
| lite/1 | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/11 | 22 | 3.86 | 4 | 0 / 2 / 6 / 7 / 7 | 31.8 | 63.6 | 9.1 | 18.2 | 13.6 | 0 | 27.3 |
| lite/v0 | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| lite/v11-retx | 1 | 1 | 1 | 1 / 0 / 0 / 0 / 0 | 0 | 0 | 100 | 0 | 100 | 0 | 100 |
| flash/12 | 3 | 4.67 | 5 | 0 / 0 / 0 / 1 / 2 | 66.7 | 100 | 0 | 0 | 33.3 | 0 | 0 |
| lite/13 | 3 | 4.33 | 5 | 0 / 0 / 1 / 0 / 2 | 66.7 | 66.7 | 0 | 33.3 | 0 | 0 | 33.3 |
| flash/13 | 7 | 3.86 | 4 | 0 / 0 / 3 / 2 / 2 | 28.6 | 57.1 | 0 | 14.3 | 14.3 | 0 | 14.3 |

## Script class
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| latin-script | 198 | 4.39 | 4 | 2 / 1 / 11 / 87 / 97 | 49 | 92.9 | 1.5 | 10.6 | 10.1 | 0 | 8.6 |
| non-latin-script | 113 | 3.91 | 4 | 1 / 9 / 23 / 46 / 34 | 30.1 | 70.8 | 8.8 | 21.2 | 14.2 | 0 | 22.1 |

## Defect types (primary judge, main items)
| type/severity | n |
|---|---:|
| mistranslation/minor | 153 |
| omission/minor | 44 |
| terminology/minor | 36 |
| invention/minor | 33 |
| garble_passthrough/minor | 17 |
| invention/major | 15 |
| garble_passthrough/major | 15 |
| name/minor | 12 |
| inversion/minor | 7 |
| omission/major | 6 |
| number/minor | 6 |
| mistranslation/major | 5 |
| inversion/major | 3 |
| number/major | 2 |
| terminology/major | 2 |
| wrong_page/major | 1 |
| truncated/major | 1 |
| truncated/minor | 1 |

## Inter-judge agreement (opus vs sonnet, n=107)
exact 67.3%, within 1: 100%, mean(primary−second) 0.1. Second judge controls: swap caught 5/5, drop flagged 5/5.

| flag | agree % | primary + | second + |
|---|---:|---:|---:|
| omission | 87.9 | 13 | 14 |
| invention | 93.5 | 9 | 16 |
| inversion | 98.1 | 4 | 4 |
| untranslated | 100 | 0 | 0 |
| wrong_language | 100 | 0 | 0 |
| wrong_page | 100 | 0 | 0 |
| garble_passthrough | 96.3 | 7 | 5 |
| truncated | 100 | 0 | 0 |
| repetition | 100 | 0 | 0 |

## Worst 25 (primary judge)
| fidelity | language | arm | flags | url | reason |
|---:|---|---|---|---|---|
| 1 | English | lite | omission, wrong_page | https://sourcelibrary.org/book/69e41fab4fc48a88423e0693?page=26 | Output is the text of a different page of the same book; none of the source's content (Jammu, night scenes, Gaurakarī Rāginī, footnotes on Ṭākrī script) appears |
| 1 | English | flash | invention | https://sourcelibrary.org/book/69905c92aaa7f10ed4cfc5ab?page=136 | Page is a title plate 'I LISTEN.'; nearly all of the translation is an imported meditation absent from the source |
| 1 | Greek | lite | invention, garble_passthrough | https://sourcelibrary.org/book/6a3eb56b5598be95b4ffddeb?page=328 | Source text is illegible ('[...]'); translation fabricates a paragraph of Epicurean theology. |
| 2 | Latin | lite | inversion | https://sourcelibrary.org/book/69b00f50f0043345da767c05?page=540 | Every continental measurement is mis-converted and the two comparison clauses (Europe vs Asia, Europe vs Africa) are wrong in sense and subject; the final fractions are right. |
| 2 | Greek | lite | invention | https://sourcelibrary.org/book/6993773eb0a84a5763963366?page=190 | the source's two paragraphs are rendered faithfully, but more than half the output is imported text from following pages (Arrian remark, manuscript collation lists) |
| 2 | Greek | flash | omission, invention | https://sourcelibrary.org/book/6a45298cc6d95bc278fbc8c3?page=300 | Diodorus gold-mine passage: topic (mills, grinding, boards, water) survives but most sentences are wrong or invented |
| 2 | Greek | flash | garble_passthrough | https://sourcelibrary.org/book/69a5e5e985fa13e734e41cba?page=153 | follows the words of an unreadable OCR but papers over the garble with fluent, confidently annotated prose the source cannot support |
| 2 | Chinese | flash | invention, garble_passthrough | https://sourcelibrary.org/book/6992cad3d4d545ae73feeb78?page=1 | The OCR is mostly unreadable Vinaya text; the translation papers over it with a coherent Kaṭhina/sīmā exposition and an invented 15-item structure that the page cannot support. |
| 2 | Chinese | lite | invention | https://sourcelibrary.org/book/69af0ea2067c0c26ee26e607?page=63 | Rendering of the extant text is close, but the translation completes the calculation with several invented sums that go beyond the page's last words |
| 2 | Sanskrit | flash | inversion | https://sourcelibrary.org/book/69907c595f855ec553e74a1b?page=16 | the page's single legible sentence contains 'na hi smaret' (should not remember), which the translation turns into a positive injunction |
| 2 | Hebrew | lite | omission, garble_passthrough | https://sourcelibrary.org/book/69c1bc118522835be84615e9?page=20 | Source OCR is mostly nonsense Hebrew; translation papers over it with fluent word-by-word prose and a confident summary, eliding the worst spans with ellipses. |
| 2 | Hebrew | flash | invention, garble_passthrough | https://sourcelibrary.org/book/69c7b0ec25ec2ba5ccd7f3f3?page=51 | only scattered anchors (Jacob, David king of Israel, Lech Lecha daf 82, table/bread/grace after meals) are real; the rest is confident prose over garbled Rashi-script OCR |
| 2 | Japanese | flash | garble_passthrough | https://sourcelibrary.org/book/6a08a3b48fae3d3f19b7903d?page=10 | OCR is largely broken kuzushiji; translation turns it into fluent narrative sentence by sentence; chapter title 十七 袖のむさし and Akuta-gawa reference are supported, much else is not. |
| 3 | Latin | lite | omission | https://sourcelibrary.org/book/6a26bff70e247ebad6def422?page=8 | Sections VIII–X (demonic magic by signs, Cush/Zoroaster, no white magic) = source, but the first paragraph on prohibiting magic vs medicine is dropped |
| 3 | Latin | lite | omission, inversion, garble_passthrough | https://sourcelibrary.org/book/69dbcbdc1040d1d5e20bb0df?page=158 | Nile-source narrative and Anaxagoras' theory broadly = source, but the second fire theory is inverted ('Others do not judge that fire is the cause'), the foot/boat pair is halved, and garbled 'calmata |
| 3 | Latin | lite | omission | https://sourcelibrary.org/book/6a08531b15c643eb1af4ebdc?page=590 | The rest follows the commentary well (Caesar's letters, Quintus, Terentia's will, Camillus with book/page refs), but the first sentence and a lemma are dropped |
| 3 | English | lite | invention | https://sourcelibrary.org/book/69ee475f6dd925d126f421de?page=494 | Vigils passage, Borrowed Days proverb, weekday rhyme, Hooker and Moresin rendered faithfully, but an entire authorial sentence is invented to complete the broken line |
| 3 | German | lite | omission, invention, garble_passthrough | https://sourcelibrary.org/book/69bda0a2f6d63c9197489271?page=575 | First column rendered faithfully; the fragmentary second column is filled with a fluent reconstructed paragraph that is not in the source. |
| 3 | Greek | lite | omission, inversion | https://sourcelibrary.org/book/69942e1dd607f8e57e4b76fc?page=537 | Main argument (book full of such things, fair hearing for the absent author, reason and conscience as judges) = source, but drops the page's opening clause and garbles the διαφυγεῖν and οὐ πρὶν clause |
| 3 | Greek | lite |  | https://sourcelibrary.org/book/6a08573115c643eb1af5aeae?page=81 | Pindar Ol. 10 gist kept, but the Cycnus clause is wrong and several clauses reshaped |
| 3 | Greek | flash | inversion, garble_passthrough | https://sourcelibrary.org/book/699439cd6879ff0184cb9235?page=109 | Heavily corrupt OCR of a Proclus-style text; readable passages (self-reversion, unparticipated intellect, soul as middle life, many-headed beast/lion) are right, but garbled spans are papered over wit |
| 3 | Greek | lite | garble_passthrough | https://sourcelibrary.org/book/6993895dce15387065946a95?page=331 | follows the OCR sentence by sentence (neighbours, securing cities, marketplace, vetting agents) but smooths many corrupt spans into confident claims; Greek OCR here is weak |
| 3 | Greek | flash | invention, garble_passthrough | https://sourcelibrary.org/book/69a5e3e5006a40984221691d?page=108 | heavily garbled Byzantine lexicon OCR rendered gloss-by-gloss mostly literally, but some garble is smoothed into confident sense and notes import Marcus Aurelius/Stoic claims absent from the page; Gre |
| 3 | French | lite | garble_passthrough | https://sourcelibrary.org/book/69f32f7f876dd827cbc45808?page=193 | Recoverable spans (Hathewey plea, John de Berne's Quare impedit, grandfather Philip seised, clerk William, bishop of Salisbury, inquest finding John true patron) track the source, but much garble is p |
| 3 | Italian | lite | invention | https://sourcelibrary.org/book/6a357e822aadc65cf0906d5f?page=290 | XL and XLI rendered accurately from the Italian; XLII is completed with several sentences that are not on the page (likely imported from the next page); footnotes dropped. |
