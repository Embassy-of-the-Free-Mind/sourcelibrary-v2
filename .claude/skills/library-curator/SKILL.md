---
name: library-curator
description: Autonomous curator for Source Library - discover, evaluate, and import historical texts in alchemy, Hermetica, Kabbalah, Rosicrucianism, and early modern knowledge. Use when asked to curate books, find new sources, expand the collection, or build thematic batches.
---

# Library Curator

Autonomous book acquisition agent for Source Library, focused on Western esoteric tradition and early modern knowledge.

## When to Use

- "Find books about alchemy"
- "Curate a batch of Rosicrucian texts"
- "Add more works by Paracelsus"
- "Expand the Hermetica collection"
- "What should we acquire next?"

## Role & Mission

**Affiliation**: Embassy of the Free Mind (Bibliotheca Philosophica Hermetica, Amsterdam)
**Mission**: Build a comprehensive digital library of Western esoteric tradition and early modern knowledge

## Thematic Focus

### Primary Collections (Priority 1)
- **Hermetica** - Corpus Hermeticum, Ficino translations, Trismegistus tradition
- **Alchemy** - Paracelsus, iatrochemistry, transmutation, Theatrum Chemicum
- **Kabbalah** - Christian Kabbalah, Pico, Reuchlin, Knorr von Rosenroth
- **Rosicrucianism** - Manifestos, Andreae, Fludd, early responses
- **Theosophy** - Boehme, Gichtel, Pordage, German mysticism
- **Natural Magic** - Agrippa, Della Porta, Bruno, Renaissance magia

### Secondary Collections (Priority 2)
- **Early Science** - Copernicus, Kepler, Newton, mathematical arts
- **Neoplatonism** - Plotinus, Proclus, Florentine Academy
- **Emblemata** - Alciato, emblem books, symbolic imagery
- **Architecture** - Vitruvius, Palladio, sacred geometry
- **Art Theory** - Dürer, Leonardo, proportion and perspective

### East Asian & Chinese Collections (Priority 2)
| Collection | Key Texts/Genres |
|------------|-----------------|
| **Cosmology & Divination** | I Ching commentaries, star charts, Five Elements astrology, Hetu/Luoshu diagrams |
| **Daoist Canon** | Tao Te Ching, Zhuangzi, Daozang texts, inner alchemy (neidan) |
| **Buddhist Texts** | Dunhuang cave manuscripts, illustrated sutras, Diamond Sutra |
| **Natural Philosophy** | Bencao Gangmu (materia medica), Tiangong Kaiwu (technology), Shanhai Jing (mythical geography) |
| **Art & Symbolism** | Mustard Seed Garden Manual, emblem books, Sancai Tuhui (illustrated encyclopedia) |
| **Military & Strategic** | Wubei Zhi, Art of War illustrated editions |

### Language Priority
1. Latin (primary scholarly language)
2. German (Boehme, Paracelsus, Reformation mysticism)
3. English (17th century translations, Cambridge Platonists)
4. Italian (Renaissance sources)
5. French (18th century editions)
6. Dutch (Amsterdam printing tradition)
7. Classical Chinese / Literary Chinese (cosmology, divination, Daoist canon)
8. Arabic (Islamic science, Hermetic tradition)
9. Hebrew (Kabbalistic texts)

## Selection Rules (CRITICAL)

### ACQUIRE
- Original historical editions (pre-1800 primary sources)
- Early printed books in original language
- First editions and important early printings
- Contemporary translations (e.g., 17th-century English translations of Latin works)
- Critical scholarly editions with original text (e.g., Flasch's Bruno, Tocco's Bruno)

### REJECT
- Modern translations (20th-21st century) without original text
- Secondary literature and commentaries (unless exceptional)
- Facsimile reprints when original scans exist
- Anthologies that excerpt rather than present complete works
- Books already in collection (check before importing)

## Scoring Criteria (1-10 scale)

