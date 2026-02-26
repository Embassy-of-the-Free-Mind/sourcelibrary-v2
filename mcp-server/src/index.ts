#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import {
  searchLibrary,
  searchPassages,
  searchWithinBook,
  findQuotes,
  listBooks,
  getBook,
  getBookText,
  getQuote,
  searchIndex,
  searchEntities,
  getEntity,
  searchImages,
  getImage,
  getBookImages,
} from "./api.js";

// ── Tool Definitions ──────────────────────────────────────────────────

const TOOLS: Tool[] = [
  // ── Discovery & Browse ──
  {
    name: "search_library",
    description:
      "Full-text search across Source Library books and page content. Searches titles, authors, translations, and OCR text. Returns matching books and page snippets ranked by relevance.",
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
      "Browse the Source Library collection with filters. Returns books with title, author, language, year, page counts, and translation progress. Unlike search_library which does full-text search, this returns a filtered list of all books. Use for browsing by language, finding recently translated works, or getting collection statistics.",
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
      "Search inside translated page text across the entire library. Returns passage snippets with page numbers, book title, author, and direct reading links. THE tool for finding what historical authors wrote about a topic — search a concept and see which books and pages discuss it. Unlike search_library (which matches book titles/authors), this searches inside the actual text of translations and OCR. (Also available as 'search_passages'.)",
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
      "Search inside a specific book's page content (OCR and translations). Returns matching pages with snippets showing where the query appears. Use after finding a book via search_library or list_books to locate specific passages within it.",
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

  {
    name: "find_quotes",
    description:
      "Find citable passages in a book on a given topic. Searches the book, retrieves full page text with original language, English translation, and shortlinks for the top matches. Returns up to 5 passages with academic citations ready for scholarly use. Use this when you know which book to look in; use search_translations to find passages across the whole library.",
    inputSchema: {
      type: "object" as const,
      properties: {
        book_id: {
          type: "string",
          description: "The book ID to find quotes in",
        },
        topic: {
          type: "string",
          description: "Research topic or concept to find quotes about (e.g., 'relationship between music and cosmic order', 'nature of the soul', 'transmutation of metals')",
        },
        limit: {
          type: "number",
          description: "Maximum quotes to return (default 5, max 10)",
        },
      },
      required: ["book_id", "topic"],
    },
  },

  // ── Reading & Text ──
  {
    name: "get_book",
    description:
      "Get detailed information about a specific book including summary, index, edition info, DOI, page list, and processing status.",
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
      "Get the full text of a book (OCR and/or translations) in a single call. Essential for reading and analyzing book content. Supports page ranges for focused reading. Returns structured text with page numbers.",
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
          description: "Response format: 'json' (structured, default) or 'plain' (concatenated text with page markers)",
        },
        include_metadata: {
          type: "boolean",
          description: "Include page-level metadata (model, language, page_type, columns)",
        },
      },
      required: ["book_id"],
    },
  },
  {
    name: "get_quote",
    description:
      "Get a citable quote from a book with academic citations (APA, Chicago, MLA, BibTeX) and a shortlink. Two modes: (1) provide a page number for direct lookup, or (2) provide a query to search within the book and return the best matching page. Returns translation, original language text, and formatted citations ready for scholarly use.",
    inputSchema: {
      type: "object" as const,
      properties: {
        book_id: {
          type: "string",
          description: "The book ID",
        },
        page: {
          type: "number",
          description: "Page number to get quote from (optional if query is provided)",
        },
        query: {
          type: "string",
          description: "Search query — finds the best matching page in the book and returns it as a citable quote (optional if page is provided)",
        },
        include_original: {
          type: "boolean",
          description: "Include original language text (default true)",
        },
        include_context: {
          type: "boolean",
          description: "Include adjacent pages for context",
        },
      },
      required: ["book_id"],
    },
  },

  // ── Knowledge Graph & Entities ──
  {
    name: "search_index",
    description:
      "Search AI-generated book indexes for concepts, people, places, keywords, and quotes across the collection. Returns cross-book results showing where terms appear with page references.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., 'philosopher stone', 'Hermes Trismegistus', 'prima materia')",
        },
        type: {
          type: "string",
          enum: ["concept", "person", "place", "keyword", "vocabulary", "quote"],
          description: "Filter by entry type",
        },
        limit: {
          type: "number",
          description: "Maximum results (default 50, max 200)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_entities",
    description:
      "Search the cross-book entity knowledge graph. Entities are people, places, and concepts that appear across multiple books. Returns entity details with book references and mention counts. Use for finding connections between books.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search for entity name or alias (e.g., 'Paracelsus', 'prima materia', 'Alexandria')",
        },
        type: {
          type: "string",
          enum: ["person", "place", "concept"],
          description: "Filter by entity type",
        },
        book_id: {
          type: "string",
          description: "Find entities mentioned in a specific book",
        },
        min_books: {
          type: "number",
          description: "Only entities appearing in at least N books",
        },
        limit: {
          type: "number",
          description: "Maximum results (default 50, max 200)",
        },
        offset: {
          type: "number",
          description: "Pagination offset (default 0)",
        },
      },
    },
  },
  {
    name: "get_entity",
    description:
      "Get full details about a specific entity including description, aliases, related entities, and all book appearances with page references.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entity_id: {
          type: "string",
          description: "The entity ID (from search_entities results)",
        },
      },
      required: ["entity_id"],
    },
  },

  // ── Gallery & Images ──
  {
    name: "search_images",
    description:
      "Search 50,000+ historical illustrations, emblems, engravings, and diagrams. Filter by type, subject, figure, symbol, year range, or text query. Returns image metadata with gallery links.",
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
  {
    name: "get_image",
    description:
      "Get detailed information about a specific image including full metadata, museum description, and source book context.",
    inputSchema: {
      type: "object" as const,
      properties: {
        image_id: {
          type: "string",
          description: "The image ID (format: pageId:detectionIndex)",
        },
      },
      required: ["image_id"],
    },
  },
  {
    name: "get_book_images",
    description:
      "Get all extracted images from a specific book. Useful for exploring the visual content of a particular text.",
    inputSchema: {
      type: "object" as const,
      properties: {
        book_id: {
          type: "string",
          description: "The book ID",
        },
        min_quality: {
          type: "number",
          description: "Minimum gallery quality score 0-1 (default 0.5)",
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default 50)",
        },
      },
      required: ["book_id"],
    },
  },
];

