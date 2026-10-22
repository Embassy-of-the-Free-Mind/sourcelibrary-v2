---
stage: metadata
measure: none
languages: [la, grc, de, fr, it, es, nl, en, lzh, ja, ar]
scripts: [Latn, Grek, Hani, Jpan, Arab]
canons: []
n_books: 3756
n_pages: 8849
verdict: "Diversity-in-a-whole is a real but minority strand of harmony definitions: 15% of 3,933 definitional sentences (ratio/consonance 32%), flat from the 9th to the 20th century, and half the time it sits inside a ratio definition (Boethius' plurimorum adunatio et dissentientium consensio). The five resonance topoi each have a traceable chain, with older witnesses than the issue named for the wolf drum (Bodleian MS. Barocci 50) and a Chinese strings chain that names number, not spirits, as the cause."
status: informational
decision: null
superseded_by: null
issue: [7117]
---
PRIOR ART: #7064 (Pythagoras: every work that names him) and #7065 / PR #7097 (`scripts/eval/fragment-sort/`, Philolaus and Archytas sorted against DK, residue read). This run reuses that matcher: its fold and shingle helpers now live in `fragment-sort/shingle.mjs`, and `classify.mjs` gives byte-identical output on the #7065 inputs. A concept is not a person, so the census harvests *definitional sentences*, and the topoi are sorted against their own earlier tellings, since no fragment list exists.

## 2026-10-22 · Is "harmony = diversity in wholeness" (harmony-kb ideas/01) earned across the definitions our books give, and how did five resonance/sympathy topoi travel? (#7117)

**Design.** Everything is read-only. The text comes from Atlas Search (`pages_search`, the index of the `/api/search` page lane) with a PCRE run server-side, so only matched windows leave Atlas. The book set is the public ones (`visible && pages_count > 0`) in the 2026-10-22 mirror (42,511 books). Scripts are in `scripts/eval/harmony-census/`, in run order:
- `lanes.mjs` holds the anchors.
- `harvest.mjs` writes windows, with a checkpoint per lane.
- `classify-defs.mjs` and `topoi.mjs` sort the windows.
- `density.mjs` and `rank.mjs` measure who discusses the terms most, and build the concept map.
- `summarize.mjs` writes the tables.
- `page-image.mjs` fetches pages for the by-eye reads.

- **Census (A).** Definitional patterns run in each original language:
  - Latin: *harmonia/concordia/consonantia/symphonia est, dicitur, vocatur, definitur …*
  - Greek: ἁρμονία/συμφωνία ἐστί, καλεῖται …
  - German, French, Italian, Spanish and Dutch equivalents.
  - Chinese: 和者, 和也者, 謂之和, 和如羹, 和實生物, 和而不同, 以他平他.
  - English, in both our translations (every language) and English originals.

  The long s (ſ) is folded. Apparatus (`<meta>`, `<note>`, `<gloss>`, `<vocab>` …) is never matched. A page already caught in its original language is not counted again from its translation.
- **Sorting the census.** Each window gets a **form**:
  - *harmony is X*;
  - *X is called harmony*;
  - *the definition of harmony*;
  - *X is a harmony*, a predication, which is counted apart.

  It also gets a **kind**: definition, predication, description ("harmony is pleasing"), or noise (genitive *concordiae est*, 唱和者 "those who join the song", Concord MA …). Definitions get multi-label **families** from keyword rules on the definiens, in its own language, with our English as the fallback:
  - F1 ratio/consonance;
  - F2 diversity/opposites in a whole;
  - F3 order/rank;
  - F4 balance/temperament/mean;
  - F5 social concord;
  - F6 none of these.

  Chinese windows are also tagged with the classical locus they quote.
- **Topoi (B).** Each topos has its own anchors:
  - sympathy and antipathy words in eight languages;
  - unison, 宮動 and 同聲相應;
  - wolf near drum or gut;
  - magnet near iron and sympathy, and 慈石召鐵;
  - weapon-salve and powder of sympathy;
  - clocks near sympathy.

  Proximity rules on a ±300/400-character span decide which topos a window tells. Tellings are then sorted, earliest first, into four classes:
  - **known-source**: the telling names an authority;
  - **derivative**: its page's original text shares 40 or more folded characters with an earlier telling's page, using the #7065 shingles;
  - **variant**: a different version of the topos;
  - **unmatched**.
