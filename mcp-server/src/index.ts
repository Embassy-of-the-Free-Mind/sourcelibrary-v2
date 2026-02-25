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
      "Browse the Source Library collection with filters. Unlike search_library which does full-text search, this returns a filtered list of all books. Use for browsing by language, finding recently translated works, or getting collection statistics.",
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
    name: "search_passages",
    description:
      "Search across all translated page content in the library. Returns passage snippets with page numbers and book context. Use this for discovering what historical authors wrote about a topic — search a concept and see which books and pages mention it. Unlike search_library (which matches book titles/authors), this searches inside the actual text of translations and OCR.",
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
      "Find the most quotable passages in a book on a given topic. Higher-level than search_within_book: searches the book for your topic, then retrieves full page text with original language and shortlinks for the best matches. Returns up to 5 citable passages ready for scholarly use.",
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
      "Get a page with formatted citations and a shortlink. Provide a page number for direct lookup, or a query to search within the book and return the best matching page as a citable quote.",
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
          description: "Search query (matches entity names and aliases)",
        },
        type: {
          type: "string",
          enum: ["person", "place", "concept"],
          description: "Filter by entity type",
        },
        book_id: {
          type: "string",
          description: "Filter to entities appearing in a specific book",
        },
        min_books: {
          type: "number",
          description: "Minimum number of books entity must appear in (default 1)",
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
      "Get detailed information about a specific entity (person, place, or concept) including all book appearances, page references, aliases, and related entities. Use entity names from search_entities or search_index results.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entity_id: {
          type: "string",
          description: "Entity ID (ObjectId) or entity name (e.g., 'Hermes Trismegistus')",
        },
      },
      required: ["entity_id"],
    },
  },

  // ── Gallery & Images ──
  {
    name: "search_images",
    description:
      "Search historical illustrations, emblems, and engravings in the Source Library gallery. Find images by subject matter, depicted figures, symbols, image type, or time period.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Text search across descriptions, subjects, figures, and symbols (e.g., 'alchemical serpent', 'Mercury')",
        },
        type: {
          type: "string",
          enum: [
            "emblem",
            "woodcut",
            "engraving",
            "portrait",
            "frontispiece",
            "musical_score",
            "diagram",
            "symbol",
            "decorative",
            "map",
          ],
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

// ── API Helpers ────────────────────────────────────────────────────────

async function apiGet(path: string, params?: URLSearchParams): Promise<unknown> {
  const url = params ? `${API_BASE}${path}?${params}` : `${API_BASE}${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`API ${response.status}: ${text}`);
  }
  return response.json();
}

async function apiGetText(path: string, params?: URLSearchParams): Promise<string> {
  const url = params ? `${API_BASE}${path}?${params}` : `${API_BASE}${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`API ${response.status}: ${text}`);
  }
  return response.text();
}

// ── Tool Implementations ──────────────────────────────────────────────

