# Translation corpus audit — translation-corpus-audit-monthly-2026-10

Judge: opus (source-grounded, reference-free, single candidate; measure = judge rating, NOT accuracy). 103 pages from 103 books, one interior page per book, seed 20261001.

**Controls gate: PASS** (swap ≥ 93% rated ≤2, drop ≥ 87% flagged omission, repeat ≥ 93% within one; ≥ 10 of each).

## Controls (read first)
- swap (translation of another page): 15/15 rated ≤2, 15/15 flagged wrong_page
- drop (middle ~35% removed): 15/15 flagged omission, 14/15 rated ≤3
- repeat (same item twice): 11/15 exact, 15/15 within 1, 14/15 identical flags

## Corpus estimate (post-stratified by language; 95% CI)
| statistic | est % | CI |
|---|---:|---|
| fidelity 5 | 44.3 | 34.5–55.4 |
| fidelity ≥ 4 | 83.3 | 74.5–91.8 |
| fidelity ≤ 2 | 3.1 | 0–8.4 |
| any major defect | 14.8 | 7–24.2 |
| omission | 12.6 | 6.5–19.6 |
| invention | 14.6 | 6.7–23.7 |
| inversion | 5.1 | 1–10.4 |
| untranslated | 0 | 0–0 |
| wrong_language | 0 | 0–0 |
| wrong_page | 0 | 0–0 |
| garble_passthrough | 9.6 | 3.5–16.9 |
| truncated | 0 | 0–0 |
| repetition | 0 | 0–0 |

## By language
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin | 19 | 4.05 | 4 | 0 / 1 / 3 / 9 / 6 | 31.6 | 78.9 | 5.3 | 10.5 | 15.8 | 0 | 21.1 |
| English | 12 | 4.75 | 5 | 0 / 0 / 0 / 3 / 9 | 75 | 100 | 0 | 0 | 16.7 | 0 | 0 |
| German | 12 | 4.42 | 5 | 0 / 0 / 2 / 3 / 7 | 58.3 | 83.3 | 0 | 0 | 8.3 | 0 | 8.3 |
| Greek | 12 | 3.92 | 4 | 0 / 0 / 4 / 5 / 3 | 25 | 66.7 | 0 | 41.7 | 16.7 | 0 | 25 |
| French | 8 | 4.25 | 5 | 0 / 1 / 1 / 1 / 5 | 62.5 | 75 | 12.5 | 12.5 | 25 | 0 | 25 |
| Italian | 6 | 4.67 | 5 | 0 / 0 / 0 / 2 / 4 | 66.7 | 100 | 0 | 0 | 0 | 0 | 0 |
| Dutch | 6 | 4.67 | 5 | 0 / 0 / 0 / 2 / 4 | 66.7 | 100 | 0 | 33.3 | 0 | 0 | 0 |
| Chinese | 6 | 4.17 | 4 | 0 / 0 / 1 / 3 / 2 | 33.3 | 83.3 | 0 | 0 | 33.3 | 0 | 16.7 |
| Sanskrit | 4 | 4 | 4 | 0 / 0 / 1 / 2 / 1 | 25 | 75 | 0 | 50 | 0 | 0 | 25 |
| Hebrew | 4 | 4.25 | 4 | 0 / 0 / 0 / 3 / 1 | 25 | 100 | 0 | 25 | 0 | 0 | 0 |
| Arabic | 4 | 4.25 | 4 | 0 / 0 / 0 / 3 / 1 | 25 | 100 | 0 | 25 | 0 | 0 | 0 |
| Tibetan | 4 | 3.5 | 3.5 | 0 / 0 / 2 / 2 / 0 | 0 | 50 | 0 | 25 | 50 | 0 | 25 |
| Korean | 2 | 4 | 4 | 0 / 0 / 0 / 2 / 0 | 0 | 100 | 0 | 50 | 0 | 0 | 0 |
| Spanish | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 0 | 0 | 0 | 0 |
| Japanese | 2 | 3 | 3 | 0 / 1 / 0 / 1 / 0 | 0 | 50 | 50 | 50 | 100 | 0 | 50 |

