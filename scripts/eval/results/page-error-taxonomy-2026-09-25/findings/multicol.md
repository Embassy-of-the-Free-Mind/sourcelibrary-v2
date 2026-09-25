# multicol — by-eye findings
Books read: 6 of 6. Images opened: 12 of 12 (all opened at full frame; no crops needed).

## Book 1: Histoire de la condannation des Templiers (Latin text in French-titled book, 1713) — pages 227/228 — https://sourcelibrary.org/book/histoire-de-la-condannation-des-templiers-celle-du-schisme-dupuy/page/69f69640aee36685de86487d
Image 227: printed page 207, SINGLE column of Latin (italic quotation + roman), marginal note "§. 17. Utrique adstricti regula Augustini" on the outer edge; the crop also includes a ~25% strip of the facing page 206 on the left, its lines cut off at the gutter [image]
Image 228: printed page 208, single column, marginals "§.18 Fabula de Augustini regula" and "§.19 Templariorum tria vota. Paupertas triplex", catchword "dem" at foot; crop includes a narrow strip (2–4 letters per line) of facing page 209 on the right [image]
Defects:
- NEW: neighbour-strip transcribed as a column · lane: ocr · on-page · page 227 · evidence: [ocr↔image] · The cut-off strip of facing p.206 is transcribed as "column 1" (`menstruis, quæ ex Ecclesiasticis re- / et. Rectius observat idem, Ca- / men Gregorii…`), every line missing its left half, and `<columns>2</columns>` is set for a one-column page. The header is merged across both pages (`A CONDANNATION DES TEMPLIERS. 207`). The translation correctly drops this strip, but it stays in the OCR view. · severity: medium
- skipped line · lane: ocr · on-page · page 227 · evidence: [ocr↔image] · Inside the neighbour strip the OCR goes from `Canonicorum pra-` straight to `riaco hist. Hierof.` and leaves out the visible line `movit seculi XII scriptor gra-`. · severity: low (the strip is junk anyway)
- margin misread changes meaning · lane: ocr→translation · on-page · page 227 · evidence: [ocr↔image], [tr↔ocr] · The image margin reads "Utrique adstricti regula Augustini" (both [kinds] bound by the Rule of Augustine). OCR has `Virique`, and the translation gives "And men bound by the rule of Augustine", which loses the section's point that BOTH seculars and regulars were bound. · severity: medium
- NEW: cropped-strip reconstruction (fabricated column) · lane: ocr · on-page · page 228 · evidence: [ocr↔image] · The right-hand strip of p.209 shows only line openings (`deti / pos / quo / & p / qua / exig / libr / & c / Atq / plan / hab / mo / divi / hon / V / Ron / Epi / habe / unu / suo / secu / no f / suis / redd / bon / Quo / rebu / pau / veni / eis se / vade / bus / Sim / P / que`). OCR turns these into fluent full Latin: `dent, sed in communi possident… Vota hæc, quæ Romani Pontifices & Episcopi exigebant, habebant in se, quod unusquisque in suo ordine…`. The model invented whole sentences to fit the fragments. The translation renders the invented text as real ("These vows, which the Roman Pontiffs and Bishops required, ensured that each man was secure…"). · severity: HIGH (fabricated primary-source text, fluent and plausible)
- NEW: cross-page duplication from the fabricated neighbour column · lane: ocr/translation · cross-page · break 228→229 · evidence: [ocr↔image] · The real p.209 text will appear again on the next page, so the reader gets two versions of p.209's opening: one invented and one genuine. · severity: high
- page-num missing from header · lane: ocr · on-page · page 228 · evidence: [ocr↔image] · The header is `DE LA CONDANNATION` without the printed "208". · low
- normalisation · lane: ocr · page 228 · [ocr↔image] · The image has "Bernhardus"; OCR has `Bernardus`. · low
- continuity meta shown · lane: display · page 228 · [tr] · The translation opens `<meta>continues from previous page: they eat meat three days a week…</meta>`. If rendered, the reader sees duplicated text. · low
Cross-page break: p.227 ends mid-sentence "pisces, ova, caseum, in refectorio diebus aliis | manducant". The translation of 227 supplies its own verb ("they use fish, eggs, and cheese on other days in the refectory"), and 228 then begins "they eat." — the verb is effectively doubled (lookahead-style completion) [tr↔image]. The §-numbering order is correct.

