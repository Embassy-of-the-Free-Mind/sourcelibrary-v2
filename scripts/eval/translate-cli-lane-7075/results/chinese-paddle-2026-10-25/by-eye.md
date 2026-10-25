# By-eye check, Chinese adoption sample (#6871, rule 3 of sample.mjs)

Three Opus reads checked against the page image and the stored Paddle OCR, 2026-10-25.

| page | book | verdict |
|---|---|---|
| 6a3c5f0940c88a541d8e66e5 p.113 | 景岳全書·卷七 | Faithful. The section title 論今時皆合病併病, which Paddle split into single characters, is restored as a title. Folio rendered "52" from Paddle's scrambled 五二十 (the leaf has 二十五). Nothing invented. |
| 6a3c6231879008ba7e161733 p.86 | 西清古鑑 vol 45 | Faithful to the leaf: the measurements (1 chi 3 cun 9 fen, 151 liang, linked-ring handles) are right. The metric conversion is in a `<note>` and is correct. **Paddle invented ten `<header>卷一…卷十</header>` lines not on the leaf.** Both the stored 3 Flash English and Opus translate them; Opus flags them as OCR noise in a `<meta>`. Not contained: the leaf's real text is present and correct, and the extra lines are bare volume numbers. |
| 6a3c5e5540c88a541d8e1111 p.87 | 錦繡萬花谷別集 | No invention. Paddle runs the small interlinear author names into the verse line, so 崔鶠 becomes "It hurries the gulls early"; Opus marks several attributions uncertain. OCR-driven, not a translation invention. |

**The two pages the judges gave to the old reader** (6a3c5f0940c88a541d8e66e5, 6a3c5f12879008ba7e152b8f) are the
production page-break device, not invention. The previous leaf ends mid-clause (是豈非太陽 / 若脾胃素實止因倍), and
Opus's `<meta>` quotes it or its English opens by finishing it ("doubling their portion of food" = 倍 + 食暴傷). The
judges see one page only, so they read the bridge as added text.

Rule 3: no invented passage in the new reads.
