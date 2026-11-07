# Translation corpus audit — translation-corpus-audit-monthly-2026-11

Judge: opus (source-grounded, reference-free, single candidate; measure = judge rating, NOT accuracy). 103 pages from 103 books, one interior page per book, seed 20261101.

**Controls gate: PASS** (swap ≥ 93% rated ≤2, drop ≥ 87% flagged omission, repeat ≥ 93% within one; ≥ 10 of each).

## Controls (read first)
- swap (translation of another page): 15/15 rated ≤2, 15/15 flagged wrong_page
- drop (middle ~35% removed): 15/15 flagged omission, 15/15 rated ≤3
- repeat (same item twice): 12/15 exact, 15/15 within 1, 10/15 identical flags

## Corpus estimate (post-stratified by language; 95% CI)
| statistic | est % | CI |
|---|---:|---|
| fidelity 5 | 46.8 | 36.3–57.3 |
| fidelity ≥ 4 | 86.1 | 78.2–92.8 |
| fidelity ≤ 2 | 0.6 | 0–1.4 |
| any major defect | 16 | 8.6–24.6 |
| omission | 11.5 | 6.5–17.5 |
| invention | 14.6 | 6.8–23.3 |
| inversion | 2.8 | 0–7.4 |
| untranslated | 0 | 0–0 |
| wrong_language | 0 | 0–0 |
| wrong_page | 0.6 | 0–1.4 |
| garble_passthrough | 9.6 | 3.7–16.7 |
| truncated | 0 | 0–0 |
| repetition | 0 | 0–0 |

## By language
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin | 19 | 4.21 | 4 | 0 / 0 / 3 / 9 / 7 | 36.8 | 84.2 | 0 | 5.3 | 26.3 | 0 | 21.1 |
| English | 12 | 4.42 | 5 | 0 / 0 / 2 / 3 / 7 | 58.3 | 83.3 | 0 | 25 | 8.3 | 0 | 16.7 |
| German | 12 | 4.75 | 5 | 0 / 0 / 0 / 3 / 9 | 75 | 100 | 0 | 0 | 8.3 | 0 | 0 |
| Greek | 12 | 4.17 | 4 | 0 / 0 / 1 / 8 / 3 | 25 | 91.7 | 0 | 50 | 8.3 | 0 | 16.7 |
| French | 8 | 4.75 | 5 | 0 / 0 / 0 / 2 / 6 | 75 | 100 | 0 | 0 | 12.5 | 0 | 0 |
| Italian | 6 | 4.5 | 5 | 0 / 0 / 1 / 1 / 4 | 66.7 | 83.3 | 0 | 16.7 | 16.7 | 0 | 16.7 |
| Dutch | 6 | 4.17 | 5 | 1 / 0 / 0 / 1 / 4 | 66.7 | 83.3 | 16.7 | 16.7 | 16.7 | 0 | 16.7 |
| Chinese | 6 | 4.5 | 5 | 0 / 0 / 1 / 1 / 4 | 66.7 | 83.3 | 0 | 0 | 0 | 0 | 16.7 |
| Sanskrit | 4 | 3.75 | 3.5 | 0 / 0 / 2 / 1 / 1 | 25 | 50 | 0 | 0 | 25 | 0 | 75 |
| Hebrew | 4 | 3.25 | 3 | 0 / 0 / 3 / 1 / 0 | 0 | 25 | 0 | 0 | 0 | 0 | 0 |
| Arabic | 4 | 3.75 | 3.5 | 0 / 0 / 2 / 1 / 1 | 25 | 50 | 0 | 0 | 0 | 0 | 25 |
| Tibetan | 4 | 4.25 | 4 | 0 / 0 / 0 / 3 / 1 | 25 | 100 | 0 | 0 | 0 | 0 | 0 |
| Korean | 2 | 3.5 | 3.5 | 0 / 0 / 1 / 1 / 0 | 0 | 50 | 0 | 50 | 0 | 0 | 50 |
| Spanish | 2 | 3.5 | 3.5 | 0 / 0 / 1 / 1 / 0 | 0 | 50 | 0 | 50 | 0 | 0 | 50 |
| Japanese | 2 | 2.5 | 2.5 | 1 / 0 / 0 / 1 / 0 | 0 | 50 | 50 | 100 | 50 | 0 | 100 |

