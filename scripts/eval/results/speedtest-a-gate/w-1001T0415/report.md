# Translation corpus audit — w-1001T0415

Judge: opus (source-grounded, reference-free, single candidate; measure = judge rating, NOT accuracy). 55 pages from 55 books, one interior page per book, seed 2026100104.

**Controls gate: PASS** (swap ≥ 93% rated ≤2, drop ≥ 87% flagged omission, repeat ≥ 93% within one; ≥ 10 of each).

## Controls (read first)
- swap (translation of another page): 10/10 rated ≤2, 10/10 flagged wrong_page
- drop (middle ~35% removed): 10/10 flagged omission, 9/10 rated ≤3
- repeat (same item twice): 9/10 exact, 10/10 within 1, 9/10 identical flags

## Corpus estimate (post-stratified by language; 95% CI)
| statistic | est % | CI |
|---|---:|---|
| fidelity 5 | 30.4 | 19.2–43.4 |
| fidelity ≥ 4 | 80.4 | 70.9–89.1 |
| fidelity ≤ 2 | 3.1 | 0.8–7.8 |
| any major defect | 16.8 | 7.3–27.3 |
| omission | 17.4 | 7.4–28.8 |
| invention | 10.3 | 3.1–19 |
| inversion | 2.3 | 0–7 |
| untranslated | 2.3 | 0–7 |
| wrong_language | 0 | 0–0 |
| wrong_page | 2.3 | 0–7 |
| garble_passthrough | 5.4 | 0–12.4 |
| truncated | 0.7 | 0–2.1 |
| repetition | 0 | 0–0 |

## By language
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Latin | 28 | 4.04 | 4 | 1 / 0 / 3 / 17 / 7 | 25 | 85.7 | 3.6 | 21.4 | 10.7 | 3.6 | 17.9 |
| Greek | 11 | 4.36 | 4 | 0 / 0 / 1 / 5 / 5 | 45.5 | 90.9 | 0 | 9.1 | 9.1 | 0 | 9.1 |
| French | 6 | 4.67 | 5 | 0 / 0 / 0 / 2 / 4 | 66.7 | 100 | 0 | 0 | 0 | 0 | 0 |
| German | 5 | 4.6 | 5 | 0 / 0 / 0 / 2 / 3 | 60 | 100 | 0 | 20 | 0 | 0 | 20 |
| Russian | 3 | 4 | 4 | 0 / 0 / 1 / 1 / 1 | 33.3 | 66.7 | 0 | 0 | 33.3 | 0 | 33.3 |
| Dutch | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 100 | 0 | 0 | 100 |
| Greek, English | 1 | 2 | 2 | 0 / 1 / 0 / 0 / 0 | 0 | 0 | 100 | 100 | 100 | 0 | 100 |

## By translation model arm (unpaired: different pages per arm, model follows the book)
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite | 55 | 4.16 | 4 | 1 / 1 / 6 / 27 / 20 | 36.4 | 85.5 | 3.6 | 18.2 | 10.9 | 1.8 | 18.2 |

## By language × arm
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| French / lite | 6 | 4.67 | 5 | 0 / 0 / 0 / 2 / 4 | 66.7 | 100 | 0 | 0 | 0 | 0 | 0 |
| Greek / lite | 11 | 4.36 | 4 | 0 / 0 / 1 / 5 / 5 | 45.5 | 90.9 | 0 | 9.1 | 9.1 | 0 | 9.1 |
| Latin / lite | 28 | 4.04 | 4 | 1 / 0 / 3 / 17 / 7 | 25 | 85.7 | 3.6 | 21.4 | 10.7 | 3.6 | 17.9 |
| Russian / lite | 3 | 4 | 4 | 0 / 0 / 1 / 1 / 1 | 33.3 | 66.7 | 0 | 0 | 33.3 | 0 | 33.3 |
| Dutch / lite | 1 | 3 | 3 | 0 / 0 / 1 / 0 / 0 | 0 | 0 | 0 | 100 | 0 | 0 | 100 |
| German / lite | 5 | 4.6 | 5 | 0 / 0 / 0 / 2 / 3 | 60 | 100 | 0 | 20 | 0 | 0 | 20 |
| Greek, English / lite | 1 | 2 | 2 | 0 / 1 / 0 / 0 / 0 | 0 | 0 | 100 | 100 | 100 | 0 | 100 |

