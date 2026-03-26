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
      // Exclude books with no OCR or very thin content (1-3 OCR pages, no translation)
      .filter((book) => book.pages_ocr > 0 && (book.pages_ocr > 3 || book.pages_translated > 0))
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

    // Encyclopedia entities — excluded from sitemap for now.
    // Most are thin (name + book list) and dilute crawl budget.
    // Revisit when entity pages have richer content.
    const entityPages: MetadataRoute.Sitemap = [];

    // Collections — exclude hidden ones
    const collections = await db.collection('collections').find(
      { hidden: { $ne: true } },
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

    // Language pages — aggregate distinct languages with enough content
    const languages = await db.collection('books').aggregate([
      { $match: { hidden: { $ne: true }, pages_count: { $gt: 0 }, language: { $exists: true, $ne: null } } },
      { $group: { _id: '$language', count: { $sum: 1 } } },
      { $match: { count: { $gte: 5 } } },
    ]).toArray();

    const languagePages: MetadataRoute.Sitemap = languages.map((lang) => ({
      url: `${baseUrl}/languages/${(lang._id as string).toLowerCase().replace(/\s+/g, '-')}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    }));

    // Gallery images — unique historical illustrations with rich metadata
    // Only include images with museum descriptions (well-curated content)
    const galleryImages = await db.collection('pages').aggregate([
      { $match: { 'detected_images': { $exists: true, $ne: [] } } },
      { $unwind: { path: '$detected_images', includeArrayIndex: 'img_idx' } },
      { $match: { 'detected_images.museum_description': { $exists: true, $ne: '' } } },
      { $project: { id: 1, img_idx: 1 } },
      { $limit: 2000 },
    ]).toArray();

    const galleryPages: MetadataRoute.Sitemap = galleryImages.map((img) => ({
      url: `${baseUrl}/gallery/image/${img.id}-${img.img_idx}`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.4,
    }));

    // Work pages — multi-edition comparison pages
    const works = await db.collection('books').aggregate([
      { $match: { work_id: { $exists: true, $ne: null }, hidden: { $ne: true } } },
      { $group: { _id: '$work_id', count: { $sum: 1 } } },
      { $match: { count: { $gte: 2 } } },
    ]).toArray();

    const workPages: MetadataRoute.Sitemap = works.map((w) => ({
      url: `${baseUrl}/work/${w._id}`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    }));

    return [
      ...staticPages,
      ...blogPosts,
      ...categoryPages,
      ...pressPages,
      ...bookPages,
      ...entityPages,
      ...collectionPages,
      ...libraryPages,
      ...languagePages,
      ...galleryPages,
      ...workPages,
    ];
  } catch (error) {
    console.error('Error generating sitemap:', error);
    return [...staticPages, ...blogPosts, ...categoryPages, ...pressPages];
  }
}
