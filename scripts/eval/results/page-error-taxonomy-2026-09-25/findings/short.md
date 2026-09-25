# short — by-eye findings
Books read: 6 of 6. Images opened: 12 of 12.

Note on the stratum: none of the 12 leaves is actually a short page of text. Pages 148/149 (Book 1), 362/363 (Book 3), 455/456 (Book 4), 114/115 (Book 6) are full printed pages; 79/80 (Book 5) are full tables. Only 249 (Book 2) is near-empty, and that is a blank verso. The packet's `ocr_len` values (159, 108, 175…) do not match the OCR text printed beneath them: Book 5 p.79 says ocr_len=108, but its OCR is about 8,100 lines. So whatever field selected this stratum is not the stored OCR length. [ocr]

## Book 1: De Re Rustica (Varro), Latin, 1514 — pages 148/149 — https://sourcelibrary.org/book/de-re-rustica-cato-varro-columella-palladius-1514-varro/page/69af20221e41710a29f5fc7d
Image 148: a full page of dense single-column italic Latin prose, running header "M. VARRONIS", chapter numbers XLVI–XLIX set flush right, ending mid-sentence "dic inqt Agrius de fructibus maturis". [image]
Image 149: a full page of dense italic Latin prose, header "DE RE RVST. LIB. I." and "39", chapters L and LI, ending mid-sentence "& loca calida prope aream faciunt, ac". [image]
Defects:
- NEW: ocr-silent-mid-page-omission · lane: ocr · on-page · page 149 · evidence: [ocr↔image] · The OCR of chapter L stops at "Hæc cum comprehendit" and jumps straight to "->LI.<-". It drops about 13 printed lines ("falcem spicarum desecat … Tertio modo metitur, ut sub urbe Roma … palea … deferre debeant"). There is no ellipsis or <unclear> marking the gap, but the <vocab> line lists "Roma, palea", so the model read the lines and then left them out. · severity: high
- truncated OCR (page foot) · lane: ocr · on-page · page 149 · evidence: [ocr↔image] · The OCR ends at "Quidam aream ut habeant solidam, muniunt". The last 3 printed lines are missing ("lapide, aut etiam faciunt pauimentum. Nonnulli etiam tegunt areas, ut in Bagienis … ac"). Again the <vocab> line lists "Bagienis". · severity: high
- NEW: translation-richer-than-stored-ocr (OCR/translation desync) · lane: derived · on-page · page 149 · evidence: [tr↔ocr]+[tr↔image] · The translation includes all the text that the stored OCR lacks: "The third way … near Rome", "chaff <term>palea</term>", "Some even cover the threshing floors, as in the Bagienni region … and…". The translation was therefore made from a fuller OCR than the one now stored. A reader who compares the two panes sees text in the English that has no source, and the source pane silently loses about 16 lines. · severity: high
- word broken across the page treated as marginalia · lane: ocr+translation · cross-page · break · evidence: [image]+[tr↔ocr] · Page 149's first line on the leaf is the end of a broken word, "capiedis." (completing "de fructibus maturis ca-|piendis", "on gathering ripe fruits"). The OCR wraps it in <margin> as "<unclear>ca</unclear>piedis". The translation renders it as "<margin></margin>\n<unclear>to be</unclear> gathered.\n</margin>", with unbalanced tags and a stray gloss. Page 148's translation already closes the quotation: "Agrius says: 'Speak of the mature fruits.'" · severity: medium
- raw/unbalanced markup in translation · lane: display · on-page · page 149 · evidence: [tr] · The translation contains "<margin></margin>" followed by a stray closing "</margin>", which leaves the markup malformed for the renderer. · severity: medium
- mistranslation (minor) · lane: translation · on-page · page 149 · evidence: [tr↔ocr] · "cum in ea iugerum fere una opera messum est, propemodum … satis esse dicitur, ut messas spicas … deferre debeant" becomes "When about one day's work has been reaped on an acre, it is said that it is enough … So they must carry…". The Latin says that one man's day of work reaps about a iugerum. The logic of the sentence is lost. · severity: low
Cross-page break: Page 148 ends "Agrius says: 'Speak of the mature fruits.'" and page 149 begins with a margin fragment "to be gathered". The split word "ca-|piendis" is torn into two pieces, and the closing quotation mark comes before the word that completes it. [tr↔image]

