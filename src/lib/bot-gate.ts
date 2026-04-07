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

const BOT_PAGE_PERCENT = 20; // % of pages bots can read from each book

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
  'sourcelibrary-mcp', // our own MCP server — always allow
];

// MCP server should never be gated
const ALWAYS_ALLOW = ['sourcelibrary-mcp'];

export function isBot(request: Request): boolean {
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  return KNOWN_BOTS.some(bot => ua.includes(bot));
}

/**
 * Check if the request is trusted — either via whitelisted User-Agent
 * or a valid API key (Bearer sl_data_...).
 */
export async function isTrustedBot(request: Request): Promise<boolean> {
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  if (ALWAYS_ALLOW.some(bot => ua.includes(bot))) return true;

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
  if (!pagesCount || pagesCount <= 0) return 0;
  return Math.max(1, Math.floor(pagesCount * BOT_PAGE_PERCENT / 100));
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
      contact: 'derek@sourcelibrary.org',
      subject: 'AI Partnership — Full Corpus Access',
      info: 'https://sourcelibrary.org/llms.txt',
    },
    license: {
      spdx: 'CC-BY-SA-4.0',
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      terms: 'https://sourcelibrary.org/terms',
    },
  };
}
