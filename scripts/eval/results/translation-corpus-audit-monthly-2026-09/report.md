# Translation corpus audit — translation-corpus-audit-monthly-2026-09

Judge: opus (source-grounded, reference-free, single candidate; measure = judge rating, NOT accuracy). 103 pages from 103 books, one interior page per book, seed 20260930.

**Controls gate: PASS** (swap ≥ 93% rated ≤2, drop ≥ 87% flagged omission, repeat ≥ 93% within one; ≥ 10 of each).

## Controls (read first)
- swap (translation of another page): 15/15 rated ≤2, 15/15 flagged wrong_page
- drop (middle ~35% removed): 15/15 flagged omission, 14/15 rated ≤3
- repeat (same item twice): 13/15 exact, 15/15 within 1, 10/15 identical flags

## Corpus estimate (post-stratified by language; 95% CI)
| statistic | est % | CI |
|---|---:|---|
| fidelity 5 | 40.1 | 31.1–50.3 |
| fidelity ≥ 4 | 85.6 | 76.9–93 |
| fidelity ≤ 2 | 2.9 | 0.4–5.4 |
| any major defect | 14.3 | 7.1–22.5 |
| omission | 12.7 | 5.5–21.1 |
| invention | 15.7 | 8–24.2 |
| inversion | 4.6 | 1–9.9 |
| untranslated | 0 | 0–0 |
| wrong_language | 0 | 0–0 |
| wrong_page | 0 | 0–0 |
| garble_passthrough | 9.3 | 3.2–16.3 |
| truncated | 0.8 | 0–2.5 |
| repetition | 0 | 0–0 |

## By language
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin | 19 | 4.05 | 4 | 0 / 0 / 3 / 12 / 4 | 21.1 | 84.2 | 0 | 15.8 | 21.1 | 0 | 15.8 |
| English | 12 | 4.67 | 5 | 0 / 0 / 1 / 2 / 9 | 75 | 91.7 | 0 | 8.3 | 8.3 | 0 | 8.3 |
| German | 12 | 4.67 | 5 | 0 / 0 / 0 / 4 / 8 | 66.7 | 100 | 0 | 0 | 8.3 | 0 | 0 |
| Greek | 12 | 3.5 | 4 | 1 / 2 / 1 / 6 / 2 | 16.7 | 66.7 | 25 | 33.3 | 16.7 | 0 | 33.3 |
| French | 8 | 4.63 | 5 | 0 / 0 / 0 / 3 / 5 | 62.5 | 100 | 0 | 0 | 0 | 0 | 0 |
| Italian | 6 | 4.67 | 5 | 0 / 0 / 0 / 2 / 4 | 66.7 | 100 | 0 | 16.7 | 0 | 0 | 0 |
| Dutch | 6 | 4.33 | 4 | 0 / 0 / 0 / 4 / 2 | 33.3 | 100 | 0 | 0 | 16.7 | 0 | 0 |
| Chinese | 6 | 3.67 | 3.5 | 0 / 1 / 2 / 1 / 2 | 33.3 | 50 | 16.7 | 0 | 33.3 | 0 | 50 |
| Sanskrit | 4 | 3.75 | 3.5 | 0 / 0 / 2 / 1 / 1 | 25 | 50 | 0 | 25 | 50 | 0 | 75 |
| Hebrew | 4 | 4 | 4 | 0 / 0 / 1 / 2 / 1 | 25 | 75 | 0 | 0 | 0 | 0 | 0 |
| Arabic | 4 | 4 | 4 | 0 / 0 / 1 / 2 / 1 | 25 | 75 | 0 | 50 | 0 | 0 | 25 |
| Tibetan | 4 | 4.25 | 4.5 | 0 / 0 / 1 / 1 / 2 | 50 | 75 | 0 | 0 | 50 | 0 | 0 |
| Korean | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 0 | 50 | 0 | 0 |
| Spanish | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 0 | 0 | 0 | 0 |
| Japanese | 2 | 3 | 3 | 0 / 0 / 2 / 0 / 0 | 0 | 0 | 0 | 0 | 50 | 0 | 50 |

