# IA OCR error taxonomy — 2026-09-30 (#5186)
pairs 4695; usable 4470 (dropped: {"reference-degenerate":83,"reference-collapsed":100,"too-short":42}); interior 2132 pages in 4 books; front matter 2338 pages in 242 books
measure: agreement (flash-lite is the reference, not ground truth); rates are per opportunity; a book is one observation.

## A. Interior pages, per book (one book = one observation)

| book (Archive engine) | pages | seq median | words | years wrong | numbers wrong | known letter confusions /1k words | other glyph /1k | unrelated /1k | Capitalised wrong | words dropped /1k | noise tokens /1k | missing block pages | reading-order pages | furniture kept | hyphens /100 lines |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Book of Clevelanders 1914 (ia-ocr 0.0.21) | 294 | 0.977 | 120878 | 0.7% (40/6007) | 0.6% | 3.0 | 12.6 | 1.4 | 3.0% | 0.1 | 1.3 | 0.0% | 5.4% | 87.3% | 0.0 |
| Deyo, Barnstable County 1890 (ia-ocr 0.0.21) | 906 | 0.986 | 429931 | 4.6% (621/13384) | 4.4% | 0.4 | 1.2 | 0.5 | 0.6% | 0.3 | 0.4 | 0.1% | 0.0% | 91.5% | 0.0 |
| Wakeley, Omaha: Gate City 1917 (ia-ocr 0.0.13) | 563 | 0.987 | 373347 | 8.0% (457/5698) | 7.6% | 1.4 | 4.3 | 1.0 | 1.9% | 0.2 | 0.5 | 0.0% | 0.9% | 94.7% | 0.0 |
| NH Notables 1919 (ia-ocr 0.0.14) | 369 | 0.99 | 156280 | 1.0% (94/9578) | 0.8% | 1.1 | 1.9 | 1.1 | 0.8% | 0.2 | 4.5 | 1.9% | 4.1% | 77.9% | 0.0 |

## B. Error classes — interior (median of per-book rates, 4 books) vs front matter (one page per book, 242 books)

