import { getReadDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';
import { Book } from '@/lib/types';
import { type CollectionForGrid } from '@/components/book/BookLibrary';
import { sortCollections, withTimeout } from '@/lib/collections-utils';

// Shared data layer for the homepage. Both the English `/` route and the
// Spanish `/es` route fetch through getHomeData() so the two pages can never
// drift apart in what they show — only the surrounding copy differs.

// ---------- Book projection shared across queries ----------

const BOOK_PROJECTION = {
  _id: 0,
  id: { $ifNull: ['$id', { $toString: '$_id' }] },
  slug: 1,
  tenantId: 1,
  title: 1,
  display_title: 1,
  author: 1,
  thumbnail: 1,
  thumbnail_blob: 1,
  image_display: 1,
  image_thumb: 1,
  language: 1,
  published: 1,
  is_first_translation: 1,
  pages_count: { $ifNull: ['$pages_count', 0] },
  pages_translated: { $ifNull: ['$pages_translated', 0] },
  pages_ocr: { $ifNull: ['$pages_ocr', 0] },
  translation_percent: { $ifNull: ['$translation_percent', 0] },
};

// ---------- Data fetching ----------

async function getTenantSlugMap(db: any, tenantIds: string[]): Promise<Map<string, string>> {
  if (tenantIds.length === 0) return new Map();
  const tenants = await db.collection('tenants')
    .find({ id: { $in: tenantIds }, status: { $ne: 'deleted' } }, { projection: { _id: 0, id: 1, slug: 1 }, maxTimeMS: 5000 })
    .toArray();
  return new Map(tenants.map((tenant: any) => [tenant.id, tenant.slug]));
}

export interface FeaturedItem {
  collection: {
    slug: string;
    name: string;
    subtitle: string;
    description: string;
    book_count: number;
    artwork_count: number;
    hero_image: string | null;
  };
  books: any[];
}

async function getFeaturedCollections(): Promise<FeaturedItem[]> {
  const db = await getReadDb();

  // Pick 1 random collection with enough books for the editorial spread
  const collections = await db.collection('collections').aggregate([
    { $match: { book_count: { $gte: 10 }, parent: { $exists: false }, type: { $ne: 'curated' }, collection_type: { $ne: 'visual_art' }, visible: true } },
    { $sample: { size: 1 } },
  ]).toArray();

  if (collections.length === 0) return [];

  const allSlugs = collections.map(c => c.slug);
  const bookProjection = { _id: 0, id: { $ifNull: ['$id', { $toString: '$_id' }] }, slug: 1, tenantId: 1, title: 1, display_title: 1, author: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1, collections: 1 };

  // Collect curated book IDs from highlighted_books (tier 1 & 2 preferred)
  const highlightedIdsBySlug = new Map<string, string[]>();
  const allHighlightedIds: string[] = [];
  for (const col of collections) {
    const highlighted = (col.highlighted_books || [])
      .filter((b: { tier?: number }) => !b.tier || b.tier <= 2)
      .slice(0, 10)
      .map((b: { book_id: string }) => b.book_id);
    highlightedIdsBySlug.set(col.slug as string, highlighted);
    allHighlightedIds.push(...highlighted);
  }

  // Fetch highlighted books by ID (these are curated, high-quality picks)
  const highlightedBooks = allHighlightedIds.length > 0
    ? await db.collection('books').aggregate([
      { $match: { $or: [{ id: { $in: allHighlightedIds } }, { _id: { $in: allHighlightedIds } }], visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } } },
      { $project: bookProjection },
    ], { maxTimeMS: 8000 }).toArray()
    : [];

  // Index highlighted books by their ID for fast lookup
  const highlightedById = new Map(highlightedBooks.map(b => [b.id, b]));

  // Build book lists per collection from curated highlights
  const booksBySlug = new Map<string, typeof highlightedBooks>();
  for (const col of collections) {
    const slug = col.slug as string;
    const ids = highlightedIdsBySlug.get(slug) || [];
    const books = ids.map(id => highlightedById.get(id)).filter(Boolean) as typeof highlightedBooks;
    booksBySlug.set(slug, books);
  }

  // For collections with fewer than 10 highlighted books, backfill from general query
  const slugsNeedingMore = allSlugs.filter(s => (booksBySlug.get(s)?.length || 0) < 10);
  if (slugsNeedingMore.length > 0) {
    const existingIds = new Set([...booksBySlug.values()].flat().map(b => b.id));
    const backfillBooks = await db.collection('books').aggregate([
      { $match: { collections: { $in: slugsNeedingMore }, visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 }, thumbnail_blob: { $exists: true, $ne: null } } },
      { $sort: { read_count: -1 } },
      { $limit: slugsNeedingMore.length * 10 },
      { $project: bookProjection },
    ], { maxTimeMS: 8000 }).toArray();

    for (const book of backfillBooks) {
      if (existingIds.has(book.id)) continue;
      const bookCollections = Array.isArray(book.collections) ? book.collections : [];
      for (const slug of slugsNeedingMore) {
        if (bookCollections.includes(slug)) {
          const arr = booksBySlug.get(slug) || [];
          if (arr.length < 10) {
            arr.push(book);
            booksBySlug.set(slug, arr);
            existingIds.add(book.id);
          }
        }
      }
    }
  }

  // ---------- Gallery images: read pre-curated data from collection docs ----------
  // Curated by scripts/maintenance/curate-collection-gallery.mjs — no heavy joins needed.

  const tenantIds = [...new Set([
    ...collections.map((collection: any) => collection.tenantId).filter(Boolean),
    ...highlightedBooks.map((book: any) => book.tenantId).filter(Boolean),
  ])];
  const tenantSlugMap = await getTenantSlugMap(db, tenantIds);

  const results = collections.map((collection) => {
    // Prefer curated_gallery images (gallery illustrations) for full-bleed hero
    const gallery = collection.curated_gallery || [];
    const galleryHero = gallery.find((img: Record<string, unknown>) => img && img.image_url);
    let heroUrl = (galleryHero?.image_url || null) as string | null;

    // Fall back to featured_images
    if (!heroUrl) {
      const images = collection.featured_images || [];
      const hero = images.find(
        (img: unknown) => typeof img === 'string' || (img && typeof img === 'object' && ((img as Record<string, unknown>).extracted_url || (img as Record<string, unknown>).image_url || (img as Record<string, unknown>).thumbnail_url))
      );
      // Prefer thumbnail for card grids — extracted images are ~2MB vs ~38KB thumbnails
      heroUrl = typeof hero === 'string' ? hero : ((hero as Record<string, unknown>)?.thumbnail_url || (hero as Record<string, unknown>)?.extracted_url || (hero as Record<string, unknown>)?.image_url || null) as string | null;
    }

    const books = (booksBySlug.get(collection.slug as string) || []).map(({ collections: _c, ...rest }) => ({
      ...rest,
      tenant_slug: rest.tenantId ? tenantSlugMap.get(rest.tenantId) || null : null,
    }));

    // Fall back to hardcoded hero image if DB doesn't have images
    const fallbackHero = FALLBACK_COLLECTIONS.find(f => f.slug === collection.slug)?.hero_image;
    return {
      collection: {
        slug: collection.slug as string,
        name: collection.name as string,
        subtitle: (collection.subtitle || '') as string,
        description: (collection.description || '') as string,
        book_count: (collection.book_count || 0) as number,
        artwork_count: (collection.artwork_count || 0) as number,
        hero_image: (heroUrl || fallbackHero || null) as string | null,
      },
      books: JSON.parse(JSON.stringify(books)),
    };
  });

  // Only return collections that have translated books to show
  return results.filter(r => r.books.length > 0);
}

