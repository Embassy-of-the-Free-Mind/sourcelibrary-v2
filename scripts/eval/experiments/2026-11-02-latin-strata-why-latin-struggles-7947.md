---
stage: ocr
measure: [judged]
languages: [la]
scripts: [Latn]
canons: []
n_books: 109
n_pages: 327
verdict: "Latin's weakness is handwriting, not age and not the language. On 109 live Latin books drawn at random by era and by form checked on the image (327 pages, Opus against the image, second reader on every serious call, 263 of 288 confirmed), manuscripts carry 4.4 sense-changing errors per 1,000 words (95% CI 3.5-5.5; 1.2 a page) in every era from before 1450 to after 1700, and print carries 1.15 (0.7-1.6; 0.4 a page). Incunabula are the weak end of print: 1.7 per 1,000, and 4 of 8 books have a page that is wrong or mostly wrong, from heavily abbreviated commentary and wrap-around layouts. Within manuscripts the reader matters: Flash-Lite 6.3 per 1,000 (4.8-7.9), Gemini 3 Flash 2.8 (1.9-3.9). Within print it does not (1.17 vs 1.02). Five Harvard microfilm-strip books carried text invented by the reader; with a by-eye wrong-leaf book and one invented blank page, 14 pages in 6 books are contained."
status: informational
decision: "Contained 14 pages in 6 books (held: latin-strata-contained-7947). Recommended, not applied: route Latin manuscripts (584 live books, 98K translated pages) to the Opus manuscript reader the routing table already names (scripts/batch/claude-ocr.mjs) after a 78-page test on this draw's lite-read manuscripts; withhold the remaining strip pages of the ~20 live Harvard VIT.BB microfilm books (DECISION, ~380 pages); correct lite-read incunabula with lite>opus after a 24-page test. Later print needs no reader change."
superseded_by: null
issue: [7947, 7933, 7866]
router_evidence: "none — a stratified quality census of the served text; no router cell's k/n is updated (the route cut is observational, not a paired arm)"
defect_rates: "scripts/eval/results/latin-strata-7947/analysis/defect-rates.json"
---
## 2026-11-02 · Why Latin struggles: a stratified review by era and form, with severity (#7947)

PRIOR ART: `2026-11-02-latin-by-age-7933.md` (the #7866 re-cut this study was asked to make decision-grade: 29 books,
2 manuscripts, 8 incunabula, form unknown for a third), `scripts/eval/spot-check/` (REVIEWER.md, SECOND-READER.md,
redact-rights.mjs, reused verbatim), `scripts/eval/confidence-7866/regrade.mjs` (`gradeOf()`, imported; it now runs its
main only as a script). The draw is new because no existing draw stratifies by era and hand.

### Frame and draw (model-free)

Live Latin books (`visible`, `pages_count > 0`, language Latin) with at least 3 translated pages: 9,174 books.
Era from the first 4-digit year of `published` (a "14th century" becomes 1350; no year is its own row). Hand from the
pages' own `script_type` tags (`bookHand()`, ≥ 3 tagged pages; else manuscript before 1450, print after). Seed 20261102,
8 books per cell (smaller cells: all), 3 pages per book at 25/50/75% of the pages that carry both texts, skipping pages
under 40 words. Then every drawn book's form was checked on one image (Sonnet, one call per 37 books): 8 of 109 were
reclassified. The whole "before 1450, print" cell was four manuscripts and a blockbook (the pages' tags said
`printed`), and italic-type verse had been tagged handwritten. The tables use the form seen on the image.

### Review

Opus (`claude -p`, subscription) with `REVIEWER.md` verbatim, image-grounded, 22 packets of 5 books. A second Opus
reader with `SECOND-READER.md` on all 288 serious calls: 251 confirmed, 12 reclassified (still serious), 23 real but
not serious, 2 not an error. A miss check: a fresh reader re-read 10 books (30 pages) the first reader had found clean;
it found one serious error (a dropped prefix, `ob intolerantiam` → `in tolerantia`), 0.23 per 1,000 words. So the
rates below are not much inflated by over-calls and not much deflated by misses, reader against reader. Neither reader
is a reference transcription; a typed-edition check of this judge type found it misses about half of strict-bar
errors on print (`2026-11-01-judge-calibration-7866-bar-7263.md`).

