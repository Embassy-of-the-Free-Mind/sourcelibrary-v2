import type { NextRequest } from 'next/server';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { withApiAuth, type ApiIdentity } from '@/lib/api-auth';
import { logMcpToolCall, logMcpInitialize } from '@/lib/mcp-usage';
import { getClientIp, peekRateLimit } from '@/lib/rate-limit';
import { getShortUrl } from '@/lib/shortlinks';
import { pageContinuity, continuityHint } from '@/lib/page-continuity';
import { classifyApiError } from '@/lib/mcp-errors';
import { MAX_FEEDBACK_MESSAGE, MIN_FEEDBACK_MESSAGE } from '@/lib/feedback-limits';
import { stripProvenanceMarks } from '@/lib/provenance';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

/**
 * The MCP server version, in ONE place.
 *
 * It used to be three string literals — the `initialize` handshake, the
 * `GET /api/mcp` banner, and `server.json` — and they drifted apart every time
 * someone bumped one of them: on 2026-08-07 they read 4.7.0, 4.5.0 and 4.6.0
 * simultaneously. Two of those bumps were made by people specifically tidying
 * the version, which is the tell that the problem is the duplication, not the
 * carelessness.
 *
 * `scripts/audit/mcp-directory-contract.mjs` compares the live handshake
 * against `server.json`, so a drift here is a real tripwire and not cosmetic —
 * but it can only compare two values, and there were three.
 *
 * `server.json` is consumed by the MCP registry publisher and cannot import
 * TypeScript, so it stays a literal. That is now the ONLY other copy, and the
 * audit's job is exactly to hold it against this one. Bump both together.
 */
const SERVER_VERSION = '4.7.1';

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
    ...(r.snippet ? { snippet: stripProvenanceMarks(r.snippet as string), snippet_type: r.snippet_type } : {}),
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
  const userLimit = Math.min(Number(args.limit) || 20, 50);
  const offset = Number(args.offset) || 0;
  // BUG 1 fix: the backend can return page-rows with empty/whitespace snippets,
  // which the empty-snippet .filter(...) below strips AFTER fetching. Requesting
  // exactly userLimit rows could leave the page empty while total_matches stays
  // high. Over-fetch from the same offset to absorb the filter, then slice down
  // to userLimit. The backend clamps limit to 500 (src/app/api/search/route.ts),
  // so 150 is well within range.
  const fetchLimit = Math.min(userLimit * 3, 150);
  const params = new URLSearchParams({ q: String(args.query), pages_only: 'true', limit: String(fetchLimit), offset: String(offset) });
  if (args.language) params.set('language', String(args.language));
  if (Array.isArray(args.languages) && args.languages.length > 0) params.set('languages', args.languages.join(','));
  if (Array.isArray(args.exclude_languages) && args.exclude_languages.length > 0) params.set('exclude_languages', args.exclude_languages.join(','));
  if (args.year_from) params.set('year_from', String(args.year_from));
  if (args.year_to) params.set('year_to', String(args.year_to));
  if (args.book_id) params.set('book_id', String(args.book_id));

  const result = await apiGet('/search', params) as Record<string, unknown>;
  const passages = ((result.results as Array<Record<string, unknown>>)?.map((r) => {
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
      snippet: stripProvenanceMarks(r.snippet as string),
      // snippet_type:
      //   'translation' / 'ocr' = verbatim extract from source text (safe to quote)
      //   'summary'             = AI-generated description (do NOT quote as the author's words)
      snippet_type: snippetType,
      url: `https://sourcelibrary.org/book/${r.slug || r.book_id}?page=${r.page_number || 1}`,
      short_url: r.book_id && r.page_number ? getShortUrl(String(r.book_id), Number(r.page_number)) : undefined,
    };
  }).filter(p => !!(p.snippet as string | undefined)?.trim()) || [])
    // Slice back to what the user asked for after the empty-snippet filter.
    .slice(0, userLimit);
  return {
    query: result.query,
    total_matches: result.total,
    returned: passages.length,
    offset,
    // BUG 2: surface the backend's lane-timeout signal so callers know the count
    // may be incomplete when a search lane degraded. Only present when true.
    ...(result.partial ? { partial: true } : {}),
    passages,
    tip: 'original_language is the book\'s source language; snippet_language is the language of the snippet text (English for translations/summaries, source language for ocr). Only quote snippets where snippet_type is "translation" or "ocr". Always cite using short_url when presenting passages to users.',
  };
}

