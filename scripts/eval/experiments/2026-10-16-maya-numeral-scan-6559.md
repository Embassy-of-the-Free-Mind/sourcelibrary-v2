---
stage: translation
measure: none
languages: [yua]
scripts: [Latn]
canons: []
n_books: 35
n_pages: 3932
verdict: "Across 3,932 translated Yucatec pages, the scan finds 4,897 Maya number phrases and judges 1,318 of them. 63 of 190 compound numerals (scores, 400s, catac sums) are not stated in the page's English. The 1846 Coleccion de sermones does not follow Beltrán's 1746 table: wherever the referent is known, it uses lahu oxkal for 30, not 50. So its 'thirty-three years' for Christ is the author's number, not a model error. Five Beltrán-confirmed mismatches were checked on the page images and re-translated."
status: adopted
decision: "Keep scripts/audit/maya-numeral-scan.mjs as a read-only lead list for Yucatec books; a flagged numeral is fixed only after a look at the image and the table. Do not rewrite the Coleccion's lahu oxkal pages to Beltrán's 50."
superseded_by: null
issue: [6559]
---
PRIOR ART: `scripts/audit/es-edition-quality.mjs` and `scripts/audit/translation-leaf-shift.mjs` compare digit numerals between two texts. Neither reads a vigesimal number word. The 2026-10-16 spot check on #6559 (Coleccion p.200, *lahu oxkal catac oxpel* read as 53 by Beltrán) is the trigger.

## 2026-10-16 · Do the English translations of the Yucatec books state the numbers the Maya prints?

**Why.** A spot check of *Coleccion de sermones* (1846) p.200 read *lahu oxkal cá tac oxpel haƀóob* as 53 by Beltrán's table (*Arte*, ed. 1859, `6a9f3fa4…` p.218: *Lahuyoxkal* 50, *Oxlahutukal* 33). The English said "thirty-three years". Yucatec counts in twenties, and a model that does not know this writes the number it expects.

**Method.**
- `scripts/lib/maya-numerals.mjs` reads number words by Beltrán's table (pp. 217–225):
  - whole scores, *N-kal* = N × 20;
  - a unit counted into a score, *U tu/y N-kal* = U + (N − 1) × 20;
  - *bak* = 400 and *pic* = 1,000 (8,000 kept as an alternative);
  - *catac* sums;
  - units with a counting particle (*ox-pel*, *ca-tul*).
  Unit tests cover every table row from 20 to 1,000 and the false positives found on the live run.
- `scripts/audit/maya-numeral-scan.mjs` checks every page of every `language: 'Yucatec Maya'` book that has OCR and English. A phrase is a mismatch when its value is not among the numbers the English states (digits, number words, ordinals). These phrases are not judged:
  - value 1;
  - phrases with digits within 60 characters of them, i.e. numeral tables and printed glosses (369).

**Result (after the Argon re-translation of 15 books, 13:19 UTC).**

| | count |
|---|---|
| pages scanned / with a phrase | 3,932 / 1,482 |
| phrases found / judged | 4,897 / 1,318 |
| compound phrases judged / not in the English | 190 / **63** (52 pages, 11 books) |
| small phrases (unit + particle) judged / not in the English | 1,128 / 69 |

Of the 63 compound mismatches, 19 are in the *Coleccion* and 35 in the manuscript Chilam Balam books, where *pic* is often a verb and copyists' counts vary. The rest are in Motul, the *Maya legal documents* (land measures in *pic*), *Explicacion* and *Leti u ebanhelio*. On the same parser, the pre-Argon text had 76.

**The positive control is flagged** (p.200, value 53, English 33). **But the author's numerals are not Beltrán's.** In the *Coleccion*, *lahu oxkal* fits 30 every time the referent is known:
- **Abraham's bargain for Sodom (p.383, Gen 18).** The sequence is *cakáal cá tac lahun* (50), then *cakal cá tac hopel* (45), then *lahu oxkal*, then down to ten. The third number must be lower than 45, so it cannot be 50.
- **Christ's 33 years** (pp. 200, 215, 225).
- **John 5:5, "thirty and eight years"** (p.173, *lahu oxkal catac uaxac*).
- **Bernard's 30 companions** (p.86).

So "thirty-three" on p.200 is the author's number. Beltrán's 53 belongs in a note, not the text. This was not changed.

**Confirmed and re-translated (5 pages).** Each numeral was read on the page image and its value taken from Beltrán's table. Each page was re-read once with the style line and one line naming the number, then written by `cli-translate.mjs apply` (run `cli-translate-20261016123500`):

| page | Maya (image) | Beltrán | English before | after |
|---|---|---|---|---|
| Coleccion p.303 | *cakal catac lahun tzicbalóob* | 50 | "countless conversations" | "fifty conversations" |
| Coleccion p.328 | *manal humbak cá tac lahunkal habóob* | 600 (St Anthony † 1231; 1846) | "more than 580 years" | "more than six hundred years" |
| Coleccion p.345 | *hunkal cá tac capel horaóob* | 22 | "twenty-four hours" | "twenty-two hours" |
| Explicacion p.41 | *Hokal ú tenel ti humpel* | 100 | "Twenty times" | "A hundred times" |
| Explicacion p.179 | *cú topzic hokal tioklal humpel* | 100 | "sixty for one" | "a hundred for one" |

**Open leads, not changed:**
- Coleccion p.159, *lahu oxkal catac catul*: the English gives 62, which is neither 52 (Beltrán) nor 32 (the author's usage).
- Coleccion p.415, *humƀak cátac kokáal*: 400 + (h)okal = 500, which matches 1 Cor 15:6; the English gives 120.
- Coleccion p.318, *hokal cà tac cabak*.

**Limits.**
- Set membership: a number stated anywhere on the page counts as a match. A wrong English number can therefore hide behind a right one; p.383 passes this way.
- False positives remain: *hupic* (the verb "insert"), *pic* as a verb in the Chilam Balam books, and a split phrase where the OCR has a typo (Motul p.307 *hotuc yoxbak*).

*Replicated?* No.
