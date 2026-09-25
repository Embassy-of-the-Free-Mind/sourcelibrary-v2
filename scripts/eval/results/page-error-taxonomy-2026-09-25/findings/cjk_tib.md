# cjk_tib — by-eye findings
Books read: 6 of 6. Images opened: 12 of 12 (plus two crops of the Tibetan leaves, Book 3).

Reader caveat: I read Chinese/hanja characters directly from the images. I could NOT read the Tibetan dbu-med (cursive) script word by word at this resolution. The Book 3 verdict rests on structural evidence visible without reading it: line counts, punctuation marks, leaf openings, and repetition.

## Book 1: 遵生八牋 卷十八 (Chinese, Siku Quanshu copy) — pages 78/79 — https://sourcelibrary.org/book/vol-15-1782366603779/page/6a3cc18bec254ff6cae0d433
Image 78: the right half-folio of a Siku Quanshu manuscript-style print, read in vertical columns from right to left. Block-heart edge shows 欽定四庫全書 top and 卷十八. Heading 飛龍奪命丹, then a drug list with small interlinear double-column doses. Ends mid-sentence with 以. [image]
Image 79: the left half-folio. Block heart shows 遵生八牋 and folio 三十九. Continues 酒打糊為丸. Sub-heading 箍藥方. Ends 神驗也. [image]
Defects:
- OCR misread (graphically similar character) · lane: ocr · on-page · page 78 · evidence: [ocr↔image] · The image has the stock pill-size phrase 如菉豆大 ("size of a mung bean"); OCR reads 菜豆 and the translation gives "the size of a vegetable bean". The meaning shifts slightly. · severity: low
- NEW: block-heart title tagged as catchword · lane: ocr · on-page · page 79 · evidence: [ocr↔image] · `<meta>Catchword: 遵生八牋</meta>`: 遵生八牋 is the book title printed in the fold (版心), not a catchword. Chinese books have no catchwords. The same mislabel appears in Book 6 p.56. · severity: low
- page-num tag holds the juan number · lane: ocr · on-page · page 78 · evidence: [ocr↔image] · `<page-num>卷十八</page-num>`: 卷十八 is the chapter (juan) label in the block heart, not a page number. On p.79 the tag correctly gives 三十九, so the two pages of one folio are tagged inconsistently. · severity: low
- running head dropped · lane: ocr · on-page · page 78 · evidence: [ocr↔image] · The 欽定四庫全書 edge title does not appear anywhere in the OCR. · severity: low
- romanisation slip · lane: translation · on-page · page 78 · evidence: [tr↔ocr] · 蝸牛 (woniu) is romanised "Guaniu". · severity: low
Interlinear small-character doses: all were kept and correctly attached to their drugs as `<gloss>`. [ocr↔image]
Cross-page break: p.78 ends "mixing the medicine with—" (以) and p.79 opens "—wine-thickened paste" (酒打糊). The join is correct, with nothing lost or doubled. [tr↔image]

