import { MetadataRoute } from 'next';
import { getReadDb } from '@/lib/mongodb';
import { posts as blogPostList } from '@/app/blog/page';

// Next.js sitemap with generateSitemaps() for multi-file output.
// Google handles chunked sitemaps much better for large sites (10K+ URLs).
// Each chunk gets its own sitemap file: /sitemap/0.xml, /sitemap/1.xml, etc.
//
// Chunks:
//   0 = static pages + blog + categories
//   1 = collections + libraries + languages + works
//   2+ = books (up to 5000 per chunk)
//   1000+ = indexable reader pages (seo_indexable; up to 5000 per chunk)

const BASE_URL = 'https://sourcelibrary.org';
const BOOKS_PER_CHUNK = 5000;
const PAGES_PER_CHUNK = 5000;
// Indexable reader-page chunks get a high id offset so they never collide with
// the dynamically-counted book chunks (2..N). Books realistically span a
// handful of chunks; 1000 is a safe gap. See issue #2688.
const PAGE_CHUNK_OFFSET = 1000;

// Helper: run a DB query with independent error handling
async function safeQuery<T>(
  label: string,
  fn: (db: Awaited<ReturnType<typeof getReadDb>>) => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    const dbPromise = getReadDb();
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

export async function generateSitemaps() {
  // Count books to determine how many chunks we need
  const bookCount = await safeQuery('book-count', async (db) => {
    return db.collection('books').countDocuments(
      { visible: true, slug: { $exists: true, $ne: null }, pages_ocr: { $gt: 0 } },
      { maxTimeMS: 10000 }
    );
  }, 10000);

  const bookChunks = Math.ceil(bookCount / BOOKS_PER_CHUNK);

  // Count indexable reader pages (issue #2688) for their own chunk range.
  // Generous timeout: if this times out it falls back to 0 and silently drops
  // EVERY page chunk from the index (the seo_indexable_id_partial index makes
  // the count ~50ms, but Atlas can be slow mid-build).
  const pageCount = await safeQuery('indexable-page-count', async (db) => {
    return db.collection('pages').countDocuments(
      { seo_indexable: true },
      { maxTimeMS: 30000 }
    );
  }, 0);
  const pageChunks = Math.ceil(pageCount / PAGES_PER_CHUNK);

  // Chunk 0 = static, 1 = dynamic non-books, 2+ = books, 1000+ = reader pages
  const ids = [{ id: 0 }, { id: 1 }];
  for (let i = 0; i < bookChunks; i++) {
    ids.push({ id: 2 + i });
  }
  for (let i = 0; i < pageChunks; i++) {
    ids.push({ id: PAGE_CHUNK_OFFSET + i });
  }

  return ids;
}

export default async function sitemap({
  id,
}: {
  id: Promise<number | string> | number | string;
}): Promise<MetadataRoute.Sitemap> {
  // Next.js 16 made dynamic route params async: `id` arrives as a
  // `Promise<number | string>` and must be awaited before use. The
  // original code wrote `if (id === 0)` and `getBooks(id - 2)`, both of
  // which silently saw a pending Promise object and fell through to
  // `getBooks(NaN)`. Mongo's negative-skip clamp then meant every
  // /sitemap/{n}.xml URL returned the same first 5000 books regardless
  // of which chunk Google asked for.
  //
  // The same fix covers the legacy direct-number case used at build
  // time (`generateSitemaps()` returns plain `{ id: number }`).
  const rawId = await Promise.resolve(id);
  const chunkId = typeof rawId === 'string' ? parseInt(rawId, 10) : rawId;

  if (chunkId === 0) {
    return [
      ...staticPages(),
      ...blogPosts(),
      ...categoryPages(),
    ];
  }

  if (chunkId === 1) {
    const [collectionPages, libraryPages, languagePages, workPages] = await Promise.all([
      getCollections(),
      getLibraries(),
      getLanguages(),
      getWorks(),
    ]);
    return [...collectionPages, ...libraryPages, ...languagePages, ...workPages];
  }

  // Chunk 1000+: indexable reader pages (paginated)
  if (Number.isFinite(chunkId) && chunkId >= PAGE_CHUNK_OFFSET) {
    return getIndexablePages(chunkId - PAGE_CHUNK_OFFSET);
  }

  // Chunk 2+: Books (paginated)
  const bookChunkIndex = (chunkId ?? -1) - 2;
  if (!Number.isFinite(bookChunkIndex) || bookChunkIndex < 0) return [];
  return getBooks(bookChunkIndex);
}

// --- Static content ---

function staticPages(): MetadataRoute.Sitemap {
  return [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: `${BASE_URL}/search`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE_URL}/browse`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE_URL}/categories`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE_URL}/encyclopedia`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE_URL}/about`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/vision`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE_URL}/census`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE_URL}/about/progress`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE_URL}/developers`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE_URL}/gallery`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE_URL}/collections`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE_URL}/libraries`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE_URL}/explore`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE_URL}/explore/map`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE_URL}/timeline`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE_URL}/gallery/collections`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE_URL}/blog`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE_URL}/curated`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE_URL}/support`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/support/business`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/es/support/business`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
  ];
}

