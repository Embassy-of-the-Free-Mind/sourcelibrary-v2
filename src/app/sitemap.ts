import { MetadataRoute } from 'next';
import { getDb } from '@/lib/mongodb';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://sourcelibrary.org';

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${baseUrl}/search`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/categories`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/highlights`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/encyclopedia`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/about`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/developers`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ];

  // Dynamic book pages
  try {
    const db = await getDb();

    // Get books with page info for translated pages
    const books = await db.collection('books').find(
      {},
      { projection: { id: 1, updated_at: 1, translation_percent: 1, pages_count: 1, pages_translated: 1 } }
    ).toArray();

    const bookPages: MetadataRoute.Sitemap = books.map((book) => ({
      url: `${baseUrl}/book/${book.id}`,
      lastModified: book.updated_at || new Date(),
      changeFrequency: 'weekly' as const,
      // Higher priority for books with translations
      priority: book.translation_percent > 0 ? 0.9 : 0.6,
    }));

    // NOTE: /read and /guide pages removed from sitemap to improve indexing.
    // For a new domain, focus on book landing pages only.
    // /read and /guide are alternate views of same content - could be seen as thin/duplicate.
    // Individual page URLs also removed (was 47k+ URLs overwhelming Google).
    // All sub-pages can be discovered via internal links once book pages are indexed.

    return [...staticPages, ...bookPages];
  } catch (error) {
    console.error('Error generating sitemap:', error);
    return staticPages;
  }
}
