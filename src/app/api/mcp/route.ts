import type { NextRequest } from 'next/server';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { withApiAuth, type ApiIdentity } from '@/lib/api-auth';
import { logMcpToolCall } from '@/lib/mcp-usage';
import { getClientIp, peekRateLimit } from '@/lib/rate-limit';
import { getShortUrl } from '@/lib/shortlinks';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

// ── API helpers (same as mcp-server/src/api.ts, self-calling) ──────

const API_BASE = 'https://sourcelibrary.org/api';
const MCP_HEADERS = { 'User-Agent': 'SourceLibrary-MCP/4.3', 'Accept-Language': 'en' };

async function apiGet(path: string, params?: URLSearchParams) {
  const url = params ? `${API_BASE}${path}?${params}` : `${API_BASE}${path}`;
  const res = await fetch(url, { headers: MCP_HEADERS });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  return res.json();
}

async function apiGetText(path: string, params?: URLSearchParams) {
  const url = params ? `${API_BASE}${path}?${params}` : `${API_BASE}${path}`;
  const res = await fetch(url, { headers: MCP_HEADERS });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  return res.text();
}

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { ...MCP_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  return res.json();
}

// ── Tool implementations (mirrors mcp-server/src/api.ts) ───────────

async function searchLibrary(args: Record<string, unknown>) {
  const limit = Math.min(Number(args.limit) || 10, 100);
  const offset = Number(args.offset) || 0;
  const params = new URLSearchParams({ q: String(args.query), limit: String(limit), offset: String(offset) });
  if (args.language) params.set('language', String(args.language));
  if (args.year_from) params.set('year_from', String(args.year_from));
  if (args.year_to) params.set('year_to', String(args.year_to));
  if (args.has_doi) params.set('has_doi', 'true');
  if (args.has_translation) params.set('has_translation', 'true');
  if (args.sort) params.set('sort', String(args.sort));

  const result = await apiGet('/search', params) as Record<string, unknown>;
  const results = (result.results as Array<Record<string, unknown>>)?.map((r) => ({
    id: r.book_id || r.id,
    type: r.type,
    title: r.display_title || r.title,
    author: r.author,
    language: r.language,
    published: r.published,
    has_doi: r.has_doi,
    ...(r.page_number ? { page_number: r.page_number } : {}),
    ...(r.snippet ? { snippet: r.snippet, snippet_type: r.snippet_type } : {}),
    url: r.page_number
      ? `https://sourcelibrary.org/book/${r.slug || r.book_id || r.id}?page=${r.page_number}`
      : `https://sourcelibrary.org/book/${r.slug || r.book_id || r.id}`,
    iiif_manifest: `https://sourcelibrary.org/api/iiif/${r.book_id || r.id}/manifest`,
  })) || [];
  return {
    query: result.query,
    total_matches: result.total,
    returned: results.length,
    offset,
    results,
    ...(result.nearby ? { nearby: result.nearby } : {}),
  };
}

async function searchPassages(args: Record<string, unknown>) {
  const limit = Math.min(Number(args.limit) || 20, 50);
  const offset = Number(args.offset) || 0;
  const params = new URLSearchParams({ q: String(args.query), pages_only: 'true', limit: String(limit), offset: String(offset) });
  if (args.language) params.set('language', String(args.language));
  if (Array.isArray(args.languages) && args.languages.length > 0) params.set('languages', args.languages.join(','));
  if (Array.isArray(args.exclude_languages) && args.exclude_languages.length > 0) params.set('exclude_languages', args.exclude_languages.join(','));
  if (args.year_from) params.set('year_from', String(args.year_from));
  if (args.year_to) params.set('year_to', String(args.year_to));
  if (args.book_id) params.set('book_id', String(args.book_id));

  const result = await apiGet('/search', params) as Record<string, unknown>;
  const passages = (result.results as Array<Record<string, unknown>>)?.map((r) => {
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
      // snippet_type:
      //   'translation' / 'ocr' = verbatim extract from source text (safe to quote)
      //   'summary'             = AI-generated description (do NOT quote as the author's words)
      snippet_type: snippetType,
      url: `https://sourcelibrary.org/book/${r.slug || r.book_id}?page=${r.page_number || 1}`,
      short_url: r.book_id && r.page_number ? getShortUrl(String(r.book_id), Number(r.page_number)) : undefined,
    };
  }).filter(p => !!(p.snippet as string | undefined)?.trim()) || [];
  return {
    query: result.query,
    total_matches: result.total,
    returned: passages.length,
    offset,
    passages,
    tip: 'original_language is the book\'s source language; snippet_language is the language of the snippet text (English for translations/summaries, source language for ocr). Only quote snippets where snippet_type is "translation" or "ocr". Always cite using short_url when presenting passages to users.',
  };
}

