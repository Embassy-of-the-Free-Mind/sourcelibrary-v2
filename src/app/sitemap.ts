import { MetadataRoute } from 'next';
import { getDb } from '@/lib/mongodb';

// Next.js metadata files (sitemap.ts) are statically generated at build time.
// Each DB query is independently wrapped so a single timeout doesn't kill the whole sitemap.
// The gallery images query is removed — it's the heaviest query (9.5M pages collection)
// and gallery images are low SEO value (priority 0.4). They're discoverable via internal links.

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
      url: `${baseUrl}/browse`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.6,
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
    {
      url: `${baseUrl}/curated`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/support`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
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
    'ocr-consistency',
    'cuneiform-ocr',
    'rithmomachia',
    'progress-studies',
    '2000-first-translations',
    'worlds-largest-collection',
    'origin-story',
    'counting-the-gap',
    'untranslated-renaissance',
    'translation-rate',
    'hieroglyph-ocr',
    'rashi-ocr',
    'clustering',
    'history-of-classification',
    'visualizing-classification',
    'philosophers-stone',
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

  // Helper: run a DB query with independent error handling
  async function safeQuery<T>(
    label: string,
    fn: (db: Awaited<ReturnType<typeof getDb>>) => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      const dbPromise = getDb();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${label}: DB connection timeout`)), 20000)
      );
      const db = await Promise.race([dbPromise, timeoutPromise]);
      return await fn(db);
    } catch (error) {
      console.error(`Sitemap ${label} failed:`, error);
      return fallback;
    }
  }

  // Run all queries in parallel — each independently fault-tolerant
  const [bookPages, collectionPages, libraryPages, languagePages, workPages] = await Promise.all([
    // Books — the most important query (13K+ URLs)
    safeQuery('books', async (db) => {
      const books = await db.collection('books').find(
        { visible: true },
        {
          projection: { id: 1, slug: 1, updated_at: 1, pages_ocr: 1, pages_translated: 1, is_first_translation: 1, read_count: 1 },
          maxTimeMS: 25000,
        }
      ).toArray();

      return books
        .filter((book) => book.pages_ocr > 0 && (book.pages_ocr > 3 || book.pages_translated > 0))
        .map((book) => {
          let lastModified: Date;
          try {
            lastModified = book.updated_at ? new Date(book.updated_at) : new Date();
            if (isNaN(lastModified.getTime())) lastModified = new Date();
          } catch {
            lastModified = new Date();
          }

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
    }, [] as MetadataRoute.Sitemap),

    // Collections
    safeQuery('collections', async (db) => {
      const collections = await db.collection('collections').find(
        { visible: true },
        { projection: { slug: 1, updated_at: 1 }, maxTimeMS: 5000 }
      ).toArray();

      return collections.map((col) => ({
        url: `${baseUrl}/collections/${col.slug}`,
        lastModified: col.updated_at ? new Date(col.updated_at) : new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      }));
    }, [] as MetadataRoute.Sitemap),

    // Libraries
    safeQuery('libraries', async (db) => {
      const libraries = await db.collection('libraries').find(
        {},
        { projection: { slug: 1, updated_at: 1 }, maxTimeMS: 5000 }
      ).toArray();

      return libraries.map((lib) => ({
        url: `${baseUrl}/libraries/${lib.slug}`,
        lastModified: lib.updated_at ? new Date(lib.updated_at) : new Date(),
        changeFrequency: 'monthly' as const,
        priority: 0.5,
      }));
    }, [] as MetadataRoute.Sitemap),

    // Languages
    safeQuery('languages', async (db) => {
      const languages = await db.collection('books').aggregate([
        { $match: { visible: true, pages_count: { $gt: 0 }, language: { $exists: true, $ne: null } } },
        { $group: { _id: '$language', count: { $sum: 1 } } },
        { $match: { count: { $gte: 5 } } },
      ], { maxTimeMS: 10000 }).toArray();

      return languages.map((lang) => ({
        url: `${baseUrl}/languages/${(lang._id as string).toLowerCase().replace(/\s+/g, '-')}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.5,
      }));
    }, [] as MetadataRoute.Sitemap),

    // Works
    safeQuery('works', async (db) => {
      const works = await db.collection('books').aggregate([
        { $match: { work_id: { $exists: true, $ne: null }, visible: true } },
        { $group: { _id: '$work_id', count: { $sum: 1 } } },
        { $match: { count: { $gte: 2 } } },
      ], { maxTimeMS: 10000 }).toArray();

      return works.map((w) => ({
        url: `${baseUrl}/work/${w._id}`,
        lastModified: new Date(),
        changeFrequency: 'monthly' as const,
        priority: 0.5,
      }));
    }, [] as MetadataRoute.Sitemap),
  ]);

  const total = staticPages.length + blogPosts.length + categoryPages.length +
    bookPages.length + collectionPages.length + libraryPages.length +
    languagePages.length + workPages.length;
  console.log(`Sitemap: ${total} URLs (${bookPages.length} books, ${collectionPages.length} collections, ${libraryPages.length} libraries, ${languagePages.length} languages, ${workPages.length} works)`);

  return [
    ...staticPages,
    ...blogPosts,
    ...categoryPages,
    ...bookPages,
    ...collectionPages,
    ...libraryPages,
    ...languagePages,
    ...workPages,
  ];
}
