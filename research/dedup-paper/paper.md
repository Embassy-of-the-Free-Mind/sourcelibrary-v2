# Probabilistic Deduplication of Pre-Modern Book Records Across Heterogeneous IIIF Digital Libraries

**Authors:** Derek Lomas, [collaborators TBD]
**Affiliation:** Source Library / Embassy of the Free Mind
**Status:** Draft — experiments in progress

---

## Abstract

We present a large-scale deduplication study across 827,928 bibliographic records harvested from four major European IIIF digital library systems: the Bavarian State Library (BSB/MDZ), the Bibliothèque nationale de France (Gallica), the Swiss e-rara consortium, and the Biblissima aggregator. These records represent digitized pre-modern books (pre-1800) — manuscripts, incunabula, and early printed works — cataloged in heterogeneous metadata schemas, multiple languages, and inconsistent authority formats. We evaluate multiple deduplication approaches against a human-labeled gold standard of 1,000 record pairs, comparing exact matching, rule-based normalization, Jaro-Winkler similarity with blocking, Fellegi-Sunter probabilistic linkage, and embedding-based semantic matching. We report precision, recall, and F1 scores for each method and analyze failure modes specific to pre-modern bibliographic records, including cross-language title variants, anonymous works, generic Latin titles, and multi-copy digitizations. Our dataset and evaluation framework are released as open resources for the digital humanities community.

---

## 1. Introduction

The digitization of pre-modern texts by European research libraries has produced millions of freely accessible page images via the International Image Interoperability Framework (IIIF). Yet no unified catalog exists of what has actually been digitized. Individual libraries maintain their own catalogs; aggregators like Biblissima and Europeana provide partial coverage; and bibliographic databases like the Universal Short Title Catalogue (USTC) track editions rather than digitizations. A researcher asking "has this 1556 Latin text been digitized, and where?" must search multiple systems with no guarantee of completeness.

Source Library (sourcelibrary.org) is building such a unified catalog by harvesting IIIF manifests from major European repositories. In doing so, we encountered a fundamental challenge: the same intellectual work may appear multiple times across (and within) source catalogs, at different levels of identity — the same scan listed under multiple catalog entries (item-level duplication), the same edition held by multiple libraries (manifestation-level), and different editions or translations of the same work (work-level). Accurately identifying and classifying these relationships is essential both for estimating the true size of the digitized pre-modern corpus and for avoiding redundant processing.

This problem sits at the intersection of record linkage (Fellegi & Sunter, 1969), bibliographic clustering (Hickey et al., 2002; OCLC, 2009), and the FRBR conceptual model (IFLA, 1998). While substantial work exists on deduplication of modern library catalogs — notably OCLC's recent AI-driven deduplication of 5.4 million WorldCat records (OCLC, 2025) — pre-modern materials present unique challenges:

1. **Cataloging language varies by institution.** BSB catalogs in German, Gallica in French, e-rara in the original language. The same work may be titled "De Re Metallica," "Vom Bergkwerck," or "Douze livres de métallique" depending on the cataloging library.

2. **Author name forms are unstable across centuries.** "Georgius Agricola" (Latin), "Georg Bauer" (German birth name), "George Agricola" (English) refer to the same person. Authority files (GND, VIAF) can resolve this, but not all catalog records link to authorities.

3. **Generic titles are common.** "Opera," "Epistolae," "Theses theologicae," "Gedichte" — hundreds of different works share identical titles. Author disambiguation is critical but authors are frequently anonymous ("[s.n.]").

4. **Multi-copy digitizations within a single library.** BSB's VD16/VD17/VD18 bibliographies list separate records for each physical copy (Exemplar) of an edition. A popular 16th-century work may have 10+ BSB records, each representing a different physical copy digitized from the same library.

5. **The FRBR distinction between manifestation and work matters.** A 1556 edition and a 1561 edition of the same text are bibliographically distinct (different manifestations) but intellectually identical (same work). Whether these should be "deduplicated" depends on the use case.

We contribute:
- A unified dataset of 827,928 IIIF manifest records from four major sources, with normalized metadata
- A human-labeled gold standard of 1,000 record pairs annotated at three FRBR levels
- A comparative evaluation of five deduplication methods on this dataset
- An analysis of failure modes specific to pre-modern bibliographic records
- Open-source tools for IIIF catalog harvesting and deduplication

---

## 2. Related Work

### 2.1 The FRBR Model and Bibliographic Identity

The IFLA Functional Requirements for Bibliographic Records (IFLA, 1998) defines four entities in a hierarchy: Work (intellectual creation), Expression (realization in a specific language/form), Manifestation (physical embodiment — an edition), and Item (a single physical copy). This model, refined as IFLA-LRM (2017) and operationalized as BIBFRAME by the Library of Congress, provides the conceptual framework for distinguishing levels of duplication.

