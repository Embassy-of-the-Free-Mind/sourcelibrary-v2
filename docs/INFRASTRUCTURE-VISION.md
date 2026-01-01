# Source Library: Infrastructure for Digital Esoteric Studies

## The Problem

Early modern esoteric texts - alchemy, Hermeticism, Kabbalah, natural philosophy - are:

- **Physically rare** - scattered across libraries, expensive to access
- **Linguistically inaccessible** - Latin, early German, technical vocabulary
- **Visually rich but uncatalogued** - emblems and diagrams are unstudied
- **Disconnected** - same concepts appear across texts but aren't linked
- **Uncitable** - no stable way to reference specific passages or images
- **Static** - no mechanism for scholarly knowledge to accumulate

Scholars work in isolation. Knowledge doesn't compound. Each researcher starts from scratch.

---

## The Vision

**Source Library is infrastructure for the digital study of early modern esoteric texts.**

Not a website. Not a digital library. **Infrastructure** - the substrate on which scholarship happens.

Everything in the system is:

| Principle | Meaning |
|-----------|---------|
| **Accessible** | Free, open, no paywalls, no gatekeepers |
| **Readable** | OCR'd, transcribed, translated, modernized |
| **Citable** | Stable URIs, DOIs, proper bibliographic apparatus |
| **Searchable** | Full text, concepts, symbols, people, places |
| **Connected** | Linked to encyclopedia, cross-referenced across corpus |
| **Annotatable** | Community knowledge accumulates in layers |
| **Interoperable** | Standard formats for other tools and projects |

---

## The Knowledge Graph

Six entity types. Everything connected.

```
                            ┌─────────────┐
                            │ ENCYCLOPEDIA│
                            │   ENTRY     │
                            │             │
                            │ "Green Lion"│
                            │ "Paracelsus"│
                            │ "Athanor"   │
                            └──────┬──────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
             ┌──────────┐   ┌──────────┐   ┌──────────┐
             │  IMAGE   │   │ PASSAGE  │   │  SYMBOL  │
             │          │   │          │   │          │
             │ Emblem 21│   │ "Take the│   │ Ouroboros│
             │ from AF  │   │  green..." │  │ Iconclass│
             └────┬─────┘   └────┬─────┘   └────┬─────┘
                  │              │              │
                  │              │              │
                  ▼              ▼              │
             ┌──────────┐   ┌──────────┐       │
             │   PAGE   │   │   PAGE   │       │
             │          │◄──┤          │       │
             │  p. 87   │   │  p. 23   │       │
             └────┬─────┘   └────┬─────┘       │
                  │              │              │
                  └──────┬───────┘              │
                         │                      │
                         ▼                      │
                  ┌──────────┐                  │
                  │   BOOK   │◄─────────────────┘
                  │          │
                  │ Atalanta │
                  │ Fugiens  │
                  └────┬─────┘
                       │
                       ▼
                ┌────────────┐
                │ ANNOTATION │
                │            │
                │ Scholar    │
                │ commentary │
                └────────────┘
```

### Connections

- **Book → Pages** - physical structure
- **Page → Passages** - citable text units
- **Page → Images** - visual content
- **Passage → Encyclopedia** - concepts mentioned link to definitions
- **Image → Symbols** - iconographic elements tagged
- **Symbol → Encyclopedia** - symbols have encyclopedia entries
- **Image → Passages** - "read in context" links
- **Encyclopedia → Encyclopedia** - related concepts
- **Annotation → anything** - community knowledge attaches everywhere

---

## Entity Design

### Book
```
- Stable ID, DOI
- Full bibliographic metadata
- Source institution, digitization provenance
- Pages as ordered children
- Computed: translation %, image count, annotation count
```

### Page
```
- Stable ID (book_id + page_number)
- Original scan URL
- OCR text (original language)
- Translation text
- Detected images with bounding boxes
```

### Passage
```
- Stable ID (page_id + character offsets)
- Citable URI: /book/{id}/passage/{start}-{end}
- Extracted text
- Auto-linked terms (encyclopedia connections)
- Annotation count
```

### Image
```
- Stable ID
- Bounding box or full page
- High-res cropped version
- Structured metadata:
  - Type (emblem, woodcut, diagram, portrait)
  - Symbols depicted (tagged vocabulary)
  - Figures present
  - Concepts represented
- Encyclopedia links
- Iconclass codes (interoperability)
- Citation apparatus
```

### Encyclopedia Entry
```
- Stable ID, slug
- Canonical name + aliases
- Type (concept, person, place, symbol, work, substance)
- Definition (brief + extended)
- Primary source citations
- External links (Wikidata, VIAF, Iconclass)
- Related entries
- Computed: appearance count across corpus
```

