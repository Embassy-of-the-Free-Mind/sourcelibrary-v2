---
stage: ocr
measure: [accuracy, judged_vs_reference]
languages: [cop]
scripts: [Copt]
canons: []
n_books: 7
n_pages: 15
verdict: "Flash reads Coptic at 10.1% CER against SCRIPTORIUM, Lite 32.2% (wrong alphabet); served English on 3 Nag Hammadi pages is recited from other sayings."
status: informational
decision: null
superseded_by: null
issue: 5778
---
<!-- PRIOR ART: 2026-10-03-translation-vs-reference-harness-smoke-5695.md (the judge harness reused here for the English); scripts/eval/en-ocr-reference-5124.mjs (CER against a typed reference, English/Wikisource only). No earlier run measured Coptic; `gh issue list --search Coptic` returned only #5778. -->
## 2026-10-04 · Can we read our Coptic books? CER of stored / Lite / Flash against Coptic SCRIPTORIUM on 15 pages, and the served English against WEB/Brenton on 6 (#5778)

- **Question.** We hold 150 books with `language` matching Coptic (8,472 pages; 2,972 with OCR = 35%, 2,518 with English = 30%; re-measured 2026-10-04, the brief said 147). How well do the engines read Coptic, and is the served English faithful?
- **Reference.** [Coptic SCRIPTORIUM `corpora`](https://github.com/CopticScriptorium/corpora) (79 corpora, TreeTagger SGML / TEI / PAULA / CoNLL-U). Licence is per corpus: Gospel of Thomas and `lit.fragments` **CC-BY 4.0**; `sahidic.ot` **CC-BY-SA 4.0**; `bohairic.nt` **CC-BY-SA**; `sahidica.nt` is **© J. Warren Wells, academic use only** (its verses are kept out of the repo; `sample.jsonl` holds only their ids and lengths). Also checked: multilingual Wikisource has 22 Coptic transcriptions and one `Index:` (Budge's *Martyrdom and Miracles of Saint George*, 50 `Page:` pages), none paired with a book we hold; TLA's Coptic side is a lexicon, not page-cut text. Neither was used.
- **Sample (n = 15 pages, 7 books).**
  - *Manuscript, same witness (7 pages):* Nag Hammadi Codex II in two copies (IA facsimile ×3, Claremont ×2) against SCRIPTORIUM's Gospel of Thomas, which is cut by codex page; Vatican Borg.copt.109 fasc. 167 ×2 against `life.empdaughter` (Giron 1907), cut by the same leaf.
  - *Printed Bible (8 pages):* Horner's Bohairic NT ×2, Horner's Sahidic NT ×2, Budge 1912 ×2, Budge's Psalter 1898 ×2, against the SCRIPTORIUM verses on the page. These are the **same work in a different edition**, so the printed CERs include real textual variants and are upper bounds.
  - Hidden books in the sample: all three manuscripts. The four printed books are visible.
- **Design.**
  - Three readings: the stored `pages.ocr.data` (13 of 15 pages; the Vatican book has none), a fresh `gemini-3.1-flash-lite` and a fresh `gemini-3-flash-preview`, both realtime with production prompt `Standard OCR v19.1`, temperature 0, thinking off.
  - **Normalisation rule, one for reference and every reading:** NFD; drop every combining mark (supralinear strokes, jinkim, diaeresis, underdots); lowercase; fold Greek-block letters to their Coptic-block twins; keep Coptic letters only (no spaces, punctuation, digits, Latin or markup). Word division in Coptic is editorial, so it is not scored.
  - Manuscript pages: global edit distance against the edition's extant letters for that page (editorial restorations excluded). Printed pages: the verses on the page are the contiguous run that *any* reading matches at < 25%, and each verse is scored by best-substring distance inside each reading, so apparatus and running heads cost nothing.
  - Intervals are a page bootstrap of the letter-weighted pooled CER (5,000 draws, seed 5778).
- **Result: character error rate.**

  | stratum | stored | fresh Lite | fresh Flash |
  |---|---|---|---|
  | all 15 pages | 22.0% (9.2–39.4), n=13 | 32.2% (21.4–45.9) | **10.1% (6.6–14.9)** |
  | manuscript, 7 | 41.5% (20.7–72.6), n=5, all Lite reads | 38.4% (24.9–59.1) | **13.5% (7.8–21.3)** |
  | printed, 8 | 6.2% (3.4–8.6) | 26.0% (13.6–44.3) | 6.6% (3.9–10.3) |
  | per-page range | 1.1–100% | 8.4–92.2% | 1.1–35.3% |

  - Flash beat Lite on 14 of 15 pages. On Nag Hammadi Codex II Flash reads 6.6–10.0%; Lite and the stored Lite reads are 16–100%.
  - The Vatican parchment (two columns, Sahidic uncial) is 35% even for Flash.
  - **Wrong alphabet.** Lite wrote most of its letters outside the Coptic block (Greek capitals, Latin letters, digits: `ΧΕ`, `q`, `2`) on 12 of 15 pages, and the stored reads did on 6 of 13; one stored page (Claremont p. 43) is entirely Latin letters, which scores 100%. Flash used the Coptic block on all 7 manuscript pages, but on 5 of 8 printed pages it wrote mostly Greek-block letters. Three of those are pages where the *stored* read by the same model used the Coptic block (5.1% → 13.2%, 5.8% → 13.0%, 7.6% → 13.7%): in Greek-block mode ϥ becomes φ and ϫ becomes χ. The stored Flash reads mix both blocks inside single words (`Ουⲟϩ αϥσωτεⲙ`), which the fold hides from CER but not from search.
  - Lite ran away on one page (Budge p. 216: a loop of combining macrons to `MAX_TOKENS`) and scored 76% and 55% on the two Budge pages.
- **By eye (5 pages opened: Claremont p. 43, Vatican p. 3, IA facsimile p. 75, Horner Bohairic p. 498, Budge p. 216).**
  - The reference matches the image on all five, so the pairing is sound.
  - Flash on the two papyrus pages is right line for line with a few wrong words. Its errors are *fluent*: on the Vatican leaf it writes real Coptic words that are not there (`ⲛⲏⲥⲧⲉⲓⲁ` "fasting" for `ⲛⲏⲫⲉ`, `ⲯⲩⲭⲏ` for `ⲛϥϥⲓ`), and on Claremont p. 43 `ⲙⲡⲣⲱⲕ` for `ⲙⲏⲡⲱⲥ`.
  - Lite and the stored Lite reads of the papyrus are a Greek/Latin look-alike transliteration and are not usable as Coptic text.
  - On the two printed pages the stored Flash read matches the print, including bracketed restorations and footnote marks.
- **Result: the English.**
  - *Harness (`scripts/eval/translation-vs-reference/`, two blind Opus judges, 6 printed Bible pages; references WEB and Brenton, public domain, aligned by SCRIPTORIUM; they translate the Greek, not the Coptic).* Gate passed for both judges (wrong page ≤ 2, planted negation caught and located, duplicate tied). Served fidelity **3.92 / 5** (CI 3.75–4.00), 0 reversals, 0 `unreadable_fill`; omission on 5 of 6 pages, nearly all apparatus entries or editor's footnotes. Exact agreement 5/6, within one 6/6. All six are canonical Bible text, so recitation cannot be excluded: on Deuteronomy 9:12 the served English follows the Greek-based reference against the page ("I commanded" where the Coptic has "you commanded"; one judge's finding).
  - *By eye (the 3 IA facsimile pages of Nag Hammadi Codex II; SCRIPTORIUM has no English for Thomas, and no open one exists).* **All three served pages are Gospel of Thomas sayings from a different page.** Codex page 34 (sayings 8–13: the fisherman, the sower, "I have cast fire") is served as sayings 110, 112 and 91. Page 40 (sayings 38–41) is served as sayings 15–20. Page 46 (sayings 72–76) is served as sayings 43–46. The English is recited from memory over an unreadable Lite OCR; none of it translates the page. This book is hidden.
