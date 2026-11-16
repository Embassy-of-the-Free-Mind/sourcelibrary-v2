---
stage: ocr
measure: [judged]
languages: [sa]
scripts: [Deva]
canons: []
n_books: 30
n_pages: 360
verdict: "Pilot fails Derek's quality gate (at least 24 of 30 would-write pages clean or isolated-wrong-characters only): 15 of 30. By eye, with every image opened: 0 clean, 15 isolated wrong characters, 15 with a wrong or missing word or line, 0 unusable, 0 invented or wrong leaf on would-write pages. One invented page among the rejects (English prose on a blank verso). Route sanskrit-print-surya-95 stays OFF; nothing applied."
status: rejected
decision: "Not turned on (v3 #95, 2026-11-13). Surya 2 misreads old-style Nirnayasagar-type glyphs systematically (ह→क, दृ→हृ, न्त्र→ग्न, ऽ→अ) and often turns them into real but wrong words. That is good enough for search and too weak for a quotable first read without a correction pass."
feeds: route
superseded_by: null
issue: [95, 7243]
router_evidence: "none — cell sanskrit-blank/print stays planned, not bound; this pilot is hand-picked by book (one random page per book plus 7 hard pages), not a router draw"
defect_rates: "none — per-page categories and counts are in the table below; no per-defect inventory in the defect-rate schema"
---
<!-- PRIOR ART: 2026-11-03-sanskrit-surya-print-confirm-7243.md (the CER test of the same engine on 50 pages, one per book, pre-chosen print pages; this is the production lane's first batch read whole and judged by eye, per Derek's gate of 2026-11-13). -->
## 2026-11-13 · Is the Surya 2 lane's first batch good enough to switch on for the 761 hidden Sanskrit print books? (v3 #95)

**No, not as a bare first read.** It invents nothing on the pages it would write, keeps every block and column in
order, and gets every word identifiable on half the pages. On the other half, at least one word comes out as a
different word, mostly on old-style type.

**Who reads this.** Derek, deciding the Sanskrit print route and the Surya licence question. The licence question
waits on whether the reads are good.

### What ran
- Lane `/root/jobs/gpu-print-sa-95` (`gpu-print-lane.mjs --lang sa`), the real lane dir. Frame 761 books / 249,656 pages
  with no text (2026-11-13 12:40Z). Plan `--limit 30 --max-pages 12`: 30 books, 360 pages spread through each book.
