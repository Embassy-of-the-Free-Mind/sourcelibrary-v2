---
stage: ocr
measure: none
languages: [la, de, en]
scripts: [Latn]
canons: []
n_books: 754
n_pages: 107252
verdict: "DTA, CAMENA and EEBO-TCP give typed references for 754 of our books (107,252 aligned pages); 35/36 leaves right by eye, 30/38 same-edition claims hold; 211 works get a period English translation."
status: informational
decision: null
superseded_by: null
issue: 6012
---
## 2026-10-06 · How many of our Latin and German pages can be checked against a human-typed text, and against a period English translation? DTA, CAMENA and EEBO-TCP as internal references (#6012)
<!-- PRIOR ART: 2026-10-06-typed-editions-ground-truth-chinese-pali-5935.md (Kanripo, CBETA, VRI: the storage precedent and the k-gram offset voting reused here; it scores CER, this run builds the references and scores nothing); 2026-10-04-latin-print-by-century-5126.md (82 same-edition Latin pages, 65 from CAMENA, one page per book, located by hand); 2026-10-01-early-english-ocr-accuracy-against-eebo-tcp-5488.md (72 IA microfilm books joined to EEBO-TCP Phase I by catalogue number). None holds a whole corpus with provenance, matches German, or uses Phase II. -->

**Question.** Latin is 37 % of our translated pages and German 11 %. Latin had 71 translation references and no typed source editions in use beyond #5126's 82 pages; German had 22 pages. Which of our books have a human-typed text in the Deutsches Textarchiv, CAMENA or EEBO-TCP, page by page? And which works we hold in Latin or German have a 16th- or 17th-century English translation in EEBO-TCP?

**Design.** Run on 2026-10-06. $0: no model call. Read-only on Mongo. Nothing is served to readers; no book or page was created; no field was written. `measure: none` (this run builds references; it scores no engine).

