# A taxonomy of what goes wrong on a page, and across pages — by eye

PRIOR ART: `.claude/docs/ocr-difficulty-taxonomy.md` — measures *instability* (same model, same leaf, different text twice) from `page_revisions`; it asks which pages are hard, not what the reader is shown. `scripts/lib/page-integrity.mjs` — the five corpus detectors (truncation, duplicate scan, echoed source, page-number breaks, catchword chaining) and `block-drift.mjs`; they find the classes they were written for. This document is the map of everything else, drawn by opening the images.

**Read this when:** you are choosing which OCR/translation defect to fix next, designing a prompt, a detector, or a judge, or someone reports "the page is wrong" and you need to name the class before you repair it. Living doc — add a class when you see one that does not fit; keep the example URLs real.

**Who is harmed:** a reader of sourcelibrary.org reading an early modern book straight through, page to page. Every entry below says what that reader sees.

Built 2026-09-25 from a stratified by-eye sample: 78 books, 13 strata, one consecutive page pair per book (156 leaves), drawn from the local mirror by `scripts/eval/results/page-error-taxonomy-2026-09-25/sample-strata.mjs`. Eight readers opened every image, read the OCR and the translation, and wrote per-book findings to `scripts/eval/results/page-error-taxonomy-2026-09-25/findings/<stratum>.md`. Every claim there is labelled `[image]`, `[ocr↔image]`, `[tr↔ocr]` or `[tr↔image]`, and the entries below inherit those labels: a class is listed only where at least one reader saw it on the leaf.

