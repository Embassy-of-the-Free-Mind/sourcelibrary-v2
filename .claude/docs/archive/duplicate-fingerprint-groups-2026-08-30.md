# Same-fingerprint duplicate groups in `books` — 2026-08-30

Snapshot, not doctrine. **Nothing here has been merged, hidden, or deleted** —
this is a list for a human to decide over. Regenerate with
`node scripts/audit/duplicate-fingerprint-groups.mjs`.

| metric | value |
| --- | --- |
| scanned | 110133 |
| groups | 278 |
| docs | 559 |
| caught_by_scalar | 139 |
| cross_form_only | 139 |
| concurrency_races | 83 |
| groups_with_a_visible_member | 103 |

`cross_form_only` = the group is invisible to the legacy scalar `source_fingerprint`
(the same object under two identifier forms). `concurrency_races` = every member was
created within 5 seconds, i.e. parallel importers each passed the check before any inserted.

### ia:bim_early-english-books-1475-1640_lac-puerorum-a-latin-gr_holt-john_1511  (3 records)
_cross-form only · spread 59d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a905c67785d9b40577fa46d` | Lac puerorum. Mylke for children | iiif | Unknown | no | 97 | 0 | 2026-08-27 | `iiif:https://iiif.archive.org/iiif/bim_early-english-books-1475-1640_lac-puerorum-a-latin-gr_holt-john_1511/manifest.json` |
| `6a9093e7ac1fcc717ba2f047` | Lac puerorum. Mylke for chyldren | iiif | Unknown | no | 97 | 0 | 2026-08-27 | `iiif:https://iiif.archive.org/iiif/3/bim_early-english-books-1475-1640_lac-puerorum-a-latin-gr_holt-john_1511/manifest.json` |
| `6a430dd522c0c8edb0f92411` | Lac puerorum | internet_archive | 1511 | no | 97 | 25 | 2026-06-30 | `ia:bim_early-english-books-1475-1640_lac-puerorum-a-latin-gr_holt-john_1511` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10192557/manifest  (3 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a905aee785d9b40577f6658` | Tractat von bekantnuß der zauberer unnd hexen. ob und wie viel denselb | iiif | Unknown | no | 236 | 25 | 2026-08-27 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10192557/manifest` |
| `6a905aee785d9b40577f6657` | Tractat von bekanntnuß der zauberer und hexen. ob und wieviel denselbe | iiif | Unknown | no | 236 | 25 | 2026-08-27 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10192557/manifest` |
| `6a905aee785d9b40577f665a` | Tractat von bekanntnuß der zauberer und hexen. ob und wie viel denselb | iiif | Unknown | no | 236 | 25 | 2026-08-27 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10192557/manifest` |

### iiif:content.staatsbibliothek-berlin.de/dc/PPN1042281858/manifest  (3 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a90571dbe5ef7b9fabd64b4` | Synopsis Philosophiae Moralis, Seu Praecepta Ethica: compendiose tradi | iiif | Unknown | no | 342 | 25 | 2026-08-27 | `iiif:https://content.staatsbibliothek-berlin.de/dc/PPN1042281858/manifest` |
| `6a90571dbe5ef7b9fabd660c` | Synopsis Philosophiae Moralis, Seu Praecepta Ethica,: compendiose trad | iiif | Unknown | no | 342 | 25 | 2026-08-27 | `iiif:https://content.staatsbibliothek-berlin.de/dc/PPN1042281858/manifest` |
| `6a90571d43823d3a7f085a4a` | Synopsis Philosophiae Moralis, Seu Praecepta Ethica: compendiose tradi | iiif | Unknown | no | 342 | 25 | 2026-08-27 | `iiif:https://content.staatsbibliothek-berlin.de/dc/PPN1042281858/manifest` |

### dc:11807  (2 records)
_scalar-visible · spread 105d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6985ca72b037546226b9db91` | Pymander | bph | 1585 | yes | 532 | 532 | 2026-02-06 | `dc:11807` |
| `68fb0dc412055a03a58d3281` | Pymander, de potestate et sapientia Dei | bph | 1532 | yes | 471 | 471 | 2025-10-24 | `dc:11807` |

### dc:3047  (2 records)
_scalar-visible · spread 208d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6867a87bfc518f6dbf33510a` | Complementum Astrologiae | bph | 1620 | yes | 56 | 56 | 2025-07-04 | `dc:3047` |
| `697958faeef1c286564aa43d` | Complementum astrologiae und auszführliche Erklerung des fünffjährigen | bph | 1620 | yes | 57 | 57 | 2026-01-28 | `dc:3047` |

### dc:3585  (2 records)
_scalar-visible · spread 85d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6909c96acf28baa1b4cafbf3` | Dichiaratione sopra il XIII cap. dell'Apocalisse | bph | 1562 | yes | 50 | 50 | 2025-11-04 | `dc:3585` |
| `697a5562c915282d8f071f74` | Dichiaratione sopra il XIII. cap. dell'Apocalisse | bph | 1562 | yes | 40 | 40 | 2026-01-28 | `dc:3585` |

### dc:3977  (2 records)
_scalar-visible · spread 86d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `697b0799b42177f3ebcc7f4d` | Echo der von Gott hocherleuchten Fraternitet dess löblichen Ordens R.C | bph | 1616 | yes | 313 | 313 | 2026-01-29 | `dc:3977` |
| `6909a8c1cf28baa1b4caee49` | Echo der von Gott hocherleuchten Fraternitet dess löblichen Ordens R.C | bph | 1616 | yes | 284 | 284 | 2025-11-04 | `dc:3977` |

### dc:5220  (2 records)
_scalar-visible · spread 85d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `697c8e0fbaa544415f85b6c6` | Die Lehren der Rosenkreuzer aus dem 16ten und 17ten Jahrhundert. Oder  | bph | 1785 | yes | 157 | 157 | 2026-01-30 | `dc:5220` |
| `690c27e6e0787282ad593281` | Die Lehren der Rosenkreuzer aus dem 16ten und 17ten Jahrhundert. Oder  | bph | 1785 | yes | 117 | 117 | 2025-11-06 | `dc:5220` |

### dc:6941  (2 records)
_scalar-visible · spread 88d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `697e23c8bb80b2397e771e23` | Hypnerotomachie, ou discours du songe de Poliphile | bph | 1561 | yes | 380 | 380 | 2026-01-31 | `dc:6941` |
| `69099eb5cf28baa1b4caeb37` | Hypnerotomachie ou discours du songe de Poliphile | bph | 1561 | yes | 338 | 338 | 2025-11-04 | `dc:6941` |

### dc:8338  (2 records)
_scalar-visible · spread 101d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `68fb0b2712055a03a58d3193` | Liber egregius de unitate ecclesia | bph | 1520 | yes | 252 | 27 | 2025-10-24 | `dc:8338` |
| `6980941e4664a62963e01f38` | Liber egregius de unitate ecclesia | bph | 1520 | yes | 304 | 304 | 2026-02-02 | `dc:8338` |

### dc:8413  (2 records)
_scalar-visible · spread 91d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69819209e4f4f6455d89c7b8` | Von der liebe gottes ein wunder huebsch underrichtung | bph | 1520 | yes | 44 | 44 | 2026-02-03 | `dc:8413` |
| `69099983cf28baa1b4cae913` | Von der liebe Gottes ein wunder hübsch underrichtung | bph | 1520 | yes | 40 | 40 | 2025-11-04 | `dc:8413` |

### gallica:ark:/12148/bpt6k592419  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4d514d4e92e8691bc18c75` | Gratulatio Innocentio VIII dicta | gallica | Unknown | no | 12 | 2 | 2026-07-07 | `iiif:https://gallica.bnf.fr/iiif/ark:/12148/bpt6k592419/manifest.json` |
| `6a4d514d4e92e8691bc18c76` | Gratulatio Innocentio VIII dicta | gallica | Unknown | no | 12 | 6 | 2026-07-07 | `iiif:https://gallica.bnf.fr/iiif/ark:/12148/bpt6k592419/manifest.json` |

### gallica:ark:/12148/bpt6k8708905z  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a90913e0f0bff48dccbc1bd` | Consolatorium timoratae conscientiae | gallica | Unknown | no | 220 | 25 | 2026-08-27 | `iiif:https://gallica.bnf.fr/iiif/ark:/12148/bpt6k8708905z/manifest.json` |
| `6a90913f0f0bff48dccbc29e` | Consolatorium timoratae conscientiae | gallica | Unknown | no | 220 | 24 | 2026-08-27 | `iiif:https://gallica.bnf.fr/iiif/ark:/12148/bpt6k8708905z/manifest.json` |

### gallica:ark:/12148/bpt6k8714947b  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a9099995fecff234ca5fd66` | Verae contritionis praecepta quae nihil prae se ferunt quam ipsam piet | gallica | Unknown | no | 436 | 23 | 2026-08-27 | `iiif:https://gallica.bnf.fr/iiif/ark:/12148/bpt6k8714947b/manifest.json` |
| `6a90999a5fecff234ca5ff1d` | Verae contritionis praecepta quae nihil prae se ferunt quam ipsam piet | gallica | Unknown | no | 436 | 25 | 2026-08-27 | `iiif:https://gallica.bnf.fr/iiif/ark:/12148/bpt6k8714947b/manifest.json` |

### gallica:ark:/12148/bpt6k8718822d  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a90d184a04333f3faecf36c` | Joannis Torre nobilis Lucensis, exsupremo consilio serenmi Parmae & Pl | gallica | Unknown | no | 656 | 24 | 2026-08-28 | `iiif:https://gallica.bnf.fr/iiif/ark:/12148/bpt6k8718822d/manifest.json` |
| `6a90d184a04333f3faecf36d` | Joannis Torre nobilis Lucensis, ex supremo consilio serenmi Parmae & P | gallica | Unknown | no | 656 | 25 | 2026-08-28 | `iiif:https://gallica.bnf.fr/iiif/ark:/12148/bpt6k8718822d/manifest.json` |

### ia:06050867.cn  (2 records)
_scalar-visible · spread 105d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6992cffcf5b4f75c1a4c9dfb` | 神仙傳 | internet_archive | 1445 | no | 124 | 50 | 2026-02-16 | `ia:06050867.cn` |
| `6a1d60c7d274b9630ccf8f75` | 神仙傳 (卷一~卷五) — Biographies of Divine Immortals, vol.1 | internet_archive | 1776 | yes | 124 | 124 | 2026-06-01 | `ia:06050867.cn` |

### ia:10043398  (2 records)
_scalar-visible · spread 44d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69aec8aef24f28c970822a25` | Phänomenologie des Geistes | internet_archive | 1832 | no | 631 | 71 | 2026-03-09 | `ia:10043398` |
| `69e8b2ee2ff2a8dc09e790fc` | Phänomenologie des Geistes | internet_archive | 1832 | yes | 631 | 599 | 2026-04-22 | `ia:10043398` |

### ia:2236046R.nlm.nih.gov  (2 records)
_cross-form only · spread 248d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6948856a2f9c70e60597cb30` | Marsilii Ficini Florentini medici atq[ue] philosophi celeberrimi, de v | internet_archive | 1529 | yes | 400 | 400 | 2025-12-21 | `ia:2236046R.nlm.nih.gov` |
| `6a8f623eddd2f57fe0f81972` | De vita libri tres | internet_archive | Unknown | no | 400 | 0 | 2026-08-26 | `iiif:https://iiif.archive.org/iiif/2236046R.nlm.nih.gov/manifest.json` |

### ia:4051127.med.yale.edu  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a9053e3dbce5358e41f69d1` | Opera medica, sive Practica cum textu noni ad Almansorem | internet_archive | 1497 | no | 502 | 24 | 2026-08-27 | `ia:4051127.med.yale.edu` |
| `6a9053e3dbce5358e41f69d3` | Opera medica, sive Practica cum textu noni ad Almansorem | internet_archive | 1497 | no | 502 | 24 | 2026-08-27 | `ia:4051127.med.yale.edu` |

### ia:4066587  (2 records)
_cross-form only · spread 1d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69dc5597cb6f7429748b9029` | Herbarius latinus (with French synonyms) | internet_archive | 1486 | yes | 360 | 360 | 2026-04-13 | `ia:4066587` |
| `69de1c7ae4ae5c1c0c209d09` | Herbarius latinus (with French synonyms) | internet_archive | 1486 | no | 360 | 0 | 2026-04-14 | `` |

### ia:A0862014  (2 records)
_cross-form only · spread 62d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a429bcb8e351c27eb85c50c` | Vitae Humanae Proscenium , [Mateo Alemán]. Caspare Ens editore Teil: 3 | internet_archive | 1623 | no | 417 | 21 | 2026-06-29 | `ia:A0862014` |
| `6a941450194e2c21138ea3f0` | Vitae Humanae Proscenium , [Mateo Alemán]. Caspare Ens editore Teil: 2 | iiif | Unknown | no | 417 | 0 | 2026-08-30 | `iiif:https://iiif.archive.org/iiif/A0862014/manifest.json` |

### ia:ancientindiaasd01mccrgoog  (2 records)
_scalar-visible · spread 27d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69c666895ee2cfa2f502ce90` | Indica — Ancient India as Described by Megasthenes and Arrian | internet_archive | -300 | no | 247 | 0 | 2026-03-27 | `ia:ancientindiaasd01mccrgoog` |
| `69e961c22beefe2f6f72cce6` | Ancient India as Described by Megasthenes and Arrian | internet_archive | 1877 | yes | 247 | 238 | 2026-04-23 | `ia:ancientindiaasd01mccrgoog` |

### ia:apicicaelidereco00apicrich  (2 records)
_scalar-visible · spread 43d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69af4444acad5968d2fb4749` | Apicii Caeli De Re Coquinaria Libri Decem (Schuch 1867) | internet_archive | 1867 | no | 216 | 50 | 2026-03-09 | `ia:apicicaelidereco00apicrich` |
| `69e78236d93c1f6007503c0a` | De Re Coquinaria (On the Art of Cooking) | internet_archive | 1909 | yes | 216 | 216 | 2026-04-21 | `ia:apicicaelidereco00apicrich` |

### ia:avestadieheilige02spie  (2 records)
_scalar-visible · spread 38d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd954f6a23f5594be16b5b` | Avesta, die heiligen Schriften der Parsen, Zweiter Band | internet_archive | 1858 | no | 588 | 50 | 2026-03-20 | `ia:avestadieheilige02spie` |
| `69ef242985daccce30f2ab2d` | Avesta, die heiligen Schriften der Parsen, aus dem Grundtexte übersetz | internet_archive | 1853 | no | 588 | 588 | 2026-04-27 | `ia:avestadieheilige02spie` |

### ia:b13134838_0002  (2 records)
_cross-form only · spread 87d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a243c4d0f0e4f405e62df42` | Magiae naturalis libri viginti | internet_archive | 1589 | no | 324 | 0 | 2026-06-06 | `iiif:https://iiif.archive.org/iiif/b13134838_0002/manifest.json` |
| `69b1c648edda7fb64e1a0c6b` | Magia Naturalis Libri Viginti | internet_archive | 1589 | yes | 324 | 324 | 2026-03-11 | `ia:b13134838_0002` |

### ia:b24876069_0001  (2 records)
_scalar-visible · spread 84d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a1d4f28e63d24731006b77b` | The Devils and Evil Spirits of Babylonia, Vol. I (incl. the Seven Evil | internet_archive | 1903 | yes | 290 | 272 | 2026-06-01 | `ia:b24876069_0001` |
| `69aea752e632ebb5ea2bdb91` | The Devils and Evil Spirits of Babylonia, Vol. I: Evil Spirits | internet_archive | 1903 | no | 290 | 25 | 2026-03-09 | `ia:b24876069_0001` |

### ia:bim_early-english-books-1475-1640_-hoc-est-as_fulke-william_1572  (2 records)
_cross-form only · spread 164d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69b8744813506fe62959a48c` | Ouranomachia, hoc est, astrologorum ludus | internet_archive | 1572 | yes | 53 | 25 | 2026-03-16 | `ia:bim_early-english-books-1475-1640_-hoc-est-as_fulke-william_1572` |
| `6a9059817f6818cc17cda347` | Ouranomakhia, hoc est, Astrologorum ludus ad bonarum artium, & astrolo | iiif | Unknown | no | 53 | 0 | 2026-08-27 | `iiif:https://iiif.archive.org/iiif/3/bim_early-english-books-1475-1640_-hoc-est-as_fulke-william_1572/manifest.json` |

### ia:bim_early-english-books-1475-1640_adriani-heereboord-p_heereboord-adrian_1665  (2 records)
_cross-form only · spread 59d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a426e8628e9db2e39c08050` | Philosophia naturalis sive physica | internet_archive | 1665 | no | 274 | 25 | 2026-06-29 | `ia:bim_early-english-books-1475-1640_adriani-heereboord-p_heereboord-adrian_1665` |
| `6a907c707f9d520dd42e84a3` | Collegium physicum: in quo tota philosophia naturalis aliquot disputat | iiif | Unknown | no | 274 | 0 | 2026-08-27 | `iiif:https://iiif.archive.org/iiif/3/bim_early-english-books-1475-1640_adriani-heereboord-p_heereboord-adrian_1665/manifest.json` |

### ia:bim_early-english-books-1475-1640_jobus-theodori-beza-p_beze-theodori_1589  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4b13c27622bb5aba12951e` | Jobus partim commentariis partim paraphrasi illustratus | internet_archive | Unknown | no | 345 | 0 | 2026-07-06 | `iiif:https://iiif.archive.org/iiif/3/bim_early-english-books-1475-1640_jobus-theodori-beza-p_beze-theodori_1589/manifest.json` |
| `6a42f04f06e6ead3ac54c0eb` | Jobus, Theodori Bezae partim commentariis partim paraphrasi illustratu | internet_archive | 1589 | no | 345 | 25 | 2026-06-29 | `ia:bim_early-english-books-1475-1640_jobus-theodori-beza-p_beze-theodori_1589` |

### ia:bim_early-english-books-1475-1640_pruritanus-vel-nec-omne_dolabella-horatius-pse_1609  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a42bcef97284560a2b05c72` | Prurit-anus, vel nec omne, nec ex omni | internet_archive | 1609 | no | 55 | 25 | 2026-06-29 | `ia:bim_early-english-books-1475-1640_pruritanus-vel-nec-omne_dolabella-horatius-pse_1609` |
| `6a4a23a53d1efcd10c6a3f84` | Prurit-anus, vel nec omne, nec ex omni. Sive apologia pro Puritanis, & | internet_archive | Unknown | no | 55 | 0 | 2026-07-05 | `iiif:https://iiif.archive.org/iiif/3/bim_early-english-books-1475-1640_pruritanus-vel-nec-omne_dolabella-horatius-pse_1609/manifest.json` |

### ia:bim_early-english-books-1475-1640_psalmorum-davidis-et-ali_beze-theodore-de_1580  (2 records)
_cross-form only · spread 56d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a9416c05b00fbf8c93eafb7` | CL. Psalmorum Davidis et aliorum prophetarum libri quinque. | internet_archive | 1580 | no | 707 | 0 | 2026-08-30 | `ia:bim_early-english-books-1475-1640_psalmorum-davidis-et-ali_beze-theodore-de_1580` |
| `6a4a39b61d5971734c0b418d` | Psalmorum sacrorum libri quinque latine expressi. secunda ed. | internet_archive | Unknown | no | 707 | 0 | 2026-07-05 | `iiif:https://iiif.archive.org/iiif/3/bim_early-english-books-1475-1640_psalmorum-davidis-et-ali_beze-theodore-de_1580/manifest.json` |

### ia:bim_early-english-books-1475-1640_roberti-whittintoni-lich_whittington-robt_1523  (2 records)
_cross-form only · spread 59d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a9097b7b7feee6e9c4260a4` | lucubrationes. De synonimis | iiif | Unknown | no | 63 | 0 | 2026-08-27 | `iiif:https://iiif.archive.org/iiif/3/bim_early-english-books-1475-1640_roberti-whittintoni-lich_whittington-robt_1523/manifest.json` |
| `6a4346af201f98f53c3ef33a` | lucubrationes | internet_archive | 1523 | no | 63 | 25 | 2026-06-30 | `ia:bim_early-english-books-1475-1640_roberti-whittintoni-lich_whittington-robt_1523` |

### ia:bim_early-english-books-1475-1640_t-oliverii-de-sophismat_oliver-thomas_1604  (2 records)
_cross-form only · spread 59d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a90e4ca43335ae064878ce3` | Thomæ Oliverii Buriensis Philiatri. De sophismatum præstigijs cauendis | iiif | Unknown | no | 145 | 0 | 2026-08-28 | `iiif:https://iiif.archive.org/iiif/3/bim_early-english-books-1475-1640_t-oliverii-de-sophismat_oliver-thomas_1604/manifest.json` |
| `6a42765128e9db2e39c1c31d` | De Sophismatum Praestigiis Cavendis Tractatus Paraeneticus : In Quo Ac | internet_archive | 1604 | no | 145 | 25 | 2026-06-29 | `ia:bim_early-english-books-1475-1640_t-oliverii-de-sophismat_oliver-thomas_1604` |

### ia:bim_early-english-books-1641-1700_de-principiis-ratiocin_hobbes-thomas_1666  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a426627dfbbb4d07aa6d1e6` | De principiis & ratiocinatione geometrarum. Ubi oftenditur incertitudi | internet_archive | 1666 | no | 97 | 25 | 2026-06-29 | `ia:bim_early-english-books-1641-1700_de-principiis-ratiocin_hobbes-thomas_1666` |
| `6a426627dfbbb4d07aa6d1e7` | De principiis et ratiocinatione geometrarum, ubi oftenditur incertitud | internet_archive | 1666 | no | 97 | 25 | 2026-06-29 | `ia:bim_early-english-books-1641-1700_de-principiis-ratiocin_hobbes-thomas_1666` |

### ia:bim_early-english-books-1641-1700_dissertatio-de-arthritid_rhijne-willem-ten_1683  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4afac3d058dfe9e20c5ae6` | Wilhelmi ten Rhyne M.D. &c. Transisalano-Daventriensis Dissertatio de  | internet_archive | Unknown | no | 395 | 0 | 2026-07-06 | `iiif:https://iiif.archive.org/iiif/3/bim_early-english-books-1641-1700_dissertatio-de-arthritid_rhijne-willem-ten_1683/manifest.json` |
| `6a4300e54e06bc233ecf6f0f` | Dissertatio de arthritide: mantissa schematica: de acupunctura: et ora | internet_archive | 1683 | no | 395 | 25 | 2026-06-29 | `ia:bim_early-english-books-1641-1700_dissertatio-de-arthritid_rhijne-willem-ten_1683` |

### ia:bim_early-english-books-1641-1700_dissertationes-medico-ph_connor-bernard_1695  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a491cd9a9e39181572e664e` | De antris lethiferis Dissertationes medico-physica. In quâ diversæ ant | internet_archive | Unknown | no | 103 | 0 | 2026-07-04 | `iiif:https://iiif.archive.org/iiif/3/bim_early-english-books-1641-1700_dissertationes-medico-ph_connor-bernard_1695/manifest.json` |
| `6a491cd9a9e39181572e664d` | Dissertationes medico-physicæ. De antris lethiferis. De Montis Vesuvii | internet_archive | Unknown | no | 103 | 0 | 2026-07-04 | `iiif:https://iiif.archive.org/iiif/3/bim_early-english-books-1641-1700_dissertationes-medico-ph_connor-bernard_1695/manifest.json` |

### ia:bim_early-english-books-1641-1700_epistol-quatuor-_smith-thomas-of-magdal_1674  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a50020bbdcf926c5d24eba1` | Epistolæ quatuor; quarum duæ de moribus ac institutis Turcarvm agunt,  | internet_archive | 1674 | no | 337 | 25 | 2026-07-09 | `ia:bim_early-english-books-1641-1700_epistol-quatuor-_smith-thomas-of-magdal_1674` |
| `6a50020bbdcf926c5d24eba0` | Epistolæ quatuor; quarum duæ de moribus ac institutis Turcarum agunt,  | internet_archive | 1674 | no | 337 | 25 | 2026-07-09 | `ia:bim_early-english-books-1641-1700_epistol-quatuor-_smith-thomas-of-magdal_1674` |

### ia:bim_early-english-books-1641-1700_institutio-logic-in-usu_marsh-narcissus-abp_1679  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a42686cf70718a51b8a6dad` | Institutio logicae in usum juventis academicae Dubliniensis. | internet_archive | 1679 | no | 307 | 25 | 2026-06-29 | `ia:bim_early-english-books-1641-1700_institutio-logic-in-usu_marsh-narcissus-abp_1679` |
| `6a49326c187213d999f719aa` | Institutiones logicæ. In usum juventutis academicæ Dubliniensis. | internet_archive | Unknown | no | 307 | 0 | 2026-07-04 | `iiif:https://iiif.archive.org/iiif/3/bim_early-english-books-1641-1700_institutio-logic-in-usu_marsh-narcissus-abp_1679/manifest.json` |

### ia:bim_early-english-books-1641-1700_institutionum-chronologi_beveridge-william-bp_1669_1  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a42754428e9db2e39c19985` | Institutionum chronologicarum libri II. Unà cum totidem arithmetices c | internet_archive | 1669 | no | 273 | 25 | 2026-06-29 | `ia:bim_early-english-books-1641-1700_institutionum-chronologi_beveridge-william-bp_1669_1` |
| `6a42754428e9db2e39c19986` | Institutionum chronologicarum libri II. Unà cum totidem arithmetices c | internet_archive | 1669 | no | 273 | 25 | 2026-06-29 | `ia:bim_early-english-books-1641-1700_institutionum-chronologi_beveridge-william-bp_1669_1` |

### ia:bim_early-english-books-1641-1700_patrologiae-cursus-completus-_1844_7  (2 records)
_cross-form only · spread 0d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4a19647ff3129f6868349c` | Patrologia Graeca, Vol. 7 (Migne) | internet_archive | 1844 | no | 605 | 0 | 2026-07-05 | `ia:bim_early-english-books-1641-1700_patrologiae-cursus-completus-_1844_7` |
| `6a4a225987ace2493ebc6e56` | Patrologia Graeca, Vol. 7 (ed. Migne) | internet_archive | Unknown | no | 605 | 0 | 2026-07-05 | `` |

### ia:bim_early-english-books-1641-1700_patrologiae-cursus-completus-_1845_10  (2 records)
_cross-form only · spread 0d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4a19a9a7711f6303e3f94f` | Patrologia Graeca, Vol. 10 (Migne) | internet_archive | 1845 | no | 523 | 0 | 2026-07-05 | `ia:bim_early-english-books-1641-1700_patrologiae-cursus-completus-_1845_10` |
| `6a4a234087ace2493ebc7ab0` | Patrologia Graeca, Vol. 10 (ed. Migne) | internet_archive | Unknown | no | 523 | 0 | 2026-07-05 | `` |

### ia:bim_early-english-books-1641-1700_patrologiae-cursus-completus-_1857_4  (2 records)
_cross-form only · spread 0d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4a194b7ff3129f68683231` | Patrologia Graeca, Vol. 4 (Migne) | internet_archive | 1857 | no | 551 | 0 | 2026-07-05 | `ia:bim_early-english-books-1641-1700_patrologiae-cursus-completus-_1857_4` |
| `6a4a21b20ce670ef426843eb` | Patrologia Graeca, Vol. 4 (ed. Migne) | internet_archive | Unknown | no | 551 | 0 | 2026-07-05 | `` |

### ia:bim_early-english-books-1641-1700_patrologiae-cursus-completus-_1860_78  (2 records)
_cross-form only · spread 104d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69c10d9a42741c656896364d` | Patrologia Graeca vol. 78 — Isidore of Pelusium: Epistulae | internet_archive | 1860 | yes | 889 | 889 | 2026-03-23 | `ia:bim_early-english-books-1641-1700_patrologiae-cursus-completus-_1860_78` |
| `6a4a2ce087ace2493ebd195f` | Patrologia Graeca, Vol. 78 (ed. Migne) | internet_archive | Unknown | no | 889 | 0 | 2026-07-05 | `` |

### ia:bim_early-english-books-1641-1700_physic-scienti-compend_sanderson-robert-bp_1671  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a42c5a2e76baa13aa846866` | Physicæ scientiæ compendivm. A Roberto Sanderson Coll. Lincoln. in alm | internet_archive | 1671 | no | 122 | 25 | 2026-06-29 | `ia:bim_early-english-books-1641-1700_physic-scienti-compend_sanderson-robert-bp_1671` |
| `6a42c5a2e76baa13aa846867` | Physicæ scientiæ compendium. A Roberto Sanderson Coll. Lincoln. in alm | internet_archive | 1671 | no | 122 | 25 | 2026-06-29 | `ia:bim_early-english-books-1641-1700_physic-scienti-compend_sanderson-robert-bp_1671` |

### ia:bim_early-english-books-1641-1700_prosodia-henrici-smetii-_smet-henrich_1648  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a424f04c1f44d759e6d1ba4` | Prosodia Henrici Smetii, RVB.F.A Leda, Alostani, Flandri, Medicinæ doc | internet_archive | 1648 | no | 597 | 25 | 2026-06-29 | `ia:bim_early-english-books-1641-1700_prosodia-henrici-smetii-_smet-henrich_1648` |
| `6a4ab1860a459d47e0cff452` | Thesaurus poeticus, hoc est Prosodia Henrici Smetii medicinae doct. pr | internet_archive | Unknown | no | 597 | 0 | 2026-07-05 | `iiif:https://iiif.archive.org/iiif/3/bim_early-english-books-1641-1700_prosodia-henrici-smetii-_smet-henrich_1648/manifest.json` |

### ia:bim_early-english-books-1641-1700_v-cl-gulielmi-cambdeni_camden-william_1653  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a51e06c612243b2741199fa` | V. CL. Gulielmi Cambdeni elogia Anglorum. Hi majores tui sunt, si te i | internet_archive | 1653 | no | 27 | 25 | 2026-07-11 | `ia:bim_early-english-books-1641-1700_v-cl-gulielmi-cambdeni_camden-william_1653` |
| `6a51e06c612243b2741199fb` | V.CL. Elogia Anglorum Cambdeniana. Hi majores tui sunt, si te illis di | internet_archive | 1653 | no | 27 | 25 | 2026-07-11 | `ia:bim_early-english-books-1641-1700_v-cl-gulielmi-cambdeni_camden-william_1653` |

### ia:bim_eighteenth-century_ethices-elementa_johnson-samuel-dd-_1746  (2 records)
_scalar-visible · spread 112d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4a339a9ae8c432ae16424a` | Ethices Elementa, or the First Principles of Moral Philosophy | internet_archive | 1746 | yes | 71 | 0 | 2026-07-05 | `ia:bim_eighteenth-century_ethices-elementa_johnson-samuel-dd-_1746` |
| `69b64018535439aaa4893251` | Ethices elementa | internet_archive | 1746 | no | 71 | 0 | 2026-03-15 | `ia:bim_eighteenth-century_ethices-elementa_johnson-samuel-dd-_1746` |

### ia:BIUSante_00127x01  (2 records)
_scalar-visible · spread 43d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69af0cc9067c0c26ee26ca6f` | Liber Theoricae necnon Practicae (Kitab al-Tasrif) | internet_archive | 1519 | no | 331 | 0 | 2026-03-09 | `ia:BIUSante_00127x01` |
| `69e80652fdad300064d9eb99` | Liber Theoricae necnon Practicae (Kitāb al-Taṣrīf) | internet_archive | 1519 | yes | 331 | 331 | 2026-04-21 | `ia:BIUSante_00127x01` |

### ia:BIUSante_00276  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4261db744db9e3105ab24c` | Historia anatomica humani corporis et singularum eius partium multis c | internet_archive | 1600 | no | 662 | 25 | 2026-06-29 | `ia:BIUSante_00276` |
| `6a4261db744db9e3105ab24d` | Historia anatomica humani corporis et singularum eius partium multis c | internet_archive | 1600 | no | 662 | 25 | 2026-06-29 | `ia:BIUSante_00276` |

### ia:bub_gb_0sy7mC3T6RUC  (2 records)
_cross-form only · spread 59d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a42b57a466deeb51e561738` | Mariale. De singulis festivitatibus beate virginis per modum sermonum  | internet_archive | 1515 | no | 927 | 21 | 2026-06-29 | `ia:bub_gb_0sy7mC3T6RUC` |
| `6a9092460f0bff48dccbd29c` | Mariale (additions by Domenico Ponzoni). Officium et missa Immaculatae | iiif | Unknown | no | 927 | 0 | 2026-08-27 | `iiif:https://iiif.archive.org/iiif/bub_gb_0sy7mC3T6RUC/manifest.json` |

### ia:bub_gb_0Y2tyJqzh_oC  (2 records)
_cross-form only · spread 23d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a423b07c1f44d759e6ccae4` | Astrolabii declaratio, ejusdemque usus mire jucundus, non modo astrolo | internet_archive | 1550 | no | 62 | 25 | 2026-06-29 | `ia:bub_gb_0Y2tyJqzh_oC` |
| `6a243c360f0e4f405e62d28d` | Astrolabii declaratio, eiusdemque usus mire iucundus, non modò astrolo | internet_archive | 1550 | no | 62 | 0 | 2026-06-06 | `iiif:https://iiif.archive.org/iiif/bub_gb_0Y2tyJqzh_oC/manifest.json` |

### ia:bub_gb_5KYXZx9O9isC  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a905326ee2696c623568366` | De Medicamentorum Facultatibus cognoscendis & applicandis, Libri Duo | internet_archive | 1678 | no | 272 | 25 | 2026-08-27 | `ia:bub_gb_5KYXZx9O9isC` |
| `6a905326ee2696c623568367` | De Medicamentorum Facultatibus Cognoscendis Et Applicandis, Libri Duo: | internet_archive | 1678 | no | 272 | 25 | 2026-08-27 | `ia:bub_gb_5KYXZx9O9isC` |

### ia:bub_gb_5tlNAAAAcAAJ  (2 records)
_scalar-visible · spread 69d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69aeaab4725425fa6ac9784c` | Gli Asolani | google_books | 1515 | no | 275 | 25 | 2026-03-09 | `ia:bub_gb_5tlNAAAAcAAJ` |
| `6a097157bf2196cdca9062ec` | Gli Asolani di messer Pietro Bembo. | internet_archive | 1515 | yes | 274 | 273 | 2026-05-17 | `ia:bub_gb_5tlNAAAAcAAJ` |

### ia:bub_gb_ciXTHg66tnUC  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a42743562d175ca9e4e6ecd` | Microcosmi physicomathematici, sev compendij, in quo clare, & breviter | internet_archive | 1658 | no | 204 | 25 | 2026-06-29 | `ia:bub_gb_ciXTHg66tnUC` |
| `6a42743562d175ca9e4e6ece` | Microcosmi physicomathematici, seu Compendij, in quo clarè, & breuiter | internet_archive | 1658 | no | 204 | 25 | 2026-06-29 | `ia:bub_gb_ciXTHg66tnUC` |

### ia:bub_gb_Dz2yCiIYY7sC  (2 records)
_cross-form only · spread 62d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a94166ba4ed5935447a72dd` | Decisionum Et Rerum Iudicatarum, Sive, Ut Vocant, Arrestorum, In Diver | iiif | Unknown | no | 963 | 0 | 2026-08-30 | `iiif:https://iiif.archive.org/iiif/bub_gb_Dz2yCiIYY7sC/manifest.json` |
| `6a42fb94feb36226e8f0c988` | Corpus juris francici, seu, absolutissima collectio arrestorum, sine r | internet_archive | 1624 | no | 963 | 25 | 2026-06-29 | `ia:bub_gb_Dz2yCiIYY7sC` |

### ia:bub_gb_hEuii1gflHIC  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a9052fef5d60d98b2ecd16d` | De Piscinis Libri V. Accedunt eiusdem argumenti ex veterum recentiorum | internet_archive | 1671 | no | 202 | 25 | 2026-08-27 | `ia:bub_gb_hEuii1gflHIC` |
| `6a9052feee2696c623567ea6` | De Piscinis Libri V. Accedunt eiusdem argumenti ex veterum recentiorum | internet_archive | 1671 | no | 202 | 25 | 2026-08-27 | `ia:bub_gb_hEuii1gflHIC` |

### ia:bub_gb_IjkgazuQOCMC  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a42e9fe06e6ead3ac53efe9` | Medulla Theologica ex S.S. Scripturis Conciliorum Pontificumque decret | internet_archive | 1680 | no | 599 | 25 | 2026-06-29 | `ia:bub_gb_IjkgazuQOCMC` |
| `6a42e9fe06e6ead3ac53efea` | Medulla Theologica ex S.S. Scripturis Conciliorum Pontificumque decret | internet_archive | 1680 | no | 599 | 25 | 2026-06-29 | `ia:bub_gb_IjkgazuQOCMC` |

### ia:bub_gb_Kl2FNgPwg54C  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4268deaedf4c943f91f8c8` | Philosophia vetus et noua, ad usum scholae accommodata in regia Burgun | internet_archive | 1682 | no | 594 | 25 | 2026-06-29 | `ia:bub_gb_Kl2FNgPwg54C` |
| `6a4268deaedf4c943f91f8c9` | Philosophia vetus, et noua ad usum scholae accomodata, in regia Burgun | internet_archive | 1682 | no | 594 | 25 | 2026-06-29 | `ia:bub_gb_Kl2FNgPwg54C` |

### ia:bub_gb_N-OJUHoY7JcC  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a90ad982764d973ba12cea2` | Opera omnia, in decem tomos distributa, quibus continentur tam priora, | internet_archive | 1658 | no | 916 | 25 | 2026-08-27 | `ia:bub_gb_N-OJUHoY7JcC` |
| `6a90ad982764d973ba12d238` | Opera omnia, in decem tomos distributa, quibus continentur tam priora, | internet_archive | 1658 | no | 916 | 25 | 2026-08-27 | `ia:bub_gb_N-OJUHoY7JcC` |

### ia:bub_gb_NQHhYfAWHbcC  (2 records)
_cross-form only · spread 59d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a90a6be19b0108536a7f5ea` | Carminum libri tres altera editione plurimum aucti | iiif | Unknown | no | 582 | 0 | 2026-08-27 | `iiif:https://iiif.archive.org/iiif/bub_gb_NQHhYfAWHbcC/manifest.json` |
| `6a4374f90dc50ef3af2662f4` | carminum libri tres | internet_archive | 1616 | no | 582 | 11 | 2026-06-30 | `ia:bub_gb_NQHhYfAWHbcC` |

### ia:bub_gb_q3K4JNqlZRcC  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4306c622c0c8edb0f890dc` | De Recta Doctrina Morum: Cum Indicibus Quaestionum, & Rerum praecipuar | internet_archive | 1684 | no | 407 | 10 | 2026-06-29 | `ia:bub_gb_q3K4JNqlZRcC` |
| `6a4306c622c0c8edb0f89274` | De Recta Doctrina Morum: Cum Indicibus Quaestionum, & Paragraphorum pr | internet_archive | 1684 | no | 407 | 15 | 2026-06-29 | `ia:bub_gb_q3K4JNqlZRcC` |

### ia:bub_gb_RSjke3UyH3AC  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a42733362d175ca9e4e55ec` | Volantis flammae a perillustri, & excellentissimo d. Geminiano Montana | internet_archive | 1677 | no | 76 | 25 | 2026-06-29 | `ia:bub_gb_RSjke3UyH3AC` |
| `6a42733362d175ca9e4e55ed` | Volantis flammae a perillust. & excell.mo D. Geminiano Montanario ...  | internet_archive | 1677 | no | 76 | 25 | 2026-06-29 | `ia:bub_gb_RSjke3UyH3AC` |

### ia:bub_gb_sLcPpUcBniMC  (2 records)
_scalar-visible · spread 68d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69aebfa3c337b1e6a4d581e3` | Arte della guerra di Nicolo Machiavelli | internet_archive | 1540 | no | 270 | 25 | 2026-03-09 | `ia:bub_gb_sLcPpUcBniMC` |
| `6a08572615c643eb1af5ad9f` | Libro dell'arte della guerra di Nicolo' Machiauelli cittadino, et secr | internet_archive | 1540 | yes | 270 | 270 | 2026-05-16 | `ia:bub_gb_sLcPpUcBniMC` |

### ia:bub_gb_smdEAAAAcAAJ  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a426eb928e9db2e39c08bb0` | Ethica Complementoria = Complementier-Büchlein : Darinn Ein richtige A | internet_archive | 1646 | no | 153 | 25 | 2026-06-29 | `ia:bub_gb_smdEAAAAcAAJ` |
| `6a426eb928e9db2e39c08bb1` | Ethica Complementoria: Complementier-Büchlein; Darin Ein richtige Art  | internet_archive | 1646 | no | 153 | 25 | 2026-06-29 | `ia:bub_gb_smdEAAAAcAAJ` |

### ia:bub_gb_wNp3KxRo00EC  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a46af6e8ed0c3d810b06d74` | De feudis commentatio tripartita. Hoc est, disputatio de jure feudali. | internet_archive | 1573 | no | 482 | 25 | 2026-07-02 | `ia:bub_gb_wNp3KxRo00EC` |
| `6a46af6e8ed0c3d810b06d75` | De feudis commentatio tripertita hoc est, disputatio de jure feudali.  | internet_archive | 1573 | no | 482 | 25 | 2026-07-02 | `ia:bub_gb_wNp3KxRo00EC` |

### ia:bub_gb_xsE_AAAAcAAJ  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4265bcdfbbb4d07aa6bf13` | Consilium Medicum, Dialogus, Oder Freundliches Gespräch, über den betr | internet_archive | 1679 | no | 112 | 25 | 2026-06-29 | `ia:bub_gb_xsE_AAAAcAAJ` |
| `6a4265bcdfbbb4d07aa6bf15` | Consilium Medicum, Oder Freundliches Gespräch, Uber den betrübten und  | internet_archive | 1679 | no | 112 | 25 | 2026-06-29 | `ia:bub_gb_xsE_AAAAcAAJ` |

### ia:bub_gb_zXjxX4yFwF8C  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a9055cdce61c4a7de146884` | Historia Philosophica : continens veterum phil., qui quidem praecipui  | internet_archive | 1674 | no | 1087 | 25 | 2026-08-27 | `ia:bub_gb_zXjxX4yFwF8C` |
| `6a9055cdce61c4a7de146885` | Historia Philosophica, Continens Veterum Phil. | internet_archive | 1674 | no | 1087 | 25 | 2026-08-27 | `ia:bub_gb_zXjxX4yFwF8C` |

### ia:bybeldernatuure2swam  (2 records)
_scalar-visible · spread 54d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a0b2508620b66ad8f232fb1` | Bybel der Natuure (Vol. 2) | internet_archive | 1738 | yes | 862 | 25 | 2026-05-18 | `ia:bybeldernatuure2swam` |
| `69c3ded5eb5da6fedc7925b0` | Bybel der Natuure, Vol. 2 (Biblia Naturae) | internet_archive | 1738 | no | 0 | 0 | 2026-03-25 | `ia:bybeldernatuure2swam` |

### ia:catalogueofethio00brituoft  (2 records)
_scalar-visible · spread 37d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69aea737971abe996d21be15` | Catalogue of the Ethiopic Manuscripts in the British Museum | internet_archive | 1877 | no | 418 | 0 | 2026-03-09 | `ia:catalogueofethio00brituoft` |
| `69dfda88220eedf04e13b747` | Catalogue of the Ethiopic Manuscripts in the British Museum | internet_archive | 1877 | yes | 422 | 421 | 2026-04-15 | `ia:catalogueofethio00brituoft` |

### ia:commonwealthof00harr  (2 records)
_scalar-visible · spread 118d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69aec4bf3b6ebce5e0ee7d42` | The Common-wealth of Oceana | internet_archive | 1656 | no | 318 | 25 | 2026-03-09 | `ia:commonwealthof00harr` |
| `6a4a1ba13a9243f77368eb3e` | The Commonwealth of Oceana | internet_archive | 1656 | yes | 318 | 0 | 2026-07-05 | `ia:commonwealthof00harr` |

### ia:cosmographia00ptol  (2 records)
_cross-form only · spread 161d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `694fd604435f95fd0c955916` | Cosmographia (Geography) | internet_archive | 1482 | yes | 276 | 276 | 2025-12-27 | `ia:cosmographia00ptol` |
| `6a24406d0f0e4f405e6378c8` | Cosmographia | internet_archive | 1482 | no | 276 | 0 | 2026-06-06 | `iiif:https://iiif.archive.org/iiif/cosmographia00ptol/manifest.json` |

### ia:cu31924005813591  (2 records)
_scalar-visible · spread 27d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bc7fda9615ef57a9cebffc` | The Life of the Buddha, derived from Tibetan Works | internet_archive | 1907 | no | 296 | 25 | 2026-03-19 | `ia:cu31924005813591` |
| `69dfdad3220eedf04e13bb16` | The Life of the Buddha, Derived from Tibetan Works | internet_archive | 1884 | yes | 296 | 296 | 2026-04-15 | `ia:cu31924005813591` |

### ia:defenceofconstit00adam_0  (2 records)
_scalar-visible · spread 118d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69aec4753b6ebce5e0ee6458` | A Defence of the Constitutions of Government of the United States of A | internet_archive | 1787 | no | 412 | 36 | 2026-03-09 | `ia:defenceofconstit00adam_0` |
| `6a4a170f3a9243f77368d0be` | A Defence of the Constitutions of Government of the United States of A | internet_archive | 1787 | yes | 411 | 0 | 2026-07-05 | `ia:defenceofconstit00adam_0` |

### ia:desacrisaedifici00ciam  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a44d105e46c70aa65d3c4af` | De sacris aedificiis a Costantino Magno constructis. Synopsis historic | internet_archive | 1693 | no | 312 | 25 | 2026-07-01 | `ia:desacrisaedifici00ciam` |
| `6a44d105e46c70aa65d3c4b0` | De sacris aedificiis a Constantino Magno constuctis. Synopsis historic | internet_archive | 1693 | no | 312 | 25 | 2026-07-01 | `ia:desacrisaedifici00ciam` |

### ia:discoursesconcer00sidnuoft  (2 records)
_scalar-visible · spread 118d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69aec4b93b6ebce5e0ee7b55` | Discourses Concerning Government (1704 First Authorized Edition) | internet_archive | 1704 | no | 486 | 49 | 2026-03-09 | `ia:discoursesconcer00sidnuoft` |
| `6a4a1b723a9243f77368e957` | Discourses Concerning Government | internet_archive | 1704 | yes | 486 | 0 | 2026-07-05 | `ia:discoursesconcer00sidnuoft` |

### ia:elementsofphilos00john  (2 records)
_scalar-visible · spread 112d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4a339d9ae8c432ae164292` | The Elements of Philosophy | internet_archive | 1754 | yes | 307 | 0 | 2026-07-05 | `ia:elementsofphilos00john` |
| `69b64022535439aaa489329b` | The elements of philosophy: containing the most useful parts of logic  | internet_archive | 1754 | no | 308 | 0 | 2026-03-15 | `ia:elementsofphilos00john` |

### ia:erhardivveigeli00weiggoog  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a9058c77f6818cc17cd6b33` | Idea Matheseos Universae: cum Speciminibus Inventionum Mathematicarum | internet_archive | 1669 | no | 74 | 25 | 2026-08-27 | `ia:erhardivveigeli00weiggoog` |
| `6a9058c77f6818cc17cd6b80` | Idea Matheseos Universae: cum Speciminibus Inventionum Mathematicarum | internet_archive | 1669 | no | 74 | 25 | 2026-08-27 | `ia:erhardivveigeli00weiggoog` |

### ia:ethiopicliturgyi00merc  (2 records)
_scalar-visible · spread 59d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6992543f59cdabeb78f1d2d6` | The Ethiopic Liturgy | internet_archive | 1915 | no | 518 | 0 | 2026-02-15 | `ia:ethiopicliturgyi00merc` |
| `69dfda6f220eedf04e13b542` | The Ethiopic Liturgy | internet_archive | 1915 | yes | 516 | 516 | 2026-04-15 | `ia:ethiopicliturgyi00merc` |

### ia:ethiopicversiono00charuoft  (2 records)
_cross-form only · spread 169d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6953112e77f38f6761bcbe3b` | The Ethiopic Version of the Book of Enoch | internet_archive | 1906 | yes | 282 | 282 | 2025-12-29 | `ia:ethiopicversiono00charuoft` |
| `6a31b2d38f67820f4a11d190` | The Ethiopic version of the book of Enoch | internet_archive | 1893 | yes | 282 | 282 | 2026-06-16 | `` |

### ia:gnosticjohnbapti00mead  (2 records)
_scalar-visible · spread 82d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69ae9393fd1584cb592e1c28` | The Gnostic John the Baptizer | internet_archive | 1924 | no | 158 | 150 | 2026-03-09 | `ia:gnosticjohnbapti00mead` |
| `6a1aa50dc8638d1ea5c80a42` | The Gnostic John the Baptizer: Selections from the Mandæan John-Book | internet_archive | 1924 | yes | 158 | 152 | 2026-05-30 | `ia:gnosticjohnbapti00mead` |

### ia:gri_33125015923333  (2 records)
_cross-form only · spread 154d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6958df52dc939691982c56f3` | De plantis Aegypti liber | internet_archive | 1592 | yes | 201 | 201 | 2026-01-03 | `ia:gri_33125015923333` |
| `6a243eac0f0e4f405e634785` | Prosperi Alpini De plantis Aegypti liber : In quo non pauci, qui circa | internet_archive | 1592 | no | 201 | 0 | 2026-06-06 | `iiif:https://iiif.archive.org/iiif/gri_33125015923333/manifest.json` |

### ia:historymythology0000unse  (2 records)
_scalar-visible · spread 32d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69b636d300f0e7a0aff1d012` | History and mythology of the Aztecs : the Codex Chimalpopoca | internet_archive | 1992 | no | 0 | 0 | 2026-03-15 | `ia:historymythology0000unse` |
| `69dfda5c220eedf04e13b443` | History and Mythology of the Aztecs: The Codex Chimalpopoca | internet_archive | 1992 | no | 254 | 0 | 2026-04-15 | `ia:historymythology0000unse` |

### ia:in.ernet.dli.2015.487147  (2 records)
_scalar-visible · spread 25d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69d007417d7491182a232894` | Rasārṇava | internet_archive | 1910 | yes | 564 | 522 | 2026-04-03 | `ia:in.ernet.dli.2015.487147` |
| `69af0c1986d6cf307c60b19b` | Rasarnava (Sanskrit Treatise on Alchemy and Chemistry) | internet_archive | 1910 | no | 564 | 0 | 2026-03-09 | `ia:in.ernet.dli.2015.487147` |

### ia:ita-bnc-ald-00000673-001  (2 records)
_scalar-visible · spread 67d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a06d1f39a48d51399960d08` | De Aetna dialogus | internet_archive | 1495 | yes | 82 | 25 | 2026-05-15 | `ia:ita-bnc-ald-00000673-001` |
| `69aeabd767e6731bc1366d91` | De Aetna | internet_archive | 1495 | no | 82 | 82 | 2026-03-09 | `ia:ita-bnc-ald-00000673-001` |

### ia:ita-bnc-ald-00000821-001  (2 records)
_scalar-visible · spread 64d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a06cd6ac749b698e5b2b98d` | C. Valerii Flacci Argonautica. Io. Baptistae Pij carmen ex quarto Argo | internet_archive | 1523 | no | 316 | 25 | 2026-05-15 | `ia:ita-bnc-ald-00000821-001` |
| `69b2233556715b0e324769c5` | Valerius Flaccus, Argonautica — with Orphic Argonautica (Aldine Press) | internet_archive | 1523 | no | 316 | 315 | 2026-03-12 | `ia:ita-bnc-ald-00000821-001` |

### ia:ita-bnc-ald-00000920-001  (2 records)
_scalar-visible · spread 64d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a06ca4fc749b698e5b28fb6` | Vergilius | internet_archive | 1501 | no | 474 | 25 | 2026-05-15 | `ia:ita-bnc-ald-00000920-001` |
| `69b220f956715b0e32473e9b` | Virgil, Opera — Eclogues, Georgics, Aeneid (Aldine Press) | internet_archive | 1501 | no | 474 | 472 | 2026-03-12 | `ia:ita-bnc-ald-00000920-001` |

### ia:ita-bnc-in1-00000601-001  (2 records)
_cross-form only · spread 57d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a909428ac1fcc717ba2fb82` | Carmina elegautissima [sic] de beata virgine Maria | iiif | Unknown | no | 238 | 0 | 2026-08-27 | `iiif:https://iiif.archive.org/iiif/ita-bnc-in1-00000601-001/manifest.json` |
| `6a45793c4409ce37745cbe8e` | Carmina | internet_archive | 1483 | no | 238 | 25 | 2026-07-01 | `ia:ita-bnc-in1-00000601-001` |

### ia:jatakachandrikachundrikavenkateshapanditamoonlighttoastrologysuryanarainrowb.1900_202003_581_J  (2 records)
_cross-form only · spread 114d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a26e16e65df759218cd7550` | Jataka Chandrika ( Chundrika) ( Venkatesha Pandita) Moonlight To Astro | internet_archive | 1900 | no | 86 | 0 | 2026-06-08 | `iiif:https://iiif.archive.org/iiif/jatakachandrikachundrikavenkateshapanditamoonlighttoastrologysuryanarainrowb.1900_202003_581_J/manifest.json` |
| `699068ed2e4efe910676a6a3` | Jataka Chandrika (Venkatesha Pandita) | internet_archive | 1912 | yes | 86 | 86 | 2026-02-14 | `ia:jatakachandrikachundrikavenkateshapanditamoonlighttoastrologysuryanarainrowb.1900_202003_581_J` |

### ia:kamasutraofvatsy00vatsuoft  (2 records)
_cross-form only · spread 63d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69de0b15534b281fb134e880` | The Kama Sutra of Vatsyayana | internet_archive | 1883 | yes | 216 | 215 | 2026-04-14 | `ia:kamasutraofvatsy00vatsuoft` |
| `6a31b2d88f67820f4a11d2ab` | The Kama sutra of Vatsyayana | internet_archive | 1883 | yes | 216 | 212 | 2026-06-16 | `` |

### ia:KitabAlFihrist  (2 records)
_scalar-visible · spread 22d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69b8f3b497a3fe83080f5020` | كتاب الفهرست (Kitāb al-Fihrist) | internet_archive | 1872 | no | 725 | 50 | 2026-03-17 | `ia:KitabAlFihrist` |
| `69d5ac2ed0bd3547a565582f` | Kitab al-Fihrist | internet_archive | 1872 | yes | 725 | 725 | 2026-04-08 | `ia:KitabAlFihrist` |

### ia:L105HomerOdysseyIIBooks1324  (2 records)
_scalar-visible · spread 89d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69937cebc970b9f8351dd628` | The Odyssey II: Books 13-24 (Loeb L105) | internet_archive | 1919 | no | 472 | 49 | 2026-02-16 | `ia:L105HomerOdysseyIIBooks1324` |
| `6a08a401fc6cdaefe240c699` | Homer: Odyssey, Vol. II (Books 13–24) (Loeb 105) | internet_archive | 1919 | no | 472 | 25 | 2026-05-16 | `ia:L105HomerOdysseyIIBooks1324` |

### ia:laotzutaotechin00laogoog  (2 records)
_scalar-visible · spread 34d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bc81fb173577a33741ed7e` | Tao-te-ching: Le livre de la voie et de la vertu | internet_archive | 1842 | no | 355 | 0 | 2026-03-19 | `ia:laotzutaotechin00laogoog` |
| `69e8b25c2ff2a8dc09e7773b` | 道德經 (Dào Dé Jīng) | internet_archive | 1842 | yes | 355 | 355 | 2026-04-22 | `ia:laotzutaotechin00laogoog` |

### ia:lawsofenglandc01blacuoft  (2 records)
_scalar-visible · spread 118d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69aec4e0426e983334087d75` | Commentaries on the Laws of England, Vol. 1 | internet_archive | 1765 | no | 500 | 25 | 2026-03-09 | `ia:lawsofenglandc01blacuoft` |
| `6a4a1a853a9243f77368e561` | Commentaries on the Laws of England, Vol. 1 | internet_archive | 1765 | yes | 500 | 0 | 2026-07-05 | `ia:lawsofenglandc01blacuoft` |

### ia:lexiconiurid_xxxx_1599_00  (2 records)
_cross-form only · spread 55d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4b0887e3f5ea0395c71821` | Lexicon iuridicum | internet_archive | 1599 | no | 1144 | 25 | 2026-07-06 | `ia:lexiconiurid_xxxx_1599_00` |
| `6a940f39d94aa2d484a6d64f` | Lexicon juridicum | iiif | Unknown | no | 1144 | 0 | 2026-08-30 | `iiif:https://iiif.archive.org/iiif/lexiconiurid_xxxx_1599_00/manifest.json` |

### ia:lifeofbenjaminfr00franiala  (2 records)
_scalar-visible · spread 118d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69aec4853b6ebce5e0ee67f4` | The Life of Benjamin Franklin (Autobiography) | internet_archive | 1845 | no | 658 | 25 | 2026-03-09 | `ia:lifeofbenjaminfr00franiala` |
| `6a4a16e93a9243f77368ce2b` | The Autobiography of Benjamin Franklin | internet_archive | 1840 | yes | 658 | 0 | 2026-07-05 | `ia:lifeofbenjaminfr00franiala` |

### ia:mahavamsagreatch00geigrich  (2 records)
_scalar-visible · spread 21d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69b99d281f30176bf4d36cc8` | The Mahavamsa, or The Great Chronicle of Ceylon | internet_archive | 1912 | no | 380 | 25 | 2026-03-17 | `ia:mahavamsagreatch00geigrich` |
| `69d5adf3d0bd3547a5656821` | Mahavamsa | internet_archive | 1912 | yes | 380 | 380 | 2026-04-08 | `ia:mahavamsagreatch00geigrich` |

### ia:masnavimanav0102jall  (2 records)
_scalar-visible · spread 35d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69e7299ba409200ea79f0b56` | مثنوی معنوی (Masnavī-yi Maʻnavī), Books 1-2 | internet_archive | 1851 | yes | 332 | 332 | 2026-04-21 | `ia:masnavimanav0102jall` |
| `69b924fc316a04dc833939c7` | مثنوی معنوی — دفتر ١–٢ (Masnavi, Books I–II, Bulaq 1851) | internet_archive | Unknown | no | 332 | 0 | 2026-03-17 | `ia:masnavimanav0102jall` |

### ia:masnavimanav0304jall  (2 records)
_scalar-visible · spread 35d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69e729a1a409200ea79f0ca5` | مثنوی معنوی (Masnavī-yi Maʻnavī), Books 3-4 | internet_archive | 1851 | yes | 352 | 352 | 2026-04-21 | `ia:masnavimanav0304jall` |
| `69b925033ef5a8d26942c3e2` | مثنوی معنوی — دفتر ٣–٤ (Masnavi, Books III–IV, Bulaq 1851) | internet_archive | 1851 | no | 352 | 25 | 2026-03-17 | `ia:masnavimanav0304jall` |

### ia:masnavimanav0507jall  (2 records)
_scalar-visible · spread 35d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69e729a7a409200ea79f0e08` | مثنوی معنوی (Masnavī-yi Maʻnavī), Books 5-7 | internet_archive | 1851 | yes | 452 | 452 | 2026-04-21 | `ia:masnavimanav0507jall` |
| `69b925093ef5a8d26942c545` | مثنوی معنوی — دفتر ٥–٧ (Masnavi, Books V–VII, Bulaq 1851) | internet_archive | 1851 | no | 452 | 25 | 2026-03-17 | `ia:masnavimanav0507jall` |

### ia:metaphysicsofari00aris  (2 records)
_scalar-visible · spread 26d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69ae66794b74f168e0c14646` | The Metaphysics of Aristotle | internet_archive | 1801 | no | 536 | 0 | 2026-03-09 | `ia:metaphysicsofari00aris` |
| `69d14a6c1c2a66dc094b41b2` | The Metaphysics of Aristotle | internet_archive | 1801 | yes | 536 | 520 | 2026-04-04 | `ia:metaphysicsofari00aris` |

### ia:oxyrhynchuspapyrunse_69  (2 records)
_scalar-visible · spread 18d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69cf7bb9878f40c5945f1eea` | The Oxyrhynchus Papyri, Part 5 | internet_archive | 1908 | yes | 386 | 355 | 2026-04-03 | `ia:oxyrhynchuspapyrunse_69` |
| `69b823b4116050f3ce4b2f9e` | The Oxyrhynchus Papyri, Part V | internet_archive | 1908 | no | 386 | 24 | 2026-03-16 | `ia:oxyrhynchuspapyrunse_69` |

### ia:oxyrhynchuspapyrunse_79  (2 records)
_scalar-visible · spread 18d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69cf7c36878f40c5945f2994` | The Oxyrhynchus Papyri, Part 15 | internet_archive | 1922 | yes | 286 | 271 | 2026-04-03 | `ia:oxyrhynchuspapyrunse_79` |
| `69b823e2116050f3ce4b38cd` | The Oxyrhynchus Papyri, Part XV | internet_archive | 1922 | no | 286 | 25 | 2026-03-16 | `ia:oxyrhynchuspapyrunse_79` |

### ia:patrologiae_cursus_completus_gr_vol_006_justin_et_al_version2  (2 records)
_cross-form only · spread 138d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4a222d87ace2493ebc6a9c` | Patrologia Graeca, Vol. 6 (ed. Migne) | internet_archive | Unknown | no | 953 | 0 | 2026-07-05 | `` |
| `69942ae0d607f8e57e4b598a` | Patrologia Graeca vol. 6: Justinus Martyr et alii | internet_archive | 1857 | no | 953 | 27 | 2026-02-17 | `ia:patrologiae_cursus_completus_gr_vol_006_justin_et_al_version2` |

### ia:patrologiae_cursus_completus_gr_vol_009_clemens_alexandrinus_2  (2 records)
_cross-form only · spread 138d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4a22a187ace2493ebc738e` | Patrologia Graeca, Vol. 9 (ed. Migne) | internet_archive | Unknown | no | 857 | 0 | 2026-07-05 | `` |
| `69942acdd607f8e57e4b525a` | Patrologia Graeca vol. 9: Clemens Alexandrinus II | internet_archive | 1857 | no | 857 | 45 | 2026-02-17 | `ia:patrologiae_cursus_completus_gr_vol_009_clemens_alexandrinus_2` |

### ia:patrologiae_cursus_completus_gr_vol_029  (2 records)
_cross-form only · spread 138d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4a264187ace2493ebca56e` | Patrologia Graeca, Vol. 29 (ed. Migne) | internet_archive | Unknown | no | 815 | 0 | 2026-07-05 | `` |
| `69942affd607f8e57e4b628d` | Patrologia Graeca vol. 29: Basil of Caesarea I | internet_archive | 1859 | yes | 815 | 806 | 2026-02-17 | `ia:patrologiae_cursus_completus_gr_vol_029` |

### ia:patrologiae_cursus_completus_gr_vol_037  (2 records)
_cross-form only · spread 138d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4a27d487ace2493ebcbccb` | Patrologia Graeca, Vol. 37 (ed. Migne) | internet_archive | Unknown | no | 811 | 0 | 2026-07-05 | `` |
| `69942b07d607f8e57e4b65be` | Patrologia Graeca vol. 37: Gregory of Nazianzus III | internet_archive | 1862 | yes | 811 | 810 | 2026-02-17 | `ia:patrologiae_cursus_completus_gr_vol_037` |

### ia:patrologiae_cursus_completus_lat_vol_008  (2 records)
_cross-form only · spread 138d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4a229f87ace2493ebc70b4` | Patrologia Graeca, Vol. 8 (ed. Migne) | internet_archive | Unknown | no | 729 | 0 | 2026-07-05 | `` |
| `699437d06879ff0184cb7719` | Patrologia Latina Vol. 8: Marius Victorinus — Adversus Arium et Opera | internet_archive | 1844 | yes | 729 | 729 | 2026-02-17 | `ia:patrologiae_cursus_completus_lat_vol_008` |

### ia:patrologiaecursu0001mign  (2 records)
_cross-form only · spread 0d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a499d645ba0d765bc7f83ad` | Patrologia Graeca, Vol. 1 (Migne) | internet_archive | 1844 | no | 890 | 25 | 2026-07-04 | `ia:patrologiaecursu0001mign` |
| `6a4a21420ce670ef42683ce5` | Patrologia Graeca, Vol. 1 (ed. Migne) | internet_archive | Unknown | no | 890 | 0 | 2026-07-05 | `` |

### ia:per_witchcraft-in-europe-and-america_de-lacrymis-sagarum_wolf-johann_1676_1084  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a42817428e9db2e39c25579` | De Lacrymis Sagarum. Disputationem Physicam, favente Numinis div. grat | internet_archive | 1676 | no | 16 | 15 | 2026-06-29 | `ia:per_witchcraft-in-europe-and-america_de-lacrymis-sagarum_wolf-johann_1676_1084` |
| `6a42817428e9db2e39c2557b` | De Lacrymis Sagarum. Disputationem Physicam, favente Numinis div. grat | internet_archive | 1676 | no | 16 | 12 | 2026-06-29 | `ia:per_witchcraft-in-europe-and-america_de-lacrymis-sagarum_wolf-johann_1676_1084` |

### ia:politicalfragmen00taylrich  (2 records)
_scalar-visible · spread 26d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69ae952214ec9b78c4cedaae` | Political Fragments of Archytas, Charondas, Zaleucus, and Other Ancien | internet_archive | 1822 | no | 144 | 143 | 2026-03-09 | `ia:politicalfragmen00taylrich` |
| `69d14b331c2a66dc094b4c37` | Political Fragments of Archytas, Charondas, Zaleucus + Hierocles | internet_archive | 1822 | yes | 144 | 144 | 2026-04-04 | `ia:politicalfragmen00taylrich` |

### ia:polynesianmythol00grey_0  (2 records)
_scalar-visible · spread 32d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69b63756fb43a22476f4608f` | Polynesian mythology and ancient traditional history of the New Zealan | internet_archive | 1855 | no | 0 | 0 | 2026-03-15 | `ia:polynesianmythol00grey_0` |
| `69e009a4846d79f28d566cd7` | Polynesian Mythology and Ancient Traditional History | internet_archive | 1855 | yes | 386 | 386 | 2026-04-15 | `ia:polynesianmythol00grey_0` |

### ia:popolvuhmayanboo0000unse  (2 records)
_scalar-visible · spread 32d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69b636cc00f0e7a0aff1d010` | Popol vuh : the Mayan book of the dawn of life | internet_archive | 1996 | no | 0 | 0 | 2026-03-15 | `ia:popolvuhmayanboo0000unse` |
| `69dfda33220eedf04e13b165` | Popol Vuh: The Mayan Book of the Dawn of Life | internet_archive | 1985 | no | 390 | 0 | 2026-04-15 | `ia:popolvuhmayanboo0000unse` |

### ia:popolvuhsacredbo0000goet  (2 records)
_scalar-visible · spread 32d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69b636c600f0e7a0aff1d00f` | Popol Vuh: The Sacred Book of the Ancient Quiche Maya | internet_archive | 1950-01-01 | no | 0 | 0 | 2026-03-15 | `ia:popolvuhsacredbo0000goet` |
| `69dfdb01220eedf04e13bc3f` | Popol Vuh: The Sacred Book of the Ancient Quiché Maya (Goetz/Morley) | internet_archive | 1950 | no | 298 | 0 | 2026-04-15 | `ia:popolvuhsacredbo0000goet` |

### ia:popolvuyhlelivr00bourgoog  (2 records)
_scalar-visible · spread 59d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69924997a2d53df4853bd36f` | Popol Vuh: Le livre sacré des Quichés | internet_archive | 1861 | no | 412 | 67 | 2026-02-15 | `ia:popolvuyhlelivr00bourgoog` |
| `69dfdb0d220eedf04e13bd6a` | Popol Vuh: Le Livre Sacré (1861 French ed.) | internet_archive | 1861 | yes | 412 | 409 | 2026-04-15 | `ia:popolvuyhlelivr00bourgoog` |

### ia:sacredbooksofchi00laozuoft  (2 records)
_scalar-visible · spread 58d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bc81cc173577a33741eaa6` | SBE 39: Texts of Taoism, Part 1 | internet_archive | 1891 | no | 362 | 0 | 2026-03-19 | `ia:sacredbooksofchi00laozuoft` |
| `6a087ec0b2a99026ccf70394` | The Sacred Books of China: The Texts of Taoism, Part 1 (Tao Te Ching;  | internet_archive | 1891 | yes | 362 | 358 | 2026-05-16 | `ia:sacredbooksofchi00laozuoft` |

### ia:thompson-1928-gilgamesh  (2 records)
_scalar-visible · spread 36d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69e63c211bb6e8b1496accf9` | The Epic of Gilgamish: Text, Transliteration, and Notes | internet_archive | 1930 | yes | 54 | 54 | 2026-04-20 | `ia:thompson-1928-gilgamesh` |
| `69b63734fb43a22476f4608b` | The Epic of Gilgamish | internet_archive | Unknown | no | 0 | 0 | 2026-03-15 | `ia:thompson-1928-gilgamesh` |

### ia:writingsofgeorge04wash  (2 records)
_scalar-visible · spread 118d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69aec48e3b6ebce5e0ee6a89` | The Writings of George Washington, Vol. 4 | internet_archive | 1839 | no | 594 | 44 | 2026-03-09 | `ia:writingsofgeorge04wash` |
| `6a4a20c7fd99a02b93700610` | The Writings of George Washington (Sparks ed.), Vol. 3 | internet_archive | 1834 | yes | 593 | 0 | 2026-07-05 | `ia:writingsofgeorge04wash` |

### ia:zhuangzipangzhu01unse  (2 records)
_scalar-visible · spread 32d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bc8296173577a33741f24d` | Zhuangzi Pang Zhu (莊子旁注, 1699) | internet_archive | 1699 | no | 196 | 0 | 2026-03-19 | `ia:zhuangzipangzhu01unse` |
| `69e72c60a409200ea79f46f6` | 莊子旁注 (Zhuangzi with Commentary), Vol. 1 | internet_archive | 1699 | yes | 196 | 196 | 2026-04-21 | `ia:zhuangzipangzhu01unse` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb00003120/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a909408b7feee6e9c424e6d` | Ljlium grammatice magistri Wilhelmi weert. Non modo discipulis imo mag | iiif | Unknown | no | 36 | 25 | 2026-08-27 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00003120/manifest` |
| `6a909408ac1fcc717ba2f892` | Ljlium grammatice magistri Wilhelmi. weert. Non modo discipulis. Imo m | iiif | Unknown | no | 36 | 25 | 2026-08-27 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00003120/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb00006584/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a493f1ff36483abc5bbc364` | Algorithmus linealis cum pulchris conditionius regule detri. Septem fr | mdz | Unknown | no | 32 | 0 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00006584/manifest` |
| `6a493f1fc643e4e3d3072bac` | Algorithmus linealis cum pulchris conditionibus regule detri: sept fra | mdz | Unknown | no | 32 | 0 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00006584/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb00011312/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4921351bbf4176e1e8401c` | Ain tractat der badenfart | mdz | Unknown | no | 44 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00011312/manifest` |
| `6a4921351bbf4176e1e84056` | Ain tractat der badenfart | mdz | Unknown | no | 44 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00011312/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb00011422/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4925671bbf4176e1e87168` | Epiphaniae medicorum. Speculum videndi urinas hominum. Clavis aperiend | mdz | Unknown | no | 428 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00011422/manifest` |
| `6a492567f7e0eb87cd017d98` | Epiphanie medicorum. Speculum videndi urinas hominum. Clauis aperiendi | mdz | Unknown | no | 428 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00011422/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb00025669/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a493d8dc643e4e3d30722c8` | Rechenbüchlein auff der federen auffs new übersehen, gemehret unnd geb | mdz | Unknown | no | 220 | 0 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00025669/manifest` |
| `6a493d8dc643e4e3d30722c9` | New Rechenbüchlein auff der federn gantz leicht aus rechtem grund inn  | mdz | Unknown | no | 220 | 0 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00025669/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb00025903/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4d7344e91798b676b478d8` | Habes hic lector. In evangelici doctoris Martini Lutheri laudem defens | mdz | Unknown | no | 34 | 0 | 2026-07-07 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00025903/manifest` |
| `6a4d7344e91798b676b478d7` | In evangelici doctoris Martini Lutheri laudem defensionemque elegias.  | mdz | Unknown | no | 34 | 0 | 2026-07-07 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00025903/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb00029026/manifest  (2 records)
_cross-form only · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a905a81785d9b40577f4dea` | Erudita juxta ac pia confabulatio de honestarum artium studiis, praeci | iiif | Unknown | no | 332 | 25 | 2026-08-27 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00029026/manifest` |
| `6a905a81785d9b40577f4ff3` | Erudita juxta ac pia confabulatio de honestarum artium studiis, praeci | mdz | 1555 | no | 332 | 25 | 2026-08-27 | `mdz:bsb00029026` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb00036184/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a909e9dde206b9e7fad5c8b` | De justificatione contra colloquium altenburgense libri sex. In quibus | iiif | Unknown | no | 728 | 25 | 2026-08-27 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00036184/manifest` |
| `6a909e9dde206b9e7fad5c8f` | De justificatione contra colloquium altenburgense libri sex. In quibus | iiif | Unknown | no | 728 | 25 | 2026-08-27 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb00036184/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb00058572/manifest  (2 records)
_cross-form only · concurrency race · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69dbcc260f8c5edf20f46951` | Super quarto libro Sententiarum Petri Lombardi | bsb | 1497 | yes | 533 | 533 | 2026-04-12 | `` |
| `69dbcc261040d1d5e20bdd35` | Super quarto libro Sententiarum Petri Lombardi | bsb | 1497 | no | 533 | 533 | 2026-04-12 | `` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb00058596/manifest  (2 records)
_cross-form only · concurrency race · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69dbcc241040d1d5e20bdabf` | Super quarto libro Sententiarum Petri Lombardi | bsb | 1481 | yes | 629 | 629 | 2026-04-12 | `` |
| `69dbcc240f8c5edf20f466db` | Super quarto libro Sententiarum Petri Lombardi | bsb | 1481 | no | 629 | 628 | 2026-04-12 | `` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb00083309/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a905541449f7f109b986d39` | Practicierbuechlin bewerter leibartzeney in allen kranckheiten und lei | mdz | 1583 | no | 366 | 25 | 2026-08-27 | `mdz:bsb00083309` |
| `6a905541449f7f109b986d3a` | Practicierbüchlin bewerter leibartzeney in allen kranckheiten und leib | mdz | 1583 | no | 366 | 25 | 2026-08-27 | `mdz:bsb00083309` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10046562/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a492e611bbf4176e1e8c8fd` | Cursus Philosophicus Angelico-Thomisticus: In quo, Quidquid ad fundame | mdz | Unknown | no | 840 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10046562/manifest` |
| `6a492e619c1a84d480c94e47` | Cursus Philosophicus Angelico-Thomisticus: In quo, Quidquid ad fundame | mdz | Unknown | no | 840 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10046562/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10057725/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a9058ce7f6818cc17cd6cdd` | Physica id est Scientia rerum corporearum. Tomus quartus continens tra | mdz | 1671 | no | 496 | 25 | 2026-08-27 | `mdz:bsb10057725` |
| `6a9058ce7f6818cc17cd6cdc` | Physica id est Scientia rerum corporearum, tomus quintus | mdz | 1671 | no | 496 | 25 | 2026-08-27 | `mdz:bsb10057725` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10147818/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a9059137f6818cc17cd7d9e` | Historia unnd beschreibung influentischer elementischer und natürliche | iiif | Unknown | no | 196 | 25 | 2026-08-27 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10147818/manifest` |
| `6a9059137f6818cc17cd7ea9` | Historia und Beschreibung, influentischer, elementischer und natürlich | iiif | Unknown | no | 196 | 25 | 2026-08-27 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10147818/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10152192/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4d9f45167a618b2ad92361` | Bulla super canonisatione sancti patris bennonis: sancte et ingenue ec | mdz | Unknown | no | 28 | 25 | 2026-07-08 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10152192/manifest` |
| `6a4d9f49167a618b2ad92364` | Bulla super canonisatione sancti patris bennonis: sancte et ingenue ec | mdz | Unknown | no | 28 | 25 | 2026-07-08 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10152192/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10162196/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4d9fd1057db0c85b10a6a3` | Bulla indictionis anni jubilei proximi. Bulla exhortatoria ad confessi | mdz | Unknown | no | 20 | 20 | 2026-07-08 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10162196/manifest` |
| `6a4d9fd1167a618b2ad927ef` | Bulla exhortatoria ad confessionem ieiunium triduanum cum facultate el | mdz | Unknown | no | 20 | 20 | 2026-07-08 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10162196/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10172835/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4925df1bbf4176e1e87714` | Commentarius anatomicue, in quo est omnium partium corporis humani dil | mdz | Unknown | no | 306 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10172835/manifest` |
| `6a4925df9c1a84d480c93402` | Commentarius anatomicus, in quo est omnium partium corporis humani dil | mdz | Unknown | no | 306 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10172835/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10174675/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a905ae5785d9b40577f5db7` | Tractatus de maleficiis cum additionibus Augustini de Bonfrancischis e | mdz | 1498 | no | 836 | 25 | 2026-08-27 | `mdz:bsb10174675` |
| `6a905ae5785d9b40577f5dbd` | Tractatus de maleficiis cum additionibus Augustini de Bonfrancischis e | mdz | 1495 | no | 836 | 25 | 2026-08-27 | `mdz:bsb10174675` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10177012/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a909caab7feee6e9c42b532` | Succincta demonstratio ex verbo Dei et patribus, errorum cujusdam conf | iiif | Unknown | no | 140 | 0 | 2026-08-27 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10177012/manifest` |
| `6a909caa5fecff234ca62b20` | Succincta demonstratio ex verbo Dei et patribus, errorum cuiusdani con | iiif | Unknown | no | 140 | 25 | 2026-08-27 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10177012/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10182501/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a490fa5a9e39181572de03e` | Nicolai Burgundii ... Commentarius de evictionibus theoricus et practi | mdz | Unknown | no | 1008 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10182501/manifest` |
| `6a490fa5a9e39181572de03d` | Nicolai Burgundii I.C. ... Commentarius de euictionibus theoricus et p | mdz | Unknown | no | 1008 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10182501/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10192302/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a492fd4187213d999f705a5` | Exercitationum logicarum libri II. Ad Guilh. Adolphum scribonium, nomi | mdz | Unknown | no | 224 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10192302/manifest` |
| `6a492fd4187213d999f705a4` | Exercitationum logicarum libri II. Ad gvilh. Adolphum scribonium, nomi | mdz | Unknown | no | 224 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10192302/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10325803/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a940bb6d93a49483d44faf9` | Commentariorum ac disputationum: in primam secundae Santi thomae: tomu | iiif | Unknown | no | 1060 | 0 | 2026-08-30 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10325803/manifest` |
| `6a940bb6607507ae92786fb3` | Commentariorum ac disputationum in primam secundae Sancti Thomae. | iiif | Unknown | no | 1060 | 0 | 2026-08-30 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10325803/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10471364/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a492da69c1a84d480c9440c` | Des vortrefflichen und hochberühmten Frantzosen Msr. Comiers Neuerfund | mdz | Unknown | no | 626 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10471364/manifest` |
| `6a492da61bbf4176e1e8c626` | Des vortrefflichen und hochberühmten Frantzosen Msr. Comiers Neuerfund | mdz | Unknown | no | 626 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10471364/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10643155/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a907eab4e70467f352335de` | Ex Iure Publico De Capitulatione Caesarea, Praeside Casp. Heinr. Horni | mdz | 1697 | no | 26 | 25 | 2026-08-27 | `mdz:bsb10643155` |
| `6a907eab4e70467f352335fe` | Ex Iure Publico De Capitulatione Caesarea, Praeside Casp. Heinr. Horni | mdz | 1697 | no | 26 | 25 | 2026-08-27 | `mdz:bsb10643155` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10643835/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a490f56ae20621d947e2381` | Dissertatio Historico-Philologica De Imaginibus Veterum: I. Atriensibu | mdz | Unknown | no | 24 | 24 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10643835/manifest` |
| `6a490f56ae20621d947e2856` | Dissertatio Historico-Philologica De Imaginibus Veterum: I. Atriensibu | mdz | Unknown | no | 24 | 24 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10643835/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10646968/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4f1e23ce720e255f3c2e95` | Exercitatio Inauguralis De Iudiciorum Vigore, Iurisque Publici Tutela, | mdz | Unknown | no | 28 | 25 | 2026-07-09 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10646968/manifest` |
| `6a4f1e23dd60b16646ccede2` | Exercitatio Inavguralis De Iudiciorum Vigore, Iurisque Publici Tutela, | mdz | Unknown | no | 28 | 25 | 2026-07-09 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10646968/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10647294/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a90e82e544007b776b38c6f` | Exercitatio Historica De Antiquo Funerum Ritu, Quam In Alma Philurea S | iiif | Unknown | no | 28 | 25 | 2026-08-28 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10647294/manifest` |
| `6a90e82e544007b776b38c70` | Exercitatio Historica De Antiquo Funerum Ritu, Quam Facultatis Philoso | iiif | Unknown | no | 28 | 25 | 2026-08-28 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10647294/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10651229/manifest  (2 records)
_scalar-visible · spread 0d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4956da5b984676adb1eca1` | Tractatus Theologicus, De Sagarum Impietate, Nocendi Imbecillitate Et  | mdz | Unknown | no | 110 | 0 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10651229/manifest` |
| `6a4956e05b984676adb1ed11` | Tractatus Theologicus, De Sagarum Impietate, Nocendi Imbecillitate Et  | mdz | Unknown | no | 110 | 0 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10651229/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10651233/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a90a6996ef840faf2b8f75b` | Brevis Consideratio Trium Quaestionum, Nostro Seculo Maxime Controvers | iiif | Unknown | no | 126 | 25 | 2026-08-27 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10651233/manifest` |
| `6a90a69a19b0108536a7f0e8` | Brevis Consideratio Trium Quaestionum, Nostro Seculo Maxime Controvers | iiif | Unknown | no | 126 | 25 | 2026-08-27 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10651233/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10657034/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4cde77eda8dae4124a2557` | De Infanticidio Herodis, Tyranni, Discursus, quem Actui Oratio, praemi | mdz | Unknown | no | 8 | 2 | 2026-07-07 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10657034/manifest` |
| `6a4cde77eda8dae4124a2558` | De Infanticidio Herodis, Tyranni, Discursus, quem Actui Oratorio praem | mdz | Unknown | no | 8 | 4 | 2026-07-07 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10657034/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10657131/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a905afb5c1f3f2e1b8c01cc` | Historia Magorum Ex Cap. II. Matthaei , Die Epiphaniōn Anni MDCXXIIX I | mdz | 1636 | no | 44 | 25 | 2026-08-27 | `mdz:bsb10657131` |
| `6a905afb5c1f3f2e1b8c01cf` | Historia Magorum E Cap. II Matthaei, Die Epiphaniōn Anni MDCXXIIX In A | mdz | 1641 | no | 44 | 25 | 2026-08-27 | `mdz:bsb10657131` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10663526/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a90aa9747a761a9ac46a47e` | Conclusionum De Iure Forensi Varii Generis Exercitatio XII., Quam Prae | mdz | 1654 | no | 20 | 20 | 2026-08-27 | `mdz:bsb10663526` |
| `6a90aa9747a761a9ac46a480` | Conclusionum De Iure Forensi Varii Generis Exercitatio XIV., Quam Prae | mdz | 1654 | no | 20 | 20 | 2026-08-27 | `mdz:bsb10663526` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10665776/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a90aaa919b0108536a81764` | Resolutio L. Sciendum est. XV. D. Qui satisdare cogantur, Quam Praesid | mdz | 1654 | no | 32 | 25 | 2026-08-27 | `mdz:bsb10665776` |
| `6a90aaa919b0108536a81768` | Resolutio L. Sciendum est. XV. D. Qui satisdare cogantur, Quam Praesid | mdz | 1654 | no | 32 | 25 | 2026-08-27 | `mdz:bsb10665776` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10769784/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4932631bbf4176e1e91c38` | De Vanitate Consiliorum Liber Unus: In quo Vanitas Et Veritas, Rerum H | mdz | Unknown | no | 174 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10769784/manifest` |
| `6a4932631bbf4176e1e91ce7` | De Vanitate Consiliorum Liber Unus: In quo Vanitas Et Veritas, Rerum H | mdz | Unknown | no | 174 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10769784/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10812239/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a495f0a5b984676adb22e92` | Exercitationum Ad Baronii Annales Continuatarum Ubi desiit Is. Casaubo | mdz | Unknown | no | 36 | 0 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10812239/manifest` |
| `6a495f0a5b984676adb22eb7` | Exercitationum Ad Baronii Annales Continuatarum Ubi desiit Is. Casaubo | mdz | Unknown | no | 36 | 0 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10812239/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10817897/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a908783c223d60c78ed121f` | Iura Obstetricum Magnifico. Facultatis. Iuridicae Consensu Praeside Dn | mdz | 1671 | no | 40 | 25 | 2026-08-27 | `mdz:bsb10817897` |
| `6a908783c223d60c78ed1249` | Iura Obstetricum Magnifico. Facultatis. Iuridicae Consensu Praeside Dn | mdz | 1671 | no | 40 | 25 | 2026-08-27 | `mdz:bsb10817897` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10844069/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a90ad9f2764d973ba12d5d3` | Assertiones Medicae De Rebus Praeter Naturam Morbo, Causa Morbi, Et Sy | iiif | Unknown | no | 132 | 25 | 2026-08-27 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10844069/manifest` |
| `6a90ad9f2764d973ba12d659` | Assertiones Medicae De Rebus Praeter Naturam Morbo, Causa Morbi, Et Sy | iiif | Unknown | no | 132 | 25 | 2026-08-27 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10844069/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10854136/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4f0a1fe39e71f6b6e3c4ac` | Disputationum Politicarum De Arte Chrematistike, Quinta, quam Sub Prae | mdz | Unknown | no | 28 | 25 | 2026-07-09 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10854136/manifest` |
| `6a4f0a1f3041306058594724` | Disputationum Politicarum De Arte Khrematistike, Sexta & Ultima, quam  | mdz | Unknown | no | 28 | 25 | 2026-07-09 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10854136/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10873831/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a494551d2cbca6a1820913d` | Bedeutung des ungewonlichen gesichts so genent ist ein comet welcher n | mdz | Unknown | no | 8 | 0 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10873831/manifest` |
| `6a494551d2cbca6a1820913e` | Bedeütung des ungewonlichen gesichts so genennt ist ain comet welcher  | mdz | Unknown | no | 8 | 0 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb10873831/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10913230/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a90739967e7bf584ca45c8e` | De amazonibus dissertatio | mdz | 1687 | no | 440 | 25 | 2026-08-27 | `mdz:bsb10913230` |
| `6a90739967e7bf584ca45e49` | De amazonibus dissertatio | mdz | 1687 | no | 440 | 25 | 2026-08-27 | `mdz:bsb10913230` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10965057/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a90ac269e7756c729a90cb2` | Ex Consensu & approbatione Famigeratissimi Senatus in florentissimo fl | mdz | 1656 | no | 48 | 25 | 2026-08-27 | `mdz:bsb10965057` |
| `6a90ac269e7756c729a90ce6` | Ex Consensu & approbatione Famigeratissimi Senatus in florentissimo fl | mdz | 1656 | no | 48 | 25 | 2026-08-27 | `mdz:bsb10965057` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10965062/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a906a3ee6306cf42035bb89` | Fortuna Propinante, De Relocatione Et Reconductione Tacita, Iussu Et A | mdz | 1678 | no | 48 | 25 | 2026-08-27 | `mdz:bsb10965062` |
| `6a906a3fe6306cf42035bbc0` | Fortuna Propinante, De Relocatione Et Reconductione Tacita, Iussu Et A | mdz | 1678 | no | 48 | 25 | 2026-08-27 | `mdz:bsb10965062` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb10968054/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a90ac3f9e7756c729a91673` | Dissertatio Theologica kataskeuastike, De Authore Epistolae Ad Hebraeo | mdz | 1657 | no | 44 | 25 | 2026-08-27 | `mdz:bsb10968054` |
| `6a90ac409e7756c729a916a5` | Dissertatio Theologica kataskeuastikē, De Authore Epistolae Ad Hebraeo | mdz | 1657 | no | 44 | 25 | 2026-08-27 | `mdz:bsb10968054` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb11111076/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a93ff4fc041225010657255` | Selecta opuscula philosophica isagogica ad novum ejusdem philosophiae  | mdz | 1669 | no | 492 | 0 | 2026-08-30 | `mdz:bsb11111076` |
| `6a93ff50c41cd5a5a061d99b` | Selecta opuscula philosophica isagogica ad novum ejusdem philosophiae  | mdz | 1669 | no | 492 | 25 | 2026-08-30 | `mdz:bsb11111076` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb11111840/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4946833c715f5afcd531d4` | Argumentum canonis super instrumentum planeticum Georgii erlinger. | mdz | Unknown | no | 24 | 0 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb11111840/manifest` |
| `6a494683d2cbca6a18209151` | Argumentum canonis super instrumentum planetarum Georgii erlinger. | mdz | Unknown | no | 24 | 0 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb11111840/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb11223842/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a90ad52294c12e22353d930` |  Smegma Orientale: Sordibus Barbarismi: Contemtui praesertim Linguarum | mdz | 1658 | no | 964 | 25 | 2026-08-27 | `mdz:bsb11223842` |
| `6a90ad53294c12e22353dcfa` | Smegma Orientale: Sordibus Barbarismi: Contemtui praesertim Linguarum  | mdz | 1658 | no | 964 | 25 | 2026-08-27 | `mdz:bsb11223842` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb11238011/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a90b16c53c5573b4bc2ed67` | Pneumatica Medica Sive Theses De Spiritibus Influentibus: Quas Superio | mdz | 1664 | no | 16 | 16 | 2026-08-27 | `mdz:bsb11238011` |
| `6a90b16c53c5573b4bc2ed69` | Pneumatica Medica Sive Theses De Spiritibus Influentibus: Quas Superio | mdz | 1664 | no | 16 | 16 | 2026-08-27 | `mdz:bsb11238011` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb11241227/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a9073c5336010794b0d6555` | Diatribe Historica Prior, De Eusebio Episcopo Caesariensi, Quam Deo cl | mdz | 1688 | no | 16 | 16 | 2026-08-27 | `mdz:bsb11241227` |
| `6a9073c5336010794b0d6568` | Diatribe Historica Prior, De Eusebio Episcopo Caesariensi, Quam Deo cl | mdz | 1688 | no | 16 | 16 | 2026-08-27 | `mdz:bsb11241227` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb11270487/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4923441bbf4176e1e8632b` | Anatomiae Bilsianae Anatome: Occupata inprimis circa Vasa Meseraica &  | mdz | Unknown | no | 98 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb11270487/manifest` |
| `6a492347a45b99e46af93539` | Anatomiae Bilsianae Anatome: Occupata inprimis circa Vasa Meseraica &  | mdz | Unknown | no | 98 | 25 | 2026-07-04 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb11270487/manifest` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb11288055/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a9073e8336010794b0d7029` | Beatae Annae Christi servatoris nostri aviae maternae genealogia et vi | mdz | 1591 | no | 200 | 25 | 2026-08-27 | `mdz:bsb11288055` |
| `6a9073e8336010794b0d7028` | Beatae Annae Christi servatoris nostri aviae maternae, ex optimis et v | mdz | 1592 | no | 200 | 25 | 2026-08-27 | `mdz:bsb11288055` |

### iiif:api.digitale-sammlungen.de/iiif/presentation/v2/bsb11396412/manifest  (2 records)
_scalar-visible · spread 0d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a49ed85521e227d5227eb98` | Disputatio Inauguralis Medica De Causo, Quam In ipsa Doctorali Panegyr | mdz | Unknown | no | 16 | 16 | 2026-07-05 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb11396412/manifest` |
| `6a49ed9f0c5d29e580a6f62c` | Disputatio Inauguralis Medica De Causo, Quam In ipsa Doctorali Panegyr | mdz | Unknown | no | 16 | 16 | 2026-07-05 | `iiif:https://api.digitale-sammlungen.de/iiif/presentation/v2/bsb11396412/manifest` |

### iiif:digi.vatlib.it/iiif/MSS_Pal.lat.1328/manifest  (2 records)
_cross-form only · spread 46d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `699067f8249ce014347d530c` | Hermetic and Alchemical Anthology | vatican | 1450 | yes | 170 | 170 | 2026-02-14 | `vatican:Pal.lat.1328` |
| `6953ab1477f38f6761bd68ea` | Hermetic Chemistry Compilation (Hermes, Avicenna, al-Razi) | vatican | 1400 | yes | 170 | 170 | 2025-12-30 | `iiif:https://digi.vatlib.it/iiif/MSS_Pal.lat.1328/manifest.json` |

### iiif:digi.vatlib.it/iiif/MSS_Pal.lat.1329/manifest  (2 records)
_cross-form only · spread 46d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `699067eb249ce014347d4bf2` | Alchemical Miscellany | vatican | 1430 | yes | 370 | 370 | 2026-02-14 | `vatican:Pal.lat.1329` |
| `6953ab5577f38f6761bd6daa` | Hermetic Treatises (Khalid ibn Yazid, Arnaldus de Villanova) | vatican | 1350 | yes | 370 | 370 | 2025-12-30 | `iiif:https://digi.vatlib.it/iiif/MSS_Pal.lat.1329/manifest.json` |

### iiif:digi.vatlib.it/iiif/MSS_Reg.lat.1300/manifest  (2 records)
_cross-form only · spread 46d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `699067e68da6face82f779a6` | Liber Razielis Archangeli | vatican | 1350 | yes | 444 | 444 | 2026-02-14 | `vatican:Reg.lat.1300` |
| `6953ab3677f38f6761bd6ab2` | Sefer Raziel (Liber Secretorum Dei) | vatican | 1250 | yes | 444 | 444 | 2025-12-30 | `iiif:https://digi.vatlib.it/iiif/MSS_Reg.lat.1300/manifest.json` |

### iiif:digi.vatlib.it/iiif/MSS_Reg.lat.1344/manifest  (2 records)
_cross-form only · spread 46d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `699067f4249ce014347d51cd` | Steganographia, Picatrix, and Paracelsian Texts | vatican | 1550 | yes | 314 | 314 | 2026-02-14 | `vatican:Reg.lat.1344` |
| `6953ab4577f38f6761bd6c6f` | Picatrix Fragment, Steganographia, Paracelsus & Chemical Secrets | vatican | 1650 | yes | 314 | 314 | 2025-12-30 | `iiif:https://digi.vatlib.it/iiif/MSS_Reg.lat.1344/manifest.json` |

### iiif:digitalcollections.manchester.ac.uk/iiif/MS-ETHIOPIC-00006  (2 records)
_scalar-visible · spread 15d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69c1bd4c8522835be8468de5` | Gadla ḥawāryāt | manchester | early 19th century | no | 516 | 25 | 2026-03-23 | `iiif:https://www.digitalcollections.manchester.ac.uk/iiif/MS-ETHIOPIC-00006` |
| `69d5ae22d0bd3547a5656c4d` | Gadla Hawaryat | manchester | 1400 | yes | 516 | 515 | 2026-04-08 | `iiif:https://www.digitalcollections.manchester.ac.uk/iiif/MS-ETHIOPIC-00006` |

### iiif:digitalcollections.manchester.ac.uk/iiif/MS-PALI-00009  (2 records)
_scalar-visible · spread 15d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69c1bdae8522835be846b363` | Dhammapadaṭṭhakathā | manchester | Undated (probably 19th century) | no | 320 | 25 | 2026-03-23 | `iiif:https://www.digitalcollections.manchester.ac.uk/iiif/MS-PALI-00009` |
| `69d5ae25d0bd3547a5656e53` | Dhammapadatthakatha | manchester | 450 | yes | 320 | 289 | 2026-04-08 | `iiif:https://www.digitalcollections.manchester.ac.uk/iiif/MS-PALI-00009` |

### iiif:dl.ndl.go.jp/api/iiif/1181917/manifest  (2 records)
_cross-form only · spread 53d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a0852983fe25a995d5bbe44` | 古写本抱朴子 | ndl | 1923 | yes | 46 | 5 | 2026-05-16 | `` |
| `69c31455a27f479ae0c07ceb` | 古写本抱朴子 | ndl | 1923 (from earlier manuscript) | no | 46 | 0 | 2026-03-24 | `iiif:https://www.dl.ndl.go.jp/api/iiif/1181917/manifest.json` |

### iiif:dl.ndl.go.jp/api/iiif/2565999/manifest  (2 records)
_cross-form only · spread 53d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a08529d3fe25a995d5bbeaa` | 道徳經釋義外六種 | ndl | 1809 | yes | 44 | 5 | 2026-05-16 | `` |
| `69c3146da27f479ae0c07d51` | 道徳經釋義外六種 | ndl | 1809 (Qing dynasty edition) | no | 44 | 0 | 2026-03-24 | `iiif:https://www.dl.ndl.go.jp/api/iiif/2565999/manifest.json` |

### iiif:dl.ndl.go.jp/api/iiif/753422/manifest  (2 records)
_cross-form only · spread 53d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a0852a33fe25a995d5bbefc` | 老子新釈 | ndl | 1910 | yes | 149 | 5 | 2026-05-16 | `` |
| `69c3148aa27f479ae0c07da3` | 老子新釈 | ndl | 1910 | no | 149 | 0 | 2026-03-24 | `iiif:https://www.dl.ndl.go.jp/api/iiif/753422/manifest.json` |

### iiif:dl.ndl.go.jp/api/iiif/753851/manifest  (2 records)
_cross-form only · spread 53d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a08529b3fe25a995d5bbe73` | 朱子周易參同契考異 1卷 附 朱子陰符經考異 1卷 | ndl | 1802 | yes | 54 | 5 | 2026-05-16 | `` |
| `69c31463a27f479ae0c07d1a` | 朱子周易參同契考異 1卷 附 朱子陰符經考異 1卷 | ndl | 1802 (Edo period Japanese edition) | no | 108 | 0 | 2026-03-24 | `iiif:https://www.dl.ndl.go.jp/api/iiif/753851/manifest.json` |

### iiif:dl.ndl.go.jp/api/iiif/759938/manifest  (2 records)
_cross-form only · spread 53d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a08529e3fe25a995d5bbed7` | 陰符経 | ndl | 1912 | yes | 12 | 5 | 2026-05-16 | `` |
| `69c31474a27f479ae0c07d7e` | 陰符経 | ndl | 1912 | no | 12 | 0 | 2026-03-24 | `iiif:https://www.dl.ndl.go.jp/api/iiif/759938/manifest.json` |

### iiif:dl.ndl.go.jp/api/iiif/994592/manifest  (2 records)
_cross-form only · spread 53d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a0852a03fe25a995d5bbee4` | 参同契吹唱 | ndl | 1683 | yes | 23 | 5 | 2026-05-16 | `` |
| `69c31480a27f479ae0c07d8b` | 参同契吹唱 | ndl | 1900 (author fl. 1683–1769) | no | 46 | 0 | 2026-03-24 | `iiif:https://www.dl.ndl.go.jp/api/iiif/994592/manifest.json` |

### iiif:e-rara.ch/i3f/v20/2568994/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a426f1f28e9db2e39c0a427` | Ein newe und wolgegründte underweisung aller kauffmans rechnung in dre | e-rara | Unknown | no | 402 | 25 | 2026-06-29 | `iiif:https://www.e-rara.ch/i3f/v20/2568994/manifest` |
| `6a426f1f28e9db2e39c0a428` | Ein newe und wolgegrundte underweysung aller kauffmans rechnung in dre | e-rara | Unknown | no | 402 | 25 | 2026-06-29 | `iiif:https://www.e-rara.ch/i3f/v20/2568994/manifest` |

### iiif:e-rara.ch/i3f/v21/1192211/manifest  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9c826120d54bd036f86b` | Alberti Magni philosophie naturalis isagoge: sive introductiones: emen | e-rara | 1514 | no | 160 | 0 | 2026-03-20 | `e-rara:1192211` |
| `69b636881c1c21a37382d0b4` | Alberti Magni philosophie naturalis isagoge: sive introductiones: emen | e-rara | 1514 | no | 160 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1192211/manifest` |

### iiif:e-rara.ch/i3f/v21/1342014/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9cd46120d54bd037141b` | De alchimia opuscula complura veterum philosophorum, quorum catalogum  | e-rara | 1550 | yes | 350 | 350 | 2026-03-20 | `e-rara:1342014` |
| `69b642381c1c21a37388b93e` | De alchimia opuscula complura veterum philosophorum, quorum catalogum  | e-rara | 1550 | no | 350 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1342014/manifest` |

### iiif:e-rara.ch/i3f/v21/1342369/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9cc36120d54bd0370f93` | Alchemiae Gebri Arabis philosophi solertissimi, libri, cum reliquis, u | e-rara | 1545 | yes | 322 | 322 | 2026-03-20 | `e-rara:1342369` |
| `69b640471c1c21a373879f0c` | Alchemiae Gebri Arabis philosophi solertissimi, libri, cum reliquis, u | e-rara | 1545 | no | 322 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1342369/manifest` |

### iiif:e-rara.ch/i3f/v21/1342698/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9ca86120d54bd03701ab` | Artemidori ... De somniorum interpretatione, libri quinque | e-rara | 1539 | yes | 488 | 488 | 2026-03-20 | `e-rara:1342698` |
| `69b63dc11c1c21a37385ef35` | Artemidori ... De somniorum interpretatione, libri quinque | e-rara | 1539 | no | 488 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1342698/manifest` |

### iiif:e-rara.ch/i3f/v21/1343192/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9ca46120d54bd037001f` | Henrici Cornelii Agrippae ... De occulta philosophia libri tres | e-rara | 1533 | yes | 393 | 392 | 2026-03-20 | `e-rara:1343192` |
| `69b63bbd1c1c21a37384f07d` | Henrici Cornelii Agrippae ... De occulta philosophia libri tres | e-rara | 1533 | no | 393 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1343192/manifest` |

### iiif:e-rara.ch/i3f/v21/1343590/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9fccf6d63c9197482478` | Adumbratio Kabbalae Christianae id est Syncatabasis Hebraizans, sive b | e-rara | 1684 | no | 77 | 0 | 2026-03-20 | `e-rara:1343590` |
| `69b6b7b818823df6d6998ae9` | Adumbratio Kabbalae Christianae id est Syncatabasis Hebraizans, sive b | e-rara | 1684 | no | 77 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1343590/manifest` |

### iiif:e-rara.ch/i3f/v21/1349506/manifest  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9c9b6120d54bd036fe2f` | Secreta secretorum Aristotelis | e-rara | 1528 | no | 178 | 0 | 2026-03-20 | `e-rara:1349506` |
| `69b63a601c1c21a3738452d4` | Secreta secretorum Aristotelis | e-rara | 1528 | no | 178 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1349506/manifest` |

### iiif:e-rara.ch/i3f/v21/1350065/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9c50f105648cca08b68c` | [De anima. De intellectu] | e-rara | 1481 | yes | 257 | 256 | 2026-03-20 | `e-rara:1350065` |
| `69b631ad1c1c21a3738097a9` | [De anima. De intellectu] | e-rara | 1481 | no | 257 | 256 | 2026-03-15 | `` |

### iiif:e-rara.ch/i3f/v21/1350330/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f4ff6d63c9197480aa6` | Mutus liber, in quo tamen tota philosophia hermetica, figuris hierogly | e-rara | 1677 | no | 46 | 0 | 2026-03-20 | `e-rara:1350330` |
| `69b6b33a96dc15d4a16d9000` | Mutus liber, in quo tamen tota philosophia hermetica, figuris hierogly | e-rara | 1677 | no | 46 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1350330/manifest` |

### iiif:e-rara.ch/i3f/v21/1388711/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9c6b6120d54bd036ecd0` | [Commentarii a Philippo Beroaldo conditi in asinum aureum Lucii Apulei | e-rara | 1501 | yes | 484 | 483 | 2026-03-20 | `e-rara:1388711` |
| `69b634f41c1c21a373824fad` | [Commentarii a Philippo Beroaldo conditi in asinum aureum Lucii Apulei | e-rara | 1501 | no | 484 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1388711/manifest` |

### iiif:e-rara.ch/i3f/v21/13893618/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4945043c715f5afcd5319c` | Eygentlicher Abriß, des Anno 1680. entstandenen Cometen | e-rara | Unknown | no | 2 | 0 | 2026-07-04 | `iiif:https://www.e-rara.ch/i3f/v21/13893618/manifest` |
| `6a4945043c715f5afcd5319e` | Eygendlicher Abriß des Anno 1680. entstandenen Cometen | e-rara | Unknown | no | 2 | 0 | 2026-07-04 | `iiif:https://www.e-rara.ch/i3f/v21/13893618/manifest` |

### iiif:e-rara.ch/i3f/v21/1530278/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9cba6120d54bd0370923` | Aetii medici Graeci contractae ex veteribus medicinae tetrabiblos : ho | e-rara | 1542 | yes | 968 | 968 | 2026-03-20 | `e-rara:1530278` |
| `69b63f111c1c21a37386c3a3` | Aetii medici Graeci contractae ex veteribus medicinae tetrabiblos : ho | e-rara | 1542 | no | 968 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1530278/manifest` |

### iiif:e-rara.ch/i3f/v21/1559088/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9da66120d54bd0378a80` | Elpidii Berrettarii ... Tractatus de risu | e-rara | 1603 | no | 87 | 0 | 2026-03-20 | `e-rara:1559088` |
| `69b67414b3f4fc04415b0dc4` | Elpidii Berrettarii ... Tractatus de risu | e-rara | 1603 | no | 87 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1559088/manifest` |

### iiif:e-rara.ch/i3f/v21/1559866/manifest  (2 records)
_cross-form only · spread 5d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f3df6d63c919747ff4d` | Phosphorus hermeticus sive magnes luminaris | e-rara | 1675 | yes | 24 | 24 | 2026-03-20 | `e-rara:1559866` |
| `69b6b1ec96dc15d4a16d1f5b` | Phosphorus hermeticus sive magnes luminaris | e-rara | 1675 | no | 24 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1559866/manifest` |

### iiif:e-rara.ch/i3f/v21/1605508/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9ca06120d54bd036fee4` | Catalogus haereticorum omnium pene qui ad haec usque tempora passim li | e-rara | 1529 | yes | 312 | 312 | 2026-03-20 | `e-rara:1605508` |
| `69b63aa11c1c21a373847144` | Catalogus haereticorum omnium pene qui ad haec usque tempora passim li | e-rara | 1529 | no | 312 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1605508/manifest` |

### iiif:e-rara.ch/i3f/v21/1606525/manifest  (2 records)
_cross-form only · spread 5d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f46f6d63c9197480025` | Edouardi Kellaei Angli tractatus duo egregii de lapide philosophorum,  | e-rara | 1676 | yes | 136 | 25 | 2026-03-20 | `e-rara:1606525` |
| `69b6b27f96dc15d4a16d4ac9` | Edouardi Kellaei Angli tractatus duo egregii de lapide philosophorum,  | e-rara | 1676 | no | 136 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1606525/manifest` |

### iiif:e-rara.ch/i3f/v21/1606666/manifest  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9c756120d54bd036f2e7` | Hexastichon Sebastiani Brant in memorabiles evangelistarum figuras : q | e-rara | 1503 | no | 46 | 0 | 2026-03-20 | `e-rara:1606666` |
| `69b635331c1c21a373826d26` | Hexastichon Sebastiani Brant in memorabiles evangelistarum figuras : q | e-rara | 1503 | no | 46 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1606666/manifest` |

### iiif:e-rara.ch/i3f/v21/1632680/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9e6b6120d54bd037cf31` | De symbolica Aegyptiorum sapientia : in qua symbola, parabolae, histor | e-rara | 1623 | no | 188 | 0 | 2026-03-20 | `e-rara:1632680` |
| `69b68d652368e1fad32274f7` | De symbolica Aegyptiorum sapientia : in qua symbola, parabolae, histor | e-rara | 1623 | no | 188 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1632680/manifest` |

### iiif:e-rara.ch/i3f/v21/1683735/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9cd06120d54bd0371390` | De alchemia dialogi II. quorum prior, genuinam librorum Gebri sententi | e-rara | 1548 | yes | 136 | 25 | 2026-03-20 | `e-rara:1683735` |
| `69b6415a1c1c21a373883084` | De alchemia dialogi II. quorum prior, genuinam librorum Gebri sententi | e-rara | 1548 | no | 136 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1683735/manifest` |

### iiif:e-rara.ch/i3f/v21/1684113/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9e99f6d63c919747bd00` | Saturnus saturatus dissolutus, et coelo restitutus, seu modus componen | e-rara | 1630 | no | 32 | 0 | 2026-03-20 | `e-rara:1684113` |
| `69b692b9080b19f98fce8e16` | Saturnus saturatus dissolutus, et coelo restitutus, seu modus componen | e-rara | 1630 | no | 32 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1684113/manifest` |

### iiif:e-rara.ch/i3f/v21/1684152/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9c976120d54bd036fc7c` | Divi Ioannis Chrysostomi Psegmata quaedam | e-rara | 1523 | yes | 432 | 430 | 2026-03-20 | `e-rara:1684152` |
| `69b639131c1c21a37383c232` | Divi Ioannis Chrysostomi Psegmata quaedam | e-rara | 1523 | no | 432 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1684152/manifest` |

### iiif:e-rara.ch/i3f/v21/1684589/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9c8e6120d54bd036f9d9` | Arnobii Afri ... commentarii ... In omnes psalmos, sermone Latino, sed | e-rara | 1522 | yes | 328 | 327 | 2026-03-20 | `e-rara:1684589` |
| `69b638b01c1c21a373839799` | Arnobii Afri ... commentarii ... In omnes psalmos, sermone Latino, sed | e-rara | 1522 | no | 328 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1684589/manifest` |

### iiif:e-rara.ch/i3f/v21/1719033/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9cb16120d54bd03705ed` | In hoc vo lumine De alchemia continentur haec .... : De investigatione | e-rara | 1541 | yes | 410 | 409 | 2026-03-20 | `e-rara:1719033` |
| `69b63eaa1c1c21a37386717e` | In hoc vo lumine De alchemia continentur haec .... : De investigatione | e-rara | 1541 | no | 410 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1719033/manifest` |

### iiif:e-rara.ch/i3f/v21/1720269/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9cbf6120d54bd0370cee` | D. Epiphanii Episcopi Constantiae Cypri, contra octoaginta haereses op | e-rara | 1543 | yes | 674 | 673 | 2026-03-20 | `e-rara:1720269` |
| `69b63f671c1c21a3738703c6` | D. Epiphanii Episcopi Constantiae Cypri, contra octoaginta haereses op | e-rara | 1543 | no | 674 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1720269/manifest` |

### iiif:e-rara.ch/i3f/v21/1761179/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9e1d6120d54bd037b95d` | Trithemius sui-ipsius vindex sive steganographiae ... viri Ioannis Tri | e-rara | 1616 | no | 140 | 0 | 2026-03-20 | `e-rara:1761179` |
| `69b684cc70c69d645a738ddd` | Trithemius sui-ipsius vindex sive steganographiae ... viri Ioannis Tri | e-rara | 1616 | no | 140 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1761179/manifest` |

### iiif:e-rara.ch/i3f/v21/1811437/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9feff6d63c91974832ab` | Praxis exercitiorum spiritualium P.N.S. Ignatii | e-rara | 1695 | no | 131 | 0 | 2026-03-20 | `e-rara:1811437` |
| `69b6bde18566c83814642109` | Praxis exercitiorum spiritualium P.N.S. Ignatii | e-rara | 1695 | no | 131 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1811437/manifest` |

### iiif:e-rara.ch/i3f/v21/1811575/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9e406120d54bd037c363` | Iul. Pacii Artis Lullianae emendatae libri 4 : quibus docetur methodus | e-rara | 1618 | no | 97 | 0 | 2026-03-20 | `e-rara:1811575` |
| `69b686de70c69d645a746e48` | Iul. Pacii Artis Lullianae emendatae libri 4 : quibus docetur methodus | e-rara | 1618 | no | 97 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1811575/manifest` |

### iiif:e-rara.ch/i3f/v21/1812073/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f00f6d63c919747dc22` | Miraculi mundi continuatio : in qua tota natura denudatur, &amp; toti  | e-rara | 1658 | no | 145 | 0 | 2026-03-20 | `e-rara:1812073` |
| `69b6a525080b19f98fd22843` | Miraculi mundi continuatio : in qua tota natura denudatur, &amp; toti  | e-rara | 1658 | no | 145 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1812073/manifest` |

### iiif:e-rara.ch/i3f/v21/1833657/manifest  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9c61f105648cca08bb5b` | Index eor um, quae hoc in libro habentur De mysteriis Aegyptiorum, Cha | e-rara | 1497 | no | 381 | 24 | 2026-03-20 | `e-rara:1833657` |
| `69b6345c1c1c21a37381fcf3` | Index eor um, quae hoc in libro habentur De mysteriis Aegyptiorum, Cha | e-rara | 1497 | no | 381 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1833657/manifest` |

### iiif:e-rara.ch/i3f/v21/1835136/manifest  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9c7d6120d54bd036f555` | Iohannis Saresberiensis policraticus de nugis curialium et vestigiis p | e-rara | 1513 | no | 787 | 786 | 2026-03-20 | `e-rara:1835136` |
| `69b636551c1c21a37382c0e5` | Iohannis Saresberiensis policraticus de nugis curialium et vestigiis p | e-rara | 1513 | no | 787 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1835136/manifest` |

### iiif:e-rara.ch/i3f/v21/1835929/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9ccc6120d54bd03712c4` | De nativitate mediatoris ultima, nunc futura, et toti orbi terrarum in | e-rara | 1547 | yes | 201 | 25 | 2026-03-20 | `e-rara:1835929` |
| `69b6411f1c1c21a3738814d7` | De nativitate mediatoris ultima, nunc futura, et toti orbi terrarum in | e-rara | 1547 | no | 201 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1835929/manifest` |

### iiif:e-rara.ch/i3f/v21/1836807/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f08f6d63c919747dea9` | Ioh. Rud. Glauberi Annotationes in nuper editam continuationem miracul | e-rara | 1659 | no | 38 | 0 | 2026-03-20 | `e-rara:1836807` |
| `69b6a5f6080b19f98fd28938` | Ioh. Rud. Glauberi Annotationes in nuper editam continuationem miracul | e-rara | 1659 | no | 38 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1836807/manifest` |

### iiif:e-rara.ch/i3f/v21/1837195/manifest  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9c58f105648cca08b9e3` | Liber ethymologiarum Isidori Hyspalensis episcopi | e-rara | 1489 | no | 226 | 0 | 2026-03-20 | `e-rara:1837195` |
| `69b632d91c1c21a373813f96` | Liber ethymologiarum Isidori Hyspalensis episcopi | e-rara | 1489 | no | 226 | 6 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1837195/manifest` |

### iiif:e-rara.ch/i3f/v21/1838399/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9ef2f6d63c919747da17` | Explicatio tractatuli qui miraculum mundi inscribitur ... | e-rara | 1656 | no | 76 | 0 | 2026-03-20 | `e-rara:1838399` |
| `69b6a422080b19f98fd1de92` | Explicatio tractatuli qui miraculum mundi inscribitur ... | e-rara | 1656 | no | 76 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1838399/manifest` |

### iiif:e-rara.ch/i3f/v21/1853689/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9db36120d54bd03790c7` | Historiæ aliquot transmutationis metallicae ... pro defensione alchymi | e-rara | 1604 | no | 56 | 0 | 2026-03-20 | `e-rara:1853689` |
| `69b6752bb3f4fc04415b6260` | Historiæ aliquot transmutationis metallicae ... pro defensione alchymi | e-rara | 1604 | no | 56 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1853689/manifest` |

### iiif:e-rara.ch/i3f/v21/1854638/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9dbc6120d54bd037924b` | Disquisitio de helia artium ... | e-rara | 1606 | no | 152 | 0 | 2026-03-20 | `e-rara:1854638` |
| `69b67775b3f4fc04415c8f8d` | Disquisitio de helia artium ... | e-rara | 1606 | no | 152 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1854638/manifest` |

### iiif:e-rara.ch/i3f/v21/1905969/manifest  (2 records)
_cross-form only · spread 5d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9e336120d54bd037bf37` | Atalanta fugiens, hoc est, emblemata nova de secretis naturae chymica, | e-rara | 1617 | yes | 230 | 229 | 2026-03-20 | `e-rara:1905969` |
| `69b685e770c69d645a73e13e` | Atalanta fugiens, hoc est, emblemata nova de secretis naturae chymica, | e-rara | 1617 | no | 230 | 229 | 2026-03-15 | `` |

### iiif:e-rara.ch/i3f/v21/1906527/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9fd4f6d63c91974825f5` | Michaelis Maieri ... secretioris naturae secretorum scrutinium chymicu | e-rara | 1687 | no | 166 | 0 | 2026-03-20 | `e-rara:1906527` |
| `69b6b9648566c8381462b61a` | Michaelis Maieri ... secretioris naturae secretorum scrutinium chymicu | e-rara | 1687 | no | 166 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1906527/manifest` |

### iiif:e-rara.ch/i3f/v21/1906698/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9e226120d54bd037b9ec` | Lusus serius, quo Hermes sive Mercurius rex mundanorum omnium sub homi | e-rara | 1616 | no | 88 | 0 | 2026-03-20 | `e-rara:1906698` |
| `69b684ce70c69d645a738e6b` | Lusus serius, quo Hermes sive Mercurius rex mundanorum omnium sub homi | e-rara | 1616 | no | 88 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1906698/manifest` |

### iiif:e-rara.ch/i3f/v21/1913791/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9ea5f6d63c919747bdfd` | Fortunii Liceti Genuensis... De mundi &amp; hominis analogia | e-rara | 1635 | no | 182 | 0 | 2026-03-20 | `e-rara:1913791` |
| `69b696864a5f9daef79e8f05` | Fortunii Liceti Genuensis... De mundi &amp; hominis analogia | e-rara | 1635 | no | 182 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1913791/manifest` |

### iiif:e-rara.ch/i3f/v21/1913978/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9ea1f6d63c919747bd69` | Fortunii Liceti Genuensis ... De rationalis animae varia propensione a | e-rara | 1634 | no | 145 | 0 | 2026-03-20 | `e-rara:1913978` |
| `69b69617080b19f98fcf1e72` | Fortunii Liceti Genuensis ... De rationalis animae varia propensione a | e-rara | 1634 | no | 145 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1913978/manifest` |

### iiif:e-rara.ch/i3f/v21/1914129/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9ea9f6d63c919747beb6` | Fortunii Liceti Genuensis ... Ulysses apud Circen, sive de quadruplici | e-rara | 1636 | no | 65 | 0 | 2026-03-20 | `e-rara:1914129` |
| `69b696e44a5f9daef79ea0c3` | Fortunii Liceti Genuensis ... Ulysses apud Circen, sive de quadruplici | e-rara | 1636 | no | 65 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1914129/manifest` |

### iiif:e-rara.ch/i3f/v21/1914200/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9e9df6d63c919747bd23` | Fortunii Liceti Genuensis ... De anima subiecto corpori nil tribuente, | e-rara | 1631 | no | 67 | 0 | 2026-03-20 | `e-rara:1914200` |
| `69b69367080b19f98fceaf37` | Fortunii Liceti Genuensis ... De anima subiecto corpori nil tribuente, | e-rara | 1631 | no | 67 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1914200/manifest` |

### iiif:e-rara.ch/i3f/v21/1931279/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9e266120d54bd037ba47` | De circulo physico, quadrato hoc est, auro, eiusque virtute medicinali | e-rara | 1616 | no | 88 | 0 | 2026-03-20 | `e-rara:1931279` |
| `69b684d070c69d645a738ec5` | De circulo physico, quadrato hoc est, auro, eiusque virtute medicinali | e-rara | 1616 | no | 88 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1931279/manifest` |

### iiif:e-rara.ch/i3f/v21/1931373/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9cc86120d54bd03710d8` | Pretiosa margarita novella de thesauro, ac pretiosissimo philosophorum | e-rara | 1546 | yes | 489 | 489 | 2026-03-20 | `e-rara:1931373` |
| `69b640d51c1c21a37387f398` | Pretiosa margarita novella de thesauro, ac pretiosissimo philosophorum | e-rara | 1546 | no | 489 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1931373/manifest` |

### iiif:e-rara.ch/i3f/v21/1997770/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9e5e6120d54bd037cb3f` | Matthiae Untzeri ... de sulphure tractatus | e-rara | 1620 | no | 124 | 0 | 2026-03-20 | `e-rara:1997770` |
| `69b689722368e1fad32161c0` | Matthiae Untzeri ... de sulphure tractatus | e-rara | 1620 | no | 124 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1997770/manifest` |

### iiif:e-rara.ch/i3f/v21/1997900/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9e82f6d63c919747b3a3` | Matthiae Untzeri ... physiologia salis seu, de salis natura eiusque pr | e-rara | 1625 | no | 190 | 0 | 2026-03-20 | `e-rara:1997900` |
| `69b68ef1080b19f98fcd68a8` | Matthiae Untzeri ... physiologia salis seu, de salis natura eiusque pr | e-rara | 1625 | no | 190 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1997900/manifest` |

### iiif:e-rara.ch/i3f/v21/1998918/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9e3c6120d54bd037c2d8` | Tractatus theologo-philosophicus, in libros tres distributus, quorum I | e-rara | 1617 | no | 136 | 0 | 2026-03-20 | `e-rara:1998918` |
| `69b685ec70c69d645a73e4dd` | Tractatus theologo-philosophicus, in libros tres distributus, quorum I | e-rara | 1617 | no | 136 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/1998918/manifest` |

### iiif:e-rara.ch/i3f/v21/2034213/manifest  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9d2b6120d54bd0373d2e` | Mercurii Trismegisti Pimandras utraque lingua restitutus | e-rara | 1574 | no | 142 | 0 | 2026-03-20 | `e-rara:2034213` |
| `69b6572118b87551bfce70d8` | Mercurii Trismegisti Pimandras utraque lingua restitutus | e-rara | 1574 | no | 142 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2034213/manifest` |

### iiif:e-rara.ch/i3f/v21/2034361/manifest  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9c8a6120d54bd036f97e` | Ars transmutationis metallicae cum Leonis X. pontificis maximi ... dec | e-rara | 1519 | no | 88 | 0 | 2026-03-20 | `e-rara:2034361` |
| `69b637bc1c1c21a373833386` | Ars transmutationis metallicae cum Leonis X. pontificis maximi ... dec | e-rara | 1519 | no | 88 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2034361/manifest` |

### iiif:e-rara.ch/i3f/v21/2034549/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9dc46120d54bd0379640` | Oracula magica Zoroastris cum scholiis Plethonis et Pselli nunc primum | e-rara | 1607 | no | 146 | 0 | 2026-03-20 | `e-rara:2034549` |
| `69b678abb3f4fc04415cf105` | Oracula magica Zoroastris cum scholiis Plethonis et Pselli nunc primum | e-rara | 1607 | no | 146 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2034549/manifest` |

### iiif:e-rara.ch/i3f/v21/2034699/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9dc96120d54bd03796d5` | Oracula metrica Iovis, Apollinis, Hecates, Serapidis, et aliorum deoru | e-rara | 1607 | no | 140 | 0 | 2026-03-20 | `e-rara:2034699` |
| `69b678adb3f4fc04415cf199` | Oracula metrica Iovis, Apollinis, Hecates, Serapidis, et aliorum deoru | e-rara | 1607 | no | 140 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2034699/manifest` |

### iiif:e-rara.ch/i3f/v21/2034845/manifest  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9cdd6120d54bd0371648` | Hermou tou Trismegistou Poimandres. Asklepiou horoi pros Ammona Basile | e-rara | 1554 | no | 246 | 24 | 2026-03-20 | `e-rara:2034845` |
| `69b6442718b87551bfc36937` | Hermou tou Trismegistou Poimandres. Asklepiou horoi pros Ammona Basile | e-rara | 1554 | no | 246 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2034845/manifest` |

### iiif:e-rara.ch/i3f/v21/2035719/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9d276120d54bd0373c84` | Pauli principis de la Scala et Hun ... primi tomi miscellaneorum, de r | e-rara | 1570 | no | 167 | 0 | 2026-03-20 | `e-rara:2035719` |
| `69b6554418b87551bfcd33b7` | Pauli principis de la Scala et Hun ... primi tomi miscellaneorum, de r | e-rara | 1570 | yes | 167 | 166 | 2026-03-15 | `` |

### iiif:e-rara.ch/i3f/v21/2044320/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f58f6d63c9197480b26` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 72 | 0 | 2026-03-20 | `e-rara:2044320` |
| `69b6b35896dc15d4a16d99ac` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 72 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2044320/manifest` |

### iiif:e-rara.ch/i3f/v21/2044398/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f5df6d63c9197480b71` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 20 | 0 | 2026-03-20 | `e-rara:2044398` |
| `69b6b35a96dc15d4a16d99f6` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 20 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2044398/manifest` |

### iiif:e-rara.ch/i3f/v21/2044424/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f61f6d63c9197480b88` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 72 | 0 | 2026-03-20 | `e-rara:2044424` |
| `69b6b35c96dc15d4a16d9a0c` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 72 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2044424/manifest` |

### iiif:e-rara.ch/i3f/v21/2044502/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f66f6d63c9197480bd3` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 36 | 0 | 2026-03-20 | `e-rara:2044502` |
| `69b6b35f96dc15d4a16d9a56` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 36 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2044502/manifest` |

### iiif:e-rara.ch/i3f/v21/2044544/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f6bf6d63c9197480bfa` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 22 | 0 | 2026-03-20 | `e-rara:2044544` |
| `69b6b36196dc15d4a16d9a7c` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 22 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2044544/manifest` |

### iiif:e-rara.ch/i3f/v21/2044572/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f6ff6d63c9197480c13` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 102 | 0 | 2026-03-20 | `e-rara:2044572` |
| `69b6b36396dc15d4a16d9a94` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 102 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2044572/manifest` |

### iiif:e-rara.ch/i3f/v21/2044680/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f74f6d63c9197480c7c` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 18 | 0 | 2026-03-20 | `e-rara:2044680` |
| `69b6b36696dc15d4a16d9afc` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 18 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2044680/manifest` |

### iiif:e-rara.ch/i3f/v21/2044704/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f79f6d63c9197480c91` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 14 | 0 | 2026-03-20 | `e-rara:2044704` |
| `69b6b36896dc15d4a16d9b10` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 14 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2044704/manifest` |

### iiif:e-rara.ch/i3f/v21/2044724/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f7df6d63c9197480ca2` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 36 | 0 | 2026-03-20 | `e-rara:2044724` |
| `69b6b36b96dc15d4a16d9b20` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 36 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2044724/manifest` |

### iiif:e-rara.ch/i3f/v21/2044766/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f82f6d63c9197480cc9` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 172 | 0 | 2026-03-20 | `e-rara:2044766` |
| `69b6b36d96dc15d4a16d9b46` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 172 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2044766/manifest` |

### iiif:e-rara.ch/i3f/v21/2044945/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f86f6d63c9197480d78` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 102 | 0 | 2026-03-20 | `e-rara:2044945` |
| `69b6b36f96dc15d4a16d9bf4` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 102 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2044945/manifest` |

### iiif:e-rara.ch/i3f/v21/2045052/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f8bf6d63c9197480de1` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 54 | 0 | 2026-03-20 | `e-rara:2045052` |
| `69b6b37296dc15d4a16d9c5c` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 54 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2045052/manifest` |

### iiif:e-rara.ch/i3f/v21/2045112/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f8ff6d63c9197480e1a` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 40 | 0 | 2026-03-20 | `e-rara:2045112` |
| `69b6b37496dc15d4a16d9c94` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 40 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2045112/manifest` |

### iiif:e-rara.ch/i3f/v21/2045158/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f93f6d63c9197480e45` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 74 | 0 | 2026-03-20 | `e-rara:2045158` |
| `69b6b37796dc15d4a16d9cbe` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 74 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2045158/manifest` |

### iiif:e-rara.ch/i3f/v21/2045238/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9f98f6d63c9197480e92` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 52 | 0 | 2026-03-20 | `e-rara:2045238` |
| `69b6b37996dc15d4a16d9d0a` | Musaeum hermeticum reformatum et amplificatum, omnes sopho-spagyricae  | e-rara | 1677 | no | 52 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2045238/manifest` |

### iiif:e-rara.ch/i3f/v21/2101356/manifest  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9cf76120d54bd037254f` | Compendium alchimiae Ioannis Garlandii Angli philosophi doctissimi ... | e-rara | 1560 | no | 192 | 0 | 2026-03-20 | `e-rara:2101356` |
| `69b6506818b87551bfc9df95` | Compendium alchimiae Ioannis Garlandii Angli philosophi doctissimi ... | e-rara | 1560 | no | 192 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2101356/manifest` |

### iiif:e-rara.ch/i3f/v21/2102930/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9cb66120d54bd037078a` | Raimundi Lulli ... de secretis naturae sive quinta essentia libri duo  | e-rara | 1541 | yes | 406 | 406 | 2026-03-20 | `e-rara:2102930` |
| `69b63ec51c1c21a373868aa3` | Raimundi Lulli ... de secretis naturae sive quinta essentia libri duo  | e-rara | 1541 | no | 406 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2102930/manifest` |

### iiif:e-rara.ch/i3f/v21/2103342/manifest  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9c866120d54bd036f90e` | Opusculum Raymundinum de auditu kabbalisitico sive ad omnes scientias  | e-rara | 1518 | no | 109 | 105 | 2026-03-20 | `e-rara:2103342` |
| `69b6376d1c1c21a3738326a6` | Opusculum Raymundinum de auditu kabbalisitico sive ad omnes scientias  | e-rara | 1518 | no | 109 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2103342/manifest` |

### iiif:e-rara.ch/i3f/v21/2208774/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bda059f6d63c91974862ad` | Christiani Thomasii ... Tractatio iuridica de iure circa somnum et som | e-rara | 1723 | no | 96 | 0 | 2026-03-20 | `e-rara:2208774` |
| `69b6d19da8d7b8d17a66dd20` | Christiani Thomasii ... Tractatio iuridica de iure circa somnum et som | e-rara | 1723 | no | 96 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2208774/manifest` |

### iiif:e-rara.ch/i3f/v21/2217010/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9d616120d54bd03768ba` | Reverendi P. Petri Thyraei ... De daemoniacis liber unus in quo daemon | e-rara | 1594 | no | 144 | 0 | 2026-03-20 | `e-rara:2217010` |
| `69b6699cb3f4fc0441571fdc` | Reverendi P. Petri Thyraei ... De daemoniacis liber unus in quo daemon | e-rara | 1594 | no | 144 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2217010/manifest` |

### iiif:e-rara.ch/i3f/v21/2217160/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9d666120d54bd037694d` | Reverendi P. Petri Thyraei ... De variis tam spirituum quam vivorum ho | e-rara | 1594 | no | 180 | 0 | 2026-03-20 | `e-rara:2217160` |
| `69b6699fb3f4fc044157206e` | Reverendi P. Petri Thyraei ... De variis tam spirituum quam vivorum ho | e-rara | 1594 | no | 180 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2217160/manifest` |

### iiif:e-rara.ch/i3f/v21/2480555/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9dfc6120d54bd037a7ed` | Veterum sophorum sigilla et imagines magicae, sive sculpturae lapidum  | e-rara | 1612 | no | 72 | 0 | 2026-03-20 | `e-rara:2480555` |
| `69b67f6970c69d645a714e0b` | Veterum sophorum sigilla et imagines magicae, sive sculpturae lapidum  | e-rara | 1612 | no | 72 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2480555/manifest` |

### iiif:e-rara.ch/i3f/v21/2498584/manifest  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9d016120d54bd03729af` | De chemia senioris antiquissimi philosophi, libellus, ut brevis, ita a | e-rara | 1560 | no | 136 | 0 | 2026-03-20 | `e-rara:2498584` |
| `69b6507118b87551bfc9e73d` | De chemia senioris antiquissimi philosophi, libellus, ut brevis, ita a | e-rara | 1560 | no | 136 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2498584/manifest` |

### iiif:e-rara.ch/i3f/v21/2581167/manifest  (2 records)
_cross-form only · spread 5d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bda09df6d63c919748921a` | Disquisitionis historicae &amp; theologicae de visionibus quae primis  | e-rara | 1738 | no | 84 | 0 | 2026-03-20 | `e-rara:2581167` |
| `69b6e807f8a84d859cde565b` | Disquisitionis historicae &amp; theologicae de visionibus quae primis  | e-rara | 1738 | no | 84 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2581167/manifest` |

### iiif:e-rara.ch/i3f/v21/2581257/manifest  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9c65f105648cca08bcdb` | De triplici regione claustralium et spirituali exercitio monachorum .. | e-rara | 1498 | no | 204 | 0 | 2026-03-20 | `e-rara:2581257` |
| `69b6347c1c1c21a373820b9c` | De triplici regione claustralium et spirituali exercitio monachorum .. | e-rara | 1498 | no | 204 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2581257/manifest` |

### iiif:e-rara.ch/i3f/v21/2840942/manifest  (2 records)
_cross-form only · spread 6d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9cad6120d54bd0370396` | Divi Caecilii Cypriani episcopi Carthaginensis et martyris opera iam q | e-rara | 1540 | no | 596 | 595 | 2026-03-20 | `e-rara:2840942` |
| `69b63e651c1c21a373864279` | Divi Caecilii Cypriani episcopi Carthaginensis et martyris opera iam q | e-rara | 1540 | no | 596 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2840942/manifest` |

### iiif:e-rara.ch/i3f/v21/2849222/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9c706120d54bd036eeb7` | Opera Dionysii veteris et nove translationis etiam novissime ipsius Ma | e-rara | 1502 | yes | 1069 | 988 | 2026-03-20 | `e-rara:2849222` |
| `69b6351f1c1c21a373826279` | Opera Dionysii veteris et nove translationis etiam novissime ipsius Ma | e-rara | 1502 | no | 1069 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/2849222/manifest` |

### iiif:e-rara.ch/i3f/v21/2870409/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9c54f105648cca08b790` | Meditationes divi Augustini episcopi Hipponenis ... Soliloquia animae  | e-rara | 1484 | yes | 592 | 591 | 2026-03-20 | `e-rara:2870409` |
| `69b6320a1c1c21a37380c8ca` | Meditationes divi Augustini episcopi Hipponenis ... Soliloquia animae  | e-rara | 1484 | no | 592 | 583 | 2026-03-15 | `` |

### iiif:e-rara.ch/i3f/v21/3179372/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9cd86120d54bd037157c` | Rosarium philosophorum. Secunda pars alchimiae de lapide philosophico  | e-rara | 1550 | yes | 201 | 201 | 2026-03-20 | `e-rara:3179372` |
| `69b642531c1c21a37388c17a` | Rosarium philosophorum. Secunda pars alchimiae de lapide philosophico  | e-rara | 1550 | no | 201 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/3179372/manifest` |

### iiif:e-rara.ch/i3f/v21/3303197/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9ce16120d54bd0371741` | Pedanii Dioscoridis ... de medica materia libri sex ... : his accessit | e-rara | 1554 | yes | 713 | 713 | 2026-03-20 | `e-rara:3303197` |
| `69b6442f18b87551bfc36d36` | Pedanii Dioscoridis ... de medica materia libri sex ... : his accessit | e-rara | 1554 | no | 713 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/3303197/manifest` |

### iiif:e-rara.ch/i3f/v21/3331183/manifest  (2 records)
_cross-form only · spread 6d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd9c796120d54bd036f318` | Malleus maleficarum | e-rara | 1511 | yes | 570 | 570 | 2026-03-20 | `e-rara:3331183` |
| `69b636291c1c21a37382b254` | Malleus maleficarum | e-rara | 1511 | no | 570 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/3331183/manifest` |

### iiif:e-rara.ch/i3f/v21/406362/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a9405c3a4ad12cb35ec8973` | Usus quadrantis astronomici geometrici, das ist, Beschreibung des Gebr | iiif | Unknown | no | 40 | 25 | 2026-08-30 | `iiif:https://www.e-rara.ch/i3f/v21/406362/manifest` |
| `6a9405c3a4ad12cb35ec8974` | Usus Quadrantis Astronomici [et] Geometrici, Das ist Beschreibung deß  | iiif | Unknown | no | 40 | 25 | 2026-08-30 | `iiif:https://www.e-rara.ch/i3f/v21/406362/manifest` |

### iiif:e-rara.ch/i3f/v21/9895502/manifest  (2 records)
_cross-form only · spread 19d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69d003fc0f4d028b337a0aec` | Somnium, Seu Opus Posthumum de Astronomia Lunari | e-rara | 1634 | yes | 202 | 201 | 2026-04-03 | `` |
| `69b696514a5f9daef79e86f2` | Ioh. Keppleri mathematici olim imperatorii Somnium, seu opus posthumum | e-rara | 1634 | no | 202 | 0 | 2026-03-15 | `iiif:https://www.e-rara.ch/i3f/v21/9895502/manifest` |

### iiif:https://dl.ndl.go.jp/api/iiif/772088/manifest.json  (2 records)
_scalar-visible · spread 26d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd030de26ef4b094821a64` | 古事記 上 (Kojiki, Vol. 1) | ndl_japan | 1870 | no | 72 | 0 | 2026-03-20 | `iiif:https://dl.ndl.go.jp/api/iiif/772088/manifest.json` |
| `69dfebad090ad7d5c33b1903` | Kojiki (古事記), Vol. 1 | ndl | 712 | yes | 72 | 72 | 2026-04-15 | `iiif:https://dl.ndl.go.jp/api/iiif/772088/manifest.json` |

### iiif:https://dl.ndl.go.jp/api/iiif/772089/manifest.json  (2 records)
_scalar-visible · spread 26d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69bd0352e26ef4b094821aad` | 古事記 中・下 (Kojiki, Vols. 2-3) | ndl_japan | 1870 | no | 128 | 0 | 2026-03-20 | `iiif:https://dl.ndl.go.jp/api/iiif/772089/manifest.json` |
| `69dfebaf090ad7d5c33b194c` | Kojiki (古事記), Vols. 2-3 | ndl | 712 | yes | 239 | 239 | 2026-04-15 | `iiif:https://dl.ndl.go.jp/api/iiif/772089/manifest.json` |

### iiif:https://manifests.sub.uni-goettingen.de/iiif/presentation/PPN812561724/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a49294b1bbf4176e1e89423` | Pharmacia Bipartita: in qua Simplicia Officinis Usitatoria, nec non Co | goettingen | Unknown | no | 677 | 25 | 2026-07-04 | `iiif:https://manifests.sub.uni-goettingen.de/iiif/presentation/PPN812561724/manifest` |
| `6a49294b1bbf4176e1e89422` | Pharmacia Simplicium Et Compositorum Bipartita: In qua Vegetabilia, An | goettingen | Unknown | no | 677 | 25 | 2026-07-04 | `iiif:https://manifests.sub.uni-goettingen.de/iiif/presentation/PPN812561724/manifest` |

### iiif:https://manifests.sub.uni-goettingen.de/iiif/presentation/PPN829200894/manifest  (2 records)
_scalar-visible · concurrency race · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `6a4b2aa6f16d716a55ccba1c` | Buda, Urbium Atque Arcium Per Europam Celeberrima: Cum Rebus Ad Eam Et | goettingen | Unknown | no | 53 | 0 | 2026-07-06 | `iiif:https://manifests.sub.uni-goettingen.de/iiif/presentation/PPN829200894/manifest` |
| `6a4b2aa6ebdd5bdf63deff87` | Buda, Urbium Atque Arcium Per Europam Celeberrima: Cum Rebus Ad Eam Et | goettingen | Unknown | no | 53 | 25 | 2026-07-06 | `iiif:https://manifests.sub.uni-goettingen.de/iiif/presentation/PPN829200894/manifest` |

### iiif:iiif.bodleian.ox.ac.uk/iiif/manifest/5c9da286-6a02-406c-b990-0896b8ddbbb0.json  (2 records)
_cross-form only · spread 46d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69907bd95f855ec553e7160b` | Kitab al-Bulhan (Book of Wonders) | bodleian | 1390 | yes | 366 | 366 | 2026-02-14 | `bodleian:5c9da286-6a02-406c-b990-0896b8ddbbb0` |
| `6953b56577f38f6761bd979d` | Kitab al-Bulhan Bodleian Library MS. Bodl. Or. 133 | bodleian | 1400 | yes | 366 | 366 | 2025-12-30 | `iiif:https://iiif.bodleian.ox.ac.uk/iiif/manifest/5c9da286-6a02-406c-b990-0896b8ddbbb0.json` |

### met:met-78597-2013_676_01.jpg  (2 records)
_cross-form only · spread 47d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69e430beec822e8744c886ed` | Snow on Fuji (艶本 婦慈のゆき, Eisen Shunga) — Page 1 | met | 1824 | no | 0 | 0 | 2026-04-19 | `` |
| `6a219898f664c741ea0103ed` | Snow on Fuji (艶本 婦慈のゆき, Eisen Shunga) | met | 1824 | no | 18 | 0 | 2026-06-04 | `consolidated:met-eisen-snow-on-fuji` |

### met:met-78660-2013_758_a_c_a_01.jpg  (2 records)
_cross-form only · spread 47d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69e43100ec822e8744c88711` | Weighing the Goods of Love (艶色品定女, Kunimori Shunga) — Page 1 | met | 1852 | no | 0 | 0 | 2026-04-19 | `` |
| `6a219898f664c741ea0103b9` | Weighing the Goods of Love (艶色品定女, Kunimori Shunga) | met | 1852 | no | 51 | 0 | 2026-06-04 | `consolidated:met-kunimori-weighing-goods-of-love` |

### met:met-78662-2013_760_01.jpg  (2 records)
_cross-form only · spread 47d · all hidden_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `69e43081ec822e8744c886cf` | Tōsei Komonchō (Kuniyoshi Shunga) — Page 1 | met | 1859 | no | 0 | 0 | 2026-04-19 | `` |
| `6a219898f664c741ea010400` | Tōsei Komonchō (Kuniyoshi Shunga) | met | 1859 | no | 15 | 0 | 2026-06-04 | `consolidated:met-kuniyoshi-tosei-komoncho` |

### wikimedia_commons:Hemelvaart van Christus Hemelvaart van Henoch Henoch word opgenomen ten hemel (titel op object), RP-P-2015-17-63-1(V).jpg  (2 records)
_cross-form only · spread 28d · has a VISIBLE member_

| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `874343ab68df7113411a6b30` | Hemelvaart van Christus Hemelvaart van Henoch Henoch word opgenomen te | wikimedia_commons | 1645 | no | 0 | 0 | 2026-04-19 | `` |
| `756b1494fe97e4a837456ccd` | Hemelvaart van Christus Hemelvaart van Henoch Henoch word opgenomen te | wikimedia_commons | 1645 | yes | 0 | 0 | 2026-03-22 | `` |