async function searchConcept(args: Record<string, unknown>) {
  const userLimit = Math.min(Number(args.limit) || 15, 50);
  // BUG 1 fix (same pattern as searchPassages): the empty-snippet .filter(...)
  // below can empty the page when the backend's first rows carry blank snippets.
  // Over-fetch, filter, then slice to userLimit. Semantic endpoint accepts the
  // same 50 max as the tool, so clamp fetchLimit to 50.
  const fetchLimit = Math.min(userLimit * 3, 50);
  const params = new URLSearchParams({ q: String(args.query), level: 'page', limit: String(fetchLimit) });
  if (args.language) params.set('language', String(args.language));
  if (Array.isArray(args.languages) && args.languages.length > 0) params.set('languages', args.languages.join(','));
  if (Array.isArray(args.exclude_languages) && args.exclude_languages.length > 0) params.set('exclude_languages', args.exclude_languages.join(','));
  if (args.year_from) params.set('year_min', String(args.year_from));
  if (args.year_to) params.set('year_max', String(args.year_to));
  if (args.max_per_book) params.set('max_per_book', String(args.max_per_book));

  const result = await apiGet('/search/semantic', params) as Record<string, unknown>;
  const passages = ((result.results as Array<Record<string, unknown>>)?.map((r) => ({
    book_id: r.book_id,
    title: r.book_title,
    author: r.book_author,
    original_language: r.book_language,
    snippet_language: 'English',
    published: r.book_year,
    page: r.page_number,
    snippet: stripProvenanceMarks(r.snippet as string),
    // 'translation' = verbatim source text (safe to quote).
    // 'summary'     = AI-written page-continuity preamble we couldn't cleanly strip —
    //                 useful as topical evidence but DO NOT quote as the author's words.
    snippet_type: r.snippet_type || 'translation',
    similarity: r.score,
    url: `https://sourcelibrary.org/book/${r.slug || r.book_id}?page=${r.page_number || 1}`,
    short_url: r.book_id && r.page_number ? getShortUrl(String(r.book_id), Number(r.page_number)) : undefined,
  })).filter(p => !!(p.snippet as string | undefined)?.trim()) || [])
    .slice(0, userLimit);
  return {
    query: result.query,
    // total_matches mirrors the post-slice page size here (semantic endpoint does
    // not return a separate corpus count), so keep it equal to returned.
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
    return {
      page: pageNum, snippet: stripProvenanceMarks(best?.snippet as string), source: best?.field, match_count: matches?.length || 0,
      // Relevance and which leg found it. A page found by BOTH keyword and
      // meaning is the strongest signal the tool can give.
      ...(r.score !== undefined ? { score: r.score } : {}),
      ...(r.found_by ? { found_by: r.found_by } : {}),
      // Not body text: introduction, preface, contents, index, blank leaves,
      // binding photography. Surfaced, not
      // just used for ordering, so a caller can SEE why something ranks low —
      // and so a reader who genuinely wants the translator's own words knows
      // which results those are.
      ...(r.is_front_matter ? { is_front_matter: true, front_matter_reason: r.reason } : {}),
      url: `https://sourcelibrary.org/book/${bookId}?page=${pageNum}`,
      short_url: bookId && pageNum ? getShortUrl(bookId, pageNum) : undefined,
    };
  });
  const frontCount = Number(result.front_matter_results) || 0;
  // Present only when the semantic leg could not see this book. Passed straight
  // through so the caveat reaches the agent that has to decide whether a blank
  // means "not here" — which, on an unembedded book, it does not.
  const coverage = result.semantic_coverage as { status?: string; caveat?: string } | undefined;
  return {
    book_id: args.book_id, query: result.query, total: result.total, returned: result.returned,
    ...(frontCount ? { front_matter_results: frontCount } : {}),
    ...(coverage ? { semantic_coverage: coverage } : {}),
    results,
    tip: `Use get_book_text with from/to page numbers to read the full text around these matches. Always cite using short_url when presenting passages to users.${frontCount ? ` ${frontCount} of these are front matter (introduction, preface, contents) and are ordered last — they are the translator's or publisher's words, not the author's.` : ''}${coverage?.caveat ? ` SEMANTIC COVERAGE: ${coverage.caveat}` : ''}`,
  };
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
    work_id: result.work_id,
    // What the volume's own running heads say it holds, with page spans. This
    // is the answer to "which book has the Poetics?", which the catalogue title
    // could not give — four volumes advertised works their scans do not contain
    // (#3652 A). Absent where the scans carry no heads; `status:
    // 'insufficient-heads'` means examined and undecidable, not unexamined.
    ...(result.contains_works ? { contains_works: result.contains_works } : {}),
    url: `https://sourcelibrary.org/book/${result.slug || result.id}`,
    iiif_manifest: `https://sourcelibrary.org/api/iiif/${result.id}/manifest`,
  };
}

/**
 * Every edition of one work that we hold.
 *
 * Asked for in #3653 item 6: "list_books(search='Aristotle') returns 248
 * heavily-duplicated results with no way to ask 'show me every witness to
 * Politics I.2'." The witnesses were the session's most interesting finding —
 * comparing Congreve 1855, a 15th-c. Greek MS and Bekker 1831 established that
 * what circulates as Aristotle today is Bacon's 1625 reshaping.
 *
 * Cheap because the work layer already exists: 98.5% of live books carry a
 * `work_id`. Its known limit is that on multi-work volumes the id names the
 * CONTAINER — Bekker vol. 2 is `aristotle-aristotelis-opera`, not the
 * Metaphysics — so for those this returns the other volumes of the set rather
 * than other witnesses to one text. That is the `contains_works` gap (#3652 A),
 * and it is stated in the response rather than hidden, because a caller that
 * believes it is looking at witnesses when it is looking at a set will draw a
 * wrong conclusion about the transmission.
 */
