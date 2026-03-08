#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import {
  searchLibrary,
  searchPassages,
  searchWithinBook,
  listBooks,
  getBook,
  getBookText,
  getQuote,
  searchImages,
} from "./api.js";

// ── Tool Definitions ──────────────────────────────────────────────────

const TOOLS: Tool[] = [
  // ── Discovery & Browse ──
  {
    name: "search_library",
    description:
      "Full-text search across Source Library's 1,200+ rare historical books. Searches titles, authors, translations, and OCR text. Returns matching books and page snippets with citation URLs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (searches titles, authors, translations, OCR text)",
        },
        language: {
          type: "string",
          description: "Filter by original language (e.g., 'Latin', 'German', 'Greek', 'Sanskrit')",
        },
        year_from: {
          type: "number",
          description: "Filter by publication year (start, inclusive)",
        },
        year_to: {
          type: "number",
          description: "Filter by publication year (end, inclusive)",
        },
        has_doi: {
          type: "boolean",
          description: "Only return books with DOIs",
        },
        has_translation: {
          type: "boolean",
          description: "Only return books with translations",
        },
        sort: {
          type: "string",
          enum: ["relevance", "date_asc", "date_desc", "title"],
          description: "Sort order (default: relevance)",
        },
        limit: {
          type: "number",
          description: "Maximum results (default 10, max 100)",
        },
        offset: {
          type: "number",
          description: "Pagination offset (default 0)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_books",
    description:
      "Browse the full collection with filters. Returns books with title, author, language, year, page counts, and translation progress. Unlike search_library (full-text search), this returns a filtered list. Use for browsing by language, finding recently translated works, or getting collection statistics.",
    inputSchema: {
      type: "object" as const,
      properties: {
        search: {
          type: "string",
          description: "Filter by title or author (diacritic-insensitive, e.g., 'bohme' matches 'Böhme')",
        },
        language: {
          type: "string",
          description: "Filter by language (e.g., 'Latin', 'German', 'Greek')",
        },
        category: {
          type: "string",
          description: "Filter by category",
        },
        sort: {
          type: "string",
          enum: ["recent-translation", "recent", "title-asc", "title-desc"],
          description: "Sort order (default: recent-translation)",
        },
        limit: {
          type: "number",
          description: "Maximum results (default 100, max 200)",
        },
        skip: {
          type: "number",
          description: "Pagination offset (default 0)",
        },
      },
    },
  },

  {
    name: "search_translations",
    description:
      "Search inside translated page text across the entire library. THE tool for finding what historical authors wrote about a topic. Unlike search_library (which matches titles/authors), this searches inside the actual text. Returns passage snippets with page numbers, book info, and citation URLs. (Also available as 'search_passages'.)",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query — searches inside page translations and OCR text (e.g., 'divine providence', 'philosopher stone', 'harmony of the spheres')",
        },
        language: {
          type: "string",
          description: "Filter by book's original language (e.g., 'Latin', 'German', 'Greek')",
        },
        year_from: {
          type: "number",
          description: "Filter by publication year (start, inclusive)",
        },
        year_to: {
          type: "number",
          description: "Filter by publication year (end, inclusive)",
        },
        book_id: {
          type: "string",
          description: "Search within a specific book only",
        },
        limit: {
          type: "number",
          description: "Maximum results (default 20, max 50)",
        },
      },
      required: ["query"],
    },
  },

  {
    name: "search_within_book",
    description:
      "Search inside a specific book's pages (OCR and translations). Returns matching pages with snippets and citation URLs. Use after finding a book to locate specific passages.",
    inputSchema: {
      type: "object" as const,
      properties: {
        book_id: {
          type: "string",
          description: "The book ID to search within",
        },
        query: {
          type: "string",
          description: "Search query — finds matches in both original text (OCR) and English translations",
        },
      },
      required: ["book_id", "query"],
    },
  },

  // ── Reading & Text ──
  {
    name: "get_book",
    description:
      "Get detailed metadata about a book: summary, chapters, index stats, DOI, page counts, and processing status. Use this for context before reading with get_book_text.",
    inputSchema: {
      type: "object" as const,
      properties: {
        book_id: {
          type: "string",
          description: "The book ID",
        },
      },
      required: ["book_id"],
    },
  },
  {
    name: "get_book_text",
    description:
      "READ A BOOK — start here. Returns 50+ pages of text (OCR and/or translations) in a single call, each with a citation URL. Use page ranges (from/to) for focused reading. This is the primary tool for reading and analyzing book content.",
    inputSchema: {
      type: "object" as const,
      properties: {
        book_id: {
          type: "string",
          description: "The book ID",
        },
        content: {
          type: "string",
          enum: ["ocr", "translation", "both"],
          description: "Which text to return: 'ocr' (original), 'translation' (English), or 'both' (default)",
        },
        from: {
          type: "number",
          description: "Start page number (inclusive)",
        },
        to: {
          type: "number",
          description: "End page number (inclusive)",
        },
        format: {
          type: "string",
          enum: ["json", "plain"],
          description: "Response format: 'json' (structured with per-page URLs, default) or 'plain' (concatenated text with page markers)",
        },
        include_metadata: {
          type: "boolean",
          description: "Include page-level metadata (model, language, page_type, columns)",
        },
      },
      required: ["book_id"],
    },
  },

  // ── Quoting ──
  {
    name: "get_quote",
    description:
      "Get the exact translated text of a single page for quoting. Returns the full translation, original OCR text, and a formatted citation. ALWAYS use this tool before putting text in quotation marks — copy the exact text from the response. Do not paraphrase or reconstruct from memory.",
    inputSchema: {
      type: "object" as const,
      properties: {
        book_id: {
          type: "string",
          description: "The book ID or slug",
        },
        page: {
          type: "number",
          description: "Page number to quote from",
        },
      },
      required: ["book_id", "page"],
    },
  },

  // ── Gallery ──
  {
    name: "search_images",
    description:
      "Search 50,000+ historical illustrations, emblems, engravings, and diagrams. Filter by type, subject, figure, symbol, year range, book, or text query. Returns image metadata with gallery and book citation URLs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Text search for image descriptions (e.g., 'ouroboros', 'tree of life', 'alchemical laboratory')",
        },
        type: {
          type: "string",
          description: "Image type (woodcut, engraving, emblem, diagram, frontispiece, etc.)",
        },
        subject: {
          type: "string",
          description: "Subject filter (e.g., 'alchemy', 'astronomy', 'anatomy')",
        },
        figure: {
          type: "string",
          description: "Figure depicted (e.g., 'Mercury', 'philosopher', 'king')",
        },
        symbol: {
          type: "string",
          description: "Symbol depicted (e.g., 'ouroboros', 'caduceus', 'sun')",
        },
        year_from: {
          type: "number",
          description: "Filter by source book publication year (start)",
        },
        year_to: {
          type: "number",
          description: "Filter by source book publication year (end)",
        },
        book_id: {
          type: "string",
          description: "Only images from a specific book",
        },
        min_quality: {
          type: "number",
          description: "Minimum gallery quality score 0-1 (default 0.5)",
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default 20, max 50)",
        },
      },
    },
  },
];

// ── Server Setup ──────────────────────────────────────────────────────

const server = new Server(
  {
    name: "source-library",
    version: "4.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case "search_library":
        result = await searchLibrary(args as Parameters<typeof searchLibrary>[0]);
        break;
      case "search_translations":
      case "search_passages":
        result = await searchPassages(args as Parameters<typeof searchPassages>[0]);
        break;
      case "search_within_book":
        result = await searchWithinBook(args as Parameters<typeof searchWithinBook>[0]);
        break;
      case "list_books":
        result = await listBooks(args as Parameters<typeof listBooks>[0]);
        break;
      case "get_book":
        result = await getBook(args as Parameters<typeof getBook>[0]);
        break;
      case "get_book_text":
        result = await getBookText(args as Parameters<typeof getBookText>[0]);
        break;
      case "get_quote":
        result = await getQuote(args as Parameters<typeof getQuote>[0]);
        break;
      case "search_images":
        result = await searchImages(args as Parameters<typeof searchImages>[0]);
        break;
      default:
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    // Plain text results (from get_book_text with format=plain)
    if (typeof result === "string") {
      return { content: [{ type: "text" as const, text: result }] };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Source Library MCP server v4.1.0 running (8 tools)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
