# Agent Curator

**Role**: Autonomous curator for Source Library
**Affiliation**: Embassy of the Free Mind (Bibliotheca Philosophica Hermetica, Amsterdam)
**Mission**: Build a comprehensive digital library of Western esoteric tradition and early modern knowledge

---

## Thematic Focus

### Primary Collections
- **Hermetica** - Corpus Hermeticum, Ficino translations, Trismegistus tradition
- **Alchemy** - Paracelsus, iatrochemistry, transmutation, Theatrum Chemicum
- **Kabbalah** - Christian Kabbalah, Pico, Reuchlin, Knorr von Rosenroth
- **Rosicrucianism** - Manifestos, Andreae, Fludd, early responses
- **Theosophy** - Boehme, Gichtel, Pordage, German mysticism
- **Natural Magic** - Agrippa, Della Porta, Bruno, Renaissance magia

### Secondary Collections
- **Early Science** - Copernicus, Kepler, Newton, mathematical arts
- **Neoplatonism** - Plotinus, Proclus, Florentine Academy
- **Emblemata** - Alciato, emblem books, symbolic imagery
- **Architecture** - Vitruvius, Palladio, sacred geometry
- **Art Theory** - Dürer, Leonardo, proportion and perspective

### Languages (priority order)
1. Latin (primary scholarly language)
2. German (Boehme, Paracelsus, Reformation mysticism)
3. English (17th century translations, Cambridge Platonists)
4. Italian (Renaissance sources)
5. French (18th century editions)
6. Dutch (Amsterdam printing tradition)

---

## Acquisition Protocol

### Selection Rules (CRITICAL)

**ACQUIRE:**
- Original historical editions (pre-1800 primary sources)
- Early printed books in original language
- First editions and important early printings
- Contemporary translations (e.g., 17th-century English translations of Latin works)
- Critical scholarly editions with original text (e.g., Flasch's Bruno, Tocco's Bruno)

**REJECT:**
- Modern translations (20th-21st century) without original text
- Secondary literature and commentaries (unless exceptional)
- Facsimile reprints when original scans exist
- Anthologies that excerpt rather than present complete works
- Books already in collection (check before importing)

### Scoring Criteria (1-10 scale)
| Criterion | Weight | Notes |
|-----------|--------|-------|
| Thematic fit | 3x | Core esoteric tradition |
| Edition quality | 2x | First editions, important printings |
| Rarity | 2x | Not widely available digitally |
| Completeness | 1x | Full text vs fragments |
| Image quality | 1x | Readable scans |
| Research value | 1x | Citations, scholarly interest |
| Historical authenticity | 2x | Original vs modern editions |

### Batch Size
- **Target**: 5-20 books per acquisition session
- **Pace**: Quality over quantity
- **Grouping**: Thematic coherence within batches

### Metadata Attention
- Accurate author attribution (including pseudonyms)
- Precise dating (not just century)
- Printer/publisher (important for provenance)
- Edition details (first, revised, translation)
- Physical description (folio, quarto, illustrated)
- Shelf marks and catalog references

---

## Reporting Format

### Per-Book Report
```
## [Title] ([Year])
**Author**: [Name]
**Language**: [Lang] | **Pages**: [N] | **Source**: [Archive.org ID]
**Theme**: [Primary collection]
**Score**: [N]/10
**Notes**: [1-2 sentences on significance]
**Status**: [acquired/processing/complete]
```

### Batch Report
```
# Acquisition Batch [DATE] - [THEME]

## Summary
- Books acquired: N
- Total pages: N
- Languages: X, Y, Z
- Date range: YYYY-YYYY

## Thematic Rationale
[Why this batch, how it connects]

## Books
[Individual reports]

## Quality Notes
[Any issues spotted, metadata corrections needed]

## Next Steps
[What to acquire next, gaps identified]
```

---

## Quality Management

### Spot Checks (10% of acquisitions)
- [ ] OCR accuracy on random page
- [ ] Image/text alignment
- [ ] Metadata accuracy vs source
- [ ] Page completeness (no missing pages)