## By translation model arm (unpaired: different pages per arm, model follows the book)
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite | 60 | 4.08 | 4 | 1 / 0 / 14 / 23 / 22 | 36.7 | 75 | 1.7 | 20 | 16.7 | 0 | 25 |
| flash | 38 | 4.39 | 5 | 1 / 0 / 3 / 13 / 21 | 55.3 | 89.5 | 2.6 | 10.5 | 7.9 | 0 | 10.5 |
| agy-flash | 5 | 4.8 | 5 | 0 / 0 / 0 / 1 / 4 | 80 | 100 | 0 | 0 | 0 | 0 | 0 |

## By language × arm
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin / lite | 17 | 4.18 | 4 | 0 / 0 / 3 / 8 / 6 | 35.3 | 82.4 | 0 | 5.9 | 23.5 | 0 | 23.5 |
| Latin / flash | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 0 | 50 | 0 | 0 |
| English / flash | 4 | 4.75 | 5 | 0 / 0 / 0 / 1 / 3 | 75 | 100 | 0 | 0 | 0 | 0 | 0 |
| English / lite | 8 | 4.25 | 4.5 | 0 / 0 / 2 / 2 / 4 | 50 | 75 | 0 | 37.5 | 12.5 | 0 | 25 |
| German / flash | 8 | 4.88 | 5 | 0 / 0 / 0 / 1 / 7 | 87.5 | 100 | 0 | 0 | 0 | 0 | 0 |
| German / lite | 4 | 4.5 | 4.5 | 0 / 0 / 0 / 2 / 2 | 50 | 100 | 0 | 0 | 25 | 0 | 0 |
| Greek / lite | 8 | 4 | 4 | 0 / 0 / 1 / 6 / 1 | 12.5 | 87.5 | 0 | 50 | 12.5 | 0 | 25 |
| Greek / flash | 4 | 4.5 | 4.5 | 0 / 0 / 0 / 2 / 2 | 50 | 100 | 0 | 50 | 0 | 0 | 0 |
| French / flash | 5 | 4.6 | 5 | 0 / 0 / 0 / 2 / 3 | 60 | 100 | 0 | 0 | 20 | 0 | 0 |
| French / lite | 3 | 5 | 5 | 0 / 0 / 0 / 0 / 3 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Italian / lite | 5 | 4.4 | 5 | 0 / 0 / 1 / 1 / 3 | 60 | 80 | 0 | 20 | 20 | 0 | 20 |
| Italian / flash | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Dutch / lite | 4 | 3.75 | 4.5 | 1 / 0 / 0 / 1 / 2 | 50 | 75 | 25 | 25 | 25 | 0 | 25 |
| Dutch / flash | 2 | 5 | 5 | 0 / 0 / 0 / 0 / 2 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Chinese / agy-flash | 5 | 4.8 | 5 | 0 / 0 / 0 / 1 / 4 | 80 | 100 | 0 | 0 | 0 | 0 | 0 |
| Chinese / flash | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 |
| Sanskrit / flash | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 |
| Sanskrit / lite | 3 | 4 | 4 | 0 / 0 / 1 / 1 / 1 | 33.3 | 66.7 | 0 | 0 | 33.3 | 0 | 66.7 |
| Hebrew / lite | 3 | 3 | 3 | 0 / 0 / 3 / 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Hebrew / flash | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |
| Arabic / lite | 2 | 3 | 3 | 0 / 0 / 2 / 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 | 50 |
| Arabic / flash | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 0 | 0 | 0 | 0 |
| Tibetan / flash | 4 | 4.25 | 4 | 0 / 0 / 0 / 3 / 1 | 25 | 100 | 0 | 0 | 0 | 0 | 0 |
| Korean / flash | 2 | 3.5 | 3.5 | 0 / 0 / 1 / 1 / 0 | 0 | 50 | 0 | 50 | 0 | 0 | 50 |
| Spanish / lite | 2 | 3.5 | 3.5 | 0 / 0 / 1 / 1 / 0 | 0 | 50 | 0 | 50 | 0 | 0 | 50 |
| Japanese / flash | 1 | 1 | 1 | 1 / 0 / 0 / 0 / 0 | 0 | 0 | 100 | 100 | 100 | 0 | 100 |
| Japanese / lite | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 100 | 0 | 0 | 100 |

