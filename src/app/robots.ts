import { MetadataRoute } from 'next';

/**
 * Robots policy. Two intents, deliberately separated:
 *
 *  1. SEARCH-INDEX crawlers (Googlebot, Bingbot, Claude-SearchBot, OAI-SearchBot)
 *     are ALLOWED on content. They are how readers discover and are sent to us;
 *     surfacing our pages in search/answers serves the mission.
 *
 *  2. TRAINING / BULK crawlers (ClaudeBot, GPTBot, Google-Extended, CCBot,
 *     Applebot-Extended, Meta-ExternalAgent, anthropic-ai, …) are RESERVED.
 *     Our translations are CC-BY-SA 4.0 — whose ShareAlike term is incompatible
 *     with proprietary model training — so AI training / text-and-data-mining
 *     requires a SEPARATE license. See https://sourcelibrary.org/licensing and
 *     the machine-readable reservation at /.well-known/tdmrep.json (TDMRep) plus
 *     the TDM-Reservation HTTP header. A standing rate card is published at
 *     /licensing ($250/book floor, $200K/yr full corpus); bulk/training access
 *     is available through the API or MCP server under a license — not by scraping.
 *
 * This is the honor-system + express-reservation layer; the server-side bot gate
 * (src/lib/bot-gate.ts) is the enforcement layer.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = 'https://sourcelibrary.org';

  // Endpoints a reserved AI crawler MAY still reach: the structured API, the
  // partnership/licensing docs, and the blog. Everything else (full text) is reserved.
  const aiAllowList = [
    '/blog/',
    '/api/search',
    '/api/books/',
    '/api/verify',
    '/api/mcp',
    '/llms.txt',
    '/terms',
    '/licensing',
    '/developers',
  ];
  // Reserved crawlers that aren't given API access still get the public docs + blog.
  const docsOnly = ['/blog/', '/llms.txt', '/terms', '/licensing', '/developers'];

  return {
    rules: [
      // Default: allow search engine indexing
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/book/*/pipeline',
          '/book/*/capture',
          '/book/*/qa',
          '/book/*/split',
          // Redirect-only URL. Every hit 308s to /book/{slug}/page/{pageId};
          // letting Google crawl this burns budget on tens of thousands of
          // redirects (showed up as "Blocked 403" / "Page with redirect" in GSC).
          '/book/*/page-number/',
          // Auto-generated thin concept stubs. Google classifies these as
          // soft-404 (1,241 in the 2026-05-31 GSC Coverage report — the single
          // largest not-indexed bucket) and crawling them burns budget that
          // should go to the ~15K /book/ landing pages. Block to prioritize
          // the catalogue. See SEO crawl-budget PR (2026-05-31).
          '/encyclopedia/',
          '/api/',
          '/admin/',
          '/analytics',
          '/experiments/',
          '/jobs',
          '/processing',
          '/qa',
          '/data?admin=true',
          '/upload',
          '/auth/',
          '/beta/',
          '/unauthorized',
          '/reading-history',
          '/highlights',
          '/favorites',
          // '/artwork/' — now public (2026-04-19)
        ],
      },

      // ── SEARCH-INDEX crawlers: explicitly welcome on content ──
      // Discovery + citability serve the mission. (Googlebot/Bingbot are already
      // allowed via '*'; these AI search crawlers are named so the intent is
      // unambiguous and they're never swept up with the training crawlers below.)
      { userAgent: 'Claude-SearchBot', allow: '/' },
      { userAgent: 'OAI-SearchBot', allow: '/' },

      // ── TRAINING / BULK crawlers: RESERVED — see /licensing ──
      // CC-BY-SA's ShareAlike makes proprietary training incompatible with the
      // free license; training/TDM needs a separate license. GPTBot/Claude-Web
      // keep structured-API access (use the API/MCP, not scraping); the rest get
      // the public docs + blog only. None get the full text.
      { userAgent: 'GPTBot', allow: aiAllowList, disallow: '/' },
      { userAgent: 'Claude-Web', allow: aiAllowList, disallow: '/' },
      { userAgent: 'ClaudeBot', allow: docsOnly, disallow: '/' },
      { userAgent: 'Anthropic-AI', allow: docsOnly, disallow: '/' },
      { userAgent: 'Google-Extended', allow: docsOnly, disallow: '/' },
      { userAgent: 'Applebot-Extended', allow: docsOnly, disallow: '/' },
      { userAgent: 'Meta-ExternalAgent', allow: '/blog/', disallow: '/' },
      { userAgent: 'CCBot', allow: '/blog/', disallow: '/' },
      { userAgent: 'Bytespider', allow: '/blog/', disallow: '/' },
      { userAgent: 'Diffbot', allow: '/blog/', disallow: '/' },
      { userAgent: 'Omgilibot', allow: '/blog/', disallow: '/' },
      { userAgent: 'FacebookBot', allow: '/blog/', disallow: '/' },
      { userAgent: 'Applebot', allow: '/blog/', disallow: '/' },
      { userAgent: 'PerplexityBot', allow: '/blog/', disallow: '/' },
      { userAgent: 'Amazonbot', allow: '/blog/', disallow: '/' },
      { userAgent: 'cohere-ai', allow: '/blog/', disallow: '/' },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    // Note: Next.js generateSitemaps() automatically creates a sitemap index
    // at /sitemap.xml that references /sitemap/0.xml, /sitemap/1.xml, etc.
  };
}