async function getRemainingCollections(): Promise<CollectionForGrid[]> {
  const db = await getReadDb();
  const docs = await db.collection('collections').find({ parent: { $exists: false }, type: { $ne: 'curated' }, visible: true, 'highlighted_books.0': { $exists: true } }).toArray();

  const tenantIds = [...new Set(docs.map((doc: any) => doc.tenantId).filter(Boolean))];
  const tenantSlugMap = await getTenantSlugMap(db, tenantIds);

  const result = docs.map(({ _id, ...rest }) => {
    const images = rest.featured_images || [];
    const hero = images.find(
      (img: unknown) => typeof img === 'string' || (img && typeof img === 'object' && ((img as Record<string, unknown>).thumbnail_url || (img as Record<string, unknown>).extracted_url || (img as Record<string, unknown>).image_url))
    );
    // Prefer thumbnail for card grids — extracted images are ~2MB vs ~38KB thumbnails
    const heroUrl = typeof hero === 'string' ? hero : ((hero as Record<string, unknown>)?.thumbnail_url || (hero as Record<string, unknown>)?.extracted_url || (hero as Record<string, unknown>)?.image_url || null) as string | null;
    const languageValues = Array.isArray(rest.languages)
      ? rest.languages
      : [];
    const languages = languageValues
      .map((language: unknown) => {
        if (typeof language === 'string') return language;
        if (language && typeof language === 'object' && typeof (language as { lang?: unknown }).lang === 'string') {
          return (language as { lang: string }).lang;
        }
        return null;
      })
      .filter((language: unknown): language is string => Boolean(language))
      .slice(0, 3);
    return {
      slug: rest.slug,
      tenant_slug: rest.tenantId ? tenantSlugMap.get(rest.tenantId) || null : null,
      name: rest.name,
      subtitle: rest.subtitle || '',
      description: rest.description || '',
      book_count: rest.book_count || 0,
      artwork_count: rest.artwork_count || 0,
      hero_image: heroUrl as string | null,
      languages,
    };
  }) as CollectionForGrid[];

  // Fill in missing hero images from book thumbnails — batch query instead of N+1
  const missingHero = result.filter(c => !c.hero_image);
  if (missingHero.length > 0) {
    try {
      const missingSlugs = missingHero.map(c => c.slug);
      const heroBooks = await db.collection('books').aggregate([
        {
          $match: {
            collections: { $in: missingSlugs },
            visible: true,
            $or: [
              { thumbnail_blob: { $exists: true, $nin: [null, ''] } },
              { thumbnail: { $exists: true, $nin: [null, ''] } },
            ],
          },
        },
        { $project: { collections: 1, thumbnail_blob: 1, thumbnail: 1, image_display: 1, image_thumb: 1 } },
        { $limit: 50 },
      ], { maxTimeMS: 5000 }).toArray();

      for (const col of missingHero) {
        const book = heroBooks.find(b => Array.isArray(b.collections) && b.collections.includes(col.slug));
        if (book) {
          col.hero_image = (book.thumbnail_blob || book.thumbnail) as string;
        }
      }
    } catch {
      // Skip — gradient fallback will show
    }
  }

  // Fill in missing hero images from hardcoded fallback (DB may return collections
  // without featured_images during degraded performance or sparse data)
  const fallbackBySlug = new Map(FALLBACK_COLLECTIONS.map(c => [c.slug, c.hero_image]));
  for (const col of result) {
    if (!col.hero_image && fallbackBySlug.has(col.slug)) {
      col.hero_image = fallbackBySlug.get(col.slug) || null;
    }
  }

  return sortCollections(result);
}