async function searchConcept(args: Record<string, unknown>) {
  const limit = Math.min(Number(args.limit) || 15, 50);
  const params = new URLSearchParams({ q: String(args.query), level: 'page', limit: String(limit) });
  if (args.language) params.set('language', String(args.language));
  if (Array.isArray(args.languages) && args.languages.length > 0) params.set('languages', args.languages.join(','));
  if (Array.isArray(args.exclude_languages) && args.exclude_languages.length > 0) params.set('exclude_languages', args.exclude_languages.join(','));
  if (args.year_from) params.set('year_min', String(args.year_from));
  if (args.year_to) params.set('year_max', String(args.year_to));
  if (args.max_per_book) params.set('max_per_book', String(args.max_per_book));

  const result = await apiGet('/search/semantic', params) as Record<string, unknown>;
  const passages = (result.results as Array<Record<string, unknown>>)?.map((r) => ({
    book_id: r.book_id,
    title: r.book_title,
    author: r.book_author,
    original_language: r.book_language,
    snippet_language: 'English',
    published: r.book_year,
    page: r.page_number,
    snippet: r.snippet,
    // 'translation' = verbatim source text (safe to quote).
    // 'summary'     = AI-written page-continuity preamble we couldn't cleanly strip —
    //                 useful as topical evidence but DO NOT quote as the author's words.
    snippet_type: r.snippet_type || 'translation',
    similarity: r.score,
    url: `https://sourcelibrary.org/book/${r.slug || r.book_id}?page=${r.page_number || 1}`,
    short_url: r.book_id && r.page_number ? getShortUrl(String(r.book_id), Number(r.page_number)) : undefined,
  })).filter(p => !!(p.snippet as string | undefined)?.trim()) || [];
  return {
    query: result.query,
    total_matches: passages.length,
    returned: passages.length,
    passages,
    tip: 'original_language is the book\'s source language; semantic search always returns English translation text (snippet_language: "English"). Similarity calibration: 0.70+ strong match (quote with confidence); 0.55–0.70 worth reading but verify; below 0.55 mostly conceptual drift. Snippets tagged snippet_type:"summary" are AI continuity notes — paraphrase only, never quote. Always cite using short_url when presenting passages to users.',
  };
}

async function searchWithinBook(args: Record<string, unknown>) {
  const params = new URLSearchParams({ q: String(args.query) });
  const result = await apiGet(`/books/${args.book_id}/search`, params) as Record<string, unknown>;
  const results = (result.results as Array<Record<string, unknown>>)?.map((r) => {
    const matches = r.matches as Array<Record<string, unknown>>;
    const best = matches?.find((m) => m.field === 'translation') || matches?.[0];
    const bookId = String(args.book_id);
    const pageNum = Number(r.pageNumber);
    return { page: pageNum, snippet: best?.snippet, source: best?.field, match_count: matches?.length || 0, url: `https://sourcelibrary.org/book/${bookId}?page=${pageNum}`, short_url: bookId && pageNum ? getShortUrl(bookId, pageNum) : undefined };
  });
  return { book_id: args.book_id, query: result.query, total: result.total, results, tip: 'Use get_book_text with from/to page numbers to read the full text around these matches. Always cite using short_url when presenting passages to users.' };
}

async function listBooks(args: Record<string, unknown>) {
  const params = new URLSearchParams();
  if (args.search) params.set('search', String(args.search));
  if (args.language) params.set('language', String(args.language));
  if (args.category) params.set('category', String(args.category));
  if (args.sort) params.set('sort', String(args.sort));
  if (args.limit) params.set('limit', String(Math.min(Number(args.limit), 200)));
  if (args.skip) params.set('skip', String(args.skip));

  const result = await apiGet('/books/library', params) as Record<string, unknown>;
  const books = (result.books as Array<Record<string, unknown>>)?.map((b) => ({
    id: b.id, title: b.display_title || b.title, author: b.author, language: b.language,
    published: b.published, pages_count: b.pages_count, pages_translated: b.pages_translated,
    translation_percent: b.translation_percent, url: `https://sourcelibrary.org/book/${b.slug || b.id}`,
  }));
  return { total: result.total, showing: books?.length || 0, books };
}