## Book 2: De l'Interest des Princes (Rohan), French, 1644 — pages 249/250 — https://sourcelibrary.org/book/de-l-interest-des-princes-rohan/page/69b3039c5facc83a9a3da28d
Image 249: a blank verso with heavy mirrored bleed-through of the facing title ("VERITABLE DISCOURS…", the woodcut A). A sliver of the next recto (p.3) is visible at the right edge. ProQuest EEB copyright footer. [image]
Image 250: printed p.3, "VERITABLE DISCOURS De ce qui s'est passé en l'assemblée … Saumur … L'an 1611.", with a woodcut initial A, two paragraphs, signature "A 2", catchword "tel". [image]
Defects:
- blank leaf with neighbour sliver transcribed · lane: ocr · on-page · page 249 · evidence: [ocr↔image] · The page is a blank verso. The OCR transcribes the letter-stubs of the next page's left edge ("V / D / De l / sem / for / G / dable / de Die / Roya / regre …") and the woodcut initial, which belongs to p.250. It is tagged <page-type>text</page-type> when the leaf is blank. · severity: medium
- NEW: fragment-translation (word stubs "translated") · lane: translation · on-page · page 249 · evidence: [tr↔ocr] · The translator turns the stubs into English stubs: "Of <unclear>t</unclear> / ass / ref / G / dable / of God / Kingd / regret / of a / war / … to atten / spirit / seem / voyag / Court". This is meaningless text on a blank page, and it duplicates p.250's content in broken form. · severity: medium
- process meta leaked · lane: ocr/display · on-page · page 249 · evidence: [ocr]+[tr] · The OCR carries <warning> and <meta> ("Transcribing only the visible fragment of the recto page on the right"). The translation carries prose <note> blocks and a <summary> ("This page is primarily a blank leaf…"). These are reader-facing if the note tags render. · severity: low
- page 250 · No defects found in the OCR or translation: title, two paragraphs, sig "A 2" and catchword "tel" were all checked against the image. "ressentiment" → "resentment" is a mild false friend (it means the keenly felt grief). [tr↔image] · severity: low
Cross-page break: A reader turning from 249 to 250 sees word-stub gibberish and then the real title page of the Discours. No text actually runs across the break. [tr↔image]

## Book 3: Theonis Smyrnaei Liber de Astronomia (Martin ed.), Latin with Greek, 1849 — pages 362/363 — https://sourcelibrary.org/book/theonis-smyrnaei-liber-de-astronomia-1849-smyrna/page/69affb67abb6b46e8cb66d60
Image 362: printed p.348 "NOTÆ IN THEONEM", Notae B and C (Latin commentary with bold Greek lemmata and emendations), 4 footnotes. [image]
Image 363: printed p.349 "DE ASTRONOMIA.", end of Nota C, Notae D and E (sphere-volume arithmetic with fractions), 1 footnote. [image]
Defects:
- NEW: quoted-corruption-normalised (OCR silently emends the corrupt reading an editor is correcting) · lane: ocr · on-page · page 362 · evidence: [ocr↔image] · The printed text reads "pro τῶν ἰσταδίων κάθετον, legendum esse τῶν ι σταδίων κάθετον". The OCR gives "pro τῶν ι σταδίων κάθετον, legendum esse τῶν ι σταδίων κάθετον", so the emendation becomes "for X read X". The translation copies the tautology: "instead of 'the ten stadia vertical' … read 'the ten stadia vertical'". The editor's point is destroyed. · severity: high
- Greek misread in the corrupt word · lane: ocr · on-page · page 363 · evidence: [ocr↔image] · The printed text has "ὀροσταδίων" (a non-Greek word the editor emends to φκδ σταδίων). The OCR gives "ὑροσταδίων". The translation then invents a gloss: "<term>hyrostadion</term> <gloss>water-stadia</gloss>". Neither the page nor the Greek says "water". · severity: medium
- footnotes dropped in translation · lane: translation · on-page · page 362 · evidence: [tr↔ocr] · The OCR has 4 footnotes (Ptolemy, Petavius Uranol. 1630; Diss. part II; ibid.; Tim. p. 54 B). The translation ends with a <summary> and has no footnotes at all. The Plato citation is therefore lost. · severity: medium
- footnote injected mid-sentence · lane: translation/display · on-page · page 363 · evidence: [tr↔image] · Footnote 1 appears inline: "Our author <margin>1 See what the author says …</margin> establishes that the mass of a sphere…". The OCR also tags the footnote marker as "<gloss>1</gloss>". · severity: medium
- minor OCR misreads · lane: ocr · on-page · page 362 · evidence: [ocr↔image] · The OCR has "apparitiis" where the printed text reads "apparentiis" (footnote 1). "δισκαταδιαίαν" is printed as "διοκαταδιαίαν" (uncertain at this resolution). Meaning is mostly preserved. · severity: low
- running header promoted to H1 title · lane: translation/display · on-page · pages 362, 363 · evidence: [tr↔image] · "# NOTES ON THEON" and "# ON ASTRONOMY." turn running heads into page titles, while the OCR had them in <header>. · severity: low
Cross-page break: The word "δια-|μέτροις" is split. Page 362's translation ends 'instead of "and with millet diameters-"' and page 363 begins 'in measures <note>original: "μέτροις"</note>, we read 12 millet-grain diameters'. The split word is translated twice, as two fragments, and the join reads wrongly. [tr↔image]

