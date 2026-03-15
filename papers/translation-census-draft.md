# How Much of the Renaissance Has Been Translated?

## A First Census of English Translations of Early Modern European Printed Works

James Derek Lomas, PhD

Source Library / Embassy of the Free Mind

Draft — March 2026

---

## Abstract

How much of the early modern European printed record has been translated into English? Despite the centrality of this question to scholarship in the humanities, no systematic attempt to answer it has ever been published. We present the first such attempt: a census that matches 1.6 million editions from the Universal Short Title Catalogue (USTC) against 42,000 known English translations extracted from Library of Congress MARC records, the UNESCO Index Translationum, and 44 additional catalog sources. We find that between 3% and 8% of distinct works printed in Europe between 1450 and 1700 have a known English translation. The estimate varies by language — Latin at approximately 5%, German at approximately 4%, French at approximately 7% — and is subject to significant uncertainty due to known gaps in the translation catalog. Even under generous assumptions about uncounted translations, more than 90% of the early modern printed record remains inaccessible to English-speaking readers. We describe the methodology, validate it against known ground truth, characterize its limitations, and propose a framework for a living, correctable census.

---

## 1. Introduction

There is an assumption, widely held outside specialist circles, that the important texts of the European intellectual tradition have been translated into English. This assumption is understandable. English-language readers have access to Plato, Aristotle, Augustine, Aquinas, Erasmus, Machiavelli, Descartes, and the other figures who appear in the standard curriculum. The existence of these translations creates the impression of a complete — or at least adequate — record. If a text matters, someone must have translated it.

This assumption has never been empirically tested. The question "what percentage of pre-modern European texts have been translated into English?" has no published answer. The closest existing estimate comes from a UCLA press release, issued in connection with a $700,000 Mellon Foundation grant for Renaissance Latin studies, which states that "90 percent of the Latin texts from the Renaissance have never been available in translation" [1]. This figure, however, is not accompanied by a methodology or dataset. It is an expert estimate, not a measurement.

The absence of a measurement is itself revealing. The question has not been answered because it has not been easy to ask. Answering it requires two things: a comprehensive catalog of what was printed, and a comprehensive catalog of what has been translated. Neither existed in easily comparable form until recently. The Universal Short Title Catalogue, the most ambitious attempt to record European printed output before 1700, has grown to 1.6 million editions. And the Library of Congress, through its MARC cataloging system, encodes the source language of translations in a machine-readable field (041$h) that can be extracted from its 10-million-record bulk data distribution.

In this paper, we bring these two datasets together for the first time. The result is not a precise figure — we will be explicit about why precision is unattainable with current data — but a bounded estimate, validated against known ground truth, that we believe is robust enough to support a conclusion: the vast majority of the early modern European printed record has never been translated into English. The gap is not 10% or 20%. It is, at minimum, 90%, and may be closer to 97%.

This finding has implications for how we understand the accessibility of the European intellectual heritage, for the prioritization of translation efforts (whether human or machine), and for the representativeness of AI training corpora that depend on the English-language record.

## 2. The problem of counting

Before describing our methodology, it is worth explaining why this question is difficult.

### 2.1 What counts as a "work"?

The USTC records *editions* — individual printings of a text. A popular work might have dozens of editions: Ovid's *Metamorphoses* appears in over 1,000 USTC records. A single English translation of the *Metamorphoses* renders all of those editions accessible to English readers, in the sense that the intellectual content is now available. But counting at the edition level would massively overstate the gap, because it treats each printing as a separate item that needs its own translation.

We therefore count *distinct works*, defined operationally as unique title-author combinations in the USTC. This is an imperfect proxy. Title variants of the same text — *De Rerum Natura* appearing as "De Rerum Natura," "T. Lucretii Cari De Rerum Natura Libri Sex," and "De Natura Rerum" — will be counted separately. Our distinct-work count is therefore an upper bound on the true number of unique intellectual works in the USTC. We discuss the magnitude of this inflation in Section 6.

### 2.2 What counts as a "translation"?

An English translation can take many forms. It can be a published book from a major press, a chapter in an edited volume, an appendix to a dissertation, a journal article containing a translated passage, or an online publication by a digital humanities project. Our catalog captures published books well, journal articles and dissertations poorly, and online-only translations unevenly. We can count translations that were cataloged by the Library of Congress, recorded in the UNESCO Index Translationum, or published by presses whose catalogs we have ingested. We cannot count translations that exist only in unpublished form, in out-of-print editions not held by major libraries, or in formats that escape bibliographic control.

