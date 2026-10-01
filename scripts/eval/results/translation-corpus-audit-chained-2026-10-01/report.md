# Translation corpus audit — translation-corpus-audit-chained-2026-10-01

Judge: opus (source-grounded, reference-free, single candidate; measure = judge rating, NOT accuracy). 75 pages from 75 books, one interior page per book, seed 20261001.

**Controls gate: PASS** (swap ≥ 93% rated ≤2, drop ≥ 87% flagged omission, repeat ≥ 93% within one; ≥ 10 of each).

## Controls (read first)
- swap (translation of another page): 15/15 rated ≤2, 15/15 flagged wrong_page
- drop (middle ~35% removed): 15/15 flagged omission, 15/15 rated ≤3
- repeat (same item twice): 13/15 exact, 15/15 within 1, 13/15 identical flags

## Corpus estimate (post-stratified by language; 95% CI)
| statistic | est % | CI |
|---|---:|---|
| fidelity 5 | 44.8 | 34.4–56 |
| fidelity ≥ 4 | 85.4 | 81.5–88.6 |
| fidelity ≤ 2 | 0.8 | 0–2.4 |
| any major defect | 6.9 | 3–11.7 |
| omission | 3.9 | 0.8–7.9 |
| invention | 6.6 | 2.7–10.6 |
| inversion | 3 | 0.7–6.2 |
| untranslated | 0.1 | 0.1–0.1 |
| wrong_language | 0 | 0–0 |
| wrong_page | 0.8 | 0–2.4 |
| garble_passthrough | 7.4 | 5.8–9.7 |
| truncated | 0 | 0–0 |
| repetition | 0 | 0–0 |

## By language
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin | 56 | 4.29 | 4 | 1 / 0 / 6 / 24 / 25 | 44.6 | 87.5 | 1.8 | 8.9 | 14.3 | 0 | 14.3 |
| German | 4 | 4.25 | 4 | 0 / 0 / 0 / 3 / 1 | 25 | 100 | 0 | 0 | 0 | 0 | 0 |
| French | 4 | 4.75 | 5 | 0 / 0 / 0 / 1 / 3 | 75 | 100 | 0 | 0 | 0 | 0 | 0 |
| Hebrew | 2 | 5 | 5 | 0 / 0 / 0 / 0 / 2 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| English | 2 | 5 | 5 | 0 / 0 / 0 / 0 / 2 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Greek, English | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 100 | 0 |
| Malay | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 |
| Pali | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 100 | 0 | 0 |
| Italian | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Unknown | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Greek | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Arabic | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |

## By translation model arm (unpaired: different pages per arm, model follows the book)
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite | 75 | 4.35 | 4 | 1 / 0 / 7 / 31 / 36 | 48 | 89.3 | 1.3 | 6.7 | 12 | 1.3 | 12 |

## By language × arm
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin / lite | 56 | 4.29 | 4 | 1 / 0 / 6 / 24 / 25 | 44.6 | 87.5 | 1.8 | 8.9 | 14.3 | 0 | 14.3 |
| Greek, English / lite | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 100 | 0 |
| Hebrew / lite | 2 | 5 | 5 | 0 / 0 / 0 / 0 / 2 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Malay / lite | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 | 100 |
| Pali / lite | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 100 | 0 | 0 |
| English / lite | 2 | 5 | 5 | 0 / 0 / 0 / 0 / 2 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| German / lite | 4 | 4.25 | 4 | 0 / 0 / 0 / 3 / 1 | 25 | 100 | 0 | 0 | 0 | 0 | 0 |
| Italian / lite | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| French / lite | 4 | 4.75 | 5 | 0 / 0 / 0 / 1 / 3 | 75 | 100 | 0 | 0 | 0 | 0 | 0 |
| Unknown / lite | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Greek / lite | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |
| Arabic / lite | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |

## By period
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1500s | 19 | 4.47 | 5 | 0 / 0 / 1 / 8 / 10 | 52.6 | 94.7 | 0 | 10.5 | 15.8 | 0 | 5.3 |
| unknown | 37 | 4.27 | 4 | 1 / 0 / 4 / 15 / 17 | 45.9 | 86.5 | 2.7 | 8.1 | 13.5 | 0 | 16.2 |
| 1900+ | 6 | 4.5 | 4.5 | 0 / 0 / 0 / 3 / 3 | 50 | 100 | 0 | 0 | 16.7 | 16.7 | 0 |
| 1800s | 2 | 4 | 4 | 0 / 0 / 1 / 0 / 1 | 50 | 50 | 0 | 0 | 0 | 0 | 50 |
| 1600s | 7 | 4.43 | 5 | 0 / 0 / 1 / 2 / 4 | 57.1 | 85.7 | 0 | 0 | 0 | 0 | 14.3 |
| pre-1500 | 3 | 4 | 4 | 0 / 0 / 0 / 3 / 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 |
| 1700s | 1 | 5 | 5 | 0 / 0 / 0 / 0 / 1 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |

