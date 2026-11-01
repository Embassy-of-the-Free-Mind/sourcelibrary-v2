# Translation corpus audit — run

Judge: gemini-4-argon-medium (source-grounded, reference-free, single candidate; measure = judge rating, NOT accuracy). 25 pages from 25 books, one interior page per book, seed 20261030.

**Controls gate: FAIL — this run is not reported** (swap ≥ 93% rated ≤2, drop ≥ 87% flagged omission, repeat ≥ 93% within one; ≥ 10 of each).

## Controls (read first)
- swap (translation of another page): 5/5 rated ≤2, 5/5 flagged wrong_page
- drop (middle ~35% removed): 5/5 flagged omission, 5/5 rated ≤3
- repeat (same item twice): 4/5 exact, 5/5 within 1, 5/5 identical flags

## Corpus estimate (post-stratified by language; 95% CI)
| statistic | est % | CI |
|---|---:|---|
| fidelity 5 | 20.2 | 14.6–25.8 |
| fidelity ≥ 4 | 33.4 | 29.6–35.8 |
| fidelity ≤ 2 | 4.5 | 3.2–5.8 |
| any major defect | 41.8 | 41.2–42.3 |
| omission | 45.9 | 40.4–52 |
| invention | 1.9 | 0.2–3.7 |
| inversion | 0.4 | 0–0.9 |
| untranslated | 0 | 0–0 |
| wrong_language | 0 | 0–0 |
| wrong_page | 0 | 0–0 |
| garble_passthrough | 42.9 | 38.5–48.1 |
| truncated | 0.4 | 0–0.9 |
| repetition | 0 | 0–0 |

## By language
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Japanese | 4 | 2.5 | 2.5 | 1 / 1 / 1 / 1 / 0 | 0 | 25 | 50 | 75 | 50 | 0 | 75 |
| Hebrew | 4 | 3.25 | 3 | 0 / 2 / 0 / 1 / 1 | 25 | 50 | 50 | 75 | 25 | 0 | 50 |
| Greek | 4 | 4.5 | 4.5 | 0 / 0 / 0 / 2 / 2 | 50 | 100 | 0 | 25 | 0 | 0 | 0 |
| Tibetan | 3 | 3.67 | 4 | 0 / 0 / 1 / 2 / 0 | 0 | 66.7 | 0 | 0 | 0 | 0 | 0 |
| Sanskrit | 2 | 2.5 | 2.5 | 0 / 1 / 1 / 0 / 0 | 0 | 0 | 50 | 100 | 0 | 0 | 100 |
| Italian | 2 | 2 | 2 | 0 / 2 / 0 / 0 / 0 | 0 | 0 | 100 | 50 | 50 | 0 | 100 |
| Chinese | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 50 | 0 | 0 | 0 |
| Spanish | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |
| Arabic | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |
| German | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Latin | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 100 | 0 | 0 | 100 |

## By translation model arm (unpaired: different pages per arm, model follows the book)
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite | 11 | 3.82 | 4 | 0 / 2 / 1 / 5 / 3 | 27.3 | 72.7 | 18.2 | 36.4 | 9.1 | 0 | 18.2 |
| opus | 2 | 3.5 | 3.5 | 0 / 1 / 0 / 0 / 1 | 50 | 50 | 50 | 50 | 0 | 0 | 50 |
| flash | 12 | 3.08 | 3 | 1 / 3 / 3 / 4 / 1 | 8.3 | 41.7 | 33.3 | 58.3 | 25 | 0 | 58.3 |

