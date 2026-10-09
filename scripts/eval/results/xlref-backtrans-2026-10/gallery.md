# Gallery — what the reference-free check catches, what it cries wolf on, what it misses (#5695 extra test)

Detector shown: **D3**, the direct check (Flash-Lite reads the source page and our English and lists contradictions).
"Judges" are the two blind Opus judges of each track, who had a published human translation beside the page.
Each item was read by eye for this gallery. Source quotes are the OCR as stored.

## 5 true catches (the detector quoted the same spot as the judges)

| # | page | source | our English | what D3 said |
|---|---|---|---|---|
| 1 | Latin, [p. 196](https://sourcelibrary.org/book/69b2ff19a1a4246ddb45ae6a?page=196) | *nemini non inuidens, si quid quantumlibet inepte moliatur in hoc genere* | "envying no one if they attempt anything however foolishly in this field" | "The source says he envies everyone (nemini non = everyone), but the English says he envies no one." D2 caught it too. |
| 2 | Greek, [p. 615](https://sourcelibrary.org/book/699376f4b0a84a576396231b?page=615) | ἔτεσι τεσσεράκοντα καὶ διηκοσίοισι | "four hundred and forty years after the second disappearance of Aristeas" | "The source says 240 years, but the English says 440." D2 caught it too. |
| 3 | Persian (Arabic quotation), [p. 257](https://sourcelibrary.org/book/69e729a1a409200ea79f0ca5?page=257) | فمن غلب عقله شهوته فهو اعلی من الملائکة | "whoever overcomes his intellect with his desire, he is higher than the angels" | "The English swaps the roles of intellect and desire, claiming the one who lets desire win is higher than angels." |
| 4 | Tibetan (Tengyur draft), [p. 134](https://sourcelibrary.org/book/6abeafd3896ea18127c8218e?page=134) | གཟུགས་ཅན་གྱི་ཆོས་རྣམས་ནི་ཡུལ་ན་མི་གནས་པའི་ཕྱིར་རོ | "because material phenomena do not fail to reside in an object" | "The source says material phenomena do not reside in an object, but the English says they do not fail to reside (i.e., they do reside)." |
| 5 | Greek, [p. 160](https://sourcelibrary.org/book/699389f10f04c37dcfa627f0?page=160) | γὰρ ἂν αὐτῷ ὁ ἀσκληπιὸς | "for Asclepius would [not] say to him" | "The English adds a 'not' that is absent in the source text." |

## 5 false alarms (the judges quoted no reversal on the page)

| # | page | source | our English | what D3 said | by eye |
|---|---|---|---|---|---|
| 1 | Dutch, Ruusbroec, [p. 297](https://sourcelibrary.org/book/69790e9eeb0dcfd399123423?page=297), judges 5/5 | *der middel met Godt in dese eenicheydt* (the page opens mid-word: *[son]der middel*) | "without mediation" | "The source says 'the medium/means with God', but the English translates it as 'without mediation'." | **Detector wrong.** The word is split across the page break; our English completed it correctly. |
| 2 | Dutch, Swammerdam, [p. 105](https://sourcelibrary.org/book/69a5d924a63a00aaae8aae3b?page=105), judges 5/5 | *mint.* (last word of a sentence begun on the previous page) | "loves." | "'mint' … is used here as a typo for 'niet' (not)" | **Detector wrong.** It invented a typo. Again the first word of the page. |
| 3 | Tibetan, [p. 135](https://sourcelibrary.org/book/6abeafd3896ea18127c8218e?page=135), judges 5/5 | གཞན་གྱི་དབང་ལ་ནི་འཕེལ་བ་དང་། འགྲིབ་པ་གཉིས་མེད་དེ་ཀུན་བརྟགས་པ་ཙམ་དུ་ཟད་དོ | "there is neither increase nor decrease; they are merely conceptual constructions" | "The source says they are merely 'dependent' (gzhan dbang), but the English translates it as 'conceptual constructions' (kun brtags)." | **Detector wrong.** The source does say *kun brtags pa tsam*. |
| 4 | Greek, ps.-Dionysius, [p. 302](https://sourcelibrary.org/book/6a100a5cf71729295096f838?page=302), judges 4.5/5 | αἴνων ἱερῶν ἀξίας εἶναι τὰς θεαρχικὰς ἀγαθουργίας | "divine benefits are worthy of the highest praise" | "The source says … worthy of sacred praise, not the highest praise." | **True but small.** A loose word, not a reversal. Marked "high certainty". |
| 5 | Tibetan, [p. 674](https://sourcelibrary.org/book/6abee360a43718d234bf1fb5?page=674), judges 4.5/5 | ཞི་འགོག་བདུད་རྩི་ཤིན་ཏུ་གྱ་ནོམ་གང་། | "The cessation of peace, the nectar that is truly excellent" | "The source refers to the 'peaceful cessation' (nirvana), not the 'cessation of peace'." | **Detector right, judges silent.** A real meaning error that the judges did not quote as a reversal. |

Three of the five are the detector misreading the source, one is a quibble, one is a real fault. So the measured precision is a little pessimistic, but most alarms are still not reversals.

## 5 misses (both judges or one quoted a reversal; D3 listed nothing)

| # | page | source | our English | why it matters |
|---|---|---|---|---|
| 1 | Latin, Augustine, incunable, [p. 505](https://sourcelibrary.org/book/699062f5ef12272ffdc8e9d5?page=505) | *Quod nō ita eē itelligēdum i scripturis grecis facillie repť* | "That it should be understood this way is very easily found in the Greek scriptures" | The *nō* (non) is dropped: the sentence is reversed. D2 missed it as well. The negation count (D1) flagged the page. |
| 2 | Latin, [p. 62](https://sourcelibrary.org/book/69b2ff0ea1a4246ddb45adbb?page=62) | *leges abrogatas consuetudine haud temere reuocet* | "He should not rashly revoke laws that have fallen into disuse" | *reuocet* is "call back into force"; "revoke" says the opposite. D2 missed it. |
| 3 | Latin, [p. 63](https://sourcelibrary.org/book/69523495ab34727b1f044a45?page=63) | *sicut deo permittente occidere possunt homines* (the devils can kill men) | "just as men can kill other humans when God permits it" | Subject and object swapped. D2 missed it. |
| 4 | Greek, Horapollo, [p. 60](https://sourcelibrary.org/book/69bd9d6a6120d54bd0376a04?page=60) | βία δὲ ὑδρεῖα (the print has τρία, three) | "They also depict two water vessels, neither more nor less" | The error began in the OCR. A check that reads the OCR text cannot see it. |
| 5 | Persian, Shahnameh, [p. 100](https://sourcelibrary.org/book/6992cf0970ab3737555456ae?page=100) | همی کوفت پای و همی زد بدست | "The woman struck out with her feet and hands in pain" | Who strikes whom is reversed (the reference: he "spurned and smote her"). |