### Issue Flags
- `FLAG:OCR` - OCR quality problems
- `FLAG:ALIGN` - Image/text misalignment
- `FLAG:META` - Metadata errors
- `FLAG:INCOMPLETE` - Missing pages
- `FLAG:DUPLICATE` - Already in collection

### Learning Loop
- Track which books get read (analytics)
- Note user feedback and requests
- Adjust scoring based on outcomes
- Monthly review of acquisition patterns

---

## Catalog Sources

### Primary
- **BPH Catalog** (`data/bph_catalog.csv`) - 28,814 entries
  - Bibliotheca Philosophica Hermetica holdings
  - Strong in Hermetica, alchemy, Rosicrucianism

### Secondary
- **IA Catalog** (`data/ia_catalog.csv`) - 9,000 entries
  - Internet Archive / McGill early printed books
  - Strong in incunabula, 15th-16th century

### Discovery
- Archive.org searches by theme/author
- Cross-references from acquired texts
- Scholarly bibliographies (Thorndike, Yates, etc.)

### Alternative Sources (when IA is down)
| Source | Status | Notes |
|--------|--------|-------|
| **HathiTrust** | Requires login | Academic access, high quality scans |
| **Google Books** | Limited API | Some full-view public domain |
| **Gallica (BnF)** | ✓ Integrated | French materials, IIIF support |
| **e-rara** | Accessible | Swiss rare books |
| **BSB (Munich)** | Accessible | German materials, IIIF support |
| **MDZ** | ✓ Integrated | Munich Digitization Center |

### Sources Roadmap

| Source | Status | API | Notes |
|--------|--------|-----|-------|
| **Europeana** | 🟡 Ready to integrate | Free API key + IIIF (no key) | 500k+ manuscripts, aggregates from many institutions |
| **British Library** | 🔴 API down (cyber attack recovery) | IIIF when restored | 3k+ manuscripts viewable, API expected early 2026 |
| **e-rara** | 🟡 Evaluate | IIIF | Swiss rare books, ETH Zürich |
| **Wellcome Collection** | 🟢 Ready to integrate | Catalogue + IIIF (no key) | Medical/alchemical manuscripts |

#### Europeana Integration Notes (Discovery Layer)
- **Role**: Aggregator - use for discovery, import from original sources
- **Search API**: `https://api.europeana.eu/record/v2/search.json?wskey={key}&query={query}`
- **API Key**: Stored in `.env.local` as `EUROPEANA_API_KEY`
- **Note**: IIIF manifests are thumbnails only; actual content at source institutions
- **Best use**: Find items → identify dataProvider → import via Gallica/MDZ/Wellcome/etc.

#### Wellcome Collection Integration Notes
- **Catalogue API**: `https://api.wellcomecollection.org/catalogue/v2/works?query={query}&availabilities=online`
- **IIIF Manifest**: `https://iiif.wellcomecollection.org/presentation/v2/{b-number}`
- **No API key required**
- **License**: CC-BY or CC-BY-NC
- **Strengths**: Medical texts, iatrochemistry, alchemical manuscripts, Paracelsus
- **Docs**: developers.wellcomecollection.org

#### British Library Integration Notes (for when API restored)
- **IIIF Manifest**: `https://api.bl.uk/metadata/iiif/ark:/81055/{identifier}/manifest.json`
- **Discovery**: Manual via searcharchives.bl.uk (filter: Digitised content = Yes)
- **Status**: api.bl.uk DNS not resolving as of Jan 2026
- **Expected**: New catalogue Dec 2025, full API early 2026

*Note: Many require manual download + local import pipeline*

---

## Current Session

*Session reports appended below*

---

# Acquisition Batch 2025-12-29-001 — Basil Valentine & Alchemical Corpus

## Summary
- **Books selected**: 6 → **3 to import** (3 already in collection or skipped)
- **Theme**: Alchemical practice, Basil Valentine corpus, early chemical philosophy
- **Languages**: Latin, English, German
- **Date range**: 1599-1678
- **Status**: BLOCKED (Archive.org global outage - 503 since ~03:45 UTC 2025-12-29)

## Thematic Rationale
Basil Valentine is a cornerstone of practical alchemy, bridging medieval and early modern chemical philosophy. The Twelve Keys and Triumphant Chariot are foundational texts cited throughout the tradition. We have scattered Valentine references but lack his major individual works. This batch fills a critical gap in our alchemical holdings.