## Book 4: De medicinali materia (Dioscorides/Ruel, with Matthioli notes), Latin, 1552 — pages 455/456 — https://sourcelibrary.org/book/de-medicinali-materia-libri-sex-dioscorides-2/page/69f73817116fbf7193f95d27
Image 455: printed p.415 "LIBER TERTIVS", a woodcut of Asclepias at left captioned "* Asclepias.", the text wrapped around it, then the chapter "Atractylis. CAP. LXXXIX." with a NOMENCLATVRA (Greek, Latin, Italian, French and apothecary names), and the catchword "qua". [image]
Image 456: printed p.416 "DIOSCORIDIS", two woodcuts captioned "Atractylis. 1." and "Atractylis. 2.", the rest of the chapter, a commentary paragraph, "Polycnemum. CAP. XC. NOMENCLATVRA.", and the catchword "Græ." [image]
Defects:
- echoed source word · lane: translation · on-page · page 455 · evidence: [tr↔ocr] · "magna parte nuda, asperaque" becomes "which are nuda for a great part, and rough". The Latin "nuda" (bare) is left untranslated. · severity: low
- catchword taken into the body · lane: ocr · cross-page · page 455 · evidence: [ocr↔image] · The printed catchword "qua" is appended to the body ("asperaque, qua"). Page 456 also begins "qua fœminæ". The translation masks the duplication ("rough, which…" / "...women use for spindles"). · severity: low
- catchword tagged as a signature · lane: ocr · on-page · page 456 · evidence: [ocr↔image] · "<sig>Gr&.</sig>" is the catchword "Græ." (the start of the next NOMENCLATVRA line "Gr."), not a signature. · severity: low
- case/name normalised · lane: ocr · on-page · page 455 · evidence: [ocr↔image] · "Fuchsio Asclepias Vincetoxicum est" ("in Fuchs' view") is read as "Fuchsius Asclepias…". The translation turns this into "Fuchsius says". The meaning survives. · severity: low
- identification added to the plate note · lane: translation · on-page · page 455 · evidence: [tr↔image] · The note calls the plant "Asclepias … also known as Swallow-wort or Milkweed". No such name is printed on the leaf. · severity: low
- "Coma" rendered "The hair" · lane: translation · on-page · page 456 · evidence: [tr↔ocr] · In this botanical sense coma means the leafy/flowering top of the plant. · severity: low
Cross-page break: "…asperaque, | qua fœminæ pro fusis utuntur" becomes "rough, which..." / "...women use for spindles". The join is correct in meaning, with ellipses on both sides. [tr↔image]

