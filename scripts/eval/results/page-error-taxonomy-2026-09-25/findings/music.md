# music — by-eye findings
Books read: 6 of 6. Images opened: 12 of 12 (none skipped, no crops).

Stratum note: only 2 of the 12 leaves carry staff notation (Kepler p119, Day image 87 = printed p.63; Day image 88 = p.64 also has one). No leaf carries tablature or underlaid lyrics, so "lyrics in singing order" could not be tested anywhere in this sample. The "music" label mostly picks up music *theory* (tuning maths, consonance ratios) and even astrology (Welling) and a Psalm commentary (Flaminio).

## Book 1: Yuelü Quanshu 樂律全書 (Chinese, 1596) — pages 124/125 — https://sourcelibrary.org/book/complete-works-on-music-and-tuning-vol-1/page/69c6613601a26ccff09f4f42
Image 124: Siku Quanshu block-print half-leaf. Title 密率源流 across the top, a circle with an inscribed square and diagonals carrying vertical annotations, 5 columns of large text below, blockhead 欽定四庫全書 in the right margin. No staff notation [image]
Image 125: 8 vertical columns of large characters listing pitch ratios for 黃鍾/大呂/太簇/夾鍾. Double-column small-character notes after the title and after 二十兆. Folio 十一 and 樂律全書 on the fold. No notation [image]
Defects:
- wrong character, changes meaning · lane: ocr · on-page · page 124 · evidence: [ocr↔image] · The image has 㮚氏為量 (the Kaogong ji artisan 栗/㮚氏, "Li clan"); OCR has 巢氏. Translation: "The Chao clan <note>a lineage of ancient artisans</note>". That is a wrong proper name plus an invented gloss to support it · severity: high
- NEW: arithmetically-impossible annotation · lane: ocr · on-page · 124 · evidence: [ocr↔image] · OCR has diagonal label "東南至西北有四寸八分", and the translation renders "four inches and eight fen". The diagonal of a 10-cun square is about 14.1 cun, and the diagonal text on the image reads with 一/四/一 strokes (…有一尺四寸一分…?). This is a likely misread, which I could not fully resolve at this resolution · severity: medium
- meta/continuity note leaked as content · lane: translation · cross-page · 124 · evidence: [tr] · The translation opens `<meta>continues from previous page: the calculations for the Yingzhong pitch…</meta>`, which is an assertion about another page that nothing on this leaf supports · severity: low
- invented image element · lane: ocr→translation · on-page · 125 · evidence: [ocr↔image] · OCR `<image-desc>Printer's mark or seal at the bottom left corner</image-desc>`, and the translation repeats it as a note. The image has no seal. The dark block is the fishtail (魚尾) on the fold · severity: low
- interlinear note dropped · lane: ocr · on-page · 125 · evidence: [ocr↔image] · The small double-column note after 黃鍾之率二十兆 (本是二十寸命作二十兆, "originally 20 cun, named 20 zhao") is missing from OCR and from the translation. The other note (倍律命寸為兆…) is kept as `<margin>` · severity: medium
- digit misread in a number table · lane: ocr · on-page · 125 · evidence: [ocr↔image] · 太簇: image 十七兆八千**一**百七十九萬…八百六十〇; OCR 八千**七**百七十九萬 … 八百六十 (一→七, and the trailing 〇 is dropped). Both change the value · severity: high (for a tuning table the numbers are the content)
- NEW: number-unit mistranslation (萬/億 system) · lane: translation · on-page · 125 · evidence: [tr↔ocr] · Every 萬 and 億 is rendered as "hundred million": "eighteen trillion, eight thousand seven hundred seventy-four hundred million, eight thousand six hundred twenty-five hundred million, three thousand…". The English numbers are meaningless and cannot be converted back to the source value · severity: high
- running head/folio dropped · lane: ocr · on-page · 125 · evidence: [ocr↔image] · 欽定四庫全書, 樂律全書 and folio 十一 are not recorded (page 124 kept `<header>`) · severity: low
Cross-page break: 124 ends with the cross-reference to 卷十 嘉量篇, and 125 opens a new heading 新造密率二種. There is no running sentence and the join is correct [tr↔image].