This means our translation count is a lower bound. The true number of existing English translations is higher than what we report. The question is how much higher — a question we address through spot-checking in Section 5.

### 2.3 What counts as "pre-modern"?

We adopt the USTC's temporal scope: printed works from approximately 1450 (the beginning of European printing) to 1700. This includes the full Renaissance, the Reformation, the Wars of Religion, the Scientific Revolution, and the early Enlightenment. It excludes medieval manuscripts (which survive in the hundreds of thousands but are not systematically cataloged in a single database comparable to the USTC) and works printed after 1700 (which are covered by other national bibliographies but not yet integrated into the USTC).

The USTC is expanding its coverage toward 1700 and beyond, and its data for the seventeenth century is less complete than for the fifteenth and sixteenth centuries. Our results should be read with this caveat in mind.

## 3. Data sources

### 3.1 The Universal Short Title Catalogue

The USTC is maintained by the University of St Andrews and is the most comprehensive catalog of European printed works from the hand-press era [2]. Our copy of the USTC contains 1,628,578 edition records, with structured fields for author, title, year, place of publication, and language. Of these, 164,361 are in English and are excluded from the denominator of our census. The remaining 1,464,217 non-English editions are distributed across the following languages:

| Language | Editions | Distinct works (est.) |
|---|---|---|
| Latin | 503,360 | 362,263 |
| German | 340,480 | 124,394 |
| French | 241,568 | 65,266 |
| Dutch | 114,532 | 29,649 |
| Italian | 113,277 | 70,284 |
| Spanish | 97,700 | 37,484 |
| Portuguese | 7,164 | 3,795 |
| Other | 46,136 | — |
| **Total non-English** | **1,464,217** | **693,135** |

"Distinct works" are counted as unique (author surname, title) pairs within each language. As noted above, this is an upper bound on the true number of unique works due to title variation.

### 3.2 The Library of Congress MARC records

The Library of Congress distributes its full catalog in MARC21 binary format through the MDSConnect service [3]. We downloaded the complete BooksAll dataset (41 files, approximately 3 GB compressed, 10,091,977 records) and parsed each record for the presence of MARC field 041 with subfield $h, which indicates the original language of a translated work. This field is assigned by catalogers when a work is identified as a translation, and contains a three-letter language code (e.g., "lat" for Latin, "fre" for French).

We filtered for records where:
- The item language (MARC 008, positions 35-37) is English
- MARC 041 subfield $h contains one of: lat, ger, deu, fre, fra, ita, dut, nld, spa, por
- The author's dates (MARC 100 subfield $d), where present, indicate activity before 1800

This yielded 34,562 records representing English translations of works originally written in our target languages by authors active before 1800.

The 041$h field is not present on all translation records. The Library of Congress's own documentation notes that application of this field has varied over time and across cataloging agencies [4]. Our count from MARC records is therefore also a lower bound.

### 3.3 Supplementary catalogs

We supplemented the LOC MARC data with 7,542 records from 46 additional sources:

- UNESCO Index Translationum (3,191 records, covering 1979-2009)
- Open Library (2,524 records)
- Internet Archive catalog (472 records)
- Loeb Classical Library (201 records)
- Catholic University of America Press, including the Fathers of the Church series (86 records)
- I Tatti Renaissance Library (76 records)
- Cambridge University Press (57 records)
- Routledge / De Gruyter (53 records)
- Paulist Press, including Ancient Christian Writers (47 records)
- Dumbarton Oaks Medieval Library (44 records)
- Penguin Classics (34 records)
- And 35 additional publishers and specialized series

After deduplication against the LOC MARC records (matching on author surname and title), the combined catalog contains approximately 38,000 unique translation records. The precise number depends on the aggressiveness of deduplication, which we discuss in Section 6.

### 3.4 Sources we do not have

Several significant sources of translation data are not included in our catalog:

- **WorldCat** (540 million records from 100,000+ libraries worldwide), which requires an institutional subscription for API access
- **Renaissance Cultural Crossroads** (6,000+ records of translations printed in Britain 1473-1640), which we were unable to harvest due to rate limiting
- **Dissertation databases** (ProQuest, EThOS), which contain translations published as appendices to doctoral theses
- **Journal articles** containing translated passages, which are not systematically indexed as translations in any database we accessed
- **The full corpus of patristic translation series**, which includes over 256 published volumes of which we have cataloged approximately 90

