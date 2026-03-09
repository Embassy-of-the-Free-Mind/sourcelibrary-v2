import { MetadataRoute } from 'next';
import { getDb } from '@/lib/mongodb';

// Cache sitemap for 24 hours — book list changes rarely
export const revalidate = 86400;

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
      url: `${baseUrl}/encyclopedia`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
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
    {
      url: `${baseUrl}/gallery`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/collections`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/libraries`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/explore`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/explore/map`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/explore/timeline`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/timeline`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/gallery/collections`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ];

  // Blog posts — original long-form content, high SEO value
  const blogPosts: MetadataRoute.Sitemap = [
    'astrological-diagrams',
    'chakra-tradition',
    'demonology',
    'fechner-bohme',
    'fire-horse',
    'first-translation-methodology',
    'first-translations',
    'hidden-engineers',
    'history-of-astrology',
    'indigenous-traditions',
    'invisible-hand',
    'mcp-server',
    // 'autonomous-agents', // hidden pending rewrite
    'ocr-consistency',
    'cuneiform-ocr',
    'rithmomachia',
    'progress-studies',
  ].map((slug) => ({
    url: `${baseUrl}/blog/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }));

  // Category pages — server-rendered with metadata
  const categoryPages: MetadataRoute.Sitemap = [
    'alchemy', 'hermeticism', 'jewish-kabbalah', 'christian-cabala',
    'neoplatonism', 'rosicrucianism', 'freemasonry', 'natural-philosophy',
    'astrology', 'natural-magic', 'ritual-magic', 'theurgy', 'mysticism',
    'theology', 'medicine', 'gnosticism', 'theosophy', 'pythagoreanism',
    'divination', 'ars-notoria', 'paracelsian', 'spiritual-alchemy',
    'christian-mysticism', 'prisca-theologia', 'florentine-platonism',
    'renaissance', 'reformation', 'enlightenment', '19th-century-revival',
  ].map((slug) => ({
    url: `${baseUrl}/categories/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  // Press releases
  const pressPages: MetadataRoute.Sitemap = [
    'origins-of-science',
    'kabbalah',
    'hermetic-tradition',
    'world-sacred-texts',
    'alchemy',
  ].map((slug) => ({
    url: `${baseUrl}/press/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }));

  // Dynamic pages from DB — with timeout to prevent build hangs
  try {
    const dbPromise = getDb();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('DB connection timeout (15s)')), 15000)
    );
    const db = await Promise.race([dbPromise, timeoutPromise]);

    // Books
    const books = await db.collection('books').find(
      { hidden: { $ne: true } },
      { projection: { id: 1, slug: 1, updated_at: 1, pages_ocr: 1, pages_translated: 1, is_first_translation: 1, read_count: 1 } }
    ).toArray();

    const bookPages: MetadataRoute.Sitemap = books
      // Exclude books with no OCR — no meaningful content for search engines
      .filter((book) => book.pages_ocr > 0)
      .map((book) => {
        let lastModified: Date;
        try {
          lastModified = book.updated_at ? new Date(book.updated_at) : new Date();
          if (isNaN(lastModified.getTime())) lastModified = new Date();
        } catch {
          lastModified = new Date();
        }

        // Tiered priority based on content completeness and value
        let priority = 0.5;
        if (book.pages_translated > 0) priority = 0.7;
        if (book.is_first_translation) priority = 0.85;
        if (book.read_count >= 10) priority = Math.max(priority, 0.85);
        if (book.is_first_translation && book.pages_translated > 0) priority = 0.9;

        return {
          url: `${baseUrl}/book/${book.slug || book.id}`,
          lastModified,
          changeFrequency: 'weekly' as const,
          priority,
        };
      });

    // Encyclopedia entities — only substantial entries to focus crawl budget
    const entities = await db.collection('entities').find(
      { book_count: { $gte: 5 }, description: { $exists: true, $ne: '' } },
      { projection: { name: 1, updated_at: 1, book_count: 1 } }
    ).toArray();

    const entityPages: MetadataRoute.Sitemap = entities.map((entity) => {
      let lastModified: Date;
      try {
        lastModified = entity.updated_at ? new Date(entity.updated_at) : new Date();
        if (isNaN(lastModified.getTime())) lastModified = new Date();
      } catch {
        lastModified = new Date();
      }

      return {
        url: `${baseUrl}/encyclopedia/${encodeURIComponent(entity.name)}`,
        lastModified,
        changeFrequency: 'monthly' as const,
        priority: entity.book_count >= 5 ? 0.7 : 0.5,
      };
    });

    // Collections
    const collections = await db.collection('collections').find(
      {},
      { projection: { slug: 1, updated_at: 1 } }
    ).toArray();

    const collectionPages: MetadataRoute.Sitemap = collections.map((col) => ({
      url: `${baseUrl}/collections/${col.slug}`,
      lastModified: col.updated_at ? new Date(col.updated_at) : new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }));

    // Library partners
    const libraries = await db.collection('libraries').find(
      {},
      { projection: { slug: 1, updated_at: 1 } }
    ).toArray();

    const libraryPages: MetadataRoute.Sitemap = libraries.map((lib) => ({
      url: `${baseUrl}/libraries/${lib.slug}`,
      lastModified: lib.updated_at ? new Date(lib.updated_at) : new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    }));

    // NOTE: /read and /guide pages removed from sitemap to improve indexing.
    // For a new domain, focus on book landing pages only.
    // Individual page URLs also removed — can be discovered via internal links.

    return [
      ...staticPages,
      ...blogPosts,
      ...categoryPages,
      ...pressPages,
      ...bookPages,
      ...entityPages,
      ...collectionPages,
      ...libraryPages,
    ];
  } catch (error) {
    console.error('Error generating sitemap:', error);
    return [...staticPages, ...blogPosts, ...categoryPages, ...pressPages];
  }
}