## Book 5: Collection of Cabalistic Texts, manuscript, Italian/Latin, c.1700 — pages 79/80 — https://sourcelibrary.org/book/collection-of-cabalistic-texts-multi-language-kabbalistic-anonymous/page/69d66635bf5afe33937f927a
Image 79: a handwritten ruled table headed "Mensis". It has 12 month rows (Gen°, Feb°, Mar., Ap.e, May, Giu, Lug., Ag, 7bre, 8bre, 9bre, Xbre), 6 value columns plus a last column (e.g. Gen° 9, 24, 26, 14, 29/22, 35/37, 274/279), the year "1556" below, a pencil "1748" and folio "71". At the left edge is a sliver of the previous leaf's column (58, 57, 61/60, 47, 84, 63, 76, 17, 214, 351/358, 194). At the right edge is a sliver of the next leaf ("rica,"). [image]
Image 80: the same kind of table with no header row visible, rows Gen°…Xbre, the year "1557" and pencil "1749". [image]
Defects:
- NEW: degenerate repetition loop (OCR runaway) · lane: ocr · on-page · page 79 · evidence: [ocr] · After the sliver numbers, the OCR emits 4,602 lines of "|" and 3,525 lines of "...", and never closes its <margin> tag. The translation has 743 lines of "...". Rendered, this is thousands of lines of junk. · severity: high
- OCR of the neighbour sliver instead of the page (main content missing) · lane: ocr · on-page · page 79 · evidence: [ocr↔image] · The only real text captured is the previous leaf's edge column ("6. 58 57 61 60 47 84 63 76 17 214 351 358 194") and "rica,". The entire 12×7 table on this leaf (e.g. "Gen° 9 24 26 14 …", "Mar. 34 76 67 72 56 68 176") and the year 1556 are absent. · severity: high
- fabricated table and interpretation · lane: translation · on-page · page 79 · evidence: [tr↔image] · The translation builds a new table, "| Index | Value | Calculation | Variable |", with the 14 sliver numbers as rows 1–14. It adds <meta>/<note> prose about "planetary or celestial movements through the calendar year" and "ritual or divinatory calculation". Nothing on the leaf supports either the table or the interpretation. · severity: high
- invented column headers ("Total") · lane: ocr+translation · on-page · page 80 · evidence: [ocr↔image] · The OCR adds a header row "| Month | Col 1 … Col 6 | Total |" that is not on the leaf. The last column is not a total: Jan 23+51+32+67+38+41 = 252, while the entry reads "83." · severity: medium
- table cell spot-check · lane: ocr · on-page · page 80 · evidence: [ocr↔image] · Rows Jan, Ap., May, Iun, Ag, Xbre match the image. Two cells are uncertain: the 9bre total reads "70" on the image against "76" in the OCR, and the 9bre first cell may be "3", not "13". Month abbreviations are expanded correctly in the translation (7br → September). · severity: low
- later pencil annotations and folio dropped · lane: ocr · on-page · pages 79, 80 · evidence: [ocr↔image] · The pencil "1748"/"1749" and the folio "71" are not recorded. · severity: low
Cross-page break: There is no running text. Page 79's table (1556) is lost entirely, and page 80's (1557) is intact. A reader sees one year's register missing and replaced by an invented index table. [tr↔image]

## Book 6: The Mimes of Herodas (Nairn), Greek with English commentary, 1904 — pages 114/115 — https://sourcelibrary.org/book/the-mimes-of-herodas-nairn/page/69f080be883d181634179cfa
Image 114: printed p.19 "ΠΟΡΝΟΒΟΣΚΟΣ", 8 Greek verse lines (vv. 22–29, "25" in the margin), a Latin apparatus criticus, and a two-column English commentary (notes 22–29), sig "C 2". [image]
Image 115: printed p.20, 11 Greek verses (30–40), an apparatus, and a two-column commentary (notes 30–40). [image]
Defects:
- NEW: commentary-abridged-to-summary · lane: translation · on-page · pages 114, 115 · evidence: [tr↔ocr]+[tr↔image] · On p.114 the English commentary is "translated" as an abridgement. The notes on Horace Epod., Pollux/ἀσκέρας, Isaios v.11, Terence Ad., the cretic/Palmer λυμεών note, and πεφύρηται are dropped. On p.115 notes 30, 32, 33, 36, 37 and 39 (Rhianos, Aelian, Menander, Demosthenes Meidias, Veitch, Schneider) are dropped. The source is already English, so a reader loses about 70% of the page with no sign of the loss. · severity: high
- note/line numbers renumbered · lane: translation · on-page · page 114 · evidence: [tr↔image] · The printed notes are numbered 22, 23, 25, 27, 28 sq. The translation labels them 24, 25, 27, 28, 30. Each note now points at the wrong verse. · severity: medium
- citation replaced by invented generic reference · lane: translation · on-page · pages 114, 115 · evidence: [tr↔image] · The print has "On the independence of Kos see Paton-Hicks, pp. 29 foll."; the translation has "see standard historical records". The print has "cf. Demosth. De Corona § 130, Lukian, Peregr. i."; the translation has "see historical parallels in the orators". · severity: medium
- sense inverted across the verse break · lane: translation · cross-page · break/115 · evidence: [tr↔image] · The Greek "ὃν χρῆν … ὡς ἐγὼ ζώειν | τῶν δημοτέων φρίσσοντα καὶ τὸν ἥκιστον" means "(he should) live as I do, trembling before even the meanest of the citizens". The translation has "as I do" / "and even the meanest of the citizens is shivering", which changes who trembles. · severity: high
- sense inverted · lane: translation · on-page · page 115 · evidence: [tr↔image] · "καὶ τῇ γενῇ φυσῶντες οὐκ ἴσον τούτῳ", which the commentary on the same page explains as "i.e. ἀλλὰ πολὺ μᾶλλον" (far more), is translated "who in their pride of birth are not equal to him". · severity: medium
- apparatus criticus mangled · lane: translation · on-page · page 114 · evidence: [tr↔ocr] · The Latin apparatus "24 ΕΜΟΥ cum accentu gravi … 28 ὃν χρῆν ἑαυτὸν Ellis : ΟΝΕΧΡΗΝΑΥΤΟΝ P 29 ζώειν Crusius" becomes a stray "24" and '<note>28 "He who should know himself": Ellis.</note>'. The apparatus for 24 and 29 is lost. On p.115 the apparatus is dropped entirely. · severity: medium
- OCR small slips · lane: ocr · on-page · pages 114, 115 · evidence: [ocr↔image] · "There is also no doubt sarcasm" is printed "…no doubt some sarcasm". "Introd. ch. V. 2. a." is printed "V. 2. B. 2. a.". "(as at v. 51) ἀλοάω" is printed "ἀλοιάω". The margin verse numbers 25/30/35/40 are dropped. · severity: low
Cross-page break: Page 114's translation ends "clay he was fashioned, as I do" and page 115 begins "and even the meanest of the citizens is shivering." Grammatically the participle φρίσσοντα belongs to the p.114 clause, so the join breaks the sentence and reverses its sense. [tr↔image]

