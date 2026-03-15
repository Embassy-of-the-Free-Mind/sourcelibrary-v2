# Probabilistic Deduplication of Pre-Modern Book Records Across Heterogeneous IIIF Digital Libraries

**Authors:** Derek Lomas, [collaborators TBD]
**Affiliation:** Source Library / Embassy of the Free Mind
**Status:** Draft — experiments in progress

---

## Abstract

European research libraries have digitized millions of pre-modern books and made them freely available through IIIF (International Image Interoperability Framework). But no unified catalog tells you what has been digitized. Each library maintains its own records. The same book can appear in multiple catalogs — sometimes under different titles, in different languages, with different author name forms.

We harvested 827,928 records from four major IIIF sources and asked: how many of these are actually unique books? To answer this, we needed to identify duplicates at three levels — the same scan appearing twice in a catalog, the same edition held by different libraries, and different editions of the same work. Each level requires different treatment: identical scans should be merged, parallel editions should be linked, and different editions of the same work should be grouped but preserved.

We compare five deduplication methods against a human-labeled gold standard of 1,000 record pairs and report which methods work best for which level of duplication. Our findings suggest that simple string matching catches most within-library duplicates, but cross-library and cross-language matching requires either authority file enrichment or embedding-based approaches.

---

## 1. Introduction

In 1556, Georg Agricola published *De Re Metallica* in Basel — the most important work on mining and metallurgy of the Renaissance. Today, digitized copies of this book exist in at least three of the repositories we studied. In our dataset, we found it under these titles:

| Source | Title in catalog | Language |
|--------|-----------------|----------|
| e-rara | Georgii Agricolae De re metallica libri XII : quibus officia, instrumenta, machi... | Latin |
| BSB | Georgii Agricolae De Re Metallica Libri XII : Qvibus Officia, Instrumenta, Machi... | Latin |
| BSB (different copy) | Vom Bergkwerck XII Bücher Darin[n] alle Empter, Instrument, Gezeuge... | German |
| Gallica | Georgii Agricolae... Bermannus, sive de re metallica | Latin |

The first two are the same Latin edition (1556) at different libraries — clearly duplicates at the edition level. The third is the German translation (1557) — a different edition but the same work. The fourth is a different, earlier text by the same author (*Bermannus*, 1530) — a related but distinct work.

A human reader recognizes these relationships immediately. An algorithm must work from inconsistent metadata: different capitalization and punctuation (the first two), a completely different language (the third), and a different title entirely (the fourth). This paper asks: which algorithms handle which of these cases, and how well?

### The problem

IIIF is an open standard that lets libraries publish digitized books in a uniform way. A growing number of European libraries use it. But while the *image delivery* is standardized, the *catalog metadata* is not. Each library describes its books in its own language, its own format, and its own level of detail. When you harvest records from multiple libraries, you get a pile of records with no shared identifiers and no way to tell, automatically, which records refer to the same book.

This matters for two reasons. First, anyone trying to build a comprehensive catalog of digitized pre-modern books (as Source Library is doing) needs to know the actual count. Our initial harvest yielded 827,928 records; the true number of unique books is substantially lower. Second, downstream processing — OCR, translation, indexing — is expensive. Processing the same book twice wastes resources.

### What makes pre-modern books harder than modern ones

Modern books have ISBNs. Pre-modern books do not. Modern books have standardized author names in authority files. Pre-modern authors are known by Latin, vernacular, and anglicized forms of their names — sometimes all three in different catalogs. Modern book titles are short and standardized. Pre-modern titles can run to hundreds of words and vary significantly between catalogs, even for the same edition.

We identified five specific challenges (illustrated in Figure 1):

1. **Cross-language cataloging.** BSB catalogs in German, Gallica in French, e-rara in the original language. The same work appears as "De Re Metallica," "Vom Bergkwerck," or "Douze livres de la métallique."

2. **Unstable author names.** "Georgius Agricola" (Latin), "Georg Bauer" (German birth name), "George Agricola" (anglicized). All refer to the same person.

3. **Generic titles.** In BSB alone, we found 76 records titled "Gedichte" (Poems), 42 titled "Opera" (Works), and 30 titled "Epistolae" (Letters) — all by different authors.

4. **Multi-copy digitizations.** BSB lists a separate record for each physical copy it holds. Virgil's *Opera* has 10 BSB records — 10 different scans of similar editions of the same work.