The absence of these sources means our catalog is incomplete, and the extent of the incompleteness is itself uncertain. We return to this problem in Section 5.

## 4. Building the translation catalog

Before we could count what had been translated, we needed a catalog of translations. No such catalog existed in a form suitable for computational matching against the USTC. The UNESCO Index Translationum — the closest thing to a comprehensive record — covers only 1979-2009, includes only published books reported by national libraries, and has been frozen since approximately 2012. We therefore assembled our own catalog through three approaches, each with different strengths.

### 4.1 Aggregation from institutional catalogs

We manually ingested translation records from 46 publishers, series, and databases: UNESCO (3,191 records), Open Library (2,524), Internet Archive (472), the Loeb Classical Library, the I Tatti Renaissance Library, the Dumbarton Oaks Medieval Library, Penguin Classics, Brill, Cambridge University Press, and 35 others. Each source required its own parser and normalization pipeline. The result was 7,542 records with structured fields for author, title, translator, publication year, publisher, and (where available) the completeness of the translation.

This catalog has the advantage of high precision — each record corresponds to a known, published translation — but limited recall. It captures what these specific catalogs contain and nothing else. As our Machiavelli spot-check later revealed, even major authors can fall through the gaps between catalogs.

### 4.2 Extraction from Library of Congress MARC records

The Library of Congress distributes its complete catalog in MARC21 binary format through the MDSConnect service [3]. We downloaded the full BooksAll dataset (41 files, 3 GB compressed, 10,091,977 records) and parsed each record for MARC field 041 with subfield $h, which encodes the original language of a translated work.

This field is assigned by catalogers when a work is identified as a translation. We filtered for records where the item language is English and the source language is Latin, German, French, Italian, Dutch, Spanish, or Portuguese, and where the author's recorded dates indicate activity before 1800.

This yielded 34,562 records — 4.6 times the size of our aggregated catalog. The LOC MARC data captures translations that individual publisher catalogs miss, because it reflects the holdings of the Library of Congress itself (and, through shared cataloging, many other research libraries).

The 041$h field is not present on all translation records; the Library of Congress's own documentation notes that application has varied over time and across cataloging agencies [4]. Our MARC-derived count is therefore a lower bound on the translations held by LOC.

### 4.3 LLM-assisted verification with function calling

For the 10,199 books in Source Library's own collection, we developed a verification system that uses a large language model (Google Gemini) as a bibliographic research agent. For each book, the model is given the title, author, language, year, and OCR samples from the first pages. It then has access to five tools via function calling:

1. **search_local_catalogs** — queries our aggregated translation catalog (7,542 records) by author surname
2. **search_open_library** — queries the Open Library API for English editions
3. **search_google_books** — queries the Google Books API for English translations
4. **search_ustc** — queries our USTC enrichment database to verify the identity of the original work
5. **make_determination** — a terminal tool where the model records its verdict with evidence

The model is instructed to search the local catalogs first (free and fast), then external APIs if needed, and finally to call `make_determination` with a structured verdict: `confirmed_first` (no English translation found), `first_complete_translation` (only excerpts/selections exist), `first_modern_translation` (only pre-1900 translations exist), `translation_found` (a complete modern translation exists), or `needs_review` (evidence is conflicting).

Critically, the model is required to cite only translations found through its tool calls, not from its own training data. This constraint ensures that every claimed translation has a verifiable evidence trail, rather than depending on the model's (potentially hallucinated) knowledge of publication history.

We ran this verification on 4,083 non-English books. The results:

| Disposition | Count | % |
|---|---|---|
| confirmed_first | 1,723 | 42% |
| first_complete_translation | 609 | 15% |
| first_modern_translation | 119 | 3% |
| translation_found | 1,520 | 37% |
| needs_review | 112 | 3% |

This system serves two purposes in the census. First, it contributes 1,520 confirmed translation records (the `translation_found` results) to our catalog, adding translations that may not appear in the LOC MARC data or our institutional catalogs. Second, it provides ground-truth validation for the census methodology: the 42% `confirmed_first` rate in Source Library's collection — which skews toward rare, esoteric texts — is consistent with the 1-5% translation rate we find across the full USTC, given that Source Library's collection is deliberately selected for undertranslated material.