async function getDiscoverBooks(): Promise<Book[]> {
  const db = await getReadDb();

  // $sample FIRST so MongoDB uses fast random cursor (O(1) when size < 5% of collection).
  // $match after $sample filters the random sample down.
  // Over-sample to account for hidden/untranslated books being filtered out.
  // `pages_translated >= 10` already excludes artworks today (they carry
  // pages_translated: 0), but the explicit content_type guard makes the
  // intent obvious and prevents a regression if the pages filter changes.
  const books = await db.collection('books').aggregate([
    { $sample: { size: 200 } },
    { $match: { visible: true, pages_translated: { $gte: 10 }, content_type: { $ne: 'artwork' } } },
    { $limit: 10 },
    { $project: BOOK_PROJECTION },
  ], { maxTimeMS: 8000 }).toArray();

  const tenantIds = [...new Set(books.map((book: any) => book.tenantId).filter(Boolean))];
  const tenantSlugMap = await getTenantSlugMap(db, tenantIds);
  const booksWithTenantSlug = books.map((book: any) => ({
    ...book,
    tenant_slug: book.tenantId ? tenantSlugMap.get(book.tenantId) || null : null,
  }));

  return JSON.parse(JSON.stringify(booksWithTenantSlug)) as Book[];
}

async function getCollectionShowcase() {
  const db = await getReadDb();

  // Keep sample-first to preserve the fast random cursor behavior.
  // A larger sample plus a relaxed second pass avoids the frequent empty/1-item result.
  const baseMatch = {
    museum_description: { $exists: true, $ne: '' },
    $or: [
      { thumbnail_url: { $type: 'string', $gt: '' } },
      { extracted_url: { $type: 'string', $gt: '' } },
    ],
    book_visible: true,
  };

  const strictAspectRatio = {
    extracted_width: { $exists: true },
    extracted_height: { $exists: true },
    $expr: {
      $and: [
        { $lt: [{ $divide: ['$extracted_width', '$extracted_height'] }, 2] },
        { $gt: [{ $divide: ['$extracted_width', '$extracted_height'] }, 0.3] },
      ],
    },
  };

  const strictImages = await db.collection('gallery_images').aggregate([
    { $sample: { size: 2500 } },
    {
      $match: {
        ...baseMatch,
        gallery_quality: { $gte: 0.85 },
        ...strictAspectRatio,
      },
    },
    { $limit: 120 },
  ], { maxTimeMS: 8000 }).toArray();

  // If strict pass is sparse, run a softer pass (still sampled) to fill the showcase.
  const relaxedImages = strictImages.length >= 40
    ? []
    : await db.collection('gallery_images').aggregate([
      { $sample: { size: 2500 } },
      {
        $match: {
          ...baseMatch,
          gallery_quality: { $gte: 0.75 },
        },
      },
      { $limit: 120 },
    ], { maxTimeMS: 8000 }).toArray();

  const rawImages = [...strictImages, ...relaxedImages];

  // Diversify: max 1 per book, take 8
  const seenBookIds = new Set<string>();
  const seenGalleryIds = new Set<string>();
  const selected: any[] = [];
  for (const img of rawImages) {
    if (!img?.book_id || !img?.page_id) continue;
    const galleryId = `${img.page_id}-${img.detection_index || 0}`;
    if (seenBookIds.has(img.book_id) || seenGalleryIds.has(galleryId)) continue;
    seenBookIds.add(img.book_id);
    seenGalleryIds.add(galleryId);
    selected.push(img);
    if (selected.length >= 8) break;
  }

  // Randomized fallback: if random sampling is sparse, top up from a
  // broad high-quality pool without fixed ordering.
  if (selected.length < 8) {
    const fallbackImages = await db.collection('gallery_images').aggregate([
      { $sample: { size: 3000 } },
      {
        $match: {
          ...baseMatch,
          gallery_quality: { $gte: 0.65 },
        },
      },
      { $limit: 400 },
    ], { maxTimeMS: 8000 }).toArray();

    for (const img of fallbackImages) {
      if (!img?.book_id || !img?.page_id) continue;
      const galleryId = `${img.page_id}-${img.detection_index || 0}`;
      if (seenBookIds.has(img.book_id) || seenGalleryIds.has(galleryId)) continue;
      seenBookIds.add(img.book_id);
      seenGalleryIds.add(galleryId);
      selected.push(img);
      if (selected.length >= 8) break;
    }
  }

  // Batch-fetch quotes + slugs for all selected books in ONE query (not N+1)
  const bookIds = [...new Set(selected.map(img => img.book_id))];
  const booksWithQuotes = await db.collection('books').find(
    { id: { $in: bookIds } },
    { projection: { id: 1, tenantId: 1, 'reading_summary.quotes': 1, slug: 1 } },
  ).toArray();
  const tenantIds = [...new Set(booksWithQuotes.map((book: any) => book.tenantId).filter(Boolean))];
  const tenantSlugMap = await getTenantSlugMap(db, tenantIds);
  const bookMap = new Map(booksWithQuotes.map(b => [b.id, b]));

  const items = selected.map((img) => {
    const book = bookMap.get(img.book_id);
    let quote: { text: string; page: number } | undefined;
    const quotes = book?.reading_summary?.quotes;
    const tenantSlug = book?.tenantId ? tenantSlugMap.get(book.tenantId) || null : null;
    if (quotes && quotes.length > 0) {
      quote = quotes[Math.floor(Math.random() * quotes.length)];
    }
    return {
      page_id: img.page_id,
      book_id: img.book_id,
      page_number: img.page_number || 0,
      detection_index: img.detection_index || 0,
      thumbnail_url: img.thumbnail_url || img.extracted_url,
      type: img.type || '',
      museum_description: img.museum_description,
      book_title: img.book_title || '',
      book_author: img.book_author || '',
      book_year: img.book_year || 0,
      book_slug: book?.slug,
      tenant_slug: tenantSlug,
      quote,
    };
  });

  return JSON.parse(JSON.stringify(items));
}