| class | unit | interior median (range) | interior pooled n/d | front matter 1 page/book | front matter all pages | example (IA → model) |
|---|---|---|---|---|---|---|
| year misread or dropped | per year token | 2.8% (6.7‰–8.0%) | 1212/34667 | 6.2% (19/307) | 6.0% (137/2287) | 1900 → 1870 |
| number misread or dropped | per number (≥2 digits) | 2.6% (6.0‰–7.6%) | 1381/43858 | 8.1% (147/1819) | 9.1% (1574/17215) | 1900 → 1870 |
| year split or fused | per year token | 3.1‰ (1.3‰–6.2%) | 436/34667 | 2.0% (6/307) | 2.4% (56/2287) |  |
| digit substitution | per number | 1.1‰ (0.4‰–3.6%) | 643/43858 | 1.4% (25/1819) | 1.6% (277/17215) | 1900 → 1870 |
| digit read as letter | per number | 3.6‰ (2.7‰–4.5%) | 410/43858 | 4.4% (80/1819) | 4.7% (814/17215) | r855 → 1855 |
| letter read as digit | per word | 0.2‰ (0.1‰–0.5‰) | 197/1080436 | 0.7‰ (51/68424) | 0.8‰ (485/628764) | 0 → O |
| script confusion | per word | 0.0‰ (0.0‰–0.0‰) | 0/1080436 | 0.2‰ (14/68424) | 0.0‰ (14/628764) | Мг → COPIES |
| numeral dropped | per number | 0.5‰ (0.0‰–0.9‰) | 20/43858 | 4.9% (90/1819) | 4.4% (756/17215) | ∅ → 1841 |
| letter confusion (known pair) | per word | 1.2‰ (0.4‰–3.0‰) | 1225/1080436 | 2.0‰ (137/68424) | 2.4‰ (1486/628764) | sou → son |
| glyph confusion (other 1–2 char) | per word | 3.1‰ (1.2‰–1.3%) | 3948/1080436 | 8.4‰ (577/68424) | 7.9‰ (4996/628764) | Eiding → Riding |
| multi-glyph misread | per word | 0.5‰ (0.2‰–1.1‰) | 511/1080436 | 2.5‰ (172/68424) | 2.1‰ (1329/628764) | BABBEB → BARBER |
| unrelated word | per word | 1.1‰ (0.5‰–1.4‰) | 947/1080436 | 5.1‰ (346/68424) | 4.0‰ (2512/628764) | BAEKFiB → BARKER |
| long-s ↔ f | per word | 0.0‰ (0.0‰–0.0‰) | 1/1080436 | 0.5‰ (32/68424) | 0.3‰ (217/628764) | inFtructors → instructors |
| capitalised word wrong | per Capitalised word | 1.3% (6.2‰–3.0%) | 3568/256373 | 4.4% (441/10098) | 4.1% (3646/89688) | Eiding → Riding |
| word dropped | per word | 0.2‰ (0.1‰–0.3‰) | 280/1080436 | 4.8‰ (330/68424) | 3.2‰ (2012/628764) |  |
| word displaced | per word | 0.0‰ (0.0‰–0.3‰) | 61/1080436 | 0.5‰ (36/68424) | 0.5‰ (337/628764) |  |
| number displaced | per number | 0.0‰ (0.0‰–0.3‰) | 4/43858 | 6.9% (125/1819) | 4.8% (832/17215) |  |
| word only in Archive | per model word | 1.0‰ (0.6‰–1.7‰) | 990/1080436 | 4.4‰ (301/68424) | 3.1‰ (1979/628764) |  |
| noise token in Archive | per model word | 0.9‰ (0.4‰–4.5‰) | 1233/1080436 | 4.0‰ (277/68424) | 3.0‰ (1897/628764) | s → ∅ |
| spacing split / merge | per word | 2.2‰ (0.9‰–3.7‰) | 2805/1080436 | 3.3‰ (223/68424) | 3.1‰ (1957/628764) | dis trict → district |
| superscript marker | per word | 0.0‰ (0.0‰–0.9‰) | 371/1080436 | 0.1‰ (10/68424) | 0.1‰ (66/628764) | Richard → Richard¹ |
| superscript as digit | per word | 0.0‰ (0.0‰–0.0‰) | 0/1080436 | 0.3‰ (23/68424) | 0.3‰ (218/628764) | 1 → ¹ |
| unaligned run | per word | 0.1‰ (0.1‰–0.4‰) | 269/1080436 | 2.3‰ (156/68424) | 2.3‰ (1429/628764) |  |
| case only | per word | 0.4‰ (0.1‰–0.7‰) | 380/1080436 | 1.0% (687/68424) | 1.1% (6713/628764) |  |
| long-s ↔ s | per word | 0.0‰ (0.0‰–0.0‰) | 0/1080436 | 0.0‰ (0/68424) | 0.0‰ (0/628764) |  |
| inner punctuation | per word | 0.9‰ (0.4‰–2.2‰) | 1346/1080436 | 1.1‰ (73/68424) | 1.4‰ (878/628764) |  |
| diacritic only | per word | 0.0‰ (0.0‰–0.3‰) | 69/1080436 | 2.6‰ (180/68424) | 2.6‰ (1622/628764) |  |
| missing block (≥ 8 words) | per page | 0.6‰ (0.0‰–1.9%) | 8/2132 | 5.0% (12/242) | 3.6% (83/2338) | ∅ → THE news of the bombardment of Fort Sumter in April 1861 |
| block only in Archive (≥ 8 words) | per page | 8.7‰ (4.4‰–1.6%) | 18/2132 | 12.0% (29/242) | 6.4% (149/2338) | sec y and treas The Esplande Apartments Co → ∅ |
|   … readable prose (model skipped lines) | per page | 7.5‰ (0.0‰–1.1%) | 11/2132 | 6.2% (15/242) | 3.7% (87/2338) |  |
|   … noise (table / ornament read as text) | per page | 1.4‰ (0.0‰–3.3‰) | 4/2132 | 5.4% (13/242) | 2.4% (56/2338) |  |
|   … displaced (page also has a model-only block) | per page | 0.6‰ (0.0‰–5.4‰) | 3/2132 | 4.1‰ (1/242) | 2.6‰ (6/2338) |  |
| reading order / columns | per page | 2.5% (0.0‰–5.4%) | 36/2132 | 4.1‰ (1/242) | 8.1‰ (19/2338) |  |
| page misaligned | per page | 1.1‰ (0.0‰–4.1%) | 14/2132 | 6.2% (15/242) | 4.2% (99/2338) |  |
| running-head / page-number lines (Archive) | lines per page | 105.7% (55.1%–131.2%) | 1874/2132 | 72.7% (176/242) | 90.8% (2124/2338) |  |
| furniture kept in body | per header/page-num/signature | 89.4% (77.9%–94.7%) | 3840/4296 | 76.7% (264/344) | 77.4% (2604/3366) |  |
| line-end hyphen | per Archive line | 0.0‰ (0.0‰–0.0‰) | 0/100223 | 1.0‰ (8/7995) | 0.9‰ (65/72654) |  |