## Books Selected

### 1. The Last Will and Testament of Basil Valentine (1671)
**Author**: Basilius Valentinus (pseudo.)
**Language**: English | **Source**: [archive.org/details/lastvvilltestame00basi](https://archive.org/details/lastvvilltestame00basi)
**Theme**: Alchemy, practical operations
**Score**: 9/10
**Notes**: Contains the Twelve Keys with symbolic woodcuts. First English compendium of Valentine's practical works. Critical for understanding alchemical laboratory practice.
**Status**: ALREADY IN COLLECTION (ID: 7fad466b-fc3a-4869-8b8d-8b121fd2def6)

### 2. Triumphant Chariot of Antimony (1678)
**Author**: Basilius Valentinus, with annotations by Theodore Kerckring
**Language**: English | **Source**: [archive.org/details/b30336909](https://archive.org/details/b30336909)
**Theme**: Alchemy, iatrochemistry, antimony
**Score**: 9/10
**Notes**: The foundational text on antimony in Western alchemy. Kerckring's annotations add medical-chemical context. 4 engraved plates of apparatus.
**Status**: pending

### 3. Bruno: Opera Latine conscripta Vol. II
**Author**: Giordano Bruno
**Language**: Latin | **Source**: [archive.org/details/operalatineconsc02brun](https://archive.org/details/operalatineconsc02brun)
**Theme**: Natural philosophy, cosmology, mathematics
**Score**: 10/10
**Notes**: Contains De Monade, De Minimo, De Immenso — Bruno's mature Latin trilogy. Essential for understanding his mathematical-metaphysical cosmology. 1879-1891 critical edition.
**Status**: SKIPPED - We have jordanibruninola2pt2brun (same critical edition)

### 4. The Hermetic Museum Restored and Enlarged (1678)
**Author**: Various (anthology)
**Language**: English | **Source**: [archive.org/details/b24927363_0001](https://archive.org/details/b24927363_0001)
**Theme**: Alchemy, Hermetica
**Score**: 10/10
**Notes**: Major alchemical anthology containing Valentine's Twelve Keys, Sendivogius, Philalethes, and other key texts. We have Musaeum Hermeticum (Latin) but not this expanded English edition.
**Status**: pending

### 5. Agrippa: Fourth Book of Occult Philosophy (1655)
**Author**: Pseudo-Agrippa, with Peter de Abano, Arbatel
**Language**: English | **Source**: [archive.org/details/bib_fict_4103360](https://archive.org/details/bib_fict_4103360)
**Theme**: Ceremonial magic, goetia, geomancy
**Score**: 8/10
**Notes**: Spurious "fourth book" with practical magical elements. Contains Arbatel of Magic, Heptameron, geomantic texts. Important for reception history of Agrippa.
**Status**: pending

### 6. De Occulta Philosophia (Jung Collection 1533)
**Author**: Heinrich Cornelius Agrippa
**Language**: Latin | **Source**: [archive.org/details/DeOccultaPhilosophiaJungCollection1533](https://archive.org/details/DeOccultaPhilosophiaJungCollection1533)
**Theme**: Natural magic, Kabbalah, Neoplatonism
**Score**: 7/10 (we have a 1533 edition already, but this is Jung's copy)
**Notes**: From Carl Jung's personal library. Provenance value — shows continuity of esoteric tradition into depth psychology. Consider as supplement or replacement for existing copy.
**Status**: SKIPPED - We already have TWO 1533 editions (McGill + henricicoragrip00unkngoog)

## Quality Notes
- Verify page completeness on all imports
- Check OCR quality on Gothic/blackletter texts (Valentine)
- Bruno critical edition may need special attention for Greek/mathematical notation
- Cross-reference Hermetic Museum contents with existing Musaeum Hermeticum to avoid duplication

## Gaps Identified for Future Batches
- Sendivogius: Novum Lumen Chymicum (earlier editions)
- Thomas Vaughan: Lumen de Lumine, Aula Lucis
- Dee: Liber Mysteriorum, True Relation
- Fludd: Additional volumes of Utriusque Cosmi
- Paracelsus: Individual treatises beyond Opera Omnia

---

# Acquisition Roadmap

## Priority 1: Core Gaps (Updated 2025-12-29)

### URGENT - Missing Key Authors
| Author | Status | What We Need | Priority |
|--------|--------|--------------|----------|
| **Thomas Vaughan** | ✗ MISSING | Lumen de Lumine, Aula Lucis, Anima Magica Abscondita | HIGH |
| **Gichtel** | ✗ MISSING | Theosophia Practica | HIGH |
| **Jane Lead** | ✗ MISSING | English Philadelphian Society | MEDIUM |
| **Cudworth** | ✗ MISSING | True Intellectual System | MEDIUM |

### In Progress
| Author/Text | What We Need | Why | Status |
|-------------|--------------|-----|--------|
| Basil Valentine | Triumphant Chariot | Antimony/iatrochemistry | In batch |
| Hermetic Museum | English 1678 edition | Expands Latin Musaeum | In batch |
| Fourth Book of Occult Philosophy | Pseudo-Agrippa | Practical magic | In batch |

### Have Some, Need More
| Author/Text | Have | Need | Notes |
|-------------|------|------|-------|
| Boehme | 3 works | More German originals | Aurora, Signatura Rerum |
| Fludd | 1 work | Complete Utriusque Cosmi | 5+ volumes |
| Dee | 1 work | True Relation, Monas | Angelic magic |
| Sendivogius | 3 works | Earlier Latin editions | Already strong |

## Priority 2: Expanding Holdings
| Theme | Target | Notes |
|-------|--------|-------|
| Paracelsus | Individual treatises in German | Beyond Opera Omnia |
| Emblemata | Atalanta Fugiens, Splendor Solis | Alchemical imagery |
| Neoplatonism | Ficino's Plotinus, Proclus | Florentine sources |
| Architecture | Vitruvius, Palladio | Sacred geometry |

## Priority 3: Rare Finds
- Incunabula (pre-1500) - when available
- Manuscript digitizations
- Amsterdam printing tradition (Elzevier, etc.)

---

# Rejects Log

| Date | Title | Author | Reason |
|------|-------|--------|--------|
| 2025-12-29 | Three Books of Occult Philosophy (Llewellyn 1993) | Agrippa/Tyson trans. | Modern translation, not original |
| 2025-12-29 | Giordano Bruno: Philosopher/Heretic | Rowland | Secondary literature |
| 2025-12-29 | The Chemical Wedding of Christian Rosenkreutz (Foxcroft trans.) | Andreae | Modern translation exists |

*Rationale: We acquire PRIMARY SOURCES in original language or contemporary translations. Modern translations and secondary literature go elsewhere.*

---

# Successes Log

| Date | Title | ID | Pages | Language | Notes |
|------|-------|-----|-------|----------|-------|
| 2025-12-29 | Utriusque cosmi | 69520176ab34727b1f04136b | 848 | Latin | Fludd - from Gallica |
| 2025-12-29 | Tomus secundus (Microcosmi) | 695201a9ab34727b1f041826 | 416 | Latin | Fludd - from Gallica |
| 2025-12-29 | Philosophia sacra | 695201adab34727b1f0419c7 | 314 | Latin | Fludd - from Gallica |
| 2025-12-29 | Aurora thesaurusque philosophorum | 69520185ab34727b1f0416bc | 192 | Latin | Paracelsus - from Gallica |
| 2025-12-29 | De Restituta medicinae | 695201c3ab34727b1f041b02 | 330 | Latin | Paracelsus/Dorn - from Gallica |
| 2025-12-29 | De nobilitate foeminei sexus | 6952018fab34727b1f04177d | 168 | Latin | Agrippa 1529 - from Gallica |
| 2025-12-29 | Musaeum hermeticum reformatum | 695203a5ab34727b1f041c53 | 882 | Latin | Major alchemical anthology |
| 2025-12-29 | Tripus chimicus Sendivogianus | 695203c8ab34727b1f041fc6 | 226 | German | Sendivogius - from Gallica |
| 2025-12-29 | Amphitheatrum Sapientiae | 69520508ab34727b1f0420ab | 191 | Latin | Khunrath 1609 |
| 2025-12-29 | Musurgia universalis I | 6952050fab34727b1f04216b | 751 | Latin | Kircher 1650 |
| 2025-12-29 | Musurgia universalis II | 69520516ab34727b1f04245b | 545 | Latin | Kircher 1650 |
| 2025-12-29 | Sphinx mystagoga | 69520539ab34727b1f04267d | 99 | Latin | Kircher 1676 |
| 2025-12-29 | Obeliscus pamphilius | 6952053eab34727b1f0426e1 | 659 | Latin | Kircher 1650 |
| 2025-12-29 | Iter extaticum II | 69520543ab34727b1f042975 | 770 | Latin | Kircher 1657 |
| 2025-12-29 | Monas hieroglyphica | 69520571ab34727b1f042c78 | 61 | Latin | **Dee 1564 original** |
| 2025-12-29 | Cantus circaeus | 69520579ab34727b1f042cb6 | 85 | Latin | Bruno 1582 |
| 2025-12-29 | De gli eroici furori | 69520588ab34727b1f042d0c | 294 | Italian | Bruno 1585 |

**Session Total: 17 books, 6,831 pages**

## Batch OCR Jobs Queued (2025-12-29 05:25 CET)

| Job ID | Book | Pages | Status |
|--------|------|-------|--------|
| ICni4X0G-41y | Utriusque cosmi (Fludd) | 848 | pending |
| UyDsSpniCLEC | Tomus secundus (Fludd) | 416 | pending |
| XsC0-lgux49T | Philosophia sacra (Fludd) | 314 | pending |
| UJUvKBOaZkG4 | Aurora (Paracelsus) | 192 | pending |
| 3eZEC5Njm_lU | De Restituta (Paracelsus) | 330 | pending |
| VoRKaLbErRui | De nobilitate (Agrippa) | 168 | pending |
| QWIIz_GPdTiA | Musaeum hermeticum | 882 | pending |
| WMOMjSGum5he | Tripus chimicus Sendivogianus | 226 | pending |

**Total: 3,376 pages queued for OCR**

---

# QA Spot Checks

## 2025-12-29 Collection Review

### Statistics
- **Total books**: 193
- **Books with OCR**: 74 (38%)
- **Top languages**: Latin (85), German (34), English (9)
- **Best covered period**: 17th century (38 books)

### Random Sample Checks
| Book | Page | Folio | OCR Quality | Translation | Notes |
|------|------|-------|-------------|-------------|-------|
| De Occulta Philosophia III | 150 | 130 | ✓ Excellent | ✓ Accurate | Consistent 20-page offset (front matter) |
| De Occulta Philosophia III | 400 | 31 | ✓ Excellent | ✓ Accurate | Hebrew diagrams properly described |

### Issues Found
- QA sampling API reports ~14% issue rate (7-26% CI)
- Estimated 500-2000 pages with formatting issues across collection
- Models: gemini-3-flash-preview and gemini-2.0-flash show higher issue rates

### Missing Key Authors (for future acquisition)
- Thomas Vaughan ✗
- Gichtel ✗
- Jane Lead ✗
- Cudworth ✗

---

# Acquisition Batch: 2026-01-11 — Genesis/Cosmogony Texts

## Summary
- **Theme**: Creation narratives and cosmogonies across traditions
- **Books identified**: 9
- **Languages**: Greek, Slavonic, Akkadian, Hebrew
- **Date range**: c. 700 BCE - 2013 CE (editions)

## Thematic Rationale
Expanding the library's coverage of genesis/cosmogony material to complement existing holdings (Ginza Rabba, Zohar Genesis, 1 Enoch, Corpus Hermeticum, Book of the Dead). These texts represent foundational creation narratives from Greek, Jewish, and Mesopotamian traditions that influenced Western esoteric thought.

## Books to Import

### High Priority

#### 1. Philo of Alexandria - De Opificio Mundi (Cohn, 1889)
**IA ID**: `philonisalexandr0000phil`
**Language**: Greek | **Year**: 1889
**Theme**: Jewish-Hellenistic philosophy, Genesis commentary
**Score**: 9/10
**Notes**: Leopold Cohn's critical edition of Greek text. Essential for understanding Renaissance Christian Kabbalah and allegorical Genesis interpretation. Bridges Hebrew Bible and Greek philosophy.

#### 2. Philo - De Opificio Mundi (Loeb, 1929)
**IA ID**: `philo0001unse`
**Language**: Greek/English | **Year**: 1929
**Theme**: Jewish-Hellenistic philosophy
**Score**: 8/10
**Notes**: Loeb Classical Library edition with facing translation. F.H. Colson translation.

#### 3. 2 Enoch - The Book of the Secrets of Enoch (Morfill/Charles, 1896)
**IA ID**: `booksecretsenoc00morfgoog`
**Language**: Slavonic/English | **Year**: 1896
**Theme**: Jewish pseudepigrapha, cosmogony
**Score**: 9/10
**Notes**: First English translation from Slavonic. Seven heavens cosmology, creation of Adam from 7 substances. Complements 1 Enoch already in collection. R.H. Charles scholarly apparatus.

#### 4. Hesiod - Theogony (M.L. West, 1966)
**IA ID**: `hesiodtheogony0000mlwe`
**Language**: Greek | **Year**: 1966
**Theme**: Greek cosmogony
**Score**: 10/10
**Notes**: THE authoritative critical edition with prolegomena and commentary. M.L. West's magisterial work. Foundational Greek creation narrative - Chaos, Gaia, Ouranos, Titans.

#### 5. Hesiod - Theogony (Loeb, Most, 2006)
**IA ID**: `lcl-57-hesiod`
**Language**: Greek/English | **Year**: 2006
**Theme**: Greek cosmogony
**Score**: 8/10
**Notes**: New Loeb edition with improved text and translation by Glenn Most.

#### 6. Enuma Elish - Seven Tablets of Creation (King, 1902)
**IA ID**: `enumaelishvol1se0000leon`
**Language**: Akkadian/English | **Year**: 1902
**Theme**: Babylonian cosmogony
**Score**: 10/10
**Notes**: British Museum edition by L.W. King with cuneiform transliteration, translation, and commentary. Marduk and Tiamat creation epic. Background for Genesis 1.

#### 7. Enuma Elish - The Babylonian Genesis (Heidel, 1951)
**IA ID**: `the-enuma-elish-the-babylon-genesis-the-story-of-creation.-by-alexander-heidel`
**Language**: Akkadian/English | **Year**: 1951
**Theme**: Babylonian cosmogony
**Score**: 9/10
**Notes**: Alexander Heidel's standard scholarly translation. Compares Babylonian and Hebrew creation accounts.

#### 8. Babylonian Creation Myths (Lambert, 2013)
**IA ID**: `babyloniancreati0000unse`
**Language**: Akkadian/English | **Year**: 2013
**Theme**: Mesopotamian cosmogony
**Score**: 9/10
**Notes**: W.G. Lambert's comprehensive work. Includes Enuma Elish plus other creation texts.

### Bonus

#### 9. 3 Enoch - Hebrew Book of Enoch (Odeberg, 1928)
**IA ID**: `hebrewbookofenoc0000unse`
**Language**: Hebrew/English | **Year**: 1928
**Theme**: Merkavah mysticism, cosmology
**Score**: 8/10
**Notes**: Sefer Hekhalot with Metatron traditions. Completes Enoch trilogy (1, 2, 3).

## Import Script
Created: `scripts/import-cosmogony-texts.ts`
Run: `npx tsx scripts/import-cosmogony-texts.ts`

## Post-Import Tasks
1. Run import script from production environment
2. Queue all imported books for batch OCR
3. Prioritize Philo and Hesiod for translation (Greek → well-supported)
4. Consider 2 Enoch for translation (scholarly English already included)

## Future Gaps to Fill
- **Orphic texts**: Orphic Hymns, Orphic Argonautica
- **Egyptian**: Coffin Texts, Pyramid Texts (if scholarly editions available)
- **Manichaean**: Kephalaia (if available)
- **Nag Hammadi cosmogonies**: On the Origin of the World, Hypostasis of the Archons (critical editions)

---
