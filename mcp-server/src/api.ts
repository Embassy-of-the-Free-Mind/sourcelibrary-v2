// Shared API client and tool implementations
// Used by both MCP server (index.ts) and CLI (cli.ts)

export const API_BASE = process.env.SOURCE_LIBRARY_API || "https://sourcelibrary.org/api";

const MCP_HEADERS = {
  "User-Agent": "SourceLibrary-MCP/4.2",
  "Accept-Language": "en",
};

// ── API Helpers ────────────────────────────────────────────────────────

export async function apiGet(path: string, params?: URLSearchParams): Promise<unknown> {
  const url = params ? `${API_BASE}${path}?${params}` : `${API_BASE}${path}`;
  const response = await fetch(url, { headers: MCP_HEADERS });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`API ${response.status}: ${text}`);
  }
  return response.json();
}

export async function apiGetText(path: string, params?: URLSearchParams): Promise<string> {
  const url = params ? `${API_BASE}${path}?${params}` : `${API_BASE}${path}`;
  const response = await fetch(url, { headers: MCP_HEADERS });
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
    url: r.page_number
      ? `https://sourcelibrary.org/book/${r.slug || r.book_id || r.id}?page=${r.page_number}`
      : `https://sourcelibrary.org/book/${r.slug || r.book_id || r.id}`,
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
    url: `https://sourcelibrary.org/book/${r.slug || r.book_id}?page=${r.page_number || 1}`,
  }));

  return {
    query: result.query,
    total: result.total,
    passages,
    tip: "Use get_book_text with book_id to read the full text around these passages.",
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
      snippet: bestMatch?.snippet,
      source: bestMatch?.field,
      match_count: matches?.length || 0,
      url: `https://sourcelibrary.org/book/${args.book_id}?page=${r.pageNumber}`,
    };
  });

  return {
    book_id: args.book_id,
    query: result.query,
    total: result.total,
    results,
    tip: "Use get_book_text with from/to page numbers to read the full text around these matches.",
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
  chapter?: number;
  part?: number;
  content?: string;
  from?: number;
  to?: number;
  format?: string;
  include_metadata?: boolean;
}) {
  const params = new URLSearchParams();
  if (args.chapter !== undefined) params.set("chapter", String(args.chapter));
  if (args.part !== undefined) params.set("part", String(args.part));
  if (args.content) params.set("content", args.content);
  if (args.from !== undefined) params.set("from", String(args.from));
  if (args.to !== undefined) params.set("to", String(args.to));
  if (args.include_metadata) params.set("include_metadata", "true");

  const format = args.format || "json";
  params.set("format", format);

  if (format === "plain") {
    return apiGetText(`/books/${args.book_id}/text`, params);
  }

  // JSON format — add per-page citation URLs
  const result = await apiGet(`/books/${args.book_id}/text`, params) as Record<string, unknown>;
  const book = result.book as Record<string, unknown> | undefined;
  const bookSlug = book?.slug || book?.id || args.book_id;

  const pages = result.pages as Array<Record<string, unknown>> | undefined;
  if (pages) {
    for (const page of pages) {
      page.url = `https://sourcelibrary.org/book/${bookSlug}?page=${page.page_number}`;
    }
  }

  // Add quoting guidance when returning page text
  (result as Record<string, unknown>).tip =
    "When quoting from these pages, copy text verbatim from the translation field. Do not paraphrase or reconstruct from memory.";

  return result;
}

export async function getQuote(args: {
  book_id: string;
  page: number;
}) {
  const params = new URLSearchParams({ page: String(args.page) });
  const result = await apiGet(`/books/${args.book_id}/quote`, params) as Record<string, unknown>;

  return {
    ...result,
    tip: "Copy the translation text exactly when quoting. Do not paraphrase or reconstruct from memory, even if you know this text from other sources.",
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
        bookId?: string;
        author?: string;
        year?: number;
        pageNumber: number;
        metadata?: { subjects?: string[]; figures?: string[]; symbols?: string[] };
        imageUrl: string;
      }>
    )?.map((item) => ({
      description: item.description,
      type: item.type,
      quality: item.galleryQuality,
      book: { title: item.bookTitle, author: item.author, year: item.year },
      page: item.pageNumber,
      subjects: item.metadata?.subjects,
      figures: item.metadata?.figures,
      symbols: item.metadata?.symbols,
      image_url: item.imageUrl,
      url: `https://sourcelibrary.org/gallery/image/${item.pageId}-${item.detectionIndex}`,
      book_url: item.bookId ? `https://sourcelibrary.org/book/${item.bookId}?page=${item.pageNumber}` : undefined,
    })),
    available_filters: result.filters,
  };
}
