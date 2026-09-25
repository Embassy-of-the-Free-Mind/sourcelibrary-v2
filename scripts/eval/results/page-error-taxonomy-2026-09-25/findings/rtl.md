# rtl — by-eye findings
Books read: 6 of 6. Images opened: 12 of 12 (all downsized to ≤1800px for reading; one extra crop of Book 3 p.54 head to read the cursive).

Scope note: the packet has no Arabic-1850 or Persian-1727 print and no Mikraot Gedolot / Rashi-script page. What it holds is: Syriac serto with a French parallel translation (1907 print), an Arabic naskh MS (spread), two Hebrew cursive MSS, one Hebrew semi-square pocket MS, and one Persian nastaʿlīq MS. So the checks for Rashi vs square script and commentary blocks could not be run. No page has RTL line order reversed: on every page where the OCR is really of the page (Books 1, 2, 5, 6), line 1 of the OCR is the top line of the image and each line's first word is the rightmost word on the image.

## Book 1: Patrologia Orientalis II, Vie de Sévère (Syriac + French, 1907) — pages 244/245 — https://sourcelibrary.org/book/patrologia-orientalis-tome-ii-inc-vie-de-severe-scholasticus/page/69a99d0a510aaf87d0635cf0
Image 244: printed bilingual edition page. Top: 14 lines of unvocalised serto Syriac with right-margin manuscript sigla ("* B fol. 141 r° b.", "* L fol. 9 r° a/b"), then a Syriac apparatus in French (notes 1–9). Below: the editor's French translation (15 lines) with its own margin sigla and 2 footnotes. Running head "234 JEAN. [150]". [image]
Image 245: the same layout, running head "[151] VIE DE SÉVÈRE. 235". 14 Syriac lines, apparatus 1–5, then French with footnotes 1–6. [image]
Defects:
- NEW: parallel-edition conflation · lane: translation · on-page · page 244 and 245 · evidence: [tr↔ocr], [tr↔image] · The page carries the source (Syriac) and the edition's own translation (French). The English is one blended rendering that switches between them. The first half follows the Syriac, and follows it badly. French "Bourdonnant comme des escarbots et des guêpes, ils répandirent sur son compte le bruit qu'il partageait la doctrine d'Eutychès" comes out as "they were filled with deaf and biting ears, and just as the faces of the beetles were filled, they borrowed from the brotherhood of Eutyches for his faith". The second half ("Pharisees… Samson") follows the French. On 245, "Il prit ensuite le libelle et s'assit dans une retraite silencieuse" becomes "Because he took him and placed him in the quiet resting place of silence". The English also adds "that he was a man who feared God and had no teacher", "gave it in the body to Macedonius" and "from the care of the Xenophant <note>or 'the deceiver'</note>", none of which the French has. "Il écrivit avec amour de la vérité" becomes "he placed the truth in the middle". · severity: high
- vowel points invented · lane: ocr · on-page · page 244 · evidence: [ocr↔image] · The printed Syriac is unvocalised serto: only seyame and a few scattered dots. The OCR adds full vocalisation, with a vowel on nearly every letter plus qushshaya/rukkakha dots (e.g. "ܗܳܕ݂ܶܐ ܗܘܳܬ݂ ܥܶܠܬ݂ܳܐ ܕܰܡܛܽܠܳܬ݂ܳܗ̇ ܙܕ݂ܺܝܩܳܐ"). The OCR for 245, from the same edition, is unvocalised ("ܒܗܿܘ ܙܒܢܐܿ. ܐܢܫ̈ܝܢ"), so the book is inconsistent from page to page. · severity: medium (misrepresents the edition, and a Syriacist would take the vowels as the printer's)
- wrong language tag · lane: ocr · on-page · page 245 · evidence: [ocr↔image] · The tag is `<language>French</language>`, but half the page is Syriac (244 correctly says "Syriac, French, Greek"). · severity: low
- apparatus note garbled · lane: ocr · on-page · page 244 · evidence: [ocr↔image] · The image's note 6 reads "B n'a pas de ܕ après le ܘ initial". The OCR gives "6. B n'a pas ܕ݁ܶܐܬ݂ܓ݁ܰܢܰܝܘ", a whole invented word. · severity: low
- marginalia misplaced · lane: ocr · on-page · page 245 · evidence: [ocr↔image] · In the image, "* B fol. 141 v° a." sits beside Syriac line 5. The OCR puts it before Syriac line 1, and the translation then shows it as the first line of the English page. · severity: low
- footnotes dropped · lane: translation · on-page · page 244 and 245 · evidence: [tr↔ocr] · Editor's note 244 fn1 ("λόγος; cf. Actes, XVIII, 24") and 245 fn6 ("C'est-à-dire : « intégralement, sans rien ajouter ni rien retrancher »") are gone. Other notes were turned into inline `<note>`s. · severity: low
- page number dropped / running head as heading · lane: translation/display · on-page · 244, 245 · evidence: [tr↔image] · The translation opens "# JEAN. [150]" and "# VIE DE SÉVÈRE. [151]". The printed page numbers 234/235 are lost and the running head becomes an H1. · severity: low
Cross-page break: 244's French ends at a paragraph end ("les liens des Philistins"), and the English ends "(broke) the bonds of the Philistines." 245 opens a new paragraph, "At that time…". The join is correct. [tr↔image]

## Book 2: al-Alfiyah (Ibn Mālik with al-Suyūṭī), Or. 6991 (Arabic MS, 19th c.) — pages 25/26 — https://sourcelibrary.org/book/al-alfiyah-or-6991/page/6a20329d18654bf8e19032a3
Image 25: an open spread, not split. The right page (read first) has 17 lines of black naskh with red rubrics and a ruled frame. The left page has 17 lines, the rubric "فصل في عوامل الجزم", and a pencil folio "22" at top left. [image]
Image 26: the next spread. The right page begins "من خير يعلمه الله ومهما…" and the left page begins "او مضارعين تلفهما", with a pencil folio "23". [image]
Defects:
- spread not split · lane: image · on-page · page 25 and 26 · evidence: [image] · Each "page" is two manuscript pages. The OCR tags page 25 `<columns>2</columns>`, which mislabels two single-column pages as one two-column page. The reading order is right (right page, then left page), so no text is lost. · severity: low
- script misread changes meaning · lane: ocr→translation · on-page · page 25 · evidence: [ocr↔image], [tr↔ocr] · Line 2 of the right page reads "كلا تكن جلدا وتظهر الجزع" (the Alfiyya example "do not be steadfast while showing grief"). The OCR has "كطائك جلد… أو تظهر الجزع", and the translation invents "I will be gentle... or you show grief". · severity: medium
- Qurʾān citation garbled · lane: ocr · on-page · page 25 · evidence: [ocr↔image] · The image has "يا ليتنا نرد ولا نكذب" (Q 6:27, "would that we were returned"). The OCR has "جبالا يثننا نرد", and the translation keeps only "we return and we do not deny", losing the wish particle. · severity: low
- rule lost via misread · lane: ocr→translation · on-page · page 26 · evidence: [ocr↔image], [tr↔ocr] · Right page line 8 reads "ويجزم باذا في الشعر كثيرا" ("jussive after idhā is frequent in poetry"). The OCR has "ويجزم باداعي الشر كثير", and the translation invents "Many tools act as conditional particles". The next sentence ("prohibited in prose") then makes no sense. · severity: medium
- garbled rendering of verse · lane: translation · on-page · page 25 · evidence: [tr↔ocr] · "فاقبل منه ما عدل روي" is rendered "Accept from it what has been deviated, reported, and turned upon". · severity: low
- rubrication marked inconsistently · lane: ocr · on-page · page 25 · evidence: [ocr↔image] · The image of page 25 has about 15 red rubric phrases ("والواو كالفا… مع", "وبعد غير النفي", "وشرط جزم بعد نهي"…). The OCR bolds only "**فصل**". Page 26 bolds each rubric. The translation's bold/quote structure for the Alfiyya verse follows the OCR, so on page 25 the reader cannot always tell verse from commentary. · severity: low
- raw layout tag in translation · lane: display · on-page · 25, 26 · evidence: [tr] · The translation body contains a literal "<column-break/>" (present in the page payload; whether it shows up on screen was not checked). · severity: low
- NEW: next-page lookahead duplication · lane: translation · cross-page · break · evidence: [tr↔image] · Page 25's left page ends "وما تفعلوا", and the translation ends "And 'Ma'… like 'And whatever good you do.'" Here "good" (من خير) comes from the top of page 26. Page 26 then begins "of good, God knows it", so "good" is translated twice. · severity: low
Cross-page break: the text runs straight on ("وما تفعلوا | من خير يعلمه الله"). In English, "good" appears at both the end of 25 and the start of 26. [tr↔image]

## Book 3: Sifre madaʿ segulot (Hebrew MS, 18th c.) — pages 54/55 — https://sourcelibrary.org/book/sifre-mada-segulot-anonymous/page/69c1bafc8522835be845c030
Image 54: a Hebrew cursive (Sephardic/Maghrebi-type) manuscript of recipes. The heading is something like "לחולי פצעים". There are 8 numbered entries, with Hebrew-letter numerals of about three letters in the right margin and short subject notes in the left margin. The entries repeatedly read "רפואה…" / "קח…" ("take…"). A catchword sits at the foot. No vowel points. [image]
Image 55: the same hand and format. About 11 numbered entries with margin numerals and left-margin notes, "כב" at top left, and a catchword "עו"א…" at the foot. [image]
Defects:
- NEW: genre-primed confabulation (OCR of a text not on the page) · lane: ocr · on-page · page 54 and 55 · evidence: [ocr↔image] · On 54 the OCR is a philosophical treatise on divine simplicity ("כי אם בעל פשוט יש בו האחדות גמורה…"), with margin letters א–ז and glosses "טוב/חן/אמת/חסד". The image is a list of remedies with multi-letter numerals. On 55 the OCR is the standard Yom Kippur confession ("אשמנו מכל עם… על חטא שחטאנו לפניך באונס וברצון"), divided into invented "שעה א'…שעה ט'" markers and ending with an invented catchword "ועל חטא". None of this is on the leaf: the image has about 11 recipe entries with different lengths and layout. The translation turns both fabrications into fluent English ("The Unity of the Night… We have trespassed more than any people"), so the reader gets two confident pages that are not in the book. · severity: high
- page number wrong · lane: ocr · on-page · page 55 · evidence: [ocr↔image] · The OCR has `<page-num>32</page-num>`, but the leaf is marked "כב" (22). · severity: low
Cross-page break: not assessable. Both sides are fabricated, and the English "join" is between two unrelated invented texts (a Maimonidean-style treatise and the Vidui). [tr↔image]

## Book 4: Tiḳun sheṭarot (Hebrew MS, late 18th/early 19th c.) — pages 127/128 — https://sourcelibrary.org/book/tikun-shetarot-anonymous/page/69c1bc148522835be846169e
Image 127: dense Hebrew cursive (Italian/Sephardic), about 37 lines, unvocalised. A reddish folio mark "טו"/"סו" at top left, several enlarged words ("אם") at line starts, and a strip of the facing page visible at the right edge. [image]
Image 128: the same hand, about 30 lines. An enlarged "לחי" mid-page, a large square-script heading "דיני שבועות ונדרים" near the foot followed by 4 lines, a catchword at bottom left, and a strip of the facing page at the left edge. [image]
Defects:
- NEW: OCR degeneration loop · lane: ocr · on-page · page 127 · evidence: [ocr↔image] · The OCR collapses into repeated "סוד שכינה" and "שער הבינה", ending with the line "ובזה סוד שכינה וסוד שכינה" 5 times over. The image shows 37 varied lines with no repeated line pattern. The book is a formulary of legal deeds, yet the OCR's own meta calls it "a philosophical or kabbalistic treatise". Practically nothing on the leaf is transcribed. · severity: high
- confabulated text with duplicated block · lane: ocr · on-page · page 128 · evidence: [ocr↔image] · Two things are anchored to the image: the heading "דיני שבועות ונדרים" and the enlarged "לחי". The rest is filler built around "וכו'" and "וזהו שכתב רז"ל", and the block "עד שיכולה להוציא מן הכח אל הפועל… משה רבנו ע"ה לא מת… אל תירא עבדי יעקב וכו'" appears twice word for word. The image has no such repetition. · severity: high
- translation amplifies degenerate OCR · lane: translation · on-page · page 127 and 128 · evidence: [tr↔ocr] · Every repetition is translated faithfully ("and the secret of the Shekhinah and the secret of the Shekhinah…"), 3,506 characters of it on 127. Nothing between OCR and translation catches a loop. · severity: high (the reader gets pages of nonsense presented as Kabbalah)
- page number wrong · lane: ocr · on-page · page 127 · evidence: [ocr↔image] · The OCR has `<page-num>10</page-num>`, but the leaf is marked "טו"/"סו" at top left. · severity: low
- catchword dropped · lane: ocr · on-page · page 128 · evidence: [ocr↔image] · The catchword at bottom left is not transcribed. · severity: low
- neighbour-page strip in frame · lane: image · on-page · 127, 128 · evidence: [image] · Text columns from the facing pages show at the edges. They were not OCR'd, which is correct. · severity: low
Cross-page break: not assessable, because both sides are confabulated. The English of 127 ends mid-loop ("the secret of the Shekhinah…"), and 128 starts "And he traveled in the chariot of both of them". [tr↔image]

## Book 5: Pocket-size Jewish prayer book (Hebrew MS, 15th–16th c.) — pages 333/334 — https://sourcelibrary.org/book/pocket-size-jewish-prayer-book-anonymous/page/69c1bade8522835be845b163
Image 333: a small-format leaf with 17 lines of Hebrew semi-square script (not Rashi), unvocalised apart from rare marks. Phrases are separated by a raised dot/stroke. A pencil "163" at bottom left. The text is Unetanneh Tokef. [image]
Image 334: 17 lines in the same hand, continuing Unetanneh Tokef ("בקיצו ומי לא בקיצו…"). [image]
Defects:
- dittography inserted by OCR · lane: ocr · on-page · page 333 · evidence: [ocr↔image] · Image line 10 reads "וכל באי עולם בראש השנה תעביר". The OCR has "וכל באי עולם כבני מרון בראש השנה תעבר", pulling "כבני מרון" in from line 11. · severity: low
- omission · lane: translation · on-page · page 333 · evidence: [tr↔ocr], [tr↔image] · About 5 lines of source are missing: "כבקרת רועה עדרו ומעביר צאנו תחת שבטו כן תעביר ותספור ותמנה ותפקוד נפש כל חי ותחתוך קצבה לכל הבריות ותכתוב את גזר דינם" (the shepherd simile, and "so You pass, count, number and visit every living soul, fix the term of every creature, and write their verdict"). The English jumps from "pass before You like members of the flock" to "On Rosh Hashanah it is inscribed". · severity: high
- NEW: canonical-text substitution · lane: translation · on-page · page 334 · evidence: [tr↔ocr], [tr↔image] · Both the image and the OCR read "מי ברעש ומי במגפה מי בדבר ומי ברעב" (earthquake, plague, pestilence, famine). The English gives "who by earthquake and who by plague, who by famine and who by drought". "Pestilence" (בדבר) is dropped and "drought" (the standard prayer book's בצמא) is added, so the manuscript's own reading is overwritten by the printed liturgy the model knows. · severity: medium
- phrase separators dropped · lane: ocr · on-page · 333, 334 · evidence: [ocr↔image] · The scribe's raised-dot phrase dividers are not transcribed. Scribal line-end anticipations ("ב / ברעב", "מ / משול") are kept faithfully, which is good. · severity: low
- continuity meta in translation text · lane: display · on-page · page 333 · evidence: [tr] · The translation begins "<meta>Continuity: Continues the recitation of the Unetanneh Tokef piyyut…</meta>". It is in the page payload; whether it shows on screen was not checked. · severity: low
Cross-page break: 333's English ends "who shall live and who shall die, who...", and 334's begins "in his appointed time". The join is correct, and the image confirms the order (163 recto, 334 continues). [tr↔image]

## Book 6: Gulistān, Saʿdī (Persian MS, 1722) — pages 121/122 — https://sourcelibrary.org/book/gulistan-manuscript-1722-or-1723-sa-di/page/69f33c97876dd827cbc5a9c8
Image 121: one page of nastaʿlīq, 13 lines in a gold-and-colour ruled frame, with red rubrics (قطعه, حکایت, بیت), folio "59" at top left, and a strip of the facing page at the right. [image]
Image 122: the facing page, 13 lines with rubrics نظم, حکایت, قطعه and the catchword "پیش" below the frame at bottom left. [image]
Defects:
- misreads (mostly benign) · lane: ocr · on-page · page 121 · evidence: [ocr↔image] · The image reads "نیامدی امشب" and the OCR has "نیامدی تا شب". Other misreads: "بدین بقعه" as "پس بقعه" and "نیز در آن میان" as "پیش در آن میان". The line-end "گر" of "گر نغمه کند ور نکند" is dropped, which gives "نغمه نکند ور نکند" and inverts the sense. The translation happens to recover it ("whether it sings or not"). · severity: low
- misread shifts meaning · lane: ocr→translation · on-page · page 122 · evidence: [ocr↔image], [tr↔ocr] · The image has "که جبر خاطر مسکین بلا بگرداند" ("mending a poor man's heart turns away calamity"). The OCR has "خیر خاطر", which the translation renders "the goodness of a poor man's heart". · severity: low
- opening clause dropped · lane: translation · on-page · page 121 · evidence: [tr↔ocr] · "تقریب نمایم بعلت آنکه…" ("I make this approach, because…") is not translated. The English starts at "Because the Sheikh often…". · severity: low
- continuity meta carries neighbour text · lane: display · on-page · 121, 122 · evidence: [tr] · Each translation opens with "<meta>continues from previous page: ...so that I too may follow your lead.</meta>" or "...one of the caravan members", which repeats the previous page's English. Whether it shows on screen was not checked. · severity: low
- NEW: source lineation imposed on translation · lane: translation/display · on-page · 121, 122 · evidence: [tr↔image] · The English breaks lines where the manuscript does, mid-sentence ("but I did not listen with acceptance. Until\ntonight"; "Truly, the fault\nis on our side"). The prose reads as broken verse. · severity: low
Cross-page break: 121's English ends "One of the caravan members", and 122's begins "said to him: Speak a few words…". The join is correct, and 122's catchword "پیش" is not translated as a word. [tr↔image]

## Summary
Defects by class (name: count of pages affected):
- genre-primed confabulation / OCR of text not on the leaf: 3 pages (B3 54, 55; B4 128)
- OCR degeneration loop: 1 (B4 127), plus the duplicated block on B4 128
- translation amplifies bad OCR (no gate): 4 (B3 54, 55; B4 127, 128)
- parallel-edition conflation: 2 (B1 244, 245)
- translation omission: 3 (B5 333 about 5 lines; B6 121 opening clause; B1 footnotes on 244/245)
- canonical-text substitution: 1 (B5 334)
- OCR misread that changes meaning: 3 (B2 25, 26; B6 122); benign misreads 2 (B2 25 Q6:27; B6 121)
- vowel points invented: 1 (B1 244; its twin 245 is unpointed)
- spread not split / wrong columns tag: 2 (B2 25, 26)
- wrong language tag: 1 (B1 245)
- apparatus/marginalia errors: 2 (B1 244 note 6; B1 245 siglum placement)
- page number wrong/dropped: 4 (B1 244/245 dropped; B3 55; B4 127)
- catchword dropped or fabricated: 2 (B4 128 dropped; B3 55 fabricated)
- dittography inserted: 1 (B5 333)
- rubrication marking inconsistent: 1 (B2 25)
- raw tags / meta in translation (render not checked): 5 (B2 25, 26; B5 333; B6 121, 122)
- neighbour-page strip in frame: 2 (B4 127, 128); harmless
- next-page lookahead duplication: 1 break (B2 25→26)
No RTL line reversal, no left-to-right line order, and no wrong page order anywhere. Hebrew nikkud was neither invented nor dropped: all three Hebrew MSS are unpointed and so is the OCR.

NEW classes proposed:
- parallel-edition conflation: a page carrying both the source and a printed translation is rendered as one blended English text that switches between them and invents where it follows the source.
- genre-primed confabulation: on an illegible cursive hand, the OCR produces a well-known or genre-typical text (the Vidui, a treatise on divine simplicity, kabbalistic "sod" filler) that is not on the leaf.
- OCR degeneration loop: the OCR collapses into repeated phrases or lines, and the translator renders them unchanged.
- canonical-text substitution: the translator swaps the manuscript's variant for the standard printed version of a famous text.
- source lineation imposed on translation: manuscript line breaks carried mid-sentence into the English.

Anything that surprised you:
The worst failures are not RTL-specific at all. They are about cursive Hebrew hands. In 2 of the 3 Hebrew MSS (4 of 6 Hebrew pages), the OCR is fiction or near-fiction, and the translation turns it into confident English with summaries and keywords, so nothing downstream would flag it. On B3 55 the fabricated text even has invented structure (hour markers, a catchword). Well-known liturgy is a trap in both directions: B5's OCR is excellent, but the translator still "corrects" the text toward the standard version. The Syriac/French edition shows a separate problem: the pipeline has no idea that a printed translation is on the page, and it produces a worse translation than the one it is looking at.