## By language × arm
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Tibetan / lite | 2 | 3.5 | 3.5 | 0 / 0 / 1 / 1 / 0 | 0 | 50 | 0 | 0 | 0 | 0 | 0 |
| Tibetan / flash | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |
| Sanskrit / opus | 1 | 2 | 2 | 0 / 1 / 0 / 0 / 0 | 0 | 0 | 100 | 100 | 0 | 0 | 100 |
| Sanskrit / flash | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 100 | 0 | 0 | 100 |
| Japanese / flash | 4 | 2.5 | 2.5 | 1 / 1 / 1 / 1 / 0 | 0 | 25 | 50 | 75 | 50 | 0 | 75 |
| Spanish / lite | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |
| Hebrew / flash | 1 | 2 | 2 | 0 / 1 / 0 / 0 / 0 | 0 | 0 | 100 | 100 | 0 | 0 | 100 |
| Hebrew / lite | 3 | 3.67 | 4 | 0 / 1 / 0 / 1 / 1 | 33.3 | 66.7 | 33.3 | 66.7 | 33.3 | 0 | 33.3 |
| Italian / flash | 1 | 2 | 2 | 0 / 1 / 0 / 0 / 0 | 0 | 0 | 100 | 0 | 100 | 0 | 100 |
| Italian / lite | 1 | 2 | 2 | 0 / 1 / 0 / 0 / 0 | 0 | 0 | 100 | 100 | 0 | 0 | 100 |
| Arabic / flash | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |
| Chinese / opus | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Chinese / flash | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 100 | 0 | 0 | 0 |
| Greek / lite | 4 | 4.5 | 4.5 | 0 / 0 / 0 / 2 / 2 | 50 | 100 | 0 | 25 | 0 | 0 | 0 |
| German / flash | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Latin / flash | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 100 | 0 | 0 | 100 |

## By period
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1700-1900 | 10 | 3.2 | 3.5 | 1 / 3 / 1 / 3 / 2 | 20 | 50 | 40 | 30 | 20 | 0 | 40 |
| pre-1500 | 5 | 3.8 | 4 | 0 / 0 / 2 / 2 / 1 | 20 | 60 | 0 | 60 | 20 | 0 | 40 |
| 1500-1700 | 8 | 3.63 | 4 | 0 / 2 / 1 / 3 / 2 | 25 | 62.5 | 25 | 50 | 12.5 | 0 | 37.5 |
| 1900+ | 1 | 2 | 2 | 0 / 1 / 0 / 0 / 0 | 0 | 0 | 100 | 100 | 0 | 0 | 100 |
| unknown | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 100 | 0 | 0 | 0 |

## By arm / prompt label
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite/13 | 2 | 3.5 | 3.5 | 0 / 0 / 1 / 1 / 0 | 0 | 50 | 0 | 0 | 0 | 0 | 0 |
| opus/1 | 1 | 2 | 2 | 0 / 1 / 0 / 0 / 0 | 0 | 0 | 100 | 100 | 0 | 0 | 100 |
| flash/11 | 3 | 2.33 | 2 | 1 / 1 / 0 / 1 / 0 | 0 | 33.3 | 66.7 | 66.7 | 33.3 | 0 | 66.7 |
| flash/12 | 2 | 2.5 | 2.5 | 0 / 1 / 1 / 0 / 0 | 0 | 0 | 50 | 100 | 50 | 0 | 100 |
| lite/v10 | 8 | 4.13 | 4 | 0 / 1 / 0 / 4 / 3 | 37.5 | 87.5 | 12.5 | 37.5 | 12.5 | 0 | 12.5 |
| flash/v2 | 3 | 2.67 | 3 | 0 / 1 / 2 / 0 / 0 | 0 | 0 | 33.3 | 66.7 | 33.3 | 0 | 100 |
| flash/v5.1.2026-03b | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |
| opus/13 | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| lite/11 | 1 | 2 | 2 | 0 / 1 / 0 / 0 / 0 | 0 | 0 | 100 | 100 | 0 | 0 | 100 |
| flash/v10 | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/13 | 2 | 4 | 4 | 0 / 0 / 0 / 2 / 0 | 0 | 100 | 0 | 50 | 0 | 0 | 0 |

## Script class
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| non-latin-script | 20 | 3.5 | 4 | 1 / 4 / 3 / 8 / 4 | 20 | 60 | 25 | 50 | 15 | 0 | 35 |
| latin-script | 5 | 3.2 | 3 | 0 / 2 / 1 / 1 / 1 | 20 | 40 | 40 | 40 | 20 | 0 | 60 |

## Defect types (primary judge, main items)
| type/severity | n |
|---|---:|
| mistranslation/minor | 14 |
| garble_passthrough/minor | 10 |
| omission/major | 9 |
| omission/minor | 7 |
| terminology/minor | 4 |
| garble_passthrough/major | 4 |
| invention/major | 3 |
| mistranslation/major | 3 |
| inversion/major | 2 |
| invention/minor | 1 |
| truncated/major | 1 |