## By period
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1500s | 25 | 4.28 | 4 | 1 / 0 / 0 / 14 / 10 | 40 | 96 | 4 | 12 | 12 | 4 | 8 |
| 1800s | 12 | 4.08 | 4 | 0 / 0 / 3 / 5 / 4 | 33.3 | 75 | 0 | 25 | 16.7 | 0 | 33.3 |
| unknown | 4 | 4.25 | 4 | 0 / 0 / 0 / 3 / 1 | 25 | 100 | 0 | 0 | 0 | 0 | 0 |
| 1700s | 2 | 4.5 | 4.5 | 0 / 0 / 0 / 1 / 1 | 50 | 100 | 0 | 0 | 0 | 0 | 0 |
| 1900+ | 8 | 4.13 | 4.5 | 0 / 1 / 1 / 2 / 4 | 50 | 75 | 12.5 | 37.5 | 12.5 | 0 | 37.5 |
| pre-1500 | 3 | 3.33 | 3 | 0 / 0 / 2 / 1 / 0 | 0 | 33.3 | 0 | 0 | 0 | 0 | 33.3 |
| 1600s | 1 | 4 | 4 | 0 / 0 / 0 / 1 / 0 | 0 | 100 | 0 | 100 | 0 | 0 | 0 |

## By arm / prompt label
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| lite/13 | 55 | 4.16 | 4 | 1 / 1 / 6 / 27 / 20 | 36.4 | 85.5 | 3.6 | 18.2 | 10.9 | 1.8 | 18.2 |

## Script class
| cell | n books | mean | median | 1/2/3/4/5 | %5 | %≥4 | %≤2 | %omission | %invention | %untransl. | %any major |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| latin-script | 40 | 4.17 | 4 | 1 / 0 / 4 / 21 / 14 | 35 | 87.5 | 2.5 | 20 | 7.5 | 2.5 | 17.5 |
| non-latin-script | 15 | 4.13 | 4 | 0 / 1 / 2 / 6 / 6 | 40 | 80 | 6.7 | 13.3 | 20 | 0 | 20 |

## Defect types (primary judge, main items)
| type/severity | n |
|---|---:|
| mistranslation/minor | 24 |
| terminology/minor | 9 |
| omission/minor | 6 |
| omission/major | 6 |
| invention/minor | 5 |
| garble_passthrough/minor | 3 |
| invention/major | 2 |
| number/minor | 2 |
| wrong_page/major | 1 |
| truncated/minor | 1 |
| name/minor | 1 |
| untranslated/minor | 1 |
| inversion/major | 1 |
| garble_passthrough/major | 1 |

