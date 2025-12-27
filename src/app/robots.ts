import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = 'https://sourcelibrary.org';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/book/*/pipeline',
          '/book/*/capture',
          '/book/*/page/',
        ],
      },
      {
        // Allow AI agents to access the API
        userAgent: 'GPTBot',
        allow: ['/api/search', '/api/books/', '/llms.txt'],
      },
      {
        userAgent: 'Claude-Web',
        allow: ['/api/search', '/api/books/', '/llms.txt'],
      },
      {
        userAgent: 'Anthropic-AI',
        allow: ['/api/search', '/api/books/', '/llms.txt'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