## Book 2: Ante-Nicene Fathers vol. 2 (English, 1913) — pages 172/173 — https://sourcelibrary.org/book/ante-nicene-fathers-vol-2-clement-of-alexandria-eds/page/69ad657f75811c30866e1da0
Image 172: printed p.158, true two-column English, chapter heads XVII and XVIII in small caps, one footnote "[Homer, Iliad… Virgil, Æn.]" [image]
Image 173: printed p.159, two columns, chapter XIX head, footnotes 1 (Kaye) and 2 (1 Cor. xv. 54) under separate columns [image]
Defects:
- NEW: English-to-English paraphrase ("translation" of an English source) · lane: translation · on-page · pages 172, 173 · evidence: [tr↔image] · The source is already English, but the "translation" is an abridged modern paraphrase (tr 2600 chars vs OCR 4388 on p.172). For example, "much more does reason… afford ground for believing in the resurrection, since it is safer and stronger than experience for establishing the truth" becomes "Reason is stronger than experience for establishing the truth", and "a life after the manner of brutes would be the best" becomes "a bestial life would be the best". A reader who wants the Roberts–Donaldson text is given a rewrite. · severity: medium
- skipped line · lane: ocr→translation · on-page · page 173 · evidence: [ocr↔image] · The image col 2 has "having been again united, each one may, in accordance with justice, receive what he has done". OCR has `having been again united, receive what he has done`, dropping "each one may, in accordance with justice," — the key word "justice" is gone from the chapter's conclusion. · severity: medium
- footnote relocated · lane: ocr · page 172 · [ocr↔image] · The Homer/Virgil footnote is inlined as a `<note>` at the reference point rather than kept at the foot. Meaning preserved. · low
- inconsistent heading levels · lane: display · page 172/173 · [tr] · The running head "THE RESURRECTION OF THE DEAD." is emitted as `# …` (H1) on 173 but as `<header>` on 172, and the chapter head is `###` on one page and plain text on the other. · low
Column order: correct on both pages (col 1 then col 2) [ocr↔image].
Cross-page break: p.158 ends "who admit God to be the Maker of this universe," and p.159 begins "to ascribe to His wisdom…". The translation joins correctly ("Those who wish to remain consistent…") but recasts the sentence [tr↔image].

## Book 3: Sefer ha-bahir / Ma'ayan ha-Hokhmah (Hebrew, 1651) — pages 15/16 — https://sourcelibrary.org/book/the-book-of-brightness-hakana/page/6911cf898cb6d2ae494a106d
Image 15: a single leaf, folio "ד" top left, header "מעין חכמה", two columns of square Hebrew, catchword "השני" at the foot of the left column; vowel-pointed alephs (five alephs with different vowels) mid right column [image]
Image 16: an UNSPLIT SPREAD. The left half is the same folio ד leaf as image 15. The right half is the facing page (header "מעיין החכמה", no folio number), two columns, catchword "והחוטין" at its foot [image]
Defects:
- spread not split + duplicate leaf · lane: image · on-page · page 16 · evidence: [image] · Image 16 is a two-page spread whose left half repeats page 15 exactly. Only the right page was OCR'd. · severity: medium
- NEW: RTL spread order inverted (pages out of reading order) · lane: image/sequence · cross-page · break 15→16 · evidence: [image], [ocr↔image] · In this Hebrew book the right page of the spread comes BEFORE folio ד. Its catchword "והחוטין" is the first word of p.15, and p.15's catchword "השני" does not match p.16's opening `הוא הרוח`. So the site's page 16 is really the page before page 15, and the reader reads the two pages in reverse. · severity: HIGH
- first-word misread with meaning change · lane: ocr→translation · on-page · page 15 · evidence: [ocr↔image] · The catchword on p.16 is "והחוטין" (and the threads), and p.15 opens with the same word. OCR reads `והחושן` (breastplate), so the translation says "the breastplate is held within the flames" instead of "the threads are held within the flames". · severity: medium
- NEW: fabricated continuation stub · lane: translation · cross-page · page 15 · evidence: [tr↔image] · The translation begins `<meta>continues from previous page: "Wo..."</meta>rds, for the breastplate…`. The word-fragment "Wo…rds" is not in the Hebrew at all; the model invented an English split word. · severity: medium
- vowel points dropped where they carry the meaning · lane: ocr · page 15 · [ocr↔image] · The image prints five alephs each with a different vowel (the five vowel-movements of aleph). OCR gives `א' א' א' א' א'`, and the translation "Aleph, Aleph, Aleph, Aleph, Aleph". The distinction the passage explains is lost. · severity: medium
- NEW: translation emitted as a partial markdown table (massive truncation) · lane: translation/display · on-page · page 16 · evidence: [tr↔ocr] · The translation is a `| [Right Column] | [Left Column] |` markdown table with 7 rows. It covers only the first ~7 lines of each column (tr 1169 chars vs OCR 2586) and stops mid-phrase ("from the Primordial Dark—"). Roughly 85% of the page, including the enumerated list of ten lights, is untranslated. Prose is also forced into a table, and the column pairing is line-by-line nonsense. · severity: HIGH
- tag schema drift · lane: ocr · page 16 · [ocr] · Uses `<lang>he</lang>` instead of `<language>`, with no `<page-num>` and no scan-quality. · low
Column order: RTL column order is correct on both pages (right column first) [ocr↔image].
Cross-page break: the translation of 15 ends "the name of the second..." and 16 begins "This is the spirit that emerges from the moisture". These do not join because the pages are in reverse order [tr↔image].

