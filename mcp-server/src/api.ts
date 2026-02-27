// Shared API client and tool implementations
// Used by both MCP server (index.ts) and CLI (cli.ts)

export const API_BASE = process.env.SOURCE_LIBRARY_API || "https://sourcelibrary.org/api";

// ── API Helpers ────────────────────────────────────────────────────────

export async function apiGet(path: string, params?: URLSearchParams): Promise<unknown> {
  const url = params ? `${API_BASE}${path}?${params}` : `${API_BASE}${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`API ${response.status}: ${text}`);
  }
  return response.json();
}

export async function apiGetText(path: string, params?: URLSearchParams): Promise<string> {
  const url = params ? `${API_BASE}${path}?${params}` : `${API_BASE}${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`API ${response.status}: ${text}`);
  }
  return response.text();
}

// ── Tool Implementations ──────────────────────────────────────────────

export async function searchLibrary(args: {
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
    url: `https://sourcelibrary.org/book/${r.slug || r.book_id || r.id}`,
  }));

  return {
    query: result.query,
    total: result.total,
    results,
    ...(result.nearby ? { nearby: result.nearby } : {}),
  };
}

export async function searchPassages(args: {
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
      ? `https://sourcelibrary.org/book/${r.slug || r.book_id}/page/${r.page_id}`
      : `https://sourcelibrary.org/book/${r.slug || r.book_id}`,
  }));

  return {
    query: result.query,
    total: result.total,
    passages,
    tip: "Use get_quote with book_id and page number to get the full text with academic citations.",
  };
}

export async function searchWithinBook(args: {
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

export async function findQuotes(args: {
  book_id: string;
  topic: string;
  limit?: number;
}) {
  const maxQuotes = Math.min(args.limit || 5, 10);

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

export async function listBooks(args: {
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
    url: `https://sourcelibrary.org/book/${b.slug || b.id}`,
  }));

  return { total: result.total, showing: books?.length || 0, books };
}

export async function getBook(args: { book_id: string }) {
  const result = await apiGet(`/books/${args.book_id}`, new URLSearchParams({ pages: "nav" })) as Record<string, unknown>;

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
    url: `https://sourcelibrary.org/book/${result.slug || result.id}`,
  };
}

export async function getBookText(args: {
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

  const format = args.format || "json";
  params.set("format", format);

  if (format === "plain") {
    return apiGetText(`/books/${args.book_id}/text`, params);
  }
  return apiGet(`/books/${args.book_id}/text`, params);
}

export async function getQuote(args: {
  book_id: string;
  page?: number;
  query?: string;
  include_original?: boolean;
  include_context?: boolean;
}) {
  let pageNumber = args.page;
  let searchTotal: number | undefined;

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

export async function searchIndex(args: {
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
    url: `https://sourcelibrary.org/book/${r.book_slug || r.book_id}`,
  }));

  return {
    query: result.query,
    total: result.total,
    by_type: result.byType,
    results,
  };
}

export async function searchEntities(args: {
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

export async function getEntity(args: { entity_id: string }) {
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
      url: `https://sourcelibrary.org/book/${b.book_slug || b.book_id}`,
    })),
    related: result.related,
  };
}

export async function searchImages(args: {
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

  return {
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
}

export async function getImage(args: { image_id: string }) {
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

export async function getBookImages(args: {
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
