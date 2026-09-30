# Arbitration: one new wrong-leaf page

PRIOR ART: `scripts/eval/results/leaf-identity-2026-09-30/verdicts.jsonl` — the same kind of verdict (display image and source leaf opened side by side) over the corpus-audit sample; this page is from the monthly sample, which that study did not cover.

A blind reader gave the served read of packet page 21 the verdict `different-page`. The orchestrating session then opened both images itself.

- **Page:** [Calderón, *La vida es sueño*, page 36](https://sourcelibrary.org/book/69e41216937ee36cf27c7554?page=36)
- **Display image:** https://images.sourcelibrary.org/pages/69e41216937ee36cf27c7554/0036.jpg
- **Source leaf (`pages.photo`):** https://archive.org/download/comediafamosalav00cald_0/page/n35/full/pct:50/0/default.jpg
- **Verdict:** mismatch. **Wrong lane:** text. **Offset:** the served text is the previous leaf.
- **Anchor:** the display image and Archive leaf n35 show the same printed page: running head "La Vida es Sueño", first line "que es esta que ciño: aora", last line "sueño? pues tan parecidas". The served OCR is headed "16 De Don Pedro Calderon", begins "para persuadirme loca" and ends "descuelgo vna antigua espada, que", which is the page before; its last word runs into this page's first line. The fresh flash read matches the image at head and tail.
- **OCR run:** `pipeline_preview`, `gemini-3.1-flash-lite-preview`, 2026-04-19. **Archive source:** `bulk_jp2`.
- **Scores:** served text against the better fresh read 0.151; fresh reads against each other 0.973.
- **Label:** read from image (display AND source leaf opened).

Not done: the extent of the shift in this book. #5311 found such shifts run over several pages; one page was read here.