## By translation model arm (unpaired: different pages per arm, model follows the book)
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite | 63 | 4.13 | 4 | 0 / 3 / 9 / 28 / 23 | 36.5 | 81 | 4.8 | 22.2 | 14.3 | 0 | 17.5 |
| flash | 40 | 4.4 | 5 | 0 / 0 / 5 / 14 / 21 | 52.5 | 87.5 | 0 | 7.5 | 17.5 | 0 | 7.5 |

## By language × arm
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin / lite | 14 | 3.86 | 4 | 0 / 1 / 3 / 7 / 3 | 21.4 | 71.4 | 7.1 | 14.3 | 14.3 | 0 | 28.6 |
| Latin / flash | 5 | 4.6 | 5 | 0 / 0 / 0 / 2 / 3 | 60 | 100 | 0 | 0 | 20 | 0 | 0 |
| English / lite | 7 | 4.71 | 5 | 0 / 0 / 0 / 2 / 5 | 71.4 | 100 | 0 | 0 | 14.3 | 0 | 0 |
| English / flash | 5 | 4.8 | 5 | 0 / 0 / 0 / 1 / 4 | 80 | 100 | 0 | 0 | 20 | 0 | 0 |
| German / flash | 9 | 4.33 | 5 | 0 / 0 / 2 / 2 / 5 | 55.6 | 77.8 | 0 | 0 | 11.1 | 0 | 11.1 |
| German / lite | 3 | 4.67 | 5 | 0 / 0 / 0 / 1 / 2 | 66.7 | 100 | 0 | 0 | 0 | 0 | 0 |
| Greek / lite | 9 | 3.67 | 4 | 0 / 0 / 4 / 4 / 1 | 11.1 | 55.6 | 0 | 55.6 | 22.2 | 0 | 33.3 |
| Greek / flash | 3 | 4.67 | 5 | 0 / 0 / 0 / 1 / 2 | 66.7 | 100 | 0 | 0 | 0 | 0 | 0 |
| French / lite | 3 | 4 | 5 | 0 / 1 / 0 / 0 / 2 | 66.7 | 66.7 | 33.3 | 33.3 | 33.3 | 0 | 33.3 |
| French / flash | 5 | 4.4 | 5 | 0 / 0 / 1 / 1 / 3 | 60 | 80 | 0 | 0 | 20 | 0 | 20 |
| Italian / lite | 5 | 4.8 | 5 | 0 / 0 / 0 / 1 / 4 | 80 | 100 | 0 | 0 | 0 | 0 | 0 |
| Italian / flash | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |
| Dutch / lite | 5 | 4.6 | 5 | 0 / 0 / 0 / 2 / 3 | 60 | 100 | 0 | 40 | 0 | 0 | 0 |
| Dutch / flash | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Chinese / flash | 4 | 4.25 | 4.5 | 0 / 0 / 1 / 1 / 2 | 50 | 75 | 0 | 0 | 50 | 0 | 25 |
| Chinese / lite | 2 | 4 | 4 | 0 / 0 / 0 / 2 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |
| Sanskrit / flash | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 50 | 0 | 0 | 0 |
| Sanskrit / lite | 2 | 3.5 | 3.5 | 0 / 0 / 1 / 1 / 0 | 0 | 50 | 0 | 50 | 0 | 0 | 50 |
| Hebrew / flash | 2 | 4 | 4 | 0 / 0 / 0 / 2 / 0 | 0 | 100 | 0 | 50 | 0 | 0 | 0 |
| Hebrew / lite | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 0 | 0 | 0 | 0 |
| Arabic / lite | 4 | 4.25 | 4 | 0 / 0 / 0 / 3 / 1 | 25 | 100 | 0 | 25 | 0 | 0 | 0 |
| Tibetan / lite | 3 | 3.67 | 4 | 0 / 0 / 1 / 2 / 0 | 0 | 66.7 | 0 | 33.3 | 33.3 | 0 | 33.3 |
| Tibetan / flash | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 0 | 100 | 0 | 0 |
| Korean / flash | 2 | 4 | 4 | 0 / 0 / 0 / 2 / 0 | 0 | 100 | 0 | 50 | 0 | 0 | 0 |
| Spanish / lite | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 0 | 0 | 0 | 0 |
| Japanese / lite | 2 | 3 | 3 | 0 / 1 / 0 / 1 / 0 | 0 | 50 | 50 | 50 | 100 | 0 | 50 |

