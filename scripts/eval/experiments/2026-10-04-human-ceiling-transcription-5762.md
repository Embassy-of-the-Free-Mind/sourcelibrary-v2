---
stage: ocr
measure: [agreement, accuracy]
languages: [en, grc, lzh]
scripts: [Latn, Grek, Hani]
canons: [cbeta]
n_books: 104
n_pages: 183
verdict: "Two human transcriptions differ by 0.14% of letters (English), 0.43% (Greek), 0.28% (Taisho Chinese after glyph folding); our English OCR's median page is at that floor."
status: informational
decision: null
superseded_by: null
issue: 5762
---
## 2026-10-04 · How far apart are two human transcriptions of the same printed page, and where does our OCR sit against both? English, Greek, Chinese (#5762 track 2)

<!-- PRIOR ART: 2026-09-28 English reference pages (#5124: Wikisource/Gutenberg page references, one transcription per page, both engines scored against it); scripts/eval/build-edition-refs.mjs (EEBO-TCP cut to our pages, scored against our OCR, "OCR error + edition variance until reference_error_rate is measured"); PREREGISTRATION-chinese-skqs-5568.md (Kanripo page ↔ scan page). Each holds ONE human transcription per page; none measures the reference's own error. -->

- **Question.** Every OCR figure we quote is a character error rate against one human transcription. What is the CER between two independent human transcriptions of the same page of the same edition, and what is our served OCR's CER against each of the two on those pages?
- **measure:** agreement between two human transcriptions (neither is the truth); our OCR against each is accuracy against that reference. One normalisation for every pair: `lib/metrics.mjs` `normalizeForScript` v2 / `normalizeCJK` + `windowedErrorRate` (letters only; case, punctuation, spacing, diacritics and line breaks folded; edges free, interior differences charged), both directions, pooled Σ edits / Σ characters, bootstrap over books (`scripts/eval/transcription-human-ceiling/score.mjs`).
- **Pairs (183 pages from 104 printed books or works; cut by each source's own page markers where it has them; at most 3 pages per book).**
  - **English, 88 pages, 33 books:** Wikisource proofread pages × Project Gutenberg (62 pages, 24 books, 1800–1930 print), EEBO-TCP × Project Gutenberg (15 pages, 5 books, pre-1700), Wikisource × EEBO-TCP (7 pages, 3 books), plus 4 pages of 2 books kept apart as edition mismatches. Our served OCR is on 71 pages.
  - **Greek, 41 pages, 17 printed volumes:** Perseus × First1KGreek on the same printed edition (24 pages), Perseus × Project Gutenberg (Galen, Brock 1916: 3), Perseus or First1KGreek × el.wikisource proofread pages (14). Our OCR is on 4 pages of 2 books.
  - **Chinese, 54 pages, 54 works:** CBETA × SAT, both transcribing the Taishō by its own page, column and line numbers. Our OCR is on 3 pages of the one Taishō volume we hold.
  - **Edition by eye:** 22 pages (English 9, Greek 8, Chinese 5) read against the page image, first and last line on both cuts; the rest by title page, TEI header or shared line numbering. A different edition was kept as a flagged row, not forced (Saducismus Triumphatus 1681 vs our 1700; Swinburne).
  - **Rejected as one keying, with the evidence in `notes/rejected-*.jsonl` (51 entries):** Kanripo KR6 × CBETA, the pair the issue named (Kanripo's Readme names CBETA as its base; 10,991 of 11,000 characters identical); Kanripo WYG and SBCK × zh.wikisource (bot imports of the same electronic edition; 10,166 of 10,178 identical), so none of our 36 Siku Quanshu pages has a second human transcription; the 98 CBETA files whose header lists SAT as a source; Wikisource Leviathan (pasted from EEBO-TCP), match-and-split Wikisource books; treebank Greek that copies Perseus; Gutenberg texts set from a later reprint.
- **Result (pooled CER [95% CI over books]; median page).**

  | | pages (books) | human vs human, letters | pages with no letter difference | human vs human, second normalisation | our OCR vs A | our OCR vs B |
  |---|---:|---|---:|---|---|---|
  | English, same edition | 84 (31) | **0.14% [0.08–0.21]**; median 0.00% | 49 | 0.23% [0.13–0.33] (diacritics kept) | 2.61% [0.33–5.91]; median 0.06% (67 pp) | 2.61% [0.33–5.94]; median 0.00% |
  | · Wikisource × Gutenberg | 62 (24) | 0.11% [0.05–0.19] | 41 | 0.16% | 3.25%; median 0.00% (47 pp) | 3.28%; median 0.00% |
  | · EEBO-TCP × Gutenberg | 15 (5) | 0.13% [0.03–0.27] | 8 | 0.26% | 0.77% [0.26–1.04]; median 0.19% (15 pp) | 0.73% [0.16–1.02]; median 0.31% |
  | · Wikisource × EEBO-TCP | 7 (3) | 0.36% [0.30–0.51] | 0 | 0.69% | 2.95%; median 2.38% (5 pp) | 2.74%; median 1.76% |
  | Greek, same edition | 41 (24 vols/works) | **0.43% [0.08–0.76]**; median 0.00% | 25 | **1.09% [0.69–1.44]** (accents, breathings kept) | 0.15% [0.03–0.47] (4 pp) | 0.12% [0.03–0.38] |
  | · Perseus × First1KGreek | 24 (15) | 0.39% [0.03–0.67] | 12 | 0.76% | – | – |
  | Chinese, Taishō, CBETA × SAT | 54 (52) | **2.87% [2.61–3.14]**; median 2.90% | 0 | **0.28% [0.20–0.38]** (41 recurring glyph pairs folded) | 12%, 14%, 44% (3 pp, one volume) | 13%, 16%, 45% |

  - **English.** Two careful transcriptions differ by about one letter in 700; 58% of pages have no letter difference. Our OCR's median page (0.06%) is inside that; 46 of 67 pages are no further from A than B is. The pooled 2.6% is a tail: 10 of 67 pages exceed 1% (1 of 84 for the humans). Three pages (two books, shoulder-noted or two-column) are at 34–71% because our text interleaves marginal notes that both transcriptions leave out; without them the pooled figure is 0.59%. On the pre-1700 EEBO-TCP × Gutenberg pages our OCR is 0.75% against a 0.13% floor.
  - **Greek.** On letters the floor is 0.43%, and 0.12% on the 21 pages left when the weakest B (the First1KGreek Eusebius, hand-corrected OCR with visible slips) and the Wikisource rows are dropped. With accents and breathings kept it is 1.09% (0.55% on the strict 21): two keyings of one edition disagree on a diacritic about once in 90–180 letters. Our OCR on the 4 pages we hold: 0.15% / 0.12% on letters, 1.13% / 0.51% with diacritics. n = 4, a note, not a result.
  - **Chinese.** By the library normaliser CBETA and SAT differ on 2.87% of characters, and almost all of it is convention: CBETA writes standard forms (為 說 眾 緣 德), SAT the print's (爲 説 衆 縁 徳). Folding the 41 character pairs that recur five or more times in the same direction leaves 0.28% [0.20–0.38], which still includes rarer variant pairs; the collecting agent's reading puts real disagreements (使/便, 住/往, 已/己, a dropped or doubled character) near 0.1–0.2%. `normalizeCJK` folds six variants, so **any Chinese CER we quote against a reference in another glyph convention carries about 2.6 points of convention distance.**
- **Conclusion.** The human-vs-human floor on letters is 0.14% for English print, 0.4% for polytonic Greek (1.1% counting diacritics) and 0.2–0.3% for Taishō Chinese once glyph conventions are folded. A reported OCR CER below about 0.2% (English), 0.5% (Greek letters) or 0.3% (Chinese) is inside the disagreement of the references themselves and should be read as "at the floor", not ranked. Our served English OCR is at the floor on the median page and above it in the tail (layout, not letters); Greek and Chinese have too few of our own pages on these editions to say.
- **Threats.**
  - Independence is argued, not proven, for some pairs: SAT may have been proofread against CBETA (undocumented), which makes the Chinese figure a lower bound; every el.wikisource page used was seeded from an existing e-text of unknown ancestry before being proofread against the scan; two English Wikisource books were accepted on thin evidence (one or two punctuation differences over ~3,000 words). Four zero-difference English books were rejected as unseparable, which biases the English floor upward by that much.
  - The lib normalisation removes what transcribers most often disagree on (punctuation, capitals, hyphenation, diacritics). The floor here is a floor on LETTERS.
  - The Chinese glyph fold is derived from these same 54 pages (post hoc) and is a rule about recurrence, not a variant dictionary.
  - Pages were drawn at fixed positions or by seed, but only from clean prose pages that both sources carry: tables, Siddham, lyric and apparatus-heavy pages are under-represented, so the floor on hard pages is not measured.
  - Our OCR is on 71 English pages but only 4 Greek and 3 Chinese; the served text is a mix of Flash (37) and Lite (28) reads.
- **Found on the way (not fixed here).** Stone-Heng 1655 (`69ee2b70…`): served OCR and image are off by one page. Saducismus Triumphatus (`6952db24…`) is catalogued 1681 but the scan's title pages say 1700. The #5124 draw matches The Jew of Malta to the Wikisource index of Tamburlaine.
- **Files.** `scripts/eval/results/human-ceiling-5762-2026-10/transcription/`: `results.json`, `table.md`, `pages.jsonl` (one row per page: sources, licences, edition check, cut method, edits and lengths; no texts), `pairs-open.jsonl` (the 129 English and Greek pairs with both texts and our OCR; all CC0, public domain or CC BY-SA), `cjk-recurring-pairs.json`, `notes/` (per-language search notes and rejected candidates). CBETA (CC BY-NC-SA) and SAT (no redistribution) texts are not in the repo; the working set is at `/root/sl-eval-archive/human-ceiling-5762/work/t2/zh` on the Hetzner box.
- **Spend.** $0 Gemini; collection by Claude subagents on the subscription.
- *Replicated?* No.