Severity mapping (stated in `analyze.mjs`): a `serious` call counts as sense-changing. It is text not on the leaf
(`wrong_text`) for page and OCR classes and for dropped or invented English; otherwise `misleads`. Moderate and minor
are cosmetic. Page fidelity = min(OCR score, translation score); a wrong leaf is 1. Book grade: D if any page has
fidelity ≤ 2, else A ≤ 1 sense error per 1,000 words, B ≤ 5, C more. **These rates use REVIEWER.md's "serious", which
is stricter than #7866's "misleads"**: compare cells within this study, not with the 10.7 per 1,000 of #7933.

### 1. Per cell (confirmed calls; book-cluster bootstrap 95% CI)

| Cell (era · form on the image) | Books | Pages | Sense-changing errors per 1,000 words | Text not on the leaf, per 1,000 | Pages clean | Books A / B / C / D |
|---|---|---|---|---|---|---|
| before 1450 · manuscript | 11 | 33 | 5.22 (3.85–6.90) | 3.12 (1.91–4.62) | 10/33 | 0 / 2 / 0 / 9 |
| before 1450 · print | 2 | 6 | 0 | 0 | 6/6 | 2 / 0 / 0 / 0 |
| 1450–1500 · manuscript | 8 | 24 | 3.07 (1.41–5.00) | 1.75 (0.85–2.69) | 15/24 | 2 / 2 / 0 / 4 |
| 1450–1500 · print | 8 | 24 | 1.66 (0.77–2.45) | 0.96 (0.32–1.57) | 13/24 | 3 / 1 / 0 / 4 |
| 1501–1550 · manuscript | 8 | 24 | 5.30 (1.16–10.99) | 2.95 (0.84–5.99) | 13/24 | 3 / 1 / 0 / 4 |
| 1501–1550 · print | 8 | 24 | 0.75 (0.10–1.71) | 0.25 (0–0.61) | 21/24 | 6 / 1 / 0 / 1 |
| 1551–1600 · manuscript | 6 | 18 | 6.86 (3.17–12.41) | 3.72 (1.11–6.99) | 9/18 | 1 / 1 / 0 / 4 |
| 1551–1600 · print | 10 | 30 | 1.94 (0.62–3.58) | 0.97 (0–2.32) | 24/30 | 5 / 3 / 0 / 2 |
| 1601–1700 · manuscript | 8 | 24 | 4.67 (2.56–6.57) | 2.85 (1.66–4.16) | 14/24 | 2 / 2 / 2 / 2 |
| 1601–1700 · print | 8 | 24 | 1.00 (0.11–1.93) | 0.38 (0–0.90) | 19/24 | 6 / 1 / 0 / 1 |
| 1701+ · manuscript | 8 | 24 | 3.63 (0–8.50) | 2.12 (0–4.89) | 20/24 | 6 / 0 / 0 / 2 |
| 1701+ · print | 8 | 24 | 1.00 (0.09–2.46) | 0.63 (0–1.42) | 19/24 | 5 / 2 / 0 / 1 |
| undated · manuscript | 7 | 21 | 3.58 (1.87–6.37) | 2.21 (1.19–3.86) | 9/21 | 1 / 0 / 0 / 6 |
| undated · print | 9 | 27 | 0.83 (0–1.90) | 0.42 (0–0.95) | 23/27 | 6 / 0 / 0 / 3 |
| **all manuscript** | 56 | 168 | **4.43 (3.45–5.51)** | 2.61 (2.01–3.28) | 90/168 | 15 / 8 / 2 / 31 |
| **all print** | 53 | 159 | **1.15 (0.74–1.59)** | 0.58 (0.32–0.86) | 125/159 | 33 / 8 / 0 / 12 |
| print before 1501 | 10 | 30 | 1.42 (0.59–2.20) | 0.82 (0.24–1.40) | 19/30 | 5 / 1 / 0 / 4 |
| print 1501 and later | 34 | 102 | 1.13 (0.60–1.73) | 0.53 (0.23–0.91) | 83/102 | 22 / 7 / 0 / 5 |

As judged (first reader only): manuscript 4.76 (3.70–5.95), print 1.34 (0.89–1.83); every cell is within its CI of
the confirmed figure (`analysis/analysis.json`, `modes.judged`). In plain terms: a manuscript page carries about 1.2
sense-changing errors, and 59 of 168 manuscript pages (35%) are wrong or mostly wrong; a printed page carries about 0.4,
and 17 of 159 (11%) are wrong or mostly wrong. More than half the manuscripts (31 of 56) have at least one such page.

### 2. Error kinds (confirmed calls; a keyword rule over the reviewers' own words, so counts are approximate)