## By period
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1500s | 25 | 4.24 | 4 | 0 / 1 / 3 / 10 / 11 | 44 | 84 | 4 | 8 | 16 | 0 | 12 |
| 1700s | 20 | 4.45 | 4.5 | 0 / 0 / 1 / 9 / 10 | 50 | 95 | 0 | 20 | 5 | 0 | 10 |
| pre-1500 | 9 | 3.44 | 3 | 0 / 1 / 4 / 3 / 1 | 11.1 | 44.4 | 11.1 | 22.2 | 22.2 | 0 | 33.3 |
| 1600s | 14 | 4.29 | 4 | 0 / 0 / 2 / 6 / 6 | 42.9 | 85.7 | 0 | 0 | 14.3 | 0 | 7.1 |
| 1800s | 13 | 4.38 | 5 | 0 / 1 / 1 / 3 / 8 | 61.5 | 84.6 | 7.7 | 15.4 | 23.1 | 0 | 15.4 |
| 1900+ | 16 | 4.25 | 4 | 0 / 0 / 2 / 8 / 6 | 37.5 | 87.5 | 0 | 37.5 | 12.5 | 0 | 12.5 |
| unknown | 6 | 4.17 | 4 | 0 / 0 / 1 / 3 / 2 | 33.3 | 83.3 | 0 | 16.7 | 33.3 | 0 | 16.7 |

## By arm / prompt label
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite/v1 | 6 | 4.5 | 4.5 | 0 / 0 / 0 / 3 / 3 | 50 | 100 | 0 | 0 | 16.7 | 0 | 0 |
| lite/11 | 24 | 4 | 4 | 0 / 2 / 4 / 10 / 8 | 33.3 | 75 | 8.3 | 25 | 12.5 | 0 | 20.8 |
| lite/v10 | 29 | 4.14 | 4 | 0 / 1 / 4 / 14 / 10 | 34.5 | 82.8 | 3.4 | 24.1 | 10.3 | 0 | 17.2 |
| flash/v2 | 21 | 4.57 | 5 | 0 / 0 / 1 / 7 / 13 | 61.9 | 95.2 | 0 | 9.5 | 14.3 | 0 | 4.8 |
| flash/v5.1.2026-03b | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |
| lite/13 | 2 | 4 | 4 | 0 / 0 / 1 / 0 / 1 | 50 | 50 | 0 | 50 | 50 | 0 | 50 |
| flash/v1 | 2 | 5 | 5 | 0 / 0 / 0 / 0 / 2 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/v10 | 8 | 4.25 | 4.5 | 0 / 0 / 2 / 2 / 4 | 50 | 75 | 0 | 0 | 12.5 | 0 | 12.5 |
| lite/v6 | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/11 | 4 | 4.25 | 4 | 0 / 0 / 0 / 3 / 1 | 25 | 100 | 0 | 25 | 25 | 0 | 0 |
| flash/v5.2026-02 | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/? | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 0 | 100 | 0 | 100 |
| flash/13 | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 0 | 100 | 0 | 0 |
| lite/12 | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 100 | 0 | 0 |

## Script class
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| latin-script | 65 | 4.4 | 5 | 0 / 2 / 6 / 21 / 36 | 55.4 | 87.7 | 3.1 | 7.7 | 12.3 | 0 | 10.8 |
| non-latin-script | 38 | 3.95 | 4 | 0 / 1 / 8 / 21 / 8 | 21.1 | 76.3 | 2.6 | 31.6 | 21.1 | 0 | 18.4 |