## Book 2: Musurgia universalis II — Kircher (Latin, 1650) — pages 224/225 — https://sourcelibrary.org/book/universal-musical-work-volume-ii-musurgia-universalis-kircher/page/69520517ab34727b1f04253b
Image 224: dense single-column roman Latin, 2 side-notes on the outer margin, running head "Lib. XI. Magia Consoni, & Dissoni:", p.209, sig "Dd", catchword "Expe-". A strip of the facing page shows at the left edge [image]
Image 225: p.210, "Experimentum I.", side-notes left, a string diagram (8 horizontal lines lettered A E D C B A G F, "Nete"/"Hypate" at the right), catchword "CA-". No staff notation [image]
Defects:
- header number misread · lane: ocr · on-page · 224 · evidence: [ocr↔image] · The image has "Lib. XI."; OCR has "Lib. X.". The translation heading reads "# Book X. The Magic of Consonance and Dissonance", so the book number is wrong and a running head has been promoted to an H1 · severity: medium
- NEW: fabricated technical gloss · lane: translation · on-page · 224 · evidence: [tr↔ocr] · The Latin describes the smaller string skipping 3 sounds and uniting on the 4th vibration (a 4:3 ratio, the fourth). The `<meta>` says the passage "concludes the discussion of the Diapente (perfect fifth)", and the inserted note says "In a perfect fifth (ratio 3:2)…" · severity: medium
- minor letter misreads · lane: ocr · 224 · [ocr↔image] · "tribus tonis omissis" (image) vs "tribus ſonis" (OCR); "perfecta" (image) vs "perfectæ" (OCR); "ſimpliciun". Meaning is roughly preserved · severity: low
- margin notes relocated / paragraph break invented · lane: ocr · 224 · [ocr↔image] · Both side-notes are placed together before "Quod si". On the image they stand beside "Hinc consonantia" and "In quatuor". OCR also starts a new paragraph at "In quatuor", which on the image runs on mid-line · severity: low
- catchword translated as a word · lane: translation · cross-page · 224 · [tr↔image] · "Expe-" → "catchword: Experiments-" · severity: low
- raw centring markup · lane: display · 225 · [tr] · `->*Nete.*<-` is shown literally in the translation · severity: low
- speculative catchword gloss · lane: translation · 225 · [tr] · "CA- (likely "CAUSA"…)". This is a guess about the next page, delivered as content · severity: low
Otherwise the OCR of 225 matches the image closely, and the diagram description is accurate (labels, Nete/Hypate) [ocr↔image].
Cross-page break: 224 ends "…quod sequentibus experimentis manifestum facio" (catchword Expe-), and 225 opens "Experimentum I." The join is correct [tr↔image].