## C. Confusion pairs (printed → Archive read), interior all pages

- digits: 3→8 ×614, 9→0 ×8, 6→0 ×4, 1→3 ×2, 3→5 ×2, 8→3 ×2, 8→9,7→0 ×1, 4→2 ×1, 5→4 ×1, 5→8 ×1, 3→8,3→8 ×1, 5→6 ×1
- digit↔letter: 1→i ×203, 8→s ×57, o→0 ×51, 10→lo ×34, i→1 ×21, s→8 ×17, 11→n ×15, s→5 ×11, ½→4 ×9, t→7 ×9
- script confusion: none
- letters: r→e ×880, n→u ×137, li→h ×133, y→v ×132, →i ×116, h→li ×101, i→l ×88, c→e ×86, r→k ×84, m→al ×79, l→i ×77, n→x ×75, in→m ×70, m→i ×70, r→b ×63, m→ai ×61, rn→m ×55, ll→u ×49, o→c ×47, f→t ×47
- multi-glyph: l→,i→h ×10, R→E,c→e ×9, →i,n→i ×7, 3→8 ×7, l→,i→H ×7, R→B,R→B ×5, R→E,n→u ×4, ber→ ×4, ½→ ×4, I→,l→U ×4

Front matter (all pages): digits 3→5 ×45, 6→0 ×39, 9→0 ×32, 3→8 ×30, 2→3 ×25, 5→6 ×16, 5→3 ×8, 1→3 ×5; digit↔letter 1→i ×276, i→1 ×73, o→0 ×61, 0→o ×40, 11→ii ×39, 5→s ×39, l→1 ×32, ll→11 ×32; script 1→А ×3, COPIES→Мг ×1, Mr→Маһоп ×1, 1→д ×1, 1→я ×1, 1→КА ×1, M→М ×1, P→Р ×1; letters h→li ×196, r→e ×165, i→l ×145, l→i ×105, b→h ×102, f→p ×98, r→b ×85, u→n ×84, á→d ×84, e→c ×81, h→b ×72, s→a ×71, v→y ×70, n→u ×66, s→ ×65, r→i ×65

## D. Archive engine (front matter, one page per book)