5. **The edition/work distinction.** A 1556 edition and a 1561 edition are bibliographically distinct (different printings, potentially different text) but intellectually the same work. Whether they should be "deduplicated" depends on the question being asked.

### Our contributions

- A unified dataset of 827,928 IIIF manifest records from four major European sources
- A human-labeled gold standard of record pairs annotated at multiple levels of bibliographic identity
- A comparative evaluation of five deduplication methods, from simple string matching to semantic embeddings
- An analysis of which failure modes affect which methods
- Open-source harvesting and deduplication tools

---

## 2. Background and Related Work

### 2.1 What counts as a "duplicate"? The FRBR model

The library science community has a standard answer to the question "when are two catalog records about the same thing?" The IFLA Functional Requirements for Bibliographic Records (FRBR, 1998) defines four nested levels of identity:

```
                    ┌─────────────────────────────────────────────┐
                    │  WORK                                       │
                    │  Agricola's treatise on mining               │
                    │                                             │
                    │  ┌──────────────────┐ ┌──────────────────┐  │
                    │  │ EXPRESSION       │ │ EXPRESSION       │  │
                    │  │ Latin original   │ │ German transl.   │  │
                    │  │                  │ │                  │  │
                    │  │ ┌──────────┐     │ │ ┌──────────┐     │  │
                    │  │ │MANIFEST. │     │ │ │MANIFEST. │     │  │
                    │  │ │Basel 1556│     │ │ │Basel 1557│     │  │
                    │  │ │          │     │ │ │          │     │  │
                    │  │ │ ┌──┐┌──┐ │     │ │ │ ┌──┐     │     │  │
                    │  │ │ │  ││  │ │     │ │ │ │  │     │     │  │
                    │  │ │ │e-││BS│ │     │ │ │ │BS│     │     │  │
                    │  │ │ │ra││B │ │     │ │ │ │B │     │     │  │
                    │  │ │ │ra││  │ │     │ │ │ │  │     │     │  │
                    │  │ │ │  ││  │ │     │ │ │ │  │     │     │  │
                    │  │ │ └──┘└──┘ │     │ │ │ └──┘     │     │  │
                    │  │ │  ITEMS   │     │ │ │  ITEM    │     │  │
                    │  │ └──────────┘     │ │ └──────────┘     │  │
                    │  └──────────────────┘ └──────────────────┘  │
                    └─────────────────────────────────────────────┘

Figure 1. FRBR hierarchy for Agricola's De Re Metallica.
The e-rara and BSB copies of the 1556 Latin edition are different
Items of the same Manifestation. The 1557 German translation is a
different Expression of the same Work.
```

- **Work**: the abstract intellectual creation — "Agricola's treatise on mining and metallurgy"
- **Expression**: a particular realization — the Latin text, the German translation
- **Manifestation**: a specific publication — the Basel 1556 edition, the Basel 1561 reprint
- **Item**: a single physical copy — BSB's copy with shelfmark Res/4 Oec. 123

For modern books, the Manifestation level maps cleanly to an ISBN. For pre-modern books, there are no ISBNs. The Manifestation must be identified by a combination of title, author, place, date, and printer — all of which vary in how they are recorded across catalogs.

For deduplication purposes, what we need depends on the goal:

| Goal | FRBR level | Action |
|------|-----------|--------|
| Avoid processing the same scan twice | Item | Merge — keep one record |
| Link copies at different libraries | Manifestation | Link — keep both, mark as same edition |
| Group all editions of a text | Work | Group — keep all, cluster under a work ID |

### 2.2 How others have done this

