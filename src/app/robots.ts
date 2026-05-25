import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = 'https://sourcelibrary.org';

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

      // AI training crawlers: block bulk scraping, point to API
      // These companies should use our API or MCP server instead.
      // See https://sourcelibrary.org/terms for licensing details.
      {
        userAgent: 'CCBot',
        allow: '/blog/',
        disallow: '/',
      },
      {
        userAgent: 'Bytespider',
        allow: '/blog/',
        disallow: '/',
      },
      {
        userAgent: 'Diffbot',
        allow: '/blog/',
        disallow: '/',
      },
      {
        userAgent: 'Omgilibot',
        allow: '/blog/',
        disallow: '/',
      },
      {
        userAgent: 'FacebookBot',
        allow: '/blog/',
        disallow: '/',
      },
      {
        userAgent: 'Applebot',
        allow: '/blog/',
        disallow: '/',
      },
      {
        userAgent: 'Google-Extended',
        allow: '/blog/',
        disallow: '/',
      },
      {
        userAgent: 'PerplexityBot',
        allow: '/blog/',
        disallow: '/',
      },
      {
        userAgent: 'Amazonbot',
        allow: '/blog/',
        disallow: '/',
      },
      {
        userAgent: 'ClaudeBot',
        disallow: '/',
      },
      {
        userAgent: 'cohere-ai',
        allow: '/blog/',
        disallow: '/',
      },

      // AI assistants: welcome to use the API and llms.txt
      // GPTBot, Claude-Web, etc. — access the structured API
      {
        userAgent: 'GPTBot',
        allow: ['/blog/', '/api/search', '/api/books/', '/api/mcp', '/llms.txt', '/terms', '/developers'],
        disallow: '/',
      },
      {
        userAgent: 'Claude-Web',
        allow: ['/blog/', '/api/search', '/api/books/', '/api/mcp', '/llms.txt', '/terms', '/developers'],
        disallow: '/',
      },
      {
        userAgent: 'Anthropic-AI',
        disallow: '/',
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    // Note: Next.js generateSitemaps() automatically creates a sitemap index
    // at /sitemap.xml that references /sitemap/0.xml, /sitemap/1.xml, etc.
  };
}
