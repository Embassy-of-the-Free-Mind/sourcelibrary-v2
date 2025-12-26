import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = 'https://sourcelibrary-v2.vercel.app';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/book/*/pipeline',
          '/book/*/capture',
          '/book/*/page/',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