## By period
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| pre-1500 | 7 | 3.43 | 3 | 0 / 0 / 5 / 1 / 1 | 14.3 | 28.6 | 0 | 14.3 | 28.6 | 0 | 71.4 |
| 1500s | 17 | 4.29 | 4 | 0 / 0 / 2 / 8 / 7 | 41.2 | 88.2 | 0 | 0 | 11.8 | 0 | 11.8 |
| 1600s | 15 | 4 | 4 | 2 / 0 / 0 / 7 / 6 | 40 | 86.7 | 13.3 | 20 | 13.3 | 0 | 13.3 |
| unknown | 16 | 4.06 | 4 | 0 / 0 / 5 / 5 / 6 | 37.5 | 68.8 | 0 | 6.3 | 6.3 | 0 | 18.8 |
| 1900+ | 14 | 4.43 | 4.5 | 0 / 0 / 1 / 6 / 7 | 50 | 92.9 | 0 | 35.7 | 21.4 | 0 | 14.3 |
| 1700s | 16 | 4.63 | 5 | 0 / 0 / 1 / 4 / 11 | 68.8 | 93.8 | 0 | 12.5 | 0 | 0 | 6.3 |
| 1800s | 18 | 4.33 | 4.5 | 0 / 0 / 3 / 6 / 9 | 50 | 83.3 | 0 | 22.2 | 16.7 | 0 | 22.2 |

## By arm / prompt label
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite/v10 | 27 | 3.81 | 4 | 1 / 0 / 9 / 10 / 7 | 25.9 | 63 | 3.7 | 33.3 | 18.5 | 0 | 37 |
| lite/13 | 9 | 4.44 | 4 | 0 / 0 / 0 / 5 / 4 | 44.4 | 100 | 0 | 11.1 | 11.1 | 0 | 11.1 |
| flash/11 | 7 | 3.71 | 4 | 1 / 0 / 1 / 3 / 2 | 28.6 | 71.4 | 14.3 | 42.9 | 14.3 | 0 | 28.6 |
| lite/v6 | 3 | 4 | 4 | 0 / 0 / 1 / 1 / 1 | 33.3 | 66.7 | 0 | 0 | 33.3 | 0 | 33.3 |
| flash/v5.1.2026-03b | 3 | 4.33 | 4 | 0 / 0 / 0 / 2 / 1 | 33.3 | 100 | 0 | 33.3 | 33.3 | 0 | 0 |
| lite/11 | 13 | 4.31 | 4 | 0 / 0 / 2 / 5 / 6 | 46.2 | 84.6 | 0 | 0 | 15.4 | 0 | 7.7 |
| flash/v5.2026-02 | 3 | 4.33 | 4 | 0 / 0 / 0 / 2 / 1 | 33.3 | 100 | 0 | 0 | 33.3 | 0 | 0 |
| lite/1 | 2 | 4 | 4 | 0 / 0 / 1 / 0 / 1 | 50 | 50 | 0 | 50 | 0 | 0 | 50 |
| lite/v1 | 5 | 4.6 | 5 | 0 / 0 / 0 / 2 / 3 | 60 | 100 | 0 | 20 | 20 | 0 | 0 |
| flash/v2 | 10 | 4.7 | 5 | 0 / 0 / 1 / 1 / 8 | 80 | 90 | 0 | 0 | 0 | 0 | 10 |
| flash/v5.1.2026-03c | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/v1 | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/v10 | 6 | 4.67 | 5 | 0 / 0 / 0 / 2 / 4 | 66.7 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/3 | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/13 | 6 | 4.17 | 4 | 0 / 0 / 1 / 3 / 2 | 33.3 | 83.3 | 0 | 0 | 0 | 0 | 16.7 |
| agy-flash/13 | 5 | 4.8 | 5 | 0 / 0 / 0 / 1 / 4 | 80 | 100 | 0 | 0 | 0 | 0 | 0 |
| lite/12 | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 |

## Script class
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| latin-script | 65 | 4.42 | 5 | 1 / 0 / 7 / 20 / 37 | 56.9 | 87.7 | 1.5 | 10.8 | 15.4 | 0 | 13.8 |
| non-latin-script | 38 | 3.92 | 4 | 1 / 0 / 10 / 17 / 10 | 26.3 | 71.1 | 2.6 | 23.7 | 7.9 | 0 | 26.3 |