**How to read the numbers.** "Seen in" gives *presence*: books in which at least one page of the pair showed the class, over the six books drawn for that stratum. They are not rates. Six books cannot give a rate, and a page pair is one observation of a book, not two. Rates exist only where a corpus detector has run, and are cited from its issue. The lesson that started this (#4681, #5103): a judge that only read the English missed every fidelity defect, so the order of reading is image, then OCR, then translation.

---

## The shape of the problem

Forty-four classes are listed below; fourteen were already known, thirty are new. Grouped by *mechanism* rather than by lane, almost all of them are one of seven things:

1. **The model reads what it expects, not what is there.** Confabulation on an illegible leaf, reciting a remembered canonical text, silently normalising a variant spelling, expanding an abbreviation the wrong way, and then — in the translation lane — turning garbage OCR into fluent prose and explaining misreads with invented scholarship. This family is the largest, it is invisible from the English alone, and the same instinct that makes the model a good reader makes it a confident fabricator. (O1, O3, O6, O7, O8, T7, T10)
2. **The page unit is not the leaf.** Unsplit spreads, a strip of the facing page in the frame, three pecha leaves on one board, an image one leaf behind its text, a Hebrew book with its pages reversed. The OCR then transcribes a *unit* that has no single reading order, and everything downstream inherits the confusion. (I1, I3, I4, I5, I6)
3. **Page furniture and apparatus have nowhere to go.** Running heads, catchwords, signatures, block-hearts, footnote anchors, marginalia, interlinear glosses, plate labels, tables. The schema has a handful of tags for these; the model mis-assigns them, and the renderer trusts the assignment. (O11, O12, O14, O17, T13)
4. **The seam.** Catchwords, split words, and what the translator does with the last clause of a page. Around 30 of the 78 breaks read had a defect; the harm concentrates there. (T4, T5, T6)
5. **Two texts on one page.** Facing or interlinear translations, a Latin crib beside the Greek, an English source that needs no translation at all. The pipeline assumes one source language and one target; where that is false it translates the crib, blends both, translates both, or paraphrases English into worse English. (T11, T12)
6. **Self-reported tags are trusted downstream.** `<language>`, `<script>`, `<columns>`, `<page-type>`, `<page-num>` are the model's own guesses, and routing, strata, `lang=` attributes and the page-integrity detectors all read them as facts. (O16, I7, E2)
7. **The display contract is not enforced at write time.** Unknown tags, broken tags, whole translations wrapped in `<meta>`, markdown that does not render. (D1, T3)

The cheapest wins are detectors that need no model: `<vocab>` words absent from the body (O5), OCR `<page-num>` against the printed folio (I1, O11), catchword against the next page's opening (I6, T6, already in `page-integrity.mjs`), identical blocks inside one page's OCR (O4), Unicode block of the OCR against the book's script (O2), `tr_len ≪ ocr_len` with a long `<meta>` (T3), same-language source (T12). The expensive win is one **source-grounded fidelity judge** that reads the image, and it is the only thing that catches family 1.

---

## Strata

| key | stratum | what the draw selected | what it actually contained |
|---|---|---|---|
| dense | dense single-column prose, 1500–1799 | ≥2,600 reading chars, printed, one column | as intended |
| multicol | `<columns>2+` on both pages | | only 2 of 6 are real two-column pages; the rest are unsplit spreads or facing-page strips tagged as columns |
| ms | `<script>` handwritten | | Tibetan pecha boards ×2, Gurmukhi, secretary hand, Maya/Spanish photograph, Latin textualis |
| short | 25–260 reading chars | | mostly NOT short: the length metric ignores tags and junk; one "108-char" page holds 8,100 lines of `\|` |
| illus | page N typed illustration/plate/diagram | | 5 real plates; one text-only book (wrong `page_type`) that turned out to be a wrong-leaf offset |
| music | title/subject mentions music | notation-like words in OCR | 2 of 12 leaves carry staff notation; no tablature, no lyrics; also astrology and a Psalm commentary |
| tables | index/table type or markdown table | | as intended, plus a Syriac grammar paradigm and a hieroglyphic dictionary |
| greek | language Greek | | 2 of 6 are manuscripts catalogued as prints; 2 are parallel-text editions |
| rtl | Hebrew/Arabic/Syriac/Persian | | 4 manuscripts, 1 Syriac/French edition; no Rashi script, no Mikraot Gedolot layout |
| cjk | Chinese/Korean/Tibetan | | 3 Chinese woodblock, 2 Korean, 1 Tibetan pecha board |
| incun | 1450–1500 | | 1 is a manuscript; 1 is a Suetonius catalogued as a German prognostication |
| c17 | 1600–1699 western | | as intended |
| c19 | 1800–1899 | | 3 English, plus Yoruba, Greek and lithographed German |

That the strata are mislabelled is itself a finding (E2): the corpus's own tags and length fields are not reliable enough to sample by.

---

## Classes

Entry format. **Reader sees** · **Lane** (image / OCR / translation / derived / display) and on-page or cross-page · **Seen in** (books per stratum, presence only) · **Example** (a real page, with what the reader opened) · **Detector / issue** · **Fix**. Severity is for the reader: *high* = misled or text lost, *medium* = confusing but recoverable, *low* = cosmetic.

### Image and page-unit lane

### I1 · Image one leaf away from its text — KNOWN
- **Reader sees:** the scan beside the text is the previous (or next) printed page; the OCR's own `<page-num>` disagrees with the folio printed on the image.
- **Lane:** image ↔ OCR pairing · whole-book offset (cross-page).
- **Seen in:** illus 1/6 (a text-only pair that entered the stratum on a wrong `page_type`), music 1/6.
- **Example:** https://sourcelibrary.org/book/the-music-and-musical-instruments-of-southern-india-and-the-day/page/69ef2b7985daccce30f2e867 — record 87 carries `<page-num>62` and the text of printed p.62, the image is p.63; record 88 carries p.63's text under the image of p.64 `[ocr↔image]`. Also https://sourcelibrary.org/book/a-history-of-hindu-chemistry-vol-2-ray/page/69d006cf7d7491182a23265e (Ray, one leaf off on both pages).
- **Detector / issue:** `checkAlignment()` (dHash) in `page-alignment.mjs`; #3368, #4790, #5095, #3280. The `<page-num>`-vs-image check is cheaper and was not run on these books.
- **Fix:** the two-sided arbitration in `paired-artifacts.md` (IIIF leaf vs R2 copy) before any repair; never re-OCR into a misaligned image.

### I2 · Duplicate scan, back to back — KNOWN
- **Reader sees:** the same leaf twice; the OCR reads it twice.
- **Lane:** image · cross-page (N vs N+1).
- **Seen in:** c17 1/6 — the two images are byte-identical (same md5).
- **Example:** https://sourcelibrary.org/book/philadelphia-or-brotherly-love-to-the-studious-in-the-anonymous/page/6984f5ebe07982a8f8ab9179 pages 90/91 `[image]`.
- **Detector / issue:** `duplicateScan()` (bigram Dice ≥ 0.9); #5056 (20/20 confirmed by pixel correlation).
- **Fix:** soft-hide the duplicate, renumber, recount.

### I3 · Spread not split — KNOWN (with two new consequences)
- **Reader sees:** two printed pages in one image; the text panel holds one of them (the other page is lost from the record) or both tagged `<columns>2`; the translator sees the facing half and describes it in `<meta>`.
- **Lane:** image · on-page and cross-page.
- **Seen in:** dense 1/6, c17 2/6, multicol 2/6, tables 1/6, rtl 1/6, greek 1/6 — 7 of 78 books.
- **Example:** https://sourcelibrary.org/book/hippocrates-twenty-seven-treatises-hippocrates/page/6993890274305116d72d0aec — a microfilmed codex opening; OCR says "I am transcribing the right-hand page" and drops the left page's ~33 lines `[image]`, `[ocr]`. https://sourcelibrary.org/book/aelia-laelia-crispis-not-born-rising-again-malvasia/page/6973479ec4c6c16f3cabbff1 — translator's meta summarises the half that this record does not transcribe (new: *other-half bleed*).
- **Detector / issue:** `image-classifiers-and-splits.md`; #2454 (split at detection time), #3593, #4796 (RTL split backwards).
- **Fix:** split before OCR; where a spread is kept deliberately (Loeb openings), tag it as an opening and transcribe both pages in order.

### I4 · Neighbour strip in the frame, read as content — NEW · #5131
- **Reader sees:** a "second column" of half-words (`the / eius / pau / tate / pro`) beside the real text, sometimes "translated" into a vertical list of English stubs; or the strip reported as water-damaged, illegible text; or the strip's line-ends transcribed as this page's marginalia and translated; or, worst, the line openings reconstructed into fluent invented Latin.
- **Lane:** image → OCR (→ translation) · on-page.
- **Seen in:** multicol 2/6, short 2/6, illus 1/6, incun 2/6, rtl 1/6 (correctly ignored), music 0 — 8 of 78 books with a strip, 7 mishandled.
- **Example:** https://sourcelibrary.org/book/histoire-de-la-condannation-des-templiers-celle-du-schisme-dupuy/page/69f69640aee36685de864880 p.228 — the right-hand strip shows only `deti / pos / quo / & p / qua / exig …`; the OCR emits whole sentences (`Vota hæc, quæ Romani Pontifices & Episcopi exigebant, habebant in se…`) `[ocr↔image]`. https://sourcelibrary.org/book/camandemetes-ye-vii-dedli-synes-ye-werkes-of-mercy-kempe/page/69f3313f876dd827cbc4895f — facing-page line-ends become `<margin>` blocks and are translated as "friars / poverty / lechery / plainly / wedded".
- **Detector / issue:** none. `<columns>2</columns>` on a one-column page is the tell; #3088 (gutter re-crop) is adjacent.
- **Fix:** crop-time strip detection (a narrow column of ragged line-ends at one edge); an OCR rule that a column whose tokens are mostly fragments is not a column.

### I5 · Several leaves in one photograph (pecha boards) — NEW · #5132
- **Reader sees:** three loose Tibetan leaves on a board as one "page"; the next image holds their three versos, so page N→N+1 on the site is recto A, B, C then verso A, B, C — not a reading order in principle; the OCR mixes or duplicates the leaves.
- **Lane:** image · cross-page (structural).
- **Seen in:** ms 2/6, cjk 1/6 — every Tibetan book in the sample.
- **Example:** https://sourcelibrary.org/book/mdo-sde-brtags-sna-rgyas-pa-collection/page/69e782a4d93c1f6007504236 — three rectos with yig-mgo on 80, three versos on 81 `[image]`.
- **Detector / issue:** none. Related to the Yigdzin lower-leaf first-line drop (`lesson_positional_omission_invisible_to_order_free_identity`, #4523/#4722), which is the same page-unit problem one level down.
- **Fix:** slice boards into leaves at import (the Breen microfilm imports already "strip-slice"); order recto/verso by folio label; until then, hold Tibetan boards out of page-level translation.

### I6 · Pages in reverse order (RTL books) — KNOWN
- **Reader sees:** page 16 is the page before page 15; the catchword of 16 opens 15.
- **Lane:** image/sequence · cross-page.
- **Seen in:** multicol 1/6.
- **Example:** https://sourcelibrary.org/book/the-book-of-brightness-hakana/page/6911cf898cb6d2ae494a106d `[ocr↔image]`.
- **Detector / issue:** #4796 (41 books split backwards). `catchwordBoundary()` in `page-integrity.mjs` detects it cheaply and was not run here.
- **Fix:** re-sequence from catchwords; RTL-aware split.

### I7 · Catalogue identity or format wrong — NEW · #5133
- **Reader sees:** a "1561 print" that is a manuscript; a "Prognosticon for Leipzig, 1490 [German]" whose leaves are a Latin Suetonius with commentary; a manuscript in the incunabula. The OCR's own `<script>handwritten</script>` contradicts the record.
- **Lane:** derived (catalogue) · book-wide.
- **Seen in:** greek 2/6, incun 2/6.
- **Example:** https://sourcelibrary.org/book/prognosticon-for-leipzig-1490-german-faber-de-budweis — Suetonius, *Vitae Caesarum* with the Sabellicus/Beroaldus commentary `[image]`. https://sourcelibrary.org/book/cologny-fondation-martin-bodmer-cod-bodmer-115-africanus (catalogued as a 1561 print).
- **Detector / issue:** none for format. `<script>` tag vs catalogue is a free check. Related: #4043 (drifted values), #4654 (`books.language`).
- **Fix:** a `format` field asserted from the OCR's script tags across the book; fix the four records named in the findings.

### OCR lane — the text is not the leaf's text

### O1 · Confabulation on an illegible or unfamiliar leaf, in the right language — KNOWN (#3591), now seen by eye
- **Reader sees:** a fluent page in the right language and genre that is not on the leaf: a treatise on divine simplicity where the leaf is a recipe list; the Yom Kippur confession with invented hour markers and an invented catchword; "On Inflammation" where the manuscript is about menses; a Euclid built on hallucinated Greek. The translation renders it faithfully and the summary and keywords confirm it, so nothing downstream objects.
- **Lane:** OCR · on-page, often whole-page.
- **Seen in:** greek 1/6 (two pages), rtl 2/6 (three of four Hebrew-cursive pages), illus 1/6, multicol 1/6 (from a strip), ms 1/6 (leaf interiors), cjk 1/6 (templated) — 7 of 78 books.
- **Example:** https://sourcelibrary.org/book/sifre-mada-segulot-anonymous/page/69c1bafc8522835be845c030 — image: 8 numbered remedies in a cursive hand; OCR: "כי אם בעל פשוט יש בו האחדות גמורה…" `[ocr↔image]`. https://sourcelibrary.org/book/hippocrates-twenty-seven-treatises-hippocrates/page/6993890274305116d72d0aec — includes the Modern Greek καλοκαιρίῳ.
- **Tells (free):** anachronistic vocabulary; invented structure (hour markers, a catchword the leaf lacks); a running title that changes; on gter-ma texts the terma mark ༔ on the image and absent from the OCR; identical blocks inside one page (O4); few or no OCR tokens anchored to visible words.
- **Detector / issue:** #3591, #4195 (lacuna marker), #5004; `DESCRIBED_PAGE` catches only the polite version.
- **Fix:** a declining-to-read floor in the prompt with a lacuna marker (#4195); a second engine's disagreement as the gate (as for Syriac, #4883); never translate a page whose OCR carries no anchored tokens.

### O2 · Wrong-script fabrication — KNOWN
- **Reader sees:** Devanagari Sanskrit ("Homage to Shri Ganesha…") on a Tibetan biography.
- **Lane:** OCR · on-page.
- **Seen in:** ms 1/6.
- **Example:** https://sourcelibrary.org/book/ratna-gling-pa-i-rnam-thar-legs-bshad-bdud-rtsi-i-rgya-mtsho-collection/page/69e787ae4a6785cfd60ccce3 `[ocr↔image]`.
- **Detector / issue:** #4523 (529 books); Unicode block of the OCR vs the book's script is free and catches it.
- **Fix:** in flight (#4722 Yigdzin lane, held cohort).

### O3 · Canonical-text substitution — NEW · #5134
- **Reader sees:** for a famous text, lines that are not on the leaf and lines on the leaf that are missing: the OCR (or the translator) recites the remembered standard version. Gurbani lines inserted into a Guru Granth Sahib leaf; the Unetanneh Tokef translated with the printed prayer book's "drought" where the manuscript reads "pestilence"; a Diogenes Laertius page "translated" at five times the OCR's length from memory of Book VII.
- **Lane:** OCR and translation · on-page.
- **Seen in:** ms 1/6, rtl 2/6, incun 1/6.
- **Example:** https://sourcelibrary.org/book/pocket-size-jewish-prayer-book-anonymous/page/69c1bade8522835be845b163 p.334 — image and OCR both read "מי בדבר ומי ברעב"; the English gives "who by famine and who by drought" `[tr↔image]`. https://sourcelibrary.org/book/sri-guru-granth-sahib-1691-manuscript-chand/page/6992ce7477d26f9321777162.
- **Detector / issue:** none. Tell: translation length ≫ OCR length on a well-known text; refrain present on the image and absent from the OCR.
- **Fix:** for canonical works, a diff against the standard text is the *detector*, not the target; prompt rule that variants are the point; withhold translation where OCR anchors are few.

### O4 · Block-level repetition — NEW (the token-level loop is KNOWN) · #5135
- **Reader sees:** thousands of lines of `|` or `...`; or the same 40-word dharani seven times; the same paragraph for three different leaves; a stanza twice; "and the secret of the Shekhinah and the secret of the Shekhinah…" for 3,500 characters, faithfully translated.
- **Lane:** OCR (→ translation) · on-page.
- **Seen in:** short 1/6 (token-level), ms 2/6, rtl 1/6, cjk 1/6, tables 1/6 (line duplicated) — 6 of 78.
- **Example:** https://sourcelibrary.org/book/tikun-shetarot-anonymous/page/69c1bc148522835be846169e `[ocr↔image]`; https://sourcelibrary.org/book/nyang-gter-thugs-sgrub-bde-bshegs-dus-pa-collection/page/69e787a04a6785cfd60cc9f1 (three "Folios" byte-identical).
- **Detector / issue:** type/token ratio < 0.15 (PR #3273) catches the token-level loop only; block-level repeats have a normal ratio. #5004.
- **Fix:** an identical-block check within one page's OCR (shingles ≥ 20 tokens repeated); refuse to translate a page that fails it.

### O5 · Silent omission inside the page — NEW · #5136
- **Reader sees:** nothing — that is the point. A clause, a line, 13 lines, half a column, or the last three lines are gone with no marker, and the two sentences either side are fused into one fluent false sentence ("it has milk within, and it will become copper"; "he was called to Toulouse" where the bishop of Toulouse was summoned to the Curia; Augustus' funeral instructions vanish by homeoteleuton).
- **Lane:** OCR → translation · on-page.
- **Seen in:** short 1/6, greek 1/6, dense 1/6, c17 2/6, multicol 3/6, ms 1/6, tables 1/6, incun 4/6, cjk 1/6 — 15 of 78 books; the readers rated it high on most.
- **Example:** https://sourcelibrary.org/book/de-re-rustica-cato-varro-columella-palladius-1514-varro/page/69af20221e41710a29f5fc7d p.149 — ~13 printed lines dropped mid-chapter and 3 at the foot, and the page's own `<vocab>` lists "Roma, palea, Bagienis", words that appear only in the dropped lines `[ocr↔image]`. https://sourcelibrary.org/book/mundus-subterraneus-tomus-ii-kircher/page/69af0a2069627f8eeaa1b9e8 p.317.
- **Detector / issue:** none for mid-page loss (`truncationRatio()` measures translation vs OCR, not OCR vs leaf). Free tells: `<vocab>` tokens absent from the body; line count vs the book's modal line count; translation longer than the OCR (T14).
- **Fix:** ship the `<vocab>`-vs-body check; a line-count-per-leaf sanity check per book; a source-grounded judge for the rest.

### O6 · Meaning-changing misread, carried into a fluent translation — NEW as a class · #5137
- **Reader sees:** a plausible sentence that is wrong. "Brother Facius was healed" (the saint becomes the patient); "by-laws" become "land" and "set at liberty" becomes "lost"; "the soldiers argue with their commanders" for *become used to obeying*; 隧道葬父 read as "recommend his father-in-law"; "Are they fitting now?" for *sitting*; sin read as life throughout a page. No uncertainty marker, ever.
- **Lane:** OCR → translation · on-page.
- **Seen in:** every stratum: dense 4/6, c17 3/6, greek 3/6, rtl 3/6, ms 5/6, cjk 5/6, incun 6/6, tables 3/6, music 3/6, multicol 3/6, short 2/6, illus 2/6, c19 1/6 — ~43 of 78 books had at least one instance the reader judged meaning-changing.
- **Where it concentrates, by script:** Aldine Greek ligatures (ην, ευ, ος, ᾶν) at the exact points grammar hinges; long-s→f (whole pages); the ꝑ/ꝓ/ꝯ/macron suspension family in incunabula; minim clusters in textura; Fraktur; every cursive hand (Hebrew, Latin, secretary, Gurmukhi, nastaʿlīq); single characters in CJK, on which the translator builds a whole false clause.
- **Example:** https://sourcelibrary.org/book/vita-s-facii-de-cremona-manuscript-13-riant/page/69f32e4e876dd827cbc43dd0 `[ocr↔image]`; https://sourcelibrary.org/book/legal-commonplace-book-1574-1639-bull/page/69f33a7b876dd827cbc57ebd p.66.
- **Detector / issue:** none possible from text alone; `ocr-difficulty-taxonomy.md` locates the unstable pages, which is where this lives. #4790 measured the IA band; #1323.
- **Fix:** the source-grounded fidelity judge (image + OCR + translation) at scale for the flagged pages; per-script prompt exemplars at the known failure points; show the reader the OCR's `<unclear>` rate.

### O7 · Numerals, dates, doses and units — NEW · #5138
- **Reader sees:** "190" soldiers become 150; five years become "[several]"; the 7th day before the end of January becomes the 15th; ʒ ij becomes iij in a recipe; every 萬 and 億 rendered "hundred million" so the value cannot be recovered; a cyclical ganzhi year resolved to a Gregorian year the source does not fix.
- **Lane:** OCR and translation · on-page.
- **Seen in:** ms 2/6, cjk 3/6, music 1/6, incun 1/6, dense 1/6 (citation "fen 3 of book 4" → "third or fourth").
- **Example:** https://sourcelibrary.org/book/complete-works-on-music-and-tuning-vol-1/page/69c6613601a26ccff09f4f42 p.125 `[tr↔ocr]`; https://sourcelibrary.org/book/liber-teisir-kitab-al-taysir-avenzoar/page/69ef2f6672c1376fdf2af282.
- **Detector / issue:** none.
- **Fix:** numerals are a separate check in the judge (every number in the translation must trace to a token in the OCR); a prompt rule for CJK place-value and for cyclical dates (keep the source form, gloss the conversion).

### O8 · Silent normalisation toward the expected — NEW · #5139
- **Reader sees:** the corrupt reading an editor quotes *in order to correct it* silently corrected; variant spellings that an apparatus exists to record replaced by standard ones; a grammar paradigm's cells reordered and the author's forms swapped for textbook forms; transliteration letters differing only by a diacritic conflated (Ȧ/Ā/A); abbreviations expanded without a mark; modern CJK punctuation added inconsistently; stanza closers dropped.
- **Lane:** OCR · on-page.
- **Seen in:** short 1/6, tables 3/6, multicol 1/6, incun 2/6, music 2/6, cjk 1/6, ms 1/6, dense 1/6 — 12 of 78.
- **Example:** https://sourcelibrary.org/book/institutiones-linguae-syriacae-assyriacae-atque-thalmudicae-estienne/page/69b2f3d7a9a500a45e5e8d9d p.87 — printed יְהוּדִי | יְהוּדָאָה | יְהוּדָאִין | יְהוּדָיֵא becomes columns swapped and textbook endings `[ocr↔image]`. https://sourcelibrary.org/book/an-egyptian-hieroglyphic-dictionary-vol-2-budge/page/69b52fab1a04ee0f3b4182d7.
- **Detector / issue:** none; #1323 (20–26% agreement across editions) is the corpus-level symptom.
- **Fix:** a diplomatic-transcription policy per book (declared once, applied to every page, see O9); prompt rule "transcribe what is printed, mark expansions"; for tables, forms are data.

### O9 · Convention flips between adjacent pages — NEW · #5140
- **Reader sees:** nothing on one page; across a break, ſ kept / ſ→s / ſ→f, diplomatic vs fully expanded, line-broken vs reflowed, `^a` vs `$^a$` note keys, a vocalised Syriac page next to an unvocalised one from the same edition. Search and quoting break; a Syriacist takes the vowels as the printer's.
- **Lane:** OCR · cross-page.
- **Seen in:** dense 3/6, c17 1/6, rtl 1/6, incun 2/6 — 7 of 78.
- **Example:** https://sourcelibrary.org/book/pseudodoxia-epidemica-or-enquiries-into-very-many-received-browne/page/69aec19cdd3c98abc0da87ac — 246 normalises ſ, 247 renders every ſ as f ("incomprehenfible", "Refurrection") `[ocr↔image]`; https://sourcelibrary.org/book/patrologia-orientalis-tome-ii-inc-vie-de-severe-scholasticus/page/69a99d0a510aaf87d0635cf0 (vowel points invented on 244 only).
- **Detector / issue:** none; a per-book ſ-ratio and expansion-ratio by page would show it.
- **Fix:** one declared convention per book, checked at write time (a page that disagrees with its neighbours' convention is re-run with the book's setting).

### O10 · Secondary script on the page dropped or garbled — NEW · #5141
- **Reader sees:** the Greek quotation inside a Latin commentary replaced by garbage or absorbed into the translation; Hebrew in Kircher dropped; a hieroglyphic marginal column neither transcribed nor described; Devanagari dropped; Yoruba tone marks and Hebrew vowel points dropped.
- **Lane:** OCR (→ translation) · on-page.
- **Seen in:** dense 2/6, tables 2/6, incun 1/6, illus 1/6, c19 2/6, multicol 1/6, short 1/6 — 10 of 78.
- **Example:** https://sourcelibrary.org/book/theophrasti-characteres-ethici-theophrastus/page/6a21985ef11c08f10b202bb5 `[ocr↔image]`; https://sourcelibrary.org/book/denkmler-aus-aegypten-und-aethiopien-lepsius-894-plates/page/69e0138d93b116d24238b2b1.
- **Detector / issue:** none; `sourceLanguageCount()` in `page-integrity.mjs` counts languages but not their survival. #4780 (Unicode-aware gate tokenizer) is adjacent.
- **Fix:** the judge checks each script block separately; a per-page script census (image-side classifier vs OCR Unicode blocks).

### O11 · Page furniture mis-tagged — NEW · #5142
- **Reader sees:** the running head as the first sentence (or as an `# H1` in the translation, sometimes merged with the facing page's head); the catchword as the page's last word and translated ("rough, which…"); a signature `-> Θ <-` in the text; the block-heart (版心) title tagged as catchword or page number, or hallucinated as a different classic (金匱要略 for 欽定四庫全書); an edition banner read as the work's title; `<page-num>` taken from a photographer's mount number, a reversed bleed-through numeral, a chapter number in red, or an old-edition margin reference; "Digitized by Google" recorded as the catchword.
- **Lane:** OCR (→ display) · on-page; corrupts cross-page detectors.
- **Seen in:** c19 5/6, greek 4/6, music 4/6, cjk 3/6, dense 3/6, c17 3/6, incun 3/6, rtl 3/6, short 2/6, tables 2/6, ms 2/6, illus 1/6 — ~35 of 78.
- **Example:** https://sourcelibrary.org/book/vol-4-1782366591974/page/6a3cc17fec254ff6cae0cd88 p.97 `<header>金匱要略全書 卷六</header>` on an image reading 欽定四庫全書 `[ocr↔image]`; https://sourcelibrary.org/book/cornucopiae-linguae-latinae-ed-pyrrhus-perottus-rev-ludovicu-perottus-1/page/69dbcb161040d1d5e20b1d9a (`<page-num>XLI` from show-through of LIX).
- **Detector / issue:** `parseCatchword()`, `parsePageNum()`, `pageNumberBreaks()` in `page-integrity.mjs` *consume* these tags; #5059's 45% precision is partly this class. The `<page-num>`-vs-printed-folio check needs the image.
- **Fix:** a furniture schema with a place for each element (header, catchword, signature, block-heart, foliation source); prompt exemplars per book type; renderer never promotes a header to a heading.

### O12 · Marginalia and apparatus dropped, merged, or mis-tagged — NEW · #5143
- **Reader sees:** a marginal note dropped, or merged mid-sentence into the body, or moved to the top of the page; body text wrapped in `<margin>` (and so styled as a note); a superscript footnote number at a line-end hyphen wrapped as `<margin>95. ἐπι-</margin>` so the split word is doubled; interlinear small characters detached as margin; a marginal keyword index fused with the body into a table; note key letters drifting N places so every gloss points to the wrong term; a footnote's attribution dropped; a manuscript's marginal folio labels not recorded while "Folio 1/2/3" is invented.
- **Lane:** OCR (→ translation, display) · on-page.
- **Seen in:** dense 4/6, c17 3/6, greek 2/6, c19 2/6, cjk 2/6, multicol 1/6, tables 1/6, incun 1/6, ms 2/6, rtl 1/6, music 1/6 — ~20 of 78.
- **Example:** https://sourcelibrary.org/book/de-operatione-daemonum-dialogus-1688-greek-latin-psellos/page/69942e97d607f8e57e4b990c p.98 — "ἢ <margin>95. ἐπιπλάττοντες</margin> πλάττοντες" `[ocr↔image]`; https://sourcelibrary.org/book/legal-commonplace-book-1574-1639-bull/page/69f33a7b876dd827cbc57ebd p.66 (body paragraph as `<margin>`).
- **Detector / issue:** none; #2709 (distinguish annotations in the reader), #3825 (closed tag vocabulary).
- **Fix:** define `<margin>` as *position*, `<note>` as *apparatus*, `<fn n>` for footnote anchors; a write-time check that a `<margin>` block is not longer than the body; the judge reads margins as a separate block.

### O13 · Later hands read as text — NEW · #5144
- **Reader sees:** words a reader underlined in pencil tagged `<insert>` and the translation asserting they are later additions; a later reader's alchemical doodles flagged `significance="high"` and given a doctrinal meaning; faint annotations spliced into printed sentences with `<unclear>` guesses; a library stamp labelled "printer's mark".
- **Lane:** OCR → translation · on-page.
- **Seen in:** c17 3/6, dense 1/6, tables 1/6.
- **Example:** https://sourcelibrary.org/book/clavis-ofte-sleutel-boehme/page/69c870956c6f3cc53c85734c p.38 — ink Mercury and Jupiter signs become `<insert>NB</insert>` and "signaling the transition to the next stage of cosmic development" `[tr↔image]`.
- **Detector / issue:** none.
- **Fix:** an `<annotation hand="later">` tag with no translation; prompt rule that manuscript marks on print are not the text.

### O14 · Non-linear content described, not transcribed — NEW · #5145
- **Reader sees:** the ~40 Latin labels on a Lullian plate exist only as an `<image-desc>` paraphrase, unsearchable and unquotable; a staff summarised as "eight diamond-shaped notes" with clef and accidentals lost, then replaced in the translation by "[Diagram showing a musical cadence.]"; an inline alchemical glyph turned into an `<image-desc>` so the sentence loses its noun; a lone mark given a confident English meaning; diagram letters invented in sequence.
- **Lane:** OCR (→ translation) · on-page.
- **Seen in:** illus 3/6, music 3/6, c19 1/6, ms 1/6 (mounting pins described as rivets and glossed).
- **Example:** https://sourcelibrary.org/book/opera-omnia-quibus-tradidit-artis-raymundi-lulliu-lavinheta/page/69f71626a971c4a8e969ff1b p.673 `[ocr↔image]`; https://sourcelibrary.org/book/harmonices-mundi-1619-first-edition-kepler/page/695004e6f426a210d109a5ed p.119.
- **Detector / issue:** none; `music-notation.md` says never batch a vision model over scores.
- **Fix:** labels on plates are text: transcribe them as a list under the description; notation goes to an OMR lane or is marked untranscribed; inline glyphs get a Unicode or `<glyph>` placeholder that keeps the sentence whole.

### O15 · Reasoning, notes and page descriptions inside the OCR — KNOWN
- **Reader sees:** "I am transcribing the right-hand page", "The image is a photograph of a manuscript page, likely from…", "The number 150 is underlined", process summaries, inside the transcription.
- **Lane:** OCR → display · on-page.
- **Seen in:** greek 2/6, ms 1/6, short 2/6, music 1/6.
- **Example:** https://sourcelibrary.org/book/chilam-balam-de-kaua-maler-photographs-1887/page/6a879ba86f4a03d5d89ad55a `[ocr]`.
- **Detector / issue:** `ocrReasoningLeak()`, `DESCRIBED_PAGE` (#5055 side-find, 25 pages); the `<meta>`-wrapped form is not counted.
- **Fix:** already on the list; extend the regex to `<meta>` bodies.

### O16 · Self-reported tags wrong — NEW as a page-level class · #5146
- **Reader sees:** `<language>French</language>` on a half-Syriac page; "Greek" and "Ancient Greek" on facing pages; "Gurmukhi" (a script) then "Punjabi"; `<columns>2` on a one-column page whose second column is the facing page's edge; `<script>` Kurrent on lithographed Latin script; `page_type` illustration on a text page; a rubric number as `<page-num>`. Routing, search filters, this sample's strata, and the `lang=` attribute a screen reader speaks (#5115) all trust these.
- **Lane:** OCR → derived · on-page.
- **Seen in:** greek 6/6, multicol 5/6, ms 4/6, rtl 2/6, cjk 2/6, c19 1/6, illus 1/6, dense 1/6 — ~22 of 78 books with at least one wrong tag.
- **Example:** https://sourcelibrary.org/book/loukianou-hapanta-luciani-opera/page/69de100b5cedf736edb8504e `[ocr↔image]`.
- **Detector / issue:** #4654, #4766 (book-level `language`); nothing page-level.
- **Fix:** derive page tags from evidence (Unicode census for language/script; a layout classifier for columns), and make the model's tag a *hint*; never gate behaviour on one page's tag.

### O17 · Table structure invented or lost — NEW · #5147
- **Reader sees:** a marginal keyword index fused with the body into a row-aligned table; `| X | X |` rows for a single list; a paradigm's cells scrambled; a genealogy grid mis-mapped; an over-long row whose last cell the renderer drops; spanning cells lost; column mismatch in a printed table; prose forced into a `| Right | Left |` table that stops after seven rows.
- **Lane:** OCR and translation → display · on-page.
- **Seen in:** tables 2/6, cjk 1/6, music 1/6, c19 1/6, illus 1/6, multicol 1/6, short 1/6 — 8 of 78. The well-formed tables in the sample rendered fine; the damage was to their contents (O8).
- **Example:** https://sourcelibrary.org/book/cornucopiae-linguae-latinae-ed-pyrrhus-perottus-rev-ludovicu-perottus-1/page/69dbcb161040d1d5e20b1d9a `[ocr↔image]`; https://sourcelibrary.org/book/the-book-of-brightness-hakana/page/6911cf898cb6d2ae494a106d p.16.
- **Detector / issue:** none; a markdown-table lint (ragged rows, duplicate cells, table on a page with no `<page-type>table`) is free.
- **Fix:** tables only where the leaf has ruled or aligned columns; a translation never introduces a table the OCR lacks.

### Translation lane

### T1 · Translation truncated — KNOWN
- **Reader sees:** the English stops a third of the way down the page, or mid-word ("with water and s").
- **Lane:** translation · on-page.
- **Seen in:** greek 2/6, multicol 1/6.
- **Example:** https://sourcelibrary.org/book/plutarchi-chaeronensis-scripta-moralia-vol-3-didot-greek-dubner p.496 `[tr↔image]`.
- **Detector / issue:** `truncationRatio()`, #5055.

### T2 · Echoed source — KNOWN
- **Reader sees:** the original left untranslated (here, one word on one page).
- **Seen in:** short 1/6. **Detector / issue:** `echoedSource()`, #5058.

### T3 · Translation hidden inside a `<meta>` or `<note>` wrapper — NEW · #5148
- **Reader sees:** an empty or near-empty page; the translation exists but the renderer files it under metadata (or styles it as apparatus). `tr_len` far below `ocr_len` with a long `<meta>` is the tell.
- **Lane:** translation → display · on-page.
- **Seen in:** c17 1/6, incun 1/6.
- **Example:** https://sourcelibrary.org/book/henrici-cornelii-agrippae-ab-nettesheym-armatae-militiae-agrippa-von-2/page/69b51e1c47b06ecd5818a11c p.233 `[tr]`.
- **Detector / issue:** `truncationRatio()` would flag it as truncation and a re-translation would be the wrong repair; `NotesRenderer.extractMetadata()` moves `<meta>` bodies out of the text.
- **Fix:** write-time: a `<meta>` longer than the remaining body is unwrapped, not stored.

### T4 · In-block drift / tail block shift — KNOWN
- **Reader sees:** page N's last section missing from N and prepended to N+1, so every word is translated somewhere and no completeness check fails.
- **Seen in:** c19 1/6 (whole sections).
- **Example:** https://sourcelibrary.org/book/fragmenta-philosophorum-graecorum-mullach/page/6a3f02bb97e91e1768f68344 `[tr↔image]`.
- **Detector / issue:** `detectBlockDrift()`, #5021 (~3% of in-block boundaries).

### T5 · Continuity leak and lookahead duplication — KNOWN
- **Reader sees:** the next page's opening clause finished at the end of this page and repeated at the start of the next ("good" translated twice); the previous page's ending re-translated at the top.
- **Seen in:** dense 2/6, music 1/6, rtl 1/6, c17 3/6 (catchword doubled), tables 2/6 — ~9 of 78 breaks.
- **Example:** https://sourcelibrary.org/book/m-antonii-flaminii-in-librum-psalmorum-breuis-explanatio-ad-/page/6a08551415c643eb1af54bd0 `[tr↔image]`.
- **Detector / issue:** `translation-page-boundaries.mjs`; #5026, #5103, #3918.

### T6 · Catchword and split-word seams — KNOWN (#5103), with new sub-variants
- **Reader sees:** at the break, a negation lost ("nõ | misericordia" → "for… Mercy is."), "fœ-|mininam" read as "minimam" and translated "a minimum [signifier]", a doubled syllable, a dropped tail, or — new — a *fabricated bridge*: the translator inserts a bracketed verb to close a sentence whose real verb is on the next page, invents an English split word ("Wo…rds") to fake a join, or writes "[...]" for the continuation half of a word, implying missing text.
- **Lane:** OCR → translation · cross-page.
- **Seen in:** dense 4/6, c17 3/6, incun 4/6, tables 2/6, multicol 2/6, ms 2/6, greek 1/6, rtl 1/6, cjk 2/6, c19 2/6, short 3/6, music 1/6, illus 1/6 — about 30 of 78 breaks carried a defect of some kind; 4 more could not be judged because both sides were invented. Same-language and unbroken paragraph ends were the clean cases.
- **Example:** https://sourcelibrary.org/book/cornucopiae-linguae-latinae-ed-pyrrhus-perottus-rev-ludovicu-perottus-1/page/69dbcb161040d1d5e20b1d9a 158→159 `[ocr↔image]`; https://sourcelibrary.org/book/cologny-fondation-martin-bodmer-cod-bodmer-115-africanus 128→129 (fabricated bridge).
- **Detector / issue:** `catchwordBoundary()`, `parseCatchword()`; #5103 (F0 measured 71%→42% device-break defects, flip is Derek's call).
- **Fix:** the deterministic pre-model join in #5103; prompt rule "never add words to bridge the break, never write an ellipsis for a word half".

### T7 · Fluent-over-garble: no uncertainty floor — NEW · #5149
- **Reader sees:** confident English built on OCR gibberish, on lines the OCR itself marked `<unclear>`, on word stubs from a facing-page strip, on a repetition loop, on an isolated glyph — with no uncertainty marker. Or its inverse on Tibetan: the translator refuses to compose and ships a syllable-by-syllable gloss ("Body, hundred, abandon, again, six, abandon, that, take.") as the page.
- **Lane:** translation · on-page. This is the amplifier for O1, O4, O5, O6: every OCR failure reaches the reader as fluent prose because the translator never declines.
- **Seen in:** ms 3/6, rtl 2/6, illus 1/6, short 1/6, cjk 1/6, greek 1/6, incun 1/6 — 10 of 78.
- **Example:** https://sourcelibrary.org/book/chilam-balam-de-kaua-maler-photographs-1887/page/6a879ba86f4a03d5d89ad55a p.162 — six faded Maya lines wrapped in `<unclear>` rendered as "Here are the five holy portions of the name of our Father God…" `[tr↔ocr]`; https://sourcelibrary.org/book/mdo-sde-brtags-sna-rgyas-pa-collection/page/69e782a4d93c1f6007504236 (token gloss).
- **Detector / issue:** none; #5004 is one instance; #4883's withhold-by-default is the policy answer for whole scripts.
- **Fix:** the translator inherits `<unclear>` (translate inside the tag or not at all); a translatability gate (share of OCR tokens that are dictionary-plausible for the language) before spending on translation; "no translation yet" is a valid output.

### T8 · Sense inverted or a qualifier dropped, with correct OCR — NEW · #5150
- **Reader sees:** cold and hot drugs reversed; a praeteritio read straight; "lucis magnæ" dropped; a negation dropped in Greek; "each guest fearing for his own life" becomes "fearing for the bridegroom's life"; a hedge removed.
- **Lane:** translation · on-page.
- **Seen in:** cjk 3/6, c17 2/6, c19 3/6, dense 1/6, short 1/6, music 1/6 — 11 of 78. Only a source-grounded read catches it; the English is fluent.
- **Example:** https://sourcelibrary.org/book/journey-to-the-west-vol-34-wu-cheng-en-li/page/69dea7c3914eeed04ca4b512 `[tr↔ocr]`.
- **Detector / issue:** none; the seam judges of #4681/#5104 reward fluency and cannot see it.
- **Fix:** the fidelity judge (#5104's source-grounded design) run on-page, not only at seams; polarity items (negation, comparatives, qualifiers) as explicit checks.

### T9 · Quiet omission below the truncation threshold — NEW · #5151
- **Reader sees:** five lines of the Unetanneh Tokef (the shepherd simile and the verdict) gone between two fluent sentences; an opening clause dropped; footnotes dropped; a Greek passage absorbed; a commentary replaced by a one-line note.
- **Lane:** translation · on-page.
- **Seen in:** rtl 2/6, ms 1/6, dense 1/6, greek 1/6, c19 1/6, short 2/6, incun 1/6 — 9 of 78.
- **Example:** https://sourcelibrary.org/book/pocket-size-jewish-prayer-book-anonymous/page/69c1bade8522835be845b163 p.333 `[tr↔ocr]`.
- **Detector / issue:** `truncationRatio()` needs a large ratio; these are 5–20% losses.
- **Fix:** sentence-level alignment (OCR sentence count vs translation sentence count per paragraph) as a cheap screen; the judge for the rest.

### T10 · Invented scholarship in notes and glosses — NEW · #5152
- **Reader sees:** `<note>` and `<gloss>` that explain an OCR misread with confident, false learning: "Saint Rotoi <note>likely a reference to a local feast day</note>" (St Christopher, five years); "Vishnu <note>the Preserver</note>" inserted into Gurbani; "λωθηκαὶ… likely referring to dummy figures or decoys" (loricati); "Kupfer" glossed as counterfeiters; a ratio named the wrong interval; a footnote invented when its text is on the next page; "Chao clan" as "lineage of ancient artisans"; a ganzhi year resolved to a Gregorian date; facts asserted about the previous page.
- **Lane:** translation · on-page.
- **Seen in:** ms 3/6, greek 2/6, music 4/6, illus 3/6, tables 2/6, cjk 2/6, short 2/6, incun 4/6, c17 1/6, c19 1/6 — ~24 of 78. Readers noted that notes lend *authority* to misreads: the wrong reading arrives footnoted.
- **Example:** https://sourcelibrary.org/book/vita-s-facii-de-cremona-manuscript-13-riant/page/69f32e4e876dd827cbc43dd0 p.38 `[ocr↔image]`, `[tr]`; https://sourcelibrary.org/book/alexander-von-tralles-original-text-und-ubersetzung-vol-1-tralles/page/69b1deccca46fa60ea1ee60f p.470.
- **Detector / issue:** #2709 (reader distinguishes annotations); #3825 (verbatim original notes). Nothing checks note *content*. The v15 measurement (`project_translation_prompt_v15_ab`) found interpretive notes fall 36% under a stricter prompt: fewer notes is the direction, not more.
- **Fix:** notes may gloss, never explain a reading; a note that contains "likely", "possibly", "may refer" on a token the OCR marks `<unclear>` is dropped at write time; the judge scores notes against the image.

### T11 · Parallel edition mishandled — NEW · #5153
- **Reader sees:** in a Greek/Latin Didot, a smooth complete "translation of the Greek" that is really Dübner's Latin reconstruction, so the editor's printed lacunae vanish; in a Loeb, a degraded paraphrase of Perrin's facing English presented as the translation; in a Syriac/French edition, one blended English that switches between the Syriac and the French and invents where it follows the Syriac; both columns translated in full, separated by a raw `<column-break/>`, so the reader gets two English versions of one passage.
- **Lane:** translation · on-page.
- **Seen in:** greek 2/6, rtl 1/6, tables 1/6 — 4 of 78 (all the parallel editions in the sample).
- **Example:** https://sourcelibrary.org/book/plutarchi-chaeronensis-scripta-moralia-vol-3-didot-greek-dubner p.495 `[tr↔ocr]`, `[tr↔image]`; https://sourcelibrary.org/book/patrologia-orientalis-tome-ii-inc-vie-de-severe-scholasticus/page/69a99d0a510aaf87d0635cf0.
- **Detector / issue:** #2784 (surface the existing facing English, no re-translation) names the right answer for six Greek editions; `sourceLanguageCount()` ≥ 2 on most pages of a book is the free detector.
- **Fix:** a `parallel-edition` book mode: transcribe both, translate the source column only, and *surface* a printed translation as the edition's own (attributed), never re-translate it.

### T12 · Same-language source rewritten — NEW · #5154
- **Reader sees:** Burton, Taylor, Whinfield, Blavatsky, Browne, Jonson, the Ante-Nicene Fathers "translated" from English into abridged, modernised, interpretively drifted English: "How Abu Hasan Brake Wind" becomes "Broke Wind", "our pleasure was troubled" becomes "ruined", a Sappho commentary condensed to a summary, citations replaced by generic phrases, scholarly footnotes dropped (see T13). A reader of the translation panel never reads the author's prose, and the searchable layer under it may be a bad OCR that the paraphrase silently repaired.
- **Lane:** translation (routing) · on-page.
- **Seen in:** c19 3/6 (one book copied verbatim, correctly), illus 1/6, short 1/6, multicol 1/6, c17 2/6, dense 1/6 — 9 of 78, i.e. nearly every English-source book in the sample.
- **Example:** https://sourcelibrary.org/book/the-book-of-the-thousand-nights-and-a-night-vol-5-burton/page/69a553c467a3da9e7ba5ab5c `[tr↔ocr]`; https://sourcelibrary.org/book/ante-nicene-fathers-vol-2-clement-of-alexandria-eds/page/69ad657f75811c30866e1da0.
- **Detector / issue:** this is the deliberate **English modernization** lane (`english_modernization` prompt), not a routing accident: #4958 and PR #4959 (merged 2026-09-21) gate it to editions before 1820, the year the reader stops showing the panel (`englishOcrIsReadingView`), after a census found 2,279 English books carrying one and ~1,907 of them hidden. Of the nine books here, the post-1820 ones (Burton, Whinfield, Blavatsky, the Ante-Nicene Fathers) are therefore behind the display gate; Browne 1658, Jonson 1605, Philadelphia 1694 and Taylor 1820 are shown. Related: #3524, #4654, #2761.
- **Fix — a decision for Derek, not a default:** either tighten modernization (keep every note and its attribution, no abridgement, no title changes, spelling only) or replace it with copy-through of the corrected transcription. The by-eye harms above (dropped notes, condensed commentary, "Brake"→"Broke") are the evidence for the choice; a per-page note-count and length check against the OCR would police either option.

### T13 · Apparatus stripped in translation — NEW · #5155
- **Reader sees:** four of seven footnotes gone, the rest condensed into inline notes with the "L." attributions removed; an editor's emendation nullified so the note says nothing; a Greek textual-critical note rendered as meaningless English; note numbers renumbered so the commentary no longer keys to the text; a rubricated book incipit or chapter number lost so the structure is invisible; a marginal siglum moved to line 1.
- **Lane:** translation · on-page.
- **Seen in:** c19 2/6, short 2/6, greek 1/6, rtl 1/6, incun 3/6, music 1/6 — 10 of 78.
- **Example:** https://sourcelibrary.org/book/gulshan-i-raz-the-mystic-rose-garden-whinfield/page/699356a983378b7aed7ce7de p.37 `[tr↔ocr↔image]`.
- **Detector / issue:** #3825 (verbatim original notes) is the prompt-side rule; nothing measures survival of notes.
- **Fix:** footnote and rubric counts on OCR vs translation as a write-time check; apparatus is translated verbatim and numbered as printed.

### T14 · The two panes come from different reads — NEW · #5156
- **Reader sees:** the translation contains a passage the OCR panel lacks (translated from the image, from memory, or from an earlier OCR revision); a legacy raw-engine OCR with no tags beside an LLM translation that silently corrects it; a translation five times the OCR's length.
- **Lane:** translation ↔ OCR provenance · on-page.
- **Seen in:** greek 1/6, short 1/6, illus 1/6, incun 2/6 — 5 of 78.
- **Example:** https://sourcelibrary.org/book/plutarchi-chaeronensis-scripta-moralia-vol-3-didot-greek-dubner p.495 — the Tegyra passage is in the English and on the image, not in the OCR `[tr↔ocr]`, `[tr↔image]`.
- **Detector / issue:** none; `page_revisions` carries the provenance (`data-provenance.md`) but nothing asserts that the served translation was made from the served OCR.
- **Fix:** store the OCR `content_hash` the translation was made from (the Syriac-lane standard, `feedback_provenance_standard_for_every_writer`) and flag pages where it no longer matches.

### T15 · Continuity meta wrong — NEW · #5157
- **Reader sees:** "continues from previous page" at the start of a new section; "after the previous page's Coptic" on a page with no Coptic anywhere; a meta that summarises the facing half of an unsplit spread; the previous page's English repeated inside the meta.
- **Lane:** translation → display · cross-page.
- **Seen in:** cjk 1/6, illus 1/6, c17 1/6, music 3/6, rtl 1/6 — 7 of 78.
- **Example:** https://sourcelibrary.org/book/vat-gr-190-pt-1-euclid/page/6993881574305116d72cef95 `[tr]`.
- **Detector / issue:** none; the `<meta>continues from previous page</meta>` collapse noted in the handoff is the display side of the same tag.
- **Fix:** continuity is a boolean derived from the OCR seam (T6), not free text; drop the sentence.

### T16 · Form imposed or lost — NEW · #5158
- **Reader sees:** manuscript line breaks carried mid-sentence into English prose so it reads as broken verse; verse flattened to prose; running heads as `#` headings and invented "## PAGE 85" headings; prose forced into a two-column table; inline quotations turned into blockquotes; invented italics.
- **Lane:** translation → display · on-page.
- **Seen in:** rtl 1/6, greek 1/6, c19 6/6 (heading promotion), short 1/6, multicol 1/6, music 1/6 — 11 of 78.
- **Example:** https://sourcelibrary.org/book/gulistan-manuscript-1722-or-1723-sa-di/page/69f33c97876dd827cbc5a9c8 `[tr↔image]`.
- **Detector / issue:** none.
- **Fix:** the translation carries the OCR's paragraph structure and nothing else: no headings it did not have, no tables it did not have, no line breaks inside a sentence unless the source is verse.

### Display lane

### D1 · Markup the renderer does not know, or broken — NEW as a class (pieces known) · #5159
- **Reader sees:** raw `<sig>ff 2</sig>`, `<page-num>27</page-num>`, `<column-break/>`, `<language>Latin</language>` mid-text; pseudo-HTML footnote keys `<a>`, `<b>` that collide with real tags; a split or orphan `<insert>`/`<margin>` (`<margin></margin>` + content + `</margin>`); `$\ast$`, `->…<-`, `&amp;`; "[repeated text]" elision markers; invented bold; an `<image-desc>` or "A small decorative initial 'E'…" note in the reading flow. The renderer (`src/lib/validateTranslation.ts` VALID_XML_TAGS, `sanitize-translation-tags.ts`, `NotesRenderer.extractMetadata`) knows the annotation tags and moves `page-num`/`sig`/`meta` to a metadata box; anything else is text.
- **Lane:** display · on-page.
- **Seen in:** every stratum; ≥ 35 pages in the sample carried something on this list. Readers checked the payload, not the screen, except where noted.
- **Example:** https://sourcelibrary.org/book/clavis-ofte-sleutel-boehme/page/69c870956c6f3cc53c85734c p.38 `[tr]`.
- **Detector / issue:** #3825 (closed tag vocabulary), #3811, #2709; `validateTranslation.ts` exists but is not a write gate.
- **Fix:** validate at write time against the closed vocabulary; strip or convert everything else; a renderer test that feeds it every tag in `VALID_XML_TAGS` plus the ten forms above.

### Derived and measurement lane

### E1 · Poisoned derived metadata — KNOWN
- The books in O1 and O2 have summaries, keywords and index entries derived from invented text (the Hebrew recipe book's summary describes "The Unity of the Night"). Not measured here; consequence of every OCR class above. → `derived-metadata-lane.md`.

### E2 · The instruments lie — NEW · #5160
- **What was found:** `ocr_len` = 108 for a page holding 8,100 lines of `|`; `tr_len` = 0 for a page with a translation; `page_type` illustration on a text page; "music", "multicol" and "short" strata that mostly are not; four catalogue records with the wrong format or work. Anyone sampling, gating, or reporting by these fields inherits the error.
- **Fix:** reading length must strip tags and collapse runs (`readingLength()` in `page-integrity.mjs` does; the mirror's field does not); page type from a classifier; format from `<script>` consensus; every count in this doc is by eye for that reason.

---

## Strata × class grid

Presence: number of books (of 6) in which the class was seen on at least one page of the pair. `·` = not seen. Blank strata mean the readers looked and found nothing; they do not mean the class cannot occur there.

| class | dense | multicol | ms | short | illus | music | tables | greek | rtl | cjk | incun | c17 | c19 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| I1 wrong leaf | · | · | · | · | 1 | 1 | · | · | · | · | · | · | · |
| I2 duplicate scan | · | · | · | · | · | · | · | · | · | · | · | 1 | · |
| I3 spread not split | 1 | 2 | · | · | · | · | 1 | 1 | 1 | · | · | 2 | · |
| I4 neighbour strip | · | 2 | · | 2 | 1 | · | · | · | 1 | · | 2 | · | · |
| I5 multi-leaf photo | · | · | 2 | · | · | · | · | · | · | 1 | · | · | · |
| I6 pages reversed | · | 1 | · | · | · | · | · | · | · | · | · | · | · |
| I7 catalogue wrong | · | · | · | · | · | · | · | 2 | · | · | 2 | · | · |
| O1 confabulation | · | 1 | 1 | · | 1 | · | · | 1 | 2 | 1 | · | · | · |
| O2 wrong script | · | · | 1 | · | · | · | · | · | · | · | · | · | · |
| O3 canonical text | · | · | 1 | · | · | · | · | · | 2 | · | 1 | · | · |
| O4 repetition | · | · | 2 | 1 | · | · | 1 | · | 1 | 1 | · | · | · |
| O5 silent omission | 1 | 3 | 1 | 1 | · | · | 1 | 1 | · | 1 | 4 | 2 | · |
| O6 misread → fluent | 4 | 3 | 5 | 2 | 2 | 3 | 3 | 3 | 3 | 5 | 6 | 3 | 1 |
| O7 numerals | 1 | · | 2 | · | · | 1 | · | · | · | 3 | 1 | · | · |
| O8 normalisation | 1 | 1 | 1 | 1 | · | 2 | 3 | · | · | 1 | 2 | · | · |
| O9 convention flip | 3 | · | · | · | · | · | · | · | 1 | · | 2 | 1 | · |
| O10 secondary script | 2 | 1 | · | 1 | 1 | · | 2 | · | · | · | 1 | · | 2 |
| O11 furniture | 3 | · | 2 | 2 | 1 | 4 | 2 | 4 | 3 | 3 | 3 | 3 | 5 |
| O12 marginalia/apparatus | 4 | 1 | 2 | · | · | 1 | 1 | 2 | 1 | 2 | 1 | 3 | 2 |
| O13 later hands | 1 | · | · | · | · | · | 1 | · | · | · | · | 3 | · |
| O14 described not transcribed | · | · | 1 | · | 3 | 3 | · | · | · | · | · | · | 1 |
| O15 reasoning leak | · | · | 1 | 2 | · | 1 | · | 2 | · | · | · | · | · |
| O16 tags wrong | 1 | 5 | 4 | · | 1 | · | · | 6 | 2 | 2 | · | · | 1 |
| O17 tables | · | 1 | · | 1 | 1 | 1 | 2 | · | · | 1 | · | · | 1 |
| T1 truncated | · | 1 | · | · | · | · | · | 2 | · | · | · | · | · |
| T3 hidden in meta | · | · | · | · | · | · | · | · | · | · | 1 | 1 | · |
| T4 block shift | · | · | · | · | · | · | · | · | · | · | · | · | 1 |
| T5 leak / lookahead | 2 | · | · | · | · | 1 | 2 | · | 1 | · | · | 3 | · |
| T6 seam (any defect) | 4 | 2 | 2 | 3 | 1 | 1 | 2 | 1 | 1 | 2 | 4 | 3 | 2 |
| T7 fluent-over-garble | · | · | 3 | 1 | 1 | · | · | 1 | 2 | 1 | 1 | · | · |
| T8 sense inverted | 1 | · | · | 1 | · | 1 | · | · | · | 3 | · | 2 | 3 |
| T9 quiet omission | 1 | · | 1 | 2 | · | · | · | 1 | 2 | · | 1 | · | 1 |
| T10 invented notes | · | · | 3 | 2 | 3 | 4 | 2 | 2 | · | 2 | 4 | 1 | 1 |
| T11 parallel edition | · | · | · | · | · | · | 1 | 2 | 1 | · | · | · | · |
| T12 same-language rewrite | 1 | 1 | · | 1 | 1 | · | · | · | · | · | · | 2 | 3 |
| T13 apparatus stripped | · | · | · | 2 | · | 1 | · | 1 | 1 | · | 3 | · | 2 |
| T14 panes differ | · | · | · | 1 | 1 | · | · | 1 | · | · | 2 | · | · |
| T15 continuity meta | · | · | · | · | 1 | 3 | · | · | 1 | 1 | · | 1 | · |
| T16 form imposed | · | 1 | · | 1 | · | 1 | · | 1 | 1 | · | · | · | 6 |
| D1 markup | 3 | 4 | 5 | 2 | 4 | 4 | 5 | 5 | 5 | 3 | 4 | 2 | 3 |

---

## What this sample could not test

- Staff notation with underlaid text, tablature, lyrics in singing order: 2 of 12 "music" leaves carried notation, none carried lyrics.
- Rashi script, Mikraot Gedolot layouts, printed Arabic and Persian: the RTL draw returned manuscripts and one Syriac edition.
- The Yigdzin lower-leaf first-line drop: both Tibetan pairs failed earlier (nothing transcribed at all, or interiors collapsed), so the positional test was moot.
- RTL line order: on every page whose OCR was really of the page, line order and word order were correct. The RTL-specific fear was not the RTL-specific failure; cursive hands were.
- Vertical right-to-left column order in CJK: correct on every page. Interlinear doses handled well. The damage was single characters (O6).
- 19th-century print OCR was very good (Greek in footnotes, Latin two-column order, most Yoruba diacritics). Nearly all its reader-visible damage was in the translation lane (T12, T13, T16).

## What to do first

Ranked by classes covered per unit of work, all read-only or write-time:

1. **Decide the English modernization lane** (T12, T13 for English books): it is deliberate (#4958, PR #4959, gated to pre-1820 editions). Derek's call between tightening it (every note kept, no abridgement) and copy-through; either way, a note-count and length check against the OCR polices it. Zero model spend for copy-through.
2. **`<vocab>`-vs-body and identical-block checks** (O5, O4): two functions in `page-integrity.mjs`, no model.
3. **`<page-num>` vs printed folio, catchword vs next opening** (I1, I6, O11): the second already exists; run it.
4. **Write-time tag validation** (D1, T3, O15): `validateTranslation.ts` as a gate; a `<meta>` longer than the body is unwrapped.
5. **Declining-to-read floor + translatability gate** (O1, O3, T7): #4195's lacuna marker and a "no translation yet" output that the reader sees as such.
6. **Parallel-edition and page-unit book modes** (T11, I3, I4, I5): detect once per book, route accordingly.
7. **The source-grounded fidelity judge, on-page** (O6, O7, O8, T8, T9, T10): the only instrument that sees family 1. #5104's design, run over the pages `ocr-difficulty-taxonomy.md` flags as unstable first.

## Provenance

- Sample and draw: `scripts/eval/results/page-error-taxonomy-2026-09-25/` (`sample.json`, `sample-strata.mjs`, `findings/*.md`).
- Handoff: `~/sourcelibrary-ops/handoffs/2026-09-25-page-error-taxonomy.md` (private repo).
- Known-class sources: #5055–#5059, #5021, #5026, #5103, #4681/#5085, #3368/#4790/#5095, #4149, #3918, #4523, #4883, #3591, #4195, #3273, #3108, #2393, #2761, #4796, #2454, #2784, #3825, #2709, #3811; `page-integrity.mjs`, `block-drift.mjs`, `translation-page-boundaries.mjs`; `quote-and-snippet-integrity.md`, `paired-artifacts.md`, `derived-metadata-lane.md`, `image-classifiers-and-splits.md`, `ocr-difficulty-taxonomy.md`.
- Issues filed for the new classes: #5131–#5160, listed below.

## Issues filed (2026-09-25, one per new class, label `data-quality`)

- I4 · Neighbour strip in the frame, read as content — #5131
- I5 · Several leaves in one photograph (pecha boards) — #5132
- I7 · Catalogue identity or format wrong — #5133
- O3 · Canonical-text substitution — #5134
- O4 · Block-level repetition — #5135
- O5 · Silent omission inside the page — #5136
- O6 · Meaning-changing misread, carried into a fluent translation — #5137
- O7 · Numerals, dates, doses and units — #5138
- O8 · Silent normalisation toward the expected — #5139
- O9 · Convention flips between adjacent pages — #5140
- O10 · Secondary script on the page dropped or garbled — #5141
- O11 · Page furniture mis-tagged — #5142
- O12 · Marginalia and apparatus dropped, merged, or mis-tagged — #5143
- O13 · Later hands read as text — #5144
- O14 · Non-linear content described, not transcribed — #5145
- O16 · Self-reported tags wrong — #5146
- O17 · Table structure invented or lost — #5147
- T3 · Translation hidden inside a `<meta>` or `<note>` wrapper — #5148
- T7 · Fluent-over-garble: no uncertainty floor — #5149
- T8 · Sense inverted or a qualifier dropped, with correct OCR — #5150
- T9 · Quiet omission below the truncation threshold — #5151
- T10 · Invented scholarship in notes and glosses — #5152
- T11 · Parallel edition mishandled — #5153
- T12 · Same-language source rewritten — #5154
- T13 · Apparatus stripped in translation — #5155
- T14 · The two panes come from different reads — #5156
- T15 · Continuity meta wrong — #5157
- T16 · Form imposed or lost — #5158
- D1 · Markup the renderer does not know, or broken — #5159
- E2 · The instruments lie — #5160