## By translation model arm (unpaired: different pages per arm, model follows the book)
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite | 57 | 4.16 | 4 | 1 / 1 / 9 / 23 / 23 | 40.4 | 80.7 | 3.5 | 15.8 | 10.5 | 0 | 15.8 |
| flash | 46 | 4.24 | 4 | 0 / 2 / 5 / 19 / 20 | 43.5 | 84.8 | 4.3 | 6.5 | 23.9 | 0 | 15.2 |

## By language × arm
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin / lite | 16 | 4.06 | 4 | 0 / 0 / 3 / 9 / 4 | 25 | 81.3 | 0 | 18.8 | 6.3 | 0 | 18.8 |
| Latin / flash | 3 | 4 | 4 | 0 / 0 / 0 / 3 / 0 | 0 | 100 | 0 | 0 | 100 | 0 | 0 |
| English / flash | 7 | 4.71 | 5 | 0 / 0 / 0 / 2 / 5 | 71.4 | 100 | 0 | 0 | 14.3 | 0 | 0 |
| English / lite | 5 | 4.6 | 5 | 0 / 0 / 1 / 0 / 4 | 80 | 80 | 0 | 20 | 0 | 0 | 20 |
| German / lite | 4 | 4.75 | 5 | 0 / 0 / 0 / 1 / 3 | 75 | 100 | 0 | 0 | 0 | 0 | 0 |
| German / flash | 8 | 4.63 | 5 | 0 / 0 / 0 / 3 / 5 | 62.5 | 100 | 0 | 0 | 12.5 | 0 | 0 |
| Greek / flash | 4 | 3.75 | 4 | 0 / 1 / 0 / 2 / 1 | 25 | 75 | 25 | 25 | 25 | 0 | 25 |
| Greek / lite | 8 | 3.38 | 4 | 1 / 1 / 1 / 4 / 1 | 12.5 | 62.5 | 25 | 37.5 | 12.5 | 0 | 37.5 |
| French / flash | 4 | 4.5 | 4.5 | 0 / 0 / 0 / 2 / 2 | 50 | 100 | 0 | 0 | 0 | 0 | 0 |
| French / lite | 4 | 4.75 | 5 | 0 / 0 / 0 / 1 / 3 | 75 | 100 | 0 | 0 | 0 | 0 | 0 |
| Italian / lite | 3 | 4.67 | 5 | 0 / 0 / 0 / 1 / 2 | 66.7 | 100 | 0 | 33.3 | 0 | 0 | 0 |
| Italian / flash | 3 | 4.67 | 5 | 0 / 0 / 0 / 1 / 2 | 66.7 | 100 | 0 | 0 | 0 | 0 | 0 |
| Dutch / lite | 4 | 4.5 | 4.5 | 0 / 0 / 0 / 2 / 2 | 50 | 100 | 0 | 0 | 0 | 0 | 0 |
| Dutch / flash | 2 | 4 | 4 | 0 / 0 / 0 / 2 / 0 | 0 | 100 | 0 | 0 | 50 | 0 | 0 |
| Chinese / flash | 5 | 3.6 | 3 | 0 / 1 / 2 / 0 / 2 | 40 | 40 | 20 | 0 | 40 | 0 | 60 |
| Chinese / lite | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |
| Sanskrit / lite | 2 | 4 | 4 | 0 / 0 / 1 / 0 / 1 | 50 | 50 | 0 | 50 | 50 | 0 | 50 |
| Sanskrit / flash | 2 | 3.5 | 3.5 | 0 / 0 / 1 / 1 / 0 | 0 | 50 | 0 | 0 | 50 | 0 | 100 |
| Hebrew / lite | 3 | 4.33 | 4 | 0 / 0 / 0 / 2 / 1 | 33.3 | 100 | 0 | 0 | 0 | 0 | 0 |
| Hebrew / flash | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Arabic / flash | 3 | 3.67 | 4 | 0 / 0 / 1 / 2 / 0 | 0 | 66.7 | 0 | 66.7 | 0 | 0 | 33.3 |
| Arabic / lite | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Tibetan / flash | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Tibetan / lite | 3 | 4 | 4 | 0 / 0 / 1 / 1 / 1 | 33.3 | 66.7 | 0 | 0 | 66.7 | 0 | 0 |
| Korean / flash | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 0 | 50 | 0 | 0 |
| Spanish / flash | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Spanish / lite | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |
| Japanese / lite | 2 | 3 | 3 | 0 / 0 / 2 / 0 / 0 | 0 | 0 | 0 | 0 | 50 | 0 | 50 |