## Defect types (primary judge, main items)
| type/severity | n |
|---|---:|
| mistranslation/minor | 56 |
| omission/minor | 15 |
| terminology/minor | 12 |
| invention/minor | 11 |
| garble_passthrough/minor | 9 |
| name/minor | 7 |
| invention/major | 6 |
| garble_passthrough/major | 4 |
| omission/major | 3 |
| inversion/major | 2 |
| wrong_page/major | 2 |
| mistranslation/major | 2 |
| number/major | 2 |
| inversion/minor | 1 |
| number/minor | 1 |

## Worst 25 (primary judge)
| fidelity | language | arm | flags | url | reason |
|---:|---|---|---|---|---|
| 1 | Dutch | lite | omission, invention, wrong_page | https://sourcelibrary.org/book/69b525a06be604608303046c?page=13 | Translation renders the preceding page of Kommerrust, not pp. 22-23 on the page. |
| 1 | Japanese | flash | omission, invention, wrong_page | https://sourcelibrary.org/book/69f33b3d876dd827cbc589d4?page=5 | Translation shares nothing with the source (journey to Tsu-no-oka shore, the salt-smoke poem, lodging with a host); it is invented poetic fragments. |
| 3 | Latin | lite | garble_passthrough | https://sourcelibrary.org/book/69dbc8461040d1d5e20981e8?page=15 | The bishop-as-watchman section and the Ezekiel and Matthew quotations are faithful, but the garbled list of what a just king brings and the opening clause on the sea are papered over with confident wr |
| 3 | Latin | lite | invention | https://sourcelibrary.org/book/69b65e59b3f4fc0441520c19?page=10 | Theses IV–VI rendered = source, but VII invents a full clause past the page break ('when qualities are broken… some third Mixed thing is made') that the page does not carry. |
| 3 | Latin | lite | invention, garble_passthrough | https://sourcelibrary.org/book/69dbcafa1040d1d5e20b030e?page=108 | Broad argument on the four interior senses and fantasia tracked, but an invented lead-in note, Ar.=Aristotle misreading, and confident rendering of garbled abbreviations; Latin abbreviations read with |
| 3 | English | lite | omission | https://sourcelibrary.org/book/69b0105ce485bbb15c6b4f66?page=125 | Scholiast and English notes on Arcturus and the Altar rendered well, but both Aratus Greek verse quotations are marked '[Greek omitted]' and the opening Latin lines are dropped. |
| 3 | English | lite | omission | https://sourcelibrary.org/book/69aff370c83500af1dbf73bf?page=355 | Lemma and Ex. 1 reproduced = source, but the four closing equations with their specific values are dropped and replaced by an ellipsis note. |
| 3 | Greek | lite | omission, garble_passthrough | https://sourcelibrary.org/book/69bfccf18ab50eb88e8c7050?page=194 | Heavily garbled scholia on Thucydides (Corinthians, Epidamnus, Phormio) followed clause by clause, but several unreadable spans are given confident English senses; my read of this garbled Greek is wea |
| 3 | Italian | lite | omission, invention | https://sourcelibrary.org/book/69af1faa60e86dd0cd67e3e6?page=119 | Italian commentary on III 875-928 rendered faithfully, but the Lucretius text lines are dropped and an invented woodcut description is added. |
| 3 | Chinese | flash | garble_passthrough | https://sourcelibrary.org/book/6a3c663639b4508b04e32eb3?page=20 | Most entries (金虎, 九華, 紫廬, Xie An, Taiwu Hall) = source, but the Yang Ci citation attaches the wrong entry (Ox-herd/Weaver instead of 鴻池/上林), and the garbled header is rendered word by word. |
| 3 | Sanskrit | flash | garble_passthrough | https://sourcelibrary.org/book/69906d4564d44bd0a0ef52ef?page=19 | Gist (Hemadri, Nirnayamrita, Raksha-bandhan free of Bhadra, Sankata Chaturthi moonrise rule, Madhava, Shitala, Ashtami midnight) tracks the source, but several garbled OCR spans are smoothed into flue |
| 3 | Sanskrit | lite |  | https://sourcelibrary.org/book/6990666c2ec9f7db5717a2ea?page=214 | Verses 43-45 and commentary mostly right, but the malefics' favourable-house list in v.44 is wrong (8th, 12th instead of 11th); Sanskrit read moderately. |
| 3 | Hebrew | lite |  | https://sourcelibrary.org/book/69c1bb588522835be845f08d?page=327 | The source OCR is itself disjointed (e.g. 'אונטולוגיא'), and the translation follows it word by word into prose that is partly unintelligible but not invented; individual phrases are uncertain. Low co |
| 3 | Hebrew | lite | garble_passthrough | https://sourcelibrary.org/book/69c1bb458522835be845e1ef?page=337 | Source OCR is heavily corrupted kabbalistic Hebrew; translation tracks it line by line (Yetzirah elevated into Beriah, letters of Torah before Chochmah) but turns the garble into quasi-sentences; low  |
| 3 | Hebrew | lite |  | https://sourcelibrary.org/book/69b52c893dd6d9423028108e?page=256 | Heavily corrupt OCR of Maimonides' Pirkei Moshe; translation is a literal, non-fluent word-by-word rendering that follows the OCR without papering over it, so most of the body is unreadable but recove |
| 3 | Arabic | lite | garble_passthrough | https://sourcelibrary.org/book/69e80657fdad300064d9ece7?page=49 | Two senses of 'blood' and the breathing lemma are rendered, but the garbled latter half (لاوز, صلحون, عدا الأعضاء) is turned into assertions the OCR cannot support; my reading of this handwritten-OCR  |
| 3 | Arabic | lite | garble_passthrough | https://sourcelibrary.org/book/69ef2f6c72c1376fdf2af335?page=132 | Persian OCR is heavily garbled; translation tracks it literally and marks gaps with ellipses, but smooths several garbled spans into confident readings and adds an unsupported gloss/note; Nasta'liq-Pe |
| 3 | Korean | flash | omission, garble_passthrough | https://sourcelibrary.org/book/69f33da0876dd827cbc5c39b?page=155 | Administrative rules on service tenure and funeral/exam officials are mostly tracked, but first line dropped, the 3,000-month figure becomes days, several clauses and margins are guessed fluently; my  |
| 3 | Spanish | lite |  | https://sourcelibrary.org/book/6a3a3b6882a064363d359f64?page=324 | Chapters 2-6 rendered closely, but the list of impediments is renumbered off by one from x onward (18 instead of 17), and a couple of clauses are loosened. |
| 4 | Latin | lite | invention | https://sourcelibrary.org/book/69b52bee3dd6d9423027cccc?page=64 | The argument on the mind's incorporeal, self-moved conception of species is rendered faithfully, but the page's broken final clause is completed with an invented conclusion. |
| 4 | Latin | lite | inversion | https://sourcelibrary.org/book/6a50751880b7658fae262cdd?page=8 | The verses are otherwise faithful (Eripis, the dedication by Duke Maximilian Aemilius, the Fathers and People, the Ausonian eagles), but the mutare construction is rendered so that the direction of th |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/6a4b09dd0d1fa55f9988e21a?page=6 | Both dedicatees' titles and all 18 lines of the New Year/Christmas elegiacs rendered faithfully; awkward 'spectacular' and 'amplified' for honorific superlatives. |
| 4 | Latin | lite | garble_passthrough | https://sourcelibrary.org/book/699053427d19f3f2aac1e7e4?page=233 | Scaliger's notes on Manilius verse by verse are rendered faithfully, but the Isia/Isis references become 'the Ides' and 'solstice', and Cancer→Capricorn becomes 'Cancer and Capricorn'. |
| 4 | Latin | flash | invention | https://sourcelibrary.org/book/69ac7ff399cd79d62bf74ed8?page=170 | Body of Secretum secretorum ch. 27 and 'De gloria inestimabili' = source, footnote on periodus correctly placed; the numbered name markers are filled with speculative invented identifications. |
| 4 | Latin | lite | invention | https://sourcelibrary.org/book/69dbc9921040d1d5e20a45a0?page=98 | Close, literal rendering of the Norbanus passage of De oratore; supplies an ending the truncated source lacks; otherwise = source including its OCR person-shifts (refricabat). |