export interface HomeCounts {
  totalBooks: number;
  translatedToEnglish: number;
  firstTranslationCount: number;
  authorCount: number;
  languageCount: number;
  artworkCount: number;
  illustrationCount: number;
}

// Last refreshed from production 2026-05-26. Only used if Mongo + Supabase are both unreachable.
const FALLBACK_COUNTS: HomeCounts = { totalBooks: 13869, translatedToEnglish: 13534, firstTranslationCount: 6911, authorCount: 5523, languageCount: 105, artworkCount: 13743, illustrationCount: 122550 };

async function getBookCounts(): Promise<HomeCounts> {
  // 1. MongoDB system_config cache (refreshed daily by scripts/maintenance/prewarm-browse.mjs;
  // also writable on demand via scripts/maintenance/update-homepage-stats.mjs).
  // Preferred over Supabase because it uses the >=90% "readable" threshold which
  // Supabase books_catalog cannot compute (no column-to-column comparison in PostgREST).
  try {
    const db = await getReadDb();
    const cached = await db.collection('system_config').findOne(
      { _id: 'homepage_stats' } as any,
      { maxTimeMS: 2000 }
    );
    if (cached?.totalBooks) {
      return {
        totalBooks: cached.totalBooks,
        translatedToEnglish: cached.translatedToEnglish,
        firstTranslationCount: cached.firstTranslationCount,
        authorCount: cached.authorCount ?? FALLBACK_COUNTS.authorCount,
        languageCount: cached.languageCount ?? FALLBACK_COUNTS.languageCount,
        artworkCount: cached.artworkCount ?? FALLBACK_COUNTS.artworkCount,
        illustrationCount: cached.illustrationCount ?? FALLBACK_COUNTS.illustrationCount,
      };
    }
  } catch { /* DB unreachable — try Supabase */ }

  // 2. Supabase fallback (fast but uses pages_translated > 0, not >=90% threshold)
  try {
    const [totalRes, firstTransRes] = await Promise.all([
      supabase.from('books_catalog').select('id', { count: 'exact', head: true })
        .eq('visible', true).gt('pages_translated', 0),
      supabase.from('books_catalog').select('id', { count: 'exact', head: true })
        .eq('visible', true).eq('is_first_translation', true).gt('pages_translated', 0),
    ]);

    if (totalRes.count && totalRes.count > 0) {
      let authorCount = FALLBACK_COUNTS.authorCount;
      let languageCount = FALLBACK_COUNTS.languageCount;
      try {
        const db = await getReadDb();
        const cached = await db.collection('system_config').findOne(
          { _id: 'homepage_stats' } as any,
          { maxTimeMS: 2000 }
        );
        if (cached?.authorCount) authorCount = cached.authorCount;
        if (cached?.languageCount) languageCount = cached.languageCount;
      } catch { /* MongoDB unavailable — use fallback */ }

      return {
        totalBooks: totalRes.count,
        translatedToEnglish: totalRes.count,
        firstTranslationCount: firstTransRes.count ?? FALLBACK_COUNTS.firstTranslationCount,
        authorCount,
        languageCount,
        artworkCount: FALLBACK_COUNTS.artworkCount,
        illustrationCount: FALLBACK_COUNTS.illustrationCount,
      };
    }
  } catch { /* Supabase unreachable */ }

  return FALLBACK_COUNTS;
}