| D. Archive engine | books | seq median | years wrong | numbers wrong | known letter /1k | other glyph /1k | unrelated /1k | Capitalised wrong | noise /1k | missing block pages | misaligned pages | long-s /1k |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ia-ocr 0.0.21 | 110 | 0.96 | 5.7% (10/174) | 6.1% | 1.8 | 7.8 | 5.2 | 4.9% | 2.8 | 7.3% | 9.1% | 1.1 |
| ia-ocr 0.0.14 | 62 | 0.944 | 5.1% (4/79) | 11.1% | 2.8 | 11.9 | 7.4 | 4.3% | 5.7 | 3.2% | 4.8% | 0.0 |
| ABBYY 8 | 20 | 0.97 | 7.1% (1/14) | 4.1% | 2.5 | 7.2 | 6.3 | 4.8% | 4.7 | 0.0% | 5.0% | 0.0 |
| unknown | 18 | 0.972 | 20.0% (4/20) | 10.6% | 3.9 | 12.6 | 3.7 | 5.4% | 4.3 | 0.0% | 0.0% | 0.0 |
| ia-ocr 0.0.18 | 13 | 0.974 | 0.0% (0/4) | 0.0% | 1.2 | 6.6 | 0.5 | 2.5% | 1.2 | 0.0% | 0.0% | 0.0 |
| ia-ocr 0.0.20 | 8 | 0.948 | 0.0% (0/5) | 5.6% | 0.3 | 1.9 | 4.2 | 2.0% | 14.5 | 12.5% | 0.0% | 0.0 |
| ia-ocr 0.0.15 | 3 | 0.983 | — (0/0) | 6.7% | 0.0 | 4.0 | 2.0 | 4.8% | 1.0 | 33.3% | 0.0% | 0.0 |
| ABBYY 11 | 2 | 0.624 | — (0/0) | — | 0.0 | 8.8 | 0.0 | 0.0% | 8.8 | 0.0% | 50.0% | 0.0 |
| ia-ocr 0.0.17 | 2 | 0.985 | — (0/0) | — | 0.0 | 3.2 | 0.0 | 0.0% | 1.1 | 0.0% | 0.0% | 0.0 |
| ia-ocr 0.0.12 | 2 | 0.978 | — (0/0) | — | 0.0 | 0.0 | 4.0 | 0.0% | 0.0 | 0.0% | 0.0% | 0.0 |
| ia-ocr 0.0.13 | 2 | 0.984 | 0.0% (0/11) | 15.2% | 1.0 | 2.0 | 1.0 | 0.8% | 0.0 | 0.0% | 0.0% | 0.0 |

## E. Print century (front matter, one page per book)

| E. Print century | books | seq median | years wrong | numbers wrong | known letter /1k | other glyph /1k | unrelated /1k | Capitalised wrong | noise /1k | missing block pages | misaligned pages | long-s /1k |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1850–99 | 99 | 0.959 | 4.5% (4/89) | 8.3% | 2.2 | 11.6 | 7.7 | 5.3% | 4.4 | 1.0% | 9.1% | 1.2 |
| 1900+ | 93 | 0.965 | 5.6% (11/196) | 8.1% | 1.2 | 6.1 | 4.0 | 3.6% | 3.8 | 7.5% | 5.4% | 0.0 |
| 1800–49 | 35 | 0.946 | 18.8% (3/16) | 9.7% | 3.9 | 7.1 | 2.7 | 4.4% | 5.0 | 11.4% | 2.9% | 0.0 |
| unknown | 12 | 0.968 | 16.7% (1/6) | 2.4% | 1.4 | 6.9 | 2.4 | 2.9% | 1.9 | 0.0% | 0.0% | 0.0 |
| 1700s | 2 | 0.945 | — (0/0) | 0.0% | 3.6 | 10.9 | 1.8 | 9.4% | 9.1 | 0.0% | 0.0% | 0.0 |
| pre-1700 | 1 | 1 | — (0/0) | — | 0.0 | 0.0 | 0.0 | 0.0% | 0.0 | 0.0% | 0.0% | 0.0 |

## F. Catalogue language (front matter, one page per book)

| F. Catalogue language | books | seq median | years wrong | numbers wrong | known letter /1k | other glyph /1k | unrelated /1k | Capitalised wrong | noise /1k | missing block pages | misaligned pages | long-s /1k |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| English | 242 | 0.961 | 6.2% (19/307) | 8.1% | 2.0 | 8.4 | 5.1 | 4.4% | 4.0 | 5.0% | 6.2% | 0.5 |

## G. Punctuation conventions, interior all pages (counts)

