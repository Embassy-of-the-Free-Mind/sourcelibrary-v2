/**
 * Bot gating — page-percentage access control for AI crawlers.
 *
 * Every book is discoverable: bots can read the first 20% of pages from any book.
 * Full text requires the MCP server (whitelisted), a valid API key, or a partnership.
 *
 * This is better than the old model (100% of 20% of books) because:
 * - Every book is discoverable, not just a random subset
 * - Bots get enough context to understand what each book contains
 * - The opening pages are the most useful for search indexing
 */

import { validateApiKey } from '@/lib/dataset/api-keys';
import { CONTENT_LICENSE } from '@/lib/license-info';
import { FREE_PAGE_PERCENT, freeMaxPage } from '@/lib/free-preview';

// % of pages bots can read from each book — shared with the metered reader
// (free-preview.ts) so the bot sample and the human sample can never drift.
const BOT_PAGE_PERCENT = FREE_PAGE_PERCENT;

const KNOWN_BOTS = [
  'gptbot', 'chatgpt', 'oai-searchbot',
  'claudebot', 'claude-web', 'anthropic',
  'bytespider', 'bytedance',
  'googlebot', 'google-extended',
  'bingbot', 'msnbot',
  'perplexitybot',
  'youbot',
  'cohere-ai',
  'meta-externalagent',
  'ccbot',              // Common Crawl — a primary training-data source; gate it
  'applebot-extended',  // Apple's AI-training crawler (distinct from search Applebot)
  'sourcelibrary-mcp', // our own MCP server — always allow
];

// MCP server should never be gated
const ALWAYS_ALLOW = ['sourcelibrary-mcp'];

// Search-index crawlers we deliberately allow FULL read access. Discovery and
// citability serve the mission, so these bypass the page gate; training/bulk
// crawlers do NOT (they stay gated and must license bulk/training use). Matches
// the robots.ts search-allow list and the /licensing policy. NB: this is UA-based
// (honor system) — consistent with the rest of this gate, which only ever applied
// to self-identifying bots; a scraper using a browser UA was never gated anyway.
// NB: ccbot/bytespider appear in KNOWN_BOTS above but are hard-403'd at the
// edge (proxy.ts BLOCKED_BOT_RE), so their entries here are unreachable
// defense-in-depth — kept deliberately in case the edge rule changes (#4366).
const SEARCH_CRAWLERS = ['googlebot', 'bingbot', 'duckduckbot', 'claude-searchbot', 'oai-searchbot'];

// User-INITIATED assistant fetches: an AI assistant retrieving a page because a
// human asked it to (not a crawler). These get full access too — reading on a
// user's behalf is exactly the use we want. Claude-User already passes (it's not
// in KNOWN_BOTS); ChatGPT-User is gated only because 'chatgpt' is in KNOWN_BOTS,
// so name it here to ungate it. Matches the /licensing policy ("reading on a
// user's behalf is welcome"). The training/crawler variants (GPTBot, ClaudeBot)
// are NOT here and stay gated.
const USER_FETCH_AGENTS = ['claude-user', 'chatgpt-user', 'perplexity-user'];

export function isBot(request: Request): boolean {
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  return KNOWN_BOTS.some(bot => ua.includes(bot));
}

/** True for search-index crawlers we allow full read access (not training crawlers). */
export function isSearchCrawler(request: Request): boolean {
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  return SEARCH_CRAWLERS.some(bot => ua.includes(bot));
}

/**
 * Check if the request is trusted (bypasses the page gate) — our own MCP, a
 * search-index crawler, or a valid API key (Bearer sl_data_...).
 */
export async function isTrustedBot(request: Request): Promise<boolean> {
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  if (ALWAYS_ALLOW.some(bot => ua.includes(bot))) return true;

  // Search-index crawlers get full access; training/bulk crawlers do not.
  if (SEARCH_CRAWLERS.some(bot => ua.includes(bot))) return true;

  // User-initiated assistant fetches (a human asked an assistant to read a page).
  if (USER_FETCH_AGENTS.some(bot => ua.includes(bot))) return true;

  // Check for API key — holders bypass bot gating on all endpoints
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const keyDoc = await validateApiKey(authHeader);
    if (keyDoc) return true;
  }

  return false;
}

/**
 * Calculate the maximum page number a bot can access for a given book.
 * Returns 0 if pages_count is unknown (deny by default).
 */
export function botMaxPage(pagesCount: number): number {
  return freeMaxPage(pagesCount);
}

export function botGateResponse(book: {
  id?: string;
  title?: string;
  display_title?: string;
  author?: string;
  language?: string;
  published?: string;
  year?: number;
  pages_count?: number;
  reading_summary?: string;
}) {
  const bookId = book.id;
  const maxPage = botMaxPage(book.pages_count || 0);
  return {
    book: {
      id: bookId,
      title: book.display_title || book.title,
      author: book.author,
      language: book.language,
      published: book.published,
      year: book.year,
      pages_count: book.pages_count,
      url: `https://sourcelibrary.org/book/${bookId}`,
    },
    gated: true,
    accessible_pages: maxPage,
    message: `The first ${BOT_PAGE_PERCENT}% of this book (pages 1–${maxPage}) is freely readable. `
      + `Full text is available through our MCP server or API partnership program.`,
    mcp_install: 'claude mcp add source-library -- npx -y @source-library/mcp-server',
    summary: book.reading_summary || undefined,
    partnership: {
      contact: 'team@sourcelibrary.org',
      subject: 'AI Partnership — Full Corpus Access',
      info: 'https://sourcelibrary.org/llms.txt',
    },
    license: CONTENT_LICENSE,
  };
}