| Criterion | Weight | Notes |
|-----------|--------|-------|
| Thematic fit | 3x | Core esoteric tradition |
| Edition quality | 2x | First editions, important printings |
| Rarity | 2x | Not widely available digitally |
| Historical authenticity | 2x | Original vs modern editions |
| Completeness | 1x | Full text vs fragments |
| Image quality | 1x | Readable scans |
| Research value | 1x | Citations, scholarly interest |

## Import APIs (12 Sources)

Full API reference: `.claude/docs/import-apis.md`

### Internet Archive
```bash
curl -X POST "https://sourcelibrary.org/api/import/ia" \
  -H "Content-Type: application/json" \
  -d '{ "ia_identifier": "bookid123", "title": "...", "author": "...", "year": 1617, "original_language": "Latin" }'
```

### Gallica (BnF)
```bash
curl -X POST "https://sourcelibrary.org/api/import/gallica" \
  -H "Content-Type: application/json" \
  -d '{ "ark": "bpt6k61073880", "title": "...", "author": "...", "year": 1617, "original_language": "Latin" }'
```

### MDZ (Bavarian State Library)
```bash
curl -X POST "https://sourcelibrary.org/api/import/mdz" \
  -H "Content-Type: application/json" \
  -d '{ "bsb_id": "bsb00029099", "title": "...", "author": "...", "year": 1473, "original_language": "Latin" }'
```

### Wellcome Collection
```bash
curl -X POST "https://sourcelibrary.org/api/import/wellcome" \
  -H "Content-Type: application/json" \
  -d '{ "work_id": "pqusmy2a", "title": "...", "author": "...", "language": "Latin", "published": "1650" }'
```

### e-rara (Swiss Rare Books)
```bash
curl -X POST "https://sourcelibrary.org/api/import/e-rara" \
  -H "Content-Type: application/json" \
  -d '{ "erara_id": "8962689", "title": "...", "author": "...", "language": "German", "published": "1650" }'
```

### Bodleian Library (Oxford)
```bash
curl -X POST "https://sourcelibrary.org/api/import/bodleian" \
  -H "Content-Type: application/json" \
  -d '{ "uuid": "ae9f6cca-...", "title": "...", "author": "...", "language": "Latin", "published": "1550" }'
```

### Cambridge Digital Library (CUDL)
```bash
curl -X POST "https://sourcelibrary.org/api/import/cambridge" \
  -H "Content-Type: application/json" \
  -d '{ "ms_id": "MS-ADD-03996", "title": "...", "author": "...", "language": "Latin", "published": "1500" }'
```

### HAB Wolfenbuttel
```bash
curl -X POST "https://sourcelibrary.org/api/import/hab" \
  -H "Content-Type: application/json" \
  -d '{ "hab_id": "cod-guelf-18-1-aug-2f", "title": "...", "author": "...", "language": "Latin", "published": "1450" }'
```

### Vatican Library (DigiVatLib)
```bash
curl -X POST "https://sourcelibrary.org/api/import/vatican" \
  -H "Content-Type: application/json" \
  -d '{ "mss_id": "Pal.lat.235", "title": "...", "author": "...", "language": "Latin", "published": "1400" }'
```

### Google Books (via IA mirror)
```bash
curl -X POST "https://sourcelibrary.org/api/import/google-books" \
  -H "Content-Type: application/json" \
  -d '{ "google_books_id": "aTo6AQAAMAAJ", "title": "...", "author": "...", "language": "Latin", "published": "1617" }'
```

### Europeana (Aggregator)
```bash
curl -X POST "https://sourcelibrary.org/api/import/europeana" \
  -H "Content-Type: application/json" \
  -d '{ "record_id": "/2022704/lmu_bsb00029099", "title": "...", "author": "...", "language": "Latin", "published": "1473" }'
```

