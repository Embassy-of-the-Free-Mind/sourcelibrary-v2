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

    // Add read pages for books with translations
    const readPages: MetadataRoute.Sitemap = books
      .filter((book) => book.translation_percent > 0)
      .map((book) => ({
        url: `${baseUrl}/book/${book.id}/read`,
        lastModified: book.updated_at || new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      }));

    // Add guide pages for books with translations
    const guidePages: MetadataRoute.Sitemap = books
      .filter((book) => book.translation_percent > 0)
      .map((book) => ({
        url: `${baseUrl}/book/${book.id}/guide`,
        lastModified: book.updated_at || new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      }));

    // Add individual translated page URLs (limited to first 50 pages per book to avoid huge sitemaps)
    const translatedBooks = books.filter((book) => book.pages_translated > 0);
    const pages = await db.collection('pages').find(
      {
        book_id: { $in: translatedBooks.map(b => b.id) },
        translation: { $exists: true, $ne: null }
      },
      { projection: { book_id: 1, page_number: 1, updated_at: 1 } }
    ).toArray();

    const individualPages: MetadataRoute.Sitemap = pages.map((page) => ({
      url: `${baseUrl}/book/${page.book_id}/page/${page.page_number}`,
      lastModified: page.updated_at || new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    }));

    return [...staticPages, ...bookPages, ...readPages, ...guidePages, ...individualPages];
  } catch (error) {
    console.error('Error generating sitemap:', error);
    return staticPages;
  }
}