## By period
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| pre-1500 | 12 | 3.92 | 4 | 0 / 0 / 2 / 9 / 1 | 8.3 | 83.3 | 0 | 25 | 0 | 0 | 16.7 |
| 1600s | 16 | 4.44 | 5 | 0 / 0 / 2 / 5 / 9 | 56.3 | 87.5 | 0 | 0 | 25 | 0 | 6.3 |
| unknown | 15 | 4.2 | 4 | 0 / 1 / 2 / 5 / 7 | 46.7 | 80 | 6.7 | 13.3 | 20 | 0 | 13.3 |
| 1800s | 21 | 3.86 | 4 | 1 / 1 / 4 / 9 / 6 | 28.6 | 71.4 | 9.5 | 28.6 | 28.6 | 0 | 28.6 |
| 1500s | 17 | 4.41 | 4 | 0 / 0 / 1 / 8 / 8 | 47.1 | 94.1 | 0 | 0 | 5.9 | 0 | 5.9 |
| 1700s | 14 | 4.29 | 4.5 | 0 / 0 / 3 / 4 / 7 | 50 | 78.6 | 0 | 0 | 14.3 | 0 | 14.3 |
| 1900+ | 8 | 4.38 | 5 | 0 / 1 / 0 / 2 / 5 | 62.5 | 87.5 | 12.5 | 12.5 | 12.5 | 0 | 25 |

## By arm / prompt label
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite/11 | 22 | 4.14 | 4 | 0 / 0 / 5 / 9 / 8 | 36.4 | 77.3 | 0 | 9.1 | 13.6 | 0 | 18.2 |
| lite/v1 | 6 | 4.5 | 5 | 0 / 0 / 1 / 1 / 4 | 66.7 | 83.3 | 0 | 33.3 | 0 | 0 | 16.7 |
| lite/v10 | 27 | 4.19 | 4 | 0 / 1 / 3 / 13 / 10 | 37 | 85.2 | 3.7 | 18.5 | 7.4 | 0 | 11.1 |
| flash/v1 | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 100 | 0 | 0 |
| flash/v10 | 4 | 4 | 4 | 0 / 0 / 0 / 4 / 0 | 0 | 100 | 0 | 0 | 50 | 0 | 0 |
| flash/v5.2026-02 | 5 | 4 | 4 | 0 / 0 / 0 / 5 / 0 | 0 | 100 | 0 | 0 | 40 | 0 | 0 |
| flash/v2 | 21 | 4.52 | 5 | 0 / 1 / 2 / 3 / 15 | 71.4 | 85.7 | 4.8 | 0 | 23.8 | 0 | 19 |
| lite/1 | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/11 | 11 | 4 | 4 | 0 / 1 / 1 / 6 / 3 | 27.3 | 81.8 | 9.1 | 18.2 | 9.1 | 0 | 18.2 |
| lite/v11-retx | 1 | 1 | 1 | 1 / 0 / 0 / 0 / 0 | 0 | 0 | 100 | 0 | 100 | 0 | 100 |
| flash/12 | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| flash/v5.1.2026-03b | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| flash/13 | 2 | 4 | 4 | 0 / 0 / 1 / 0 / 1 | 50 | 50 | 0 | 50 | 0 | 0 | 50 |

## Script class
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| latin-script | 65 | 4.45 | 5 | 0 / 0 / 4 / 28 / 33 | 50.8 | 93.8 | 0 | 7.7 | 10.8 | 0 | 6.2 |
| non-latin-script | 38 | 3.76 | 4 | 1 / 3 / 10 / 14 / 10 | 26.3 | 63.2 | 10.5 | 18.4 | 26.3 | 0 | 31.6 |

