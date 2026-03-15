# When Is a Book the Same Book? Deduplicating 828,000 Digitized Pre-Modern Texts Across European Libraries

**Authors:** Derek Lomas, [collaborators TBD]
**Affiliation:** Source Library / Embassy of the Free Mind
**Status:** Draft — experiments in progress

---

## Abstract

European research libraries have spent two decades digitizing their collections — photographing millions of pages from manuscripts, incunabula, and early printed books, and publishing them online through a shared standard called IIIF. But no one has assembled a complete list of what's been digitized. Each library has its own catalog. When you search across them, you find the same book listed multiple times: different libraries scanned their own copy, or the same library listed the same book under multiple catalog entries.

We collected 827,928 records from four major European digital library systems and asked a simple question: how many of these are actually unique books? The answer turns out to be surprisingly hard, because "the same book" can mean different things. Is a 1556 printing of Agricola's *De Re Metallica* held in Munich the "same book" as a 1556 printing held in Zurich? What about a 1561 reprint? What about the German translation, *Vom Bergkwerck*?

We tested five different methods for detecting duplicates — from simple string matching to probabilistic models to AI-powered semantic comparison — and evaluated them against a human-labeled set of 752 book pairs. We report which methods work, which fail, and why pre-modern books are harder to deduplicate than modern ones. We also release the unified catalog itself as an open resource: the first comprehensive, queryable database of digitized pre-modern texts across European IIIF repositories.

---

## 1. Introduction

### 1.1 The Problem

Over the past twenty years, research libraries across Europe have digitized vast quantities of their pre-modern holdings — books printed before 1800, medieval manuscripts, Renaissance scientific treatises, Reformation theological tracts. These digital images are published online through IIIF (International Image Interoperability Framework), an open standard that lets any software display page images from any participating library.

The scale is remarkable. The Bavarian State Library alone has digitized over 3 million items. The Bibliothèque nationale de France offers 10 million documents through Gallica. Swiss libraries collectively provide 160,000 titles through e-rara. The Biblissima portal aggregates over 100,000 manuscript descriptions from dozens of institutions.

But there is no master list. No one can answer the question: *how many unique pre-modern books have been digitized and are freely available online?* Each library maintains its own catalog in its own format, with its own conventions for recording titles, authors, and dates. Aggregators like Biblissima and Europeana provide partial coverage. Bibliographic databases like the Universal Short Title Catalogue (USTC) track what was *printed* in the early modern period, but not what has been *digitized*.

Source Library (sourcelibrary.org) set out to build this missing catalog. We wrote software to harvest book records from major European IIIF repositories, collecting 827,928 records from four sources. But harvesting is only the first step. The harder problem is figuring out which of those 828,000 records refer to the same book.

### 1.2 Why "Same Book" Is Complicated

Consider Georg Agricola's *De Re Metallica*, one of the most important books on mining and metallurgy ever written, first published in 1556 in Basel. In our dataset, it appears:

- **7 times in e-rara** (Swiss libraries) — the 1556 first edition, a 1561 reprint, a 1621 edition, a 1657 edition, and the 1557 German translation *Vom Bergkwerck*, each scanned from a different Swiss library's copy
- **5 times in BSB** (Bavarian State Library) — including two copies of the same 1546 edition (different physical books on different shelves, both digitized) plus later editions
- **4 times in Gallica** (French national library) — French-language cataloging: "Georgii Agricolae... Bermannus, sive de re metallica"
- **At least once in Biblissima** — pointing to yet another library's copy

That's 16+ records for what a reader would consider "the same book." But are they the same? A library scientist would say no — some are different *editions* (1556 vs 1561), some are different *copies* of the same edition (two BSB copies of the 1546 printing), and some are different *works* entirely (the Latin original vs the German translation). Each distinction matters for different purposes:

- A reader looking for Agricola's ideas only needs one copy. The duplicates are noise.
- A scholar studying the printing history needs every edition. The 1556 and 1561 are distinct.
- A conservator comparing physical copies needs every digitized item. Even two scans of the "same" edition may show different marginalia, binding damage, or hand-coloring.

Library science has a formal model for these distinctions, called FRBR (Functional Requirements for Bibliographic Records). It defines four levels of identity:

