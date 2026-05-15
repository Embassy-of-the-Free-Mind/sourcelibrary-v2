import type { NextRequest } from 'next/server';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { withApiAuth } from '@/lib/api-auth';
import { logMcpToolCall } from '@/lib/mcp-usage';
import { getClientIp } from '@/lib/rate-limit';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

// ── API helpers (same as mcp-server/src/api.ts, self-calling) ──────

const API_BASE = 'https://sourcelibrary.org/api';
const MCP_HEADERS = { 'User-Agent': 'SourceLibrary-MCP/4.2', 'Accept-Language': 'en' };

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
  const params = new URLSearchParams({ q: String(args.query) });
  if (args.language) params.set('language', String(args.language));
  if (args.year_from) params.set('year_from', String(args.year_from));
  if (args.year_to) params.set('year_to', String(args.year_to));
  if (args.has_doi) params.set('has_doi', 'true');
  if (args.has_translation) params.set('has_translation', 'true');
  if (args.sort) params.set('sort', String(args.sort));
  if (args.limit) params.set('limit', String(Math.min(Number(args.limit), 100)));
  if (args.offset) params.set('offset', String(args.offset));

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
    ...(r.snippet ? { snippet: r.snippet } : {}),
    url: r.page_number
      ? `https://sourcelibrary.org/book/${r.slug || r.book_id || r.id}?page=${r.page_number}`
      : `https://sourcelibrary.org/book/${r.slug || r.book_id || r.id}`,
    iiif_manifest: `https://sourcelibrary.org/api/iiif/${r.book_id || r.id}/manifest`,
  }));
  return { query: result.query, total: result.total, results, ...(result.nearby ? { nearby: result.nearby } : {}) };
}

async function searchPassages(args: Record<string, unknown>) {
  const params = new URLSearchParams({ q: String(args.query), pages_only: 'true', limit: String(Math.min(Number(args.limit) || 20, 50)) });
  if (args.language) params.set('language', String(args.language));
  if (args.year_from) params.set('year_from', String(args.year_from));
  if (args.year_to) params.set('year_to', String(args.year_to));
  if (args.book_id) params.set('book_id', String(args.book_id));

  const result = await apiGet('/search', params) as Record<string, unknown>;
  const passages = (result.results as Array<Record<string, unknown>>)?.map((r) => ({
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
  return { query: result.query, total: result.total, passages, tip: 'Use get_book_text with book_id to read the full text around these passages.' };
}

async function searchWithinBook(args: Record<string, unknown>) {
  const params = new URLSearchParams({ q: String(args.query) });
  const result = await apiGet(`/books/${args.book_id}/search`, params) as Record<string, unknown>;
  const results = (result.results as Array<Record<string, unknown>>)?.map((r) => {
    const matches = r.matches as Array<Record<string, unknown>>;
    const best = matches?.find((m) => m.field === 'translation') || matches?.[0];
    return { page: r.pageNumber, snippet: best?.snippet, source: best?.field, match_count: matches?.length || 0, url: `https://sourcelibrary.org/book/${args.book_id}?page=${r.pageNumber}` };
  });
  return { book_id: args.book_id, query: result.query, total: result.total, results, tip: 'Use get_book_text with from/to page numbers to read the full text around these matches.' };
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
  (result as Record<string, unknown>).tip = 'When quoting from these pages, copy text verbatim from the translation field.';
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
    description: 'Full-text search across Source Library\'s 22,000+ rare historical books. Searches titles, authors, translations, and OCR text. Returns matching books and page snippets with citation URLs.',
    annotations: { title: 'Search Library', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        language: { type: 'string', description: 'Filter by original language (e.g., Latin, German, Greek)' },
        year_from: { type: 'number', description: 'Publication year range start' },
        year_to: { type: 'number', description: 'Publication year range end' },
        has_translation: { type: 'boolean', description: 'Only return books with translations' },
        sort: { type: 'string', enum: ['relevance', 'date_asc', 'date_desc', 'title'] },
        limit: { type: 'number', description: 'Max results (default 10, max 100)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_translations',
    description: 'Search inside translated page text across the entire library. THE tool for finding what historical authors wrote about a topic. Returns passage snippets with page numbers and citation URLs.',
    annotations: { title: 'Search Translations', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search inside page translations (e.g., "harmony of the spheres")' },
        language: { type: 'string', description: 'Filter by book\'s original language' },
        year_from: { type: 'number' }, year_to: { type: 'number' },
        book_id: { type: 'string', description: 'Search within a specific book' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_within_book',
    description: 'Search inside a specific book\'s pages (OCR and translations). Returns matching pages with snippets.',
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
    description: 'Browse the full collection with filters. Returns books with title, author, language, year, and translation progress.',
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
    description: 'Get detailed metadata about a book: summary, chapters, DOI, page counts. Use before reading with get_book_text.',
    annotations: { title: 'Get Book', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: { book_id: { type: 'string', description: 'The book ID' } },
      required: ['book_id'],
    },
  },
  {
    name: 'get_book_text',
    description: 'Read a book. Use chapter param to read one chapter at a time (includes [Page N] markers for citation). Or use from/to for page ranges. Call get_book first for the chapter list.',
    annotations: { title: 'Read Book Text', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: {
        book_id: { type: 'string', description: 'The book ID' },
        chapter: { type: 'number', description: 'Chapter index (0-based)' },
        part: { type: 'number', description: 'Part number for large chapters' },
        content: { type: 'string', enum: ['ocr', 'translation', 'both'], description: 'Default: both' },
        from: { type: 'number', description: 'Start page' },
        to: { type: 'number', description: 'End page' },
        format: { type: 'string', enum: ['json', 'plain'] },
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
    description: 'Search 90,000+ historical illustrations, emblems, engravings, diagrams, AND 23,000+ artworks (paintings, prints, sculptures). Filter by type, subject, figure, symbol, year.',
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

function createServer(reqContext: { ip: string; userAgent: string | null }) {
  const server = new Server(
    { name: 'source-library', version: '4.2.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
    _meta: {
      about: 'Source Library — 22,000+ rare alchemical, Hermetic, and early scientific texts translated into English. The largest AI-ready corpus of pre-modern esoteric knowledge. https://sourcelibrary.org',
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

        return { content };
      }

      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return { content: [{ type: 'text' as const, text }] };
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
    version: '4.2.0',
    description: 'Source Library MCP Server — search, read, and cite 22,000+ rare historical texts. Connect via POST to this endpoint.',
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

export const POST = withApiAuth(async (req: NextRequest) => {
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