## Defect types (primary judge, main items)
| type/severity | n |
|---|---:|
| mistranslation/minor | 63 |
| invention/minor | 15 |
| terminology/minor | 13 |
| omission/minor | 10 |
| garble_passthrough/minor | 7 |
| name/minor | 6 |
| invention/major | 5 |
| garble_passthrough/major | 4 |
| omission/major | 4 |
| number/minor | 4 |
| mistranslation/major | 3 |
| inversion/minor | 3 |
| untranslated/minor | 2 |
| inversion/major | 2 |
| truncated/major | 1 |
| number/major | 1 |

## Worst 25 (primary judge)
| fidelity | language | arm | flags | url | reason |
|---:|---|---|---|---|---|
| 1 | Greek | lite | invention, garble_passthrough | https://sourcelibrary.org/book/6a3eb56b5598be95b4ffddeb?page=354 | The source is an illegible papyrus facsimile with no transcribed text ('[...]'), yet the translation makes up two columns of Epicurean philosophical content. |
| 2 | Greek | flash | omission, truncated | https://sourcelibrary.org/book/69cf7bb9878f40c5945f1eea?page=189 | first ~15 lines faithful (thousand hoplites, hundred cavalry, Cadmea, Ismenias/Leontides factions) but output breaks off mid-sentence; the Ismenias-Atticizing clause and the fragmentary column are dro |
| 2 | Greek | lite | omission | https://sourcelibrary.org/book/699246bebc722ec0ee81286a?page=96 | main text (II.4–6: grief, prayer, sleep, mountain, heavens opened, 'Levi, Levi, enter') is accurate, but the apparatus that fills most of the page, including a full prayer, is only summarised |
| 2 | Chinese | flash | invention, garble_passthrough | https://sourcelibrary.org/book/6992cad3d4d545ae73feeb78?page=1 | source is a badly corrupted Vinaya-commentary OCR; translation papers over it with fluent invented structure and names; hard to verify, weak confidence. |
| 3 | Latin | lite | garble_passthrough | https://sourcelibrary.org/book/69f32e3c876dd827cbc439d4?page=437 | Margins and the lay-patronage and visitation passages track the source, but the heavily garbled first block is smoothed into confident prose that the OCR cannot support; Latin OCR is too corrupt to ju |
| 3 | Latin | lite | inversion | https://sourcelibrary.org/book/69dbc8441040d1d5e20981a4?page=49 | worm-cutting episode rendered well, but the final sentence misreads Augustine's point (he would have yielded to the materialists) and the young men's bringing the pieces becomes 'we' |
| 3 | Latin | lite | invention, garble_passthrough | https://sourcelibrary.org/book/69b51e2cefd8df28f2db2159?page=74 | Main text (magistrates, vexillifer, Conestabilis, Chapter IV on Eugubine territory) = source; the margin inscription, which the source prints for scholars to discuss, is given an invented fluent readi |
| 3 | English | lite | omission | https://sourcelibrary.org/book/69ee475f6dd925d126f421de?page=385 | The body text's opening sentence is dropped. The Naogeorgus Latin verse and its Hospinian citation are replaced by a placeholder. The Googe verse and the Whimzies passage are otherwise faithful. |
| 3 | Greek | lite |  | https://sourcelibrary.org/book/6a08573115c643eb1af5aeae?page=297 | Tiresias prophecy (birds, staff, long life, wisdom among the dead, Pallas's nod) rendered well, but the opening Actaeon couplet and the shared-archery line are misconstrued. |
| 3 | Chinese | flash |  | https://sourcelibrary.org/book/6a0a4efc7cd8e1e3d0f49dfe?page=22 | Table structure is kept, but every phonological entry is glossed as its dictionary meaning, which misrepresents a sound-classification chart. I judge Chinese phonology tables with limited confidence. |
| 3 | Chinese | flash | invention | https://sourcelibrary.org/book/6992ce273ea667fbac82854a?page=33 | The two captions 戈氅 and 儀鍠氅 are rendered correctly, but the translation invents a book title, volume, section and page number, plus factual notes |
| 3 | Sanskrit | flash | invention, inversion | https://sourcelibrary.org/book/69906461ef12272ffdc91870?page=304 | The 63-variant count and the 7/49/56/63 derivation = source, but the radius-square number is wrong, a note invents a wrong fact, and the north/south sign rule is reversed |
| 3 | Sanskrit | lite | omission, invention | https://sourcelibrary.org/book/69e80662fdad300064d9ed7c?page=342 | reasons 3–9 for the primacy of dravya rendered correctly (merging Sanskrit and Hindi), but a 10th definition is added that the page does not carry. |
| 3 | Hebrew | flash | garble_passthrough | https://sourcelibrary.org/book/69c1bbbb8522835be8460594?page=1 | follows the garbled Kabbalistic instructions line by line with heavy glossing; several gematria values misread and some garble smoothed into doctrine-sounding prose; Hebrew OCR here is weak and my rea |
| 3 | Arabic | flash | omission | https://sourcelibrary.org/book/6a20329818654bf8e19031b7?page=64 | gist of the commentary on al-Kisāʾī, hamzat al-waṣl and imperative construction is right, but many clauses are elided with ellipses; Arabic grammar read moderately. |
| 3 | Tibetan | lite | invention, garble_passthrough | https://sourcelibrary.org/book/69e7482f85f786e884a4bb0c?page=341 | follows the litany line by line but misreads deity names in the list (Akashagarbha, Sarvanivaranaviskambhin) and papers over garbled closing lines; my Tibetan reading of this OCR is weak |
| 3 | Japanese | lite | invention, garble_passthrough | https://sourcelibrary.org/book/69e75abfb3d509fcb7a48ea1?page=8 | Recognisable anchors (nembutsu, Tomomori's son 若章 read as Tomoakira, battle of 2nd month 7th day, sotoba, 一樹の陰 一河の流れ 他生の縁) are right, but the garbled connecting text is rendered as confident prose; I  |
| 3 | Japanese | lite |  | https://sourcelibrary.org/book/69e8069cfdad300064d9fc55?page=19 | The path of the eighth nerve (medulla, dura, cranium, heart/lungs/stomach, cervical cluster) is correct. The opening sentence is misconstrued, and the Dutch-derived transliterations are replaced by gu |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/69dbcc230f8c5edf20f463c5?page=394 | This garbled Aquinas commentary is rendered faithfully through the objections, the sacrament-versus-sacramental distinction and the three senses of 'one'. The garbled sed contra is left incoherent and |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/69944b5e1ba8351377906ed8?page=210 | Philo's argument on Esau's blessing and the allegorical 'brothers' is rendered faithfully; there are small slips on areis arboribusque, Virtute and Quare. |
| 4 | Latin | flash | invention | https://sourcelibrary.org/book/6952e47c77f38f6761bc7ca8?page=104 | Chapters I-III (sampling, separating spirits in the cucurbit, evaporation and coagulation, alum from attramentum, salt from halinitrum) rendered accurately; the only defect is an invented meta line ab |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/69dbcb491040d1d5e20b5588?page=136 | both Pliny letters (to Nepos, to Falco on Sentius Augurinus) rendered faithfully; slips on 'mihi'→'you' and the sense of 'amor eius'. |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/69a5ee5abfd8cafd91e4386a?page=320 | Chapters XXIV–XXVI are rendered fully with all game names. The list of which game excels in what (utilitate armorum, salubritate pilae…) is misconstrued, and a few terms are loose. |
| 4 | Latin | lite | omission | https://sourcelibrary.org/book/69e72c3ca409200ea79f42e2?page=18 | Hesiod's ages rendered closely (Cadmus, Troy, Tyndaris, iron age, filial impiety); drops 'Elysian' and misses the born-grey sense of 'natis'. |
| 4 | Latin | flash | invention | https://sourcelibrary.org/book/69c851df6c6f3cc53c853242?page=26 | Barclay/Schwenckfeld/Halberstadt argument rendered faithfully; slips on 'tertia hominis parte' and 'act. V.', plus an invented meta summary of the previous page. |