- **Rights first.** Each source's own terms page was read and quoted before anything was downloaded: `scripts/eval/typed-refs-6012/rights.json`. After download, the licence in every text's own header was read too.
- **Storage.** Raw packages and derived text are in the private R2 bucket `sl-corpus-snapshots`, prefix `eval-refs/typed-refs-6012/`. Each object's sha256 was read back from R2 after upload. `images.sourcelibrary.org` answers 404 for that bucket. The main bucket's `private/` and `eval-artifacts/` prefixes are served by the public image host and were not used. The repo holds scripts, `rights.json`, manifests, and match and alignment rows (ids, hashes, offsets, scores). No corpus text is in the repo. No Mongo collection was added. This follows #5935: files under `scripts/eval/`, corpora outside the repo.
- **Raw is never edited.** Text is derived by one versioned parse (`tei-pages-v1`): one record per typed page; running heads, signatures, catchwords and editorial corrections dropped; notes kept apart from the body; gaps counted.
- **Match in two steps.**
  1. *Candidates* from identifiers and catalogue fields: a shared scan id; the Internet Archive microfilm catalogue number against the TCP's STC / Wing / ESTC numbers; `edition_key` (the one definition, `scripts/lib/identity-fields.mjs`); then surname + title tokens (+ year).
  2. *Decision by reading both texts.* Twelve seeded pages of our stored OCR are looked for in the typed text by k-gram offset voting (#5935's method). A pair is kept only if at least two are found. Then every page is aligned.
- **Kind, from the page breaks, not the catalogue.**
  - `same-edition`: at least 60 % of our aligned pages start and end where the typed text's own page breaks fall.
  - `same-work-other-edition`: the text is found, the page breaks fall elsewhere.
- **Per aligned page:** book id, page number, source id, the span in the typed text, the overlap score (share of the page's 8-grams found in the span), the alignment version (`kgram-vote-v2`).
- **English translations (EEBO-TCP).** Work level. Evidence: the TCP header's own uniform title with "English" (*"Helvetius … Vitulus aureus … English."*) contained in our title, author agreeing; or author + a translation statement in the English title + two shared title stems. Then a probe at passage level: our page's stored English translation against each typed page of the old English, by idf-weighted shared words.
- **By eye.** Claude subagents, one per source and check, reading the page image. The machine's claim was withheld from them. Verdicts: `scripts/eval/typed-refs-6012/eye-verdicts.json`.

**Result: rights.**

| source | licence as the source states it | found in the files | bulk package used |
|---|---|---|---|
| DTA | CC BY-SA 4.0 "soweit nicht anderweitig gekennzeichnet"; plain text "im Sinne der Gemeinfreiheit ohne jegliche Einschränkungen" | 2,645 of 5,481 headers say CC BY-SA 4.0. The rest: CC BY-NC 3.0 1,559, CC BY-SA 3.0/2.0 674, CC0 370, CC BY 218, Project Gutenberg licence 9, others 6 | `dta_komplett_2026-02-10.zip` (MD5 matches the download page) |
| CAMENA | "Creative Commons Attribution / Share Alike" (the page links 3.0; the GitHub republication carries 4.0) | — | `nevenjovanovic/camena-neolatinlit` @771bb7f (the project has no dump) |
| EEBO-TCP Phase I | released to the public 2015-01-01; "no restrictions whatever" | CC0 in 24,202 of 25,368 headers; 1,166 P4 headers still carry the pre-2015 partner-only text | the TCP's Dropbox folder, one 13.3 GB zip |
| EEBO-TCP Phase II | "freely available to the public" since 2020-08-01; no licence deed on the page | **CC0 in all 34,958 headers** | same zip |

All four allow bulk download and internal use. 1,574 DTA texts are NC or otherwise not for redistribution; the manifest marks each text.

**Result: downloaded.**

| source | texts | typed pages | characters |
|---|---:|---:|---:|
| DTA | 5,481 | 762,041 | 1.31 billion |
| CAMENA | 1,751 files | 199,513 | 0.35 billion |
| EEBO-TCP (I + II) | 60,326 | 4,029,127 | 8.03 billion |

**Result: matched to our books.** 754 books in all, 107,252 distinct aligned pages (81,643 in same-edition books).

| source | candidate pairs | not kept after reading | our books: same edition / other edition | aligned pages | of them on a typed page break |
|---|---:|---:|---:|---:|---:|
| DTA | 760 | 623 | 89 / 35 | 23,322 | 17,457 |
| CAMENA | 2,877 | 2,693 | 88 / 80 | 7,764 | 4,038 |
| EEBO-TCP | 5,522 | 4,981 | 331 / 133 | 76,178 | 60,361 |

- Identifiers found little. DTA names 60 BSB scans and we hold none of them. `edition_key` gave 16 DTA, 6 CAMENA and 9 EEBO same-edition pairs. The microfilm catalogue number gave 121 EEBO pairs. The rest came from surname + title tokens (8,974 pairs), and reading the texts kept 703 of them (8 %).
- CAMENA pages are few per book because most matched Latin books have stored OCR on their first 25 pages only. 74 of its 88 same-edition books are hidden.

**Result: books and aligned pages by language × century of the edition** (all three sources; one row per book, same edition wins).

| language × century | books, same edition | of those, not in any earlier stratum | books, other edition | pages, same edition | pages, other edition |
|---|---:|---:|---:|---:|---:|
| German 1500s | 1 | 1 | 0 | 173 | 0 |
| German 1600s | 21 | 21 | 5 | 1,772 | 475 |
| German 1700s | 24 | 24 | 15 | 5,969 | 2,895 |
| German 1800s | 37 | 37 | 5 | 8,949 | 1,415 |
| German 1900+ / undated | 0 | 0 | 7 | 0 | 1,173 |
| Latin before 1500 | 0 | 0 | 7 | 0 | 274 |
| Latin 1500s | 34 | 23 | 34 | 1,542 | 2,677 |
| Latin 1600s | 125 | 79 | 65 | 5,421 | 3,175 |
| Latin 1700s | 6 | 4 | 2 | 1,697 | 21 |
| Latin 1800s / undated | 2 | 2 | 26 | 43 | 1,285 |
| English 1500s | 24 | 19 | 11 | 4,582 | 861 |
| English 1600s | 228 | 162 | 29 | 50,462 | 6,239 |
| English, other centuries | 4 | 4 | 38 | 993 | 5,079 |

- 36 books we hold undated take the century of the typed edition, only where the page breaks say it is that edition.
- "Latin" includes Latin-German and Latin-English books; "English" includes Middle English. Pages are distinct pages. Four matched books in other languages (3 French, 1 unlabelled) are not shown.

**Result: by eye.**

| | DTA | CAMENA | EEBO-TCP |
|---|---:|---:|---:|
| **Leaves read** | 12 | 12 | 12 |
| the typed text is the text on that leaf | 12 | 12 | 11 |
| claimed "on the typed page breaks" → exact by eye | 8 of 9 | 5 of 7 | 9 of 10 |
| claimed "off the page breaks" → superset or partial by eye | 3 of 3 | 4 of 5 | 2 of 2 |
| leaves where the reader saw a typed error | 4 | 11 | 5 |
| **Title pages read** | 20 | 20 | 20 |
| judged (the rest: the image is not a title page) | 17 | 19 | 19 |
| same work, or the same text inside another book | 17 of 17 | 17 of 19 | 19 of 19 |
| claimed same edition → same edition by title page | 7 of 11 | 9 of 11 | 14 of 16 |
| claimed other edition → other edition by title page | 5 of 6 | 6 of 8 | 3 of 3 |

- **Page level: 35 of 36 leaves carry the claimed text** (97 %, Wilson 95 % 86–99.5). The one miss is ours, not the aligner's: Maier's book `69bd9e0b…`, page 137. Our stored OCR is typed page 123; the archived image shown for page 137 is the leaf before. The typed text found an image/text offset in our own record (the #3368 class).
- **"Same edition" means same pagination.** 30 of 38 claims hold by title page (79 %, 64–89). The 8 misses run page for page with the typed text but carry another title page: another bookseller (Lehmann 1756: Lange, not Klüter), a piracy imprint (*Wilhelm Meister* 1795: "Frankfurt und Leipzig", not Unger), a reset title, Newton 1726 against 1687. They are reissues and line-for-line reprints. For scoring a page's reading they serve; as a bibliographic statement they do not.
- **Two CAMENA "other edition" matches are a text inside a different book**: a Saumaise letter in his collected letters; Conring's 1648 book and its 1669 revision under a new title.
- **CAMENA's typing errors show on 11 of 12 leaves** (*mohi* for *mihi*, *institiam* for *justitiam*, dropped words). DTA 4 of 12, EEBO-TCP 5 of 12, all small. This is the reference error #5126 left unmeasured, as a page share; a character rate still needs the 20 hand-read pages of eval-design §4.1.

**Result: English translations of works we hold in Latin or German (EEBO-TCP).**

| | TCP texts | our books | our works |
|---|---:|---:|---:|
| matches (uniform title + "English", or author + two title stems) | 115 | 281 | 211 |
| candidates (author + one distinctive title stem) | 206 | 486 | 365 |
| author and a translation statement only: work not established | 1,293 | — | — |

- **By eye, 20 matches:** the relation holds for 16 (80 %, 58–92). 6 translate the whole work. 9 are a volume that contains a translation of it, or of part of it (one satire of Juvenal, the Narcissus episode of Ovid). 1 is the reverse: our book is a collection that contains the original. 4 are wrong (2 the same author's other work, 2 not translations). By evidence: author + two title stems 6 of 6; uniform title 10 of 14.
- The candidates were read from their catalogue lines only (23 pairs of an earlier, looser rule: about half right). They are a list to check, not matches. It holds the books the brief named: Paracelsus' *Archidoxis* 1660, Croll's *Basilica chymica* 1670, Everard's *Divine Pymander* 1657, Böhme's *Signatura rerum* 1651.
- **Passage level is feasible, and for these it is done.** Of 200 pairs whose book has ≥ 40 stored translated pages, 45 place coherently (≥ 30 % of pages placed, ≥ 90 % in rising order): **25 TCP texts, 40 of our books, 6,670 of our pages.** By eye, 12 of 12 placed pages are the same passage, with most of our page rendered (Wilson 95 % lower bound 76 %). In 7 of the 12 a few lines spill onto the neighbouring English page.
  - Placed: Petrarch *Phisicke against Fortune* 1579, Willis (three texts), Suetonius 1606, Caesar 1655, Ovid (Golding 1567, Sandys 1628), Erasmus *Praise of Folly* 1668, Lucan (Gorges 1614, May 1627), Croll, Paracelsus *Archidoxis*, Comenius, Böhme *Signatura rerum*, Boccalini, Quercetanus, Hierocles, Innocent III, Helvetius, Roger Bacon's *Mirror of Alchimy* 1597.
  - 24 of the 45 pairs came from the candidate list, so the placement also confirms those candidates by content.
  - Not placed: the *Pymander* (2 % of pages; Everard's English follows another text), and pairs where the English is a short extract.
  - What the readers saw: the English is often made from another version (the Latin of a German text, the Greek of a Latin one), carries the translator's commentary between chapters (Edmonds' Caesar), or paraphrases. It is a human translation of the same passage, not a line-for-line key.

**What each consumer can now use.**

- **#5126 (Latin by century, one page per book).** Same-edition Latin books not in any earlier stratum: **1500s 23, 1600s 79, 1700s 4, before 1500 none.**
  - The 1500s cell was 3 short of directional and 23 short of decision grade: these 23 close it, if their leaf checks pass at the #5126 standard (79 % of same-edition claims hold by title page, 97 % of leaves are the right leaf).
  - The 1700s stays short. The source is used up: CAMENA has 31 files after 1700.
  - Incunabula: no same-edition text. 7 Latin books before 1500 have the same text in a later edition typed by the TCP (274 pages: Sarum primers and Hours, Terence, *Secreta mulierum*). An abbreviated incunable against an expanded later print reads as word error (#5508), so these are not OCR references yet.
  - Only 58 of the 165 same-edition Latin books are visible, and most have 25 OCR'd pages.
- **#4925 decision 4 (German Fraktur, long s).** German same-edition books: **1600s 21, 1700s 24, 1800s 37, 1500s 1**, none in an earlier stratum (German had 22 referenced pages). Pooled 83 books; no single century reaches 50. 1800s is directional (37), 1600s and 1700s exploratory. DTA keeps ſ, the umlaut-e and line breaks, so a scorer must fold or use them on purpose.
  - Caveat: on clean 19th-century print the overlap is at its ceiling, and the titles are canonical (Goethe, Kant, Hegel), which a model may recite. The 1600s and 1700s books (Andreae 1616, Weigel, Francisci, Schwenter, Zesen, Lange 1729, Swedenborg 1776) are the useful ones.
- **#4925, English.** English 1600s has 228 same-edition books (162 new; the cell stood at 49). English 1500s 24 (19 new).
- **#5982 and #5695-style judging.** A human English translation now exists as a reference for 211 of our Latin and German works at work level, and for 6,670 of our pages at passage level (35 Latin books, 5 German). For 2,328 of those pages, in 21 books, the placed pair is a match; for the rest it is a candidate that the placement itself supports. These are period translations: free, sometimes via another language, sometimes with the translator's commentary. An "addition" judged against them needs the page image, as #5982 already found for typed source texts.
- **#5513 (canon gap map).** `rights.json` and the three manifests are reusable as they stand.

**Limits.**
- Only books with stored OCR could be matched: 5,871 of 9,114 German books and 32,187 of 51,638 Latin books have any. Books without OCR that the typed texts cover are not counted here.
- Candidates come from catalogue fields. A book whose author or title we hold wrongly was never offered to the reader of texts, so recall is unmeasured.
- The overlap score is letters-only 8-gram containment after folding ſ, u/v, i/j and umlauts. It finds a page; it is not a CER.
- Pages are located through the stored OCR, so a page the served engine read catastrophically is missing from the aligned set (the same selection #5126 named).
- Notes are kept apart from the body in the parse; a page that is mostly marginal commentary aligns poorly.
- The by-eye readers are AI reading images, one reader per check, not scholars. 12 leaves and 20 title pages per source give wide intervals.
- The translation passages are placed through our own stored translation, so a page we translated badly is less likely to be placed.

**Deviations.**
- The alignment rule changed once after the first DTA by-eye read (v1 → v2): the typed page of a span is now read 200 letters inside it, and a page may end where the typed body ends, before its notes. The same blind verdicts were re-scored against v2. DTA moved from 87 / 37 to 89 / 35 books.
- The EEBO transfer was started once before CAMENA was done and stopped within two minutes (the brief asked for one source at a time); its multipart upload was aborted.
- The translation rule's weaker tier was tightened twice while reading its output; the by-eye 20 were drawn after the last change.

**Replicated?** No.

**Artifacts.**
- Code: `scripts/eval/typed-refs-6012/` (`ingest.mjs`, `eebo-stream.mjs`, `meta.mjs`, `match.mjs`, `align.mjs`, `match-translations.mjs`, `translation-passage-probe.mjs`, `eye-packets.mjs`, `eye-score.mjs`, `summarise.mjs`, `lib.mjs`).
- Rights: `scripts/eval/typed-refs-6012/rights.json`. By eye: `scripts/eval/typed-refs-6012/eye-verdicts.json`; the readers' instructions: `scripts/eval/typed-refs-6012/readers/`.
- Packed rows: `scripts/eval/output/typed-refs-6012-2026-10-06.*` (manifests for DTA and CAMENA; for EEBO-TCP the 745 matched texts' rows; pairs; aligned pages; translations; translation passages; `summary.json`).
- Private R2, bucket `sl-corpus-snapshots`, prefix `eval-refs/typed-refs-6012/`: `raw/` (three packages), `derived/<source>/tei-pages-v1/` (text by page), `manifests/` (full manifests, 60,326 EEBO rows; keys and hashes in `summary.json`).