## Book 2: Ponjo sebo kinyŏn (Classical Chinese, Korea, c.1800) — pages 68/69 — https://sourcelibrary.org/book/ponjo-sebo-kinyon/page/69f33e96876dd827cbc5fb70
Image 68: woodblock page with 10 vertical columns inside a frame. Upper margin carries handwritten topic headings (南黨沮兩賢享議 / 孝廟南人參用 / 顯廟己亥南人復肆). Blue-ink circles and lines mark names. A small handwritten interlinear note sits between two columns near 薨莊烈后. Bleed-through is visible. [image]
Image 69: same layout, 10 columns. Upper-margin handwritten headings (肅廟庚申西人當國 / 金清城討堅鐫之逆 / 金益勳起璽瑛之獄 / 擯勳戚西人分老少), plus a separate 宣祖 lower in the margin. Small double-column note (年高曰老) in the second-to-last column. [image]
Defects:
- NEW: interlinear handwritten note misread and relocated, then glossed by invention · lane: ocr+translation · on-page · page 68 · evidence: [ocr↔image], [tr↔ocr] · The small handwritten note beside 薨莊烈后 reads roughly 仁祖主后 on the image (so it identifies Queen Jangnyeol as Injo's consort). OCR renders it as `<gloss>下禮主后</gloss>` on a line of its own. The translation then attaches a gloss that is in neither the OCR nor the image: "King Hyojong <gloss>the second son who succeeded the throne</gloss>". · severity: medium
- OCR misread changes the event · lane: ocr→translation · on-page · page 68 · evidence: [ocr↔image], [tr↔ocr] · The image reads 用隧道葬父 ("buried his father using a tomb-tunnel", a ritual transgression that Min Yu-jung impeached). OCR has 用遂道獎父, and the translation invents "used his position to recommend his father-in-law Min Yu-jung and criticize the mistakes of others". Min Yu-jung is the impeacher, not the person recommended. · severity: high
- name misread · lane: ocr→translation · on-page · page 68 · evidence: [ocr↔image] · The image has 權諰 (Kwon Si). OCR has 權認, and the translation gives "Kwon In". · severity: medium
- sense inverted · lane: translation · on-page · page 69 · evidence: [tr↔ocr] · 頼文谷金守恒抗章力討鐫等計不售 means "thanks to Kim Su-hang's forceful memorial, Yun Hyu's plot failed". The translation reads "he relied on Kim Su-hang … to punish Yun Hyu, but the plan did not succeed", which turns the defeat of the plot into U-myeong's failure. · severity: high
- marginal heading misread and a name lost · lane: ocr→translation · on-page · page 69 · evidence: [ocr↔image] · The image has 金益勳起璽瑛之獄. OCR has 起重瑛之獄, so the translation reads "raises the treason case of Heo Yeong" and drops Heo Sae (許璽). · severity: medium
- marginal note dropped in translation · lane: translation · on-page · page 69 · evidence: [tr↔ocr] · 宣祖 is present in the OCR `<margin>` but missing from the translation's margin. · severity: low
- NEW: broken margin markup (empty open tag plus orphan close tag) · lane: display · on-page · pages 68 and 69 · evidence: [tr] · Each translation starts `<margin></margin>`, then the heading lines, then a stray `</margin>`. The headings therefore sit outside the margin element and the orphan tag risks rendering raw. The same pattern occurs in Book 5 p.98, so it is systematic. · severity: medium
- tag inconsistency · lane: ocr · on-page · pages 68/69 · evidence: [ocr↔image] · `<script>` is "printed" on p.68 but "mixed" on p.69, although both pages have handwritten margins over a woodblock body. · severity: low
- page-final character dropped · lane: translation · cross-page · page 69 · evidence: [tr↔image] · The last character, 退 (start of the next name, 退憂 Kim Su-heung), is silently dropped. · severity: low
Cross-page break: p.68 ends 圖為不軌先 and p.69 begins 欲去佑明. The translation carries 先 across as "The plotters first intended to remove Kim U-myeong", which is correct. [tr↔image]

## Book 3: nyang gter thugs sgrub bde bshegs 'dus pa (Tibetan, Drametse, c.1700) — pages 90/91 — https://sourcelibrary.org/book/nyang-gter-thugs-sgrub-bde-bshegs-dus-pa-collection/page/69e787a04a6785cfd60cc9f1
Image 90: three separate loose pecha leaves photographed together on a board, in handwritten dbu-med (headless cursive), NOT dbu-can. Leaf 1 has 6 full lines. Leaf 2 has 3.5 lines, of which lines 3–4 are in a smaller, different hand, and the rest of the leaf is blank. Leaf 3 is framed by a red double border with a left side panel and has 4 lines. The terma punctuation ༔ (gter-tsheg) appears throughout. [image, crop]
Image 91: three more leaves, each framed in red with a left panel that carries a vertical folio label in dbu-med. Leaf 1 has 6 lines, leaf 2 has 7, leaf 3 has 7. Each leaf opens with a yig-mgo and ༔ after a gap, and each opening is visibly different. [image, crop]
Defects:
- NEW: templated/repeated-block OCR fabrication · lane: ocr · on-page · pages 90 and 91 · evidence: [ocr↔image] · On p.91 the OCR gives three "Folios" with byte-identical text (ཚེ་སྒྲུབ་འཆི་མེད་འདུས་པའི་བཀའ་སྲུང་གི་གསོལ་མཆོད་བཞུགས་སོ … ×3). The three leaves on the image have different openings and different line counts (6/7/7). On p.90, "Second Strip" and "Third Strip" repeat the same two sentences word for word. The image shows a 3.5-line leaf in two hands and a framed 4-line leaf, which cannot be the same text. · severity: high
- OCR text grossly shorter than the page (invented formulaic text) · lane: ocr · on-page · pages 90/91 · evidence: [ocr↔image] · Each leaf carries 6–7 long dense lines, but the OCR gives about 3–5 short formulaic sentences per leaf. The OCR has no ༔ at all, only ། shad, while the image uses ༔ between nearly every phrase. That is decisive: the text was not transcribed from these leaves. · severity: high
- wrong script tag · lane: ocr · on-page · pages 90/91 · evidence: [ocr↔image] · `<warning>Handwritten Uchen script</warning>`, but the leaves are dbu-med (headless cursive). · severity: medium
- leaf labels/folio numbers dropped and invented · lane: ocr · on-page · page 91 · evidence: [ocr↔image] · The vertical dbu-med folio labels in the left panels are not transcribed. Instead the OCR invents "Folio 1/2/3" headings. · severity: medium
- second hand not flagged · lane: ocr · on-page · page 90 · evidence: [ocr↔image] · Leaf 2's added lines in a different, smaller hand are neither transcribed nor noted. · severity: low
- fabrication translated faithfully · lane: translation · on-page · pages 90/91 · evidence: [tr↔ocr] · The translation renders the repeated blocks three times ("The offering ritual for the protectors …" ×3). A reader sees the same paragraph three times and none of the real text. · severity: high
- note rendered as content · lane: display · on-page · page 90 · evidence: [tr] · `<note>A red rectangular border encloses the text.</note>` is shown inline as if it were text. · severity: low
Line-drop defect (known lower-leaf first-line loss): cannot be assessed here. The OCR bears no line-level relation to the leaves, which is a worse failure. [ocr↔image]
Cross-page break: p.90 and p.91 are separate groups of three loose leaves each, so there is no textual join to check. Both pages' OCR is fabricated, so the join is meaningless. [tr↔image]

## Book 4: Mubo (Korean genealogy, hanja, c.1900) — pages 239/240 — https://sourcelibrary.org/book/mubo/page/69f3248552a77bb28fdb33af
Image 239: handwritten index of surnames in 5 vertical columns, right to left. Each large surname has small bon-gwan (clan seat) names written beside it. Modern blue/grey pencil numbers (p.90, 62, 68, 96, 38, 83, 52, 56) are scattered on the page. [image]
Image 240: printed genealogy grid for 平壤趙氏 (block heart shows 平壤趙氏 and folio 一). Generations run in horizontal bands and lineages in vertical columns, with blue circles. The bottom band lists sons-in-law with their clan seats (朴致寬 慶州人 …). A red ownership seal is at lower right. [image]
Defects:
- NEW: interlinear annotation tagged as `<margin>` · lane: ocr/display · on-page · page 239 · evidence: [ocr↔image] · Every bon-gwan is wrapped in `<margin>…</margin>` inline ("趙 <margin>平壤 楊州 …</margin>"). They are small characters beside the surname, not marginalia. If the site lifts `<margin>` into a side rail, the seats are torn away from their surnames. · severity: medium
- omission of a small annotation · lane: ocr · on-page · page 239 · evidence: [ocr↔image] · 黃 has four seats on the image (昌原 尙州 長水 紆州), but OCR lists 3 and drops 長水. · severity: low
- misread place name · lane: ocr→translation · on-page · page 239 · evidence: [ocr↔image] · The seat beside 宋 is 鎭川 on the image; OCR has 鎭州 and the translation gives "Jinju". · severity: low
- pencil index numbers dropped · lane: ocr · on-page · page 239 · evidence: [ocr↔image] · The modern pencil numbers are not recorded, although the OCR meta mentions them. · severity: low
- NEW: cyclical (ganzhi) years resolved to guessed Gregorian dates · lane: translation · on-page · page 240 · evidence: [tr↔ocr] · The translation asserts "甲戌 → 1874", "己亥 → 1899", "癸卯 → 1903", "戊申 → 1908", "辛亥 → 1911" and more, with nothing in the source fixing the 60-year cycle. It also renders OCR 甲人部 as "the Mu-in 1938 department", which matches neither the characters nor the cycle. A reader takes the dates as source facts. · severity: high
- genealogy grid flattened into markdown tables that mis-map the structure · lane: ocr/display · on-page · page 240 · evidence: [ocr↔image] · The two markdown tables transpose the vertical-lineage and horizontal-generation grid, and the second table puts the sons-in-law band into arbitrary columns. The `<br/>`, `<margin>` and `<gloss>` tags inside cells, and the nested `<gloss>…<gloss>…</gloss>…</gloss>` in the translation, risk raw rendering. · severity: medium
- NEW: false continuity meta · lane: translation · cross-page · page 240 · evidence: [tr↔image] · `<meta>continues from previous page</meta>`, but p.240 is folio 一, the start of the Pyongyang Cho chart. P.239 is a separate surname index. · severity: low
- page number not tagged · lane: ocr · on-page · page 240 · evidence: [ocr↔image] · The block-heart folio 一 is not captured as `<page-num>`. · severity: low
Cross-page break: there is no textual continuation (an index page followed by the first chart page). The translation wrongly claims one. [tr↔image]

## Book 5: 遵生八牋 卷五~卷六 (Chinese, Siku Quanshu) — pages 97/98 — https://sourcelibrary.org/book/vol-4-1782366591974/page/6a3cc17fec254ff6cae0cd88
Image 97: right half-folio with 欽定四庫全書 at the top edge and 卷六 in the block heart. The end of a formula with interlinear doses, then the heading 冬季攝生消息論, then 2 text columns ending 奉生者. [image]
Image 98: left half-folio with 遵生八牋 and folio 七 in the block heart, 8 columns ending 溫煖衣. [image]
Defects:
- NEW: hallucinated running head (wrong book title) · lane: ocr · on-page · page 97 · evidence: [ocr↔image] · `<header>金匱要略全書 卷六</header>`, but the image reads 欽定四庫全書 卷六. The model substituted a different classic (Jingui Yaolue), and its vocab also lists 金匱要略. · severity: medium
- block-heart title misread · lane: ocr→translation · on-page · page 98 · evidence: [ocr↔image] · The image has 遵生八牋 and OCR has 養生八牋. The translation renders it "Eight Discourses on Health Maintenance", which is the wrong title. · severity: low
- sense inverted · lane: translation · on-page · page 98 · evidence: [tr↔ocr↔image] · Image and OCR agree: 冷藥不治熱極熱藥不治冷極 ("cold drugs do not cure extreme heat; hot drugs do not cure extreme cold"). The translation says "Cold medicine cannot treat extreme cold, and hot medicine cannot treat extreme heat", which reverses both clauses into the opposite medical claim. · severity: high
- dosage misread as duration · lane: ocr→translation · on-page · page 97 · evidence: [ocr↔image] · 空心鹽湯服七丸日再服 = "take 7 pills with salt broth on an empty stomach, twice a day". OCR has 七九 and the translation gives "for seven to nine days, then repeat the dose". The character on the image is most likely 丸 (the OCR itself uses 丸 in Book 1). · severity: medium
- broken margin markup · lane: display · on-page · page 98 · evidence: [tr] · Same pattern as Book 2: `<margin></margin>` + text + orphan `</margin>`. · severity: medium
Cross-page break: p.97 ends 奉生者 and p.98 begins 少 (奉生者少, "little is supplied for spring growth"). The translation ends p.97 with "failing the cycle of life." and starts p.98 "At this time…". The split word 少 is absorbed into a loose paraphrase, so the meaning is approximately kept. [tr↔image]

## Book 6: 李卓吾先生批評西遊記 vol.34 (Chinese, 1592 ed.) — pages 55/56 — https://sourcelibrary.org/book/journey-to-the-west-vol-34-wu-cheng-en-li/page/69dea7c3914eeed04ca4b512
Image 55: woodblock half-folio with 10 columns and dot punctuation. The top edge is slightly cropped: a faint 西遊記 fragment survives at top right. Ends 方完藏數今. [image]
Image 56: half-folio with 9 columns. The block heart shows 西遊記, 第一百回 and a folio numeral (十一/十二, low-contrast). Ends with the first line of a verse, 當年清晏樂昇平…僧演法. [image]
Defects:
- dropped characters · lane: ocr · on-page · page 55 · evidence: [ocr↔image] · The image reads 原來那太宗自貞觀十三年. OCR drops 那 and 自. The meaning is intact. · severity: low
- wrong subject in translation · lane: translation · on-page · page 55 · evidence: [tr↔ocr] · 孫大聖三位也不消去，汝自去 = "Great Sage Sun and the other two need not go; you go alone". The translation gives "You and the three disciples of Great Sage Sun need not go down either. You go yourself", which is self-contradictory and misattributes. · severity: medium
- NEW: chapter/folio numbers misread in the block heart · lane: ocr · on-page · page 56 · evidence: [ocr↔image] · `<sig>第一回</sig>` and `<page-num>1</page-num>`, but the image shows 第一百回 (chapter 100) and a two-character folio numeral. `<sig>` is also the wrong tag, since this is not a signature. · severity: medium
- block-heart title tagged as catchword · lane: ocr · on-page · page 56 · evidence: [ocr↔image] · `<meta>Catchword: 西遊記</meta>`. Same class as Book 1. · severity: low
- NEW: modern punctuation injected into OCR · lane: ocr · on-page · page 56 · evidence: [ocr↔image] · P.56 OCR adds full-width ，。： throughout, though the image has only small dot marks. P.55 OCR has no punctuation, so the transcription policy differs within one book. · severity: low
- character misreads · lane: ocr · on-page · page 56 · evidence: [ocr↔image] · 犬聖輸金箍棒 for image 大聖輪金箍棒. The translation silently corrects this ("Great Sage Sun, wielding his golden-banded staff"). · severity: low
- minor omission · lane: translation · on-page · page 56 · evidence: [tr↔ocr] · 扣背 (saddle it) is dropped from "prepare the imperial carriage and horses". · severity: low
Cross-page break: p.55 ends 今 → "Now..." and p.56 begins 已過五月有餘 → "...more than five months have passed". The join is correct and Vajra's speech continues. Only the first verse line on p.56 is translated, which is correct for this page. [tr↔image]

## Summary
Defects by class (pages affected):
- Translation sense inverted or wrong subject: 3 (B2 p69, B5 p98, B6 p55)
- OCR character misread propagated into translation (names, places, events, doses): 6 (B1 p78, B2 p68, B2 p69, B4 p239, B5 p97, B6 p56)
- NEW templated/repeated-block OCR fabrication: 2 (B3 p90, p91)
- Wrong script tag: 2 (B3)
- Block-heart (版心) metadata mis-tagged: catchword ×2, page-num ×2, sig ×1, hallucinated header ×1 (B1, B5, B6)
- Broken `<margin>` markup in translation: 3 (B2 p68, p69, B5 p98)
- Interlinear small characters mishandled: tagged `<margin>` (B4 p239); relocated and misread (B2 p68)
- Invented date resolution for ganzhi years: 1 (B4 p240)
- Genealogy grid mis-mapped into markdown tables: 1 (B4 p240)
- False "continues from previous page": 1 (B4 p240)
- Page-final character dropped: 1 (B2 p69)

NEW classes proposed:
- Templated block repetition: the OCR emits the same paragraph for several distinct leaves or strips. It can be detected by identical blocks within one page's OCR.
- Block-heart mis-tagging: the title, juan and chapter numbers in the fold of a Chinese/Korean book get tagged as catchword, page-num or sig, or are hallucinated as a different book's title.
- Ganzhi year resolution: the translator converts cyclical years to specific Gregorian years that the source does not determine.
- Interlinear-note-as-margin: small characters beside a main character are tagged `<margin>`, which detaches them on display.
- Orphan-close margin: the translation emits `<margin></margin>` + content + `</margin>`.
- False continuity meta: the translation claims "continues from previous page" at the start of a new section.
- Punctuation injection: modern CJK punctuation is added to unpunctuated woodblock text, inconsistently across pages of one book.

Surprises:
- Vertical right-to-left column order was correct on every CJK page, and interlinear double-column doses were handled well (Book 1, Book 5). The main-text OCR is mostly accurate.
- The damage is in single misread characters that the translator then builds whole false clauses on (隧道葬父 → "recommend his father-in-law"). It is also in fluent inversions of the source's logic (cold/hot drugs reversed), which only a source-grounded read catches.
- The Tibetan pages are the worst: nothing on them is transcribed. The ༔ test (terma punctuation on the image, absent from the OCR) is a cheap automatic detector for fabricated Tibetan OCR on gter-ma texts.