- **Manuscripts before 1501** (57 pages): abbreviation read wrongly 23, a translation built on that misread 23,
  translation's own error 12, invented text 7, strip read from expectation 4, numerals 5, invented margin 3.
  - [Origen, Tractatus super Leviticum, p47](https://sourcelibrary.org/book/6a0c53fc99c52ea845a06630/page/47): the leaf has
    `n[on] tam[en] om[n]ia conceduntur` (but not all is granted); the text has *etiam omnia conceduntur* (even all), and
    the English follows it.
  - [Conpotus magistri Roperti anglici, p30](https://sourcelibrary.org/book/69f32d7e876dd827cbc42eb1/page/30): the leaf has
    the 76-year / 940-lunation cycle; the text has *16 anni … 20 luner*.
- **Manuscripts 1501 and later** (90 pages): translation's own error 20, the facing leaf's edge read as this page's
  margin or column 12, translation built on a misread 12, numerals 11, abbreviation 7, strip read from expectation 5.
  - [Pontifical, p2](https://sourcelibrary.org/book/69f33932876dd827cbc5487b/page/2): `Adv̄s` (ad vesperas) expanded as
    *Adventus* every time, and folio numbers lose their `c` (f. c. ii, 102, becomes 2).
  - [Composite manuscript relating to Federico Borromeo, p10](https://sourcelibrary.org/book/69f33ac2876dd827cbc58229/page/10):
    the image is a 2000 × 220 px microfilm strip of several openings; the text is a fluent Latin letter about the
    Ambrosiana built from the catalogue title. (Contained.)
- **Print before 1501** (30 pages): translation's own error 5, a passage dropped from the English 3, abbreviation 3,
  translation built on a misread 3, a column or line dropped from the OCR 2, numerals 2, long s 1.
  - [Scotus, Quaestiones, p591](https://sourcelibrary.org/book/69dbc9c01040d1d5e20a5f41/page/591): `cōmuni ꝯcordia`
    (common agreement) read as *communi discordia*; the sons divide the land "by common discord".
  - [Cicero, De officiis with commentary, p93](https://sourcelibrary.org/book/69dbc9571040d1d5e20a25e1/page/93): a
    14-line commentary column and a line of Cicero are missing from the OCR.
- **Print 1501 and later** (102 pages): translation's own error 10, wrong leaf 5 (one book), numerals 4, a passage
  dropped from the English 4, long s 2.
  - [Cicero, Ad Atticum, p526](https://sourcelibrary.org/book/6a0851ce15c643eb1af4b329/page/526): `negant` (they deny)
    rendered "they say", and a `non` dropped from the OCR: two sentences say the opposite of Cicero.
  - [Bruni, Historiarum Florentinarum, p162](https://sourcelibrary.org/book/69aeb688bf00526d1d64c3b9/page/162): the
    image is printed page 143 (checked by eye); the text is page 148. The gap grows from 1 to 7 pages through the book:
    the Internet Archive leaf-drift class (#3368, #4790). (Contained.)
- Long s read as f is now rare (7 calls in all): the long-s pass (#5924) restored it in stored lite and flash Latin
  from 1501 on.

Translation errors that come from the OCR versus the translator's own: before 1501, manuscripts 23 vs 13, print 3
vs 8. In later print the translator's own errors lead (negations, `negant`, lookahead text from the next page).

### 3. Within-cell comparisons

- **Route, within manuscripts (pooled; observational, not paired):** Flash-Lite 6.3 per 1,000 (4.8–7.9; 34 books,
  95 pages), Gemini 3 Flash 2.8 (1.9–3.9; 27 books, 73 pages). The reader is tangled with the holding library: all 10 Embassy (BPH)
  manuscripts and the strip films were read by Flash-Lite, the Laurenziana, Leiden, Bodleian and Vatican ones by 3
  Flash, and Harvard's split 12 to 10. Part of the gap may be the books, so the test below pairs them. **Within print:** Flash-Lite 1.17 (0.37–2.13), 3 Flash 1.02 (0.46–1.68): no difference. Print before 1501
  is nearly all Lite (8 of 10 books), so it cannot be split.
- **Abbreviation density:** the OCR expands most marks, so marks kept in the transcription do not predict the rate
  (before 1501: < 0.5 marks per 100 words 3.95 per 1,000, ≥ 3 marks 1.42). By density seen on the image (the form
  check): heavy 3.8 (2.6–5.2), some 2.4 (1.8–3.3), few 3.2 (1.5–5.1). Handwriting, not mark density, carries the
  difference.

### 4. Corpus scale (live Latin books, 2026-11-02; form from the pages' own tags, which this draw found wrong for 8 of 109)

| Era · form | Live books | Pages | Pages with OCR | Pages translated |
|---|---|---|---|---|
| manuscript, all eras | 584 | 115,397 | 104,870 | 98,092 |
|   of which before 1450 | 249 | 51,068 | 46,651 | 44,209 |
|   of which 1450–1500 | 125 | 34,146 | 31,106 | 29,304 |
|   of which undated | 101 | 11,935 | 10,671 | 9,739 |
| print 1450–1500 | 1,843 | 486,605 | 258,053 | 245,568 |
| print 1501–1700 | 21,692 | 5,440,661 | 1,323,033 | 1,146,151 |
| print 1701+ | 4,540 | 1,541,082 | 371,737 | 340,690 |
| print, undated | 3,295 | 237,712 | 89,173 | 36,527 |

Harvard `VIT.BB` microfilm records (all Latin): 26 books, 24 live; about 20 of them are wholly strips of several
openings at about 220 px high (w/h ≥ 4 on every page), roughly 380 pages, nearly all translated.

### 5. What would fix each weak cell (none launched here)

- **Manuscripts, every era (584 books, 98K translated pages).** The routing table already names the reader:
  "Handwritten pages → Claude Opus" (`scripts/lib/ocr-routing-table.json`, #6544: 9.9% CER against 16.1% for
  Flash-Lite on 76 expert-transcribed pages), not yet routed. Test: re-read this draw's 26 Lite-read manuscripts
  (78 pages, strips excluded) with `scripts/batch/claude-ocr.mjs` (subscription), and judge them with the same
  REVIEWER.md + second reader. Adopt if sense errors per 1,000 words at least halve and no page gains invented text.
  About 1% of one account-week.
- **Microfilm strips (Harvard VIT.BB, ~20 books).** No reader can read a 220-px strip of six openings; every reviewed
  page was invented or a description. Withhold the strip pages (detector-scale, so it needs a yes) and re-source each
  opening at full resolution. Test: fetch one canvas at full size from Harvard's IIIF (it answers 403 to this box) and
  see whether a single opening is legible.
- **Incunabula (1,843 books; 7 of the 8 drawn read by Flash-Lite).** Already gated from new translation
  (`latin-incunabula` in `scripts/lib/ocr-trust-gate.mjs`). The measured upgrade for Lite Latin print is the Opus
  correction of the Lite draft (`2026-10-24-latin-lite-opus-correct-vs-flash-reread-5924.md`: misleading pages 86/225
  → 6/225). Test: the 24 drawn incunabula pages through the lite>opus correction, same judging; adopt if no page stays
  wrong or mostly wrong and the rate halves.
- **Print 1501 and later.** No reader change: 1.1 per 1,000, the same on both readers. The leading kinds are the
  translator's own (negations) and IA leaf drift, which has its own detector and repair (#4790).

### Containment (same run, by eye, `containment-on-finding.md`)

Held (`latin-strata-contained-7947`, release on #7947) and translations withheld, 14 pages:
`69f33432876dd827cbc4c619` p4, 6, 7; `69f32f93876dd827cbc45a7c` p2, 4; `69f33ac2876dd827cbc58229` p4, 8, 10;
`69f33a41876dd827cbc57c62` p10, 20, 29 (microfilm strips, invented or recited text); `6a4a8b150cf770dd0072204e` p10
(blank verso, invented provenance inscription); `69aeb688bf00526d1d64c3b9` p82, 162, 243 (another leaf's text). The
Mass collection `69f3391e876dd827cbc547fb` was not contained: its OCR describes the strip rather than inventing text
(second reader: real, not serious). Not touched: the stored OCR on those pages (withholding moves the English only),
and book summaries. Two of them (`…c4c619`, `…c58229`) echo the invented OCR ("codification of ecclesiastical
modes", "technical musical instructions"), so that derived-metadata repair is still owed.

### Files

`scripts/eval/latin-strata-7947/` (draw.mjs, run-reviews.sh, build-second.mjs, analyze.mjs, lib.mjs);
`scripts/eval/results/latin-strata-7947/` (draw/sample.json.gz, first/reviews, second/verdicts.json, misses/reviews,
form/, analysis/). Re-run: `node scripts/eval/latin-strata-7947/analyze.mjs --run scripts/eval/results/latin-strata-7947 --out scripts/eval/results/latin-strata-7947/analysis`.
Cost: about $70 list-equivalent on the Claude subscription (22 + 10 + 2 Opus calls, 3 Sonnet calls); no paid API.
