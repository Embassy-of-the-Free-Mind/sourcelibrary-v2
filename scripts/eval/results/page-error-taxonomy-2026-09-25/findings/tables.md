# tables — by-eye findings
Books read: 6 of 6. Images opened: 11 of 12, plus 1 crop. Book 2's pages 57 and 58 point to the SAME image file (identical md5, same upload URL), so I opened it once and cropped the p.27 variant list.

## Book 1: Cornucopiae linguae latinae, Perotti (Latin, 1494) — pages 158/159 — https://sourcelibrary.org/book/cornucopiae-linguae-latinae-ed-pyrrhus-perottus-rev-ludovicu-perottus-1/page/69dbcb161040d1d5e20b1d9a
Image 158: incunable roman type, one dense text block, marginal keyword index down the LEFT edge (Pellio, Pellicula … Misericordia, ~60 entries), running head "Epigramma", no printed folio (the "LIX" at top is bleed-through from the recto) [image]
Image 159: the same layout with the keyword index down the RIGHT edge (Miseratio … Stadiũ), head "SECVNDVM", folio "LX", signature "k iiii" at foot [image]
Defects:
- NEW: marginal keyword index turned into a table (false table) · lane: ocr · on-page · page 158 · evidence: [ocr↔image] · The margin index and the body are forced into a 2-column markdown table that pairs each keyword with one body line (`| Pellis Aluta | Ab aluta Alutame tu ueteres dixere…|`). The body is shredded into 66 table rows, and the keyword–line pairing is an artefact of line height, not structure. The translation keeps the table but puts whole paragraphs into three rows, so the keyword column no longer lines up with anything. The third row holds ~5,000 characters of translation in one cell next to "Pelliceum". · severity: medium (the text is recoverable, the layout is unreadable)
- duplicated line + dropped line · lane: ocr · on-page · page 158 · evidence: [ocr↔image] · The body line "posita fiunt Circũtego hoc est circũcirca operio. A quo circunctectũ amictus genus: quod circũ" is missing. In its place, the next line `Protego: quod est foueo: tueor: Vnde Protector: & Protectio deducuntur: & Detego` appears TWICE (rows "Textura" and "Texim"). · severity: medium
- misread headword · lane: ocr→translation · page 158 · [ocr↔image] · The image has "Versipellis" (turncoat). OCR has `Verripellis` in both margin and body, and the translation glosses it as the non-word "verripellis". · severity: medium
- NEW: page number read from bleed-through · lane: ocr · page 158 · [ocr↔image] · `<page-num>XLI</page-num>` — the page has no folio. The reversed show-through of the recto's "LIX" was read backwards as "XLI". · low
- Greek garbled · lane: ocr · page 158 · [ocr↔image] · The printed Greek word for skin (κόλιον / "Ko λιων" in the image) becomes `ko 2 iwy`. The translation leaves it out. · low
- NEW: degenerate table (keyword duplicated in both cells) · lane: ocr/display · on-page · page 159 · evidence: [ocr↔image] · The right-margin index is emitted as `| Miseratio | Miseratio |`, `| Thermae agrip | Thermae agrip |`, `| pianae | pianae |` … (~60 rows), with each keyword doubled and wrapped halves as separate rows. Several keywords are wrong or missing: `Miserer` for "Miseriter", `Thermas` for "Thermæ", and "Miserator", "Miseretur", "Eleothesium" and "Palæstra" are absent. · severity: low–medium (a 60-row junk table on screen)
- NEGATION LOST AT THE BREAK · lane: ocr→translation · cross-page · break 158→159 · evidence: [ocr↔image] · The last line of 158 reads "…aut alterius scelerati supplicio susceptus: molicies quædam animi: nõ | misericordia est" (pain at a criminal's punishment is a certain softness of mind, NOT mercy). OCR ends `…animi: na`, the translation writes "…is a certain softness of mind, for…", and 159 begins "Mercy is." The meaning is inverted. · severity: HIGH
Cross-page break: 158's translation ends "a certain softness of mind, for..." and 159's begins "Misericordia is." The word is not doubled, but the negation "nõ" is lost, reversing Perotti's point [tr↔image].

## Book 2: Aelia Laelia Crispis non nata resurgens, Malvasia (Latin, 1683) — pages 57/58 — https://sourcelibrary.org/book/aelia-laelia-crispis-not-born-rising-again-malvasia/page/6973312fd4e1ef1b55380016
Image 57 (= 58): an UNSPLIT SPREAD of printed pp.26–27. It holds two-column name lists under headings D M / Retinent / Omittunt / Immutant / ÆLIA LÆLIA CRISPIS / NEC VIR NEC MVLIER NEC ANDROGYNA, with small italic notes giving each author's variant spelling. Catchwords "DRAV-" (p.26) and "FER-" (p.27) [image]
Defects:
- spread not split, one image serving two page records · lane: image · on-page · pages 57, 58 · [image] · Both pages carry the identical upload URL, and each OCR transcribed only "its" half. It works, but every reader view shows the wrong half as well. · low
- NEW: variant-spelling data normalised away (the table's content is the orthography) · lane: ocr→translation · on-page · page 58 · evidence: [ocr↔image, crop] · The p.27 "Immutant" list exists to record how each author spelled the name: ligature Æ vs divided AE vs dropped diphthong. OCR flattens or alters most of them:
  - Castellinius: image "ELIA LÆLIA", OCR `ELIA LAELIA`.
  - Kircherus: image "ÆLIA LÆLIA RISPIS" (printed sic), OCR `AELIA LAELIA CRISPIS` (ligature lost and the typo silently corrected).
  - Nicolius: image "AELIA LELIA", OCR `AELIA LAELIA` (a different variant).
  - Gherardaccius: image "HELIA LÆLIA", OCR `HELIA LELIA` (a different variant).
  - Montalbanus: image "ÆLIA LELIA", OCR `AELIA LELIA`.
  - Verani: the note says "divided in the first diphthong, joined in the second": image "AELIA LÆLIA", OCR `AELIA LAELIA`, which erases exactly the distinction the note describes.
  The translation copies all of these, so the page's bibliographic evidence is wrong in 6 of 8 entries. · severity: HIGH
- raw HTML entity · lane: display · page 58 · [ocr] · `Non nata Resurgens &amp;c.` and `&amp;` inside a gloss. If shown in the OCR view, the reader sees "&amp;". · low
- notes carried as `<gloss>` inside table cells · lane: display · pages 57, 58 · [ocr], [tr] · The author's printed notes ("IOANNES HENRICVS In Mercurio Italico…", "Harum vice apponentes…") are wrapped in `<gloss>` inside markdown cells. They are source text, not glosses, so they may be styled as editorial. The translation also nests `<note>` inside `<gloss>` (Remigius). · low
- metadata meta duplicated · lane: translation/display · pages 57, 58 · [tr] · Both translations open with the same `<meta>Continuing from page 25/26…</meta>` boilerplate. · low
Table structure otherwise: the two-column name lists are transcribed correctly and completely, the markdown tables are well-formed and would render, and names are modernised in the translation (TVRRIVS → DELLA TORRE, NIGER → NERI) [ocr↔image], [tr↔ocr].
Cross-page break: the "ÆLIA LÆLIA CRISPIS — Retinent" list starts at the foot of p.26 (VITVS | TVRRIVS) and continues at the top of p.27. The translation keeps it as a continuation, but p.27 has no heading to say so. The catchword "DRAV-" is recorded only in `<meta>` [tr↔image].

## Book 3: Institutiones linguae Syriacae, Canini (Latin with Aramaic in Hebrew square script, 1554) — pages 87/88 — https://sourcelibrary.org/book/institutiones-linguae-syriacae-assyriacae-atque-thalmudicae-estienne/page/69b2f3d7a9a500a45e5e8d9d
Image 87: printed p.85, sig. L.ii. It has a paradigm table of Aramaic ordinals (label fœ./masc. then four forms: Sing. Abs/Emph, Plur. Abs/Emph), a second table of gentilics, then prose "De Regimine". Water stain at left, faint brown-ink handwritten notes [image]
Image 88: printed "84" (a printer's misnumbering; the text follows p.85 correctly). Prose with Aramaic, Greek and Italian, a handwritten brown-ink marginal note, and a small suffix table (Masculina / Fœminina / Communia / In Thalmud pro / dicitur) [image]
Defects:
- NEW: paradigm table cells scrambled and forms rewritten · lane: ocr → translation · on-page · page 87 · evidence: [ocr↔image] · The printed gentilic row reads masc. יְהוּדִי | יְהוּדָאָה | יְהוּדָאִין | יְהוּדָיֵא (abs sg, emph sg, abs pl, emph pl). OCR gives `יְהוּדָיָא | יְהוּדָי | יְהוּדָיֵא | יְהוּדָיִין`: columns swapped, and the book's אָה/אִין spellings replaced by textbook ־יָא/־יִין forms. The ordinal rows show the same thing. Printed "fœ. קַדְמָאָה | קַדְמָיְתָא | קַדְמָיִן | קַדְמָיָתָא" becomes `קַדְמָיָא | קַדְמָאָה | קַדְמָיָתָא | קַדְמָן`. A grammar table whose forms are wrong is worse than useless, and the transliterations in the translation inherit every error. · severity: HIGH
- RTL list reversed into the wrong cells + broken markdown row · lane: ocr/translation/display · page 87 · [ocr↔image], [tr] · The printed row "maſ. חֲמִישַׁי. שְׁתִיתַי. שְׁבִיעַי. תְּמִינַי. תְּשִׁיעַי." (ordinals 5–9) is packed by OCR into 4 cells in reversed order, with 9 and 8 sharing one cell and the endings changed to ־יָ. The translation re-orders it into SIX cells in a 5-column table, so in GFM rendering the last cell ("teshi'aya", ninth) is silently dropped. · severity: medium
- NEW: false script description in meta · lane: ocr · page 87 · [ocr↔image] · `<meta>The page contains Syriac script (Estrangelo/Serto style)…`. The page has no Syriac script; all Aramaic is printed in Hebrew square letters. `<language>Latin</language>` also omits Aramaic. · low–medium
- SPLIT WORD MISJOINED AT THE BREAK · lane: ocr→translation · cross-page · break 87→88 · evidence: [ocr↔image] · p.85 ends "quæ formã fœ-" and p.84 begins "mininam habent" (which have the feminine form). OCR reads `minimam habent`, and the translation writes "have a minimum [signifier]", inventing a bracketed word. The grammatical condition of the whole rule is lost. · severity: HIGH
- NEW: illegible handwriting "read" and inserted mid-sentence · lane: ocr→translation · on-page · page 88 · evidence: [ocr↔image] · A faint brown-ink marginal note is transcribed as `<margin>ſol—dici <unclear>ſolet</unclear> as <unclear>ſtatu</unclear> uerba <unclear>quæ habet</unclear> forma…hēt d dat</margin>` and placed INSIDE the printed sentence between two examples. The translation renders it as fluent English ("it is usually said as status words that have the form of essence or hēt d dat"). This is mostly guesswork, presented as text. · severity: medium
- Greek examples dropped · lane: translation · page 88 · [tr↔image] · The printed Greek glosses "ὁ οἶκος τοῦ Δαβίδ", "οἱ μῆνες τοῦ ἐνιαυτοῦ" and "πώεα τῶν μήλων" are in the OCR but reduced to English glosses in the translation, so the trilingual comparison is lost. · low
- misread Italian example · lane: ocr · page 88 · [ocr↔image] · The image has "signorso"; OCR and the translation have `signoro`. That is the word whose suffix is being illustrated. · low–medium
Tables that are fine: the suffix table on 88 keeps rows and labels correctly and renders [ocr↔image].
Cross-page break: see the misjoin above. The printed page order 85→"84" is a printer's error, not a sequencing error [image].

## Book 4: An Egyptian Hieroglyphic Dictionary vol. 2, Budge (English, 1920) — pages 494/495 — https://sourcelibrary.org/book/an-egyptian-hieroglyphic-dictionary-vol-2-budge/page/69b52fab1a04ee0f3b4182d7
Image 494: printed p.1078, "INDEX OF ENGLISH WORDS", two columns of entries with page+column refs (e.g. "ascend, 28a, 29a…"), transliterations with Ȧ (dot) and Ā (macron) [image]
Image 495: p.1079, same layout, signature "3 Y 4" [image]
Defects:
- NEW: transliteration diacritics merged/swapped (Ȧ / Ā / A) · lane: ocr · on-page · pages 494, 495 · evidence: [ocr↔image] · Budge distinguishes A, Ȧ and Ā (different hieroglyphic signs, which is why the page refs cluster: Ā-words at 115/138/141, Ȧ-words at 81–104, A-words at 2–36).
  - 494: printed "Āsheb, Āshemeth, Āshḥeru, Āshitabu, Āshkheru, Āshtkheru, Āstȧrtȧt, Āsthȧreth" all become `Ȧ…`.
  - 495: printed "Āuāḥa, Āuai 115a, Āuait, Āun, Āun-ȧb" become `Ȧ…`. Printed "Au-āu-Uthes, Au-matu, Au-t-ā, Aut-ȧb, Athemti" GAIN a dot (`Ȧu-…`). Printed "Ȧtȧ, Ȧṭa, Ȧtar, Ȧṭau, Ȧtem" LOSE it, and "Ātcha" loses its macron.
  About 25 headwords carry the wrong letter, so an Egyptologist is sent to the wrong sign. · severity: medium (page refs unaffected)
- page references: spot-checked about 40 entries across both pages (ascend, ask, associate, assuredly, at …, attack ×30 refs, authority), and every number and a/b column letter matches the image. No index-reference errors found [ocr↔image].
- invented bold · lane: ocr/display · page 494 · [ocr↔image] · Every headword is wrapped in `**…**`, although the print is roman. The 495 OCR has no bold, so the two pages render inconsistently. · low
- English index "translated" with added glosses and `<term>` wrappers · lane: translation · pages 494, 495 · [tr↔ocr] · The translation echoes the English (correct) but adds `<gloss>a fragrant shrub</gloss>` etc. and wraps every Egyptian name in `<term>`. This is harmless if rendered as styling, and noise otherwise. · low
Column order is correct (left column fully before right) and entries are not merged across columns [ocr↔image].
Cross-page break: 494 ends with "at … at what time, 545a." and 495 starts "Ȧtȧ, god, 97a". This is a clean alphabetical continuation, with nothing doubled or dropped [tr↔image].

## Book 5: Leben Antichristi, Dionysius von Luxemburg (German, 1686) — pages 504/505 — https://sourcelibrary.org/book/leben-antichristi-luxemburg/page/69f6d3f66b3ca298d0191095
Image 504: Fraktur list of cited authorities (no page references) under letter heads L, M, N, O, P; saints outdented with "Sanct."; catchword "Qua" at foot [image]
Image 505: continues Q–T; catchword "Tho" at foot [image]
Defects:
- NEW: "Englischer Doctor" mistranslated · lane: translation · on-page · page 505 · evidence: [tr↔image] · "Sanct. Thomas Englischer Doctor" is early-modern German for Doctor Angelicus, i.e. Thomas Aquinas ("englisch" = angelic). The translation gives "Saint Thomas, English Doctor" with a note leaning to Thomas Becket, and the OCR vocab says `Thomas Becket`. The reader is misled about which authority is cited. · severity: medium
- catchword treated as body text · lane: ocr/translation · cross-page · page 504 · evidence: [ocr↔image] · The catchword "Qua" is emitted as a body line (`Qua`) and "translated" as `Qua`, while on 505 the catchword "Tho" goes into `<meta>`. The handling is inconsistent. · low
- misreads/normalisations · lane: ocr · pages 504, 505 · [ocr↔image] · `Lyramus` for printed "Lyranus", `Rabanus` for "Rabbanus", `Suarez` for "Suaretz", `Sibilla` for "Sibillä". The translation's identifications still land correctly (Nicholas of Lyra, etc.). · low
- unhedged identifications in notes · lane: translation · page 504 · [tr] · "Justinus" is annotated as "Justin Martyr", but in a list with Marco Polo, Ortelius and Quintus Curtius it is at least as likely the historian Justin (epitomator of Trogus). The notes are confident rather than hedged. · low
- empty continuity meta · lane: display · pages 504, 505 · [tr] · `<meta>continues from previous page</meta>` with no content, including on 505, which starts a fresh letter head. · low
Structure: letter heads, order and all names are present. The saint/non-saint indentation hierarchy is flattened (cosmetic). There are no page references to check [ocr↔image].
Cross-page break: 504 ends "Sanct. Prosper Bischoff zu Rhegio. / Qua" and 505 starts "Q. Quaresimus". This is correct, except the stray "Qua" line [tr↔image].

## Book 6: Alexander von Tralles, Puschmann ed. (Greek + German facing, 1878) — pages 470/471 — https://sourcelibrary.org/book/alexander-von-tralles-original-text-und-ubersetzung-vol-1-tralles/page/69b1deccca46fa60ea1ee60f
Image 470: printed p.452, German translation. "Drittes Capitel. Ueber das Schwärzen der Haare.", a recipe with a dot-leader ingredient list (3 lines: ingredient …… quantity), footnote 1 on στυπτηρία [image]
Image 471: p.453, Greek text "κεφ. γ΄. Πρὸς μέλανσιν τριχῶν.", the same recipes with a dot-leader list, Greek critical apparatus notes 1–13, and the German footnote 2 (on red wine) belonging to p.452 printed at the foot [image]
Defects:
- NEW: footnote invented because its text is on the next page · lane: translation · cross-page · page 470 · evidence: [tr↔image] · The German footnote 2 ("Der Farbe nach unterschied man weisse, gelbe und schwarze Weine…") is printed on p.453. The translation of 452 supplies its own footnote: "2) Presumed reference to red wine." That is fabricated note text. · severity: medium
- raw LaTeX / caret footnote markers · lane: display · pages 470, 471 · [ocr] · 470 uses `$^1$)` and `$^2$)`, and 471 uses `^1)` … `^13)`. Unless the reader view parses these, they show literally. The translation converts 470's markers to `<note>Footnote 1</note>` (an empty pointer). · low–medium
- apparatus variant flattened · lane: translation · page 471 · [tr↔ocr] · Note 8 records the variant χρῖσις (anointing) against χρῆσις (use). The translation "'Application' L, V" hides that the variant is a different word. Note 5's `β΄ Mf` is rendered "2 ounces Mf", which adds a unit to a numeral variant. · low
- editor's taxonomic hedges dropped · lane: translation · page 470 · [tr↔image] · "(Acacia vera Wlld.?)" becomes "(Acacia vera)" and "Quercus Ilex L." becomes "Quercus Ilex". The editor's uncertainty mark and authority are lost. · low
- language tag · lane: ocr · page 471 · [ocr↔image] · `Ancient Greek` only, although the apparatus and footnote are German. · low
- NEW: parallel-text double translation · lane: translation · cross-page · pages 470/471 · [tr] · In a facing-page edition, both the German page and the Greek page are translated into English, so the reader gets the same recipe twice in slightly different English ("dry the hair" vs "clean the hair"). This is expected, but worth a class so the pipeline can mark a page as "modern translation of facing page". · low
Tables: both dot-leader recipe lists become well-formed 2-column markdown tables (3 rows, quantities 3 / 6 " / 3 Xesten; οὐγγ. γ΄ / » ϛ΄ / ξεστ. γ΄), and these WOULD render. Their only oddity is an empty header row (`| | |`). The Greek text and apparatus match the image line for line on the entries I checked [ocr↔image].
Cross-page break: not a continuous text (facing translation). German 452 and Greek 453 correspond recipe by recipe [image].

## Summary
Defects by class (pages affected):
- false/degenerate table from marginal keyword index: 2 (B1 p158, p159)
- NEW variant/orthographic data normalised (table content is the spelling): 2 (B2 p58; also B4 diacritics as below)
- NEW transliteration diacritics merged (Ȧ/Ā/A): 2 (B4 p494, p495)
- NEW paradigm table cells scrambled / forms rewritten: 1 (B3 p87)
- RTL list reversed + over-long markdown row (cell dropped on render): 1 (B3 p87)
- split word misjoined at break (meaning lost): 2 breaks (B1 "nõ"→"na" negation lost; B3 "fœ-|mininam"→"minimam")
- dropped + duplicated line: 1 (B1 p158)
- word misread changing meaning: 3 (B1 Versipellis, B3 signorso, B5 Lyranus low)
- NEW illegible handwriting read as text and inserted mid-sentence: 1 (B3 p88)
- NEW footnote fabricated when its text is on the next page: 1 (B6 p470)
- NEW early-modern sense mistranslated (Englischer = angelic): 1 (B5 p505)
- NEW page number read from bleed-through: 1 (B1 p158)
- spread not split / one image for two pages: 2 (B2 p57, p58)
- catchword as body text: 1 (B5 p504)
- Greek dropped or garbled: 2 (B1 p158, B3 p88)
- display (raw &amp;, LaTeX/caret markers, invented bold, empty meta, gloss-wrapped source notes): 7
NEW classes proposed:
- marginal-index-as-table: a printed marginal keyword index is fused with the body into a row-aligned markdown table.
- degenerate duplicate-cell table: the OCR emits `| X | X |` rows for a single list.
- variant-spelling normalisation: in lists or apparatus whose purpose is to record spellings (ligatures, sic forms), the OCR "corrects" them.
- transliteration-diacritic merge: Egyptological/Semitic transliteration letters that differ only by diacritic are conflated.
- paradigm-cell scramble: in a grammar paradigm, cells are reordered and the author's forms replaced with standard ones.
- handwriting-as-text: faint manuscript annotations are "read" with `<unclear>` guesses and spliced into printed sentences.
- off-page footnote fabrication: the translation invents a note when the note text is printed on another page.
- bleed-through page number: a reversed show-through numeral is taken as this page's folio.
- facing-translation double-render: both sides of a bilingual edition are translated.
Surprises: the markdown tables themselves mostly render fine (B2, B4, B6 are well-formed). The damage is to what is IN the cells: spellings, diacritics and paradigm forms that the OCR normalises toward what it expects. The two most harmful single errors both sit at a page break, on a one-word split: a lost negation ("nõ") in Perotti and "fœ-|mininam" read as "minimam" in Canini. No index page reference was wrong in about 40 checked; the index risk here is the headword letters, not the numbers.
