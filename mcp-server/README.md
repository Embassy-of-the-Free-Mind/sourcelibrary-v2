# Source Library MCP Server

[![npm version](https://badge.fury.io/js/@source-library%2Fmcp-server.svg)](https://www.npmjs.com/package/@source-library/mcp-server)

An MCP (Model Context Protocol) server for researching rare historical texts from [Source Library](https://sourcelibrary.org). 5,000+ books spanning alchemy, Hermeticism, Renaissance philosophy, and early modern science — with OCR'd originals, English translations, AI-generated indexes, and 34,000+ extracted illustrations.

## Quick Start

### Claude Code

```bash
claude mcp add source-library -- npx -y @source-library/mcp-server
```

### Claude Desktop

Add to your Claude Desktop config:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "source-library": {
      "command": "npx",
      "args": ["-y", "@source-library/mcp-server"]
    }
  }
}
```

### From Source

```bash
git clone https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2.git
cd sourcelibrary-v2/mcp-server
npm install && npm run build
npm start
```

## Available Tools (14)

### Discovery & Search

#### search_library

Full-text search across books and page content. Searches titles, authors, translations, and OCR text.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `language` | string | No | Filter: Latin, German, Greek, Sanskrit, etc. |
| `year_from` | number | No | Publication year start |
| `year_to` | number | No | Publication year end |
| `has_doi` | boolean | No | Only books with DOIs |
| `has_translation` | boolean | No | Only translated books |
| `sort` | string | No | relevance, date_asc, date_desc, title |
| `limit` | number | No | Max results (default 10, max 100) |

#### search_passages

Search across all translated page content in the library. Returns passage snippets with page numbers and book context. Unlike `search_library` (which matches book titles/authors), this searches inside the actual text of translations and OCR.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search inside page text (e.g., "divine providence", "philosopher stone") |
| `language` | string | No | Filter by book's original language |
| `year_from` | number | No | Publication year start |
| `year_to` | number | No | Publication year end |
| `book_id` | string | No | Search within a specific book only |
| `limit` | number | No | Max results (default 20, max 50) |

#### search_within_book

Search inside a specific book's page content (OCR and translations). Returns matching pages with snippets showing where the query appears.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `book_id` | string | Yes | The book ID to search within |
| `query` | string | Yes | Search query (matches both original text and translations) |

#### list_books

Browse the collection with filters. Returns all matching books with translation progress.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `search` | string | No | Filter by title/author (diacritic-insensitive) |
| `language` | string | No | Filter by language |
| `category` | string | No | Filter by category |
| `sort` | string | No | recent-translation, recent, title-asc, title-desc |
| `limit` | number | No | Max results (default 100, max 200) |

### Reading & Text

#### get_book

Get detailed book metadata including summary, index stats, edition info, and DOI.

#### get_book_text

Get the full text of a book in a single call. Essential for reading and analyzing content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `book_id` | string | Yes | Book ID |
| `content` | string | No | ocr, translation, or both (default) |
| `from` | number | No | Start page (inclusive) |
| `to` | number | No | End page (inclusive) |
| `format` | string | No | json (structured) or plain (concatenated text) |

#### get_quote

Get a page with formatted academic citations (inline, footnote, DOI). Provide a page number for direct lookup, or a query to search within the book and return the best matching page as a citable quote.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `book_id` | string | Yes | Book ID |
| `page` | number | No | Page number (optional if query is provided) |
| `query` | string | No | Search query — finds the best matching page (optional if page is provided) |
| `include_original` | boolean | No | Include original language text (default true) |
| `include_context` | boolean | No | Include adjacent pages |

#### find_quotes

Find the most quotable passages in a book on a given topic. Searches the book, then retrieves full page text with original language and academic citations for the best matches. Returns up to 5 citable passages ready for scholarly use.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `book_id` | string | Yes | The book ID to find quotes in |
| `topic` | string | Yes | Research topic or concept (e.g., "nature of the soul") |
| `limit` | number | No | Max quotes to return (default 5, max 10) |

### Knowledge Graph & Entities

#### search_index

Search AI-generated book indexes for concepts, people, places, keywords, and quotes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `type` | string | No | concept, person, place, keyword, vocabulary, quote |
| `limit` | number | No | Max results (default 50) |

#### search_entities

Search the cross-book entity network. Find people, places, and concepts that connect multiple books.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | No | Search by name or alias |
| `type` | string | No | person, place, concept |
| `book_id` | string | No | Entities in a specific book |
| `min_books` | number | No | Min book appearances (default 1) |
| `limit` | number | No | Max results (default 50) |

#### get_entity

Get full entity detail with all book appearances, page references, aliases, and related entities.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entity_id` | string | Yes | Entity ID or name (e.g., "Hermes Trismegistus") |

### Gallery & Images

#### search_images

Search 34,000+ historical illustrations, emblems, and engravings.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | No | Text search across descriptions and metadata |
| `type` | string | No | emblem, woodcut, engraving, portrait, etc. |
| `subject` | string | No | Subject tag (alchemy, astronomy, medicine) |
| `figure` | string | No | Depicted figure (Mercury, serpent, angel) |
| `symbol` | string | No | Symbol (ouroboros, athanor) |
| `year_from` | number | No | Publication year start |
| `year_to` | number | No | Publication year end |

#### get_image

Get full image metadata including museum description and source book context.

#### get_book_images

Get all extracted images from a specific book.

## Example Research Workflows

**Discover what historical authors wrote about a topic:**
> "Search for passages about 'prima materia' across the collection. Which authors discuss it, and how do their treatments differ?"

**Find citable quotes from a specific book:**
> "Find quotes about the divine mind in Ficino's Pimander. I need them with DOI citations."

**Entity network exploration:**
> "Find all entities connected to Hermes Trismegistus. What books discuss this figure, and what other entities appear alongside?"

**Reading a primary source:**
> "Get the full translation of Fludd's History of Both Worlds, pages 1-50. Summarize the cosmological framework."

**Search within a book, then cite:**
> "Search for references to the soul in Agrippa's De Occulta Philosophia, then get a citable quote from the best match."

**Historical illustration research:**
> "Find all alchemical emblems depicting the ouroboros. What texts are they from?"

**Academic citation:**
> "I need a quote from Copernicus's De Revolutionibus about the Sun's centrality, with a proper DOI citation."

## Collection

5,000+ books including:
- Latin alchemical and Hermetic manuscripts (1450-1700)
- German mystical and Paracelsian works
- Renaissance philosophical treatises (Ficino, Bruno, Pico)
- Rosicrucian manifestos and related texts
- Early modern scientific works (Copernicus, Galileo, Kepler)
- Sanskrit, Chinese, Greek, and Arabic philosophical texts

All translations are AI-assisted with original language preserved for scholarly verification.

## Development

```bash
npm run dev    # Run with hot reload (tsx)
npm run build  # Compile TypeScript
npm start      # Run compiled version
```

## License

MIT

## Links

- **Website:** [sourcelibrary.org](https://sourcelibrary.org)
- **GitHub:** [Embassy-of-the-Free-Mind/sourcelibrary-v2](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2)
