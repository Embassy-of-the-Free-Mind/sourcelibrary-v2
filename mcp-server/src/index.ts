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
  searchConcept,
  searchWithinBook,
  listBooks,
  getBook,
  getBookText,
  getQuote,
  searchImages,
  submitFeedback,
  checkDuplicate,
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
    name: "search_concept",
    description:
      "Conceptual / semantic passage search. Use when the modern term won't literally appear in historical texts — e.g. \"distributed cognition\" maps to passages about active intellect, art of memory, wax tablet metaphors; \"social contract\" maps to pre-Hobbesian discussions of consent and authority. Ranks passages by cosine similarity on Gemini embeddings, so paraphrases and conceptually adjacent phrasings match even when no keyword overlaps. Prefer search_translations for literal phrases or distinctive single terms; use search_concept when the concept matters more than the wording. Each passage includes a similarity score (0-1); treat scores below ~0.45 with skepticism.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "A concept or natural-language description — full sentences are fine. Unlike search_translations, this does NOT require words that appear in the corpus.",
        },
        language: {
          type: "string",
          description: "Filter by original language (e.g., Latin, German, Greek, Arabic, Chinese, Sanskrit, Hebrew, Persian, Tibetan). Use this filter when you want passages from a specific tradition — unfiltered English queries skew toward Latin/German/English results, so set language=Chinese/Arabic/etc. explicitly to surface those texts.",
        },
        year_from: {
          type: "number",
          description: "Filter by publication year (start, inclusive)",
        },
        year_to: {
          type: "number",
          description: "Filter by publication year (end, inclusive)",
        },
        limit: {
          type: "number",
          description: "Max passages (default 15, max 50)",
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
      "READ A BOOK — start here. Preferred: use 'chapter' param to read one chapter at a time (includes page markers like [Page 42] for citation). Or use page ranges (from/to) for focused reading. Call get_book first to see the chapter list.",
    inputSchema: {
      type: "object" as const,
      properties: {
        book_id: {
          type: "string",
          description: "The book ID",
        },
        chapter: {
          type: "number",
          description: "Chapter index (0-based). Returns chapter text with embedded [Page N] markers for citation. Preferred over from/to. If the chapter has multiple parts, returns part 1 — check parts_total in response.",
        },
        part: {
          type: "number",
          description: "Part number (1-based) for large chapters split into multiple parts.",
        },
        content: {
          type: "string",
          enum: ["ocr", "translation", "both"],
          description: "Which text to return: 'ocr' (original), 'translation' (English), or 'both' (default)",
        },
        from: {
          type: "number",
          description: "Start page number (inclusive). Use chapter param instead when possible.",
        },
        to: {
          type: "number",
          description: "End page number (inclusive). Use chapter param instead when possible.",
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
      "Search the visual collection: 50,000+ illustrations extracted from book pages PLUS 23,000+ standalone artworks (paintings, frescoes, prints, sculptures from Met, Rijksmuseum, Wikimedia, NGA). Filter by type, subject, figure, symbol, year, book, or text query. Each result has a `source` field — `gallery` (illustration in a book) or `artwork` (standalone museum work). Use `type=painting` or `type=fresco` to find standalone works; `type=woodcut`, `type=engraving`, `type=emblem` etc. surface mostly book illustrations. The `source` parameter narrows the search: 'all' (default), 'gallery' (illustrations only), or 'artworks' (standalone works only).",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Text search across descriptions, subjects, figures, titles, and artists (e.g., 'ouroboros', 'Raphael fresco', 'Botticelli')",
        },
        source: {
          type: "string",
          enum: ["all", "gallery", "artworks"],
          description: "Which collection to search. 'all' (default) returns both illustrations and standalone artworks, interleaved. 'gallery' = book illustrations only. 'artworks' = standalone paintings/prints/sculptures only.",
        },
        type: {
          type: "string",
          description: "Image type. For book illustrations: woodcut, engraving, emblem, diagram, frontispiece, portrait, illustration, map, chart, decorative, musical_score, symbol. For standalone artworks: painting, drawing, print, fresco, engraving, woodcut, emblem, map, tablet, object.",
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
          description: "Filter by publication year (start)",
        },
        year_to: {
          type: "number",
          description: "Filter by publication year (end)",
        },
        book_id: {
          type: "string",
          description: "Only return images from a specific book or artwork id",
        },
        min_quality: {
          type: "number",
          description: "Minimum gallery quality score 0-1 (default 0.5). Applies to gallery illustrations only.",
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default 20, max 50)",
        },
      },
    },
  },
  // ── Curation ──
  {
    name: "check_duplicate",
    description:
      "Check if a book already exists in Source Library before importing. Uses 4-tier matching: source fingerprint, title+author normalization, keyword search, and semantic similarity. Returns confidence level, matches with URLs, and a suggestion (safe to import / review matches / likely duplicate). Use this BEFORE every import to avoid duplicates.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Book title (original language or English)",
        },
        author: {
          type: "string",
          description: "Author name (any format: 'First Last', 'Last, First', etc.)",
        },
        year: {
          type: "string",
          description: "Publication year (optional, for context)",
        },
        language: {
          type: "string",
          description: "Language hint for semantic search (optional)",
        },
        ia_id: {
          type: "string",
          description: "Internet Archive identifier (optional, for exact fingerprint match)",
        },
        manifest: {
          type: "string",
          description: "IIIF manifest URL (optional, for exact fingerprint match)",
        },
      },
      required: ["title"],
    },
  },

  // ── Feedback ──
  {
    name: "submit_feedback",
    description:
      "Submit feedback, bug reports, feature requests, or comments to the Source Library team. Messages go directly to the maintainers.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "Your feedback, bug report, or feature request (2-5000 characters)",
        },
        name: {
          type: "string",
          description: "Your name (optional)",
        },
        email: {
          type: "string",
          description: "Your email for follow-up (optional)",
        },
        page: {
          type: "string",
          description: "Related page URL or path (optional, e.g., 'https://sourcelibrary.org/book/...')",
        },
      },
      required: ["message"],
    },
  },
];

// ── Server Setup ──────────────────────────────────────────────────────

const server = new Server(
  {
    name: "source-library",
    version: "4.2.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
    _meta: {
      about: "Source Library — 5,000+ rare alchemical, Hermetic, and early scientific texts translated into English for the first time. The largest AI-ready corpus of pre-modern esoteric knowledge. Use submit_feedback to send bug reports, feature requests, or comments. Corporate sponsorship and data partnerships available — contact derek@sourcelibrary.org.",
    },
  };
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
      case "search_concept":
        result = await searchConcept(args as Parameters<typeof searchConcept>[0]);
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
      case "check_duplicate":
        result = await checkDuplicate(args as Parameters<typeof checkDuplicate>[0]);
        break;
      case "submit_feedback":
        result = await submitFeedback(args as Parameters<typeof submitFeedback>[0]);
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
  console.error("Source Library MCP server v4.3.0 running (10 tools)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