## Worst 25 (primary judge)
| fidelity | language | arm | flags | url | reason |
|---:|---|---|---|---|---|
| 1 | Japanese | flash | omission, invention, truncated | https://sourcelibrary.org/book/69f3276f52a77bb28fdb7316?page=3 | Translation fabricates two generic bullet points and a false illegibility note while omitting almost the entire 14-line source text on viewing tsukiyama stones, yōkō-ishi, and sake-serving etiquette. |
| 2 | Sanskrit | opus | omission | https://sourcelibrary.org/book/69ee89f34501bec896546e1d?page=770 | Omits the entire opening paragraph, both sūtra citations, all grammatical/accentual commentary, the padapāṭha lines, and 'mahe/mahate' in verse 7 and its gloss. |
| 2 | Japanese | flash | omission, inversion, garble_passthrough | https://sourcelibrary.org/book/6a0aca8b676a42ccd9775261?page=19 | Repeatedly mistranslates key mechanics and fabricates bogus romaji terms: drops 'making in papier-mâché' (はりぬきにして), renders 'when the chest bends back' as 'align with the hole in the chest', renders 首 |
| 2 | Hebrew | flash | omission, inversion, garble_passthrough, truncated | https://sourcelibrary.org/book/6a357f1ac6e2d5bb56a64539?page=204 | Truncates the second half of Mareh HaPanim and the entire Amudei Yerushalayim section, heavily abridges the commentary, and mistranslates ויותר ('forfeited') as 'it is permitted', reversing the disput |
| 2 | Italian | flash | invention | https://sourcelibrary.org/book/6991eadd2f801130a473ea3c?page=31 | translates the French publication label accurately, then invents four paragraphs and margin notes of anatomical text on nerves and the cervical spine absent from the source |
| 2 | Hebrew | lite | omission, invention | https://sourcelibrary.org/book/69b4cd3dd5b6c3815e1a504b?page=154 | Translates the first column (Hebrew Leviticus 23:32b–42) accurately, but completely omits the second column (Aramaic Targum Onkelos) and invents Leviticus 23:43–44 in its place. |
| 2 | Italian | lite | omission | https://sourcelibrary.org/book/6a084e0949638a50931b4b3d?page=422 | Omits the opening two sentences (~75 words, over a quarter of the page) recounting the river skirmishes, the killing of the Tribune, and the 1,400 Romans killed at the trench; otherwise = source. |
| 3 | Tibetan | lite | garble_passthrough | https://sourcelibrary.org/book/69e78a8a4a6785cfd60d3a96?page=2657 | mistranslates མིག་སེ་རོ (eyes are yellow) as 'eyes must be watched', གནོད་ as 'joints', and རྫོག་སྟོ (is completed) as 'it is the manifestation', and smooths the OCR-garbled middle clause into fluent  |
| 3 | Japanese | flash | omission, invention | https://sourcelibrary.org/book/69dfede68d34461cbe7f4df4?page=71 | Translates ①–㊿ literally from the degenerate OCR source, but collapses entries (51)–(1343) into a <note> that invents an unsupported philological explanation and completes truncated '(1344)の' as 'Of t |
| 3 | Sanskrit | flash | omission, garble_passthrough | https://sourcelibrary.org/book/69906d1964d44bd0a0ef5210?page=8 | Captures the main astrological topics on both folios, but smooths several spans of severe OCR garble into confident guesswork, misconstrues 'एतेषाम् अन्यतमे' in v. 52 so 'another's wife' is restricted |
| 3 | Latin | flash | omission, garble_passthrough | https://sourcelibrary.org/book/59e68f94-49d0-4ed7-a610-b1f53e55b2f8?page=369 | Marks many OCR corruptions with [unclear], but papers over several garbled spans with fluent guesses (e.g. 'nactū auuūm̄', 'nutritiūō aisolocante', 'diuit̃ z mlō. pino z lotho lenī'), drops a few  |
| 4 | Tibetan | lite |  | https://sourcelibrary.org/book/69e7abec5f1a22ab19aa0707?page=712 | Faithfully translates the source text including its garbled opening line; minor slips on initial གསུམ་, ལ་དུ་ (laḍḍu), and གནས་ངན་ལེན (dauṣṭhulya). |
| 4 | Japanese | flash |  | https://sourcelibrary.org/book/6a08e2ce50bd891addfb51e6?page=23 | renders お仕合 (fortunate) as 'To his misfortune', misreads 若い子供の風うへに置事もいや as 'unpleasant to see a young man', and smooths over 暮がたりなり; otherwise = source |
| 4 | Spanish | lite |  | https://sourcelibrary.org/book/69b5259a9658af9164709be3?page=78 | mistranslates 'a ſaber el alma' ('namely, the soul') as 'to know the soul' and drops initial modal 'deue' in opening 'deue comer'; otherwise = source |
| 4 | Arabic | flash | garble_passthrough | https://sourcelibrary.org/book/69c1b8c38522835be844b11b?page=88 | Faithfully translates the transcribed Arabic poem and glosses, except for smoothing over the OCR garble 'مَنَّافَاسِخٌ' as 'one who seeks... do so'. |
| 4 | Hebrew | lite | omission, garble_passthrough | https://sourcelibrary.org/book/69c1ba908522835be845944d?page=230 | Faithfully translates the three columns of rabbinic Hebrew, but papers over several OCR corruptions (e.g. 'נפ' ביתר חולין' rendered as 'in the chapter Kol HaBasar', 'מדיש' rendered as 'from the dish') |
| 4 | Greek | lite |  | https://sourcelibrary.org/book/69bfcf473047130b1c3bf2d7?page=31 | Faithfully and literally translates the corrupted Greek OCR throughout, with minor slips on 'στάδια' ('stages') and untranslated 'ἴδια'. |
| 4 | Greek | lite | omission, garble_passthrough | https://sourcelibrary.org/book/69938a93d5a98fd66f42d3fa?page=113 | Faithfully translates the OCR text (including its misreadings) except for smoothing over several garbled OCR spans, rendering μῖϛον as 'custom', and omitting 'τούϛι μέν νυν ὑπ' Αἰγυπτίων λεγομένοιϛι'. |
| 4 | Tibetan | flash |  | https://sourcelibrary.org/book/69e7613ccc48e59ad74ee65d?page=144 | translates all three leaves accurately including OCR's སྔ་བརྒྱད་ ('eight earlier'), but reverses the order of the three <leaf-break/> sections and renders ཁྱུང་གི་ཤམྦུ་ཅན་ as 'Garuda garment' |
| 4 | Chinese | flash | omission | https://sourcelibrary.org/book/6a3c5ebb40c88a541d8e5477?page=73 | Omits 本 and misparses 桜字/本肉奔 into a spurious '肉' radical row; misreads the two character entries 字存 under 子部 as '<note>This character is preserved</note>'; otherwise faithfully renders the transcribed |
| 5 | Hebrew | lite |  | https://sourcelibrary.org/book/69c1bb2e8522835be845d575?page=46 | Faithfully translates both section headers and all 24 lines of the transcribed Hebrew text. |
| 5 | Chinese | opus |  | https://sourcelibrary.org/book/6a3ceaf795fcd45563052360?page=25 | Accurately translates the headings and poem lyrics ('東門之池，可以漚紵 / 彼美淑姬，可與晤語') while romanising each syllable, scale degree, and gongche sign in place to preserve the score alignment. |
| 5 | Greek | lite |  | https://sourcelibrary.org/book/699388ea1075be7d320551a0?page=101 | Faithfully translates all table headers, stellar descriptions, Greek numerals, and notes from the transcribed source text. |
| 5 | Greek | lite |  | https://sourcelibrary.org/book/69938985ce1538706594752c?page=233 | Complete and accurate translation of the entire Greek source text as transcribed, including the opening lines, marginalia, and the full passage from Plato's Apology (21c–24b). |
| 5 | German | flash |  | https://sourcelibrary.org/book/69b418ca2b0edf3eaa2dde61?page=110 | Faithfully translates the entire Russian source text, including the mid-sentence ending at the bottom of the page and the OCR's specific readings ('нарочный' as 'intentional', 'составившей' as 'that f |