**The OCLC Work-Set Algorithm** (Hickey, O'Neill & Toves, 2002; refined 2009) is the most widely used approach. It works by constructing a "work key" from a normalized author name and a "uniform title" (a canonical form of the title), then grouping all records that share the same key. Applied to WorldCat's 48 million records, it achieved high accuracy — especially when author names were looked up in authority files (VIAF, GND) rather than just normalized from the catalog record. The key insight: **authority file lookup is the single most effective improvement to bibliographic clustering.**

**OCLC's 2025 AI deduplication** used a machine learning model trained with input from 300 cataloging professionals. Catalogers labeled pairs of records as "same" or "different," and the model learned to generalize. This removed 5.4 million duplicate records from WorldCat, primarily English-language print books. OCLC describes it as a "hybrid approach" — AI processes the volume, humans ensure the quality.

**HathiTrust** (17 million digitized volumes) uses OCLC numbers as its primary dedup key: if two contributing libraries assign the same OCLC number, the books are considered the same manifestation. For records without OCLC numbers, they found that "metadata quality is the single largest factor" in dedup accuracy — consistent cataloging practices matter more than sophisticated algorithms.

**The Fellegi-Sunter model** (1969) provides the theoretical foundation for probabilistic record linkage. For each pair of records, you compare fields (title, author, date) and compute how much more likely the observed similarity pattern is under the hypothesis "these are the same book" versus "these are different books." The ratio of these likelihoods gives a match weight. Modern implementations like Splink (Linacre, 2022) estimate these probabilities automatically from the data using expectation-maximization.

### 2.3 What's missing

No published work addresses deduplication across heterogeneous IIIF catalogs for pre-modern materials. The key differences from prior work:

- **No shared identifiers.** OCLC numbers and ISBNs don't exist for most of our records. Each library uses its own identifier scheme (BSB IDs, BnF ARK identifiers, e-rara DOIs, Biblissima Q-numbers).
- **Sparser metadata.** Our records come from OAI-PMH Dublin Core and Wikibase entities, not full MARC records. Many fields that OCLC relies on (publisher, pagination, physical description) are absent.
- **Multilingual cataloging.** OCLC primarily handles English records. Our dataset spans German, French, Latin, Italian, and more — with the same work sometimes cataloged in different languages by different libraries.
- **Pre-modern materials.** Author names, title conventions, and publication practices of the 15th–18th centuries are fundamentally different from modern publishing.

---

## 3. Dataset

### 3.1 How we harvested 827,928 records

We built crawlers for four major European IIIF sources, each with a different discovery API:

```
  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
  │  BSB Munich  │     │   e-rara    │     │   Gallica   │     │ Biblissima  │
  │  (432,113)   │     │  (160,639)  │     │  (123,439)  │     │  (111,737)  │
  │              │     │             │     │             │     │             │
  │  OAI-PMH     │     │  OAI-PMH    │     │  SRU API    │     │  Wikibase   │
  │  VD16/17/18  │     │  Dublin Core│     │  Dublin Core│     │  P196 prop  │
  └──────┬───────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
         │                    │                    │                    │
         └─────────┬──────────┴──────────┬─────────┴──────────┬────────┘
                   │                     │                    │
                   ▼                     ▼                    ▼
           ┌──────────────────────────────────────────────────────┐
           │           import_candidates (MongoDB)                │
           │                                                      │
           │  Normalized schema:                                  │
           │  title, author, language, date_earliest, date_latest │
           │  manifest_url, source, source_id, metadata{}         │
           │                                                      │
           │  827,928 records                                     │
           └──────────────────────────────────────────────────────┘

Figure 2. Data harvesting pipeline. Each source uses a different
discovery API but records are normalized to a common schema.
```

| Source | Discovery API | Records | Scope | What it catalogs |
|--------|--------------|---------|-------|-----------------|
| BSB Munich | OAI-PMH (VD16, VD17, VD18 sets) | 432,113 | German-speaking prints, 1501–1800 | One record per physical copy (Exemplar) |
| e-rara | OAI-PMH (Dublin Core) | 160,639 | Swiss rare books, all dates | One record per title |
| Gallica (BnF) | SRU search API | 123,439 | French pre-1800 monographs | One record per bibliographic entity |
| Biblissima | Wikibase API (property P196) | 111,737 | Medieval & early modern manuscripts, aggregated from 40+ libraries | One record per shelfmark |

Each record was normalized to a common schema: title, author, language (mapped to standard names), date (parsed from free text like "[1556]" or "ca. 1550" into earliest/latest year), IIIF manifest URL, and source metadata.

### 3.2 What the metadata looks like

The quality and completeness of metadata varies dramatically across sources:

| Field | BSB | e-rara | Gallica | Biblissima |
|-------|-----|--------|---------|------------|
| Title | Always present, in original language | Always present | Always present | Sometimes a shelfmark only |
| Author | Often "Unknown" for VD18 | Usually present | Usually present, with dates | Rarely present |
| Language | ISO 639 code | ISO 639 code | ISO 639 code | Not stored |
| Date | Free text: "[1556]", "ca. 1550" | Free text | Free text | Not stored on entity |
| Identifier | BSB ID (bsb00029099) | DOI (10.3931/e-rara-N) | ARK (ark:/12148/bptN) | Wikibase Q-ID + shelfmark |

This heterogeneity is the core challenge. The same book at BSB and e-rara will have:
- Near-identical titles (but different punctuation and capitalization)
- Similar author names (but in different formats — "Agricola, Georg" vs "Agricola, Georgius")
- The same date (if both parse correctly)
- Completely different identifiers (no shared key)

### 3.3 Duplication patterns we observed

Before running any algorithms, we examined the data to understand what kinds of duplicates exist:

**Within BSB (the biggest source of duplication):**
BSB's VD16/VD17/VD18 bibliographies are catalogs of *copies*, not *editions*. When BSB holds three copies of the 1556 *De Re Metallica*, each gets its own record with its own BSB ID, even though the title, author, and date are identical. We found 432,113 BSB records but only 299,149 unique titles — a 31% duplication rate from multi-copy listings alone.

**Across sources:**
The same edition at BSB and e-rara typically has near-identical but not byte-identical titles. Differences include: punctuation ("Libri XII" vs "Libri XII."), capitalization (original vs normalized), diacritical marks, and minor transcription variations.

**Biblissima as aggregator:**
Biblissima doesn't digitize books itself — it aggregates manifest URLs from partner libraries. Of its 111,737 records, we found:
- 29,054 pointing to IRHT/CNRS (French manuscripts — not in our other sources)
- 22,766 pointing to the Vatican Library (not in our other sources)
- 13,753 pointing to Gallica (overlaps with our Gallica crawl)
- 12,186 pointing to BSB (overlaps with our BSB crawl)
- 5,433 pointing to the Bodleian Library (not in our other sources)
- 28,545 pointing to other institutions (Leiden, Portugal, Karlsruhe, etc.)

So roughly 26,000 Biblissima records overlap with sources we crawled directly, while 86,000 bring in manifests from libraries we didn't crawl — Vatican, IRHT, Bodleian, and dozens of smaller collections.

---

## 4. Gold Standard

To evaluate deduplication methods, we need ground truth: a set of record pairs where a human has determined whether they refer to the same book. We constructed a gold standard of 752 pairs (targeting 1,000; ongoing) using stratified sampling to cover the full range of difficulty.

### 4.1 Sampling strategy

We sampled pairs from four strata, ensuring the gold standard includes easy cases (to measure baseline accuracy), typical cases (to measure practical performance), and hard cases (to reveal method limitations):

```
                            Gold Standard Pairs
                            ┌───────────────────┐
                            │                   │
                 ┌──────────┴──────────┐  ┌─────┴──────────┐
                 │  Expected matches   │  │ Expected non-  │
                 │  (from clusters)    │  │ matches        │
                 │                     │  │ (same block,   │
                 │                     │  │  not clustered) │
                 ├─────────────────────┤  ├────────────────┤
                 │ Same-source copies  │  │ Same author,   │
                 │ (BSB internal) 150  │  │ diff work  150 │
                 ├─────────────────────┤  ├────────────────┤
                 │ Cross-source same   │  │ Generic title, │
                 │ edition         100 │  │ diff author  10│
                 ├─────────────────────┤  ├────────────────┤
                 │ Related editions    │  │ Same block,    │
                 │ (diff year)     100 │  │ random     150 │
                 ├─────────────────────┤  ├────────────────┤
                 │ Borderline (large   │  │ Hard cases:    │
                 │ clusters)        50 │  │ anon, multi-   │
                 └─────────────────────┘  │ volume      52 │
                                          └────────────────┘

Figure 3. Gold standard stratification.
```

### 4.2 Labeling protocol

Each pair is labeled with one of four FRBR-based categories:

- **Same Item**: same digitized object appearing under different catalog entries (e.g., two BSB records for the same physical copy — rare, but it happens)
- **Same Manifestation**: same edition, possibly different physical copies or different catalogs (e.g., BSB and e-rara both holding a 1556 Basel edition)
- **Same Work**: same intellectual content, different edition or translation (e.g., the 1556 Latin and 1557 German editions of *De Re Metallica*)
- **Different Work**: unrelated despite surface similarity (e.g., "Gedichte" by Hölty vs "Gedichte" by Bürger)

[TODO: complete labeling, report inter-annotator agreement]

---

## 5. Methods

We evaluate five approaches, from simple to complex. Each uses the same input (the 827,928 normalized records) and produces clusters of records it considers duplicates. We then evaluate each method's clusters against the gold standard.

### 5.1 Method 1: Exact String Match (Baseline)

The simplest possible approach. Normalize titles and authors (strip diacritics, lowercase, remove articles and punctuation, collapse whitespace), then cluster records with exactly matching normalized title AND normalized author.

**Strengths:** No false positives — if two normalized strings are identical, the records almost certainly refer to the same work.

**Weaknesses:** Misses any variation at all. "Georgii Agricolae De re metallica libri XII" and "Georgii Agricolae De Re Metallica Libri XII" normalize identically (good), but "De Re Metallica Libri XII" with a different prefix does not match (bad).

### 5.2 Method 2: Jaro-Winkler with Blocking

Our initial approach, already deployed. Three steps:

**Step 1 — Blocking.** Group records by decade of publication and first four characters of the normalized author surname. This means a 1556 book by Agricola only compares against other 1550s books by authors starting with "agri." This reduces the number of comparisons from 343 billion (all pairs) to about 18 million (within-block pairs).

```
  828K records ──► Block by decade+author ──► 57K blocks
                                               │
                   ┌───────────────────────────┘
                   │
                   ▼
        Within each block (avg 14.5 records):

        Compare every pair:
        ┌─────────────────────────────────────────┐
        │  title_sim = JaroWinkler(norm_title_a,  │
        │                          norm_title_b)  │
        │  author_sim = JaroWinkler(norm_author_a,│
        │                           norm_author_b)│
        │  date_sim = exact_match ? 1.0 :         │
        │             within_2_years ? 0.9 : 0.7  │
        │                                         │
        │  score = title_sim × 0.55               │
        │        + author_sim × 0.30              │
        │        + date_sim × 0.15                │
        │                                         │
        │  if score ≥ 0.85: MATCH                 │
        └─────────────────────────────────────────┘
                   │
                   ▼
        Union-Find clustering:
        if A matches B and B matches C → {A, B, C}

Figure 4. The blocking + comparison + clustering pipeline.
```

**Strengths:** Catches most within-source duplicates and many cross-source duplicates where titles are similar. The blocking makes it feasible at scale.

**Weaknesses:** Cannot match across languages ("De Re Metallica" vs "Vom Bergkwerck" have 0% string similarity). The blocking means records must share the same decade AND author prefix to be compared — an author cataloged as "Agricola" at BSB and "Bauer" at Gallica would never be compared.

### 5.3 Method 3: Fellegi-Sunter Probabilistic (via Splink)

Instead of hand-tuning weights (0.55 for title, 0.30 for author, 0.15 for date), let the data determine what each field is worth. The Fellegi-Sunter model estimates two probabilities for each field comparison:

- **m-probability**: if two records really are the same book, how likely is it that their titles would match at this similarity level?
- **u-probability**: if two records are different books, how likely is it that their titles would appear this similar by chance?

The ratio m/u gives a weight: high when a match is informative (rare among random pairs but common among true matches), low when it's not (common among random pairs too). Splink estimates these probabilities automatically using expectation-maximization — no labeled training data needed.

**Strengths:** Learns from the data which fields are most informative. Automatically handles the fact that matching on "Gedichte" (common title) is less informative than matching on "Georgii Agricolae De Re Metallica" (rare title).

**Weaknesses:** Still operates on string comparisons — cannot handle cross-language matching.

### 5.4 Method 4: Token-Set Ratio

Instead of Jaro-Winkler (which measures character-level similarity), use token-set ratio, which measures word-level overlap regardless of order. The algorithm:

1. Tokenize both titles into sets of words
2. Find the intersection (words in common)
3. Compute: `ratio(intersection, intersection + remainder_a)` and `ratio(intersection, intersection + remainder_b)`
4. Take the maximum

This handles word reordering ("Metallica, De Re" vs "De Re Metallica" → perfect match) and partial overlap ("De Re Metallica Libri XII" vs "De Re Metallica" → high match because the shared tokens are the meaningful ones).

**Strengths:** Robust to word order differences, which are common in catalog titles. Handles the case where one catalog includes a subtitle and the other doesn't.

**Weaknesses:** Like Jaro-Winkler, operates on surface forms only. Cannot cross the language barrier.

### 5.5 Method 5: Embedding-Based Semantic Matching

Compute a vector representation (embedding) of each title using a multilingual sentence transformer, then measure cosine similarity between embeddings. The key hypothesis: a multilingual model trained on parallel text might place "De Re Metallica" and "Vom Bergkwerck" near each other in embedding space, even though they share no characters.

We use `paraphrase-multilingual-MiniLM-L12-v2`, a sentence transformer trained on parallel data in 50+ languages. The same blocking strategy applies — we only compare embeddings within blocks.

**Strengths:** Can potentially handle cross-language matching, which all string-based methods fail at completely.

**Weaknesses:** Embedding models are trained on modern text, not Renaissance Latin titles. The model may not understand that "Libri XII" means "twelve books" or that "De Re Metallica" is about metallurgy. Performance on this domain is an open question — and one of the most interesting things we can measure.

---

## 6. Experiments

### 6.1 Experimental Setup

[TODO: implement each method, run on full dataset, evaluate against gold standard]

For each method, we measure:

- **Precision**: of the pairs the method says are duplicates, what fraction actually are? (High precision = few false positives)
- **Recall**: of the pairs that actually are duplicates, what fraction does the method find? (High recall = few false negatives)
- **F1**: the harmonic mean of precision and recall (balances both concerns)

We report these metrics separately at each FRBR level:
- Item-level: merging catalog records for the same scan
- Manifestation-level: linking copies of the same edition
- Work-level: grouping editions of the same intellectual work

### 6.2 Results

[TODO: precision, recall, F1 table]

### 6.3 Threshold Sensitivity

[TODO: precision-recall curves across different threshold values for Methods 2–5]

### 6.4 Error Analysis

[TODO: categorize false positives and false negatives by the five challenge types identified in Section 1]

---

## 7. Discussion

### 7.1 Which method for which level?

[TODO: analyze which methods work best at item/manifestation/work levels]

We expect:
- Exact match and Jaro-Winkler to dominate at the Item level (identical or near-identical titles)
- Fellegi-Sunter to outperform hand-tuned Jaro-Winkler at the Manifestation level (better calibrated weights)
- Embeddings to be the only method with non-trivial recall at the Work level for cross-language cases

### 7.2 The cross-language problem

[TODO: analyze embedding method's performance on cross-language pairs vs string methods]

This is the paper's most interesting question. If a multilingual embedding model can reliably match "De Re Metallica" with "Vom Bergkwerck," that would be a significant finding for digital humanities. If it cannot — if the model doesn't generalize to Renaissance Latin and Early Modern German — that's also a significant finding, pointing to the need for domain-specific training data or authority file enrichment.

### 7.3 Practical implications

[TODO: recommendations for digital library practitioners building unified catalogs]

Key questions to address:
- When should you invest in authority file enrichment vs algorithmic matching?
- How much does metadata quality matter vs algorithm sophistication?
- What's the minimum viable dedup approach for a project like ours?

### 7.4 Limitations

- Our gold standard is labeled by the project team, not professional catalogers. Inter-annotator agreement will be reported but may not match expert-level consistency.
- The dataset covers four sources. Adding more (Bodleian directly, Heidelberg, POLONA) would increase cross-source overlap and might change the dedup landscape.
- Embedding models were not trained on early modern bibliographic metadata. Domain-adapted models might perform differently.
- We evaluate metadata-only dedup. Content-based methods — comparing actual OCR text from the books — could be more accurate but require processing all 828K manifests, which is impractical at this stage.
- Our Biblissima data lacks title and author for many records (only shelfmarks). These records participate in manifest-URL-based dedup but not in metadata-based methods.

---

## 8. Conclusion

[TODO — pending experimental results]

---

## Appendix A: Preliminary Results

Before the full experimental evaluation, we ran our Jaro-Winkler method (Method 2) on the complete dataset. These preliminary results motivated the paper and informed the gold standard design:

| Metric | Value |
|--------|-------|
| Total records | 827,928 |
| Duplicate clusters found | 73,009 |
| Records in duplicate clusters | 235,789 |
| Estimated unique records | 665,148 |
| Overall reduction | 19.7% |

**Match types:**
| Type | Count |
|------|-------|
| Same-edition copies (within source) | 394,315 |
| Related editions (different year/place) | 343,691 |
| Cross-source same edition | 12,009 |

**Cluster sizes:**
| Size | Clusters |
|------|----------|
| 2 | 42,315 |
| 3 | 14,575 |
| 4 | 6,973 |
| 5 | 3,097 |
| 6–10 | 4,608 |
| 11–20 | 1,059 |
| 21+ | 382 |

The 19.7% reduction is dominated by BSB internal duplicates (135,347 of BSB's 432,113 records were marked as duplicates). Cross-source deduplication accounted for only 12,009 matches — suggesting that cross-source overlap is surprisingly low, at least at the title-string-similarity level. The cross-language duplicates that our method cannot detect (same work cataloged in different languages) remain to be quantified.

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