// ---------- Hardcoded fallback data (DB resilience) ----------
// Used when MongoDB is unreachable. Same pattern as getBookCounts().
// Last updated: 2026-05-01 from production DB.

const FALLBACK_COLLECTIONS: CollectionForGrid[] = [
  { slug: 'natural-philosophy', name: 'Natural Philosophy & Science', subtitle: 'From Aristotle to Newton', description: '', book_count: 1720, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6952d0fa77f38f6761bc5aef/24.jpg', languages: ['Latin', 'Chinese', 'English'] },
  { slug: 'theology', name: 'Theology & Religious Thought', subtitle: 'Scholasticism, Reformation & Apologetics', description: '', book_count: 1633, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/e48a21de-4db2-4c94-a71a-e952b9fa5393/69500507f426a210d109c2be-0.jpg', languages: ['Latin', 'English', 'German'] },
  { slug: 'classical-philosophy', name: 'Classical Philosophy', subtitle: 'Ancient Greek & Roman Thought', description: '', book_count: 1485, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69568900be7c607c5f03c2d7/69569e3b1479a63c11092796-0.jpg', languages: ['Greek', 'Latin', 'English'] },
  { slug: 'alchemy', name: 'Alchemy', subtitle: 'The Art of Transmutation', description: '', book_count: 1209, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69520c46ab34727b1f044141/69520c46ab34727b1f044158-0.jpg', languages: ['Latin', 'German', 'English'] },
  { slug: 'indic-traditions', name: 'Indic Traditions', subtitle: 'Vedas, Yoga, Tantra & Buddhist Texts', description: '', book_count: 864, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6991d8978c1030b12444c035/6991d8978c1030b12444c04c-1.jpg', languages: ['Sanskrit', 'English', 'Tamil'] },
  { slug: 'chinese-classics', name: 'Chinese Classics', subtitle: 'Confucian, Daoist & Buddhist Texts', description: '', book_count: 585, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6992cacfd4d545ae73feeb33/dunhuang-hero.jpg', languages: ['Chinese', 'English', 'French'] },
  { slug: 'magic', name: 'Magic & Occult Arts', subtitle: 'Grimoires, Natural Magic & Ceremonial Practice', description: '', book_count: 679, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/a5d0c381-d4ea-42cd-8864-44457e7fda33/69500509f426a210d109c5bd-0.jpg', languages: ['Latin', 'English', 'French'] },
  { slug: 'medicine', name: 'Medicine & Natural History', subtitle: 'From Hippocrates to Paracelsus', description: '', book_count: 1191, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6ff1a28b-f7cd-4fcd-8d08-77d2f7818be1/695004d8f426a210d1099e4b-0.jpg', languages: ['Latin', 'Chinese', 'English'] },
  { slug: 'art-illustrated', name: 'Art & Illustrated Books', subtitle: 'Illustrated Books, Emblems & Visual Knowledge', description: '', book_count: 1404, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/e532b010-6d2e-40ca-9f95-c67e74c5ee61/695004b4f426a210d10975f4-0.jpg', languages: ['Chinese', 'Latin', 'Italian'] },
  { slug: 'secret-societies', name: 'Secret Societies', subtitle: 'Freemasonry, Rosicrucians & Fraternal Orders', description: '', book_count: 670, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6952587bab34727b1f045546/6959068695a91542b28bd761-0.jpg', languages: ['German', 'Latin', 'French'] },
  { slug: 'leonardo-da-vinci', name: 'Leonardo da Vinci', subtitle: 'Manuscripts, codices, treatises, and anatomical drawings', description: '', book_count: 48, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6991e93135ed50020acc1458/8.jpg', languages: ['Italian', 'French', 'English'] },
  { slug: 'hermetica', name: 'Hermetica', subtitle: 'Hermetic Philosophy & Prisca Theologia', description: '', book_count: 1191, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69520176ab34727b1f04136b/69520177ab34727b1f041503-0.jpg', languages: ['Latin', 'German', 'English'] },
  { slug: 'kabbalah', name: 'Kabbalah', subtitle: 'Jewish Mysticism & Christian Cabala', description: '', book_count: 471, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/4d4089b9-9227-4cc5-b0a2-9b06ee731061/6950050cf426a210d109ca95-0.jpg', languages: ['Latin', 'Hebrew', 'German'] },
  { slug: 'astrology', name: 'Astrology & Divination', subtitle: 'Celestial Science & the Mantic Arts', description: '', book_count: 1484, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6990688d249ce014347d6e76/6990688d249ce014347d6eb2-0.jpg', languages: ['Sanskrit', 'Latin', 'Chinese'] },
  { slug: 'mysticism', name: 'Mysticism', subtitle: 'Direct Experience of the Divine', description: '', book_count: 1200, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6991d89d8c1030b12444c140/6991d89e8c1030b12444c146-0.jpg', languages: ['German', 'English', 'Latin'] },
  { slug: 'sacred-texts', name: 'Sacred Texts', subtitle: 'Foundational Scriptures of the World\'s Traditions', description: '', book_count: 1513, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69528b19ab34727b1f04f2fe/69528b19ab34727b1f04f306-0.jpg', languages: ['English', 'Latin', 'Greek'] },
  { slug: 'renaissance-philosophy', name: 'Renaissance Philosophy', subtitle: 'Humanism, Neoplatonism & the Dignity of Man', description: '', book_count: 1099, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/f20894c1-495f-4afe-815b-e8bf3c8938a5/695004b9f426a210d1097a97-0.jpg', languages: ['Latin', 'English', 'Italian'] },
  { slug: 'demonology', name: 'Demonology & Witchcraft', subtitle: 'Witch Trials, Possession & the Demonic', description: '', book_count: 298, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6952db2477f38f6761bc70c4/6952db2477f38f6761bc70cc-0.jpg', languages: ['English', 'Latin', 'German'] },
  { slug: 'literature', name: 'Literature & Poetry', subtitle: 'From Gilgamesh to the Divine Comedy', description: '', book_count: 1588, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/a0461b95-c56a-463a-beed-a6a2fb11cec2/695004c2f426a210d1097f09-0.jpg', languages: ['Greek', 'English', 'Latin'] },
  { slug: 'herbalism', name: 'Herbalism & Botany', subtitle: 'Herbals, Materia Medica & the Science of Plants', description: '', book_count: 388, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6958dec2cf7070242ed42151/100.jpg', languages: ['Italian', 'Chinese', 'Latin'] },
  { slug: 'music-sound', name: 'Music & Sound', subtitle: 'Pythagorean Harmonics to Baroque Music Theory', description: '', book_count: 320, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/e48a21de-4db2-4c94-a71a-e952b9fa5393/7.jpg', languages: ['Latin', 'Chinese', 'Greek'] },
  { slug: 'shwep', name: 'SHWEP Reading Room', subtitle: 'Primary Sources from the Secret History of Western Esotericism Podcast', description: '', book_count: 1784, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/c87fadfa-1543-44b9-a138-573c144246e6/6959af9b1dfc1806c080b7e6-0.jpg', languages: ['Greek', 'Latin', 'English'] },
];

// Hardcoded discover books — shown when getDiscoverBooks() times out during DB stress.
// Curated selection of translated books across diverse subjects/languages.
// Last updated: 2026-03-10 from production DB.
const FALLBACK_DISCOVER_BOOKS = [
  { id: '6991e7a99d63c80e615599b5', slug: 'codex-atlanticus-partial-vinci', title: 'Codex Atlanticus (partial)', display_title: 'The Atlantic Codex', author: 'Leonardo da Vinci', language: 'Italian', published: 'Unknown', thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6991e7a99d63c80e615599b5/5.jpg', thumbnail_blob: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/thumbnails/6991e7a99d63c80e615599b5/5.jpg', is_first_translation: true, pages_count: 10, pages_translated: 10, pages_ocr: 10, translation_percent: 100 },
  { id: '695937303b43cb6630c91e62', slug: 'the-sword-of-moses-trans', title: 'The Sword of Moses (Harba de-Mosheh)', display_title: 'The Sword of Moses', author: 'Moses (attr.) / Moses Gaster (trans.)', language: 'Syriac', published: 'Unknown', thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/695937303b43cb6630c91e62/695937303b43cb6630c91e63-0.jpg', thumbnail_blob: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/thumbnails/695937303b43cb6630c91e62/1.jpg', is_first_translation: false, pages_count: 10, pages_translated: 10, pages_ocr: 10, translation_percent: 100 },
  { id: '6953aeb177f38f6761bd85d1', slug: 'hekate-selene-artemis-in-greek-magical-papyri-hopfner', title: 'Hekate-Selene-Artemis in Greek Magical Papyri', display_title: 'Hekate-Selene-Artemis and Related Deities in the Greek Magical Papyri', author: 'Theodor Hopfner', language: 'German', published: 'Unknown', thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6953aeb177f38f6761bd85d1/4.jpg', thumbnail_blob: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/thumbnails/6953aeb177f38f6761bd85d1/1.jpg', is_first_translation: true, pages_count: 11, pages_translated: 11, pages_ocr: 11, translation_percent: 100 },
  { id: '695931d4b91a6184ea9433a8', slug: 'amulet-composed-by-al-buni-al-buni', title: 'Amulette composée par Al-Buni', display_title: 'The Amulet of Al-Buni', author: 'Ahmad al-Buni', language: 'Arabic', published: 'Unknown', thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/695931d4b91a6184ea9433a8/4.jpg', thumbnail_blob: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/thumbnails/695931d4b91a6184ea9433a8/1.jpg', is_first_translation: true, pages_count: 10, pages_translated: 10, pages_ocr: 10, translation_percent: 100 },
  { id: '6991d89d8c1030b12444c140', slug: 'chakra-and-nadi-in-the-shaiva-tradition', title: 'Chakra and Nadi in the Shaiva Tradition', display_title: 'Energy Centers and Channels in the Shiva Tradition', author: 'Unknown', language: 'Hindi', published: 'undated', thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6991d89d8c1030b12444c140/6.jpg', thumbnail_blob: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/thumbnails/6991d89d8c1030b12444c140/6.jpg', is_first_translation: true, pages_count: 10, pages_translated: 10, pages_ocr: 10, translation_percent: 100 },
  { id: '6953c83377f38f6761bdbf5a', slug: 'gheranda-samhita-the-collection-of-gheranda-gheranda', title: 'Gheranda Samhita', display_title: 'The Collection of Gheranda', author: 'Gheranda', language: 'Sanskrit', published: 'Unknown', thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6953c83377f38f6761bdbf5a/1.jpg', thumbnail_blob: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/thumbnails/6953c83377f38f6761bdbf5a/1.jpg', is_first_translation: false, pages_count: 11, pages_translated: 11, pages_ocr: 11, translation_percent: 100 },
  { id: '6991d8a38c1030b12444c221', slug: 'vajramrtatantra-ms-or-158-1', title: 'Vajramratatantra', display_title: 'Treatise on the Nectar of the Thunderbolt', author: 'Unknown', language: 'Sanskrit', published: 'undated', thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6991d8a38c1030b12444c221/4.jpg', thumbnail_blob: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/thumbnails/6991d8a38c1030b12444c221/1.jpg', is_first_translation: true, pages_count: 12, pages_translated: 12, pages_ocr: 12, translation_percent: 100 },
  { id: '69907cf65f855ec553e784e3', slug: 'shani-chakram', title: 'Shani Chakram (Saturn)', display_title: 'The Wheel of Saturn', author: 'Unknown', language: 'Sanskrit', published: '1800', thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69907cf65f855ec553e784e3/3.jpg', thumbnail_blob: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/thumbnails/69907cf65f855ec553e784e3/3.jpg', is_first_translation: true, pages_count: 10, pages_translated: 10, pages_ocr: 10, translation_percent: 100 },
  { id: '6992ca1cd4d545ae73fed82b', slug: 'dunhuang-illustrated-scroll', title: 'Pelliot chinois 4518 (Dunhuang Illustrated Scroll)', display_title: 'Dunhuang Monastic Ledger and Rhyme Dictionary Prefaces', author: 'Unknown', language: 'Chinese', published: 'Unknown', thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/thumbnails/6992ca1cd4d545ae73fed82b/1.jpg', thumbnail_blob: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/thumbnails/6992ca1cd4d545ae73fed82b/1.jpg', is_first_translation: true, pages_count: 10, pages_translated: 10, pages_ocr: 10, translation_percent: 100 },
  { id: '69906828249ce014347d5b4d', slug: 'the-great-journey-of-yoga-brhadyogayatra-varahamihira', title: 'Brhadyogayatra of Varahamihira', display_title: 'The Great Journey of Yoga (Brhadyogayatra)', author: 'Varahamihira', language: 'Sanskrit', published: 'Unknown', thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69906828249ce014347d5b4d/4.jpg', thumbnail_blob: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/thumbnails/69906828249ce014347d5b4d/1.jpg', is_first_translation: false, pages_count: 11, pages_translated: 11, pages_ocr: 11, translation_percent: 100 },
] as unknown as Book[];

const SORTED_FALLBACK_COLLECTIONS = sortCollections([...FALLBACK_COLLECTIONS]);

// ---------- Blog posts (curated subset for homepage) ----------
// `tagKey` resolves to a localized label in <HomeView>; the article titles stay
// in their published language (the posts themselves are English).

export type BlogTagKey = 'deepDive' | 'collection';

export interface HomeBlogPost {
  slug: string;
  title: string;
  subtitle: string;
  date: string;
  readTime: string;
  tagKey: BlogTagKey;
  tagColor: string;
  image: string;
}

const BLOG_POSTS: HomeBlogPost[] = [
  {
    slug: 'reading-classical-chinese',
    title: 'Can AI Read Classical Chinese? An OCR and Translation Benchmark',
    subtitle: 'Measured against ctext.org, our OCR reads canonical Chinese at ~98.5%; measured against James Legge, the translations match or beat the standard editions.',
    date: '25 June 2026',
    readTime: '13 min read',
    tagKey: 'deepDive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://images.sourcelibrary.org/archived/6992c88d4f3a879124230200/346.jpg',
  },
  {
    slug: 'hidden-engineers',
    title: 'The Hidden Engineers: Steam Engines in Spell Books, Automata in Alchemy',
    subtitle: 'Before engineering was a discipline, its knowledge lived inside alchemy, natural magic, and mystical philosophy.',
    date: '27 February 2026',
    readTime: '22 min read',
    tagKey: 'deepDive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/695230c6ab34727b1f044784/93.jpg',
  },
  {
    slug: 'philosophers-stone',
    title: "What Is the Philosopher's Stone? Eight Answers from the Primary Sources",
    subtitle: 'An allegorical emblem sequence, a universal salt, a red powder found in a bishop\'s tomb — eight primary sources, eight different answers.',
    date: '27 February 2026',
    readTime: '20 min read',
    tagKey: 'deepDive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/uploads/69804b952c52aad359879321/69804ceaefc8a337f6e2717b.jpg',
  },
  {
    slug: 'rithmomachia',
    title: 'Rithmomachia: The Forgotten Game That Taught Europe to Think Like Pythagoras',
    subtitle: 'Five treatises in five languages document a mathematical board game played across Europe for six centuries.',
    date: '2 March 2026',
    readTime: '18 min read',
    tagKey: 'collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd499ff0f1d2c4518062/498.jpg',
  },
  {
    slug: 'first-translations',
    title: 'Over 500 First English Translations',
    subtitle: 'Alchemical lab manuals, radical theology, women alchemists, Sanskrit astrology manuscripts — all previously inaccessible in English.',
    date: '20 February 2026',
    readTime: '14 min read',
    tagKey: 'collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/4d4089b9-9227-4cc5-b0a2-9b06ee731061/2.jpg',
  },
];

// ---------- Spanish podcast (featured on /es) ----------

export interface SpanishPodcastSource {
  bookId: string;
  slug?: string;
  title: string;
  author?: string;
  origin?: string;
}

export interface SpanishPodcast {
  threadId: string;
  title: string;
  topic: string;
  audioUrl: string;
  heroImageUrl: string | null;
  sources: SpanishPodcastSource[];
}

// Latest published Spanish-language deep-dive episode, for the /es feature.
async function getSpanishPodcast(): Promise<SpanishPodcast | null> {
  const db = await getReadDb();
  const thread = await db.collection('embassy_threads').findOne(
    { language: 'es', 'podcasts.deep-dive.published': true, 'podcasts.deep-dive.audioUrl': { $exists: true } },
    {
      projection: { title: 1, heroImage: 1, 'podcasts.deep-dive': 1 },
      sort: { 'podcasts.deep-dive.generatedAt': -1 },
      maxTimeMS: 5000,
    } as any,
  );
  const p = thread?.podcasts?.['deep-dive'];
  if (!thread || !p?.audioUrl) return null;

  return {
    threadId: thread._id.toString(),
    title: thread.title || p.topic || '',
    topic: p.topic || '',
    audioUrl: p.audioUrl,
    heroImageUrl: thread.heroImage?.url || null,
    sources: Array.isArray(p.sources) ? p.sources : [],
  };
}

// ---------- Aggregate ----------

export interface HomeData {
  featuredItems: FeaturedItem[];
  discoverBooks: Book[];
  showcase: any[];
  counts: HomeCounts;
  collections: CollectionForGrid[];
  blogPosts: HomeBlogPost[];
  spanishPodcast: SpanishPodcast | null;
}

export async function getHomeData(): Promise<HomeData> {
  const [featuredItems, discoverBooks, showcase, counts, collections, spanishPodcast] = await Promise.all([
    withTimeout(getFeaturedCollections(), 20000, [] as FeaturedItem[]),
    withTimeout(getDiscoverBooks(), 20000, FALLBACK_DISCOVER_BOOKS),
    withTimeout(getCollectionShowcase(), 20000, [] as any[]),
    getBookCounts(),
    withTimeout(getRemainingCollections(), 20000, SORTED_FALLBACK_COLLECTIONS),
    withTimeout(getSpanishPodcast(), 8000, null),
  ]);

  return { featuredItems, discoverBooks, showcase, counts, collections, blogPosts: BLOG_POSTS, spanishPodcast };
}