- GPU: gex45 RTX PRO 4000, vLLM 0.31.0, surya-ocr 0.22.1, weights `datalab-to/surya-ocr-2@3b3d4cdf88d6928b0acdc75181b13206ea67c4a3`
  (the #7243 snapshot), util 0.6, MTP on. Run `su-20261113T135002Z`: 360 reads, 0 errors, in 30.8 min of serving
  (200 in 17.7 min, 160 in 13.1 min), **about 700 pages/h including image download**. That is well below the
  2,535 pages/h the 50-page #7243 run logged.
- Dry `apply`: 242 would-write, 20 textless, 14 `not_devanagari`, 84 `book_not_devanagari` (7 books), 0
  `index_columns`, 0 `loop_guard`, 0 errors. Every planned page ended in an outcome (242+20+14+84 = 360).
- **Nothing was applied.** No page, hold, visibility or router pointer changed.

### By eye
Four Opus readers in one session, each image opened at full resolution with zoomed crops (3–6 per page). Short pages
were proofread whole; dense pages got a ≥15-line stretch plus a structural check of the whole page. Two `word_line`
calls were re-checked by the session itself against crops: Nyāyabindu p.53 (हेतुः→केतुः, सपक्षे→सपते, ऽयमर्थः→अयमर्थः)
and Ānandāśrama 23 p.16 (…कत्वदृष्टि…→…कत्वहृष्टि…). Both held.

**Draw.** One would-write page per book, seeded (20261113) from the 23 books with would-write pages, plus 7 hard pages
chosen by hand: two-column dictionary (Abhidhānarājendra 551, 1238), small or faded type (Mūlakalpa 167,
Ānandalaharī 122), a table (Vaikhānasa 28), dense commentary (Īśāvāsya 41), and a verse page (Puruṣārthacintāmaṇi 464).

| category | pages |
|---|---|
| clean | 0 |
| isolated wrong characters only | 15 |
| a wrong or missing word or line | 15 |
| unusable | 0 |
| invented or wrong leaf | 0 |

**Typical errors, leaf → read:**
- हेतुः → केतुः, six times on one logic page (Nyāyabindu p.53). The text's central term becomes another real word.
- मन्त्रब्राह्मणयोर्वेद… → मग्नब्राह्मणयोर्वेद… (Ānandāśrama 23 p.16); …कत्वदृष्टि… → …कत्वहृष्टि… (same page).
- यवमध्यादुपरि → यवमध्यादधः रि, twice (Abhidhānarājendra 1238). "Above" becomes "below".

Other patterns: superscript footnote markers dropped on every page that has them; repha lost (माषपर्णी→माषपणी);
old-style अ read as ग्रा; avagraha ऽ read as अ; the margin line numbers of verse editions read into the text. On
clean modern type (Brahmasūtrabhāṣya, Taittirīya, Bhaktimañjarī, Haṭhayogapradīpikā) the read is 1–2 wrong characters
a page. No leaf in the 30 carried Vedic accents. The one Vedic sign seen, ꣳ in इदꣳ, came out as a visarga.

<details><summary>All 30 pages</summary>

| book | page | set | category | wrong chars / words / lines (in lines proofread) | image opened | note |
|---|---|---|---|---|---|---|
| Abhidhnarjendra : koa (vol. 5) `6af634152a3ff91f6674a054` | 413 | random | wrong/missing word or line | 13 / 0 / 0 (24) | yes, 2 crops | Abhidhanarajendra dictionary page, two columns. Proofread the left column from the top through 'विधेयम्' (24 lines): 13 char errors, e.g. ग्ग->ग्न, ऽद्य->ऽथ, verse number ३४५->३४६, होंति->होति, लिप्तं->लितं. Structure check: both columns are complete and in or |
| Bhaktimañjarī `6af635361046991b0516db89` | 115 | random | isolated wrong characters | 1 / 0 / 0 (25) | yes, 5 crops | Bhaktimanjari, verses 51-56 in large type with one footnote. The read is almost perfect: one घ->ध. It also drops the superscript footnote marker over समुदय and a stray anusvara in the footnote. |
| Hahayogapradpik `6af636911046991b05177611` | 133 | random | isolated wrong characters | 1 / 0 / 0 (29) | yes, 3 crops | Hathayogapradipika with a Hindi bhashatika: Sanskrit mula verses 9-11 and Hindi commentary. The OCR correctly normalizes the old प्र glyph that looks like म. The only slip is an added virama, plus the footnote reference after दृष्टि is dropped. An excellent re |
| Mrkaeyapurnam `6af638051046991b0517f350` | 156 | random | isolated wrong characters | 10 / 0 / 0 (24) | yes, 3 crops | Markandeya Purana, verses 67-78 in single-column shloka layout. All lines are present. About 10 conjunct and matra errors (समुत्पत्स्यति->समुत्पत्यति twice, सुभ्रूः->सुम्भूः, ततस्तौ->ततस्ती, श्राद्धं->श्राङ्, उपकारी->उपकारौ), but every word can still be recogn |
| Prthviraja vijaya. A Sanskrit epic wit `6af639081046991b05185ea7` | 44 | random | wrong/missing word or line | 9 / 1 / 0 (20) | yes, 3 crops | Prthvirajavijaya, verses 8-10 with Jonaraja's commentary and printed lacuna dashes. The first word of the page is replaced (उपप्लवं->उपस्वयं) and म्ल->स्न recurs. Other errors: ध->भ twice, ड्ड/द्ध->इ, missing repha in र्भूमेः, अङ्कं->अङ्गं. The Arabic margin l |
| Suśrutasaṃhitā (vol. Vol. 3 1899) `6af63aa81046991b0518eda6` | 97 | random | isolated wrong characters | 8 / 0 / 0 (31) | yes, 5 crops | Sushruta Samhita, Chikitsasthana 5.53-54, with Hindi translation and two notes. Complete and in order. The repha in माषपर्णी is dropped three times, तृप्ति->तृति, plus the two examples. The superscript note numbers in the verse are omitted. |
| Vidhna-prijtah. Edited by Trprasanna V `6af63cbf1046991b0519ce84` | 71 | random | isolated wrong characters | 8 / 0 / 0 (22) | yes, 3 crops | Vidhana-parijata, quoted Shaunakiya verses on eclipse birth rites. All lines are present. Errors: पत्नीं->पतीं, शुचौ->शुची, सीसेन->सीमेन, the asterisk note-mark is dropped, plus the two examples. Doubled-y spellings (सूर्य्य) are normalized, which is not count |
| nandalahar `6af63d741046991b051a10a7` | 31 | random | isolated wrong characters | 5 / 0 / 0 (23) | yes, 3 crops | Chandrika commentary prose, single column. A very good read with 5 single-character slips (तस्माद्वल्ली->तस्माद्बल्ली, the print's misprinted श्रघणात्->श्रधणात्, सोऽकामयत->सोऽकामयत्, and the two examples). |
| Abhidhnarjendra : koa (vol. 5) `6af634152a3ff91f6674a054` | 1238 | hard | wrong/missing word or line | 15 / 2 / 0 (36) | yes, 3 crops | Abhidhanarajendra s.v. बंधण. Proofread the top of the left column, the gathas 96-100 and about 11 lines of the right column. Errors: पल्योपम->पत्योपम on every occurrence, वक्तव्याः->वक्रव्याः, अणागार->अण्णार, and two verse numbers shifted down by one. In the r |
| Purusharthacintamanih `6af639131046991b051860c1` | 464 | hard | isolated wrong characters | 5 / 0 / 0 (31) | yes, 3 crops | Purusharthacintamani (Grahananirnaya), 30 lines of eclipse-pacification mantras. Complete and in order. Errors: आचार्यै->आचार्ये and the footnote °र्यु मैत्रै read as यु मैत्रे, plus the two examples. The superscript footnote marker over कुर्यु is dropped. The |
| Anandasrama Sanskrit series (vol. 23 ( `6af634f71046991b0516c562` | 16 | random | wrong/missing word or line | 14 / 7 / 0 (32) | yes, 4 crops | Introduction (bhūmikā) to the Vaiyāsikanyāyamālā: three verses, prose and footnotes, all present and in order. The OCR keeps misreading the same ligatures: दृ as हृ (so दृश्य becomes हृदय and दृष्टि becomes हृष्टि), न्त्र as ग्न (मन्त्र to मग्न, तन्त्र to तन्न |
| Brahmasutrabhasyam (vol. 3) `6af635921046991b051704ab` | 600 | random | isolated wrong characters | 2 / 0 / 0 (24) | yes, 3 crops | Brahmasūtrabhāṣya page 564 with the Candrikā and Prakāśa commentaries. A near-perfect read: both commentary blocks and the verse are complete. There are two isolated character slips, one of them a faint visarga. |
| Iavasyopanisad `6af636c51046991b051788e9` | 9 | random | wrong/missing word or line | 11 / 6 / 0 (33) | yes, 3 crops | First page of the Īśāvāsyopaniṣad with Nārāyaṇa's Prakāśikā. The structure is complete and in order. In the smaller commentary type several words are replaced: भ्राम्यतः becomes आभ्यतः twice, भ्रमस्वरूपम् becomes भ्रमत्परतन्त्रम् and ग्रहणम् becomes अहं जगम्.  |
| Mulakalpa (vol. 3) `6af6380d1046991b0517f962` | 34 | random | wrong/missing word or line | 18 / 2 / 0 (29) | yes, 3 crops | A Mūlakalpa (Mañjuśrīmūlakalpa) chapter page. Every line is present. The page number reads ५६१ (the leaf looks like ५६२). There are many character errors: मु read as ग्रु, द्विप read as द्विष, an extra च्छ, the faded आर्यमञ्जुश्रियमूलमन्त्रं read as अयिमञ्जुश् |
| Purusharthacintamanih `6af639131046991b051860c1` | 1 | random | wrong/missing word or line | 5 / 2 / 0 (5) | yes, 3 crops | Printed cover of Ānandāśrama series no. 55, the Puruṣārthacintāmaṇi. The title is correct. The series line has ग्र read as प्र and the author line has भट्ट read as मद्. The worn price line at the foot is garbled into different words. The barcode label is right |
| Taittiryopaniadbhyam `6af63abd1046991b0518f449` | 314 | random | isolated wrong characters | 2 / 0 / 0 (29) | yes, 3 crops | Taittirīyopaniṣadbhāṣya page 214: the bhāṣya above the rule and the commentary below. Clean apart from प्न read as प्र, twice. The footnote mark after न; is dropped. |
| Vkyavritti `6af63ce31046991b0519dcb1` | 31 | random | isolated wrong characters | 6 / 0 / 0 (32) | yes, 3 crops | Vākyavṛtti page 23: verses 29 and 30 with commentary, complete and in order. There are a few isolated conjunct and character slips: ह्र read as ह्ल twice, घ read as व, रा read as ग्रा, and र read as ग्र in तद्रहित. |
| vlayanagrahyastram `6af63daa1046991b051a1d00` | 301 | random | wrong/missing word or line | 22 / 3 / 0 (26) | yes, 4 crops | Vaikhānasa-gṛhyasūtra book 3, page 261 (cremation rite). All lines are present and in order. The worn type gives a high density of conjunct errors: जुहु read as जुडु, क्षिप्त as चिप्त, अनवेक्षमाणो as अनवेच्छमाणो, श्लक्ष्णं as श्वक्षा and स्थापयित्वा as स्रापयि |
| Iavasyopanisad `6af636c51046991b051788e9` | 41 | hard | isolated wrong characters | 9 / 0 / 0 (34) | yes, 4 crops | Īśāvāsyopaniṣad page 11: the Prakāśikā plus a footnote block. Both blocks are complete and in reading order. The OCR inserts a blank line between every line of the text, which is layout only. The errors are isolated character slips (ग्न read as ग्र, ग्र read a |
| vlayanagrahyastram `6af63daa1046991b051a1d00` | 28 | hard | wrong/missing word or line | 10 / 1 / 0 (52) | yes, 4 crops | Two-column table of contents (page [16]) of the Vaikhānasa-gṛhyasūtra. The columns are read in the right order (left then right), with no interleaving and nothing dropped. The errors are ordinal endings ी read as ौ (षष्ठौ, सप्तमौ, अष्टमौ), स्वप्न read as स्त्र |
| Atharvavediya Dantyosthavidhih `6af635211046991b0516d075` | 20 | random | isolated wrong characters | 7 / 0 / 0 (26) | yes, 4 crops | Dantyoṣṭhavidhi p.2: Sanskrit verses with Hindi commentary and footnotes. All text present and in order; a few dropped anusvāras/conjunct parts (हमनें→हमने), and the four superscript footnote markers (2-5) in the verses are dropped (counted in wrong_chars). |
| Br̥hannighaṇṭuratnākara (vol. vol. 4) `6af635d81046991b05172ec4` | 1 | random | wrong/missing word or line | 0 / 0 / 3 (3) | yes, 1 crops | Cloth cover with a small printed label. The three label lines are read exactly right but the whole block is duplicated in the OCR (3 extra lines). |
| Kalavivekah `6af636f11046991b05179cf7` | 537 | random | wrong/missing word or line | 7 / 2 / 0 (23) | yes, 4 crops | Kālaviveka p.443, verse quotations with prose and six footnotes. Two words garbled, उपोष्या→उपोष्णा, and the in-text footnote signs are mostly dropped or turned into ॥/ऽ (‡→॥, §→ऽऽं); footnotes themselves are read correctly. |
| Nyayabinduprakaranam `6af638591046991b05181705` | 53 | random | wrong/missing word or line | 16 / 12 / 0 (21) | yes, 6 crops | Nyāyabindu-ṭīkā p.20 (logic). Layout and order fine, but the key term हेतु is read as केतु every time (6x), हि→किं, ग्रहण→ग्रक्षण, and every avagraha ऽ is output as अ (~11x, counted as chars); verse number ९→१. Usable only by a reader who knows the text; borde |
| Rukmini kalyanam. With an English intr `6af639711046991b05187dfd` | 139 | random | isolated wrong characters | 6 / 0 / 0 (20) | yes, 3 crops | Rukmiṇīkalyāṇa canto 7, verses 27-31. All lines present; a few character slips, page number ११७→१९७, and a stray ॥ picked up from show-through at the start of line 2. |
| Upadeamtam `6af63c431046991b05199efc` | 47 | random | wrong/missing word or line | 3 / 3 / 0 (29) | yes, 3 crops | Upadeśāmṛta p.31: Sanskrit ślokas with Hindi gloss. Clean apart from the old-style अ read as ग्रा in two verses, क्रोधाग्नि→कोषाग्नि, किं→कि, and two verse numbers shifted (३७→३८, ३८→३९). |
| Vyavahra-blabha (vol. 1) `6af63d011046991b0519ec6b` | 75 | random | isolated wrong characters | 3 / 0 / 0 (27) | yes, 5 crops | Vedāntadarśana commentary 1.2.15-16, dense prose. Very good read: three slips (one conjunct, two dropped rephas), avagrahas all kept. |
| Abhidhnarjendra : koa (vol. 5) `6af634152a3ff91f6674a054` | 551 | hard | wrong/missing word or line | 8 / 2 / 0 (16) | yes, 5 crops | Abhidhānarājendra p.434, two dense columns. Proofread the first 16 lines of the left column; checked structure of both: columns kept separate and in order, nothing dropped. Recurring loss of the second ऽ in ऽऽ, a few garbled words on worn type (also नास्त्येवै |
| Mulakalpa (vol. 3) `6af6380d1046991b0517f962` | 167 | hard | wrong/missing word or line | 10 / 2 / 0 (28) | yes, 4 crops | Mañjuśrīmūlakalpa p.666, ritual prose. All lines present including the faded bottom; scattered character errors (चिन्तामणि→चिन्तागणि, वृद्धि→दृढि, जीवापयति→जीवाप्यति) and a couple of wrong words in the faded lines (कर्मकारेण→कर्मकाली). No invented text: the fa |
| nandalahar `6af63d741046991b051a10a7` | 122 | hard | isolated wrong characters | 3 / 0 / 0 (23) | yes, 5 crops | Ānandalaharī commentary p.100. Excellent read; the characters clipped at the gutter edge are completed sensibly (ब्रह्मवि-, आकाशादेव, शिव-), which is a mild reconstruction but not invention. One printer's misprint silently corrected, ळ→ल. |

</details>

### The rejects (every image opened)
- **`not_devanagari`, 14 pages: 13 right, 1 wrong.** Covers, barcodes, Google boilerplate, an English imprint and a
  bilingual title page. The wrong one is the Vākyavṛtti wrapper (`6af63ce31046991b0519dcb1` p.1): it is Devanagari,
  but the read is "UNIVERSITY OF TORONTO" six times.
- **Invented text on a rejected page:** Atharvavedīya Dantyoṣṭhavidhi p.16 (`6af635211046991b0516d075`, page id in the
  lane ledger) is a blank verso with faint show-through, read as fluent English prose that is not on it ("The County
  of Charles … Connecticut Region", repeated). The script gate caught it, the blank-page check did not. Not written.
- **Refused books, 7: 5 right, 2 wrong.** All 7 are print.
  - Wrong: Abhidhānarājendra vol. 4 (`6af634bf1046991b0516a67d`). Every text leaf is scanned upside down, and the
    read is Ethiopic/Latin/Hebrew garbage. Refusing it was the right outcome, but it needs rotating, not another
    route.
  - Wrong: Bibliotheca Buddhica (Śikṣāsamuccaya, `6af635581046991b0516ebf3`). The Devanagari main text reads well;
    long English footnotes push the share under 50%.
  - Right: Makowski's Pañcatantra (German), the Gheraṇḍa Saṃhitā (English), Ballantyne's Sāṅkhya (English
    commentary), Garbe's Sāṃkhya-pravacana-bhāṣya (Roman only), Böhtlingk's Chāndogya (German after the text). Their
    Devanagari pages read cleanly and are lost by refusing the whole book.
- **Textless, 20: all right.** These are blank leaves, covers and mirror-image show-through.

### Not measured
- Per-character CER against a reference. These are counts by eye, over stretches of 3–52 lines.
- Whether an agy correction pass on top fixes the glyph confusions. That is the obvious next arm and is out of scope
  here: no Gemini this week.