## Summary
Defects by class (name: pages affected):
- ocr-silent-mid-page-omission: 1 (B1 p149)
- truncated OCR at page foot: 1 (B1 p149)
- translation-richer-than-stored-ocr: 1 (B1 p149)
- split word / catchword mishandled at break: 3 (B1, B3, B4)
- raw/unbalanced markup, footnote injected inline: 2 (B1 p149, B3 p363)
- neighbour-leaf sliver transcribed as page content: 2 (B2 p249, B5 p79)
- fragment-translation of stubs: 1 (B2 p249)
- process meta/notes/summary leaked: 2 (B2 p249, B5 p79)
- quoted-corruption-normalised: 1 (B3 p362)
- Greek misread and then an invented gloss: 1 (B3 p363)
- footnotes/apparatus dropped in translation: 3 (B3 p362, B6 p114, p115)
- running head made into a heading: 2 (B3)
- echoed untranslated word: 1 (B4 p455)
- catchword tagged wrongly: 1 (B4 p456)
- name/case normalised: 1 (B4 p455)
- identification added to plate note: 1 (B4 p455)
- degenerate repetition loop: 1 (B5 p79)
- fabricated table/interpretation: 1 (B5 p79)
- invented table headers: 1 (B5 p80)
- commentary abridged to summary: 2 (B6)
- note numbers renumbered: 1 (B6 p114)
- citation replaced by generic reference: 2 (B6)
- sense inverted: 2 (B6 p115, break)
- minor OCR misreads: 4 (B1, B3, B5, B6)
- minor mistranslation: 2 (B1 p149, B4 p456)

NEW classes proposed:
- ocr-silent-mid-page-omission: the OCR drops a block of lines mid-page with no marker, while its own <vocab> proves it saw them.
- translation-richer-than-stored-ocr: the translation contains source text absent from the stored OCR, meaning it was translated from an earlier or fuller OCR revision. This is a provenance desync between the two panes.
- fragment-translation: word stubs from a neighbour-leaf sliver get "translated" into English stubs.
- degenerate-repetition-loop: thousands of repeated "|" or "..." lines emitted by the OCR and echoed by the translation.
- quoted-corruption-normalised: the OCR silently corrects a corrupt reading that the editor is quoting in order to correct it.
- commentary-abridged-to-summary: an English-language (or mixed) scholarly page is condensed instead of carried over, with citations replaced by generic phrases.
- note-renumbering: the translation changes the line/note numbers that the commentary is keyed to.

Surprises:
- The "short" stratum mostly is not short. Its length metric does not describe the stored OCR: Book 5 p79 is flagged ocr_len=108 while carrying about 8,100 lines of junk.
- In two cases the <vocab> line lists words the OCR body omits (Roma, palea, Bagienis). A vocab-versus-body check would detect silent omissions for free.
- The translator treats an English commentary as licence to summarise. The source-language-is-target-language case needs its own rule.
