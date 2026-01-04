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

// Configuration
const API_BASE = process.env.SOURCE_LIBRARY_API || "https://sourcelibrary.org/api";

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: "search_library",
    description: "Search the Source Library collection of translated historical texts. Returns books and pages matching the query.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (searches titles, authors, translations)",
        },
        language: {
          type: "string",
          description: "Filter by original language (e.g., 'Latin', 'German')",
        },
        date_from: {
          type: "string",
          description: "Filter by publication year (start)",
        },
        date_to: {
          type: "string",
          description: "Filter by publication year (end)",
        },
        has_doi: {
          type: "boolean",
          description: "Only return books with DOIs",
        },
        has_translation: {
          type: "boolean",
          description: "Only return books with translations",
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default 10)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_images",
    description: "Search historical illustrations, emblems, and engravings in the Source Library gallery. Find images by subject matter, depicted figures, symbols, image type, or time period.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Text search across descriptions, subjects, figures, and symbols (e.g., 'alchemical serpent', 'Mercury')",
        },
        type: {
          type: "string",
          enum: ["emblem", "woodcut", "engraving", "portrait", "frontispiece", "musical_score", "diagram", "symbol", "decorative", "map"],
          description: "Filter by image type",
        },
        subject: {
          type: "string",
          description: "Filter by subject tag (e.g., 'alchemy', 'astronomy', 'medicine')",
        },
        figure: {
          type: "string",
          description: "Filter by depicted figure (e.g., 'Mercury', 'serpent', 'angel')",
        },
        symbol: {
          type: "string",
          description: "Filter by symbol (e.g., 'ouroboros', 'athanor', 'philosophical egg')",
        },
        year_from: {
          type: "number",
          description: "Filter by book publication year (start)",
        },
        year_to: {
          type: "number",
          description: "Filter by book publication year (end)",
        },
        book_id: {
          type: "string",
          description: "Filter to images from a specific book",
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
    description: "Get detailed information about a specific image including full metadata, museum description, and source book context.",
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
    description: "Get all extracted images from a specific book. Useful for exploring the visual content of a particular text.",
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
  {
    name: "get_quote",
    description: "Get a quote from a specific page of a book with formatted citations. Use after searching to retrieve specific passages.",
    inputSchema: {
      type: "object" as const,
      properties: {
        book_id: {
          type: "string",
          description: "The book ID from search results",
        },
        page: {
          type: "number",
          description: "Page number to get quote from",
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
      required: ["book_id", "page"],
    },
  },
  {
    name: "get_book",
    description: "Get detailed information about a specific book including summary, edition info, and DOI.",
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
];

// API helpers
async function searchLibrary(args: {
  query: string;
  language?: string;
  date_from?: string;
  date_to?: string;
  has_doi?: boolean;
  has_translation?: boolean;
  limit?: number;
}) {
  const params = new URLSearchParams({ q: args.query });
  if (args.language) params.set("language", args.language);
  if (args.date_from) params.set("date_from", args.date_from);
  if (args.date_to) params.set("date_to", args.date_to);
  if (args.has_doi) params.set("has_doi", "true");
  if (args.has_translation) params.set("has_translation", "true");
  if (args.limit) params.set("limit", String(args.limit));

  const response = await fetch(`${API_BASE}/search?${params}`);
  if (!response.ok) {
    throw new Error(`Search failed: ${response.statusText}`);
  }
  return response.json();
}

async function getQuote(args: {
  book_id: string;
  page: number;
  include_original?: boolean;
  include_context?: boolean;
}) {
  const params = new URLSearchParams({ page: String(args.page) });
  if (args.include_original !== undefined) {
    params.set("include_original", String(args.include_original));
  }
  if (args.include_context) {
    params.set("include_context", "true");
  }

  const response = await fetch(`${API_BASE}/books/${args.book_id}/quote?${params}`);
  if (!response.ok) {
    throw new Error(`Get quote failed: ${response.statusText}`);
  }
  return response.json();
}

async function getBook(args: { book_id: string }) {
  const response = await fetch(`${API_BASE}/books/${args.book_id}`);
  if (!response.ok) {
    throw new Error(`Get book failed: ${response.statusText}`);
  }
  return response.json();
}

async function searchImages(args: {
  query?: string;
  type?: string;
  subject?: string;
  figure?: string;
  symbol?: string;
  year_from?: number;
  year_to?: number;
  book_id?: string;
  min_quality?: number;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (args.query) params.set("q", args.query);
  if (args.type) params.set("type", args.type);
  if (args.subject) params.set("subject", args.subject);
  if (args.figure) params.set("figure", args.figure);
  if (args.symbol) params.set("symbol", args.symbol);
  if (args.year_from) params.set("yearStart", String(args.year_from));
  if (args.year_to) params.set("yearEnd", String(args.year_to));
  if (args.book_id) params.set("bookId", args.book_id);
  if (args.min_quality !== undefined) params.set("minQuality", String(args.min_quality));
  params.set("limit", String(Math.min(args.limit || 20, 50)));

  const response = await fetch(`${API_BASE}/gallery?${params}`);
  if (!response.ok) {
    throw new Error(`Search images failed: ${response.statusText}`);
  }
  return response.json();
}

async function getImage(args: { image_id: string }) {
  const response = await fetch(`${API_BASE}/gallery/image/${args.image_id}`);
  if (!response.ok) {
    throw new Error(`Get image failed: ${response.statusText}`);
  }
  return response.json();
}

async function getBookImages(args: {
  book_id: string;
  min_quality?: number;
  limit?: number;
}) {
  const params = new URLSearchParams({
    bookId: args.book_id,
    limit: String(args.limit || 50),
  });
  if (args.min_quality !== undefined) {
    params.set("minQuality", String(args.min_quality));
  }

  const response = await fetch(`${API_BASE}/gallery?${params}`);
  if (!response.ok) {
    throw new Error(`Get book images failed: ${response.statusText}`);
  }
  return response.json();
}

// Create server
const server = new Server(
  {
    name: "source-library",
    version: "1.1.0",
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
    switch (name) {
      case "search_library": {
        const result = await searchLibrary(args as Parameters<typeof searchLibrary>[0]);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_quote": {
        const result = await getQuote(args as Parameters<typeof getQuote>[0]);
        // Format for easy reading
        const formatted = {
          quote: result.quote.translation,
          original: result.quote.original,
          page: result.quote.page,
          book: {
            title: result.quote.display_title || result.quote.book_title,
            author: result.quote.author,
            published: result.quote.published,
            language: result.quote.language,
          },
          citation: {
            inline: result.citation.inline,
            footnote: result.citation.footnote,
            doi_url: result.citation.doi_url,
          },
        };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      }

      case "get_book": {
        const result = await getBook(args as Parameters<typeof getBook>[0]);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "search_images": {
        const result = await searchImages(args as Parameters<typeof searchImages>[0]);
        // Format for easy reading
        const formatted = {
          total: result.total,
          showing: result.items.length,
          images: result.items.map((item: {
            pageId: string;
            detectionIndex: number;
            description: string;
            type?: string;
            galleryQuality?: number;
            bookTitle: string;
            author?: string;
            year?: number;
            pageNumber: number;
            metadata?: {
              subjects?: string[];
              figures?: string[];
              symbols?: string[];
            };
            imageUrl: string;
          }) => ({
            id: `${item.pageId}:${item.detectionIndex}`,
            description: item.description,
            type: item.type,
            quality: item.galleryQuality,
            book: {
              title: item.bookTitle,
              author: item.author,
              year: item.year,
            },
            page: item.pageNumber,
            subjects: item.metadata?.subjects,
            figures: item.metadata?.figures,
            symbols: item.metadata?.symbols,
            url: `https://sourcelibrary.org/gallery/image/${item.pageId}:${item.detectionIndex}`,
            image_url: item.imageUrl,
          })),
          available_filters: result.filters,
        };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      }

      case "get_image": {
        const result = await getImage(args as Parameters<typeof getImage>[0]);
        const formatted = {
          id: result.id,
          description: result.description,
          museum_description: result.museumDescription,
          type: result.type,
          quality: result.galleryQuality,
          quality_rationale: result.galleryRationale,
          metadata: result.metadata,
          book: result.book,
          page: result.pageNumber,
          citation: result.citation,
          urls: {
            page: `https://sourcelibrary.org/gallery/image/${result.id}`,
            read_in_context: `https://sourcelibrary.org${result.readUrl}`,
            image: result.imageUrl,
          },
        };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      }

      case "get_book_images": {
        const result = await getBookImages(args as Parameters<typeof getBookImages>[0]);
        const formatted = {
          book: result.bookInfo,
          total_images: result.total,
          showing: result.items.length,
          images: result.items.map((item: {
            pageId: string;
            detectionIndex: number;
            description: string;
            type?: string;
            galleryQuality?: number;
            pageNumber: number;
            metadata?: {
              subjects?: string[];
              figures?: string[];
              symbols?: string[];
            };
          }) => ({
            id: `${item.pageId}:${item.detectionIndex}`,
            description: item.description,
            type: item.type,
            quality: item.galleryQuality,
            page: item.pageNumber,
            subjects: item.metadata?.subjects,
            figures: item.metadata?.figures,
            symbols: item.metadata?.symbols,
            url: `https://sourcelibrary.org/gallery/image/${item.pageId}:${item.detectionIndex}`,
          })),
        };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
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
  // For now, return empty - we could list all books here
  return { resources: [] };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  // Parse book:// URIs
  const bookMatch = uri.match(/^book:\/\/([^/]+)(?:\/page\/(\d+))?$/);
  if (!bookMatch) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const [, bookId, pageNum] = bookMatch;

  if (pageNum) {
    // Get specific page
    const result = await getQuote({ book_id: bookId, page: parseInt(pageNum) });
    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: result.quote.translation,
        },
      ],
    };
  } else {
    // Get book info
    const result = await getBook({ book_id: bookId });
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Source Library MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