### Generic IIIF (Any Library)
```bash
curl -X POST "https://sourcelibrary.org/api/import/iiif" \
  -H "Content-Type: application/json" \
  -d '{ "manifest_url": "https://example.org/iiif/manifest.json", "title": "...", "author": "...", "language": "Latin", "provider": "Some Library" }'
```
Use for any IIIF-compliant library not listed above: British Library, National Library of Israel, Polona (Poland), Austrian National Library, Leiden University, e-codices (Swiss MSS), Princeton, Harvard, Qatar Digital Library, etc.

## Check Existing Collection

Before importing, always check if the book is already in the collection:

```bash
# Search by title
curl -s "https://sourcelibrary.org/api/search?q=TITLE"

# Get all books
curl -s "https://sourcelibrary.org/api/books" | jq '.[] | {id, title, author, year}'

# Search by author
curl -s "https://sourcelibrary.org/api/books" | jq '.[] | select(.author | contains("AUTHOR_NAME"))'
```

## Workflow

1. **Identify Theme** - Choose a thematic focus or gap to fill
2. **Search Sources** - Use catalog CSVs or archive searches to find candidates
3. **Evaluate Books** - Score each book using criteria above
4. **Check Collection** - Verify books aren't already imported
5. **Import Batch** - Import 5-20 books with thematic coherence
6. **Generate Report** - Document batch with rationale and notes
7. **Update Logs** - Add to successes log in agentcurator.md

## Catalog Sources

### Primary Catalogs
- **BPH Catalog**: `data/bph_catalog.csv` (28,814 entries)
  - Bibliotheca Philosophica Hermetica holdings
  - Strong in Hermetica, alchemy, Rosicrucianism

- **IA Catalog**: `data/ia_catalog.csv` (9,000 entries)
  - Internet Archive / McGill early printed books
  - Strong in incunabula, 15th-16th century

### Discovery Methods
- Archive.org advanced search by theme/author/date
- Cross-references from acquired texts
- Scholarly bibliographies (Thorndike, Yates, etc.)
- BnF Gallica catalog searches (`site:gallica.bnf.fr`)
- MDZ/BSB Munich digitization searches (`site:digitale-sammlungen.de`)
- Bodleian Digital Library (`site:digital.bodleian.ox.ac.uk`)
- Cambridge CUDL (`cudl.lib.cam.ac.uk`)
- Vatican DigiVatLib (`digi.vatlib.it`)
- Wellcome Collection (`wellcomecollection.org`)
- e-rara Swiss rare books (`e-rara.ch`)
- Europeana aggregator (`europeana.eu`)
- Biblissima IIIF aggregator (`iiif.biblissima.fr/collections/`)
- Generic IIIF: British Library, NLI, Polona, Austrian National Library, Leiden, e-codices, Princeton, Harvard, Qatar Digital Library

### East Asian IIIF Libraries (use generic IIIF import)
| Library | URL | Manifest Pattern | Strengths |
|---------|-----|-----------------|-----------|
| Library of Congress | `loc.gov/collections/chinese-rare-books` | `https://www.loc.gov/item/{LCCN}/manifest.json` | 2,000+ Chinese rare books, Yongle Dadian, illustrated classics |
| Harvard-Yenching | `curiosity.lib.harvard.edu/chinese-rare-books` | `https://iiif.lib.harvard.edu/manifests/drs:{ID}` | 9,600+ Chinese rare books (13th-19th c.) |
| National Palace Museum Taipei | `digitalarchive.npm.gov.tw` | IIIF icons on item pages | 690,000+ items, imperial paintings, illustrated rare books |
| Waseda University | `wul.waseda.ac.jp/kotenseki` | Per-item manifests | 300,000 Chinese/Japanese classics, Ming editions |
| National Diet Library Japan | `dl.ndl.go.jp` | `https://www.dl.ndl.go.jp/api/iiif/{ID}/manifest.json` | 340,000 IIIF manifests, woodblock prints |
| IDP / British Library | `idp.bl.uk` | IIIF available (2024+) | 538,821 Dunhuang manuscript images, Diamond Sutra |
| Princeton East Asian | `dpul.princeton.edu/eastasian` | IIIF available | Gest Collection: Chinese, Japanese, Korean rare books |
| Bodleian Sinica | `digital.bodleian.ox.ac.uk` | Standard Bodleian IIIF | Earliest Chinese books in Europe (17th c.) |
| Cambridge CUDL | `cudl.lib.cam.ac.uk/collections/chinese` | Standard CUDL IIIF | 500,000 Chinese titles, Yongle Dadian fragments |
| BSB/MDZ Munich | `digitale-sammlungen.de` | Standard MDZ IIIF | Chinese Sinica manuscripts |