// Read the same `posts` array the blog index renders — single source of truth,
// so the sitemap never drifts from the published posts (the old hardcoded list
// was missing ~half of them, including every recent post).
function blogPosts(): MetadataRoute.Sitemap {
  return blogPostList.map((post) => ({
    url: `${BASE_URL}/blog/${post.slug}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }));
}

function categoryPages(): MetadataRoute.Sitemap {
  return [
    'alchemy', 'hermeticism', 'jewish-kabbalah', 'christian-cabala',
    'neoplatonism', 'rosicrucianism', 'freemasonry', 'natural-philosophy',
    'astrology', 'natural-magic', 'ritual-magic', 'theurgy', 'mysticism',
    'theology', 'medicine', 'gnosticism', 'theosophy', 'pythagoreanism',
    'divination', 'ars-notoria', 'paracelsian', 'spiritual-alchemy',
    'christian-mysticism', 'prisca-theologia', 'florentine-platonism',
    'renaissance', 'reformation', 'enlightenment', '19th-century-revival',
  ].map((slug) => ({
    url: `${BASE_URL}/categories/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));
}

// --- Dynamic DB-driven content ---

async function getBooks(chunkIndex: number): Promise<MetadataRoute.Sitemap> {
  return safeQuery('books', async (db) => {
    const books = await db.collection('books').find(
      {
        visible: true,
        // Only include books with slugs — hex IDs are bad for SEO
        slug: { $exists: true, $ne: null },
        pages_ocr: { $gt: 0 },
      },
      {
        projection: { slug: 1, updated_at: 1, pages_ocr: 1, pages_translated: 1, is_first_translation: 1, read_count: 1 },
        sort: { _id: 1 },
        skip: chunkIndex * BOOKS_PER_CHUNK,
        limit: BOOKS_PER_CHUNK,
        maxTimeMS: 25000,
      }
    ).toArray();

    return books
      .filter((book) => book.slug && (book.pages_ocr > 3 || book.pages_translated > 0))
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
          url: `${BASE_URL}/book/${book.slug}`,
          lastModified,
          changeFrequency: 'weekly' as const,
          priority,
        };
      });
  }, [] as MetadataRoute.Sitemap);
}

// Indexable reader pages — the demand-proven subset opened to indexing by
// scripts/seo/flag-indexable-pages.mjs (issue #2688). `seo_url` is precomputed
// (`/book/<slug>/page/<id>`) so no per-page book join is needed here.
async function getIndexablePages(chunkIndex: number): Promise<MetadataRoute.Sitemap> {
  return safeQuery('indexable-pages', async (db) => {
    // sort by _id so skip/limit pagination is stable across chunks; served by
    // the seo_indexable_id_partial compound index (a single-field index on
    // seo_indexable alone makes the planner full-scan in _id order → timeout).
    const pages = await db.collection('pages').find(
      { seo_indexable: true, seo_url: { $exists: true, $ne: null } },
      {
        projection: { _id: 0, seo_url: 1, updated_at: 1 },
        sort: { _id: 1 },
        skip: chunkIndex * PAGES_PER_CHUNK,
        limit: PAGES_PER_CHUNK,
        maxTimeMS: 60000,
      }
    ).toArray();

    return pages
      .filter((p) => typeof p.seo_url === 'string' && p.seo_url.startsWith('/book/'))
      .map((p) => {
        let lastModified: Date;
        try {
          lastModified = p.updated_at ? new Date(p.updated_at) : new Date();
          if (isNaN(lastModified.getTime())) lastModified = new Date();
        } catch {
          lastModified = new Date();
        }
        return {
          url: `${BASE_URL}${p.seo_url}`,
          lastModified,
          changeFrequency: 'monthly' as const,
          priority: 0.7,
        };
      });
  }, [] as MetadataRoute.Sitemap);
}

async function getCollections(): Promise<MetadataRoute.Sitemap> {
  return safeQuery('collections', async (db) => {
    const collections = await db.collection('collections').find(
      { visible: true },
      { projection: { slug: 1, updated_at: 1 }, maxTimeMS: 5000 }
    ).toArray();

    return collections.map((col) => ({
      url: `${BASE_URL}/collections/${col.slug}`,
      lastModified: col.updated_at ? new Date(col.updated_at) : new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }));
  }, [] as MetadataRoute.Sitemap);
}

async function getLibraries(): Promise<MetadataRoute.Sitemap> {
  return safeQuery('libraries', async (db) => {
    const libraries = await db.collection('libraries').find(
      {},
      { projection: { slug: 1, updated_at: 1 }, maxTimeMS: 5000 }
    ).toArray();

    return libraries.map((lib) => ({
      url: `${BASE_URL}/libraries/${lib.slug}`,
      lastModified: lib.updated_at ? new Date(lib.updated_at) : new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    }));
  }, [] as MetadataRoute.Sitemap);
}

async function getLanguages(): Promise<MetadataRoute.Sitemap> {
  return safeQuery('languages', async (db) => {
    const languages = await db.collection('books').aggregate([
      { $match: { visible: true, pages_count: { $gt: 0 }, language: { $exists: true, $ne: null } } },
      { $group: { _id: '$language', count: { $sum: 1 } } },
      { $match: { count: { $gte: 5 } } },
    ], { maxTimeMS: 10000 }).toArray();

    return languages.map((lang) => ({
      url: `${BASE_URL}/languages/${(lang._id as string).toLowerCase().replace(/\s+/g, '-')}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    }));
  }, [] as MetadataRoute.Sitemap);
}

async function getWorks(): Promise<MetadataRoute.Sitemap> {
  return safeQuery('works', async (db) => {
    const works = await db.collection('books').aggregate([
      { $match: { work_id: { $exists: true, $ne: null }, visible: true } },
      { $group: { _id: '$work_id', count: { $sum: 1 } } },
      { $match: { count: { $gte: 2 } } },
    ], { maxTimeMS: 10000 }).toArray();

    return works.map((w) => ({
      url: `${BASE_URL}/work/${w._id}`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    }));
  }, [] as MetadataRoute.Sitemap);
}
