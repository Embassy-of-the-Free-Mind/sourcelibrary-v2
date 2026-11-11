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
import { provableClaimIn, verifyCrawlerClaim } from '@/lib/crawler-verify';
import { getClientIp } from '@/lib/rate-limit';
import { namesListedClient, provenByPublishedList } from '@/lib/assistant-fetchers';
import { inProcessCaller } from '@/lib/inprocess-caller';
import { hasMcpProof } from '@/lib/mcp-self-proof';

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

// Our hosted MCP server. Its name is honoured only with proof (isTrustedBot):
// an in-process call, or the x-sl-mcp-proof header on its HTTP self-calls.
const ALWAYS_ALLOW = ['sourcelibrary-mcp'];

// Search-index crawlers we deliberately allow FULL read access. Discovery and
// citability serve the mission, so these bypass the page gate; training/bulk
// crawlers do NOT (they stay gated and must license bulk/training use). Matches
// the robots.ts search-allow list and the /licensing policy. The page wall honours
// a name only with proof of it (isTrustedBot, #8098, #4357); a name with no proof
// available reads under the free sample like any signed-out visitor.
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
// 2026-11-10: the assistants seen fetching for a person in our own api_usage log
// over 30 days (grok-cli 56, GitHubCopilotRuntime-WebFetch 16, Google-NotebookLM 3,
// DuckAssistBot 1), plus the two user-fetch names Meta and Mistral publish. Derek:
// readers reaching us through Grok, Gemini, Copilot etc. get what Claude/ChatGPT users get.
const USER_FETCH_AGENTS = [
  'claude-user', 'chatgpt-user', 'perplexity-user',
  'grok-cli', 'githubcopilotruntime-webfetch', 'google-notebooklm', 'duckassistbot',
  'meta-externalfetcher', 'mistralai-user',
];

/**
 * Does the User-Agent name an assistant reading for a person? A label for routing
 * to a form it can read: it believes the name, so it must never grant anything a
 * forged name should not get.
 */
export function namesUserFetchAgent(userAgent: string | null | undefined): boolean {
  const ua = (userAgent || '').toLowerCase();
  return USER_FETCH_AGENTS.some((agent) => ua.includes(agent));
}

/**
 * The KNOWN_BOTS token this request's UA matched, or null. Used to attribute
 * gated reads in `bot_reads` (src/lib/bot-reads.ts, #4309). Our own MCP server
 * returns null — it is logged separately in mcp_usage (#4306).
 */
export function botNameFor(request: Request): string | null {
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  if (ALWAYS_ALLOW.some(bot => ua.includes(bot))) return null;
  return KNOWN_BOTS.find(bot => ua.includes(bot)) ?? null;
}

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
 * The UA-only half of isTrustedBot — no API-key or DNS lookup, so it is safe on
 * the proxy's hot path (used there to label html rows in bot_reads, #4309). A
 * label, never a grant: it believes the name.
 */
export function isTrustedByUserAgent(request: Request): boolean {
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  if (ALWAYS_ALLOW.some(bot => ua.includes(bot))) return true;

  // Search-index crawlers get full access; training/bulk crawlers do not.
  if (SEARCH_CRAWLERS.some(bot => ua.includes(bot))) return true;

  // User-initiated assistant fetches (a human asked an assistant to read a page).
  if (USER_FETCH_AGENTS.some(bot => ua.includes(bot))) return true;

  return false;
}

/**
 * Check if the request is trusted (bypasses the page gate) — our own MCP, a
 * search-index crawler, an assistant reading for a person, or a valid API key
 * (Bearer sl_data_...).
 *
 * Every name needs proof (#4357): reverse DNS for Googlebot, Bingbot and
 * Applebot (#8098); the operator's published address list for Claude-User,
 * ChatGPT-User, Perplexity-User, Claude-SearchBot and OAI-SearchBot
 * (assistant-fetchers.ts); an in-process call or the proof header for our
 * hosted MCP (mcp-self-proof.ts). Names with no published proof (DuckDuckBot,
 * NotebookLM, Grok and the other small fetchers) are not trusted.
 */
export async function isTrustedBot(request: Request): Promise<boolean> {
  if (isTrustedByUserAgent(request)) {
    const ua = request.headers.get('user-agent') || '';
    const lower = ua.toLowerCase();
    // A name is honoured only with proof of it (#4357): anyone can write
    // "Claude-User" or "SourceLibrary-MCP" in a header. A name we have no way
    // to prove earns nothing here and falls through to the key check, so that
    // client reads under the same free sample as any signed-out visitor.
    if (ALWAYS_ALLOW.some((bot) => lower.includes(bot))) {
      if (inProcessCaller(request) !== undefined || hasMcpProof(request)) return true;
    } else if (namesListedClient(ua)) {
      if (provenByPublishedList(ua, getClientIp(request))) return true;
    } else {
      const claim = provableClaimIn(ua);
      // Reverse DNS: an inconclusive lookup keeps the name's trust, so a resolver
      // failing never costs a real crawler the index (#8098).
      if (claim && (await verifyCrawlerClaim(claim, getClientIp(request))) !== 'forged') return true;
    }
  }

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
      subject: 'AI Partnership: Full Corpus Access',
      info: 'https://sourcelibrary.org/llms.txt',
    },
    license: CONTENT_LICENSE,
  };
}