## Book 4: Musaeum Kircherianum (Latin, 1709) — pages 611/612 — https://sourcelibrary.org/book/musaeum-kircherianum-kircher/page/69af0a25dc4c98c65a3d50dc
Image 611: printed p.468, "Classis Duodecima", two columns of roman Latin, numbered entries 282–291 with large inset numerals, a Virgil couplet in italic [image]
Image 612: printed p.469, "Musaei Kircheriani", two columns, entries 292–306, italic Ambrose quotation in col 2 [image]
Defects:
- misread changes meaning · lane: ocr→translation · on-page · page 612 · evidence: [ocr↔image] · The image has "ut stimulis illis egrè contactum admittentibus" (those who reluctantly admit contact). OCR has `attententibus`, translated "those attempting to touch them with difficulty". · severity: low–medium
- long-s / r confusion · lane: ocr · page 611 · [ocr↔image] · `finitut` for "finitur" (2 instances) and `rofeus`/`fignant` long-s leftovers. Meaning preserved. · low
- missing page-num tag · lane: ocr · page 611 · [ocr] · There is no `<page-num>`; 468 appears only inside `<header>`. · low
Column order and entry numbering are correct on both pages, the verse is kept as verse, and the translation is complete and faithful on the entries I spot-checked (282, 285, 297, 306) [tr↔ocr↔image].
Cross-page break: p.468 ends "ut figura reprae-" and p.469 begins "sentat". The translation ends "as the figure represents," and 612 begins "more pleasantly viewed than described". The split word is joined once, correctly [tr↔image].