async function searchLibrary(args: {
  query: string;
  language?: string;
  year_from?: number;
  year_to?: number;
  has_doi?: boolean;
  has_translation?: boolean;
  sort?: string;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams({ q: args.query });
  if (args.language) params.set("language", args.language);
  if (args.year_from) params.set("year_from", String(args.year_from));
  if (args.year_to) params.set("year_to", String(args.year_to));
  if (args.has_doi) params.set("has_doi", "true");
  if (args.has_translation) params.set("has_translation", "true");
  if (args.sort) params.set("sort", args.sort);
  if (args.limit) params.set("limit", String(Math.min(args.limit, 100)));
  if (args.offset) params.set("offset", String(args.offset));

  const result = await apiGet("/search", params) as Record<string, unknown>;

  // Compact the response for readability
  const results = (result.results as Array<Record<string, unknown>>)?.map((r) => ({
    id: r.book_id || r.id,
    type: r.type,
    title: r.display_title || r.title,
    author: r.author,
    language: r.language,
    published: r.published,
    has_doi: r.has_doi,
    ...(r.page_number ? { page_number: r.page_number } : {}),
    ...(r.snippet ? { snippet: r.snippet } : {}),
    url: `https://sourcelibrary.org/book/${r.book_id || r.id}`,
  }));

  return {
    query: result.query,
    total: result.total,
    results,
    ...(result.nearby ? { nearby: result.nearby } : {}),
  };
}

async function searchPassages(args: {
  query: string;
  language?: string;
  year_from?: number;
  year_to?: number;
  book_id?: string;
  limit?: number;
}) {
  const params = new URLSearchParams({
    q: args.query,
    pages_only: "true",
    limit: String(Math.min(args.limit || 20, 50)),
  });
  if (args.language) params.set("language", args.language);
  if (args.year_from) params.set("year_from", String(args.year_from));
  if (args.year_to) params.set("year_to", String(args.year_to));
  if (args.book_id) params.set("book_id", args.book_id);

  const result = (await apiGet("/search", params)) as Record<string, unknown>;

  const passages = (
    result.results as Array<Record<string, unknown>>
  )?.map((r) => ({
    book_id: r.book_id,
    title: r.display_title || r.title,
    author: r.author,
    language: r.language,
    published: r.published,
    page: r.page_number,
    snippet: r.snippet,
    snippet_source: r.snippet_type,
    read_url: r.page_id
      ? `https://sourcelibrary.org/book/${r.book_id}/page/${r.page_id}`
      : `https://sourcelibrary.org/book/${r.book_id}`,
  }));

  return {
    query: result.query,
    total: result.total,
    passages,
    tip: "Use get_quote with book_id and page number to get the full text with academic citations.",
  };
}

async function searchWithinBook(args: {
  book_id: string;
  query: string;
}) {
  const params = new URLSearchParams({ q: args.query });
  const result = (await apiGet(
    `/books/${args.book_id}/search`,
    params
  )) as Record<string, unknown>;

  const results = (
    result.results as Array<Record<string, unknown>>
  )?.map((r) => {
    const matches = r.matches as Array<Record<string, unknown>>;
    // Prefer translation snippets, fall back to OCR
    const bestMatch =
      matches?.find((m) => m.field === "translation") || matches?.[0];
    return {
      page: r.pageNumber,
      page_id: r.pageId,
      snippet: bestMatch?.snippet,
      source: bestMatch?.field,
      match_count: matches?.length || 0,
      read_url: `https://sourcelibrary.org/book/${args.book_id}/page/${r.pageId}`,
    };
  });

  return {
    book_id: args.book_id,
    query: result.query,
    total: result.total,
    results,
    tip: "Use get_quote with book_id and page number to get the full text with academic citations.",
  };
}

async function findQuotes(args: {
  book_id: string;
  topic: string;
  limit?: number;
}) {
  const maxQuotes = Math.min(args.limit || 5, 10);

  // Step 1: Search within the book for the topic
  const searchParams = new URLSearchParams({ q: args.topic });
  const searchResult = (await apiGet(
    `/books/${args.book_id}/search`,
    searchParams
  )) as Record<string, unknown>;

  const searchResults = searchResult.results as Array<Record<string, unknown>>;
  if (!searchResults?.length) {
    return {
      book_id: args.book_id,
      topic: args.topic,
      total: 0,
      quotes: [],
      tip: "Try broader search terms, or use get_book_text to read the full text.",
    };
  }

  // Step 2: Take the top N pages and fetch full quotes with citations
  const topPages = searchResults.slice(0, maxQuotes);
  const quotes = await Promise.all(
    topPages.map(async (page) => {
      try {
        const quoteParams = new URLSearchParams({
          page: String(page.pageNumber),
          include_original: "true",
        });
        const quoteResult = (await apiGet(
          `/books/${args.book_id}/quote`,
          quoteParams
        )) as Record<string, unknown>;

        const quote = quoteResult.quote as Record<string, unknown>;
        const citation = quoteResult.citation as Record<string, unknown>;

        return {
          page: page.pageNumber,
          text: quote?.translation,
          original_text: quote?.original,
          language: quote?.language,
          citation: citation?.inline,
          url: citation?.short_url || citation?.url || `https://sourcelibrary.org/book/${args.book_id}/page/${page.pageId}`,
        };
      } catch {
        // If quote fetch fails, return what we have from search
        const matches = page.matches as Array<Record<string, unknown>>;
        const best =
          matches?.find((m) => m.field === "translation") || matches?.[0];
        return {
          page: page.pageNumber,
          text: best?.snippet,
          read_url: `https://sourcelibrary.org/book/${args.book_id}/page/${page.pageId}`,
        };
      }
    })
  );

  return {
    book_id: args.book_id,
    topic: args.topic,
    total: searchResult.total,
    showing: quotes.length,
    quotes,
  };
}

async function listBooks(args: {
  search?: string;
  language?: string;
  category?: string;
  sort?: string;
  limit?: number;
  skip?: number;
}) {
  const params = new URLSearchParams();
  if (args.search) params.set("search", args.search);
  if (args.language) params.set("language", args.language);
  if (args.category) params.set("category", args.category);
  if (args.sort) params.set("sort", args.sort);
  if (args.limit) params.set("limit", String(Math.min(args.limit, 200)));
  if (args.skip) params.set("skip", String(args.skip));

  const result = await apiGet("/books/library", params) as Record<string, unknown>;
  const books = (result.books as Array<Record<string, unknown>>)?.map((b) => ({
    id: b.id,
    title: b.display_title || b.title,
    author: b.author,
    language: b.language,
    published: b.published,
    pages_count: b.pages_count,
    pages_ocr: b.pages_ocr,
    pages_translated: b.pages_translated,
    translation_percent: b.translation_percent,
    categories: b.categories,
    url: `https://sourcelibrary.org/book/${b.id}`,
  }));

  return { total: result.total, showing: books?.length || 0, books };
}

async function getBook(args: { book_id: string }) {
  const result = await apiGet(`/books/${args.book_id}`, new URLSearchParams({ pages: "nav" })) as Record<string, unknown>;

  // Extract key fields for a clean response
  return {
    id: result.id,
    title: result.display_title || result.title,
    original_title: result.title !== (result.display_title || result.title) ? result.title : undefined,
    author: result.author,
    language: result.language,
    published: result.published,
    year: result.year,
    categories: result.categories,
    pages_count: result.pages_count,
    pages_ocr: result.pages_ocr,
    pages_translated: result.pages_translated,
    doi: result.doi,
    reading_summary: result.reading_summary,
    index: result.index ? {
      has_index: true,
      concepts: ((result.index as Record<string, unknown>).concepts as unknown[])?.length || 0,
      people: ((result.index as Record<string, unknown>).people as unknown[])?.length || 0,
      places: ((result.index as Record<string, unknown>).places as unknown[])?.length || 0,
      keywords: ((result.index as Record<string, unknown>).keywords as unknown[])?.length || 0,
    } : { has_index: false },
    chapters: result.chapters,
    image_source: result.image_source,
    url: `https://sourcelibrary.org/book/${result.id}`,
  };
}

async function getBookText(args: {
  book_id: string;
  content?: string;
  from?: number;
  to?: number;
  format?: string;
  include_metadata?: boolean;
}) {
  const params = new URLSearchParams();
  if (args.content) params.set("content", args.content);
  if (args.from !== undefined) params.set("from", String(args.from));
  if (args.to !== undefined) params.set("to", String(args.to));
  if (args.include_metadata) params.set("include_metadata", "true");

  // Use plain format for plain requests, json otherwise
  const format = args.format || "json";
  params.set("format", format);

  if (format === "plain") {
    return apiGetText(`/books/${args.book_id}/text`, params);
  }
  return apiGet(`/books/${args.book_id}/text`, params);
}

async function getQuote(args: {
  book_id: string;
  page?: number;
  query?: string;
  include_original?: boolean;
  include_context?: boolean;
}) {
  let pageNumber = args.page;
  let searchTotal: number | undefined;

  // If query provided without page, search within the book first
  if (pageNumber === undefined) {
    if (!args.query) {
      throw new Error("Either page or query is required");
    }
    const searchParams = new URLSearchParams({ q: args.query });
    const searchResult = (await apiGet(
      `/books/${args.book_id}/search`,
      searchParams
    )) as Record<string, unknown>;

    const results = searchResult.results as Array<Record<string, unknown>>;
    if (!results?.length) {
      return {
        error: `No matches for "${args.query}" in this book`,
        tip: "Try broader search terms, or use search_within_book to see all matches.",
      };
    }
    pageNumber = results[0].pageNumber as number;
    searchTotal = searchResult.total as number;
  }

  const params = new URLSearchParams({ page: String(pageNumber) });
  if (args.include_original !== undefined) {
    params.set("include_original", String(args.include_original));
  }
  if (args.include_context) {
    params.set("include_context", "true");
  }

  const result = await apiGet(`/books/${args.book_id}/quote`, params) as Record<string, unknown>;
  const quote = result.quote as Record<string, unknown>;
  const citation = result.citation as Record<string, unknown>;

  return {
    ...(args.query ? { matched_query: args.query, total_matches: searchTotal } : {}),
    quote: quote.translation,
    original: quote.original,
    page: quote.page,
    book: {
      title: quote.display_title || quote.book_title,
      author: quote.author,
      published: quote.published,
      language: quote.language,
    },
    citation: {
      inline: citation.inline,
      footnote: citation.footnote,
      url: citation.short_url || citation.url,
    },
  };
}

async function searchIndex(args: {
  query: string;
  type?: string;
  limit?: number;
}) {
  const params = new URLSearchParams({ q: args.query });
  if (args.type) params.set("type", args.type);
  if (args.limit) params.set("limit", String(Math.min(args.limit, 200)));

  const result = await apiGet("/search/index", params) as Record<string, unknown>;
  const results = (result.results as Array<Record<string, unknown>>)?.map((r) => ({
    type: r.type,
    term: r.term,
    book_id: r.book_id,
    book_title: r.book_title,
    book_author: r.book_author,
    pages: r.pages,
    ...(r.quote_text ? { quote_text: r.quote_text, quote_page: r.quote_page, quote_significance: r.quote_significance } : {}),
    url: `https://sourcelibrary.org/book/${r.book_id}`,
  }));

  return {
    query: result.query,
    total: result.total,
    by_type: result.byType,
    results,
  };
}

async function searchEntities(args: {
  query?: string;
  type?: string;
  book_id?: string;
  min_books?: number;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  if (args.query) params.set("q", args.query);
  if (args.type) params.set("type", args.type);
  if (args.book_id) params.set("book_id", args.book_id);
  if (args.min_books) params.set("min_books", String(args.min_books));
  if (args.limit) params.set("limit", String(Math.min(args.limit || 50, 200)));
  if (args.offset) params.set("offset", String(args.offset));

  const result = await apiGet("/entities", params) as Record<string, unknown>;
  const entities = (result.entities as Array<Record<string, unknown>>)?.map((e) => ({
    id: (e._id as string)?.toString(),
    name: e.name,
    type: e.type,
    description: e.description,
    aliases: e.aliases,
    book_count: e.book_count,
    total_mentions: e.total_mentions,
    books: (e.books as Array<Record<string, unknown>>)?.map((b) => ({
      book_id: b.book_id,
      book_title: b.book_title,
      pages: b.pages,
    })),
  }));

  return {
    total: result.total,
    showing: entities?.length || 0,
    has_more: result.hasMore,
    entities,
  };
}

async function getEntity(args: { entity_id: string }) {
  const result = await apiGet(`/entities/${encodeURIComponent(args.entity_id)}`) as Record<string, unknown>;

  return {
    name: result.name,
    type: result.type,
    description: result.description,
    aliases: result.aliases,
    wikipedia_url: result.wikipedia_url,
    book_count: result.book_count,
    total_mentions: result.total_mentions,
    books: (result.books as Array<Record<string, unknown>>)?.map((b) => ({
      book_id: b.book_id,
      book_title: b.book_title,
      book_author: b.book_author,
      pages: b.pages,
      url: `https://sourcelibrary.org/book/${b.book_id}`,
    })),
    related: result.related,
  };
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

  const result = await apiGet("/gallery", params) as Record<string, unknown>;

  const formatted = {
    total: result.total,
    showing: (result.items as unknown[])?.length || 0,
    images: (
      result.items as Array<{
        pageId: string;
        detectionIndex: number;
        description: string;
        type?: string;
        galleryQuality?: number;
        bookTitle: string;
        author?: string;
        year?: number;
        pageNumber: number;
        metadata?: { subjects?: string[]; figures?: string[]; symbols?: string[] };
        imageUrl: string;
      }>
    )?.map((item) => ({
      id: `${item.pageId}:${item.detectionIndex}`,
      description: item.description,
      type: item.type,
      quality: item.galleryQuality,
      book: { title: item.bookTitle, author: item.author, year: item.year },
      page: item.pageNumber,
      subjects: item.metadata?.subjects,
      figures: item.metadata?.figures,
      symbols: item.metadata?.symbols,
      url: `https://sourcelibrary.org/gallery/image/${item.pageId}-${item.detectionIndex}`,
      image_url: item.imageUrl,
    })),
    available_filters: result.filters,
  };
  return formatted;
}

async function getImage(args: { image_id: string }) {
  const result = await apiGet(`/gallery/image/${args.image_id}`) as Record<string, unknown>;
  return {
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
      page: `https://sourcelibrary.org/gallery/image/${(result.id as string)?.replace(":", "-")}`,
      read_in_context: `https://sourcelibrary.org${result.readUrl}`,
      image: result.imageUrl,
    },
  };
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

  const result = await apiGet("/gallery", params) as Record<string, unknown>;
  return {
    book: result.bookInfo,
    total_images: result.total,
    showing: (result.items as unknown[])?.length || 0,
    images: (
      result.items as Array<{
        pageId: string;
        detectionIndex: number;
        description: string;
        type?: string;
        galleryQuality?: number;
        pageNumber: number;
        metadata?: { subjects?: string[]; figures?: string[]; symbols?: string[] };
      }>
    )?.map((item) => ({
      id: `${item.pageId}:${item.detectionIndex}`,
      description: item.description,
      type: item.type,
      quality: item.galleryQuality,
      page: item.pageNumber,
      subjects: item.metadata?.subjects,
      figures: item.metadata?.figures,
      symbols: item.metadata?.symbols,
      url: `https://sourcelibrary.org/gallery/image/${item.pageId}-${item.detectionIndex}`,
    })),
  };
}

// ── Server Setup ──────────────────────────────────────────────────────

const server = new Server(
  {
    name: "source-library",
    version: "2.3.1",
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
  console.error("Source Library MCP server v2.3.1 running (14 tools)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