async function listEditions(args: Record<string, unknown>) {
  let workId = args.work_id ? String(args.work_id) : '';
  let seed: Record<string, unknown> | null = null;

  if (!workId) {
    if (!args.book_id) return { error: 'Provide either book_id or work_id.' };
    seed = await apiGet(`/books/${args.book_id}`, new URLSearchParams({ pages: 'nav' })) as Record<string, unknown>;
    workId = String(seed.work_id || '');
    if (!workId) {
      return {
        book_id: args.book_id,
        editions: [],
        note: 'This book carries no work_id, so sibling editions cannot be identified. About 1.5% of live books are in this state.',
      };
    }
  }

  const result = await apiGet('/books/library', new URLSearchParams({ work_id: workId, limit: '50' })) as Record<string, unknown>;
  const editions = ((result.books as Array<Record<string, unknown>>) || []).map((b) => ({
    id: b.id,
    title: b.display_title || b.title,
    author: b.author,
    language: b.language,
    published: b.published,
    pages_count: b.pages_count,
    translation_percent: b.translation_percent,
    is_first_translation: b.is_first_translation,
    url: `https://sourcelibrary.org/book/${b.slug || b.id}`,
  }));

  const container = /opera|works|complete|s[äa]mtliche|oeuvres|\bvol\b|volume/i.test(String(workId));
  return {
    work_id: workId,
    ...(seed ? { seed_book: seed.display_title || seed.title } : {}),
    total: result.total,
    editions,
    ...(container ? {
      caveat: 'This work_id names a multi-volume COLLECTION, not a single work — so these are other volumes of the set, not other witnesses to one text. Per-work identification is not yet available (#3652).',
    } : {}),
    tip: 'Languages differ across editions: compare an original-language witness against a translation before concluding what an author wrote. A phrase present only in one English edition may belong to its translator.',
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

// The shareable shortlink lives at result.citation.short_url. Lift it to a
// headline `citation_link` (and keep `short_url` for back-compat) so an LLM
// caller treats the quote-plus-link as the deliverable instead of burying the
// link in a citation sub-object and paraphrasing without it (#2820).
function withCitationLink(result: Record<string, unknown>) {
  const citation = result.citation as Record<string, unknown> | undefined;
  const link = citation?.short_url as string | undefined;
  return link ? { citation_link: link, short_url: link, ...result } : result;
}

const QUOTE_TIP =
  'Copy the translation text exactly when quoting — do not paraphrase. ' +
  'Present the citation_link to the user alongside the quote. Render as:\n' +
  '> [exact translation text, verbatim]\n' +
  '> — [Author], p. [N]. [citation_link]';

// Three-layer apparatus for non-Latin scripts (#3828). Only emitted when a
// page actually carries a romanization, so a caller quoting a Latin book is
// never told about a field that isn't there.
const ROMANIZED_TIP =
  'This page is in a non-Latin script and carries all three layers. Render as:\n' +
  '> [original, verbatim]\n' +
  '> [romanized]\n' +
  '> [translation, verbatim]\n' +
  '> — [Author], p. [N]. [citation_link]\n' +
  'The `romanized` field is AI-generated reading apparatus, not a transcription — ' +
  'never present it as the text printed on the page, and quote from `original` or ' +
  '`translation` when quoting the source itself.';

function hasRomanized(result: Record<string, unknown>): boolean {
  const quote = result.quote as Record<string, unknown> | undefined;
  return typeof quote?.romanized === 'string' && quote.romanized.length > 0;
}

async function getQuote(args: Record<string, unknown>) {
  const params = new URLSearchParams({ page: String(args.page) });
  // The quote API has always accepted this; the MCP tool never passed it, so
  // every client got exactly one page and no way to ask for the rest of the
  // sentence. Opt-in, because it triples the payload on a call that is usually
  // fine as-is — 18.6% of adjacent prose pairs span the break, not 100%.
  if (args.context === true) params.set('include_context', 'true');

  const result = await apiGet(`/books/${args.book_id}/quote`, params) as Record<string, unknown>;

  // The flags are the actual fix. Access was never the problem — a caller cannot
  // tell a fragment from a whole sentence, so it never knows to ask. Computed
  // from text already in hand: no extra query, no extra model call.
  // The served field is `translation` (see src/app/api/books/[id]/quote/route.ts);
  // `text` is not a field on this response and reading it silently produced
  // all-false flags on a preview deploy while every unit test stayed green.
  const quote = result.quote as Record<string, unknown> | undefined;
  const quoteText = typeof quote?.translation === 'string' ? quote.translation : null;
  // Hyphen splits live in the ORIGINAL, never in the translation — a translator
  // resolves them. Passing only the translation made hyphen_split_at_end
  // unfireable; see the note on pageContinuity's second parameter.
  const originalText = typeof quote?.original === 'string' ? quote.original : null;
  const continuity = pageContinuity(quoteText, originalText);
  // Strip the zero-width provenance mark on the CITATION path. See
  // stripProvenanceMarks in src/lib/provenance.ts for why this and not
  // get_book_text: one page is a citation, hundreds is a corpus pull.
  if (quote && typeof quote.translation === 'string') quote.translation = stripProvenanceMarks(quote.translation);
  if (quote && typeof quote.original === 'string') quote.original = stripProvenanceMarks(quote.original);
  if (quote && typeof quote.romanized === 'string') quote.romanized = stripProvenanceMarks(quote.romanized);
  const ctx = result.context as Record<string, unknown> | undefined;
  if (ctx) {
    for (const k of ['previous_page', 'next_page']) {
      if (typeof ctx[k] === 'string') ctx[k] = stripProvenanceMarks(ctx[k] as string);
    }
  }
  const hint = continuityHint(continuity, Number(args.page));

  return {
    ...withCitationLink(result),
    continuity,
    ...(hint ? { continuity_hint: hint } : {}),
    tip: hasRomanized(result) ? `${QUOTE_TIP}\n\n${ROMANIZED_TIP}` : QUOTE_TIP,
  };
}

// Assemble a multi-passage dossier in one round-trip: fetch several pages of a
// single book by explicit list (pages:[...]) or inclusive range (from/to).
async function getQuotes(args: Record<string, unknown>) {
  const bookId = String(args.book_id);
  let pageNums: number[] = [];
  if (Array.isArray(args.pages)) {
    pageNums = (args.pages as unknown[]).map(Number).filter((n) => Number.isFinite(n));
  } else if (args.from !== undefined && args.to !== undefined) {
    const from = Number(args.from);
    const to = Number(args.to);
    for (let p = from; p <= to; p++) pageNums.push(p);
  }
  // De-dupe, keep order, and cap the batch so one call can't fan out unboundedly.
  pageNums = [...new Set(pageNums)].slice(0, 25);
  if (pageNums.length === 0) {
    return { error: 'Provide either pages:[...] or both from and to (a page range).', book_id: bookId };
  }

  const settled = await Promise.all(
    pageNums.map(async (page) => {
      try {
        const result = await apiGet(`/books/${bookId}/quote`, new URLSearchParams({ page: String(page) })) as Record<string, unknown>;
        // Same continuity signal get_quote returns. This is the tool where it
        // matters MOST — a batch is how a caller assembles a multi-page dossier,
        // which is exactly where a sentence running across a leaf gets quoted as
        // though it were whole. Omitting it here was backwards.
        const q = result.quote as Record<string, unknown> | undefined;
        const continuity = pageContinuity(
          typeof q?.translation === 'string' ? q.translation : null,
          typeof q?.original === 'string' ? q.original : null,
        );
        if (q && typeof q.translation === 'string') q.translation = stripProvenanceMarks(q.translation);
        if (q && typeof q.original === 'string') q.original = stripProvenanceMarks(q.original);
        if (q && typeof q.romanized === 'string') q.romanized = stripProvenanceMarks(q.romanized);
        const hint = continuityHint(continuity, page);
        return { ...withCitationLink(result), continuity, ...(hint ? { continuity_hint: hint } : {}) };
      } catch (err) {
        // Per-page structured failure, so one untranslated page in a range does
        // not read as the whole batch being broken.
        return { page, ...classifyApiError(err) };
      }
    })
  );

  const anyRomanized = settled.some((s) => hasRomanized(s as Record<string, unknown>));

  return {
    book_id: bookId,
    pages_requested: pageNums,
    quotes: settled,
    tip: anyRomanized ? `${QUOTE_TIP}\n\n${ROMANIZED_TIP}` : QUOTE_TIP,
  };
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
    // Standalone artworks (source:'artwork') have no page in the gallery viewer —
    // their pageId is the synthetic `artwork-<bookId>`, and /gallery/image/artwork-…-0
    // 404s. Link them to their own detail page (item.link) instead.
    url: item.source === 'artwork'
      ? `https://sourcelibrary.org${item.link || `/book/${item.bookId}`}`
      : `https://sourcelibrary.org/gallery/image/${item.pageId}-${item.detectionIndex}`,
    book_url: item.bookId
      ? (item.source === 'artwork'
        ? `https://sourcelibrary.org/book/${item.bookId}`
        : `https://sourcelibrary.org/book/${item.bookId}?page=${item.pageNumber}`)
      : undefined,
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

async function shareFindings(args: Record<string, unknown>) {
  const result = await apiPost('/share-findings', {
    title: args.title,
    summary: args.summary || null,
    citations: args.citations || [],
    name: args.name || null,
    email: args.email || null,
  }) as Record<string, unknown>;
  return { ok: true, id: result.id, message: result.message || 'Findings shared with the Source Library team. Thank you!' };
}

async function proposeCollection(args: Record<string, unknown>) {
  const result = await apiPost('/collection-proposals', {
    title: args.title,
    rationale: args.rationale,
    book_ids: args.book_ids || [],
    suggested_slug: args.suggested_slug || null,
    name: args.name || null,
    email: args.email || null,
  }) as Record<string, unknown>;
  return { ok: true, id: result.id, message: result.message || 'Collection proposal sent to the Source Library team for review. Thank you!' };
}

/**
 * Resolve a canonical locus — a Bekker or Stephanus reference — to the leaves
 * that carry it (#3661).
 *
 * This exists because a reader fact-checking attributed Aristotle quotes had to
 * reconstruct the Bekker mapping by hand and then guess which scan page held
 * 1094 (#3653 item 2). A scan page is a property of one copy; a Bekker number is
 * how the field cites, and it is stable across every edition.
 */
async function getLocus(args: Record<string, unknown>) {
  const ref = String(args.reference ?? args.ref ?? '').trim();
  if (!ref) return { error: 'Provide reference, e.g. "1094a8" (Bekker) or "328b" with work: "Republic" (Stephanus).' };
  const params = new URLSearchParams({ ref });
  if (args.work) params.set('work', String(args.work));
  if (args.system) params.set('system', String(args.system));
  return apiGet('/locus', params);
}

// ── Tool definitions ───────────────────────────────────────────────

// Shared annotation for all read-only tools
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const TOOLS: Tool[] = [
  {
    name: 'search_library',
    title: 'Search Library',
    description: 'RETURNS A LIST OF BOOKS (works on a topic) — NOT passages. PICK THIS to discover which works exist on a subject. → For quotable text use search_translations (exact words) or search_concept (by meaning); if the user already named an author/work, call get_book directly (or list_books to find the ID) — the AI summary + chapter outline is usually the right first answer. Searches titles, authors, subjects, and (as a secondary signal) translated text. Query tips: single distinctive words or short phrases work best ("memory palace", "ouroboros"); quoted phrases match exactly. Each result includes total_matches (full count) + returned (this page) + offset for pagination.',
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
    title: 'Search Translations',
    description: 'RETURNS QUOTABLE PASSAGES (page-level snippets + citation URLs), matched by KEYWORD/term. PICK THIS to find a quote or textual evidence on a topic across the whole library. → If the modern word won\'t literally appear in historical texts, use search_concept (matches by meaning); to list which BOOKS cover a topic use search_library; to dig inside one known book use search_within_book; if the user named an author/work, get_book first (its AI summary is usually the right first read). Query tips: single distinctive terms ("memory palace", "wax tablet") work best; multi-word natural-English queries ("unity of the intellect") may return fewer results because matching is term-based, not phrase-based. Each snippet has a snippet_type — "translation"/"ocr" means it is a verbatim extract from the source text; "summary" means it is AI-generated description (do not quote those as the author\'s words). Response includes total_matches, returned, and offset for pagination. Cross-cultural tip: for pre-modern or non-Western topics, search source-tradition vocabulary rather than modern English terms — e.g. for seminal economy search "jing" or "bindu" or "istimnāʾ", not "semen retention"; for female homoeroticism search "tribade" or "sahq", not "lesbian". The corpus is indexed via period translations that use tradition-internal terminology.',
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
    title: 'Search by Concept',
    description: 'RETURNS QUOTABLE PASSAGES matched by MEANING (cosine similarity on Gemini embeddings, 768d) — paraphrases and adjacent phrasings match even with zero keyword overlap. PICK THIS when the modern term won\'t literally appear in historical texts — e.g. "distributed cognition" maps to passages about active intellect, art of memory, wax tablet metaphors; "social contract" maps to pre-Hobbesian discussions of consent and authority. → For exact words/distinctive terms use search_translations (cheaper, more precise); to list which BOOKS cover a topic use search_library; if the user named an author/work, get_book first (semantic search is expensive — reserve it for cross-corpus discovery). Similarity calibration: 0.70+ is a strong match, 0.55–0.70 is worth reading but verify, below 0.55 is mostly conceptual drift. Set max_per_book to diversify results across many books rather than cluster on one source. Each passage carries a snippet_type — quote only "translation" snippets, never "summary". Cross-cultural tip: for pre-modern or non-Western topics, also try source-tradition vocabulary — e.g. for seminal economy try "jing preservation" or "bindu yoga" or "istimnāʾ"; for masturbation try "mollities" (Latin) or "hastamaithuna" (Sanskrit) or "shouyin" (Chinese). The corpus is indexed via period translations that use tradition-internal terminology, so adjacent/euphemistic terms often surface material that modern English keywords miss.',
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
    title: 'Search Within Book',
    description: 'SEARCHES INSIDE ONE BOOK (requires book_id). PRIMARILY KEYWORD: it runs a lexical search over the book\'s pages plus a narrow scoped-semantic pass (top ~10), interleaved by relevance. PICK THIS when you know the wording you are looking for, or want every page of one book mentioning a term. → IF YOU ARE SEARCHING FROM A PARAPHRASE, a half-remembered line, or a modern restatement, USE search_concept INSTEAD — it is the meaning-matching tool and it searches the whole corpus, including translations whose vocabulary differs completely from yours (Thomas Taylor writes "energies" for energeia and "felicity" for eudaimonia, so a sensible modern paraphrase can miss his pages entirely while matching semantically). → To find the book first, use search_library or search_concept, then pass its book_id here. Each result carries score (0-1, normalised within this book) and found_by ("keyword", "semantic", or "both" — both is the strongest signal). Results flagged is_front_matter are the translator\'s or publisher\'s words rather than the author\'s, and are ordered last. Returns OCR and translation snippets with page numbers, ready to cite.',
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
    title: 'List Books',
    description: 'BROWSES/FILTERS THE CATALOG by metadata (author/title fragment, language, category, translation recency) — no content/topic matching. PICK THIS to see WHAT EXISTS by an author or in a tradition. Returns books with title, author, language, year, and translation progress. → For a relevance-ranked topic search use search_library; for passages on a theme use search_translations (exact words) or search_concept (by meaning).',
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
    title: 'Get Book',
    description: 'READ PIPELINE step 1 — DISCOVER. START HERE for any named work or author. Returns the book\'s AI-generated summary, chapter list, edition metadata, DOI, page counts, and IIIF manifest. The summary is typically a multi-paragraph orientation covering the book\'s argument, structure, and significance — often answering the question without further searching. Then: get_book_text to read a chapter or page range (step 2), get_quote / get_quotes to lock specific pages with full citation apparatus (step 3). search_within_book locates passages inside this book. MULTI-WORK VOLUMES: where the scans carry running heads, contains_works lists the works the volume ACTUALLY holds with their page spans, taken from the heads the printer put on each leaf. Trust it over the title — collected-works titles routinely name works the volume does not contain, and the volume holding a work often does not name it. If contains_works is absent the scans have no heads to read; status "insufficient-heads" means it was examined and could not be decided.',
    annotations: { title: 'Get Book', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: { book_id: { type: 'string', description: 'The book ID' } },
      required: ['book_id'],
    },
  },
  {
    name: 'get_book_text',
    title: 'Read Book Text',
    description: 'READ PIPELINE step 2 — READ. Read a book\'s text. Call get_book first (step 1) for the chapter list, then come here. Preferred: use the chapter param to read one chapter at a time (includes [Page N] markers for citation). Alternatively, use from/to for explicit page ranges (e.g. from=1 to=50). When you find passages worth quoting, hand the page numbers to get_quote / get_quotes (step 3) for verbatim text + a citation link. TRUNCATION: the response always includes truncated: true/false. When truncated=true, the truncation_note field gives the exact next from/to values to call — this means content was cut short by a page-budget limit, NOT that the book ended. An AI agent MUST NOT infer end-of-book from pages_returned alone; check truncated first. Budget limits apply to anonymous callers (~50 pages per 24h); sign in at sourcelibrary.org/auth/signin or get an API key at sourcelibrary.org/developers for higher limits.',
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
    title: 'Get Quote',
    description: 'READ PIPELINE step 3 — CITE. Get the exact verbatim text of a single page plus its citation apparatus. ALWAYS use before putting text in quotation marks. The response headline is citation_link (the stable sourcelibrary.org/q/… shortlink) — present it to the user alongside the quote. Render as:\n> [exact translation text, verbatim]\n> — [Author], p. [N]. [citation_link]\nPAGE BREAKS: this corpus is paginated from physical leaves, and nearly one prose page-boundary in five has a sentence running across it — sometimes a word split by a hyphen ("…our move-" / "movements…"). A page that opens or breaks off mid-sentence still reads as complete prose and still carries a perfectly valid citation, so check the continuity field on every response BEFORE quoting: if continues_on_next or continues_from_previous is true, call again with context: true and quote the whole sentence. Quoting a fragment as though it were the author\'s complete thought is a misattribution even when the page number is right.\nNON-LATIN SCRIPTS: where the page is Greek, Hebrew, Arabic, Sanskrit, Cyrillic and so on, the response also carries romanized — the romanization of the original — so the citation can be shown in three layers: original → romanized → translation → citation_link. It is AI-generated reading apparatus, not a transcription; quote the source from original or translation, never from romanized. Absent on Latin-script pages and on non-Latin pages not yet romanized.\nFor several pages of one book at once, use get_quotes.',
    annotations: { title: 'Get Quote', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: {
        book_id: { type: 'string', description: 'The book ID' },
        page: { type: 'number', description: 'Page number' },
        context: { type: 'boolean', description: 'Also return the full text of the previous and next pages, so a sentence spanning the page break can be read whole. Set this when continuity.continues_from_previous or continues_on_next came back true on an earlier call, or whenever you are about to quote near a page edge.' },
      },
      required: ['book_id', 'page'],
    },
  },
  {
    name: 'list_editions',
    title: 'List Editions of a Work',
    description: 'Every edition of one work that the library holds — the other witnesses to the same text, across languages and centuries. Give it a book_id (easiest: the id of any edition you already found) or a work_id. USE THIS when a quotation needs checking against more than one witness, when you want the original-language text behind a translation, or when comparing how a passage reads across editions — differences between witnesses are often the finding. Returns language, date, page count and translation coverage per edition, so you can pick the right one to read. Note: for multi-volume collected works the identifier names the SET rather than a single text, and the response says so explicitly when that applies.',
    annotations: { title: 'List Editions of a Work', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: {
        book_id: { type: 'string', description: 'Any edition you already have. Its work is looked up and the siblings returned.' },
        work_id: { type: 'string', description: 'A work identifier, if you already have one (from get_book).' },
      },
    },
  },
  {
    name: 'get_quotes',
    title: 'Get Quotes (batch)',
    description: 'READ PIPELINE step 3 — CITE, in batch. Get verbatim text + citation_link for SEVERAL pages of a single book in one round-trip, to assemble a multi-passage dossier. Specify either pages (an explicit array, e.g. [12, 40, 41]) or an inclusive from/to range. Max 25 pages per call. Each entry carries its own citation_link to present alongside the quote, and — on non-Latin-script pages that have one — a romanized layer to show between the original and the translation (AI apparatus, not a transcription).',
    annotations: { title: 'Get Quotes (batch)', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: {
        book_id: { type: 'string', description: 'The book ID' },
        pages: { type: 'array', items: { type: 'number' }, description: 'Explicit list of page numbers (e.g. [12, 40, 41]). Use this OR from/to.' },
        from: { type: 'number', description: 'Start page (inclusive) of a range. Use with to.' },
        to: { type: 'number', description: 'End page (inclusive) of a range. Use with from.' },
      },
      required: ['book_id'],
    },
  },
  {
    name: 'search_images',
    title: 'Search Images',
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
    title: 'Submit Feedback',
    description: 'Submit feedback, bug reports, or feature requests to the Source Library team.',
    annotations: { title: 'Submit Feedback', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object' as const,
      properties: {
        message: { type: 'string', description: `Your feedback (${MIN_FEEDBACK_MESSAGE}-${MAX_FEEDBACK_MESSAGE} chars). Long structured reports are welcome — the limit was raised from 5,000 because agent reports were pressing against it and being split across submissions.` },
        name: { type: 'string' }, email: { type: 'string' },
      },
      required: ['message'],
    },
  },
  {
    name: 'share_findings',
    title: 'Share Findings',
    description: 'Share a research dossier back to the Source Library team — a title, an optional summary, and an ordered list of citations (the passages your thesis rests on). Each citation is a reference { book_id, page, note }, NOT copied text: the library re-renders the canonical quote from the reference, so links stay authoritative. Use this when the user has assembled a thesis backed by passages across one or more books and wants to contribute it back. Like submit_feedback, this goes to the team for review (not an instant public page).',
    annotations: { title: 'Share Findings', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Title of the dossier / thesis (2-300 chars)' },
        summary: { type: 'string', description: 'Optional prose summarizing the argument (max 5000 chars)' },
        citations: {
          type: 'array',
          description: 'Ordered list of supporting passages (1-50). Get book_id + page from get_quote / search_translations.',
          items: {
            type: 'object',
            properties: {
              book_id: { type: 'string', description: 'The book ID' },
              page: { type: 'number', description: 'Page number' },
              note: { type: 'string', description: 'Optional note on why this passage matters' },
            },
            required: ['book_id', 'page'],
          },
        },
        name: { type: 'string' }, email: { type: 'string' },
      },
      required: ['title', 'citations'],
    },
  },
  {
    name: 'propose_collection',
    title: 'Propose a Collection',
    description: 'Propose a themed collection of books to the Source Library team — a title, a rationale (why these books belong together and what thread connects them), and an ordered list of book ids. Get book ids from search_library / list_books / get_book. Like submit_feedback and share_findings, this goes to the team for REVIEW — it does NOT create a public collection instantly; a curator reviews and approves it. Use this when the user has identified a coherent set of books worth grouping and wants to contribute that curation back.',
    annotations: { title: 'Propose a Collection', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Title of the proposed collection (2-200 chars)' },
        rationale: { type: 'string', description: 'Why these books belong together and what connects them (max 5000 chars)' },
        book_ids: {
          type: 'array',
          description: 'Ordered list of book ids to include (1-200). Get ids from search_library / list_books / get_book.',
          items: { type: 'string', description: 'A book id' },
        },
        suggested_slug: { type: 'string', description: 'Optional URL slug suggestion, e.g. "renaissance-astronomy"' },
        name: { type: 'string' }, email: { type: 'string' },
      },
      required: ['title', 'rationale', 'book_ids'],
    },
  },
  {
    name: 'get_locus',
    title: 'Find a Canonical Reference (Bekker / Stephanus)',
    description: 'Turn a CANONICAL CITATION into the actual leaves that carry it. Aristotle is cited by Bekker number (1094a8, 1447a) and Plato by Stephanus number (Rep. 328b) — the references scholarship has used for centuries, which survive re-typesetting and are shareable in a way a scan page never is. USE THIS FIRST whenever a passage arrives as a canonical reference rather than a page: do not try to derive the page yourself from a book\'s pagination, which is what produced a wrong guess before this tool existed. Bekker numbers are unique across the whole Aristotelian corpus, so the number alone is enough and it also tells you WHICH WORK you are citing. Stephanus numbers restart in each of the three 1578 volumes, so pass work ("Republic", "Timaeus") — without it the response lists the candidate dialogues instead of choosing one. Returns every witness the library holds: the Greek reference edition and, where we have one, an English translation of the same lines, each with its scan page, a reader URL and a quote_api link — so you can compare the original against a translation at one reference. Then call get_quote with the returned book_id + page for the verbatim text and a citable shortlink. LIMITS, stated plainly: a witness is only returned where the reference is PRINTED on that leaf (or, in the two root editions, where a verified constant offset brackets it) — nothing is interpolated, so an empty result means this library holds no anchored leaf there, NOT that the citation is wrong; editions_searched shows what was consulted and the range each covers. Line numbers (the "8" of 1094a8) are not resolved — you get the right leaf and read the line off it. Two works can share a page where one ends and the next begins (Bekker 184 and 1447 are both such joins), and each leaf is filed by the running head printed on it, so a reference at the very start of a work may come back under its predecessor — always read other_works_at_this_reference before concluding a passage is absent. A bare number that exists in both systems returns Aristotle and Plato leaves together; check the system field on each.',
    annotations: { title: 'Find a Canonical Reference', ...READ_ONLY },
    inputSchema: {
      type: 'object' as const,
      properties: {
        reference: { type: 'string', description: 'The canonical reference: "1094a8", "1094a", "1447", "328b". A leading system name is accepted ("Bekker 1094a"), as is a work name ("Rep. 328b").' },
        work: { type: 'string', description: 'The work or dialogue, when the reference needs it (Plato always does): "Republic", "Timaeus", "Laws", "Nicomachean Ethics", "Poetics". Greek or Latin titles as printed in the editions also resolve.' },
        system: { type: 'string', description: 'Optional: "bekker" or "stephanus". Inferred from the work when omitted; do not guess it from the number, since the two ranges overlap.' },
      },
      required: ['reference'],
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
    case 'list_editions': return listEditions(args);
    case 'get_locus': return getLocus(args);
    case 'get_book_text': return getBookText(args);
    case 'get_quote': return getQuote(args);
    case 'get_quotes': return getQuotes(args);
    case 'search_images': return searchImages(args);
    case 'submit_feedback': return submitFeedback(args);
    case 'share_findings': return shareFindings(args);
    case 'propose_collection': return proposeCollection(args);
    // Name every tool in the error: a caller that guessed a name ("search") can
    // self-correct on the next call instead of concluding the server is broken.
    default: throw new Error(`Unknown tool: ${name}. Available tools: ${TOOLS.map((t) => t.name).join(', ')}`);
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
    { name: 'source-library', version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  /**
   * Documents an agent can READ from inside a session.
   *
   * Reported from a full working day spent on the wrong tool (#3653 follow-up
   * #5): *"Surface /llms.txt from inside the MCP. An agent in a chat session
   * has no way to discover it, and it is the file that would have prevented all
   * of this."* Correct — the file has existed at sourcelibrary.org/llms.txt the
   * whole time and is reachable only by someone already browsing the website,
   * which an MCP client is not doing. Tool descriptions can carry a sentence;
   * they cannot carry a corpus guide.
   */
  const RESOURCES = [
    {
      uri: 'https://sourcelibrary.org/llms.txt',
      name: 'Source Library — guide for AI agents',
      title: 'How to search this corpus well',
      description: 'What the corpus holds, which search tool to reach for, how citation and provenance work, and the failure modes worth knowing before you spend calls. Read this first if you are doing sustained research rather than a single lookup.',
      mimeType: 'text/plain',
    },
  ] as const;

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: RESOURCES.map((r) => ({ ...r })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const known = RESOURCES.find((r) => r.uri === uri);
    if (!known) throw new Error(`Unknown resource: ${uri}`);
    const resp = await fetch(uri, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`Could not read ${uri}: HTTP ${resp.status}`);
    return { contents: [{ uri, mimeType: known.mimeType, text: await resp.text() }] };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
    _meta: {
      about: 'Source Library — 15,000+ rare pre-modern texts translated into English from Latin, German, Tibetan, Greek, Sanskrit, Arabic, Sumerian, Chinese, Hebrew, and more. The full breadth of pre-modern intellectual history: theology, philosophy, history, literature, natural philosophy, mysticism, alchemy, Hermetica, medicine, mathematics, astronomy, law. Not only esoteric — also the canon. 4M+ searchable page embeddings. https://sourcelibrary.org',
      read_first: 'https://sourcelibrary.org/llms.txt — a guide to this corpus and its search tools, also exposed as an MCP resource. Worth reading once before a long research session; it costs one call and documents the failure modes that otherwise cost many.',
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
        '7. A CANONICAL REFERENCE IS NOT A PAGE. If a passage arrives as "1094a8" (Bekker, Aristotle) or "Rep. 328b" (Stephanus, Plato), call get_locus — do not derive the page from a volume\'s pagination. Deriving it is how a previous session guessed wrong.',
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
      // Structured, not prose. Ten separate AI-client reports (#3083) describe
      // the same failure: an opaque string reads as a NON-DETERMINISTIC error,
      // so the client falls back to general web search and tells the user the
      // text "could not be retrieved" — a false statement about the corpus
      // caused by a temporary rate limit. A code plus a recovery sentence lets
      // the caller wait, authenticate, fall back, or give up honestly.
      const payload = classifyApiError(error);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
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
    version: SERVER_VERSION,
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

/**
 * Record who is connecting. `initialize` is the only MCP message that carries
 * `params.clientInfo`, and the transport consumes it before any of our handlers
 * see it — so we read it off the parsed body here, before handing it to the SDK.
 *
 * Batched JSON-RPC arrives as an array, hence the normalisation. Never throws:
 * a malformed body is the client's problem, not a reason to fail the request.
 */
function logInitializeFrom(body: unknown, ip: string, userAgent: string | null) {
  const messages = Array.isArray(body) ? body : [body];
  for (const msg of messages) {
    const m = msg as { method?: unknown; params?: Record<string, unknown> } | null;
    if (!m || m.method !== 'initialize') continue;
    const info = (m.params?.clientInfo || {}) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'string' ? v : null);
    logMcpInitialize({
      clientName: s(info.name),
      clientVersion: s(info.version),
      clientTitle: s(info.title),
      protocolVersion: s(m.params?.protocolVersion),
      ip,
      userAgent,
    });
  }
}

export const POST = withApiAuth(async (req: NextRequest, _ctx, identity) => {
  try {
    const body = await req.json();
    logInitializeFrom(body, getClientIp(req), req.headers.get('user-agent'));

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
    },
  });
}
