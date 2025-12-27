# Source Library MCP Server Design

## Overview

An MCP (Model Context Protocol) server that allows Claude and other AI agents to search, retrieve quotes, and cite sources from the Source Library collection.

## Use Cases

1. **Research Assistant**: Claude helping a researcher find primary sources on alchemy
2. **Writing Aid**: Claude inserting properly cited quotes into a scholarly paper
3. **Question Answering**: Claude answering "What did Drebbel say about the quinta essentia?"
4. **Bibliography Building**: Claude compiling a reading list on a historical topic

## Tools

### 1. `search_library`

Search across all books in the collection.

```typescript
{
  name: "search_library",
  description: "Search the Source Library collection of translated historical texts",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query (searches titles, authors, content)"
      },
      filters: {
        type: "object",
        properties: {
          language: { type: "string", description: "Original language (Latin, German, etc.)" },
          date_from: { type: "number", description: "Publication year start" },
          date_to: { type: "number", description: "Publication year end" },
          has_doi: { type: "boolean", description: "Only books with DOI" },
          author: { type: "string", description: "Author name" }
        }
      },
      limit: { type: "number", default: 10 }
    },
    required: ["query"]
  }
}
```

**Example Response:**
```json
{
  "total": 3,
  "results": [
    {
      "id": "6836f8ee811c8ab472a49e36",
      "title": "Tractatus duo. I. De natura elementorum. II. De quinta essentia.",
      "display_title": "Two Treatises: On the Nature of Elements & On the Fifth Essence",
      "author": "Drebbel, Cornelius",
      "published": "1628",
      "language": "Latin",
      "pages": 69,
      "doi": "10.5281/zenodo.18053504",
      "summary": "A treatise on alchemical elements and the quintessence..."
    }
  ]
}
```

### 2. `get_book`

Get detailed information about a specific book.

```typescript
{
  name: "get_book",
  description: "Get metadata, summary, and index for a specific book",
  inputSchema: {
    type: "object",
    properties: {
      book_id: { type: "string", description: "Book ID" },
      include: {
        type: "array",
        items: { type: "string", enum: ["summary", "index", "edition", "toc"] },
        description: "What to include in response"
      }
    },
    required: ["book_id"]
  }
}
```

### 3. `get_quote`

Retrieve a quote from a specific page with proper citation.

```typescript
{
  name: "get_quote",
  description: "Get a quote from a translated text with citation",
  inputSchema: {
    type: "object",
    properties: {
      book_id: { type: "string" },
      page: { type: "number", description: "Page number" },
      context_lines: { type: "number", default: 3, description: "Lines of context around the quote" },
      include_original: { type: "boolean", default: true, description: "Include original language text" }
    },
    required: ["book_id", "page"]
  }
}
```

**Example Response:**
```json
{
  "quote": {
    "translation": "The fifth essence is that most pure and subtle substance, extracted from the four elements, which possesses the power of life and healing.",
    "original": "Quinta essentia est purissima illa & subtilissima substantia, ex quatuor elementis extracta, quae vitae & sanationis vim possidet.",
    "page": 15,
    "book_title": "Two Treatises: On the Nature of Elements",
    "author": "Cornelius Drebbel"
  },
  "citation": {
    "inline": "(Drebbel 1628, p. 15)",
    "footnote": "Cornelius Drebbel, Two Treatises: On the Nature of Elements & On the Fifth Essence, trans. Source Library (2025), p. 15. DOI: 10.5281/zenodo.18053504",
    "bibtex": "@book{drebbel1628,\n  author = {Drebbel, Cornelius},\n  title = {Two Treatises},\n  year = {1628},\n  translator = {Source Library},\n  doi = {10.5281/zenodo.18053504}\n}"
  }
}
```

### 4. `ask_book`

Ask a question about a book and get a cited answer.

```typescript
{
  name: "ask_book",
  description: "Ask a question about a book's content and get a cited answer",
  inputSchema: {
    type: "object",
    properties: {
      book_id: { type: "string" },
      question: { type: "string", description: "Question about the book's content" }
    },
    required: ["book_id", "question"]
  }
}
```

**Example:**
```
Q: "What does Drebbel say about the relationship between fire and air?"
```

**Response:**
```json
{
  "answer": "Drebbel describes fire and air as having a close sympathetic relationship. He writes that 'fire nourishes itself upon air, and air in turn is kindled by fire' (p. 8). He further explains that the two elements share a 'hidden affinity' through their shared quality of heat (p. 12).",
  "sources": [
    { "page": 8, "quote": "fire nourishes itself upon air..." },
    { "page": 12, "quote": "hidden affinity through their shared quality..." }
  ]
}
```

### 5. `get_reading_list`

Get suggested readings on a topic.

```typescript
{
  name: "get_reading_list",
  description: "Get a curated list of books on a topic",
  inputSchema: {
    type: "object",
    properties: {
      topic: { type: "string" },
      limit: { type: "number", default: 5 }
    },
    required: ["topic"]
  }
}
```

## Resources

### `book://[id]`

Direct access to a book's translation.

```typescript
{
  uri: "book://6836f8ee811c8ab472a49e36",
  name: "Two Treatises: On the Nature of Elements",
  mimeType: "text/markdown",
  description: "Full translation of Drebbel's 1628 treatise"
}
```

### `book://[id]/page/[n]`

Access to a specific page.

```typescript
{
  uri: "book://6836f8ee811c8ab472a49e36/page/15",
  name: "Two Treatises, p. 15",
  mimeType: "text/markdown"
}
```

## Implementation

### Directory Structure

```
src/
  mcp/
    server.ts           # MCP server entry point
    tools/
      search.ts         # search_library tool
      book.ts           # get_book tool
      quote.ts          # get_quote tool
      ask.ts            # ask_book tool
    resources/
      book.ts           # book:// resource handler
    prompts/
      research.ts       # Research assistant prompt
```

### Server Entry Point

```typescript
// src/mcp/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({
  name: "source-library",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
    resources: {},
    prompts: {},
  }
});

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    searchLibraryTool,
    getBookTool,
    getQuoteTool,
    askBookTool,
    getReadingListTool,
  ]
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "search_library":
      return searchLibrary(request.params.arguments);
    case "get_quote":
      return getQuote(request.params.arguments);
    // ...
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "source-library": {
      "command": "node",
      "args": ["/path/to/source-library/dist/mcp/server.js"],
      "env": {
        "SOURCE_LIBRARY_API": "https://sourcelibrary.org/api"
      }
    }
  }
}
```

## API Endpoints Required

The MCP server calls these backend APIs:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/search?q=...` | Full-text search |
| `GET /api/books/[id]` | Book metadata |
| `GET /api/books/[id]/pages/[n]` | Page content |
| `GET /api/books/[id]/quote?page=N` | Formatted quote |
| `POST /api/books/[id]/ask` | RAG-based Q&A |

## Future Enhancements

1. **Prompts**: Pre-built research prompts
   - "Research a topic using primary sources"
   - "Build an annotated bibliography"
   - "Compare perspectives across texts"

2. **Subscriptions**: Real-time updates when new books are added

3. **Cross-references**: Link related passages across books

4. **Quality Feedback**: Claude can flag issues
   - "This translation seems inconsistent with page 12"
   - "OCR error detected: 'quinta' misread as 'quita'"
