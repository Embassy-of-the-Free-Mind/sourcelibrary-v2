# Source Library MCP Server

An MCP (Model Context Protocol) server that allows Claude and other AI agents to search, retrieve quotes, and cite sources from the Source Library collection of translated historical texts.

## Installation

```bash
cd mcp-server
npm install
npm run build
```

## Usage with Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "source-library": {
      "command": "node",
      "args": ["/path/to/sourcelibrary-v2/mcp-server/dist/index.js"],
      "env": {
        "SOURCE_LIBRARY_API": "https://sourcelibrary-v2.vercel.app/api"
      }
    }
  }
}
```

## Available Tools

### search_library

Search across all translated books.

```
Arguments:
  query: string (required) - Search query
  language: string - Filter by original language (Latin, German, etc.)
  date_from: string - Publication year start
  date_to: string - Publication year end
  has_doi: boolean - Only books with DOIs
  has_translation: boolean - Only books with translations
  limit: number - Max results (default 10)
```

**Example:**
```
search_library(query="quinta essentia", language="Latin", has_doi=true)
```

### get_quote

Get a quote from a specific page with formatted citations.

```
Arguments:
  book_id: string (required) - Book ID from search
  page: number (required) - Page number
  include_original: boolean - Include Latin/German text
  include_context: boolean - Include adjacent pages
```

**Example:**
```
get_quote(book_id="6836f8ee811c8ab472a49e36", page=15)
```

**Returns:**
```json
{
  "quote": "The fifth essence is that most pure...",
  "original": "Quinta essentia est purissima illa...",
  "page": 15,
  "book": {
    "title": "Two Treatises",
    "author": "Drebbel, Cornelius",
    "published": "1628"
  },
  "citation": {
    "inline": "(Drebbel 1628, p. 15)",
    "footnote": "Cornelius Drebbel, Two Treatises...",
    "doi_url": "https://doi.org/10.5281/zenodo.18053504"
  }
}
```

### get_book

Get detailed book information.

```
Arguments:
  book_id: string (required) - Book ID
```

## Resources

The server also supports `book://` URIs:

- `book://[id]` - Get book metadata
- `book://[id]/page/[n]` - Get page translation

## Development

```bash
npm run dev  # Run with hot reload
```

## Example Conversation

**User:** What did 17th century alchemists believe about the elements?

**Claude:** Let me search for relevant texts...

*Uses search_library("elements alchemy 17th century")*

I found several relevant texts. Let me get a quote from Cornelius Drebbel's 1628 treatise on elements:

*Uses get_quote(book_id="...", page=8)*

According to Drebbel:

> "Fire nourishes itself upon air, and air in turn is kindled by fire. These two elements share a hidden affinity through their shared quality of heat."

(Drebbel 1628, p. 8. DOI: 10.5281/zenodo.18053504)
