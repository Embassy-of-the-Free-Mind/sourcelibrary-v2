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

### Scoring Criteria (1-10 scale)
| Criterion | Weight | Notes |
|-----------|--------|-------|
| Thematic fit | 3x | Core esoteric tradition |
| Edition quality | 2x | First editions, important printings |
| Rarity | 2x | Not widely available digitally |
| Completeness | 1x | Full text vs fragments |
| Image quality | 1x | Readable scans |
| Research value | 1x | Citations, scholarly interest |

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

---

## Current Session

*Session reports appended below*

---

# Acquisition Batch 2025-12-29-001 — Basil Valentine & Alchemical Corpus

## Summary
- **Books selected**: 6
- **Theme**: Alchemical practice, Basil Valentine corpus, early chemical philosophy
- **Languages**: Latin, English, German
- **Date range**: 1599-1678
- **Status**: PENDING IMPORT

## Thematic Rationale
Basil Valentine is a cornerstone of practical alchemy, bridging medieval and early modern chemical philosophy. The Twelve Keys and Triumphant Chariot are foundational texts cited throughout the tradition. We have scattered Valentine references but lack his major individual works. This batch fills a critical gap in our alchemical holdings.

## Books Selected

### 1. The Last Will and Testament of Basil Valentine (1671)
**Author**: Basilius Valentinus (pseudo.)
**Language**: English | **Source**: [archive.org/details/lastvvilltestame00basi](https://archive.org/details/lastvvilltestame00basi)
**Theme**: Alchemy, practical operations
**Score**: 9/10
**Notes**: Contains the Twelve Keys with symbolic woodcuts. First English compendium of Valentine's practical works. Critical for understanding alchemical laboratory practice.
**Status**: pending

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
**Status**: pending

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
**Status**: pending

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
