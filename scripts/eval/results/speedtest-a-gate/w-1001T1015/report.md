# Translation corpus audit — w-1001T1015

Judge: opus (source-grounded, reference-free, single candidate; measure = judge rating, NOT accuracy). 55 pages from 55 books, one interior page per book, seed 2026100110.

**Controls gate: PASS** (swap ≥ 93% rated ≤2, drop ≥ 87% flagged omission, repeat ≥ 93% within one; ≥ 10 of each).

## Controls (read first)
- swap (translation of another page): 10/10 rated ≤2, 10/10 flagged wrong_page
- drop (middle ~35% removed): 10/10 flagged omission, 10/10 rated ≤3
- repeat (same item twice): 9/10 exact, 10/10 within 1, 9/10 identical flags

## Corpus estimate (post-stratified by language; 95% CI)
| statistic | est % | CI |
|---|---:|---|
| fidelity 5 | 18.5 | 10.8–28.4 |
| fidelity ≥ 4 | 63.6 | 52.1–75.1 |
| fidelity ≤ 2 | 7.2 | 1–15.9 |
| any major defect | 28.7 | 16.3–41.6 |
| omission | 26.1 | 15.2–37.5 |
| invention | 9.2 | 1.9–16.5 |
| inversion | 8.2 | 0–17.7 |
| untranslated | 0.6 | 0.6–0.6 |
| wrong_language | 0 | 0–0 |
| wrong_page | 0 | 0–0 |
| garble_passthrough | 4.4 | 1.9–9.2 |
| truncated | 1 | 1–1 |
| repetition | 0 | 0–0 |

## By language
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin | 26 | 3.96 | 4 | 0 / 0 / 4 / 19 / 3 | 11.5 | 84.6 | 0 | 34.6 | 0 | 0 | 15.4 |
| Chinese | 8 | 3.5 | 3.5 | 0 / 1 / 3 / 3 / 1 | 12.5 | 50 | 12.5 | 12.5 | 37.5 | 0 | 50 |
| Greek | 6 | 3.67 | 4 | 0 / 1 / 1 / 3 / 1 | 16.7 | 66.7 | 16.7 | 50 | 0 | 0 | 50 |
| Italian | 3 | 4 | 4 | 0 / 0 / 0 / 3 / 0 | 0 | 100 | 0 | 33.3 | 0 | 0 | 33.3 |
| German | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 0 | 0 | 0 | 0 |
| Hebrew | 1 | 2 | 2 | 0 / 1 / 0 / 0 / 0 | 0 | 0 | 100 | 100 | 0 | 0 | 100 |
| Dutch | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Polish | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 100 | 0 | 0 |
| Persian | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 100 | 0 | 0 | 100 |
| Avestan | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Sanskrit | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Old English | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 100 | 0 |
| Quiché Maya | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Akkadian | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 100 | 0 | 0 |
| e | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |

## By translation model arm (unpaired: different pages per arm, model follows the book)
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite | 55 | 3.93 | 4 | 0 / 3 / 9 / 32 / 11 | 20 | 78.2 | 5.5 | 29.1 | 9.1 | 1.8 | 25.5 |

## By language × arm
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Chinese / lite | 8 | 3.5 | 3.5 | 0 / 1 / 3 / 3 / 1 | 12.5 | 50 | 12.5 | 12.5 | 37.5 | 0 | 50 |
| Latin / lite | 26 | 3.96 | 4 | 0 / 0 / 4 / 19 / 3 | 11.5 | 84.6 | 0 | 34.6 | 0 | 0 | 15.4 |
| Greek / lite | 6 | 3.67 | 4 | 0 / 1 / 1 / 3 / 1 | 16.7 | 66.7 | 16.7 | 50 | 0 | 0 | 50 |
| Hebrew / lite | 1 | 2 | 2 | 0 / 1 / 0 / 0 / 0 | 0 | 0 | 100 | 100 | 0 | 0 | 100 |
| German / lite | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 0 | 0 | 0 | 0 |
| Dutch / lite | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Polish / lite | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 100 | 0 | 0 |
| Persian / lite | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 100 | 0 | 0 | 100 |
| Avestan / lite | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Sanskrit / lite | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Italian / lite | 3 | 4 | 4 | 0 / 0 / 0 / 3 / 0 | 0 | 100 | 0 | 33.3 | 0 | 0 | 33.3 |
| Old English / lite | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 100 | 0 |
| Quiché Maya / lite | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Akkadian / lite | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 100 | 0 | 0 |
| e / lite | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |

