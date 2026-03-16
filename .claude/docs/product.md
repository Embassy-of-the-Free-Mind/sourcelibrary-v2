# Source Library — Product Map & Terminology

This document defines the canonical names for every surface, concept, and data entity in Source Library. Use these terms consistently in code, comments, UI copy, and conversation.

---

## Terminology Glossary

### Core Data Entities

| Term | Definition | DB field(s) |
|------|-----------|------------|
| **Book** | A single digitized historical text, the primary unit of the library | `books` collection |
| **Page** | One leaf of a book — contains a Page Scan, optional Transcription, optional Translation | `pages` collection |
| **Cover Image** | The thumbnail representing a book across all surfaces | `book.thumbnail` |
| **Transcription** | AI-extracted text from a Page Scan (raw OCR output, may be in original language) | `page.ocr.data` |
| **Translation** | English rendering of the Transcription, or modernized Early Modern English | `page.translation.data` |
| **Transliteration** | Romanized version of non-Latin script text (Greek, Hebrew, Arabic, etc.) | `page.transliteration.data` |
| **Illustration** | A single detected artwork on a page — has bounding box, description, quality score | `page.detected_images[]` |
| **Page Scan** | The raw photograph of a physical page | `page.archived_photo` / `page.photo_original` |
| **Collection** | A curated thematic group of books (e.g. "Alchemy", "Natural Philosophy") | `collections` collection |
| **Edition** | A versioned, citable scholarly publication of a book's translation with DOI | `editions` collection |
| **Book Index** | AI-generated index of people, places, concepts, and key terms across the book | `book.index` |
| **Table of Contents** | Chapter/section structure extracted from the book, with page links | `book.chapters` |
| **Bookmark** | A book the user has saved to their reading list | localStorage `sl_bookshelf_cache` |
| **Favorite** | A liked book, page, or illustration | `likes` collection |
| **Entity** | A person, place, or concept that appears across multiple books | `entities` collection |

### UI Surfaces

| Term | URL | Definition |
|------|-----|-----------|
| **Library** | `/` | The homepage — book grid with featured collections and search |
| **Book Card** | — | The tile representing a book in any grid or list view |
| **Book Detail Page** | `/book/[id]` | The primary page for a single book: header, metadata, page grid, index, history |
| **Book Header** | — | The dark gradient section at the top of the Book Detail Page showing title, author, cover, and stats |
| **Page Reader** | `/book/[id]/page/[pageId]` | Full-page reading view showing Page Scan alongside Transcription and Translation |
| **Gallery** | `/gallery` | Grid of high-quality Illustrations extracted from across the library |
| **Illustration Page** | `/gallery/image/[id]` | Detail view for a single Illustration with metadata, book context, and crop |
| **Collections Page** | `/collections` | Browse all named Collections |
| **Encyclopedia** | `/encyclopedia` | Cross-book index of Entities (people, places, concepts) |
| **Encyclopedia Entry** | `/encyclopedia/[name]` | Detail page for a single Entity with description and source books |
| **Timeline** | `/timeline` | Chronological browse of the library by decade |
| **Explore** | `/explore` | Interactive visualizations — entity heatmaps, maps, and charts |
| **Book Atlas** | `/explore/atlas` or `/research/atlas` | 3D scatter plot of books by topic, time, and language |
| **Map** | `/explore/map` | Geographic visualization of book origins and entities |
| **Search** | `/search` | Full-text and index search across books and page content |
| **Favorites** | `/favorites` | User's liked books, pages, and illustrations |
| **Bookshelf** | `/bookshelf` | User's reading list (currently reading, want to read, completed) |
| **SHWEP Reading Room** | `/shwep` | Primary sources indexed to episodes of the Secret History of Western Esotericism Podcast |
| **SHWEP Episode** | `/shwep/[number]` | Sources for a specific SHWEP episode |
| **Libraries** | `/libraries` | Books grouped by digitization partner (Internet Archive, Gallica, Bodleian, etc.) |
| **Library Partner Page** | `/libraries/[slug]` | Books from a specific digitization source |
| **Research Sessions** | `/research` | Public log of AI curator acquisition sessions |
| **Developers** | `/developers` | API documentation and MCP server setup |
| **About** | `/about` | Mission, partners, and project background |

### Book Detail Page Panels

The Book Detail Page is the most complex surface. Its panels:

| Panel | Term | Description |
|-------|------|-------------|
| Book overview cards | **Book Stats** | Page counts, OCR/translation coverage, language |
| Left sidebar in reader | **Sections Nav** | Expandable Table of Contents with section summaries and illustrations |
| Illustrations grid | **Gallery Panel** | Illustrations detected in this book |
| AI-generated entries | **Book Index Panel** | Searchable index of people, places, concepts |
| Processing timeline | **Book History** | Chronological log of every pipeline step with timestamps and costs |
| Cover picker modal | **Cover Image Picker** | Admin-only modal for selecting the Cover Image |

---

## Public Surfaces

### Reading & Discovery

**Library** (`/`)
Browse Books homepage. Shows a hero section, featured Collection carousels, recently added books, and a paginated book grid. Primary entry point for new users.

**Book Detail Page** (`/book/[id]`)
Everything about one book: Book Header with Cover Image and metadata, page thumbnail grid, Book Index Panel, Sections Nav (Table of Contents), Gallery Panel, Book History. Accessed via a Book Card or direct URL.

**Page Reader** (`/book/[id]/page/[pageId]`)
Single-page reading view. Shows the Page Scan on the left and Transcription + Translation on the right. Navigation to adjacent pages. Accessible from the Book Detail Page thumbnail grid.

**Gallery** (`/gallery`)
Grid of Illustrations extracted from across the library, filterable by type (emblem, engraving, diagram, etc.), book, and quality. Browseable without knowing which book an image came from.