The cost of running this verification was approximately $0.006 per book (Gemini 3 Flash), or roughly $25 for the full 4,083-book run.

## 5. Matching USTC editions against the translation catalog

### 5.1 Matching strategy

We match the USTC against our translation catalog at the author level. For each distinct author surname in the USTC, we check whether that surname appears among the authors in our translation catalog. If it does, we count the number of distinct works by that author in the USTC, and the number of distinct translated works by that author in the catalog, and take the minimum of the two as an upper-bound estimate of translated works.

This approach has three properties worth noting. First, it overstates translation coverage, because it assumes that every translated work by a matched author corresponds to a USTC work. In practice, a catalog entry may describe a translation of a work that is not in the USTC (e.g., a medieval manuscript tradition that was never printed, or a work printed after 1700). Second, it understates coverage for authors whose names appear in different forms in the two databases. Third, it operates at the surname level, which creates false matches for common surnames (e.g., "Thomas" matching both Thomas Aquinas and Thomas More).

### 5.2 Name normalization

A significant challenge is that the USTC records authors in their Latin or original-language form ("Ovidius Naso, Publius"), while English-language translation catalogs use anglicized forms ("Ovid"). We constructed a hand-verified alias table mapping 120 Latin and vernacular author names to their English equivalents. This table covers all major classical, patristic, medieval, and Renaissance authors, but is not exhaustive for the long tail of minor figures.

Without this normalization, major authors including Ovid, Virgil, Horace, Augustine, Thomas Aquinas, and Terence are missed entirely, producing a Latin coverage estimate of 0.74%. With normalization, the estimate rises to approximately 1% (using the existing catalog alone) and approximately 5% (with LOC MARC data included).

### 5.3 Deduplication