## By period
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1800s | 24 | 3.88 | 4 | 0 / 2 / 5 / 11 / 6 | 25 | 70.8 | 8.3 | 41.7 | 12.5 | 4.2 | 33.3 |
| 1600s | 12 | 4.08 | 4 | 0 / 0 / 2 / 7 / 3 | 25 | 83.3 | 0 | 8.3 | 8.3 | 0 | 16.7 |
| 1500s | 10 | 3.8 | 4 | 0 / 1 / 1 / 7 / 1 | 10 | 80 | 10 | 20 | 0 | 0 | 30 |
| 1900+ | 4 | 4.25 | 4 | 0 / 0 / 0 / 3 / 1 | 25 | 100 | 0 | 25 | 25 | 0 | 0 |
| unknown | 5 | 3.8 | 4 | 0 / 0 / 1 / 4 / 0 | 0 | 80 | 0 | 40 | 0 | 0 | 20 |

## By arm / prompt label
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite/13 | 55 | 3.93 | 4 | 0 / 3 / 9 / 32 / 11 | 20 | 78.2 | 5.5 | 29.1 | 9.1 | 1.8 | 25.5 |

## Script class
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| non-latin-script | 23 | 3.78 | 4 | 0 / 3 / 5 / 9 / 6 | 26.1 | 65.2 | 13 | 26.1 | 21.7 | 4.3 | 39.1 |
| latin-script | 32 | 4.03 | 4 | 0 / 0 / 4 / 23 / 5 | 15.6 | 87.5 | 0 | 31.3 | 0 | 0 | 15.6 |

## Defect types (primary judge, main items)
| type/severity | n |
|---|---:|
| mistranslation/minor | 43 |
| omission/minor | 15 |
| omission/major | 8 |
| terminology/minor | 7 |
| invention/minor | 6 |
| garble_passthrough/minor | 4 |
| name/minor | 4 |
| mistranslation/major | 4 |
| number/minor | 3 |
| inversion/major | 3 |
| truncated/major | 1 |
| invention/major | 1 |
| untranslated/minor | 1 |