## By arm / prompt label
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite/13 | 73 | 4.33 | 4 | 1 / 0 / 7 / 31 / 34 | 46.6 | 89 | 1.4 | 6.8 | 12.3 | 1.4 | 12.3 |
| lite/2 | 2 | 5 | 5 | 0 / 0 / 0 / 0 / 2 | 100 | 100 | 0 | 0 | 0 | 0 | 0 |

## Script class
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| latin-script | 67 | 4.34 | 4 | 1 / 0 / 6 / 28 / 32 | 47.8 | 89.6 | 1.5 | 7.5 | 11.9 | 0 | 11.9 |
| non-latin-script | 8 | 4.38 | 4.5 | 0 / 0 / 1 / 3 / 4 | 50 | 87.5 | 0 | 0 | 12.5 | 12.5 | 12.5 |

## Defect types (primary judge, main items)
| type/severity | n |
|---|---:|
| mistranslation/minor | 43 |
| omission/minor | 8 |
| terminology/minor | 8 |
| invention/minor | 5 |
| invention/major | 4 |
| name/minor | 3 |
| number/minor | 3 |
| inversion/minor | 2 |
| inversion/major | 2 |
| mistranslation/major | 2 |
| garble_passthrough/minor | 2 |
| untranslated/minor | 1 |
| wrong_page/major | 1 |
| omission/major | 1 |
| garble_passthrough/major | 1 |