| Level | FRBR term | Example | What makes it distinct |
|-------|-----------|---------|----------------------|
| The idea | **Work** | *De Re Metallica* by Agricola | The intellectual content |
| A realization | **Expression** | The Latin text; the German translation | Language, revision |
| A publication | **Manifestation** | The 1556 Basel edition | Publisher, date, format |
| A physical object | **Item** | BSB's copy, shelf mark Res/4 Oec. 8 | Specific physical book |

Our deduplication problem is: given 828,000 catalog records, can we automatically determine which ones refer to the same Work, the same Manifestation, or the same Item?

### 1.3 Why This Is Hard for Old Books

Deduplication of modern books is largely a solved problem. Every book published since 1970 has an ISBN. Library catalogs use standardized formats (MARC records). Author names are controlled by international authority files. OCLC's WorldCat has been merging records from thousands of libraries for decades.

Pre-modern books have none of these advantages:

**1. No standard identifiers.** A 1556 Basel printing has no ISBN. Some are tracked in bibliographic databases (VD16 for 16th-century German prints, ESTC for early English books, USTC for European prints before 1601), but coverage is incomplete, and these identifiers aren't always recorded in the IIIF metadata we harvest.

**2. Titles are transcribed, not standardized.** The full title of Agricola's book, as printed on its title page, runs to several sentences in Latin. Each library transcribes it slightly differently: one writes "De Re Metallica Libri XII," another writes "De re metallica libri XII" (different capitalization), another includes the full subtitle, another abbreviates. String matching on these titles requires tolerance for variation.

**3. The same book has different titles in different languages.** BSB catalogs in German, Gallica in French, e-rara uses the language of the original text. The same work might be listed as "De Re Metallica" (Latin), "Vom Bergkwerck" (German), or "Douze livres de métallique" (French). No string-matching algorithm can detect that these are the same book — the words share zero characters.

**4. Authors have multiple names.** The author of *De Re Metallica* was born Georg Pawer (or Bauer) in Saxony, Latinized his name to Georgius Agricola, and appears in various catalogs as "Agricola, Georg," "Agricola, Georgius," "Agricola, George," or occasionally "Bauer, Georg." Some catalogs attribute the German translation to a different person entirely (the translator, Philipp Bechius).

**5. Many books have the same title.** Our dataset contains 76 books titled simply "Gedichte" (Poems), 42 titled "Opera" (Works), 30 titled "Epistolae" (Letters), and 20 titled "Catechismus." Each is by a different author — Virgil's *Opera* is not Horace's *Opera* — but if the author field is missing or misspelled, they look identical.

**6. Libraries digitize multiple copies of the same edition.** BSB's VD16 bibliography lists every surviving copy of every 16th-century German-language publication. If BSB holds three copies of a 1556 book, all three are digitized and appear as separate catalog records with identical titles but different shelf marks. Our dataset contains approximately 133,000 such internal duplicates from BSB alone.

### 1.4 What We Did

We built crawlers to harvest IIIF metadata from four major sources, normalized the records into a common format, and then tested five methods for detecting duplicates:

1. **Exact match** — do the titles and authors match character-for-character after normalization?
2. **Fuzzy string matching** — how similar are the titles, measured by Jaro-Winkler distance?
3. **Probabilistic linkage** — what is the statistical likelihood that two records refer to the same book, given the observed patterns of agreement and disagreement across fields?
4. **Token-based matching** — do the titles contain the same words, regardless of order?
5. **Semantic matching** — do the titles mean the same thing, even in different languages?

We evaluated each method against a set of 752 record pairs that were labeled by humans as "same book" or "different book" at each FRBR level. We report precision (how often a detected duplicate is a real duplicate), recall (how many real duplicates are detected), and the tradeoffs between them.

### 1.5 Contributions

- **A unified catalog** of 827,928 digitized pre-modern books across four major European IIIF sources — the first of its kind
- **A human-labeled evaluation set** of 752 record pairs annotated at three FRBR levels
- **A comparative evaluation** of five deduplication methods, with precision/recall analysis and failure-mode categorization
- **Open-source harvesting and deduplication tools** released for the digital humanities community
- **A corrected estimate** of the number of unique digitized pre-modern books available through these sources: approximately 665,000 (down from the naive count of 828,000)