## Worst 25 (primary judge)
| fidelity | language | arm | flags | url | reason |
|---:|---|---|---|---|---|
| 2 | Hebrew | lite | omission, garble_passthrough, truncated | https://sourcelibrary.org/book/69d5ac8c4dc55b8478dddcab?page=237 | Gets the sixth-rule core of 226:1-6 right, but omits the margin commentary and the final rulings on movables and coins, miscounts the sections, and papers over garbled passages. The OCR is heavily cor |
| 2 | Greek | lite | omission | https://sourcelibrary.org/book/69cf7d1ee721f92aaa5b8a41?page=48 | A heavily abridged paraphrase of the commentary: whole notes and the Moschion paragraph are missing, notes 9 and 10 are merged, and hedges are dropped. |
| 2 | Chinese | lite | omission, invention, garble_passthrough | https://sourcelibrary.org/book/69e7289aa409200ea79f02b4?page=65 | The narrative opening is mistranslated in several places, the commentary invents Xie Jin's death and swaps the subject to 'the Emperor', and the closing green-headscarf passage is missing. My reading  |
| 3 | Chinese | lite |  | https://sourcelibrary.org/book/69e72c65a409200ea79f47bd?page=102 | Zhuangzi passage mostly followed, but 子天之合也 becomes 'The Son is the union of Heaven' and Yao's self-reproach becomes a question; 晝夜 rendered 'sun and moon'; rest = source. |
| 3 | Greek | lite | omission | https://sourcelibrary.org/book/69cf7c28878f40c5945f2883?page=190 | Theocritus 15 papyrus lines are followed in outline, but several lines (78, 87-88, 94-95) are garbled into wrong sense and the editor's textual notes at the foot are dropped. |
| 3 | Latin | lite |  | https://sourcelibrary.org/book/69de992d1b234a773e43a4a4?page=105 | Hrotsvit's Pelagius verses mostly followed line by line, but the father's key comparison (exile in chains vs handing over his son) is garbled and several OCR-corrupted words (artis, merentem) rendered |
| 3 | Chinese | lite | invention | https://sourcelibrary.org/book/69e72895a409200ea79f01ff?page=74 | The list of virtues is rendered well, but the commentator's key sentence is misread and the opening narrative adds a 'husband'. |
| 3 | Latin | lite | omission | https://sourcelibrary.org/book/69af42393fd91d3991398cca?page=689 | Digest text of laws 17-22 is rendered accurately, but the entire Gothofredus-style annotation block on the page is dropped. |
| 3 | Chinese | lite | invention, inversion | https://sourcelibrary.org/book/69e72c70a409200ea79f48f9?page=39 | Zhuangzi Xu Wugui: question and answer are assigned to the wrong speakers, the followers' names are misread as horses and an extra 'Yes' is added; the rest is faithful. |
| 3 | Latin | lite | omission | https://sourcelibrary.org/book/69af4554e9a2e38648e40465?page=754 | Nehemiah 11-12 main text rendered faithfully with correct numbers (468, 928, 822, 242, 128, 284, 172), but the full block of eleven critical footnotes is dropped and the Joiacim family pairs are flatt |
| 3 | Persian | lite | omission, garble_passthrough | https://sourcelibrary.org/book/69e729a7a409200ea79f0e08?page=34 | Only the two Persian columns are translated; the Turkish column is dropped. Several garbled hemistichs are passed off as verse. My reading of Persian and Ottoman manuscript text is moderate. |
| 3 | Latin | lite | omission | https://sourcelibrary.org/book/6a51dfaa612243b274119994?page=18 | Drops the page's opening sentences citing Damascene, Augustine and Cicero on envy and detraction; the legal argument of §3-4 is otherwise rendered closely. |
| 4 | Chinese | lite |  | https://sourcelibrary.org/book/69e72698a409200ea79ef8c3?page=165 | Margin comment and narrative of the jade-pipa theft rendered faithfully; one garbled phrase smoothed over. |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/69d8ca80a09828f83ddcb41b?page=195 | The mycological descriptions are accurate overall. There are a few slips: 'albocarneis', 'verit. spec.', and the sneezing-powder aside. |
| 4 | Greek | lite |  | https://sourcelibrary.org/book/69cf7bac878f40c5945f1d8d?page=218 | The commentary is faithful. In the Edmondstone deed the addressee list is misparsed, turning Tkales from a manumitted slave into a parent. |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/6a51e9d12d94f05f3e40978d?page=21 | Accurate on Plato/Aristotle, Philoponus and the Patricius/Theupolus notes; one dropped qualifying phrase. |
| 4 | Latin | lite | omission | https://sourcelibrary.org/book/69cf7d616d17d9f121ccf340?page=142 | Empedocles fragments 50-54 and testimonia rendered accurately (anopaion, Proclus, Aristotle GC/Phys); only the Simplicius reference list is dropped and Tzetzes' lines are folded into a note. |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/6a51df90612243b274119929?page=25 | Corippus verses on Justin and Sophia, the cockcrow omen and the guards are rendered line for line; the 'maximus orbis communis benefactor' clause is misconstrued and monet/movet is conflated. |
| 4 | Latin | lite | omission | https://sourcelibrary.org/book/69afd1f09a8092f06abf0601?page=814 | Greek on burning chalcitis and on misy (Cyprian, gold-shining, star-like) is rendered accurately; the textual footnotes and the parallel Latin version are dropped. |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/6a51e5f42d94f05f3e408192?page=20 | Typography, foreign languages/gymnastics and Aristotle/Felde passages all rendered faithfully; only 'Siberiano anagrammate' mistaken for 'Siberian'. |
| 4 | Latin | lite | omission | https://sourcelibrary.org/book/6a51e4b071ac773e0fe3d1c1?page=9 | The legal argument about consent, compulsion of the father and emancipation is rendered accurately. One run of citations is collapsed into 'and other citations'. |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/6a51e9ba2d94f05f3e4095e1?page=25 | Close rendering of the Beast/ten Kings argument; only the rejicentes et renuentes clause is misconstrued. |
| 4 | Latin | lite | omission | https://sourcelibrary.org/book/69afd1f79a8092f06abf097c?page=557 | Body text on leukoion and Crataeogonon is rendered accurately; the footnote citation list is dropped and one compound plant name is split. |
| 4 | Polish | lite | invention | https://sourcelibrary.org/book/69e750e310ee9075bcdccb66?page=45 | Close line-by-line rendering of Pan Tadeusz; the only problem is a note that misexplains the knotted 'cucumber' belt as food-laden. |
| 4 | Chinese | lite |  | https://sourcelibrary.org/book/69e72c75a409200ea79f4976?page=110 | Zhuangzi Tianxia passage and its margins are rendered faithfully overall; 道 as 'speak' and 多得一察 are misread. |