- **By eye.** The residue and a sample of each class were read from the text, one page per book. The earliest witnesses were read on the **page image**. Every claim below says which evidence it rests on.
- **Derek's notes of 2026-10-22, added mid-run.**
  - Who discusses harmony and sympathy *most*: dense pages (3 or more mentions; 2 for Chinese compounds), runs of consecutive dense pages, normalized by book length, with editions collapsed by `work_id`.
  - A concept co-occurrence map by century.
  - The Chinese strings chain as a parallel chain.
  - A cross-cultural table.

**Dates.** The century below is the date of the *witness* we hold: the catalogue `year`, or else the first year in `published`. For most Western books that is the edition. For many Chinese books and some manuscripts the catalogue holds the *composition* date instead (Xiao Ji 594, Erya 310). The earliest witnesses were dated by reading them.

### A. Definition census: 3,933 definitional sentences in 2,088 public books

| century of witness | definitions | books | F1 ratio / consonance | F2 diversity / opposites | F3 order | F4 balance / mean | F5 social | F6 other | share with F2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| before 1300 | 56 | 31 | 26 | 15 | 4 | 7 | 2 | 18 | 27% |
| 14th c. | 26 | 15 | 8 | 3 | 1 | 2 | 2 | 13 | 12% |
| 15th c. | 375 | 175 | 150 | 76 | 19 | 69 | 37 | 130 | 20% |
| 16th c. | 780 | 327 | 306 | 117 | 39 | 102 | 108 | 286 | 15% |
| 17th c. | 573 | 249 | 229 | 87 | 32 | 56 | 51 | 241 | 15% |
| 18th c. | 333 | 159 | 110 | 55 | 20 | 41 | 33 | 136 | 17% |
| 19th c. | 460 | 201 | 148 | 61 | 21 | 67 | 42 | 202 | 13% |
| 20th c. | 144 | 95 | 41 | 25 | 1 | 18 | 16 | 70 | 17% |
| undated (mostly Chinese) | 1,186 | 836 | 229 | 154 | 88 | 331 | 209 | 438 | 13% |
| **all** | **3,933** | **2,088** | **1,247** | **593** | **225** | **693** | **500** | **1,534** | **15%** |

The families are multi-label, so the rows sum to more than n.

**By lane.**
- Latin: 1,210 definitions in 558 books.
- Chinese: 1,266 in 875.
- Our English translations, where the original did not match: 760 in 531.
- French 160, Italian 136, German 128, English originals 122, Greek 115 (plus 172 Greek predications such as ψυχὴν ἁρμονίαν εἶναι), Spanish 26, Dutch 10.

**By lemma, before 1700.**
- *Consonantia* is F1 in 257 of 326 definitions.
- *Concordia* is F5 (social) in 112 of 449.
- *Harmonia* is F1 in 370 of 895, F2 in 119.

**Precision**, by reading the text of a one-per-book sample (12 per family). The share of rows that are real definitions, and in brackets the share whose family is right:

| family | real definitions | family right |
|---|---|---|
| F1 | 8/12 | (7/8) |
| F2 | 9/12 | (7/9) |
| F3 | 7/12 | (4/7) |
| F4 | 7/12 | (7/7) |
| F5 | 3/12 | (3/3) |
| F6 | ≈14/40 | — |
| Chinese | ≈18/20 | — |

So F6 is mostly harvest noise (uses, predications, fragments), not a hidden family. Its real definitions are *harmony is health*, *the primary law of nature*, *an illumination*, and F2/F4 phrasings the rules missed ("unification of the much-mixed", "an account of things mixed"). The F2 and F4 rules were widened after that reading. The ratio F2 : F1 hardly moves under the measured precision: 593 × 7/12 against 1,247 × 7/12.

**What the census says about ideas/01.**
1. **Diversity-in-a-whole is a minority family, and it is flat.**
   - It is present in 15% of definitions overall: 16% outside Chinese (428 of 2,667), against 38% for ratio/consonance (1,015).
   - Its share stays between 12% and 27% in every century from the 9th to the 20th, with no rise and no fall.
   - It is not the definition "found in all cultures". It is one strand that every century carries.
2. **Half the time it sits inside a ratio definition.** 203 of the 428 non-Chinese F2 definitions are also F1. Its best-known form is the musical consonance definition:
   - Nicomachus via Boethius: *Est enim armonia plurimorum adunatio et dissentientium consensio*.
   - The medieval *musica* books: *Musica sive armonia est plurium dissimilium in unum redactorum concordia*.
   - Boethius on consonance: *consonantia est dissimilium inter se vocum in unum redacta concordia*.

   In the Western tradition, "diversity in wholeness" travels as the *content* of the ratio definition, not as its rival. This supports ideas/05 ("ratios as one manifestation"): the old texts state both in one sentence.