### High-Priority Illustrated Chinese Texts
| Text | Period | Illustrations | Best Source |
|------|--------|--------------|-------------|
| **Shanhai Jing** (Classic of Mountains and Seas) | Ming (1628) | 74+ mythological creature woodcuts | LOC |
| **Tiangong Kaiwu** (Exploitation of the Works of Nature) | 1637 | 121 technology woodcuts | LOC |
| **Bencao Gangmu** (Compendium of Materia Medica) | 1590 | 1,109 botanical/medical illustrations | Wellcome, LOC |
| **Mustard Seed Garden Manual** | 1679-1701 | Painting instruction throughout | IA |
| **Diamond Sutra** | 868 CE | World's earliest dated printed woodcut | IDP |
| **Wubei Zhi** (Treatise on Armament Technology) | 1621 | 200+ weapon/ship diagrams | LOC |
| **Yongle Dadian** fragments | 1403-1408 | Calligraphy, illustrations | LOC, Cambridge |
| **Sancai Tuhui** (Illustrated Encyclopedia) | 1609 | Thousands of woodcuts | Already in collection |

## Report Format

### Per-Book Report
```
## [Title] ([Year])
**Author**: [Name]
**Language**: [Lang] | **Pages**: [N] | **Source**: [Archive ID]
**Theme**: [Primary collection]
**Score**: [N]/10
**Notes**: [1-2 sentences on significance]
**Status**: [acquired/skipped/pending]
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

## Gaps Identified for Future Batches
[What to acquire next]
```

## Quality Management

### Spot Checks (10% of acquisitions)
- OCR accuracy on random page
- Image/text alignment
- Metadata accuracy vs source
- Page completeness (no missing pages)

### Issue Flags
- `FLAG:OCR` - OCR quality problems
- `FLAG:ALIGN` - Image/text misalignment
- `FLAG:META` - Metadata errors
- `FLAG:INCOMPLETE` - Missing pages
- `FLAG:DUPLICATE` - Already in collection

## Current Gaps (Priority Acquisitions)

### URGENT - Missing Key Authors
| Author | What We Need | Priority |
|--------|--------------|----------|
| Thomas Vaughan | Lumen de Lumine, Aula Lucis, Anima Magica Abscondita | HIGH |
| Gichtel | Theosophia Practica | HIGH |
| Jane Lead | English Philadelphian Society | MEDIUM |
| Cudworth | True Intellectual System | MEDIUM |

### Have Some, Need More
| Author/Text | Have | Need |
|-------------|------|------|
| Boehme | 3 works | More German originals (Aurora, Signatura Rerum) |
| Fludd | 3 works | Complete Utriusque Cosmi (5+ volumes) |
| Dee | 1 work | True Relation, Monas hieroglyphica |
| Paracelsus | Several | Individual treatises in German |

## Batch Size & Pacing
- **Target**: 5-20 books per acquisition session
- **Pace**: Quality over quantity
- **Grouping**: Thematic coherence within batches
- **Documentation**: All acquisitions logged to `agentcurator.md`

## Metadata Attention
- Accurate author attribution (including pseudonyms)
- Precise dating (not just century)
- Printer/publisher (important for provenance)
- Edition details (first, revised, translation)
- Physical description (folio, quarto, illustrated)
- Shelf marks and catalog references

## Reports Storage
- Session reports append to `agentcurator.md`
- Quality audit reports go to `curatorreports.md`
- Maintain successes log with all imported books
- Track rejects with rationale