- **Reading.**
  - Flash reads Coptic; Lite does not. Print is at about 6% against a different edition (1–3% on the two Budge 1912 pages where the editions agree); papyrus uncial is 7–10%; a two-column parchment is 35%.
  - 1,289 of the 2,972 OCR'd Coptic pages are Lite reads, in 18 books; 556 of them are in three visible books (Budge's Psalter 181, *Pistis Sophia* 1925 372, Horner Sahidic vol. 3 3). A Flash re-read cost $0.0085 a page here in realtime, so the 1,289 pages are about $11 realtime or half that in Batch, plus re-translation.
  - Where the OCR was a Lite read of a famous text, the English is not a translation. Those pages need re-reading before they are re-translated, and before the Nag Hammadi books are made visible.
- **Limits.** 15 pages, 7 books, chosen because a reference exists (Bibles and one famous codex), so the sample is easier and more canonical than the 147-book holding. Printed CERs are against another edition. The English judges read Coptic "moderately" by their own account and leaned on the reference. One realtime read per engine; Flash's block choice varied between the stored and the fresh read of the same page.
- **Spend.** $0.18 Gemini (30 realtime reads); judges $0 API.
- **Files.** `scripts/eval/coptic-5778/` (`coptic-lib`, `build-sample`, `read`, `score`, `build-english-records`); `scripts/eval/results/coptic-5778/` (`our-coptic-books.json`, `sample.jsonl`, `reads.jsonl`, `scores.json`, `english-records*.jsonl`, `english-packet/`, `english-results.json`).
- *Replicated?* No. One sample, one read per engine.