## Book 5: Preclara Francorum facinora (Latin, c.1520) — pages 68/69 — https://sourcelibrary.org/book/preclara-francorum-facinora-varia-montfort/page/69f5067ef708eae99d702fb3
Image 68: black-letter single column with heavy abbreviation (dñi, q̄, tēpore), three marginal notes on the left, and a strip of facing p.69's line-openings on the right [image]
Image 69: single column, two printed marginal notes on the right plus a handwritten red annotation "Cinera", and a strip of p.68's line-ends on the left [image]
Defects:
- neighbour-strip transcribed as a column, then "translated" · lane: ocr + translation + display · on-page · page 68 · evidence: [ocr↔image], [tr] · OCR tags `<columns>2</columns>` and transcribes the strip as a list of fragments (`the / eius / pau / tate / pro / rip…`). The translation renders these as a 30-line vertical list ("the / of him / pau / tate … France … and") under a note calling them "largely illegible". The reader sees a column of garbage. · severity: medium
- skipped line changes meaning · lane: ocr→translation · on-page · page 68 · evidence: [ocr↔image] · The image reads "in ipso quoque tempore vocatus fuit ad curiam dominus remundus episcopus tholosanus". OCR drops the line `fuit ad curiam dominus remundus episco-` and gives `vocatus tholofanus`, so the translation says "he was called to Toulouse" (i.e. the Count). The source says Lord Raymond, BISHOP of Toulouse, was summoned to the Curia. · severity: HIGH
- abbreviation garble · lane: ocr→translation · page 68 · [ocr↔image] · "cum apud patrem q̄ apud curiam moram traxit per annum" is OCR'd as `cum apud padus cotrem que apud curiam … per annes uanum`. The translation drops "both with the Father [the Pope]". · severity: medium
- marginal notes truncated · lane: ocr · page 68 · [ocr↔image] · The image margins read "Remundus comes vadit romam" and "Trāsmarinā crucē ludouicus rex moriēdo assūpsit". OCR keeps only `Remundus` and drops "moriendo" from the second ("took the cross while dying"). The translation's "Raymond." has no content left. · severity: medium
- subject inserted without a note · lane: translation · page 68 · [tr↔image] · "Eodemque tempore circum poloniam & ungariam vastant" has no subject; the translation says "the Tartars lay waste to Poland and Hungary". This is historically right but the word is not in the source and carries no `<note>`. · low
- handwritten annotation passed as a printed margin · lane: ocr/translation · page 69 · [ocr↔image] · The red manuscript "Cinera" is emitted as `<margin>Cinera</margin>` and translated "Remains." with nothing telling the reader it is a later hand. · low
- marginal text misread · page 69 · [ocr↔image] · "Mulieres dispensationem prohibuerunt" is OCR'd `Abulieres`, yet the translation correctly guesses "The queens prohibited…". · low
- empty `<column-break/>` + columns=2 on a single-column page · lane: ocr · page 69 · [ocr↔image] · low
Cross-page break: 68 ends "…treated regarding the marriage to be contracted between the same Count—" and 69 begins "—of Toulouse and Beatrice". The join is correct, but on the site page 68's fragment list sits between them [tr↔image].

