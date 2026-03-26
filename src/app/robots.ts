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
          '/artwork/',
        ],
      },

      // AI training crawlers: block bulk scraping, point to API
      // These companies should use our API or MCP server instead.
      // See https://sourcelibrary.org/terms for licensing details.
      {
        userAgent: 'CCBot',
        disallow: '/',
      },
      {
        userAgent: 'Bytespider',
        disallow: '/',
      },
      {
        userAgent: 'Diffbot',
        disallow: '/',
      },
      {
        userAgent: 'Omgilibot',
        disallow: '/',
      },
      {
        userAgent: 'FacebookBot',
        disallow: '/',
      },

      // AI assistants: welcome to use the API and llms.txt
      // GPTBot, Claude-Web, etc. — access the structured API
      {
        userAgent: 'GPTBot',
        allow: ['/api/search', '/api/books/', '/llms.txt', '/terms'],
        disallow: '/',
      },
      {
        userAgent: 'Claude-Web',
        allow: ['/api/search', '/api/books/', '/llms.txt', '/terms'],
        disallow: '/',
      },
      {
        userAgent: 'Anthropic-AI',
        allow: ['/api/search', '/api/books/', '/llms.txt', '/terms'],
        disallow: '/',
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