async function getBook(args: Record<string, unknown>) {
  const result = await apiGet(`/books/${args.book_id}`, new URLSearchParams({ pages: 'nav' })) as Record<string, unknown>;
  return {
    id: result.id, title: result.display_title || result.title, author: result.author,
    language: result.language, published: result.published, year: result.year,
    categories: result.categories, pages_count: result.pages_count,
    pages_translated: result.pages_translated, doi: result.doi,
    reading_summary: result.reading_summary, chapters: result.chapters,
    url: `https://sourcelibrary.org/book/${result.slug || result.id}`,
    iiif_manifest: `https://sourcelibrary.org/api/iiif/${result.id}/manifest`,
  };
}

async function getBookText(args: Record<string, unknown>) {
  const params = new URLSearchParams();
  if (args.chapter !== undefined) params.set('chapter', String(args.chapter));
  if (args.part !== undefined) params.set('part', String(args.part));
  if (args.content) params.set('content', String(args.content));
  if (args.from !== undefined) params.set('from', String(args.from));
  if (args.to !== undefined) params.set('to', String(args.to));
  const format = String(args.format || 'json');
  params.set('format', format);

  if (format === 'plain') return apiGetText(`/books/${args.book_id}/text`, params);

  const result = await apiGet(`/books/${args.book_id}/text`, params) as Record<string, unknown>;
  const book = result.book as Record<string, unknown> | undefined;
  const slug = book?.slug || book?.id || args.book_id;
  const pages = result.pages as Array<Record<string, unknown>> | undefined;
  if (pages) for (const p of pages) p.url = `https://sourcelibrary.org/book/${slug}?page=${p.page_number}`;

  // Detect truncation: signal clearly when pages_returned < total_pages so LLMs
  // don't infer "the book ends here" from an incomplete response.
  const totalPages = Number(result.total_pages || 0);
  const pagesReturned = Number(result.pages_returned || 0);
  // Chapter mode returns different shape — only add truncation signal for page-range mode
  if (!args.chapter && totalPages > 0) {
    const fromPage = args.from !== undefined ? Number(args.from) : 1;
    const expectedUpTo = args.to !== undefined ? Number(args.to) : totalPages;
    const lastPageReturned = pagesReturned > 0 ? fromPage + pagesReturned - 1 : fromPage - 1;
    const isTruncated = lastPageReturned < expectedUpTo;
    result.truncated = isTruncated;
    if (isTruncated) {
      const nextFrom = lastPageReturned + 1;
      const nextTo = Math.min(nextFrom + 49, totalPages);
      result.truncation_note =
        `TRUNCATED — received ${pagesReturned} pages (up to p.${lastPageReturned}) ` +
        `but requested up to p.${expectedUpTo} of ${totalPages} total. ` +
        `This is NOT end-of-book — call get_book_text again with from=${nextFrom} to=${nextTo} ` +
        `to read the next chunk. Repeat until you reach total_pages (${totalPages}).`;
    }
  }

  result.tip = 'When quoting from these pages, copy text verbatim from the translation field.';
  return result;
}

async function getQuote(args: Record<string, unknown>) {
  const result = await apiGet(`/books/${args.book_id}/quote`, new URLSearchParams({ page: String(args.page) })) as Record<string, unknown>;
  return { ...result, tip: 'Copy the translation text exactly when quoting. Do not paraphrase.' };
}

async function searchImages(args: Record<string, unknown>) {
  const params = new URLSearchParams();
  if (args.query) params.set('q', String(args.query));
  if (args.type) params.set('type', String(args.type));
  if (args.subject) params.set('subject', String(args.subject));
  if (args.figure) params.set('figure', String(args.figure));
  if (args.symbol) params.set('symbol', String(args.symbol));
  if (args.year_from) params.set('yearStart', String(args.year_from));
  if (args.year_to) params.set('yearEnd', String(args.year_to));
  if (args.book_id) params.set('bookId', String(args.book_id));
  if (args.min_quality !== undefined) params.set('minQuality', String(args.min_quality));
  const limit = Math.min(Number(args.limit) || 20, 50);
  params.set('limit', String(limit));

  // Search both gallery illustrations AND artworks (paintings/prints) in parallel
  const artworkParams = new URLSearchParams();
  if (args.query) artworkParams.set('q', String(args.query));
  artworkParams.set('limit', String(limit));

  const [galleryResult, artworkResult] = await Promise.all([
    apiGet('/gallery', params) as Promise<Record<string, unknown>>,
    args.query
      ? (apiGet('/artwork/search', artworkParams) as Promise<Record<string, unknown>>).catch(() => ({ items: [] }))
      : Promise.resolve({ items: [] }),
  ]);

  const galleryImages = (galleryResult.items as Array<Record<string, unknown>>)?.map((item) => ({
    description: item.description, type: item.type, quality: item.galleryQuality,
    book: { title: item.bookTitle, author: item.author, year: item.year },
    page: item.pageNumber, image_url: item.imageUrl,
    url: `https://sourcelibrary.org/gallery/image/${item.pageId}-${item.detectionIndex}`,
    book_url: item.bookId ? `https://sourcelibrary.org/book/${item.bookId}?page=${item.pageNumber}` : undefined,
  })) || [];

  const artworks = (artworkResult.items as Array<Record<string, unknown>>)?.map((item) => ({
    description: item.title, type: 'artwork',
    artist: item.artist, medium: item.medium,
    year: item.year, image_url: item.image_url,
    url: item.url,
  })) || [];

  // Artworks first (exact matches), then gallery illustrations
  const allImages = [...artworks, ...galleryImages].slice(0, limit);

  return {
    total: (galleryResult.total as number || 0) + artworks.length,
    showing: allImages.length,
    images: allImages,
  };
}

