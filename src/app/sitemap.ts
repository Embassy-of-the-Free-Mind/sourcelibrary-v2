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
  ];

  // Dynamic book pages
  try {
    const db = await getDb();
    const books = await db.collection('books').find(
      {},
      { projection: { id: 1, updated_at: 1, translation_percent: 1 } }
    ).toArray();

    const bookPages: MetadataRoute.Sitemap = books.map((book) => ({
      url: `${baseUrl}/book/${book.id}`,
      lastModified: book.updated_at || new Date(),
      changeFrequency: 'weekly' as const,
      // Higher priority for books with translations
      priority: book.translation_percent > 0 ? 0.9 : 0.6,
    }));

    // Add read pages for books with translations
    const readPages: MetadataRoute.Sitemap = books
      .filter((book) => book.translation_percent > 0)
      .map((book) => ({
        url: `${baseUrl}/book/${book.id}/read`,
        lastModified: book.updated_at || new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      }));

    return [...staticPages, ...bookPages, ...readPages];
  } catch (error) {
    console.error('Error generating sitemap:', error);
    return staticPages;
  }
}
