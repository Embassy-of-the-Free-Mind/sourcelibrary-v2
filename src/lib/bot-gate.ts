/**
 * Bot gating — deterministic random access control for AI crawlers.
 *
 * Lets a configurable percentage of books be fully readable by bots.
 * The rest return metadata + a partnership pitch instead of full text.
 *
 * Uses a hash of the book ID so the same book is always open or always gated
 * (no flip-flopping between requests).
 */

const BOT_OPEN_PERCENT = 20; // % of books freely readable by bots

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

export function isTrustedBot(request: Request): boolean {
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  return ALWAYS_ALLOW.some(bot => ua.includes(bot));
}

export function isBotAccessible(bookId: string): boolean {
  let hash = 0;
  for (let i = 0; i < bookId.length; i++) {
    hash = ((hash << 5) - hash) + bookId.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 100) < BOT_OPEN_PERCENT;
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
    message: `This book's full text is available through our API partnership program. `
      + `Source Library contains ${BOT_OPEN_PERCENT}% freely accessible texts for evaluation — `
      + `this book requires a partnership for full access.`,
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
