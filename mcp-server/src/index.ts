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

// Create server
const server = new Server(
  {
    name: "source-library",
    version: "1.0.0",
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