- Archive: {"curly":4904,"straight":6185,"emdash":1616,"endash":0,"spaced_hyphen":8}
- model:   {"curly":1523,"straight":7302,"emdash":1517,"endash":1225,"spaced_hyphen":1}

## H. Facsimile check of 15 disagreements

| verdict | n |
|---|---|
| archive-wrong | 11 |
| model-wrong | 4 |

- p431 6aa4c8a388a2920a45a88592 [digit-substitution] "1888" → "1883": **archive-wrong** — printed 1883 in a flat-topped 3; the Archive reads it as 8 (Deyo's 614-instance 3→8 class)
- p1083 6aa4c8a388a2920a45a88592 [digit-substitution] "1888" → "1883": **archive-wrong** — printed 'pastor from 1883 to 1886'; Archive 'from 1888 to 1886' — an impossible range that no text gate notices
- p516 6aa4c8a388a2920a45a88592 [digit-substitution] "1882" → "1832": **archive-wrong** — genealogy line: printed 'William T.⁸, 1832'; Archive '1882', and every generation superscript (⁹ ⁸ ⁷ … ¹) becomes an apostrophe or asterisk — the lineage numbering is lost
- p347 6aa4c8b488a2920a45a88e2e [digit-read-as-letter] "i860" → "1860": **archive-wrong** — old-style figures: the 1 is a small-cap I shape; Archive reads 'i860'
- p708 6aa4c8b488a2920a45a88e2e [digit-read-as-letter] "i 191 7" → "1 1917": **archive-wrong** — old-style figures: 'January 1, 1917' → 'January i 191 7' (1 → i, the descending 7 split off)
- p114 6aa4c8a388a2920a45a88592 [letter-read-as-digit] "77uro" → "Truro": **archive-wrong** — italic place name 'Truro:' read as '77uro'
- p26 6aa4c89788a2920a45a883eb [glyph-confusion-other] "Eiding" → "Riding": **archive-wrong** — this face's capital R is read as E (~880 times in the book: Eiding, Eotary, Eeserve), sometimes K or B
- p209 6aa4c89788a2920a45a883eb [letter-confusion-known] "Erie" → "Erle": **archive-wrong** — bold headword 'PATCHIN, Erle Monroe' — l read as i, producing a real word (Erie) that no spell-check flags
- p432 6aa4c8a388a2920a45a88592 [spacing] "LeviSwift" → "Levi Swift": **archive-wrong** — tight word space dropped: 'Levi Swift' → 'LeviSwift' (a name search misses it)
- p173 6aa4c8a388a2920a45a88592 [ia-only-block] "BP UETRGTIL EY Ge fon Senco bs 5 arn ck okt" → "": **archive-wrong** — two-column dot-leader table (cranberry shipments by station): the Archive keeps most numbers but turns station names and leaders into letter noise; the model reads the table cleanly
- p105 6aa4c8a388a2920a45a88592 [missing-block] "Bass, news of the bombardment" → "THE news of the bombardment": **archive-wrong** — chapter opening with a drop cap: the T becomes 'Bass' and the indented lines beside it are moved to the END of the page
- p86 6aa4c8b488a2920a45a88e2e [ia-only-block] "who had four brothers, all of whom were soldiers of the Civil war …" → "": **model-wrong** — flash-lite eye-skip between two occurrences of 'Benjamin F. Black': 3 printed lines (39 words) silently omitted; the Archive has them
- p203 6aa4c8b488a2920a45a88e2e [ia-only-block] "president of the Farmers & Merchants Bank at Morrill, Nebraska;" → "": **model-wrong** — flash-lite skipped one of a run of parallel 'president of the … Nebraska;' clauses; the Archive has it
- p520 6aa4c8a388a2920a45a88592 [unrelated-word] "had" → "have": **model-wrong** — printed 'They have had eleven children'; flash-lite wrote 'have have'
- p42 6aa4c89788a2920a45a883eb [digit-substitution] "1900" → "1870": **model-wrong** — printed '19?0' with the third digit broken; the Archive's 1900 follows the print, flash-lite's 1870 is an inference (plausible for a Civil War veteran) the page does not show