## Worst 25 (primary judge)
| fidelity | language | arm | flags | url | reason |
|---:|---|---|---|---|---|
| 1 | Latin | lite | omission, invention, wrong_page | https://sourcelibrary.org/book/69b62fb81c1c21a3737f999a?page=270 | The translation is of a different passage (Baptism/Supper definitions and De Ecclesia); none of the source’s argument on the seal, sign and relation appears. |
| 2 | Greek, English | lite | omission, invention | https://sourcelibrary.org/book/69b21ecc4522d8c1db3bd618?page=143 | Middle of XIV matches, but the opening paragraph is lost and roughly half the output imports text from the following pages of the Life of Lysander. |
| 3 | Russian | lite | invention | https://sourcelibrary.org/book/69af0fb1024c2bf29528514f?page=711 | The body faithfully renders the history of the Marriage manuscript, but it closes with a year and three sentences the source does not have (quoted incipit and explicit, the scrap taken abroad). |
| 3 | Latin | lite | omission | https://sourcelibrary.org/book/69af2335c6df16b7172a9b0b?page=720 | Servius scholia on lines 250-263 are rendered faithfully, but the variant apparatus is dropped entirely and Tros becomes Troy. |
| 3 | Dutch | lite | omission | https://sourcelibrary.org/book/6a19586c3e125aa8d6dfecae?page=116 | Rest (Chinese camp under Anachoda Watting, G.G. to Ambon and Moluccas) faithful, but the page’s key clause about choosing the factory site is dropped. |
| 3 | Latin | lite | omission | https://sourcelibrary.org/book/69af42393fd91d3991398cca?page=557 | Digest fragments 4-10 (Ulpian, Paul, Julian, Papinian) rendered accurately, but the entire footnote apparatus, about a quarter of the page, is dropped. |
| 3 | Latin | lite | garble_passthrough | https://sourcelibrary.org/book/69b6310a1c1c21a373804fb2?page=245 | Heavily abbreviated incunable OCR, the liberal arts allegory is mostly right but the Cygnus story and several cross-references are smoothed over or misread, weak certainty on the abbreviations. |
| 3 | Greek | lite | garble_passthrough | https://sourcelibrary.org/book/69b21bb5429e087c6f862f05?page=526 | The overall argument (flavours as mixtures of sweet and bitter, parallel with colours, seven species) is followed, but several garbled spans are smoothed into invented sense; moderate confidence becau |
| 4 | Greek | lite |  | https://sourcelibrary.org/book/69b00996c42435fcd0cf9399?page=586 | Both Greek and Latin parallel columns rendered completely and accurately (stag horn to one-third, barley flour, willow leaves, rue/fig/walnut, coot blood); only wild lily for asphodel is a slip. |
| 4 | French | lite |  | https://sourcelibrary.org/book/6a8f624fe408ab73f484cec0?page=20 | Accurate apart from the opening fragment: it drops représentant and turns ‘se fait reconnoître’ into ‘recognizes itself’. |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/69b62fcc1c1c21a3737fabf9?page=57 | Four-part division, Greek phrase and examples of Moses/Jacob/Joseph faithful, the clause on Zacharias’s prior lack of apparitions is skewed. |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/69b630531c1c21a373800baa?page=227 | Commentary close and Job 13:1-15 rendered faithfully; minor slips in 'male feriatis', v12, and dropped 'debetis' modality. |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/69b631cc1c1c21a37380ae26?page=33 | Ptolemy's Baetica list with coordinates carried over intact; minor misreadings of 'os orientalius' and 'terminatur'. |
| 4 | Latin | lite | invention | https://sourcelibrary.org/book/69af12f4daac6bc3071aaf04?page=679 | Galenic reading-order passage rendered accurately; one clause misconstrued and the mid-sentence ending completed with invented ‘can precede this’. |
| 4 | Greek | lite | omission, truncated | https://sourcelibrary.org/book/6958ea4dd3a892833481514e?page=276 | Long Latin/Greek commentary on arbutus rendered closely; drops one Greek scholion quote, blurs the Apuleius Greek/Roman naming, cuts the final word ‘herbam’. |
| 4 | Russian | lite |  | https://sourcelibrary.org/book/69af49974a5e5a377fef9e6c?page=554 | Death-bed scene, washing of bloody hands, boat to palace and back rendered faithfully, hour expression rendered as ‘fifth hour’, ambiguous at best. |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/6a06f2a64dcc6d5d8f0366c2?page=107 | Close rendering of Ad Herennium; two minor slips (ueretur as ‘is feared’, Censores taken as subject); otherwise = source. |
| 4 | Latin | lite | untranslated | https://sourcelibrary.org/book/6a51eaf8689f6d0dbe2e0c5b?page=25 | The English is complete and accurate apart from one garbled clause in the Tusculans paraphrase; the full Latin source is also echoed before the English. |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/69b222d356715b0e32475702?page=106 | Juvenal Sat. 12 verses rendered line by line faithfully; ‘Arboribus rutulis’ taken as reddened rather than Rutulian. |
| 4 | Latin | lite | omission | https://sourcelibrary.org/book/69b630151c1c21a3737fdb28?page=66 | The κεραία / ἀκέραιοι etymology, Matt 10 and Rom 16:19, and the stars and φωστῆρες simile are accurate; tali is lost. |
| 4 | Latin | lite |  | https://sourcelibrary.org/book/6a76d4cd6ba8d6d1d3f8e6ca?page=15 | Preface, Greek book list and notes rendered faithfully; footnote 1 apparatus misread and Strabo page number changed from 15 to 14. |
| 4 | Latin | lite | garble_passthrough | https://sourcelibrary.org/book/69b6308c1c1c21a373802aa6?page=133 | The vices of the old and the mean held by those in their prime are rendered closely; the garbled closing lines are papered over with fluent invented sense. |
| 4 | German | lite | omission | https://sourcelibrary.org/book/69aff79157090f8072b7a1de?page=572 | Drops the first clause about the creative power carrying its highest enjoyment as its own reward; remainder (Bildungskraft/Empfindungsfähigkeit as man and woman, etc.) = source. |
| 4 | Latin | lite | inversion | https://sourcelibrary.org/book/69b62fe11c1c21a3737fb8a0?page=231 | Letter otherwise faithful (patron of the arts, literary leisure, sick son, new connection, letter to Padua); valeat ambitio is turned from dismissal into endorsement. |
| 4 | French | lite |  | https://sourcelibrary.org/book/69b4c0926248be021e01f719?page=86 | Follows the garbled alchemical French clause by clause, keeping its obscurities literal (‘le quinque engendre l’erreur’ -> ‘the five engenders error’); only an unsupported gloss on khasis. |