For pre-modern printed books, the FRBR model is both essential and problematic. Stein et al. (2006) note that individual copies of early printed books retain "striking uniqueness" — hand-colored illustrations, manuscript annotations, variant bindings — making the Item level more significant than for modern publications. Conversely, the Work level is harder to define for texts that circulated in multiple recensions, abridgements, and translations without a stable "canonical" version.

### 2.2 Algorithmic Bibliographic Clustering

The OCLC Work-Set Algorithm (Hickey et al., 2002; Hickey, 2009) remains the most widely deployed approach to bibliographic clustering. It constructs a "work key" from normalized author surname and uniform title, then clusters records sharing the same key. Authority file lookup (matching author names against VIAF/GND) was found to significantly improve clustering accuracy. The algorithm was applied to WorldCat's full 48 million records and forms the basis of WorldCat's work-level display.

GLIMIR (Manifestation and Content Clustering within WorldCat; O'Neill et al., 2012) extends this to manifestation-level clustering, incorporating publisher, date, and physical description fields. Toves et al. (2015) describe "Collected Work Clustering" for handling anthologies and multi-work volumes.

A survey of FRBRization techniques (Riva & Žumer, 2015) identifies three main approaches: rule-based (string normalization + matching rules), authority-based (leveraging name/title authority files), and hybrid. They note that "no single approach works well across all record types and languages."

### 2.3 Probabilistic Record Linkage

Fellegi & Sunter (1969) formalized record linkage as a statistical decision problem. For each pair of records, comparison outcomes across fields produce a weight vector; pairs are classified as matches, non-matches, or uncertain based on composite weights. Modern implementations include the Python Record Linkage Toolkit (de Bruin, 2019), Splink (Linacre, 2022), and dedupe (Gregg & Eder, 2015).

Splink implements the Fellegi-Sunter model with expectation-maximization for unsupervised weight estimation, blocking for scalability, and support for multiple string comparison metrics. It has been applied to datasets of hundreds of millions of records.

### 2.4 Recent AI/ML Approaches

OCLC announced in 2025 the deployment of a machine learning model for WorldCat deduplication, trained with input from 300 cataloging professionals who labeled example pairs. The model removed 5.4 million duplicate print book records across multiple languages. OCLC describes a "hybrid approach" combining AI processing with human expert review (OCLC, 2025).

The SaDDL project (Similarities and Duplicates in Digital Libraries) applied machine learning to HathiTrust's 17 million volumes, going beyond metadata to content-based similarity using text distributed by the HathiTrust Research Center.

### 2.5 The Gap

No published work addresses deduplication specifically across heterogeneous IIIF digital library catalogs for pre-modern materials. Existing approaches assume relatively standardized MARC records (OCLC, HathiTrust) or focus on modern publications with ISBNs. Our dataset — harvested from OAI-PMH, SRU, and Wikibase APIs with Dublin Core and IIIF Presentation API metadata — presents different challenges: sparser metadata, inconsistent field usage, multilingual cataloging, and the absence of shared identifiers across institutions.

---

## 3. Dataset

### 3.1 Sources and Harvesting

We harvested IIIF manifest metadata from four sources using their respective discovery APIs:

| Source | API | Records | Date range | Primary languages |
|--------|-----|---------|------------|-------------------|
| BSB Munich (VD16/17/18) | OAI-PMH | 432,113 | 1501–1800 | German, Latin |
| e-rara (Swiss libraries) | OAI-PMH | 160,639 | All dates | German, Latin, French |
| Gallica (BnF) | SRU | 123,439 | Pre-1800 | French, Latin |
| Biblissima (aggregator) | Wikibase API | 111,737 | Medieval–Early Modern | Latin, French |
| **Total** | | **827,928** | | |

Harvesting used standard protocols (OAI-PMH with Dublin Core, SRU with Dublin Core, MediaWiki API for Wikibase entities). Each record was normalized to a common schema: title, author, language, date (parsed to year range), IIIF manifest URL, source identifier, and raw metadata.

### 3.2 Metadata Characteristics

[TODO: analyze and report field completeness, language distribution, date distribution, author attribution rates per source]

### 3.3 Known Duplication Patterns

Preliminary analysis revealed distinct duplication patterns per source:

- **BSB internal duplication:** VD16/17/18 list separate records for each physical copy (Exemplar) of an edition. A work with 10 surviving copies in BSB yields 10 records with identical titles and authors but different BSB IDs. This accounts for ~133,000 excess records (31% of BSB's total).

- **Cross-source same-edition duplication:** The same edition digitized by BSB and e-rara (e.g., Agricola's *De Re Metallica*, 1556) appears with near-identical but not byte-identical titles due to different cataloging conventions.

- **Biblissima manifest overlap:** 62% of Biblissima Wikibase entities contain IIIF manifest URLs. Of a sample of 200, manifests pointed to: Vatican Library (200), with broader analysis showing BSB (12,186), Gallica (13,753), IRHT/CNRS (29,054), Bodleian (5,433), and others. The BSB and Gallica manifests overlap with directly-harvested records.

---

## 4. Gold Standard Construction

### 4.1 Sampling Strategy

We construct a gold standard of 1,000 record pairs using stratified sampling:

- **True positives (400 pairs):** Sampled from clusters identified by our preliminary Jaro-Winkler method, stratified by:
  - Same-source same-edition copies (BSB internal dupes): 150 pairs
  - Cross-source same-edition: 100 pairs
  - Related editions (same work, different year/place): 100 pairs
  - Borderline matches (composite score 0.85–0.92): 50 pairs

- **True negatives (400 pairs):** Sampled from same blocks (same decade + author prefix) but NOT matched:
  - Different works by same author: 150 pairs
  - Same generic title, different author: 100 pairs
  - Similar but distinct works: 150 pairs

- **Hard cases (200 pairs):** Deliberately chosen to test edge cases:
  - Cross-language same work: 50 pairs (e.g., "De Re Metallica" vs "Vom Bergkwerck")
  - Anonymous works with similar titles: 50 pairs
  - Multi-volume works vs single volumes: 50 pairs
  - Same work with substantially different title transcriptions: 50 pairs

### 4.2 Labeling Protocol

Each pair is labeled at three FRBR levels:
- **Same Item** (same digitized object, different catalog entry)
- **Same Manifestation** (same edition, different copy or different catalog)
- **Same Work** (same intellectual content, different edition/translation)
- **Different Work** (unrelated despite surface similarity)

[TODO: implement labeling interface, recruit labelers, report inter-annotator agreement]

---

## 5. Methods

We evaluate five deduplication approaches, applied uniformly to the full dataset with performance measured against the gold standard:

### 5.1 Exact Match (Baseline)

Normalized title + normalized author exact string equality. Normalization: Unicode NFD decomposition, diacritics stripped, lowercased, articles removed, punctuation stripped, whitespace collapsed.

### 5.2 Rule-Based with Thresholds

Jaro-Winkler similarity on normalized title (threshold ≥ 0.90) AND normalized author (threshold ≥ 0.82), with blocking by decade + author prefix (first 4 characters). Composite score: title × 0.55 + author × 0.30 + date_match × 0.15. Match threshold: composite ≥ 0.85.

### 5.3 Fellegi-Sunter Probabilistic (Splink)

Unsupervised estimation of m/u parameters via expectation-maximization. Comparison fields: title (Jaro-Winkler), author (Jaro-Winkler), date (exact + within-2-years), language (exact). Blocking: decade + author prefix. Match weight threshold determined by the model.

### 5.4 Token-Set Ratio

Using token-set ratio (from the `fuzz` family of string matchers) instead of Jaro-Winkler. Token-set ratio handles word reordering ("Metallica, De Re" vs "De Re Metallica") and partial token overlap better than character-level metrics. Same blocking strategy.

### 5.5 Embedding-Based Semantic Matching

Compute title embeddings using a multilingual sentence transformer (e.g., `paraphrase-multilingual-MiniLM-L12-v2`), then cosine similarity within blocks. This approach can potentially handle cross-language matching ("De Re Metallica" ≈ "Vom Bergkwerck") that string-based methods cannot.

---

## 6. Experiments

### 6.1 Experimental Setup

[TODO: implement each method, run on full dataset, evaluate against gold standard]

### 6.2 Results

[TODO: precision, recall, F1 table for each method at each FRBR level]

### 6.3 Threshold Sensitivity

[TODO: precision-recall curves for Jaro-Winkler and embedding methods across threshold values]

### 6.4 Error Analysis

[TODO: categorize false positives and false negatives by failure mode]

---

## 7. Discussion

### 7.1 Which Method for Which Level?

[TODO: analyze which methods work best at item/manifestation/work levels]

### 7.2 The Cross-Language Problem

[TODO: analyze embedding method's performance on cross-language pairs vs string methods]

### 7.3 Implications for Digital Library Practice

[TODO: practical recommendations for IIIF catalog unification]

### 7.4 Limitations

- Gold standard is labeled by a small team, not professional catalogers
- Dataset is limited to 4 sources (large but not exhaustive)
- Embedding models may not be trained on early modern title patterns
- We evaluate metadata-only dedup; content-based methods (OCR text comparison) are out of scope

---

## 8. Conclusion

[TODO]

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
- Toves, J., Hickey, T. B., & O'Neill, E. T. (2015). Collected work clustering in WorldCat. *Code4Lib Journal*, 30.
