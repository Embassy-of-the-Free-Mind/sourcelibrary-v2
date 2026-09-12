// Shared API client and tool implementations
// Used by both MCP server (index.ts) and CLI (cli.ts)

export const API_BASE = process.env.SOURCE_LIBRARY_API || "https://sourcelibrary.org/api";

const MCP_HEADERS = {
  "User-Agent": "SourceLibrary-MCP/4.2",
  "Accept-Language": "en",
};

// ── API Helpers ────────────────────────────────────────────────────────

/**
 * Carries the HTTP status and parsed body of a failed upstream call so the
 * MCP layer can emit a structured, machine-readable error (see index.ts)
 * instead of an opaque string. This is what lets a research agent branch on
 * `rate_limited` vs `auth_required` vs `transient` rather than guessing from
 * prose — the in-repo half of the fix for issue #2823 (the bare opaque error).
 */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, rawText: string) {
    super(`API ${status}: ${rawText}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function failFromResponse(response: Response): Promise<never> {
  const rawText = await response.text().catch(() => response.statusText);
  let body: unknown = rawText;
  try {
    body = JSON.parse(rawText);
  } catch {
    // non-JSON body — keep the raw text
  }
  throw new ApiError(response.status, body, rawText);
}

export async function apiGet(path: string, params?: URLSearchParams): Promise<unknown> {
  const url = params ? `${API_BASE}${path}?${params}` : `${API_BASE}${path}`;
  const response = await fetch(url, { headers: MCP_HEADERS });
  if (!response.ok) {
    return failFromResponse(response);
  }
  return response.json();
}

export async function apiPost(path: string, body: unknown): Promise<unknown> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { ...MCP_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return failFromResponse(response);
  }
  return response.json();
}

export async function apiGetText(path: string, params?: URLSearchParams): Promise<string> {
  const url = params ? `${API_BASE}${path}?${params}` : `${API_BASE}${path}`;
  const response = await fetch(url, { headers: MCP_HEADERS });
  if (!response.ok) {
    return failFromResponse(response);
  }
  return response.text();
}

// ── Tool Implementations ──────────────────────────────────────────────

export async function submitFeedback(args: {
  message: string;
  name?: string;
  email?: string;
  page?: string;
}) {
  await apiPost("/feedback", {
    message: args.message,
    name: args.name || null,
    email: args.email || null,
    page: args.page || null,
  });

  return {
    ok: true,
    message: "Feedback submitted successfully. Thank you!",
  };
}

export async function shareFindings(args: {
  title: string;
  summary?: string;
  citations: { book_id: string; page: number; note?: string }[];
  name?: string;
  email?: string;
}) {
  const result = await apiPost("/share-findings", {
    title: args.title,
    summary: args.summary || null,
    citations: args.citations || [],
    name: args.name || null,
    email: args.email || null,
  }) as Record<string, unknown>;

  return {
    ok: true,
    id: result.id,
    message: result.message || "Findings shared with the Source Library team. Thank you!",
  };
}

export async function checkDuplicate(args: {
  title: string;
  author?: string;
  year?: string;
  language?: string;
  ia_id?: string;
  manifest?: string;
}) {
  const params = new URLSearchParams({ title: args.title });
  if (args.author) params.set("author", args.author);
  if (args.year) params.set("year", args.year);
  if (args.language) params.set("language", args.language);
  if (args.ia_id) params.set("ia_id", args.ia_id);
  if (args.manifest) params.set("manifest", args.manifest);

  const result = await apiGet("/books/check-duplicate", params) as Record<string, unknown>;

  return {
    isDuplicate: result.isDuplicate,
    confidence: result.confidence,
    suggestion: result.suggestion,
    matches: (result.matches as Array<Record<string, unknown>>)?.map((m) => ({
      book_id: m.book_id,
      title: m.title,
      display_title: m.display_title,
      author: m.author,
      language: m.language,
      year: m.year,
      match_type: m.match_type,
      confidence: m.confidence,
      similarity: m.similarity,
      url: m.url,
    })),
    normalization: result.normalization,
  };
}

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
  if (args.limit) params.set("limit", String(Math.min(args.limit, 500)));
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
    iiif_manifest: `https://sourcelibrary.org/api/iiif/${r.book_id || r.id}/manifest`,
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
  languages?: string[];
  exclude_languages?: string[];
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
  if (Array.isArray(args.languages) && args.languages.length > 0)
    params.set("languages", args.languages.join(","));
  if (Array.isArray(args.exclude_languages) && args.exclude_languages.length > 0)
    params.set("exclude_languages", args.exclude_languages.join(","));
  if (args.year_from) params.set("year_from", String(args.year_from));
  if (args.year_to) params.set("year_to", String(args.year_to));
  if (args.book_id) params.set("book_id", args.book_id);

  const result = (await apiGet("/search", params)) as Record<string, unknown>;

  const passages = (
    result.results as Array<Record<string, unknown>>
  )?.map((r) => {
    const snippetType = r.snippet_type as string | undefined;
    const snippetLanguage = snippetType === 'ocr' ? r.language : 'English';
    return {
      book_id: r.book_id,
      title: r.display_title || r.title,
      author: r.author,
      original_language: r.language,
      snippet_language: snippetLanguage,
      published: r.published,
      page: r.page_number,
      snippet: r.snippet,
      snippet_source: snippetType,
      url: `https://sourcelibrary.org/book/${r.slug || r.book_id}?page=${r.page_number || 1}`,
    };
  }).filter((p) => !!(p.snippet as string | undefined)?.trim());

  return {
    query: result.query,
    total: result.total,
    passages,
    tip: "Use get_book_text with book_id to read the full text around these passages.",
  };
}

export async function searchConcept(args: {
  query: string;
  language?: string;
  languages?: string[];
  exclude_languages?: string[];
  year_from?: number;
  year_to?: number;
  limit?: number;
}) {
  const params = new URLSearchParams({
    q: args.query,
    level: "page",
    limit: String(Math.min(args.limit || 15, 50)),
  });
  if (args.language) params.set("language", args.language);
  if (Array.isArray(args.languages) && args.languages.length > 0)
    params.set("languages", args.languages.join(","));
  if (Array.isArray(args.exclude_languages) && args.exclude_languages.length > 0)
    params.set("exclude_languages", args.exclude_languages.join(","));
  if (args.year_from) params.set("year_min", String(args.year_from));
  if (args.year_to) params.set("year_max", String(args.year_to));

  const result = (await apiGet("/search/semantic", params)) as Record<string, unknown>;

  const passages = (result.results as Array<Record<string, unknown>>)?.map((r) => ({
    book_id: r.book_id,
    title: r.book_title,
    author: r.book_author,
    original_language: r.book_language,
    snippet_language: 'English',
    published: r.book_year,
    page: r.page_number,
    snippet: r.snippet,
    snippet_type: "translation",
    similarity: r.score,
    url: `https://sourcelibrary.org/book/${r.slug || r.book_id}?page=${r.page_number || 1}`,
  })).filter((p) => !!(p.snippet as string | undefined)?.trim()) || [];

  return {
    query: result.query,
    total_matches: passages.length,
    returned: passages.length,
    passages,
    tip: "Results ranked by conceptual similarity (Gemini embeddings). Treat scores below ~0.45 with skepticism.",
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

  // Cover art, preferring the canonical R2 fields (cover-write contract).
  // cover_thumb_url feeds the inline image block in index.ts; the full
  // display URL rides alongside for callers that want to link it.
  const coverThumb = (result.image_thumb || result.thumbnail_blob || result.image_display || result.thumbnail) as string | undefined;
  const coverFull = (result.image_display || result.thumbnail || result.image_thumb || result.thumbnail_blob) as string | undefined;

  return {
    id: result.id,
    ...(coverThumb ? { cover_thumb_url: coverThumb } : {}),
    ...(coverFull ? { cover_image_url: coverFull } : {}),
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
    iiif_manifest: `https://sourcelibrary.org/api/iiif/${result.id}/manifest`,
    dts_resource: `https://sourcelibrary.org/api/dts/collection?id=${result.id}`,
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

  // Detect truncation: signal clearly when pages_returned < total_pages so LLMs
  // don't infer "the book ends here" from an incomplete response.
  const totalPages = Number(result.total_pages || 0);
  const pagesReturned = Number(result.pages_returned || 0);
  // Chapter mode returns different shape — only add truncation signal for page-range mode
  if (args.chapter === undefined && totalPages > 0) {
    const fromPage = args.from !== undefined ? args.from : 1;
    const expectedUpTo = args.to !== undefined ? args.to : totalPages;
    const lastPageReturned = pagesReturned > 0 ? fromPage + pagesReturned - 1 : fromPage - 1;
    const isTruncated = lastPageReturned < expectedUpTo;
    (result as Record<string, unknown>).truncated = isTruncated;
    if (isTruncated) {
      const nextFrom = lastPageReturned + 1;
      const nextTo = Math.min(nextFrom + 49, totalPages);
      (result as Record<string, unknown>).truncation_note =
        `TRUNCATED — received ${pagesReturned} pages (up to p.${lastPageReturned}) ` +
        `but requested up to p.${expectedUpTo} of ${totalPages} total. ` +
        `This is NOT end-of-book — call get_book_text again with from=${nextFrom} to=${nextTo} ` +
        `to read the next chunk. Repeat until you reach total_pages (${totalPages}).`;
    }
  }

  // Add quoting guidance when returning page text. Reinforce the house style:
  // every quote shown to the user carries its page number and the page's
  // sourcelibrary.org url (each page entry includes both).
  (result as Record<string, unknown>).tip =
    "When quoting from these pages, copy text verbatim from the translation field — do not paraphrase or reconstruct from memory. " +
    "Present each quote to the user with its page number and the page's url (sourcelibrary.org link).";

  return result;
}

// The shareable shortlink lives at result.citation.short_url. Lift it to a
// headline `citation_link` (and keep `short_url` for back-compat) so an LLM
// caller treats the quote-plus-link as the deliverable instead of burying the
// link in a citation sub-object and paraphrasing without it (#2820).
function withCitationLink(result: Record<string, unknown>): Record<string, unknown> {
  const citation = result.citation as Record<string, unknown> | undefined;
  const link = citation?.short_url as string | undefined;
  return link ? { citation_link: link, short_url: link, ...result } : result;
}

const QUOTE_TIP =
  "Copy the translation text exactly when quoting — do not paraphrase or " +
  "reconstruct from memory, even if you know this text from other sources. " +
  "Present the citation_link to the user alongside the quote. Render as:\n" +
  "> [exact translation text, verbatim]\n" +
  "> — [Author], p. [N]. [citation_link]";

// Three-layer apparatus for non-Latin scripts (#3828). Appended only when the
// page actually carries a romanization, so a Latin-script quote is never told
// about a field that isn't there.
const ROMANIZED_TIP =
  "This page is in a non-Latin script and carries all three layers. Render as:\n" +
  "> [original, verbatim]\n" +
  "> [romanized]\n" +
  "> [translation, verbatim]\n" +
  "> — [Author], p. [N]. [citation_link]\n" +
  "The `romanized` field is AI-generated reading apparatus, not a transcription — " +
  "never present it as the text printed on the page, and quote from `original` or " +
  "`translation` when quoting the source itself.";

// An ENGLISH-ORIGINAL page carries no translation and never will — the leaf is
// already in the reader's language (#3939), so the quote API serves the
// transcription as `original` with text_source: "ocr_original". Without this the
// package would hand back that response under QUOTE_TIP, which points at a
// `translation` field that is not there: the caller either quotes nothing or
// presents the page's own words as our translation of it. Every surface reads
// its own copy of this guidance and fixes do not propagate — the in-app server
// (src/app/api/mcp/route.ts) carries the same tip.
const OCR_ORIGINAL_TIP =
  "This page is an ENGLISH ORIGINAL: the text printed on the leaf is already English, so there is " +
  "no translation and none is needed (this is why the book reports pages_translated: 0). The " +
  "verbatim text is in `original`. Copy it exactly and attribute it as the source's own words — " +
  "never call it a translation. Render as:\n" +
  "> [exact original text, verbatim]\n" +
  "> — [Author], p. [N]. [citation_link]\n" +
  "It is an uncorrected AI transcription, preserving period spelling, long-s (ſ) and printer marks: " +
  "keep them as they stand, or say that any modernization is yours.";

export async function getQuote(args: {
  book_id: string;
  page: number;
  include_image?: boolean;
}) {
  const params = new URLSearchParams({ page: String(args.page) });
  // Opt-in scan of the cited leaf (#3937): the response then carries
  // quote.page_image_url and index.ts attaches the image inline.
  if (args.include_image === true) params.set("include_image", "true");
  const result = await apiGet(`/books/${args.book_id}/quote`, params) as Record<string, unknown>;

  const quote = result.quote as Record<string, unknown> | undefined;
  const romanized = typeof quote?.romanized === "string" && quote.romanized.length > 0;
  const ocrOriginal = quote?.text_source === "ocr_original";

  const tips = [ocrOriginal ? OCR_ORIGINAL_TIP : QUOTE_TIP];
  if (romanized) tips.push(ROMANIZED_TIP);

  // Copy clause (#4360): the scan shows one library's physical copy. Appended
  // only when the API named a genuine holder, so the tip never invites the
  // model to invent one. The in-app server (src/app/api/mcp/route.ts) carries
  // the same logic — fixes do not propagate between the two copies.
  const copy = (result.citation as Record<string, unknown> | undefined)?.copy as
    | { statement?: string }
    | undefined;
  if (copy?.statement) {
    tips.push(
      `The scanned images reproduce one physical copy: "${copy.statement}". ` +
        "When citing copy-specific evidence (marginalia, provenance marks, hand-coloring), include that clause in the citation.",
    );
  }

  // Marginalia (#4362): quote.marginalia_note carries the full guidance; the
  // tip makes sure it is read rather than passed over.
  if (quote?.contains_marginalia === true) {
    tips.push(
      "This page carries MARGINAL text (<margin>…</margin>). A marginal note exists only in this " +
        "physical copy — when quoting from one, say 'marginal annotation' and follow quote.marginalia_note.",
    );
  }

  return {
    ...withCitationLink(result),
    tip: tips.join("\n\n"),
  };
}

type ImageSource = "gallery" | "artworks" | "all";

interface NormalizedImage {
  source: "gallery" | "artwork";
  type?: string | null;
  description?: string | null;
  title?: string | null;
  author?: string | null;
  year?: number | string | null;
  page?: number | null;
  quality?: number | null;
  similarity?: number | null;
  subjects?: string[];
  figures?: string[];
  symbols?: string[];
  period?: string | null;
  culture?: string | null;
  genre?: string | null;
  technique?: string | null;
  medium?: string | null;
  current_location?: string | null;
  image_url: string | null;
  url: string;
  book_url?: string | null;
}

async function fetchGallery(args: {
  query?: string; type?: string; subject?: string; figure?: string; symbol?: string;
  year_from?: number; year_to?: number; book_id?: string; min_quality?: number; limit: number;
}): Promise<NormalizedImage[]> {
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
  params.set("limit", String(args.limit));

  const result = await apiGet("/gallery", params) as Record<string, unknown>;
  const items = (result.items as Array<{
    pageId: string; detectionIndex: number; description: string; type?: string;
    galleryQuality?: number; bookTitle: string; bookId?: string; author?: string;
    year?: number; pageNumber: number;
    metadata?: { subjects?: string[]; figures?: string[]; symbols?: string[] };
    imageUrl: string; visualSimilarity?: number;
  }>) ?? [];

  return items.map(item => ({
    source: "gallery" as const,
    type: item.type ?? null,
    description: item.description,
    title: item.bookTitle,
    author: item.author ?? null,
    year: item.year ?? null,
    page: item.pageNumber,
    quality: item.galleryQuality ?? null,
    similarity: item.visualSimilarity ?? null,
    subjects: item.metadata?.subjects,
    figures: item.metadata?.figures,
    symbols: item.metadata?.symbols,
    image_url: item.imageUrl,
    url: `https://sourcelibrary.org/gallery/image/${item.pageId}-${item.detectionIndex}`,
    book_url: item.bookId ? `https://sourcelibrary.org/book/${item.bookId}?page=${item.pageNumber}` : null,
  }));
}

async function fetchArtworks(args: {
  query?: string; type?: string; subject?: string; figure?: string; symbol?: string;
  year_from?: number; year_to?: number; book_id?: string; limit: number;
}): Promise<NormalizedImage[]> {
  const params = new URLSearchParams();
  if (args.query) params.set("q", args.query);
  if (args.type) params.set("type", args.type);
  if (args.subject) params.set("subject", args.subject);
  if (args.figure) params.set("figure", args.figure);
  if (args.symbol) params.set("symbol", args.symbol);
  if (args.year_from) params.set("year_from", String(args.year_from));
  if (args.year_to) params.set("year_to", String(args.year_to));
  if (args.book_id) params.set("book_id", args.book_id);
  params.set("limit", String(args.limit));

  const result = await apiGet("/artwork/search", params) as Record<string, unknown>;
  const items = (result.items as Array<{
    id: string; title: string; author: string | null; year: number | null;
    published: string | null; type: string | null; medium: string | null;
    description: string | null; image_url: string | null; thumbnail_url: string | null;
    url: string; period?: string | null; culture?: string | null; genre?: string | null;
    technique?: string | null; subjects?: string[]; figures?: string[]; symbols?: string[];
    similarity?: number; current_location?: string | null;
  }>) ?? [];

  return items.map(item => ({
    source: "artwork" as const,
    type: item.type ?? null,
    description: item.description,
    title: item.title,
    author: item.author,
    year: item.year ?? item.published ?? null,
    page: null,
    quality: null,
    similarity: item.similarity ?? null,
    subjects: item.subjects,
    figures: item.figures,
    symbols: item.symbols,
    period: item.period ?? null,
    culture: item.culture ?? null,
    genre: item.genre ?? null,
    technique: item.technique ?? null,
    medium: item.medium ?? null,
    current_location: item.current_location ?? null,
    image_url: item.image_url ?? item.thumbnail_url ?? null,
    url: item.url,
    book_url: null,
  }));
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
  source?: ImageSource;
}) {
  const limit = Math.min(args.limit || 20, 50);
  const source: ImageSource = args.source || "all";
  const baseArgs = {
    query: args.query, type: args.type, subject: args.subject,
    figure: args.figure, symbol: args.symbol,
    year_from: args.year_from, year_to: args.year_to,
    book_id: args.book_id,
  };

  // For 'all', request both halves at full limit, then interleave so the
  // caller never sees a single source dominate just because it returns first.
  // Under book_id the artwork lane is skipped: artworks don't belong to books
  // (the artwork API's book_id means "this artwork"), so including them can
  // only un-scope a book-filtered call (#3936).
  const wantGallery = source === "all" || source === "gallery";
  const wantArtworks = (source === "all" || source === "artworks") && !args.book_id;

  const [galleryItems, artworkItems] = await Promise.all([
    wantGallery
      ? fetchGallery({ ...baseArgs, min_quality: args.min_quality, limit }).catch(() => [] as NormalizedImage[])
      : Promise.resolve([] as NormalizedImage[]),
    wantArtworks
      ? fetchArtworks({ ...baseArgs, limit }).catch(() => [] as NormalizedImage[])
      : Promise.resolve([] as NormalizedImage[]),
  ]);

  let images: NormalizedImage[];
  if (source === "gallery") {
    images = galleryItems;
  } else if (source === "artworks") {
    images = artworkItems;
  } else {
    // Interleave: artwork, gallery, artwork, gallery, ... so both surface in top results
    images = [];
    const max = Math.max(galleryItems.length, artworkItems.length);
    for (let i = 0; i < max; i++) {
      if (i < artworkItems.length) images.push(artworkItems[i]);
      if (i < galleryItems.length) images.push(galleryItems[i]);
    }
    images = images.slice(0, limit);
  }

  return {
    total: images.length,
    showing: images.length,
    source,
    counts: { gallery: galleryItems.length, artworks: artworkItems.length },
    images,
    // An empty scoped result must SAY so — silence is how the book_id no-op
    // went unnoticed on the remote server (#3936).
    ...(images.length === 0
      ? {
          note: args.book_id
            ? "This book has no catalogued images matching the query. Its illustrations may not have been extracted yet — absence here does not mean the physical book has no plates."
            : "No images matched. Try a broader query, or drop filters (type/subject/year) one at a time.",
        }
      : {}),
  };
}