### Symbol
```
- Vocabulary of iconographic elements
- Linked to encyclopedia entries
- Enables visual search across corpus
- Iconclass mapping for interoperability
```

### Annotation
```
- Attaches to: passage, image, encyclopedia entry, image region
- Types: context, correction, interpretation, question, reference
- Attribution to user
- Threading (replies)
- Community voting
- Moderation status
```

---

## What This Enables

### For Scholars

**Research queries that become possible:**

- "Show me every appearance of the green lion across all texts"
- "Which books discuss solve et coagula, and what do they say?"
- "Compare how Maier and Khunrath depict the philosopher's stone"
- "What did 17th century alchemists mean by 'mercury'?"
- "Find all images featuring both sun and moon symbolism"
- "Who referenced Hermes Trismegistus most frequently?"

**Workflows that become possible:**

- Search → Read → Annotate → Cite (with DOI)
- Visual browse → Find image → Read context → Fall into text
- Encyclopedia lookup → See all primary source mentions
- Compare passages across translations/editions

### For the Public

- Accessible entry point to esoteric literature
- Visual discovery (the images are stunning)
- Encyclopedia explains obscure concepts
- Translations make texts readable
- Community annotations provide context

### For the Field

- Stable citations that other scholars can reference
- DOIs that enter the scholarly record
- API for computational analysis
- Data exports for other projects
- IIIF manifests for image interoperability
- Linked open data connections

---

## Technical Infrastructure

### Identifiers

Every entity gets a **stable URI**:

```
/book/6909abc123                    → Book
/book/6909abc123/page/42            → Page
/book/6909abc123/passage/1234-1567  → Passage
/gallery/image/img_xyz789           → Image
/encyclopedia/green-lion            → Encyclopedia entry
/symbol/ouroboros                   → Symbol
```

Books get DOIs via Zenodo. Images inherit book DOI + fragment.

### Search

Unified search across all content types:

```
GET /api/search?q=green+lion&type=all

Returns:
- Encyclopedia entries matching "green lion"
- Passages containing "green lion"
- Images tagged with green-lion symbol
- Books with "green lion" in title/description
- Annotations mentioning "green lion"
```

Faceted filtering by type, date range, book, symbol, etc.

### API

Programmatic access for scholars and tools:

```
GET /api/books                      → List books
GET /api/books/{id}                 → Book with pages
GET /api/books/{id}/passages        → Citable passages
GET /api/images?symbol=green-lion   → Images by symbol
GET /api/encyclopedia/{slug}        → Entry with appearances
GET /api/search?q=...               → Unified search
```

Rate limiting, API keys for heavy users, usage analytics.

### Interoperability

**IIIF** - Image manifests for viewers and tools
**TEI** - Text export for digital humanities tools
**JSON-LD** - Linked data for knowledge graphs
**Zotero** - Bibliography export
**Iconclass** - Art historical classification

---

## Growth Model

### Content Flywheel

```
More books digitized
       ↓
More searchable content
       ↓
More scholars find it useful
       ↓
More annotations added
       ↓
More valuable as resource
       ↓
More citations in papers
       ↓
More visibility
       ↓
More contributions
       ↓
(cycle continues)
```

### Network Effects

- Each annotation makes the text more valuable
- Each encyclopedia entry helps explain passages
- Each symbol tagged makes images more findable
- Each cross-reference strengthens the graph
- Knowledge compounds over reading cycles

---

## What We're Building

Not a digital library (static container of scans).
Not a database (structured but disconnected).
Not a wiki (collaborative but unstructured).

**A knowledge infrastructure** where:

1. Primary sources are accessible and readable
2. Everything is citable with stable identifiers
3. Content is richly interconnected
4. Community knowledge accumulates in layers
5. The whole is greater than the sum of parts

The **digital noesis** - a living, growing, interconnected understanding of early modern esoteric thought, built on primary sources, enhanced by scholarship, accessible to all.

---

## Immediate Priorities

### Already Built
- [x] Book digitization pipeline (OCR, translation)
- [x] Reading experience with highlights
- [x] Encyclopedia with primary source links
- [x] Annotation system (text-level)
- [x] Image detection and bounding boxes
- [x] DOI minting for editions

### Next Layer
- [ ] Passage-level citation (stable URIs for text ranges)
- [ ] Symbol vocabulary and image tagging
- [ ] Gallery as visual discovery (not cleanup tool)
- [ ] Image-level annotations
- [ ] Unified search across all entity types
- [ ] Cross-reference engine (auto-link terms to encyclopedia)

### Future
- [ ] IIIF manifest generation
- [ ] Public API with documentation
- [ ] Linked open data export
- [ ] Computational analysis tools
- [ ] Multi-edition comparison
- [ ] Collaborative translation workflow