3. **Chinese definitions of 和 mostly quote two loci.**
   - Zhongyong 1 (204 rows): emotions "hitting due measure" 中節 are *he*. This is a balance/mean definition, F4, the largest Chinese family with 366 of 1,266.
   - Analects 13.23 (246 rows): the junzi is 和而不同, harmonious but not the same.
   - The he/tong distinction that ideas/01 leans on appears through Analects 13.23, Zuozhuan Zhao 20 (*he* is like soup, 64 rows; the gloss 可否相濟 18) and Shi Bo's Guoyu (10). Together that is real but second to due measure.

**Earliest witnesses by family**, dated by reading:

| family | earliest witness | composition | link | evidence |
|---|---|---|---|---|
| F1 | Plato, *Cratylus* 405 (Greek MS of 895): the moving-together in song ἣ δὴ συμφωνία καλεῖται | 4th c. BCE | [p.148](https://sourcelibrary.org/book/69a5e5f385fa13e734e41e1f?page=148) | OCR text; image opened |
| F1 | Erya (Guo Pu's commentary): 徒吹謂之和, "solo blowing is called *he*", and 小者謂之和, *he* as the small mouth-organ. *He* begins as a musical term | — | [p.49](https://sourcelibrary.org/book/6992cf083158e1eeeea7f958?page=49) | image opened |
| F2 | Boethius, *Arith.* II.32, 9th-c. copy | c. 505, after Nicomachus and Philolaus | [p.140](https://sourcelibrary.org/book/69b52ca23dd6d94230281884?page=140) | **image read** |
| F2 | Remigius on Martianus (12th-c. MS), as above | — | [p.143](https://sourcelibrary.org/book/69b3f783a107e55a0ee1db02?page=143) | **image read** |
| F3 | Theon of Smyrna (Greek MS, catalogue 1350): Ἁρμονία δέ ἐστι, σύστημα γένους καὶ τάξεως | 2nd c. | [p.44](https://sourcelibrary.org/book/69b4c06386a5921d5bc4362d?page=44) | image opened, line not legible at that scale: OCR only |
| F3 | Gaudentius, *Harmonic Introduction* (Vat. gr. 191, 1296): ἡ … ἁρμονία ἐστὶν ἡ κατὰ τοὺς φθόγγους καὶ τὰ διαστήματα ποιὰ τάξις | — | [p.601](https://sourcelibrary.org/book/69a5e3c79bb980f504233baa?page=601) | heading read on the image, sentence from OCR |
| F4 | Zhongyong, in Chen Yang's *Yueshu* (Siku copy): 發而皆中節謂之和 | — | [p.14](https://sourcelibrary.org/book/69c6617b01a26ccff09f5378?page=14) | **image read** |
| F4 | Guoyu (Zhou yu) on bells, quoted by Xiao Ji (594): 聲應相保曰和, 細大不踰曰平 | — | [p.73](https://sourcelibrary.org/book/6992cabbd4d545ae73fee88b?page=73) | **image read** |
| F5 | Ramon Llull, *Ars magna*: *Concordia est … per unitatem* (catalogue 1200; Llull wrote in the 1270s–1300s) | — | [p.486](https://sourcelibrary.org/book/6953ab9577f38f6761bd786e?page=486) | OCR text |
| F5 | Aristotle, *NE* IX 6, Aldine Greek 1495: concord is the same choice about ruling and being ruled; "political friendship" | 4th c. BCE | [p.645](https://sourcelibrary.org/book/69b220b356715b0e324732e1?page=645) | translation text |

### B. Five resonance / sympathy topoi

| topos | tellings (pages) | books | known-source | derivative | variant | unmatched | precision of a 10-book sample |
|---|---:|---:|---:|---:|---:|---:|---:|
| T1 sympathetic strings (incl. Chinese) | 1,209 | 698 | 110 | 462 | 338 | 299 | 7/10 |
| T2 wolf drum / wolf-gut strings | 385 | 279 | 26 | 116 | 160 | 83 | 5/10 |
| T3 lodestone as sympathy | 2,146 | 977 | 192 | 990 | 261 | 703 | 7/10 |
| T4 weapon-salve / powder of sympathy | 1,707 | 407 | 350 | 597 | 439 | 321 | 9/10 |
| T5 clocks in sympathy | 122 | 47 | 25 | 38 | 35 | 24 | 5/10 |

The rows are rule output. The chains below were built from the tellings read one by one.

**T1. Sympathetic strings, Western chain.**
- **Aristides Quintilianus** (*De musica*, in Meibom 1652, [p.637](https://sourcelibrary.org/book/6955742bf63a757109172ca1?page=637)): a string struck harmoniously sounds with "the soul's own internal strings". This answers the issue's "Aristides?".
- **A Greek epigram** on self-sounding strings. In Lascaris's *Anthologia* (1503, [p.89](https://sourcelibrary.org/book/69b21be764fe7db19620a5ec?page=89)) and the Aldine (1550, [p.90](https://sourcelibrary.org/book/6a0859db49638a50931c872c?page=90)), nature "placed in them a sympathy", and Aristoxenus "swore he did not know".
- **Asclepius of Tralles**, on Nicomachus (1550, [p.126](https://sourcelibrary.org/book/699389f174305116d72d306a?page=126)): a straw on the string in double ratio is tossed off, "so great is the sympathy".
- **Ficino** 1529, citing Plotinus and Iamblichus ([p.260](https://sourcelibrary.org/book/6948856a2f9c70e60597cb30?page=260)).
- **Fracastoro**, *De sympathia* 1546 ([p.37](https://sourcelibrary.org/book/69905ac4aaa7f10ed4cfb814?page=37)): strings stretched alike "make and receive similar waves (*undationes*) of air".
- **Bermudo** 1555, the straw test on two vihuelas ([p.235](https://sourcelibrary.org/book/69557dd157e3b773024f4041?page=235)).
- **Zarlino** 1558, **Gemma** 1569.
- **Bacon** 1620: "a string on different lutes moves a string to unison".
- **Mersenne** 1623 ([p.789](https://sourcelibrary.org/book/69af0da19f13b61d0a6c5b8b?page=789)): "a marvelous sympathy proceeding from the highest equality".
- **Galileo**, *Discorsi*.
- **Wallis**, *Opera*: paper riders on a string ([p.491](https://sourcelibrary.org/book/695685cebe7c607c5f03be4e?page=491)).
- **Helmholtz** 1863.

The Ptolemy/Porphyry codex (Vat. gr. 191, 1296, [p.691](https://sourcelibrary.org/book/69a5e3c79bb980f504233baa?page=691)) already speaks of the "sympathetic" octave on the monochord.

**T1. Chinese chain, parallel and older**, per Derek's note. Numbers are tellings in our books.
- **Zhuangzi, *Xu Wugui*** (20): Lu Ju tunes two *se*; 鼓宮宮動，鼓角角動. Witness: *Six Daoist Classics* 1576, [p.682](https://sourcelibrary.org/book/69bd0a11b01b17638a0978c6?page=682).
- **Lüshi chunqiu** (6): 類同相召 … 鼓宮而宮應.
- **Yijing *Wenyan*** (178): 同聲相應，同氣相求.
- **Huainanzi *Lanming*** (6): 叩宮而宮應，彈角而角動，此同音之相應也. 1595, [p.128](https://sourcelibrary.org/book/69aec2c85bf9e9de6b166906?page=128).
- **Dong Zhongshu, *Chunqiu fanlu*** (10): 鼓其宮則他宮應之 … **五音比而自鳴，非有神，其數然也**, "not spirits; the numbers make it so". Peiwen yunfu 402, [p.119](https://sourcelibrary.org/book/6a3c63e4af3c49b59c5c951a?page=119).
- **Kong Yingda's subcommentary** (4) reads the Yijing line *as* string resonance: 同聲相應者若彈宮而宮應. Peiwen 656, [p.39](https://sourcelibrary.org/book/6a3c64dc39b4508b04e2a9ec?page=39).
- **The *Xinlun*** (attributed to Liu Xie) names the mechanism: 以類相感，以氣相化.
- **Shen Kuo**:
  - *Mengxi bitan* 1088 ([p.135](https://sourcelibrary.org/book/6992cbe4018b80967354c399?page=135)): a pipa in an empty room answers the Shuangdiao mode only.
  - *Bu bitan*, **paper riders** (62): 紙人 on the strings; 則紙人躍，他絃即不動. Zishi jinghua, [p.107](https://sourcelibrary.org/book/6a3c65f739b4508b04e30763?page=107). That is about 590 years before Wallis's paper riders of 1677.
- ***Lülü zhengyi*** 1713/1724 (12): string correspondences by division, [p.127](https://sourcelibrary.org/book/69c6616001a26ccff09f5172?page=127).

**T2. The wolf drum.** No Pliny or Aelian telling turned up. The chain:
- **The oldest witness held**, Bodleian **MS. Barocci 50** ([p.300](https://sourcelibrary.org/book/69bfcd228ab50eb88e8c7d27?page=300), **image read**). It is a Byzantine ὅτι-list on the wolf. Both forms appear together: a wolf-gut string on a kithara silences the sheep-gut strings struck with it, τοῦτο δὲ καὶ ἐπὶ τυμπάνων, "this also happens with drums".
- **Bartholomaeus Anglicus** (MS, [p.454](https://sourcelibrary.org/book/6953cc6d77f38f6761be20a9?page=454), **image read**). He cites Aristotle for the enmity and "a book" for the strings: *legi in libro quod cordula facta de intestinis luporum … corrumpit*.
- **The wolf-gut strings line** then runs to Meffret 1488 and to Johannes de Sancto Geminiano 1497–99, who moralizes it: wolf strings are "perverse doctrines". Agrippa I.17 has "no consonance", as in the harmony-kb claim `mus-agrippa-wolf-lamb-strings`. Then Alciati 1661.
- **The drum line** runs through a 1420 alchemical miscellany (Cambridge Add. 4087, [p.431](https://sourcelibrary.org/book/699067dd249ce014347d4345?page=431)) and Trémaugon's *Songe du vergier*, where "some naturalists wish to say" it ([p.191](https://sourcelibrary.org/book/69f33548876dd827cbc4e303?page=191)). Next comes ps.-Albertus, *De mirabilibus mundi* (1473 [p.9](https://sourcelibrary.org/book/69dbc79d1040d1d5e2092e0e?page=9), 1478 [p.56](https://sourcelibrary.org/book/69905e372fd6a039938a1793?page=56)), where the sheep drum "falls silent". Then Fracastoro 1546, Della Porta, and Campanella (the sheep drum *breaks*).
- **Schott 1674** (from Derek's note): Kircher tested it with two polychords in a sheepfold, with no effect.

The drum is the later form. The strings carry the older, Aristotelian enmity.

**T3. The lodestone as sympathy.**
- **Solinus** in Harley 3859 (840, [p.512](https://sourcelibrary.org/book/6991bf6f734f402cad489dba?page=512)): "a certain hidden natural antipathy between the diamond and the magnet".
- **Geoponika** (950) and **Ptolemy's *Tetrabiblos*** (1450 codex): garlic kills the magnet's power.
- **Ibn Hazm**, *Ring of the Dove* (witness 1022): iron and magnet as love.
- **Adelard** (1150): "giving friendship".
- **Aquinas**: "occult virtues, just as the magnet draws iron".
- **Ficino** 1475.

Gilbert's attack (1600) is not in the class tables, because the rule needs sympathy near the magnet. The magnet's share of sympathy pages peaks at **24% in the 17th century**, from 3–6% before 1500.

**T4. The weapon-salve.**
- **Nicolas Jacquier** (catalogue 1484; written c. 1458, [p.363](https://sourcelibrary.org/book/69905d762fd6a0399389f715?page=363)) already reports wounds healed "however far away" by anointing the weapon. This **predates Paracelsus** and needs checking against the edition.
- **Libavius**, Jena 1594 and 1599–1601.
- **Khunrath** 1608 and **Croll** 1609: the "Sympathetic Ointment or Starry Ointment of Paracelsus".
- **Goclenius**, **Fludd** (*Mosaicall Philosophy* 1638/1659), **Foster**, **van Helmont**.
- **Digby's powder of sympathy**: the *Theatrum sympatheticum* 1661, and Monconys in 1665 dressing a sailor "with the powder of sympathy".
- **Sennert** and **Marci** 1676.

Precision on this topos is the best of the five (9/10).

**T5. Clocks.** This chain was found by reading after the rule missed it: the long s (ſympathie) and the clock rule both failed.
- **Kircher's *sympathetic clocks*** (1641–1678): magnetic, heliotropic, the Egyptians' water lily ([p.237](https://sourcelibrary.org/book/4d4089b9-9227-4cc5-b0a2-9b06ee731061?page=237)). That is occult horology, before Huygens.
- **Huygens 1665**, *Œuvres* V, **p.244** (scan [264](https://sourcelibrary.org/book/69ac5f457f20875486da3eb7?page=264), **image read**): "par une espece de sympathie … elles se remettoient tousjours à la consonance". In this letter he blames the air. He corrects himself on scan [276](https://sourcelibrary.org/book/69ac5f457f20875486da3eb7?page=276): "ne provient pas du mouuement de l’air mais du dit petit branflement".
- **The Royal Society**, in Birch ([p.28](https://sourcelibrary.org/book/6ac2798d02c7f994f8506911?page=28)): "this pretended sympathy … whether from a magnetical cause".
- **Huygens's 1673 *Horologium*** and the **1724 *Opera***.
- **Leibniz's two clocks** of pre-established harmony (1695), which agree without any sympathy.
- **Young** 1807: "sympathy of clocks, unison".

### Who discusses harmony and sympathy most: dense pages of the best edition, editions collapsed

**Harmony, original language.**
1. Kircher, *Musurgia* 1650: 249 pages, run 11.
2. Rameau, *Traité* 1722: 227 pages, run 28.
3. Kepler, *Harmonices mundi* 1619: 146 pages, run 30.
4. Meibom, *Antiquae musicae auctores* 1652: 143.
5. Mersenne, *Harmonicorum libri* 1636: 141.
6. Kircher, *Ars magna consoni* (German) 1662: 140.
7. Wallis, *Opera* III 1699: 138.
8. Salinas 1577: 124.
9. Helmholtz: 119.
10. Zarlino 1558: 118.

Further down come Mattheson, Euler, Praetorius, Tartini, Giorgi 1525 (79), Fourier 1829 (77), and Wolff's *Psychologia rationalis*, whose 42-page run on *harmonia praestabilita* is the longest single run.

**Harmony, our English.** Kircher, then Mersenne (51-page run), Meibom, Kepler, Helmholtz, Rameau, Zarlino, the Euclid/Aristoxenus/Porphyry codex (1450), Wallis, Fourier.

**Sympathy, original language.**
1. Keely (Bloomfield 1893): 95.
2. The Dutch *Theatrum sympatheticum* 1709: 76.
3. Leonardi, *Speculum lapidum* 1610: 70.
4. Adam Smith 1759: 68.
5. Helmholtz: 65.
6. Fludd, *Mosaicall Philosophy*: 59.
7. Gregory, *Animal Magnetism* 1851: 53.
8. Aevolus, *De divinis attributis* 1589: 39.
9. Aldrovandi: 36.
10. *Theatrum sympatheticum* 1661: 31.

Then come Marci, Kircher's *Magnes* and *Mundus subterraneus*, and Libavius.

**Sympathy, our English.** Adam Smith (147, a 31-page run), Leonardi, Keely, Fludd, Helmholtz, Kircher's *Magnes*, the *Theatrum sympatheticum*, Gregory, Hume.

**Chinese 感應 / 同聲相應.** Yijing commentaries lead: Hu Guang's *Zhouyi zhuanyi daquan*, Nalan Xingde, Dong Kai.

The full tables, top 25 per lane, regenerate with `rank.mjs`. *Consensus* was dropped from the sympathy terms after the first run, because Latin legal *consensus* put law tracts on top.

### Concept map: share of English-lane pages naming the hub that also name the concept, by century

The edge list is in `scripts/eval/harmony-census/concept-edges.csv` (term, term, century, pages, hub pages, weight).

- **Harmony is steady.** About half of harmony pages name the soul, 40–54% name God, and 37–47% name city/state/peace.
- **Its tie to number and cosmos loosens after 1700.** Number falls from 36–40% (14th–17th c.) to 24–30% (18th–20th). Cosmos falls from 35–39% to 26–27%.
- **Sympathy changes character.**
  - Before 1500 it is a concept of body and soul: soul about 50%, body 41–54%.
  - In the 17th century it becomes medical-magnetic: magnet 24% (from 3–6% before 1500), temperament/health 38%, antipathy 24%. This is the weapon-salve century.
  - By the 19th and 20th centuries the magnet falls to 6–10% and health to 14–15%, while city and society hold at 36–38%: Adam Smith's sympathy.
- **Caveat.** The concept terms are broad English words (soul, spirit, mind; city, state, peace). Read the trends, not the levels.

### Cross-cultural resonance table: earliest witness held, read

| native term | what resonates with what | mechanism claimed | earliest held witness |
|---|---|---|---|
| 同聲相應 / 感應 (Chinese) | strings tuned alike: gong answers gong; like kinds | 類 kind; 氣 qi (*Xinlun*); **數 number, not 神 spirits** (Dong Zhongshu) | Zhuangzi, *Xu Wugui* (4th–3rd c. BCE; held in a 1576 print); 感應 as a term in a Dunhuang-type colophon (900) and Chen Tuan on the Yijing (950) |
| συμπάθεια (Greek) | parts of a body; cosmos; strings ("nature placed in them a sympathy") | shared affection of parts (Galen); not explained ("Aristoxenus did not know") | Galen, *De usu partium* (Greek MS; work c. 170); the epigram, in print 1503 |
| 感応 *kannō* (Japanese) | a deity answers a player's music or sincerity | sincerity; response of the god | *Heike monogatari* (witness 1371): Tsunemasa's biwa; 明神感應に堪ずして, a white dragon appears ([p.50](https://sourcelibrary.org/book/69dfedea8d34461cbe7f4efb?page=50)) |
| *taʾthīr* / correspondence (Arabic, Ikhwān al-Ṣafāʾ) | the four ʿūd strings, the four elements and the four humours | likeness of ratio and quality: "the tone of the *mathlath* strengthens the phlegm humor … and opposes the bile humor" | *Rasāʾil* (10th c.; 1887 Bombay ed., [p.108](https://sourcelibrary.org/book/69b6363a8ab57a1de53a75c8?page=108)) |
| *nāda* (Sanskrit) | sound as Nāda-Brahman, the Absolute | metaphysical, not acoustic | Śārṅgadeva, *Saṅgītaratnākara* (13th c.; Adyar ed.); *nāda* as inner sound in Svatmarama's *Haṭhapradīpikā* |
| *sympathia* (Latin, Renaissance) | unison strings; the magnet; the wound and the weapon | similar motions or waves of air (Fracastoro); occult quality (Agrippa); magnetic spirit (Paracelsians) | Ficino 1529; Fracastoro 1546 |
| *sympathie des horloges* (French) | two pendulum clocks on one beam | air, then corrected to the imperceptible motion of the beam (Huygens); "magnetical?" (Royal Society) | Huygens 1665 |

Two terms are **not found** in our books: Indian *taraf* (sympathetic strings), and Stoic *sympatheia* in a Stoic source older than Galen.

### Residue and data findings, for separate human-visible fixes; no data written here

- **69bfcd22…** displays as "Arabic Grammar". It is **Bodleian MS. Barocci 50** (its own `title`; the `dc_description` names the Physiologus). Its catalogue year is 1050 while `published` is 901–950.
- **69af1275…** is catalogued as "Matteo Ricci, *On the Structure of Heaven and Earth* (1608)". Its scan (LoC wdl_11400, p.85, image opened) is chapter 2 of the ***Sanguo yanyi***. Text and image agree, so the fault is in the record, not the page.
- **695592ca…** (Della Porta, catalogued 1607) cites Digby's *Sympathetic Powder* (1658). It must be a later edition.
- **The catalogue `year` mixes** the edition date (Western) with the composition date (much of Chinese, some MSS: Xiao Ji 594, Erya 310, Galen 170). A census by century inherits that mix; read the "undated" row as mostly Chinese.
- **The long s** is folded in the OCR of most books but not all. Atlas does not fold ſ, so "ſympathie" pages are invisible to a plain query. The lanes now search both forms; that recovered 563 sympathy pages and a few Latin definitions.
- **Not measured:** recall. The definitional patterns cover the usual verbs. A definition by apposition ("harmony, the concord of …") or in a language not listed (Hebrew, Arabic, Sanskrit originals) is reached only through our English translation, and only where one exists.

*Replicated?* No. The harvest is deterministic and the rules are in the scripts, but each by-eye read was done once, by one reader.

**Artifacts.** The per-row classifications (`defs.jsonl`, `topoi.jsonl`), the harvests and `rank.md` stay on the job box (`/mnt/HC_Volume_105839809/jobs/harmony-census-7117/`) and regenerate from the scripts. The verified claims are in harmony-kb, in `claims/census-7117.jsonl`.
