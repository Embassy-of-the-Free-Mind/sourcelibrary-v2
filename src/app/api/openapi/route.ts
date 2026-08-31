import { NextResponse } from 'next/server';

/**
 * GET /api/openapi
 *
 * Machine-readable OpenAPI 3.1 description of the PUBLIC read API — the same
 * surface /developers documents in prose. Hand-authored and deliberately
 * shallow on response schemas (they are described, not fully typed): the goal
 * is discoverability for integrators and tool-builders (GPT actions, MCP-less
 * agents, codegen), not a binding contract. When you change a documented
 * route's params, update this file and /developers together.
 *
 * Not listed: admin, auth, tenant-internal, and write endpoints. /api/mcp is
 * summarized as a single JSON-RPC POST — its full tool catalog is
 * self-describing via MCP initialize/list_tools.
 */

const q = (name: string, description: string, opts: { required?: boolean; type?: string; example?: unknown } = {}) => ({
  name,
  in: 'query',
  required: opts.required ?? false,
  description,
  schema: { type: opts.type ?? 'string', ...(opts.example !== undefined ? { example: opts.example } : {}) },
});

const pathId = (description: string) => ({
  name: 'id',
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' },
});

const jsonResponse = (description: string) => ({
  '200': { description, content: { 'application/json': { schema: { type: 'object' } } } },
});

const SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Source Library API',
    version: '1.0.0',
    description:
      'Open API over the Source Library corpus of historical primary sources — search, browse, read, quote, and browse illustrations. No authentication required for read access; API keys lift rate limits and attribute your traffic (get one at https://sourcelibrary.org/developers). Text responses carry an invisible provenance colophon; keyed responses include your key reference — attribution, not tracking.',
    contact: { url: 'https://sourcelibrary.org/developers' },
    license: { name: 'CC BY-SA 4.0 (content)', url: 'https://sourcelibrary.org/licensing' },
  },
  servers: [{ url: 'https://sourcelibrary.org/api' }],
  paths: {
    '/search': {
      get: {
        summary: 'Full-text search across books and page content',
        parameters: [
          q('q', 'Search query', { required: true, example: "philosopher's stone" }),
          q('language', 'Filter by edition language (e.g. Latin)'),
          q('languages', 'Comma-separated list of edition languages (any-of)'),
          q('exclude_languages', 'Comma-separated languages to exclude'),
          q('category', 'Category filter'),
          q('year_from', 'Publication year range start', { type: 'integer' }),
          q('year_to', 'Publication year range end', { type: 'integer' }),
          q('has_translation', 'Only books with translations (true/false)'),
          q('first_translation', 'Only first translations (true/false)'),
          q('library', 'Contributing library / provider'),
          q('sort', 'relevance | date_asc | date_desc | title'),
          q('lang', 'ISO code of a localized edition to search (e.g. es)'),
        ],
        responses: jsonResponse('Book and page matches with snippets and citation URLs'),
      },
    },
    '/books/library': {
      get: {
        summary: 'Browse and filter the catalog',
        description:
          'Every row carries id, slug, title, author, author_id (canonical), language, year (numeric, when known), published (free text), and translation progress. When author_id is passed the response echoes the canonicalized author; an unknown slug returns an empty page with author: null.',
        parameters: [
          q('author_id', "Canonical author slug — exactly that person's books. Discover via /catalog/author-search", { example: 'jakob-bohme' }),
          q('year_from', 'Edition-year range start (numeric year only)', { type: 'integer' }),
          q('year_to', 'Edition-year range end (inclusive)', { type: 'integer' }),
          q('language', 'Edition language (the language printed on the leaves)'),
          q('category', 'Category slug'),
          q('collection', 'Collection slug'),
          q('library', 'Contributing library / provider'),
          q('search', 'Free-text over titles and authors (relevance-ranked)'),
          q('work_id', 'All editions of one work'),
          q('has_translation', 'Only translated books (true/false)'),
          q('first_translation', 'Only first translations (true/false)'),
          q('has_edition', 'ISO code — only books readable in that language (e.g. es)'),
          q('sort', 'recent-translation (default) | recent | title-asc | title-desc | date_asc | date_desc'),
          q('limit', 'Max results, ≤200 (default 100)', { type: 'integer' }),
          q('skip', 'Pagination offset', { type: 'integer' }),
        ],
        responses: jsonResponse('{ books, total, author? }'),
      },
    },
    '/books/distributions': {
      get: {
        summary: 'Catalog counts by language, category, collection, library, and decade',
        description:
          'Same metadata filters as /books/library (no free-text search). decades counts only books with a numeric year (~60% of the library), so decade sums below total are expected. Built for charts and timelines.',
        parameters: [
          q('author_id', 'Canonical author slug'),
          q('year_from', 'Edition-year range start', { type: 'integer' }),
          q('year_to', 'Edition-year range end', { type: 'integer' }),
          q('language', 'Edition language'),
          q('category', 'Category slug'),
          q('collection', 'Collection slug'),
          q('library', 'Contributing library'),
          q('work_id', 'All editions of one work'),
          q('has_translation', 'true/false'),
          q('first_translation', 'true/false'),
          q('has_edition', 'ISO code'),
        ],
        responses: jsonResponse('{ total, facets: { languages, categories, collections, libraries, decades }, author? } — each facet a [{value, count}] list'),
      },
    },
    '/books/{id}': {
      get: {
        summary: 'Book metadata, AI reading summary, chapters, editions, DOI',
        parameters: [pathId('Book id or slug')],
        responses: jsonResponse('Book record'),
      },
    },
    '/books/{id}/text': {
      get: {
        summary: 'Full book text (OCR, translation, or both)',
        description:
          'Rate-budgeted per rolling 24h (see /developers). Responses report your budget via X-Daily-Pages-Used / X-Daily-Pages-Limit headers. Text carries an invisible provenance colophon; API-keyed responses include your key reference.',
        parameters: [
          pathId('Book id or slug'),
          q('content', 'ocr | translation | both (default both)'),
          q('from', 'First page (inclusive)', { type: 'integer' }),
          q('to', 'Last page (inclusive)', { type: 'integer' }),
          q('format', 'json (structured) | plain (concatenated)'),
          q('lang', 'ISO code of a localized edition (e.g. es)'),
        ],
        responses: jsonResponse('Pages with text, or plain text'),
      },
    },
    '/books/{id}/search': {
      get: {
        summary: "Search within one book's pages",
        parameters: [pathId('Book id or slug'), q('q', 'Search query', { required: true }), q('lang', 'ISO code of a localized edition')],
        responses: jsonResponse('Page matches with snippets'),
      },
    },
    '/books/{id}/quote': {
      get: {
        summary: 'Single-page text with full citation apparatus',
        parameters: [
          pathId('Book id or slug'),
          q('page', 'Page number', { required: true, type: 'integer' }),
          q('include_original', 'Include OCR alongside translation (default true)'),
          q('include_context', 'Include adjacent-page context (default false)'),
          q('include_image', 'Include the page image URL (default false)'),
          q('lang', 'ISO code of a localized edition'),
        ],
        responses: jsonResponse('Verbatim page text + citation block + shortlink'),
      },
    },
    '/verify': {
      get: {
        summary: 'Flat alias of /books/{id}/quote for URL-allowlisted agents',
        parameters: [q('book_id', 'Book id or slug', { required: true }), q('page', 'Page number', { required: true, type: 'integer' })],
        responses: jsonResponse('Verbatim page text + citation block'),
      },
    },
    '/gallery': {
      get: {
        summary: 'Search historical illustrations',
        parameters: [
          q('q', 'Text query over image descriptions'),
          q('type', 'Image type (emblem, woodcut, diagram, portrait, musical_score, …)'),
          q('subject', 'Subject filter'),
          q('collection', 'Gallery collection slug'),
          q('library', 'Contributing library'),
          q('book', 'Restrict to one book id'),
          q('semantic', 'true — semantic (meaning-based) matching'),
          q('visual', 'true — CLIP visual similarity mode'),
          q('limit', 'Max results (default 24)', { type: 'integer' }),
          q('offset', 'Pagination offset', { type: 'integer' }),
        ],
        responses: jsonResponse('Illustration records with image URLs and source books'),
      },
    },
    '/gallery/collections': {
      get: {
        summary: 'List curated image collections',
        parameters: [q('featured', 'true — featured collections only'), q('type', 'visual | thematic')],
        responses: jsonResponse('{ collections: [{ slug, title, imageCount, coverImage, … }], total }'),
      },
    },
    '/gallery/collections/{slug}': {
      get: {
        summary: 'One image collection with resolved items',
        description: 'imageCount always equals the number of items delivered.',
        parameters: [{ name: 'slug', in: 'path', required: true, description: 'Collection slug', schema: { type: 'string' } }],
        responses: jsonResponse('{ slug, title, imageCount, items: [...] }'),
      },
    },
    '/catalog/author-search': {
      get: {
        summary: 'Find canonical authors by name',
        description: 'Returns author_id slugs to feed /books/library and /books/distributions, plus VIAF/Wikidata anchors.',
        parameters: [q('q', 'Name fragment (min 2 chars)', { required: true })],
        responses: jsonResponse('{ matches: [{ author_id, canonical_name, viaf_id, wikidata_id, book_count }] }'),
      },
    },
    '/catalog/csv': {
      get: {
        summary: 'Download the full catalog as CSV',
        responses: { '200': { description: 'CSV stream', content: { 'text/csv': {} } } },
      },
    },
    '/dataset/v1/books': {
      get: {
        summary: 'Bulk book metadata (requires API key)',
        description: 'Authorization: Bearer sl_data_… — get a key at https://sourcelibrary.org/developers.',
        parameters: [q('language', 'Filter by language'), q('cluster', 'Taxonomy cluster'), q('from_year', 'Year range start', { type: 'integer' }), q('to_year', 'Year range end', { type: 'integer' }), q('offset', 'Offset', { type: 'integer' }), q('limit', 'Limit', { type: 'integer' })],
        responses: jsonResponse('{ total, books }'),
        security: [{ apiKey: [] }],
      },
    },
    '/dataset/v1/pages': {
      get: {
        summary: 'Bulk page text as streaming JSONL (requires API key)',
        description: 'One JSON record per line. Text carries the invisible provenance colophon including your key reference.',
        parameters: [q('language', 'Filter by book language'), q('cluster', 'Taxonomy cluster'), q('from_year', 'Year range start', { type: 'integer' }), q('to_year', 'Year range end', { type: 'integer' }), q('content', 'ocr | translation | both'), q('offset', 'Offset', { type: 'integer' }), q('limit', 'Limit ≤10000 (default 1000)', { type: 'integer' })],
        responses: { '200': { description: 'JSONL stream', content: { 'application/x-ndjson': {} } } },
        security: [{ apiKey: [] }],
      },
    },
    '/dataset/v1/stats': {
      get: { summary: 'Corpus statistics (requires API key)', responses: jsonResponse('Language/cluster/page totals'), security: [{ apiKey: [] }] },
    },
    '/dataset/v1/usage': {
      get: { summary: 'Your own usage meter (requires API key)', responses: jsonResponse('Requests and pages served in the current window'), security: [{ apiKey: [] }] },
    },
    '/mcp': {
      post: {
        summary: 'MCP server (JSON-RPC over HTTP)',
        description:
          'The full research toolset — search_library, search_translations, search_concept, get_book, get_book_text, get_quote, list_books, list_editions, search_images and more — self-describing via the MCP initialize / tools-list handshake. Connect from Claude: `claude mcp add source-library https://sourcelibrary.org/api/mcp`.',
        responses: jsonResponse('JSON-RPC response'),
      },
    },
  },
  components: {
    securitySchemes: {
      apiKey: { type: 'http', scheme: 'bearer', description: 'API key (sl_data_…) — https://sourcelibrary.org/developers' },
    },
  },
} as const;

export async function GET() {
  return NextResponse.json(SPEC, {
    headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
  });
}