**Illustration Page** (`/gallery/image/[id]`)
Detail view for one Illustration. Shows the cropped image, AI-generated museum description, subject metadata, and the parent book context.

**Collections Page** (`/collections`)
List of all curated Collections (Alchemy, Natural Philosophy, Classical Philosophy, etc.).

**Timeline** (`/timeline`)
Decade-by-decade histogram of books in the library. Filterable by language.

**Encyclopedia** (`/encyclopedia`)
Cross-book index of Entities. Browseable by type (person, place, concept).

**Encyclopedia Entry** (`/encyclopedia/[name]`)
One Entity with description, aliases, and the books in which it appears.

**Search** (`/search`)
Full-text search across book titles, authors, and page content. Separate tab for Index search (concepts, people, quotes). Filters: language, category, date range, first translation, DOI.

**Explore** (`/explore`)
Interactive data visualizations:
- **Heatmaps**: entity type counts by century
- **Map**: `/explore/map` — geographic distribution
- **Book Atlas**: `/research/atlas` — 3D book landscape by topic, time, language

**Libraries** (`/libraries`)
Books grouped by digitization partner. Shows provenance (Internet Archive, Gallica, Bodleian, MDZ, Wellcome, e-rara, etc.).

### Personal

**Favorites** (`/favorites`)
Books, pages, and illustrations the user has liked. Persisted by anonymous visitor ID.

**Bookshelf** (`/bookshelf`)
User's reading list in three states: Currently Reading, Want to Read, Completed. Persisted in localStorage.

### Mission / About

**About** (`/about`)
Mission statement, partnership with the Embassy of the Free Mind and TU Delft, project background.

**About: Processing** (`/about/processing`)
How the pipeline works — eight stages from import through publication, with live stats.

**About: Research** (`/about/research`)
The scholarly methodology and research basis.

**About: Standards** (`/about/standards`)
IIIF, Web Annotation, and open standards compliance.

**Blog** (`/blog`)
Long-form posts. Includes methodology pieces (first translation methodology, MCP server announcement).

**Press** (`/press`)
Press kit and media coverage.

**SHWEP Reading Room** (`/shwep`)
Primary sources indexed to the Secret History of Western Esotericism Podcast. Each episode links to the Source Library books cited.

**Research Sessions** (`/research`)
Public log of curator acquisition sessions — shows how the AI researcher found and evaluated books.

### Community / Participation

**Contribute** (`/contribute`)
User-contributed transcription corrections and processing help.

**Support** (`/support`)
Membership / donation page (Ficino Society).

**Developers** (`/developers`)
API reference, MCP server installation (`npx @source-library/mcp-server`), CLI usage, and `get_quote` tool documentation.

---

## Admin / Internal Surfaces

| URL | Purpose |
|-----|---------|
| `/admin` | Processing dashboard — pipeline status, job queue, error logs |
| `/admin/books` | Book management — edit metadata, re-process, archive |
| `/admin/gallery` | Gallery review and curation |
| `/admin/social` | Social media post queue, tweet generation |
| `/analytics` | Usage analytics — costs, traffic, search queries, performance |
| `/gallery/curate` | Curate gallery images for quality |
| `/gallery/review` | Review image extraction results |
| `/plan` | Internal roadmap / acquisition planning |
| `/progress` | Pipeline processing progress |
| `/experiments` | OCR quality experiments (A/B comparisons) |
| `/brand` | Brand assets and style guide |
| `/scan` | Scanning workflow documentation |
| `/beta` | Beta features |

---

## Data Model Quick Reference

```
Book
├── id, slug, title, display_title, author, language, published (year)
├── thumbnail (Cover Image URL — must be direct http(s), never /api/image proxy)
├── thumbnail_blob (pre-generated 150px JPEG on CDN)
├── thumbnail_source: 'auto' | 'auto_upgrade' | 'manual'
├── is_first_translation (boolean)
├── reading_summary (Book Summary)
├── index (Book Index: concepts, people, places, key terms)
├── chapters (Table of Contents)
├── quality_score (0–100)
├── pipeline_auto.status (processing pipeline state)
└── pages_count, pages_ocr, pages_translated (cached counts)

Page
├── id, book_id, page_number
├── photo_original (original external URL — never overwritten)
├── archived_photo (Vercel Blob CDN URL)
├── cropped_photo (split-detected single-page crop)
├── thumbnail_blob (150px JPEG)
├── ocr.data (Transcription)
├── translation.data (Translation or modernized English)
├── transliteration.data (romanized non-Latin text)
├── page_type: 'text' | 'illustration' | 'title-page' | 'frontispiece' | ...
├── columns (number, only set for 2+ column layouts)
└── detected_images[] (Illustrations)
    ├── type, description, museum_description
    ├── bbox {x, y, width, height}
    ├── gallery_quality (0.0–1.0)
    └── metadata {subjects, figures, symbols}
```

---

## Naming Rules

1. **Cover Image** — never "thumbnail", "header photo", "book photo"
2. **Transcription** — never "OCR text" in user-facing copy
3. **Translation** — includes modernized Early Modern English; the field is always `translation.data`
4. **Page Reader** — never just "Reader" (ambiguous with the whole book)
5. **Book Detail Page** — never "book page" (ambiguous with a Page of content)
6. **Illustration** — a detected artwork within a page; a **Gallery Image** is the same thing when browsed in the Gallery
7. **Book Index** — the AI-generated index at the bottom of the Book Detail Page; not the same as the database index
8. **Table of Contents** — the chapter/section structure; in the sidebar it appears as the **Sections Nav**
9. **Collection** — always a curated thematic group; never used loosely to mean "the library"
10. **First Translation** — specific scholarly claim that this is the first English translation of the source work; do not use loosely
