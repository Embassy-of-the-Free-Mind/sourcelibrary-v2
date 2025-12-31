# Source Library MCP Server

[![npm version](https://badge.fury.io/js/@source-library%2Fmcp-server.svg)](https://www.npmjs.com/package/@source-library/mcp-server)

An MCP (Model Context Protocol) server for searching and citing rare historical texts from [Source Library](https://sourcelibrary.org). Access translated Latin and German manuscripts from the 15th-18th centuries with DOI-backed academic citations.

## Features

- **Search** translated historical texts (alchemy, Hermeticism, Renaissance philosophy)
- **Get quotes** with properly formatted academic citations
- **DOI support** for all published editions via Zenodo
- **Original language** preserved alongside English translations

## Quick Start

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

Restart Claude Desktop, and you can now ask:

> "Search Source Library for texts about the philosopher's stone and cite a passage"

### Global Install

```bash
npm install -g @source-library/mcp-server
source-library-mcp
```

### From Source

```bash
git clone https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2.git
cd sourcelibrary-v2/mcp-server
npm install && npm run build
npm start
```

## Available Tools

### search_library

Search the Source Library collection.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `language` | string | No | Filter: Latin, German, French, etc. |
| `date_from` | string | No | Publication year start |
| `date_to` | string | No | Publication year end |
| `has_doi` | boolean | No | Only books with DOIs |
| `has_translation` | boolean | No | Only translated books |
| `limit` | number | No | Max results (default 10) |

**Example:**
```json
{ "query": "quinta essentia", "language": "Latin", "has_doi": true }
```

### get_quote

Get a passage with formatted citations.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `book_id` | string | Yes | Book ID from search results |
| `page` | number | Yes | Page number |
| `include_original` | boolean | No | Include original language (default true) |
| `include_context` | boolean | No | Include adjacent pages |

**Returns:**
```json
{
  "quote": "The fifth essence is that most pure...",
  "original": "Quinta essentia est purissima illa...",
  "page": 57,
  "book": {
    "title": "Two Treatises",
    "author": "Cornelius Drebbel",
    "published": "1628"
  },
  "citation": {
    "inline": "(Drebbel 1628, p. 57)",
    "footnote": "Cornelius Drebbel, Two Treatises, trans. Source Library (2025), 57. DOI: 10.5281/zenodo.18053504.",
    "doi_url": "https://doi.org/10.5281/zenodo.18053504"
  }
}
```

### get_book

Get detailed book information including summary, edition info, and DOI.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `book_id` | string | Yes | Book ID |

## Resources

The server also supports `book://` URIs:

- `book://[id]` - Get book metadata
- `book://[id]/page/[n]` - Get page translation

## Example Conversations

**Research query:**
> "What did Paracelsus write about the quinta essentia? Give me a quote with citation."

**Historical investigation:**
> "Find 16th century Latin texts about transmutation and summarize their main arguments"

**Academic writing:**
> "I need a primary source quote about Renaissance alchemy for my paper, with proper DOI citation"

## REST API

The underlying API is also available directly:

```
GET https://sourcelibrary.org/api/search?q={query}
GET https://sourcelibrary.org/api/books/{id}/quote?page={n}
GET https://sourcelibrary.org/api/books/{id}
```

Full documentation: [sourcelibrary.org/llms.txt](https://sourcelibrary.org/llms.txt)

## Content

The library contains translated texts from:

- Latin alchemical and Hermetic manuscripts (1450-1700)
- German mystical and Paracelsian works
- Renaissance philosophical treatises
- Rosicrucian manifestos and related texts

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
- **API Docs:** [sourcelibrary.org/llms.txt](https://sourcelibrary.org/llms.txt)
- **GitHub:** [Embassy-of-the-Free-Mind/sourcelibrary-v2](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2)