async function submitFeedback(args: Record<string, unknown>) {
  await apiPost('/feedback', { message: args.message, name: args.name || null, email: args.email || null, page: args.page || null });
  return { ok: true, message: 'Feedback submitted successfully. Thank you!' };
}

// ── Tool definitions ───────────────────────────────────────────────

// Shared annotation for all read-only tools
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const TOOLS: Tool[] = [
  {
    name: 'search_library',
    description: 'Find BOOKS matching a topic. Searches titles, authors, subjects, and (as a secondary signal) translated text. Use this when you want a list of works on a subject. For locating specific passages inside books, use search_translations instead. ORIENTATION HINT: when the user has named a specific author or work, call get_book directly (or list_books to discover the ID) — the AI-generated book summary + chapter outline is often the right first answer and saves repeated passage hunting. Query tips: single distinctive words or short phrases work best ("memory palace", "ouroboros"); quoted phrases match exactly. Each result includes total_matches (full count) + returned (this page) + offset for pagination.',
    annotations: { title: 'Search Library', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query — prefer single distinctive concepts ("alchemy", "tree of life") over long natural-language phrases. Wrap in "double quotes" for exact phrase.' },
        language: { type: 'string', description: 'Filter by original language (e.g., Latin, German, Greek)' },
        year_from: { type: 'number', description: 'Publication year range start' },
        year_to: { type: 'number', description: 'Publication year range end' },
        has_translation: { type: 'boolean', description: 'Only return books with translations' },
        sort: { type: 'string', enum: ['relevance', 'date_asc', 'date_desc', 'title'] },
        limit: { type: 'number', description: 'Max results per page (default 10, max 100)' },
        offset: { type: 'number', description: 'Pagination offset (use with limit to page through total_matches; default 0)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_translations',
    description: 'Find specific PASSAGES inside books — returns page-level snippets with citation URLs. Use this when you want a quote or evidence on a topic across the whole library. ORIENTATION HINT: if the user has named a specific author or work, prefer get_book (returns a summary + chapter outline) over passage hunting — every book in the corpus has an AI-generated summary that is usually the right first read. Use search_translations when sweeping across many books for evidence of a theme. For finding which BOOKS cover a topic, use search_library. Query tips: single distinctive terms ("memory palace", "wax tablet") work best; multi-word natural-English queries ("unity of the intellect") may return fewer results because matching is term-based, not phrase-based. Each snippet has a snippet_type — "translation"/"ocr" means it is a verbatim extract from the source text; "summary" means it is AI-generated description (do not quote those as the author\'s words). Response includes total_matches, returned, and offset for pagination. Cross-cultural tip: for pre-modern or non-Western topics, search source-tradition vocabulary rather than modern English terms — e.g. for seminal economy search "jing" or "bindu" or "istimnāʾ", not "semen retention"; for female homoeroticism search "tribade" or "sahq", not "lesbian". The corpus is indexed via period translations that use tradition-internal terminology.',
    annotations: { title: 'Search Translations', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search term — prefer single distinctive concepts ("harmony of the spheres", "active intellect") over long natural-language phrases. Multi-word queries match all terms (not phrase); wrap in "double quotes" for exact phrase.' },
        language: { type: 'string', description: 'Filter by a single original language' },
        languages: { type: 'array', items: { type: 'string' }, description: 'Filter to any of these languages, e.g. ["Sanskrit", "Arabic", "Chinese"]. Use instead of language when targeting multiple traditions.' },
        exclude_languages: { type: 'array', items: { type: 'string' }, description: 'Exclude these languages, e.g. ["Latin", "French", "German", "English"] to surface non-Western sources.' },
        year_from: { type: 'number' }, year_to: { type: 'number' },
        book_id: { type: 'string', description: 'Search within a specific book' },
        limit: { type: 'number', description: 'Max results per page (default 20, max 50)' },
        offset: { type: 'number', description: 'Pagination offset (use with limit to page through total_matches; default 0)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_concept',
    description: 'Conceptual / semantic passage search across the whole library. Use when the modern term won\'t literally appear in historical texts — e.g. "distributed cognition" maps to passages about active intellect, art of memory, wax tablet metaphors; "social contract" maps to pre-Hobbesian discussions of consent and authority. Ranks passages by cosine similarity on Gemini embeddings (768d), so paraphrases and conceptually adjacent phrasings match even when no keyword overlaps. ORIENTATION HINT: if the user named a specific author or work, prefer get_book (returns the book\'s AI summary + chapter outline) — semantic search is expensive and best reserved for cross-corpus discovery. Prefer search_translations for literal phrases or distinctive single terms; use search_concept when the concept matters more than the wording. Similarity calibration: 0.70+ is a strong match, 0.55–0.70 is worth reading but verify, below 0.55 is mostly conceptual drift. Set max_per_book to diversify results across many books rather than cluster on one source. Each passage carries a snippet_type — quote only "translation" snippets, never "summary". Cross-cultural tip: for pre-modern or non-Western topics, also try source-tradition vocabulary — e.g. for seminal economy try "jing preservation" or "bindu yoga" or "istimnāʾ"; for masturbation try "mollities" (Latin) or "hastamaithuna" (Sanskrit) or "shouyin" (Chinese). The corpus is indexed via period translations that use tradition-internal terminology, so adjacent/euphemistic terms often surface material that modern English keywords miss.',
    annotations: { title: 'Search by Concept', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'A concept or natural-language description — full sentences are fine (e.g. "tools that extend the mind beyond the body"). Unlike search_translations, this does NOT require words that appear in the corpus.' },
        language: { type: 'string', description: 'Filter by a single original language' },
        languages: { type: 'array', items: { type: 'string' }, description: 'Filter to any of these languages, e.g. ["Sanskrit", "Arabic", "Chinese"]. Use instead of language when targeting multiple traditions.' },
        exclude_languages: { type: 'array', items: { type: 'string' }, description: 'Exclude these languages, e.g. ["Latin", "French", "German", "English"] to surface non-Western sources.' },
        year_from: { type: 'number', description: 'Restrict to books published in or after this year (filters out modern editions and translations).' },
        year_to: { type: 'number', description: 'Restrict to books published in or before this year.' },
        max_per_book: { type: 'number', description: 'Cap on passages from any single book. Useful when one book dominates the conceptual neighborhood; set to 1–2 for diverse author/work coverage.' },
        limit: { type: 'number', description: 'Max passages (default 15, max 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_within_book',
    description: 'Deep-dive inside a single book. Runs Atlas keyword search AND scoped semantic search in parallel against that book\'s pages, then merges results — so this works for both literal terms ("ouroboros") and conceptual queries ("the marriage of opposites"). Typical workflow: use search_library or search_concept to find a candidate book; then call this with that book_id to surface every relevant page. Faster than re-searching globally because it\'s scoped to one book\'s 100-500 pages. Returns OCR and translation snippets with page numbers, ready to cite.',
    annotations: { title: 'Search Within Book', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: {
        book_id: { type: 'string', description: 'The book ID to search within' },
        query: { type: 'string', description: 'Search query' },
      },
      required: ['book_id', 'query'],
    },
  },
  {
    name: 'list_books',
    description: 'Browse the catalog by metadata — filter by author/title fragment, language, category, or translation recency. Returns books with title, author, language, year, and translation progress. Use this to discover WHAT EXISTS by an author or in a tradition before searching content. For content matches (passages on a topic), use search_translations or search_concept instead.',
    annotations: { title: 'List Books', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Filter by title or author' },
        language: { type: 'string' }, category: { type: 'string' },
        sort: { type: 'string', enum: ['recent-translation', 'recent', 'title-asc', 'title-desc'] },
        limit: { type: 'number', description: 'Max results (default 100, max 200)' },
      },
    },
  },
  {
    name: 'get_book',
    description: 'Get a book\'s AI-generated summary, chapter list, edition metadata, DOI, and page counts. THIS IS THE RIGHT FIRST CALL whenever the user has named a specific author or work — the summary is typically a multi-paragraph orientation covering the book\'s argument, structure, and significance, often answering the question without any further searching. Pair with get_book_text to read selected chapters, or search_within_book to locate passages inside it.',
    annotations: { title: 'Get Book', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: { book_id: { type: 'string', description: 'The book ID' } },
      required: ['book_id'],
    },
  },
  {
    name: 'get_book_text',
    description: 'Read a book\'s text. Preferred: use the chapter param to read one chapter at a time (includes [Page N] markers for citation) — call get_book first to get the chapter list. Alternatively, use from/to for explicit page ranges (e.g. from=1 to=50). TRUNCATION: the response always includes truncated: true/false. When truncated=true, the truncation_note field gives the exact next from/to values to call — this means content was cut short by a page-budget limit, NOT that the book ended. An AI agent MUST NOT infer end-of-book from pages_returned alone; check truncated first. Budget limits apply to anonymous callers (~50 pages per 24h); sign in at sourcelibrary.org/auth/signin or get an API key at sourcelibrary.org/developers for higher limits.',
    annotations: { title: 'Read Book Text', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: {
        book_id: { type: 'string', description: 'The book ID' },
        chapter: { type: 'number', description: 'Chapter index (0-based). Preferred over from/to — returns pre-structured chapter text with embedded [Page N] markers.' },
        part: { type: 'number', description: 'Part number (1-based) for large chapters split into multiple parts' },
        content: { type: 'string', enum: ['ocr', 'translation', 'both'], description: 'Which text to include: ocr (original language), translation (English), or both (default)' },
        from: { type: 'number', description: 'Start page number (inclusive). Use with to for explicit page ranges.' },
        to: { type: 'number', description: 'End page number (inclusive). Recommended chunk size: 50 pages. If the response has truncated=true, use the next from/to from truncation_note.' },
        format: { type: 'string', enum: ['json', 'plain'], description: 'json (default, structured with per-page fields) or plain (concatenated text with page markers)' },
      },
      required: ['book_id'],
    },
  },
  {
    name: 'get_quote',
    description: 'Get exact text of a single page for quoting, with citation URL. ALWAYS use before putting text in quotation marks.',
    annotations: { title: 'Get Quote', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: {
        book_id: { type: 'string', description: 'The book ID' },
        page: { type: 'number', description: 'Page number' },
      },
      required: ['book_id', 'page'],
    },
  },
  {
    name: 'search_images',
    description: 'Search 110,000+ historical illustrations, emblems, engravings, diagrams, AND 23,000+ artworks (paintings, prints, sculptures). Filter by type, subject, figure, symbol, year.',
    annotations: { title: 'Search Images', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Text search (e.g., "ouroboros", "tree of life")' },
        type: { type: 'string', description: 'Image type (woodcut, engraving, emblem, diagram)' },
        subject: { type: 'string' }, figure: { type: 'string' }, symbol: { type: 'string' },
        year_from: { type: 'number' }, year_to: { type: 'number' },
        book_id: { type: 'string' }, limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
    },
  },
  {
    name: 'submit_feedback',
    description: 'Submit feedback, bug reports, or feature requests to the Source Library team.',
    annotations: { title: 'Submit Feedback', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object' as const,
      properties: {
        message: { type: 'string', description: 'Your feedback (2-5000 chars)' },
        name: { type: 'string' }, email: { type: 'string' },
      },
      required: ['message'],
    },
  },
];

// ── Tool dispatch ──────────────────────────────────────────────────

type ToolArgs = Record<string, unknown>;

async function handleToolCall(name: string, args: ToolArgs) {
  switch (name) {
    case 'search_library': return searchLibrary(args);
    case 'search_translations':
    case 'search_passages': return searchPassages(args);
    case 'search_concept': return searchConcept(args);
    case 'search_within_book': return searchWithinBook(args);
    case 'list_books': return listBooks(args);
    case 'get_book': return getBook(args);
    case 'get_book_text': return getBookText(args);
    case 'get_quote': return getQuote(args);
    case 'search_images': return searchImages(args);
    case 'submit_feedback': return submitFeedback(args);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Fetch image as base64 (with timeout) ───────────────────────────

async function fetchImageBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const mimeType = contentType.split(';')[0].trim();
    const buffer = await resp.arrayBuffer();
    // Skip images larger than 1MB to keep responses reasonable
    if (buffer.byteLength > 1_000_000) return null;
    const data = Buffer.from(buffer).toString('base64');
    return { data, mimeType };
  } catch {
    return null;
  }
}

// ── Create a fresh MCP server instance (stateless per-request) ─────

const ANON_LIMIT_PER_HOUR = Number(process.env.API_ANON_LIMIT_PER_HOUR || 60);

/**
 * Build a `_meta.upgrade_hint` payload for anonymous callers approaching their
 * rate-limit ceiling. Returns null for signed-in / API-key / bot identities —
 * they don't need to upgrade. Returns null for anonymous callers under 80% of
 * quota to keep responses noise-free.
 *
 * The hint is structured rather than a string so MCP clients can present it
 * however they like (banner, inline note, or ignore). Agents reading it can
 * decide whether to surface the message to the human user.
 */
function buildUpgradeHint(identity: ApiIdentity, ip: string) {
  if (identity.kind !== 'anon') return null;
  const usage = peekRateLimit(
    { name: 'api:anon', limit: ANON_LIMIT_PER_HOUR, windowSeconds: 3600 },
    ip,
  );
  if (usage.count < usage.limit * 0.8) return null;
  return {
    type: 'rate_limit_approaching',
    usage: { count: usage.count, limit: usage.limit, remaining: usage.remaining },
    reset_at_unix_ms: usage.resetAt,
    message:
      `You've used ${usage.count} of ${usage.limit} anonymous requests this hour. ` +
      `Sign in at sourcelibrary.org/auth/signin for a much higher limit, ` +
      `or get an API key at sourcelibrary.org/developers.`,
    sign_in_url: 'https://sourcelibrary.org/auth/signin',
    api_key_url: 'https://sourcelibrary.org/developers',
  };
}

/**
 * Build a `_meta.no_results_hint` when a search tool returns zero hits. The
 * point is to break the LLM out of "the corpus didn't have it, give up" mode
 * and into "try broader terms, lean on my own knowledge, web-search adjacent
 * authors". Source Library is a primary-source citation layer in a wider
 * research strategy — empty here doesn't mean the question can't be answered.
 *
 * Only fires for the search_* tools and only when the result is shaped like
 * `{ total_matches: 0 }` or `{ returned: 0 }` or `{ total: 0 }` or `{ results: [] }`.
 */
function buildNoResultsHint(tool: string, result: unknown, args: ToolArgs) {
  if (!tool.startsWith('search')) return null;
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const totalKey = ['total_matches', 'total', 'returned'].find(k => typeof r[k] === 'number');
  const total = totalKey ? (r[totalKey] as number) : -1;
  const resultsArr = (r.results || r.passages || r.books || r.images || []) as unknown[];
  const isEmpty = total === 0 || (Array.isArray(resultsArr) && resultsArr.length === 0);
  if (!isEmpty) return null;
  const query = typeof args.query === 'string' ? args.query.slice(0, 200) : '';
  return {
    type: 'no_results',
    message:
      'Source Library returned no matches for this query — but that does NOT mean the answer is unknowable. ' +
      'Try: (a) broaden or rephrase the query (synonyms, original-language terms, related authors); ' +
      '(b) use your own pre-training knowledge to suggest which authors / works are likely relevant, then search those specifically; ' +
      '(c) web-search to find canonical texts on the topic, then come back here to look for them; ' +
      '(d) accept that this specific topic may not be in the corpus and answer from your own knowledge + web search instead. ' +
      'This corpus is rare pre-modern primary sources spanning Sumerian tablets to 19th-century works — theology, philosophy, history, literature, science, mysticism, medicine, and more. Not only esoteric/alchemical.',
    query,
  };
}

function createServer(reqContext: { ip: string; userAgent: string | null; identity: ApiIdentity }) {
  const server = new Server(
    { name: 'source-library', version: '4.3.2' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
    _meta: {
      about: 'Source Library — 15,000+ rare pre-modern texts translated into English from Latin, German, Tibetan, Greek, Sanskrit, Arabic, Sumerian, Chinese, Hebrew, and more. The full breadth of pre-modern intellectual history: theology, philosophy, history, literature, natural philosophy, mysticism, alchemy, Hermetica, medicine, mathematics, astronomy, law. Not only esoteric — also the canon. 4M+ searchable page embeddings. https://sourcelibrary.org',
      sign_in_hint: 'Sign in at sourcelibrary.org/auth/signin to save research, get a much higher rate limit, and support this archive. API keys for programmatic access: sourcelibrary.org/developers.',
      research_strategy: [
        'Source Library is the primary-source citation layer in your research strategy — not the whole strategy. Its corpus is rare pre-modern texts (mostly 1400-1900, ranging from Sumerian tablets to 19th-century scholarship) translated into English. Use it together with your own knowledge and web search:',
        '',
        '1. THINK BROADLY first. The user\'s literal phrase is rarely the right query. Use your own knowledge to brainstorm relevant authors, alternative terms, original-language forms, related works. "Renaissance Hermeticism" → Ficino, Pico, Corpus Hermeticum, Picatrix, Bruno, Patrizi. Search the expanded set.',
        '2. WEB-SEARCH for breadth when you can. Use it to confirm scholarly canon, find canonical editions, surface authors you didn\'t know about — then come back here to find the actual primary text.',
        '3. SEARCH THIS CORPUS iteratively. Try synonyms, original-language terms, related authors, the period one century earlier/later. search_concept is for paraphrase / conceptual matches; search_translations is for distinctive literal terms; search_library finds books. Don\'t over-rely on semantic — keyword is more precise for known phrases.',
        '4. CITE from here, frame from elsewhere. Use Source Library passages as evidence. Use your own knowledge and web search for context, scholarly consensus, author biography, modern interpretation, comparison to texts not in this corpus.',
        '5. EMPTY RESULTS mean "try a different angle" (broaden terms, try the original language, brainstorm adjacent authors) — not "doesn\'t exist."',
        '6. CITE WITH URLS. Every passage you present to a user should include its short_url (e.g. sourcelibrary.org/q/abc123). These are stable, shareable citations — the standard way to refer to a Source Library passage.',
      ].join('\n'),
    },
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const argsObj = (args || {}) as ToolArgs;
    const started = Date.now();
    try {
      const result = await handleToolCall(name, argsObj);
      logMcpToolCall({
        tool: name, args: argsObj, ms: Date.now() - started,
        ip: reqContext.ip, userAgent: reqContext.userAgent,
      });

      const upgradeHint = buildUpgradeHint(reqContext.identity, reqContext.ip);
      const noResultsHint = buildNoResultsHint(name, result, argsObj);
      const metaPayload: Record<string, unknown> = {};
      if (upgradeHint) metaPayload.upgrade_hint = upgradeHint;
      if (noResultsHint) metaPayload.no_results_hint = noResultsHint;
      const meta = Object.keys(metaPayload).length > 0 ? { _meta: metaPayload } : {};

      // search_images: return image content blocks alongside text metadata
      if (name === 'search_images' && result && typeof result === 'object' && 'images' in result) {
        const imageResult = result as { total: unknown; showing: unknown; images: Array<{ image_url: string; description: string; book: { title: string }; url: string; [k: string]: unknown }> };
        const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string; annotations?: { audience: string[] } }> = [];

        // Text summary first
        content.push({ type: 'text' as const, text: JSON.stringify({ total: imageResult.total, showing: imageResult.showing, images: imageResult.images }, null, 2) });

        // Fetch actual images in parallel (limit to first 5 to keep response size manageable)
        const imagesToFetch = imageResult.images.slice(0, 5);
        const fetched = await Promise.all(imagesToFetch.map(img => fetchImageBase64(img.image_url)));
        for (let i = 0; i < imagesToFetch.length; i++) {
          const img = fetched[i];
          if (img) {
            content.push({ type: 'image' as const, data: img.data, mimeType: img.mimeType, annotations: { audience: ['user'] } });
            content.push({ type: 'text' as const, text: `${imagesToFetch[i].description || 'Image'}\n${imagesToFetch[i].url}` });
          }
        }

        return { content, ...meta };
      }

      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return { content: [{ type: 'text' as const, text }], ...meta };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logMcpToolCall({
        tool: name, args: argsObj, ms: Date.now() - started, error: message,
        ip: reqContext.ip, userAgent: reqContext.userAgent,
      });
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ── Next.js route handlers ─────────────────────────────────────────

export async function GET() {
  return new Response(JSON.stringify({
    name: 'source-library',
    version: '4.3.2',
    description: 'Source Library MCP Server — search, read, and cite 15,000+ rare pre-modern texts translated to English. Connect via POST to this endpoint.',
    docs: 'https://sourcelibrary.org/developers',
    tools: TOOLS.map(t => t.name),
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export const POST = withApiAuth(async (req: NextRequest, _ctx, identity) => {
  try {
    const body = await req.json();

    // Always set the Accept header the SDK requires — clients send varying
    // combinations (just application/json, just text/event-stream, or neither)
    const headers = new Headers(req.headers);
    headers.set('accept', 'application/json, text/event-stream');
    const fixedReq = new Request(req.url, { method: req.method, headers });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless for serverless
      enableJsonResponse: true,
    });
    const server = createServer({
      ip: getClientIp(req),
      userAgent: req.headers.get('user-agent'),
      identity,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(fixedReq, { parsedBody: body });
    } finally {
      await transport.close();
      await server.close();
    }
  } catch (error) {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32603, message: error instanceof Error ? error.message : 'Internal error' },
      id: null,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}, { route: 'mcp', errorFormat: 'jsonrpc' });

export async function DELETE() {
  // Stateless — no sessions to delete
  return new Response(null, { status: 405 });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Session-Id, MCP-Protocol-Version',
      'Access-Control-Expose-Headers': 'WWW-Authenticate',
    },
  });
}
