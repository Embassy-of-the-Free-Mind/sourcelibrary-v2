---
stage: image
measure: judged
languages: []
scripts: []
canons: []
n_books: 45
n_pages: 110
verdict: "21 of the 45 high-flag books carry wrong text on a page read by eye. The multi-leaf IA offsets are image-side (#3368 bulk-JP2 numbering, the #4790 image class): the March 2026 text matches the source leaf. Batch XsDsFHKU_8_EOILnWQTS- is one book with ~all 133 pages wrong; the BPH 6988a59* cohort is ~43% wrong pages (CI 21-67%)."
status: informational
decision: null
superseded_by: null
issue: 5803
---
## 2026-10-18 · Clef audit follow-up: the 45 high books, the offset cause, two batches (#5803)

PRIOR ART: scripts/eval/experiments/2026-10-17-clef-audit-5803.md (the stratified pass that produced the 45 high books and
the batch leads; this note reads them).

**45 high books, 2 flagged pages each, image opened (90 pages).** Page verdicts: wrong text 37, right text (Clef miss) 18,
other 25, unreadable 7, not read 3. By book: **21 wrong text, 8 right, 16 other.**
- Wrong text is mostly the next leaf's text in e-rara books (Crollius, Fasciculus, Agricola, Vitruvius, Schott, Medicina
  metallorum, Canticum, Gaffurius, Universae Geometriae, De alchemia) and IA books (Notes on Virginia, Anatomia, Your Forces).
  Plato II (IA) is 9 to 11 printed pages off. Four are text from another script or work: Ottoman Turkish petition on a Ladino
  solitreo notebook, Armenian on Georgian Gospels, a Christological passage on a Ptolemy folio, a stock merit formula on a
  sutra scroll.
- Right text: spreads read whole (Kojiki, Notebook, Histoire naturelle des Indes, Divine magic), Javanese, Lucian, Mahzor,
  a sale-catalogue clipping.
- Other: spreads with one half transcribed (Lessons in Truth, Horizon, Worksop Bestiary, Leiden Or. 8387 and Or. 7056),
  looping reads (Tangut, Daihannya vol. 40, Armenian, Ashkenazi cursive, Pardes Rimmonim), Hebrew read as Syriac letters
  (Bodleian Zohar, Reyna Cohen).

**Offset cause (5 IA books, no model calls).** Stored text matched to IA hOCR per scanned leaf, the scanned leaf converted to
the IIIF access index through `_scandata.xml`, compared with `pages.photo`. Text OCR'd in March 2026 sits at offset 0 against
the source leaf (Logik 478/478 matched pages, Historiae Augustae 339/339, Revelations 312/312, Plato II 42/42). The served
R2 image falls behind by the number of excluded scan leaves (Delete leaves, colour cards) before it, 3 to 53 leaves. By eye on
the photo leaf: Plato n636 = p.625 = text (image p.616); Historiae n478 = p.127 = text (image p.82); Revelations n149 = p.64
= text (image p.61); Logik n208 = p.189 = text (image p.182); Notes on Virginia n235 = p.226 = text. This is #3368 bulk-JP2
numbering, the image-side class in #4790. Pages re-OCR'd from April on were read from the shifted images, so their text
agrees with the image and is wrong against the source leaf (offset -3 to -67). Geronimo is mixed and unresolved. The e-rara
shifts are not arbitrated: e-rara answers 403 to the job box.

**Batch `XsDsFHKU_8_EOILnWQTS-`** (`batch_jobs`, 2026-04-06) is one book, *Micrographia Restaurata*, 133 pages. 123 carry
Russian prose. Seeded sample 6/6 wrong; p55 shows Eels in Vinegar p.45 under Russian text with the same page number, p40 and
p146 carry the title page.

**BPH `6988a59*`**: 19 books, 7,050 pages. Seeded uniform sample of 14 pages: 6 wrong (43%, Wilson 95% CI 21-67%), in
Séances (2), Les secrets, The second wash, De secretis mulierum, Cantzley Nachtrab. The stored page numbers run in order, so
the text sequence is intact and the mismatch is between blocks of text and blocks of images.

**Contained.** 24 books newly held (`wrong-leaf-clef-audit-5803`); 162 translations withheld with snapshots (33 from the 45
books, 6 from the BPH sample, 123 in Micrographia).

**Artifacts.** `scripts/eval/results/clef-audit-2026-10-17.json`, `followup_2026_10_18` block and per-page `by_eye` fields.