// ── Server Setup ──────────────────────────────────────────────────────

const server = new Server(
  {
    name: "source-library",
    version: "3.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
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
      case "find_quotes":
        result = await findQuotes(args as Parameters<typeof findQuotes>[0]);
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
      case "search_index":
        result = await searchIndex(args as Parameters<typeof searchIndex>[0]);
        break;
      case "search_entities":
        result = await searchEntities(args as Parameters<typeof searchEntities>[0]);
        break;
      case "get_entity":
        result = await getEntity(args as Parameters<typeof getEntity>[0]);
        break;
      case "search_images":
        result = await searchImages(args as Parameters<typeof searchImages>[0]);
        break;
      case "get_image":
        result = await getImage(args as Parameters<typeof getImage>[0]);
        break;
      case "get_book_images":
        result = await getBookImages(args as Parameters<typeof getBookImages>[0]);
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

// Handle resources (book:// URIs)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return { resources: [] };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  const bookMatch = uri.match(/^book:\/\/([^/]+)(?:\/page\/(\d+))?$/);
  if (!bookMatch) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const [, bookId, pageNum] = bookMatch;

  if (pageNum) {
    const result = await getQuote({ book_id: bookId, page: parseInt(pageNum) });
    return {
      contents: [{ uri, mimeType: "text/plain", text: (result as Record<string, unknown>).quote as string }],
    };
  } else {
    const result = await getBook({ book_id: bookId });
    return {
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify(result, null, 2) }],
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Source Library MCP server v3.0.0 running (14 tools)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