## Book 3: Harmonices Mundi — Kepler (Latin, 1619) — pages 119/120 — https://sourcelibrary.org/book/harmonices-mundi-1619-first-edition-kepler/page/695004e6f426a210d109a5ed
Image 119: p.36 "De Proportionibus". Prose on top, then a 5-line staff with an F-type clef and a row of diamond notes carrying sharps and flats, with string-length numbers 60.72.75.80.90.96.100.120 under it. Beside it a bracketed fraction table ("Nam De 120. pars … est"), a monochord line diagram, and a small ratio table at the foot. Side-note "Quod componitur…". Catchword "His". Heavy show-through from the verso [image]
Image 120: p.37 "Harmonicis Lib. III.", section heading "Corollarium arithmeticum", a bracketed number diagram (1–10 with squares and products), heading "Ordo concinnorum…", signature E 3, catchword "propter" [image]
Defects:
- notation described, not transcribed; accidentals lost · lane: ocr · on-page · 119 · evidence: [ocr↔image] · The staff is summarised as "a five-line musical staff with eight diamond-shaped notes". The clef, the sharps and flats (clearly printed before several notes) and the pitches are not recorded, so the reader cannot recover which pitches Kepler sets against 60…120. The translation copies the same description. Nothing is invented, but the notation is not captured · severity: medium
- abbreviation expanded + word dropped · lane: ocr · 119 · [ocr↔image] · The image caption reads "Hic igr est ortus intervallorum Concinnorum dissonorum". The OCR puts it only inside the image-desc as "Hic igitur ortus…", so "est" is dropped and "igr" is silently expanded · severity: low
- mistranslated relative · lane: translation · 119 · [tr↔ocr] · The margin "Quod componitur ex 24.25. & 80.81." ("Which is composed of…", referring to 128/135) is rendered "Because it is composed of…" · severity: low
- fabricated technical gloss · lane: translation · 119/120 · [tr↔ocr] · 119 note: 24/25 is "Known as the 'Diesis' or 'Scharfe'". 120 note: 128:135 is "The 'diesis' or small interval". The two notes contradict each other, and 128:135 is Kepler's limma, not a diesis. "Scharfe" is unsupported · severity: medium
- running title split across the opening rendered as headings + raw tags · lane: display/translation · 119/120 · [tr↔image] · The running head reads across the opening as "DE PROPORTIONIBUS | HARMONICIS LIB. III.". The translation of 119 emits `<page-num>36</page-num>`, then "# ON PROPORTIONS", then `<header>ON PROPORTIONS</header>` (the same head twice, once as H1). The translation of 120 emits "BOOK III ON HARMONICS" as a separate title. Raw `<page-num>` and `<header>` tags appear in the translation body · severity: low
- catchword translated · lane: translation · 120 · [tr] · "catchword: because (propter)" · severity: low
The OCR of 120 prose is faithful to the image, and the number diagram description matches (squares 4,9,16…81; products 3,8,15…80) [ocr↔image].
Cross-page break: 119 ends with the table and catchword "His", and 120 begins "His addi potest…". The join is correct, with no repetition [tr↔image].

