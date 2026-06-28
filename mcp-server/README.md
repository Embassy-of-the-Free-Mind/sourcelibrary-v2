# Source Library MCP Server

[![npm version](https://badge.fury.io/js/@source-library%2Fmcp-server.svg)](https://www.npmjs.com/package/@source-library/mcp-server)

Search, read, and cite 22,000+ rare pre-modern texts (alchemy, Hermetica, Kabbalah, theology, early science) with AI-generated English translations. 12 tools (full-text + semantic search, reading, exact quoting, image search, duplicate detection, feedback, sharing findings back). CLI + MCP server, no API key needed.

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

## 12 Tools

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

#### search_concept

Semantic passage search using Gemini embeddings. Finds conceptually related passages even when the modern term won't literally appear — e.g. "distributed cognition" maps to passages about active intellect, art of memory, wax-tablet metaphors. Prefer `search_translations` for literal phrases; use `search_concept` when the concept matters more than the wording.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Concept or natural-language description |
| `language` | string | No | Filter by original language (set explicitly to surface non-Latin/German texts) |
| `year_from` | number | No | Publication year start |
| `year_to` | number | No | Publication year end |
| `limit` | number | No | Max passages (default 15, max 50) |

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

Read a book. Prefer `chapter` for chapter-at-a-time reading; falls back to `from`/`to` page ranges. Each response includes a `truncated` flag with a `truncation_note` giving the next `from`/`to` values when content was cut by the page-budget limit — agents must check `truncated` rather than infer end-of-book from `pages_returned`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `book_id` | string | Yes | Book ID |
| `chapter` | number | No | Chapter index (0-based); preferred over from/to |
| `part` | number | No | Part number (1-based) for chapters split across parts |
| `content` | string | No | ocr, translation, or both (default) |
| `from` | number | No | Start page (inclusive) |
| `to` | number | No | End page (inclusive) |
| `format` | string | No | json (structured) or plain (concatenated text) |
| `include_metadata` | boolean | No | Include page-level metadata (model, language, etc.) |

#### get_quote

Get the exact translated text of a single page for quoting. Returns the verbatim translation, original OCR, and a formatted citation. The response headline is `citation_link` — the stable `sourcelibrary.org/q/…` shortlink to present alongside the quote and its page number. Always use this before putting text in quotation marks — never paraphrase from memory. Suggested render: `> [quote]` then `— [Author], p. [N]. [citation_link]`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `book_id` | string | Yes | Book ID or slug |
| `page` | number | Yes | Page number to quote from |

### Gallery

#### search_images

Search the visual collection: 50,000+ illustrations extracted from book pages PLUS 23,000+ standalone artworks (paintings, frescoes, prints, sculptures from Met, Rijksmuseum, Wikimedia, NGA). Each result has a `source` field: `gallery` (book illustration) or `artwork` (standalone work).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | No | Text search across descriptions, subjects, figures, artists |
| `source` | string | No | all (default), gallery, or artworks |
| `type` | string | No | woodcut, engraving, emblem, diagram, painting, fresco, etc. |
| `subject` | string | No | Subject (alchemy, astronomy, anatomy) |
| `figure` | string | No | Depicted figure (Mercury, philosopher, king) |
| `symbol` | string | No | Symbol (ouroboros, caduceus, sun) |
| `year_from` | number | No | Publication year start |
| `year_to` | number | No | Publication year end |
| `book_id` | string | No | Only images from a specific book or artwork id |
| `min_quality` | number | No | Min gallery quality score 0-1 (default 0.5) |
| `limit` | number | No | Max results (default 20, max 50) |

### Curation

#### check_duplicate

Check whether a book already exists in Source Library before importing. Uses 4-tier matching (source fingerprint, title+author normalization, keyword search, semantic similarity) and returns a confidence level + suggestion. Use this before every import to avoid duplicates.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | Yes | Book title (original or English) |
| `author` | string | No | Author name (any format) |
| `year` | string | No | Publication year (optional context) |
| `language` | string | No | Language hint for semantic search |
| `ia_id` | string | No | Internet Archive identifier (exact fingerprint match) |
| `manifest` | string | No | IIIF manifest URL (exact fingerprint match) |

### Feedback

#### submit_feedback

Submit feedback, bug reports, or feature requests directly to the Source Library team.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | Yes | Your feedback (2-5000 characters) |
| `name` | string | No | Your name |
| `email` | string | No | Email for follow-up |
| `page` | string | No | Related page URL |

#### share_findings

Share a research dossier back to the Source Library team — a title, optional summary, and an ordered list of citations (`{ book_id, page, note }`, references not copied text). Like `submit_feedback`, it goes to the team for review.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | Yes | Title of the dossier / thesis (2-300 chars) |
| `summary` | string | No | Prose summarizing the argument (max 5000 chars) |
| `citations` | array | Yes | Ordered `{ book_id, page, note }` passages (1-50) |
| `name` | string | No | Your name |
| `email` | string | No | Email for follow-up |

## CLI

Most tools are also available as a standalone CLI with colored terminal output. (`search_concept` and `check_duplicate` are MCP-only for now.)

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