## Book 6: Zenon Papyri vol. III (Greek papyri with English/French apparatus, 1928) — pages 69/70 — https://sourcelibrary.org/book/zenon-papyri-vol-iii-cairo-museum-edgar/page/6953cc4077f38f6761be184f
Image 69: UNSPLIT SPREAD, printed pp.124–125: diplomatic Greek papyrus texts with line numbers, English headings and commentary, French running heads [image]
Image 70: unsplit spread, pp.126–127, nos. 59383 (end)–59386, with drachma signs (⊢), double-bracket deletions, and an interlinear addition "ιστ....." [image]
Defects:
- spread not split, labelled as 2 columns · lane: image/ocr · on-page · pages 69, 70 · [image] · Each image holds two printed pages. OCR copes (two page-nums, two headers) but tags `<columns>2`. · low
- NEW: diplomatic-orthography normalised away (editor's sic erased) · lane: ocr · on-page · pages 69, 70 · evidence: [ocr↔image] · The papyrus text preserves the scribe's spellings, and the editor comments on them. OCR silently "corrects" them. No. 59381 line 5: the image has "πλεράν", OCR has `πλευρὰν`, yet the note still says "Read πλευράν" (now self-contradictory). No. 59384 line 15: the image has "μέντον", OCR has `μέντοι`, while the commentary says "μέντον for μέντοι occurs in both texts". Line 16: the image has "προσανγέλματι", OCR has `προσαγγέλματι`. The same happens in the commentary (`προσάγγελμα` for printed "προσάνγελμα"). The scholarly point of the edition is destroyed. · severity: HIGH (for this kind of book)
- wrong language tag · lane: ocr · page 69 · [ocr↔image] · `<language>English</language>` on a page that is mostly Greek text with French heads (p.70 says "English, Ancient Greek"). · low
- NEW: editorial prose "translated" with added glosses and dropped figures · lane: translation · on-page · page 69 · evidence: [tr↔image] · The editor's English description is rewritten rather than kept. It adds "(the Finance Minister of Egypt)" and "of King Ptolemy II Philadelphus's reign", which are not on the page. For 59383 it replaces the figures "an obol and a half for each schoinion… an obol per schoinion" with "noting the specific labor costs". · severity: medium
- numeric/metrological mistranslation · lane: translation · on-page · page 70 · evidence: [tr↔ocr↔image] · σχοινία is rendered "ropes" ("20 ropes at [rate]"), although the editor's own summary says schoinia is a length measure. `| α ς` is rendered "1 drachma 6 obols", which is an impossible sum (6 obols = 1 drachma) and is not what the sigla say. · severity: medium
- unverifiable continuity meta · lane: translation/display · pages 69, 70 · [tr] · Each translation opens with a `<meta>` summarising "the previous page… swineherd Amenneus… theft of pigs". The claim cannot be checked on this page and would show as text if the tag is not stripped. · low–medium
- centering/gloss markup · lane: display · pages 69, 70 · [ocr], [tr] · `->Ἀμμώνιος Ζήνωνι<-` centering arrows on every line, and the interlinear addition as `<gloss>ιστ . . . . .</gloss>` (translated to `<gloss>... ... ...</gloss>`). If not handled, raw arrows or a misleading "gloss" appear. · low
Cross-page break: p.125 ends "ναῦον, βάθος ἡμι-" and p.126 begins "ναυον | τῶν τεσσάρων". The translation of 69 ends "one nauon, depth half-" and 70 begins "...of the four outlets". The second half of the split word ("-nauon") is DROPPED, so "half-nauon" never completes [tr↔image].

## Summary
Defects by class (pages affected):
- neighbour-strip transcribed as column (incl. fragment list shown to reader): 2 (B1 p227, B5 p68)
- NEW cropped-strip reconstruction / fabricated column: 1 (B1 p228)
- skipped line (meaning-changing): 3 (B2 p173, B5 p68, B1 p227 strip)
- misread changing meaning (word-level): 3 (B1 p227 margin, B3 p15, B4 p612)
- marginalia truncated / handwritten not flagged: 2 (B5 p68, p69)
- spread not split: 3 (B3 p16, B6 p69, p70)
- NEW RTL spread order inverted / pages reversed: 1 break (B3)
- NEW English-to-English paraphrase: 2 (B2 p172, p173)
- NEW partial markdown-table translation (truncation): 1 (B3 p16)
- NEW fabricated continuation stub: 1 (B3 p15)
- NEW diplomatic-orthography normalised: 2 (B6 p69, p70)
- NEW editorial prose rewritten with glosses/dropped numbers: 1 (B6 p69)
- vowel points dropped: 1 (B3 p15)
- numeric mistranslation: 1 (B6 p70)
- split word dropped / verb doubled at break: 2 breaks (B6, B1)
- tag/schema errors (columns=2 on one-column page, wrong language, lang tag drift, missing page-num): 6
- display (meta/markup/heading levels): 4

NEW classes proposed:
- neighbour-strip-as-column: the crop includes a sliver of the facing page and OCR treats it as a real column.
- cropped-strip reconstruction: OCR turns line openings into fluent invented text (fabrication that looks real).
- RTL spread order inverted: in Hebrew books the split/sequence puts the right-hand (earlier) page after the left.
- English-to-English paraphrase: an English source gets a "translation" that condenses and rewrites it.
- partial table translation: the translation is forced into a line-aligned markdown table and stops after a few rows.
- fabricated continuation stub: the translation invents a split English word ("Wo…rds") to fake a page join.
- diplomatic-orthography normalisation: OCR corrects deliberate non-standard spellings that the editor's apparatus comments on.
- editorial prose rewritten: the modern editor's English apparatus is paraphrased, with glosses added and figures dropped.

Surprises: "multicol" here is mostly NOT true multi-column. Of the 12 images, only B2 and B4 are real two-column pages, and both are handled well. Most failures come from crops that include a strip of the facing page, or from unsplit spreads, both tagged `<columns>2`. The worst case (B1 p228) is a strip turned into fluent invented Latin that the translation then renders faithfully, which a translation-only judge would never catch. The Hebrew book has its pages in reverse order, which is detectable from the catchwords alone (catchword-matching is a cheap automatic detector for both page order and dropped lines at the foot).