---

## 2. Related Work

### 2.1 How Libraries Think About Book Identity

The question "is this the same book?" has been debated by librarians for over a century. The most influential modern framework is FRBR — Functional Requirements for Bibliographic Records — published by IFLA in 1998. FRBR introduces the four-level hierarchy described above (Work, Expression, Manifestation, Item) and has shaped how library systems organize and display records.

For modern books, FRBR is relatively straightforward: *Harry Potter and the Philosopher's Stone* is a Work; the UK English edition is one Expression, the US English edition (*Sorcerer's Stone*) is another; the 1997 Bloomsbury hardcover is a Manifestation; your personal copy is an Item.

For pre-modern books, the model is both essential and strained. Stein et al. (2006) observe that individual copies of early printed books retain "striking uniqueness" — hand-colored illustrations, manuscript annotations, variant bindings, even different type settings within the same print run. The Item level matters more than for modern publications. Meanwhile, the Work level is harder to define: texts circulated in multiple versions, abridgements, translations, and commentaries without a stable "canonical" form. A 1556 *De Re Metallica* with extensive commentary is arguably a different Work from a 1530 *Bermannus* that covers similar material in dialogue form, yet both are "by Agricola" and "about metallurgy."

FRBR was refined into IFLA-LRM (Library Reference Model, 2017) and operationalized as BIBFRAME by the Library of Congress, but the conceptual challenge remains the same.

### 2.2 Algorithms for Matching Library Records

The most widely deployed approach to bibliographic matching is the **OCLC Work-Set Algorithm**, developed by Thomas Hickey, Edward O'Neill, and Jenny Toves at OCLC Research (2002, refined 2009). The algorithm works in three steps:

1. Extract the author's surname and the "uniform title" (a standardized form of the title) from each catalog record
2. Normalize both strings: lowercase, strip diacritics, remove articles and punctuation
3. Concatenate them into a "work key" — records with the same work key are grouped as the same Work

This approach is simple and fast. Applied to WorldCat's 48 million records, it successfully clustered most modern publications. But it has known weaknesses: it fails when author names vary (Agricola vs Bauer), when uniform titles aren't recorded (many catalog records only have the transcribed title, not a standardized form), and when works are anonymous.

