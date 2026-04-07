# Source Library MCP Server

[![npm version](https://badge.fury.io/js/@source-library%2Fmcp-server.svg)](https://www.npmjs.com/package/@source-library/mcp-server)

Search, read, and cite 1,200+ rare historical texts from the terminal or via MCP. 9 tools (search, read, cite, feedback), CLI + MCP server, no API key needed.

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

### CLI

```bash
# Install globally
npm install -g @source-library/mcp-server

# Or run directly
npx @source-library/mcp-server search "philosopher's stone"
```

### From Source

```bash
git clone https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2.git
cd sourcelibrary-v2/mcp-server
npm install && npm run build
npm start
```

## 9 Tools

### Search & Discovery

#### search_library

Full-text search across books and page content. Returns matching books and pages with citation URLs.

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

#### search_translations

Search inside translated text across the entire library. Find what historical authors wrote about any topic. Returns passage snippets with page numbers, book info, and citation URLs.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search inside page text |
| `language` | string | No | Filter by book's original language |
| `year_from` | number | No | Publication year start |
| `year_to` | number | No | Publication year end |
| `book_id` | string | No | Search within a specific book only |
| `limit` | number | No | Max results (default 20, max 50) |

#### search_within_book

Search inside a specific book's pages. Returns matching pages with snippets and citation URLs.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `book_id` | string | Yes | The book ID to search within |
| `query` | string | Yes | Search query |

#### list_books

Browse the collection with filters. Returns title, author, language, year, and translation progress.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `search` | string | No | Filter by title/author (diacritic-insensitive) |
| `language` | string | No | Filter by language |
| `category` | string | No | Filter by category |
| `sort` | string | No | recent-translation, recent, title-asc, title-desc |
| `limit` | number | No | Max results (default 100, max 200) |

### Reading

#### get_book

Detailed book metadata: summary, index stats, chapters, edition info, DOI.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `book_id` | string | Yes | Book ID |

#### get_book_text

Read a book. Returns 50+ pages of text in one call, each with a citation URL. OCR, translation, or both.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `book_id` | string | Yes | Book ID |
| `content` | string | No | ocr, translation, or both (default) |
| `from` | number | No | Start page (inclusive) |
| `to` | number | No | End page (inclusive) |
| `format` | string | No | json (structured) or plain (concatenated text) |

### Gallery

#### search_images

Search 50,000+ historical illustrations, emblems, engravings, and diagrams.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | No | Text search across descriptions |
| `type` | string | No | woodcut, engraving, emblem, diagram, etc. |
| `subject` | string | No | Subject (alchemy, astronomy, anatomy) |
| `figure` | string | No | Depicted figure (Mercury, philosopher, king) |
| `symbol` | string | No | Symbol (ouroboros, caduceus, sun) |
| `year_from` | number | No | Publication year start |
| `year_to` | number | No | Publication year end |
| `book_id` | string | No | Only images from a specific book |
| `min_quality` | number | No | Min quality score 0-1 (default 0.5) |
| `limit` | number | No | Max results (default 20, max 50) |

### Feedback

#### submit_feedback

Submit feedback, bug reports, or feature requests directly to the Source Library team.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | Yes | Your feedback (2-5000 characters) |
| `name` | string | No | Your name |
| `email` | string | No | Email for follow-up |
| `page` | string | No | Related page URL |

## CLI

All 9 tools are available as a standalone CLI with colored terminal output.

```bash
# Search the collection
source-library search "Paracelsus" --language=German

# Search inside translations
source-library translations "harmony of the spheres"

# Read a book
source-library text 694f49d3... --from=1 --to=50

# Book details
source-library book 694f49d3...

# Browse the gallery
source-library images --subject=alchemy --type=emblem

# Submit feedback
source-library feedback "Great translation of Fludd!" --name="Jane"

# JSON output for piping
source-library search "alchemy" --json | jq .results
```

## Example Research Prompts

> "Search for references to 'prima materia' across the collection. Which authors discuss it, and how do their treatments differ?"

> "Read the full translation of Fludd's History of Both Worlds, pages 1-50. Summarize the cosmological framework."

> "Find all alchemical emblems depicting the ouroboros. What texts are they from?"

> "What does Copernicus say about the Sun's centrality in De Revolutionibus? Find the key passages with citation URLs."

## Citation URLs

Every page returned by the tools includes a citation URL:

```
https://sourcelibrary.org/book/fludd-utriusque?page=57
```

Published editions include DOIs minted via Zenodo.

## Development

```bash
npm run dev    # Run with hot reload (tsx)
npm run build  # Compile TypeScript
npm start      # Run compiled version
npm run cli    # Run CLI in dev mode
```

## License

MIT

## Links

- **Website:** [sourcelibrary.org](https://sourcelibrary.org)
- **Developers:** [sourcelibrary.org/developers](https://sourcelibrary.org/developers)
- **GitHub:** [Embassy-of-the-Free-Mind/sourcelibrary-v2](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2)