## Book 4: Music and Musical Instruments of Southern India — C.R. Day (English, 1891) — pages 87/88 — https://sourcelibrary.org/book/the-music-and-musical-instruments-of-southern-india-and-the-day/page/69ef2b7985daccce30f2e867
Image 87: printed **p.63**: "with a major seventh… Nihad Bey… Bourgault-Ducoudray… Chopin… endings of the following nature—", a one-staff treble-clef music example with a mordent sign and a sharp, footnote 6 [image]
Image 88: printed **p.64**: Willard's 4 numbered observations, time signatures, a second one-staff example (slurred run to a whole note), the Da capo paragraph [image]
Defects:
- NEW: image/text offset by one leaf (text lags image) · lane: image↔ocr · on-page, both pages · 87 and 88 · evidence: [ocr↔image] · The OCR/translation for record 87 is printed p.62 ("note in the middle of a roulade…", `<page-num>62`), but the image is p.63. The OCR for record 88 is p.63 (`<page-num>63`), which is exactly the text of image 87, but its image is p.64. The reader sees a picture that never matches the text beside it, and the p.64 text (Willard's four rules) is presumably on record 89. The OCR's own `<page-num>` gives this away against the printed folio · severity: high
- notation described, then replaced by a placeholder · lane: ocr/translation · on-page · 88 (text of image 87) · [ocr↔image] · OCR: "dotted eighth note G with a mordent, followed by a sixteenth note F, an eighth note E, and a final half note D". The image shows a sharp in the second bar that the description omits, and the pitch names cannot be confirmed at this resolution. The translation drops even that and prints "[Diagram showing a musical cadence.]". The musical content is lost for the reader · severity: medium
- same on record 87 (p.62 text, rhythmic-motive example): the translation reads "[Diagram showing rhythmic motive…]", with bracketed placeholder text shown as prose · lane: translation/display · [tr] · severity: low
- diacritic normalisation · lane: ocr · 88 · [ocr↔image] · The image has "Tâla" and "Mâyamâlavagaula", but OCR has "Tála" and "Máyamálavagaula" (circumflex → acute) · severity: low
Cross-page break: the text of p.62 ends "…and a minor sixth", and record 88 opens "with a major seventh". The TEXT join is correct, but on each record the image is the following page [tr↔image].

## Book 5: Flaminio, In librum Psalmorum explanatio (Latin, 1545) — pages 185/186 — https://sourcelibrary.org/book/m-antonii-flaminii-in-librum-psalmorum-breuis-explanatio-ad-/page/6a08551415c643eb1af54bd0
Image 185: italic Latin commentary, p.87, "IN LIB. PSALMORVM.", heading "EXPLANATIO.", lemmata closed with "]", last line breaks "lon=", "Digitized by Google" [image]
Image 186: italic, head "EXPLANATIO", starts "ge superantia", ends "qui stul=". No notation on either leaf (Ps. 45/46 "Alamoth" commentary) [image]
Defects:
- continuity lookahead (translation completes next page's sentence) · lane: translation · cross-page · 185 · evidence: [tr↔image] · The image and OCR stop at "omnem naturae uim lon-". The translation continues "…transcending all the power of nature are the deeds which God brought forth, while he makes rude and unlearned men overcome philosophers… and mortals overcome the Devil and his immortal satellites", which is the whole first sentence of 186. The 186 translation then omits it. Net effect: text sits on the wrong page · severity: medium
- continuity lookahead into page 187 (possible fabrication) · lane: translation · cross-page · 186 · [tr↔image] · The image ends "…eos intelligi uolo, qui stul=". The translation adds "who, inflated by foolish opinions, trust that true wisdom and true justice can be obtained by human labor and industry". None of this is on the leaf. It is either leaked from p.187 or invented, and I cannot tell which without p.187 · severity: medium
- silent abbreviation expansion · lane: ocr · 186 · [ocr↔image] · The image has "eaq;" and OCR has "eaque". The meaning is preserved · severity: low
- inconsistent lemma markup · lane: display · 185 vs 186 · [ocr] · The lemmata are `*Pro iuuenculis* ]` on 185 and `> Auferens bella… ]` (blockquote) on 186, so the same structure renders two ways · severity: low
OCR otherwise matches both images line for line [ocr↔image].
Cross-page break: this join is wrong. N's translation swallows the first sentence of N+1, and N+1 overruns into N+2 [tr↔image].

## Book 6: Opus Mago-Cabbalisticum — Welling (German, 1735) — pages 434/435 — https://sourcelibrary.org/book/opus-mago-cabbalisticum-et-theosophicum-1735-edition-welling/page/6991d64b8c1030b12444ab82
Image 434: Fraktur with Antiqua Latin terms, p.398 "Das Vierdte Capitel", astrological significator list with planet/sign glyphs, section "8.) Von den Planeten im I. Hauß", catchword "§. 19." [image]
Image 435: p.399, §.19 intro with the Air glyph (△ with bar), a 4-column ruled table (☌ | Lufft | Geburthen | Leben) with rows ♄♃, ♄♂, ♄☉; bold notes span columns 2–3; signature "h 2" at the foot. "Music" appears only as a word [image]
Defects:
- Fraktur misread changes meaning · lane: ocr→translation · on-page · 434 · evidence: [ocr↔image] · The image has "Stammler, Kupler" (Kuppler = procurers). OCR has "Kupfer", and the translation gives "counterfeiters" with a note inventing a rationale ("those who deal in base metals or counterfeit coins") · severity: high
- zodiac glyphs misread · lane: ocr · 434 · [ocr↔image] · The image line reads "♄ oder ♂ im I. in ♋. ♌. ♏ oder ♑", but OCR has "♋. ♌. ♓ oder ♍" and the translation "Pisces or Virgo". Two of the four signs are wrong · severity: medium
- glyph dropped, translator invents a reading · lane: ocr→translation · 434 · [ocr↔image] · The image has "♀ Im ersten Hauß in ☌ ♃. ♌. oder ☾." (in conjunction with Jupiter, Leo, or Moon). OCR drops ☌, and the translation invents "in ♃ <note>Jupiter's sign, likely Sagittarius or Pisces</note>" · severity: medium
- LaTeX leaked · lane: display · 434 · [tr] · The translation shows "sextile ($\ast$)" literally · severity: low
- NEW: symbol-as-image-desc hole · lane: ocr→translation/display · 435 · [ocr↔image] · The Air glyph is OCR'd as an inline `<image-desc>`. The translation reads "in the change of the <note>An alchemical symbol…</note>, as well as…", so the noun "air" is missing from the running sentence · severity: medium
- spanning table rows forced into one cell · lane: ocr · 435 · [ocr↔image] · The bold rows "Taugt nicht zum Aderlassen und Arzneyen", "Schädlich dem Aderlassen…" and "Erregt die schwarze Galle…" span the Geburthen AND Leben columns on the image. OCR puts them in the Geburthen cell only, and `->…<-` and `<br/>` then render raw inside the markdown table · severity: low
- minor misreads · lane: ocr · 435 · [ocr↔image] · The image has "lüfftigen Zeichen" (airy), but OCR has "lüstigen" (lustful). The translation correctly guesses "airy" but cites the misread as "original". The image also has "darinnen die ☌ geschicht", but OCR has "sie" · severity: low
- signature rendered as body text · lane: translation · 435 · [tr↔image] · "h 2" (a foot signature) appears at the top of the translation as a line of text · severity: low
- wrong continuity meta · lane: translation · 435 · [tr] · "transitions from… Venus and Mercury". The previous page actually ends on the planets in the First House · severity: low
Cross-page break: 434 ends "…nicht mit beybringen wollen." plus catchword "§. 19.", and 435 opens "§. 19. Schreiten also…". The join is correct, though the catchword also shows in the 434 translation, so a straight-through reader sees "§. 19." twice [tr↔image].

## Summary
Defects by class (name: pages affected):
- misread changing meaning (character/glyph/digit/Fraktur): 5 (Zhu 124, 125; Welling 434 ×3 instances; Kircher 224 header)
- notation described not transcribed / placeholder: 3 (Kepler 119; Day records 87, 88)
- image/text offset by one leaf: 2 (Day 87, 88)
- continuity lookahead (translation finishes next page's sentence): 2 (Flaminio 185, 186)
- fabricated or wrong translator note/gloss: 5 (124 "Chao clan", 224 fifth, 119/120 diesis, 434 Kupfer, 434 Jupiter sign)
- meta/continuity notes wrong or leaked: 3 (124, 224, 435)
- running head misread / promoted to H1 / duplicated: 3 (224, 119, 120)
- dropped interlinear note / folio: 1 (125)
- invented image element: 1 (125 seal)
- catchword/signature translated or rendered as text: 4 (224, 225, 120, 435)
- raw markup in translation (->…<-, <page-num>, $\ast$, <br/>): 4 (225, 119, 434, 435)
- table spanning cells lost: 1 (435)
- silent abbreviation expansion: 2 (119 igr, 186 eaq;)
- margin-note relocation / invented paragraph break: 1 (224)
- number-unit mistranslation: 1 (125)
Counts: 36 on-page defect lines, 5 cross-page (124 meta, 224 catchword, 185/186 lookahead, Day offset).
NEW classes proposed:
- image/text offset by one leaf: the page's text is the previous printed page. The OCR's own <page-num> disagrees with the page number on the image, which makes this cheaply detectable.
- number-unit mistranslation: the Chinese 萬/億/兆 place-value system is rendered with wrong English units, so the numbers become unrecoverable.
- symbol-as-image-desc hole: an inline glyph (alchemical Air) becomes an <image-desc>, and the translated sentence loses its noun.
- fabricated technical gloss: a translator note asserts a wrong interval/ratio name, or invents a rationale for an OCR misread (Kupfer → "counterfeiters", 巢氏 → "lineage of ancient artisans").
- arithmetically-impossible annotation: a diagram label that contradicts the geometry it labels, which signals a misread.
Surprises: (1) the "music" stratum has almost no actual notation, zero lyrics and zero tablature, so the questions it was built to test mostly cannot be tested with this sample. Where notation exists it is always described in prose, never encoded, and accidentals are dropped. (2) The Day offset is silent and every OCR <page-num> could be checked against the image. (3) Translators confidently paper over OCR misreads with invented explanatory notes, which makes an OCR error look authoritative.