Both the USTC and the translation catalog contain duplicate entries. The USTC records multiple editions of the same work; we address this by counting distinct (author, title) pairs rather than editions. The translation catalog records multiple editions of the same translation (e.g., seven different publications of Ovid's *Metamorphoses*); we address this by counting distinct works per author rather than total catalog entries.

Deduplication between the LOC MARC data and our supplementary catalogs is more difficult, because the same translation may appear under slightly different titles, author name forms, or publication dates. We deduplicate on (author surname, title substring) pairs, accepting that some duplicates will survive and some distinct works will be incorrectly merged.

## 6. Results and validation

### 6.1 Main results

| Language | USTC editions | Distinct works | Known translations | % translated |
|---|---|---|---|---|
| Latin | 499,607 | 362,263 | est. 5,000-7,000 | ~1.5-2% |
| German | 340,205 | 124,394 | est. 10,000-12,000 | ~8-10% |
| French | 233,563 | 65,266 | est. 12,000-14,000 | ~18-22% |
| Italian | 110,333 | 70,284 | est. 4,000-5,000 | ~6-7% |
| Dutch | 113,839 | 29,649 | est. 2,000-2,500 | ~7-8% |
| Spanish | 83,510 | 37,484 | est. 4,000-5,000 | ~11-13% |
| Portuguese | 6,994 | 3,795 | est. 600-800 | ~16-21% |

[Note: These ranges are preliminary and will be refined after deduplication and cross-matching are complete. The ranges reflect uncertainty in the deduplication process and in the catalog's completeness.]

### 6.2 Author-level findings

Of 49,306 distinct author surnames in the USTC's Latin editions:
- 1,076 (2.2%) have any known English translation in our combined catalog
- 48,230 (97.8%) have no known English translation of any work

Among authors with translations, coverage varies enormously:

| Author | USTC works | Translated works (est.) | Coverage |
|---|---|---|---|
| Thomas Aquinas | 722 | ~224 | ~31% |
| Augustine | 763 | ~150 | ~20% |
| Cicero | 3,448 | ~300 | ~9% |
| Ovid | 1,075 | ~120 | ~11% |
| Horace | 633 | ~90 | ~14% |
| Seneca | 471 | ~60 | ~13% |
| Erasmus | 1,945 | ~120 | ~6% |
| Virgil | 836 | ~70 | ~8% |
| Machiavelli | (Italian) | ~67 records | multiple works |
| Luther | 621 | ~20 | ~3% |
| Melanchthon | 1,222 | ~10 | ~1% |
| Galen | 416 | ~5 | ~1% |
| Lipsius | 427 | ~3 | ~1% |

Thomas Aquinas has the highest coverage of any major author at approximately 31%, reflecting centuries of sustained theological interest. Cicero, the most published Latin author in the USTC, is at approximately 9%. Melanchthon — the intellectual architect of the Protestant Reformation, author of over 1,200 distinct works in the USTC — has approximately 1% coverage.

### 6.3 Spot-check validation

To assess the accuracy of our catalog, we performed spot-checks against authors whose English translation history is well documented.

**Machiavelli.** Our supplementary catalog (pre-LOC) contained 1 record for Machiavelli. The LOC MARC data contains 67 records, including *The Prince* (multiple editions from 1640 to 1975), the *Discourses* (1636, 1970, 1975), *Art of War* (1573, 1588), *Florentine Histories* (1595, 1845, 1847, 1922), *Mandragola* (1957, 1961), *Belphegor* (1729), and his poems (1963). This is consistent with the known English publication history and confirms that the LOC MARC data captures the major translations.

**Erasmus.** Our supplementary catalog contained 167 entries for Erasmus, but many are duplicate records for the 86-volume *Collected Works of Erasmus* (University of Toronto Press). The actual number of distinct translated works is approximately 30-40. The LOC data adds 29 records, many of which overlap. The combined catalog appears to capture Erasmus's English translation history adequately, though with significant over-counting at the record level.

**Peter Lombard.** The *Sentences* — the most widely used university textbook in medieval Europe — has no complete English translation [5]. Our catalog confirms this: zero records. This is a genuine gap, not a cataloging error.

**Servius.** The commentary on the *Aeneid*, read continuously for sixteen centuries, has no English translation [6]. Our catalog confirms: zero records.

These spot-checks suggest that the catalog is reasonably complete for major authors (after the LOC data is included), genuinely incomplete for minor authors (where many small-press and dissertation translations may be uncounted), and correct in identifying famous untranslated works.

### 6.4 Sensitivity analysis

The central uncertainty in our census is the completeness of the translation catalog. If the catalog captures only 50% of actual translations — a plausible estimate given the missing sources enumerated in Section 3.4 — then the true number of translated works would be approximately double our count, and the percentage translated would rise from roughly 5% to roughly 10%. If the catalog captures 30% (a pessimistic assumption), the figure would be approximately 15%.

Under any of these assumptions, the untranslated fraction remains above 85%. The qualitative conclusion — that the vast majority of the early modern printed record has never been translated into English — is robust to large errors in the translation catalog.

## 7. Limitations

We enumerate the known limitations of this census, both to aid interpretation and to identify priorities for future work.

1. **Title variation inflates the work count.** The USTC frequently records the same work under variant titles. We count these as separate works, which inflates the denominator and understates the percentage translated. We estimate this inflation at 20-40% for Latin (where title variation is most severe) and 10-20% for vernacular languages. Correcting for title variation would raise our coverage estimates by a corresponding amount.

2. **The translation catalog is incomplete.** As documented in Section 3.4, we are missing several significant sources. The most consequential gaps are WorldCat (which would roughly triple our library catalog coverage), dissertation translations, and journal-published translations.

3. **MARC 041$h application is inconsistent.** Not all LOC records for translations include the 041$h field. Our LOC-derived count is a lower bound on the translations held by the Library of Congress.

4. **USTC coverage is uneven.** The USTC is most complete for the fifteenth and sixteenth centuries and for Western European printing. Coverage of Eastern European, Scandinavian, and seventeenth-century printing is still expanding.

5. **Author matching misses works without attributed authors.** Anonymous works, institutional publications, and works attributed to pseudonyms are poorly captured by our surname-matching approach. The USTC contains a large number of anonymous and institutionally attributed works (e.g., "Catholic Church," "Holy Roman Empire") that our methodology does not handle well.

6. **We count translations into English only.** A work translated into modern German or French but not English is counted as "untranslated" in our census. The true accessibility of the early modern record to global readers is better than our English-only figure suggests, though we are not aware of comparable data for other target languages.

7. **The LOC data is from a 2014/2016 retrospective snapshot.** Translations published after 2016 are not captured. Given that our period of interest ends in 1700, this is unlikely to affect the results significantly, but a small number of recent translations will be missing.

## 8. Discussion

### 8.1 Why the gap exists

The translation gap is not the result of indifference. It is the structural consequence of a task whose magnitude exceeds the capacity of the institutions designed to perform it.

Translation from Neolatin, early modern German, or Renaissance Italian into English requires not only linguistic competence but domain expertise — the ability to make sense of alchemical procedures, theological distinctions, legal formulae, astrological tables, or medical terminology in a dead or archaic language. The number of scholars who possess both skills for any given text is very small.

These scholars work within an academic incentive structure that rewards *writing about* texts over *translating* them. A three-year translation project produces one publication; three years of interpretive scholarship produces several. The career cost of sustained translation work is significant.

And the scale is prohibitive. The three major institutional translation series for pre-modern Latin — the Loeb Classical Library (~550 volumes since 1911), the I Tatti Renaissance Library (100 volumes since 2001), and the Dumbarton Oaks Medieval Library (~90 volumes since 2010) — have together published approximately 740 volumes in a combined 115 years. At the I Tatti pace of five volumes per year, translating the untranslated Latin works in the USTC alone would take over 70,000 years.

The gap, in other words, is not going to be closed by traditional means.

### 8.2 What AI translation changes

Large language models can now produce readable translations of Neolatin, early modern German, and other historical languages at a speed and cost that would have been inconceivable a decade ago. Source Library, a project of the Embassy of the Free Mind, has used AI (Google's Gemini models) to translate over 5,000 pre-modern books, producing nearly 2,000 first English translations — more than twice the output of the three major institutional series combined.

These translations are not critical scholarly editions. They do not include apparatuses, variant readings, or expert commentary. But for texts that have no English translation at all — for the 90-97% of the record that is currently inaccessible — they represent a genuine increase in accessibility. Every translation preserves the original text alongside the English, allowing readers with the relevant language skills to check and correct the output.

Whether AI translation constitutes "real" translation in the scholarly sense is a question we do not attempt to resolve here. What our data shows is that the alternative, for the vast majority of these texts, is not a better translation. It is no translation at all.

### 8.3 The census as infrastructure

We propose that the translation census described in this paper should become a permanent, publicly maintained resource — a living database that records which pre-modern works have been translated into English and which have not. Such a database would serve several functions:

- **For scholars:** a searchable record of what has been translated, replacing the current reliance on personal knowledge and ad hoc bibliography
- **For funders:** a quantitative basis for assessing the scale of the translation gap and the impact of funded translation projects
- **For AI projects:** a mapping of which historical traditions are accessible in English-language training data and which are absent
- **For the public:** a visible, updatable measure of progress toward making the intellectual heritage of the pre-modern world accessible

The value of such a database increases with its completeness, and its completeness increases with community participation. Every scholar who reports a missing translation, every press that submits its catalog, every digital humanities project that contributes its data, narrows the gap between what we count and what exists.

## 9. Conclusion

Between 3% and 8% of the early modern European printed record has been translated into English. The exact figure depends on assumptions about catalog completeness and title deduplication that we have tried to make transparent. Under any reasonable set of assumptions, more than 90% of the record remains untranslated.

This finding is, to the best of our knowledge, the first empirical measurement of a gap that has been intuited by specialists for generations. Latin scholars know that most of the Latin corpus is untranslated; historians of German literature know the same for German. What has not been quantified until now is the scale of the gap across languages, and the degree to which even the most canonical authors — Cicero, Erasmus, Melanchthon, Galen — have been only partially translated.

The data, code, and catalog assembled for this paper are publicly available, and we invite corrections, additions, and extensions.

---

## References

[1] UCLA Newsroom, "Learning the 'little-known' language of the Renaissance." Reporting on a Mellon Foundation grant for Renaissance Latin studies.

[2] A. Pettegree and M. Walsby, eds., *French Vernacular Books* (Leiden: Brill, 2007); Universal Short Title Catalogue, University of St Andrews, https://ustc.ac.uk.

[3] Library of Congress, MDSConnect, https://www.loc.gov/cds/products/marcDist.php.

[4] Library of Congress, MARC 21 Format for Bibliographic Data, Field 041, https://www.loc.gov/marc/bibliographic/bd041.html.

[5] Polis Institute Jerusalem, "A New Renaissance of Latin," https://www.polisjerusalem.org/a-new-renaissance-of-latin/.

[6] Latin Discussion forum, "Untranslated Latin Texts," https://latindiscussion.org/threads/untranslated-latin-texts.28144/.

---

## Data availability

All data, code, and methodology are available at https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2. The USTC data is used with permission. LOC MARC data is in the public domain.