The algorithm was extended by GLIMIR (O'Neill et al., 2012), which adds publisher, date, and physical description fields to distinguish Manifestations within a Work cluster. More recently, OCLC deployed a machine learning model in 2025, trained with input from 300 cataloging professionals, that removed 5.4 million duplicate records from WorldCat. OCLC describes this as a "hybrid approach" — the AI proposes merges, human experts review them.

A comprehensive survey of all FRBRization techniques (Riva & Žumer, 2015) concludes that "no single approach works well across all record types and languages."

### 2.3 The Mathematics of Record Matching

The formal theory behind probabilistic record matching was established by Ivan Fellegi and Alan Sunter in 1969. Their insight: instead of asking "do these records match?" as a yes/no question, ask "how likely is it that these records refer to the same entity, given what we observe about their fields?"

The model works by comparing records field by field. For each field comparison (title, author, date), two probabilities are estimated:
- **m**: the probability that the field values agree, given that the records truly are a match
- **u**: the probability that the field values agree by coincidence, given that the records are NOT a match

The ratio m/u gives the "weight of evidence" for each field agreement. These weights are combined across fields to produce a composite score. A pair with a high composite score is likely a true match; a pair with a low score is likely a non-match; pairs in between are uncertain.

This framework remains the foundation of modern record linkage. Implementations include the Python Record Linkage Toolkit (de Bruin, 2019), Splink (Linacre, 2022), and dedupe (Gregg & Eder, 2015). Splink in particular has been applied to datasets of hundreds of millions of records and uses expectation-maximization to estimate the m and u probabilities automatically from the data, without requiring pre-labeled training pairs.

### 2.4 Digital Library Deduplication at Scale

The HathiTrust Digital Library, which holds 17 million digitized volumes from over 100 contributing libraries, relies primarily on shared identifiers (OCLC numbers) for deduplication. When two libraries contribute the same book, their catalog records typically share the same OCLC number, and HathiTrust links them. For records without shared identifiers, HathiTrust falls back to title/author matching. A 2012 report found approximately 75,000 titles with three or more duplicate scans.

The SaDDL project (Similarities and Duplicates in Digital Libraries) took a different approach: instead of comparing metadata, it compared the actual text content of HathiTrust's volumes using machine learning. This can detect duplicates even when the metadata is completely different — but requires the books to be OCR'd first.

Early English Books Online (EEBO) and its successor the Text Creation Partnership (TCP) use curated bibliographic identifiers — STC numbers for pre-1641 books, Wing numbers for 1641–1700 — as primary dedup keys. These identifiers are assigned by human editors, not algorithms.

### 2.5 The Gap This Paper Addresses

No published work addresses deduplication specifically across heterogeneous IIIF digital library catalogs for pre-modern materials. Existing approaches either assume standardized MARC records with shared identifiers (OCLC, HathiTrust), focus on modern publications with ISBNs, or rely on curated bibliographic databases that don't cover all digitized materials.

Our situation is different in several ways:
- Our metadata comes from OAI-PMH, SRU, and Wikibase APIs — sparser and less standardized than MARC
- Our records span four countries and at least six cataloging languages
- We have no shared identifiers across most of our sources
- Our materials are pre-modern, with all the title/author instability that entails
- We need to work at the scale of 828,000 records without manual review of each pair

---

## 3. Dataset

### 3.1 How We Collected the Data

We wrote four source-specific crawlers to harvest IIIF metadata from major European digital library systems, using each system's standard discovery API:

| Source | What it is | How we accessed it | Records harvested |
|--------|-----------|-------------------|-------------------|
| **BSB Munich** | Bavarian State Library — one of Europe's largest libraries, with extensive holdings of German-language printed works. VD16, VD17, and VD18 are curated bibliographies of German prints by century. | OAI-PMH (Open Archives Initiative Protocol for Metadata Harvesting) with Dublin Core metadata | 432,113 |
| **e-rara** | A consortium of Swiss research libraries providing digitized rare books | OAI-PMH with Dublin Core | 160,639 |
| **Gallica** | The digital library of the Bibliothèque nationale de France | SRU (Search/Retrieve via URL), a search protocol for library catalogs | 123,439 |
| **Biblissima** | A French aggregator that catalogs medieval and early modern manuscripts from dozens of European institutions | Wikibase API (the same technology behind Wikidata) | 111,737 |
| | | **Total** | **827,928** |

Each record was normalized to a common schema with six fields: title, author, language, date (parsed from free text into a year or year range), IIIF manifest URL (the direct link to the digitized page images), and source identifier.

### 3.2 What the Data Looks Like

The four sources catalog books in strikingly different ways. Here is the same type of record — a 16th-century Latin scientific text — as it appears from each source:

**BSB:** `title: "Georgii Agricolae Medici Bermannvs, Sive De Re Metallica"` / `author: "Agricola, Georg"` / `language: "lat"` / `date: "1546"`

**e-rara:** `title: "Georgii Agricolae De re metallica libri XII : quibus officia, instrumenta, machinae..."` / `author: "Agricola, Georg"` / `language: "lat"` / `date: "1556"`

**Gallica:** `title: "Georgii Agricolae... Bermannus, sive de re metallica"` / `author: "Agricola, Georgius (1494-1555). Auteur du texte"` / `language: "lat"` / `date: "1541"`

**Biblissima:** `title: "Reg.lat.195"` / `author: "Unknown"` / `language: "Unknown"` / `date: null`

Note that Gallica appends the author's life dates and role ("Auteur du texte") to the author field. BSB uses the German form of the name. Biblissima often has only a shelf mark, not a title. These inconsistencies are typical, not exceptional.

**Field completeness varies widely:**

| Field | BSB | e-rara | Gallica | Biblissima |
|-------|-----|--------|---------|------------|
| Title | 100% | 100% | 100% | ~40% (rest are shelf marks) |
| Author | ~90% | ~85% | ~95% | ~5% |
| Date | ~95% | ~95% | ~90% | ~0% |
| Language | ~80% | ~90% | ~85% | ~0% |

[TODO: verify these percentages from actual data]

### 3.3 Duplication Patterns We Observed

Before running any deduplication algorithm, we identified three distinct patterns of duplication:

**Pattern 1: Multiple copies within BSB (133,000 excess records)**

BSB's VD16/VD17/VD18 bibliographies are designed to track every surviving physical copy of every German-language publication from the 16th, 17th, and 18th centuries. When BSB holds three copies of Virgil's *Opera* from a 1561 printing, each copy gets its own catalog entry with its own BSB identifier. All three have the same title, the same author, the same date — but they are different physical books. We found that BSB has 432,113 total records but only 299,149 unique titles — a 31% internal duplication rate.

**Pattern 2: The same edition at different libraries (12,000 cross-source pairs)**

When both BSB and e-rara have digitized a copy of the same 1556 Basel edition, the records are nearly identical but not byte-for-byte the same. One might write "De Re Metallica Libri XII" where the other writes "De re metallica libri XII." Our preliminary fuzzy matching found approximately 12,000 such cross-source pairs.

**Pattern 3: Biblissima overlaps with direct sources (26,000 records)**

Biblissima aggregates manifests from many institutions, including some that we also crawled directly. Of Biblissima's 111,737 records, we found that 12,186 point to BSB and 13,753 point to Gallica — institutions already represented in our direct harvests. The remaining ~86,000 Biblissima records point to institutions we did NOT crawl directly (Vatican Library, IRHT, Bodleian, and others), making them genuinely new additions to the catalog.

---

## 4. Gold Standard Construction

To evaluate our deduplication methods, we need a "ground truth" — a set of record pairs where humans have decided whether each pair is or is not the same book. We constructed this gold standard by sampling 752 pairs across multiple difficulty levels.

### 4.1 Sampling Strategy

We sampled pairs from four categories, designed to test different aspects of the deduplication problem:

**Easy positives (292 pairs):** Pairs that our preliminary algorithm identified as matches, where we expect human labelers to agree. These include BSB internal duplicates (identical titles from the same library) and cross-source matches where the titles are nearly identical.

**Easy negatives (308 pairs):** Pairs that share a surface similarity — same author, or same generic title, or same decade — but are clearly different books. For example, two different theological dissertations by different authors that both happen to be titled "Theses theologicae."

**Hard positives (100 pairs):** Same author, different dates — are these different editions of the same work, or different works entirely? For example, two books by Erasmus from 1516 and 1522.

**Hard cases (52 pairs):** Multi-volume works (is volume 2 the "same book" as the complete work?), anonymous works with similar titles, and other edge cases that test the boundaries of what "same book" means.

### 4.2 How We Labeled

Each pair was labeled with one of four categories, corresponding to FRBR levels:

- **Same Item:** These are literally the same digitized object, listed under different catalog entries. (Example: the same BSB scan appearing in both VD16 and VD17 bibliographies.)
- **Same Manifestation:** These are different physical copies of the same edition — same text, same publisher, same year. (Example: BSB's copy and e-rara's copy of the 1556 Basel *De Re Metallica*.)
- **Same Work:** These are different editions or translations of the same intellectual content. (Example: the 1556 Latin edition and the 1557 German translation.)
- **Different Work:** These are unrelated books that happen to share a surface similarity. (Example: Virgil's *Opera* and Horace's *Opera*.)

[TODO: report inter-annotator agreement, labeling interface details]

---

## 5. Methods

We tested five approaches to detecting duplicates, ranging from the simplest possible method to state-of-the-art AI techniques. All methods were applied to the full dataset of 827,928 records and evaluated against the gold standard.

### 5.1 Method 1: Exact Match (Baseline)

The simplest possible approach: two records are duplicates if and only if their normalized titles and normalized authors are identical strings.

**Normalization:** Strip diacritics (ü → u, é → e), lowercase everything, remove common articles ("the," "der," "le," "la"), remove punctuation, collapse whitespace.

This method is fast and has zero false positives (if the strings match exactly, the records almost certainly refer to the same book). But it misses any pair where the titles differ even slightly — a missing comma, a different abbreviation, or a word in a different order.

### 5.2 Method 2: Jaro-Winkler Similarity with Blocking

Instead of requiring exact string equality, we measure how *similar* two strings are using the Jaro-Winkler metric — a number between 0 (completely different) and 1 (identical). Two records are considered a match if:

- Their title similarity exceeds 0.90 (90% similar)
- Their author similarity exceeds 0.82
- A composite score (title × 0.55 + author × 0.30 + date agreement × 0.15) exceeds 0.85

**Why Jaro-Winkler?** It was designed for comparing names and short strings. It gives extra credit for matching prefixes, which is useful for book titles that share long Latin openings ("Georgii Agricolae De re metallica...") but may diverge in subtitles.

**Blocking:** Comparing all 828,000 records against each other would require 343 billion pairwise comparisons — far too many. Instead, we group records into "blocks" by decade and first four characters of the author's surname. Records can only match within their block. An Agricola book from the 1550s only compares against other 1550s books by authors starting with "agri." This reduces comparisons from 343 billion to about 18 million.

**Known weakness:** This method cannot detect cross-language duplicates. "De Re Metallica" and "Vom Bergkwerck" have zero string similarity at any threshold.

### 5.3 Method 3: Fellegi-Sunter Probabilistic Linkage

Instead of hand-tuning thresholds, we let the data tell us how to weight each field.

The Fellegi-Sunter model (1969) estimates two probabilities for each field comparison:
- **m:** If two records truly are the same book, what is the probability that this field agrees? (High for title, lower for date, because dates are sometimes recorded differently.)
- **u:** If two records are NOT the same book, what is the probability that this field agrees by coincidence? (Low for long titles, high for short common titles like "Opera.")

The ratio m/u gives the *evidence weight* for each field. Fields where agreement is informative (long, specific titles) get high weights. Fields where agreement is common by chance (generic titles) get low weights. The model learns these weights automatically from the data using expectation-maximization — no hand-tuning required.

We use Splink (Linacre, 2022), an open-source implementation that scales to large datasets.

### 5.4 Method 4: Token-Set Ratio

Jaro-Winkler compares strings character by character, which means word order matters. "De Re Metallica Libri XII" and "Libri XII De Re Metallica" would get a lower Jaro-Winkler score despite containing exactly the same words.

Token-set ratio decomposes each string into a set of words (tokens) and compares the sets. It computes the similarity as the ratio of shared tokens to total tokens. This handles reordering, as well as titles where one version includes extra words (a subtitle) that the other omits.

### 5.5 Method 5: Embedding-Based Semantic Matching

All of the above methods compare the *characters* or *words* in a title. None of them can recognize that "De Re Metallica" and "Vom Bergkwerck" mean the same thing — they share zero characters and zero words.

Semantic matching uses a neural network (a multilingual sentence transformer) to convert each title into a dense numerical vector — an "embedding" — that captures its *meaning*. Titles with similar meanings have similar embeddings, regardless of language. We measure similarity between embeddings using cosine similarity.

We use `paraphrase-multilingual-MiniLM-L12-v2`, a model trained on parallel texts in 50+ languages. It has not been specifically trained on early modern book titles, so its performance on Latin and Early Modern German is an open question.

**Potential:** This is the only method that could detect cross-language duplicates without external authority files.

**Risk:** The model may conflate thematically similar but distinct works (two different Latin treatises on alchemy might embed similarly), producing false positives.

---

## 6. Experiments

### 6.1 Experimental Setup

[TODO: implement each method, run on full dataset, evaluate against gold standard]

For each method, we report:
- **Precision:** Of the pairs the method labeled as duplicates, how many were true duplicates according to our gold standard?
- **Recall:** Of the true duplicates in our gold standard, how many did the method detect?
- **F1 score:** The harmonic mean of precision and recall — a single number that balances both.

We report these metrics separately for each FRBR level (same item, same manifestation, same work), because a method that excels at finding identical copies may fail at recognizing different editions of the same work, or vice versa.

### 6.2 Results

[TODO: precision, recall, F1 table for each method at each FRBR level]

### 6.3 Threshold Sensitivity

For methods that use a similarity threshold (Jaro-Winkler, token-set ratio, embedding cosine similarity), we plot precision-recall curves showing how performance changes as the threshold is tightened or relaxed. A higher threshold catches fewer duplicates (lower recall) but makes fewer mistakes (higher precision). The "best" threshold depends on whether false positives or false negatives are more costly for the application.

[TODO: precision-recall curves]

### 6.4 Error Analysis

We categorize errors (both false positives and false negatives) by failure mode:

- **Cross-language titles:** Same work, different language → missed by string methods
- **Cataloging-language variation:** Same title, different transcription → caught or missed depending on threshold
- **Generic titles:** "Opera," "Epistolae" → false positive risk
- **Anonymous works:** Missing author → reduced discriminating power
- **Multi-volume vs complete works:** Volume 2 of a 3-volume set → unclear whether "same" or "different"
- **Variant author names:** Agricola vs Bauer → missed without authority file

[TODO: counts and examples for each category]

---

## 7. Discussion

### 7.1 Which Method for Which Purpose?

[TODO: practical guidance — if you need to avoid false positives, use exact match; if you need to catch cross-language duplicates, use embeddings; if you need a good all-around approach, use Fellegi-Sunter]

### 7.2 The Cross-Language Problem

[TODO: Can embeddings actually detect "De Re Metallica" = "Vom Bergkwerck"? Results and analysis.]

### 7.3 What This Means for Digital Libraries

[TODO: Practical recommendations. If major IIIF libraries coordinated on shared identifiers (like VD16 numbers or VIAF IDs in their IIIF metadata), most of the dedup problem would disappear. The root cause is not bad algorithms but missing linked data.]

### 7.4 Limitations

- Our gold standard was labeled by a small team, not professional catalogers. Inter-annotator agreement should be measured but has not been yet.
- We tested only four IIIF sources. The methods may perform differently on other sources with different metadata conventions.
- Embedding models are trained primarily on modern text. Their ability to encode the meaning of 16th-century Latin and Early Modern German titles is uncertain.
- We deduplicate based on metadata only. Content-based methods (comparing the actual page images or OCR text) are out of scope but would likely improve recall for cross-language cases.
- Our "blocking" strategy (grouping by decade + author prefix) means we can only detect duplicates within the same block. Two records that disagree on the decade (one says 1499, the other says 1500) will never be compared.

---

## 8. Conclusion

[TODO — to be written after experiments are complete]

We collected 827,928 records of digitized pre-modern books from four European IIIF sources and found that approximately 20% are duplicates, reducing the unique count from 828,000 to approximately 665,000. The largest source of duplication is internal to BSB (multiple copies of the same edition), not cross-source overlap, which was surprisingly low (~12,000 pairs).

Of the five methods we tested, [TODO: which performed best overall, which was best for which FRBR level, and what the practical recommendation is].

The dataset itself — a unified catalog of 665,000 unique digitized pre-modern books, with normalized metadata and IIIF manifest links — is our most concrete contribution. It answers, for the first time, the question: *what has been digitized?* We release it as an open resource.

---

## References

- de Bruin, J. (2019). Python Record Linkage Toolkit. https://recordlinkage.readthedocs.io/
- Fellegi, I. P., & Sunter, A. B. (1969). A theory for record linkage. *Journal of the American Statistical Association*, 64(328), 1183–1210.
- Hickey, T. B., O'Neill, E. T., & Toves, J. (2002). Experiments with the IFLA Functional Requirements for Bibliographic Records (FRBR). *D-Lib Magazine*, 8(9).
- Hickey, T. B. (2009). FRBR Work-Set Algorithm Version 2.0. OCLC Research.
- IFLA Study Group. (1998). *Functional Requirements for Bibliographic Records*. IFLA.
- Linacre, R. (2022). Splink: Fast, accurate and scalable probabilistic data linkage. https://github.com/moj-analytical-services/splink
- OCLC. (2025). Implementing AI to further scale and accelerate WorldCat de-duplication.
- O'Neill, E. T., Hickey, T. B., & Toves, J. (2012). GLIMIR: Manifestation and content clustering within WorldCat. *Code4Lib Journal*, 19.
- Riva, P., & Žumer, M. (2015). A survey of FRBRization techniques. *HAL Archives*.
- Stein, A., et al. (2006). Early printed books as material objects. *IFLA Journal*.
- Toves, J., Hickey, T. B., & O'Neill, E. T. (2015). Collected work clustering in WorldCat. *Code4Lib Journal*, 30.
