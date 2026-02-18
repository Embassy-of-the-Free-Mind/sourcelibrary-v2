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

## Available Tools (11)

### Discovery & Browse

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

Get a specific page with formatted academic citations (inline, footnote, DOI).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `book_id` | string | Yes | Book ID |
| `page` | number | Yes | Page number |
| `include_original` | boolean | No | Include original language (default true) |
| `include_context` | boolean | No | Include adjacent pages |

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

**Cross-book conceptual analysis:**
> "Search for references to 'prima materia' across the collection. Which authors discuss it, and how do their treatments differ?"

**Entity network exploration:**
> "Find all entities connected to Hermes Trismegistus. What books discuss this figure, and what other entities appear alongside?"

**Reading a primary source:**
> "Get the full translation of Fludd's History of Both Worlds, pages 1-50. Summarize the cosmological framework."

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
