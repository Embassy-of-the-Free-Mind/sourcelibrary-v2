# Blind page review — two English translations of a Tibetan Tengyur page, read against the page image

You review 3 consecutive pages of one volume of the Derge Tengyur (Madhyamaka or Pramāṇa section, classical Tibetan
commentary, woodblock print). For each page `pN` in your directory you have:

- `pN.jpg` — the page image (a long, narrow pecha folio), and `pN.c1.jpg`, `pN.c2.jpg`, `pN.c3.jpg` — the same image in
  three overlapping 2×-upscaled crops, left to right. **Open the crops with the Read tool and read the Tibetan.** You
  must open the images; do not judge from the OCR alone.
- `pN.ocr.txt` — the stored Tibetan transcription. Check it against the image where it matters for meaning.
- `pN.A.txt`, `pN.B.txt` — two English translations of the page, in random order. Tags like <term>, <gloss>, <note>,
  <meta> are part of the format; ignore formatting.

For each page, and for EACH of A and B separately, list the **serious meaning errors** against the Tibetan on the image:
a reversed or negated claim; objection read as reply or wrong speaker; an omitted or invented sentence/clause that
matters; a technical term mistranslated so the argument changes; text not on this page. Style, word choice,
transliteration and minor omissions are NOT serious. Be concrete: quote the Tibetan (Unicode or Wylie) and the English.
Do not guess which version is newer.

Reply with ONLY this JSON (no prose outside it):
{"vol": <n>, "pages": [{"page": <N>, "image_matches_ocr": "yes|mostly|no", "A_serious": [{"class": "...", "tibetan": "...", "english": "...", "problem": "..."}], "B_serious": [...], "better": "A|B|same", "note": "<one sentence>"}]}
