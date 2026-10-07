## 2026-10-04 · What script and language are the 1,670 books with no language? (#5777)
<!-- PRIOR ART: scripts/maintenance/detect-language-from-pages.mjs (#4696) and scripts/audit/detect-book-languages.mjs (#4117) — both read the `<language>` tag out of OCR text, so they cannot see books that were never transcribed (95% of these pages), and neither names a script. Small-script probes #4746 (Syriac, Armenian) and #5664 (Mongolian) cover single scripts, not the unlabelled set. -->

**Question.** Which writing systems and languages are in the books whose `language` is `und` or `Unknown`, and which of them have no OCR lane?

**Design.** `scripts/eval/langid-5777.mjs`, read-only on Mongo; nothing was written to `books` or `pages`.
- **Set:** `language ∈ {und, Unknown}` and `pages_count > 0`: **1,670 books, 400,032 pages**, 20,741 of them transcribed (5.2%). 847 `Unknown`, 823 `und`. 60 are visible.
- **Page:** one interior page per book, nearest 40% of `pages_count`, skipping pages flagged blank or cover, falling forward on a fetch failure or a flat image. The image is the one the reader shows (`display_photo`, else the source at 1,024 px).
- **Read:** `gemini-3.1-flash-lite`, Batch, thinking off, JSON out (script, language, print or manuscript, content, confidence). A second round re-read the next page for the 42 books whose first page carried no writing.
- **Check:** 42 books opened by eye, at least one per script label, read before the model's answer was revealed. A second look at 10 more books aimed at the rare labels.
- Page counts below are each book's whole `pages_count`, assigned to the script of its one sampled page. A mixed book counts once.

**Result 1 — by script** (model label, corrected where the by-eye check disagreed).

| script | books | pages | transcribed | mostly |
|---|---:|---:|---:|---|
| Latin | 892 | 198,820 | 19,782 | print 771, manuscript 116 |
| Arabic | 211 | 55,108 | 164 | manuscript 190 |
| Turfan fragments (script not established) | 110 | 241 | 235 | manuscript |
| Hebrew | 79 | 19,107 | 118 | manuscript 69 |
| Armenian | 72 | 29,744 | 0 | manuscript 67 |
| Cyrillic | 50 | 28,795 | 0 | manuscript 41 |
| Han | 36 | 12,802 | 25 | print 18, manuscript 18 |
| Coptic | 33 | 5,622 | 34 | manuscript |
| Tamil | 18 | 5,655 | 0 | manuscript 12, print 6 |
| Malayalam | 18 | 3,714 | 0 | manuscript |
| Burmese | 11 | 1,472 | 0 | manuscript |
| Greek | 10 | 2,391 | 174 | print 7 |
| Syriac | 10 | 3,208 | 0 | manuscript 9 |
| Devanagari | 9 | 2,098 | 3 | manuscript 7 |
| Ge'ez | 9 | 2,311 | 0 | manuscript 8 |
| Thai | 4 | 481 | 0 | manuscript |
| Khmer | 3 | 182 | 0 | manuscript |
| Sinhala | 3 | 328 | 0 | manuscript |
| Egyptian hieroglyphs | 2 | 45 | 3 | one papyrus, one ring |
| Kana (Japanese) | 2 | 208 | 0 | manuscript |
| Tibetan | 1 | 28 | 0 | manuscript |
| Newar | 1 | 84 | 0 | manuscript |
| Odia | 1 | 2 | 2 | manuscript |
| no writing found on two pages | 28 | 2,669 | 201 | |
| image not fetchable | 57 | 24,917 | 0 | |

- **No Mongolian, Manchu or Javanese book was found.** The model's two "Mongolian or Manchu" labels are Turfan fragments with three strokes on them.
- The set is half manuscript: 726 books and 181,949 pages, against 851 books and 189,385 pages of print. 629 books and 194,554 pages come from the Vatican Library.

**Result 2 — by language** (the 20 largest; full table in `summary.json`).

| script / language | books | pages |
|---|---:|---:|
| Latin / Latin | 468 | 82,109 |
| Latin / German | 285 | 70,112 |
| Arabic / Arabic | 150 | 43,420 |
| Hebrew / Hebrew | 76 | 17,705 |
| Armenian / Armenian (incl. 8 "Classical Armenian") | 68 | 27,636 |
| Cyrillic / Church Slavonic | 48 | 28,161 |
| Arabic / Persian | 38 | 4,978 |
| Coptic / Coptic | 32 | 4,552 |
| Latin / French | 30 | 7,946 |
| Han / Classical Chinese | 30 | 10,698 |
| Latin / English | 22 | 4,753 |
| Arabic / Ottoman Turkish | 18 | 4,629 |
| Latin / Vietnamese | 18 | 8,061 |
| Tamil / Tamil | 17 | 5,033 |
| Malayalam / Malayalam | 17 | 3,432 |
| Latin / Latin and German | 13 | 2,062 |
| Latin / Portuguese | 12 | 5,826 |
| Syriac / Syriac | 10 | 3,208 |
| Latin / Italian | 9 | 2,378 |
| Ge'ez / Ge'ez | 8 | 1,635 |

- Free cross-check: 380 of these books have an OCR `<language>` tag on the sampled page; the model's language matches it on 363 (96%).

**Result 3 — by-eye agreement.**

| set | books | script agrees | disagrees | could not judge |
|---|---:|---:|---:|---:|
| stratified sample, all | 42 | 29 | 10 | 3 |
| — outside the Turfan fragments | 32 | 28 | 2 | 2 |
| — Turfan fragments | 10 | 1 | 8 | 1 |
| second look at rare labels | 10 | 3 | 3 | 4 |

- **Outside the Turfan fragments the script label held on 28 of 30 judged pages.** The two misses: a Burmese square-script leaf called Balinese, and a Latin-letter Croatian psalter called Glagolitic.
- **On Turfan fragments the label is noise: 1 of 9.** The same Manichaean-script series (Berlin shelfmark `M`, 111 books) was called Syriac, Hebrew, Tibetan, Brahmi, Georgian, Kannada and "Mongolian or Manchu", at confidence 0.8–1.0. They are reported as one stratum; their script is not established here.
- The second look removed two labels outright: **all 3 "Glagolitic" and both "Balinese" calls are wrong** (Latin, Ge'ez and Cyrillic; Burmese twice). Tibetan, hieroglyphs and Japanese held.
- The sample over-weights rare labels by design, so 29 of 39 is not the corpus error rate. Latin, Arabic, Hebrew, Armenian, Cyrillic, Han and Coptic pages outside Turfan were 17 of 17.
- Language, where the script was right: 2 wrong of 28. A Japanese letter and a Vietnamese chữ Nôm catechism were both called Classical Chinese.
- Confidence does not separate right from wrong: 4 books in 1,585 fell below 0.8.
- Incised palm leaves are not settled at 1,024 px: I could not tell Malayalam from Sinhala, or Khmer from Thai, on 5 of them.

**Result 4 — scripts with no reading lane.** "Lane" follows `.claude/docs/ocr-lane-decision-tree.md` §1.

| script | books | pages | lane today |
|---|---:|---:|---|
| Armenian | 72 | 29,744 | none; #4746 found frontier models cannot read it |
| Cyrillic (48 books Church Slavonic manuscript) | 50 | 28,795 | none named |
| Tamil | 18 | 5,655 | none named |
| Coptic | 33 | 5,622 | none named; #5778 is probing it |
| Malayalam | 18 | 3,714 | none named |
| Ge'ez | 9 | 2,311 | none named |
| Burmese (3 books Pali) | 11 | 1,472 | none named |
| Thai | 4 | 481 | none named |
| Sinhala | 3 | 328 | none named |
| Turfan fragments (Manichaean, Sogdian) | 110 | 241 | none; 235 pages already carry a transcription that should be checked |
| Khmer | 3 | 182 | none named |
| Newar | 1 | 84 | none named |
| Egyptian hieroglyphs | 2 | 45 | none; not an OCR problem |
| Odia | 1 | 2 | none named |

Scripts that do have a lane: Latin (Lite), Syriac (Kraken), Tibetan (BDRC), Chinese (Flash, Paddle pending #4743), and Arabic, Hebrew, Greek, Sanskrit and Japanese on the Flash non-Latin default. None of the "none named" scripts is refused by the pipeline; they fall to Flash unjudged.

**Not classified.**
- 57 books (24,917 pages, none visible, none transcribed) have no fetchable image. 54 are lending-only archive.org scans of modern editions (HTTP 403). Their catalogue records give a language for all of them: 29 English, 14 English and Latin, the rest mixed (`ia-metadata.jsonl`).
- 28 books showed no writing on two sampled pages: covers, blank leaves, woodblock Buddha figures, one all-black image.

**Batch note.** The first submit (4 files of 450 requests, about 100 MB each) returned "The operation was cancelled" for 757 of 1,613 requests inside jobs marked succeeded. Resent as 150-request files, all 757 answered. One trial, so the file size is a suspicion, not a finding; `translate-batch-seam.mjs` records the same error on 2026-09-24.

**Spend.** $0.40 metered (2,411 answered requests, 2.50M input and 0.12M output tokens, Lite Batch), against a $2 cap.

**Not done.** No book field was written; #4654, #4711 and #5335 own `books.language`. The rows in `results.jsonl` (`script_final`, `language_final`, `script_final_basis`) are an input to those, with one page of evidence per book. Rare-script labels need a by-eye pass before any is applied.

**Files.** `scripts/eval/results/langid-5777/`: `results.jsonl` (one row per book), `summary.json`, `eye-check.jsonl`, `ia-metadata.jsonl`, `raw.jsonl`, `picks.jsonl`, `batch.json`.