## Defect types (primary judge, main items)
| type/severity | n |
|---|---:|
| mistranslation/minor | 44 |
| terminology/minor | 14 |
| omission/minor | 14 |
| invention/minor | 13 |
| garble_passthrough/minor | 12 |
| name/minor | 6 |
| invention/major | 5 |
| number/minor | 5 |
| inversion/major | 4 |
| mistranslation/major | 3 |
| omission/major | 3 |
| garble_passthrough/major | 2 |
| name/major | 2 |
| untranslated/minor | 1 |
| inversion/minor | 1 |
| terminology/major | 1 |

## Worst 25 (primary judge)
| fidelity | language | arm | flags | url | reason |
|---:|---|---|---|---|---|
| 2 | Latin | lite | invention | https://sourcelibrary.org/book/6a085b4749638a50931cb590?page=223 | the commentary and oration up to 'repressit: hic, qui se est' = source, but roughly a third of the output is a continuation of Pro Sestio imported from beyond the page |
| 2 | French | lite | omission, invention | https://sourcelibrary.org/book/69f32fe0876dd827cbc45ed1?page=53 | Translation renders a handful of fragments of the dower counts and replaces the rest with ellipses and a summarising note; adds a name not in the source. |
| 2 | Japanese | lite | omission, invention | https://sourcelibrary.org/book/69e75cc83f15c712bdb8f012?page=30 | Senju-Shigehira banquet scene loosely sketched with names wrong (Nobuhira, Kannon, Ono for Kitano), the sake cask turned into a lattice, and the rōei and its vow missing |
| 3 | Latin | lite | inversion | https://sourcelibrary.org/book/6a26bebf0e247ebad6de8963?page=16 | Mostly faithful, but it reverses 'parum ... sollicite cogitet' into anxious thought and renumbers Ptolemy's four-point plan as three. |
| 3 | Latin | lite | garble_passthrough | https://sourcelibrary.org/book/69dbcbc51040d1d5e20baaae?page=32 | follows a garbled OCR of Seneca, De tranquillitate, sentence by sentence; several corrupt spans (clanis, vina imago, sub ducentibus) turned into confident but unsupported English |
| 3 | Latin | lite | garble_passthrough | https://sourcelibrary.org/book/69dbca361040d1d5e20a9c81?page=533 | Heavily abbreviated OCR; the peculatus cases, monopolists and boundary-moving passages are recoverably rendered, but the sacrilege definition is altered and several garbled spans become confident pros |
| 3 | German | flash | garble_passthrough | https://sourcelibrary.org/book/69b4192b2b0edf3eaa2dee6d?page=245 | Follows the garbled Kurrent OCR paragraph by paragraph, but smooths several unintelligible spans (Ooe/Oeder, oinum/Onosum, Diet) into confident readings; German alchemical OCR read moderately. |
| 3 | German | flash | garble_passthrough | https://sourcelibrary.org/book/69b418e92b0edf3eaa2de2c3?page=468 | Follows the OCR sentence by sentence (Marcasite, vitriol extraction, faeces re-exposed, lye repeated, Hungarian ♄), but papers over several garbled Kurrent misreadings with fluent prose; German read w |
| 3 | Greek | lite | garble_passthrough | https://sourcelibrary.org/book/6993891e0f04c37dcfa6084a?page=324 | source is badly garbled astronomical Greek; translation follows it clause by clause with brackets, but misreads ς̅ as 60 and point labels as numbers; I read this kind of abbreviated Greek only moderat |
| 3 | Greek | lite | omission | https://sourcelibrary.org/book/69e419e58a8dae1074c51fc2?page=399 | The five testimonia are rendered in substance, but the eta/epsilon point of fr. 36 is lost and the whole footnote apparatus (four notes, one explanatory) is missing. |
| 3 | Greek | lite | omission, invention, inversion | https://sourcelibrary.org/book/69e8063dfdad300064d9e7e3?page=177 | Swaddling instructions otherwise = source, but inverts the reason for loosening at the loin for girls, drops the opening clause, and appends an invented sentence on wool padding past the page end. |
| 3 | Greek | lite | garble_passthrough | https://sourcelibrary.org/book/69bfccb18ab50eb88e8c5ec1?page=258 | Tracks the words of a badly garbled Greek column, but bridges the gaps with supplied notes into prose the source cannot support. My reading of the corrupt Greek is weak. |
| 3 | French | flash | invention, inversion | https://sourcelibrary.org/book/699fcd509ff0f1d2c4518280?page=86 | the prose on the pyramid bases = source, but the layer lists in the diagram are reassigned between Pair and Impair, and the notes add claims the source does not make |
| 3 | Chinese | flash | invention | https://sourcelibrary.org/book/6992ce153ea667fbac82809e?page=19 | The spec line (1-chi flag, 1 zhang 5 chi spear, hung at 9 chi, 2 jin) is correct, but invented book/volume headings and background claims are added. |
| 3 | Sanskrit | lite | inversion, garble_passthrough | https://sourcelibrary.org/book/69de101d5cedf736edb85346?page=80 | Recipes 23–27 and footnotes mostly right, but verse 21 reverses who touches whom and who is subjugated, and v.22 garble is smoothed; Sanskrit read moderately. |
| 3 | Tibetan | lite | omission, invention | https://sourcelibrary.org/book/69e7ab1d5f1a22ab19a93200?page=254 | the case structure and Buddha's ruling are followed, but the key legal term is wrong throughout, the 'did not know for N months' clause is misread, and 'became ashamed' is imported into the later case |
| 3 | Tibetan | flash | invention | https://sourcelibrary.org/book/69e7484085f786e884a4c10f?page=10 | source is near-total OCR garble; translation honestly marks most of it <unclear> and glosses only scattered words, but stretches a few glosses and labels the page 'Drukpa Kagyu' biography without basi |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/69b222fd56715b0e32475df5?page=400 | Quintilian end of Book X and opening of XI De apte dicendo (Cicero's fourth virtue, men in necklaces, triumphal dress, De Oratore III, Crassus, Brutus) = source; only the opening fragment's 'deformat' |
| 4 | Latin | lite | invention | https://sourcelibrary.org/book/69b51e59768235dc65991192?page=678 | Psalms, antiphons, versicles, absolution and blessing all = source; appends the rest of the Ecclesiasticus 24 lesson plus 'Tu autem' that the page does not carry. |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/69d665d9bf5afe33937f8912?page=12 | word-by-word literal rendering that keeps the garbled OCR's oddities ('perfected by sin', 'return consciousness') visible instead of smoothing them over; a few small slips |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/69dbc8691040d1d5e2099268?page=321 | Long garbled-OCR Latin on the palm tracked closely throughout; slips on biduum ('two years'), lapidior ('more digestive'), and pla. as Plato |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/6a084ea715c643eb1af422e5?page=442 | Commentary, argument and Caelius's letter all rendered closely, including textual variants; only slip is 'malis orbiculatis' (round apples) as 'round cakes'. |
| 4 | Latin | flash | invention | https://sourcelibrary.org/book/697e23cc8fac627cef65b76b?page=221 | Pythagorean numbers, Scientia Mechanica, signatures, pondere mensura et ordine, harmony of seeds = source; invented context note and a slightly restructured conditional. |
| 4 | Latin | flash |  | https://sourcelibrary.org/book/69af0de99f13b61d0a6c6877?page=164 | Kidney dissection passage (tunic, emulgent vessels, fissure, goose-foot branching) faithful apart from a reshaped clause on the fat |
| 4 | Latin | lite | omission | https://sourcelibrary.org/book/6a09fb0ebd8d6455220a0f3e?page=255 | faithful account of Roman thermae, the emperors' bathing and the list of baths; drops the name Posthumius and flattens the 'some/others' distribution |