## Worst 25 (primary judge)
| fidelity | language | arm | flags | url | reason |
|---:|---|---|---|---|---|
| 1 | Latin | lite | omission, invention, wrong_page | https://sourcelibrary.org/book/69b6307b1c1c21a3738028f6?page=17 | Translation renders the preceding page (Q.11 and opening of Q.12); the source's censure-absolution argument and Q.13 on whom to deny absolution are absent. |
| 3 | Latin | lite | invention | https://sourcelibrary.org/book/6a4bdeb3913003fb726ad383?page=4 | The few legible words (Chapter, 5, VI. 4) are rendered, but the translation asserts a chapter title, shelfmark and topic that the near-illegible source does not carry. |
| 3 | Malay | lite | inversion | https://sourcelibrary.org/book/6a20326818654bf8e1902c67?page=19 | Narrative outline (summons, preparations, departure by litter to Mughal) is right, but the princess's farewell scene is garbled with wrong subject and speaker; I read Jawi only moderately. |
| 3 | Latin | lite | invention | https://sourcelibrary.org/book/6a08578915c643eb1af5bc77?page=35 | Body of Valla's diminutives discussion is accurate, but an opening passage is imported from elsewhere and the Curtius example of curricula as chariots is mistranslated. |
| 3 | Latin | lite | inversion | https://sourcelibrary.org/book/6a4b7f18998fdd30218fbf6a?page=20 | Ulfilas discussion, Mareschall quote, Sixtus Senensis and the epiousion note are faithful, but the key concessive sentence is turned into its opposite. |
| 3 | Latin | lite | invention | https://sourcelibrary.org/book/6a4a82c0449c2c48ca6ed201?page=18 | Body on unicorn-horn fraud and sweating in presence of poison is faithful, but the translation appends a whole paragraph (coin, bread, Kergerus) that the source does not contain. |
| 3 | Latin | lite |  | https://sourcelibrary.org/book/6a44d0f0823724ce1613ef5f?page=20 | Strabo, Servius, Lucretius, the Praesus coin and the Cabiri epithets are rendered well, but the Arnobius sentence is misparsed and the Rhea/Curetes narrative has two garbled clauses. |
| 3 | Latin | lite | garble_passthrough | https://sourcelibrary.org/book/6a4a7e7320c510eceebc581a?page=16 | OCR of a mirrored offset page is largely incoherent; translation papers over it with fluent theological prose and misses the gratia gratum faciens term. |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/69b6305c1c1c21a37380106a?page=41 | paradigm of audio and chapter VIII rendered faithfully; one clause construed as 'there are participles' instead of 'participles are' |
| 4 | Latin | lite | inversion | https://sourcelibrary.org/book/6a4b05c30d1fa55f9988be08?page=18 | Apostrophe to the Catholics and the ox-and-ass proverb rendered well; one clause switches the subject of 'deuorent' to the Lutherans. |
| 4 | Greek, English | lite | untranslated | https://sourcelibrary.org/book/69b21ecc4522d8c1db3bd618?page=22 | bilingual Loeb page: Greek prose translated accurately and the English column reproduced; Greek verse left untranslated and one minor slip on οὐ πονηρός |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/69b51d2cf23ccdcced306a10?page=226 | nine modes of fire and the four-fire classification rendered faithfully; minor slips on 'solis in ariete', 'a leni' and 'quouis igni' |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/6a49ef8160a0c3556c216a8e?page=23 | Types of induciae, Literae Securitatis and Literae Status et Justitii with all citations rendered accurately; only the closing formula is garbled. |
| 4 | Pali | lite | invention | https://sourcelibrary.org/book/69b99d316ed9e04909908baa?page=22 | Etymology of vimāna/Vimānavatthu and attribution to Mahāmoggallāna rendered accurately; invented continuation meta and one loose clause; my Pali reading is moderate. |
| 4 | Latin | lite | omission | https://sourcelibrary.org/book/69b62fcc1c1c21a3737fabf9?page=24 | Luke's occasion and scope rendered faithfully; drops the opening fragment and slightly blurs 'humanitatis historiam' and 'ad gratificandum pronis' |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/6a4b9537a25898ec8788aaa9?page=11 | Pererius quote, Augustine, Schaff on Onkelos, Rivet on Jonathan, and the Hackspan Sabbath saying all follow the source; one garbled clause in §V about which signification the Targums favoured. Hebrew/ |
| 4 | Latin | lite | invention | https://sourcelibrary.org/book/6a4dea11a7fbe1b1dcb8cbe4?page=21 | Areas in iugera and the sphere-volume rule rendered with correct numbers (18/1600, 24/88000, 21/6400, 343, 163⅓); the final number is supplied beyond the page break. |
| 4 | Latin | lite | garble_passthrough | https://sourcelibrary.org/book/69b6318d1c1c21a37380862a?page=27 | Three kinds of prophecy (natural foreknowledge, improper prophecy in vision/speech/operation, true prophecy by degrees) rendered faithfully with Daniel, Caiaphas, Jephthah, Jeremiah, Samuel examples;  |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/6a4a5e9b4107674feb04d718?page=24 | School-exam invitation rendered faithfully overall; Livy clause and P.P. formula slightly misread. |
| 4 | Latin | lite | invention | https://sourcelibrary.org/book/69b62fe81c1c21a3737fc0b3?page=21 | Commentary on 2 Cor 1:8 (prodiegema, Asian affliction, ebarethemen metaphor) rendered accurately; only the page-final broken word is filled in by guess. |
| 4 | French | lite |  | https://sourcelibrary.org/book/6aaaa175e77fda33e8d3fcd8?page=372 | Temperature extremes, well-water table (all numbers match) and section headings are faithful; hivernage is calqued as 'wintering season'. |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/6a4c97979c6f8cb186b87f0b?page=14 | Catharine/Laurel panegyric rendered closely throughout; small slips in a garbled Tiberius clause and a literalism ('explains its top'). |
| 4 | Latin | lite | invention | https://sourcelibrary.org/book/6a50738b80b7658fae26244a?page=18 | Prayer couplets rendered faithfully overall; the 'ne' purpose clause softened and an invented previous-page meta prepended. |
| 4 | Latin | lite | omission | https://sourcelibrary.org/book/6a4c083f55f94b596d9b1bc6?page=9 | Dense citation apparatus on advocates, Auscultantes and pedaneous judges rendered accurately; two small slips in §11. |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/69b630221c1c21a3737fdf24?page=30 | Body text on the body politic, respublica/populus/plebs and the etymology of publicus is faithful; minor slips in the Publicola sentence and one expanded margin citation. |

## Seeded vs seam pages

| stratum | n | fidelity ≥ 4 | any major defect | omission | invention |
|---|---:|---:|---:|---:|---:|
| seeded | 60 | 88.3% (53/60) | 11.7% (7/60) | 8.3% | 13.3% |
| seam | 15 | 93.3% (14/15) | 13.3% (2/15) | 0% | 6.7% |

Unweighted raw proportions within each stratum; judged, not accuracy.
