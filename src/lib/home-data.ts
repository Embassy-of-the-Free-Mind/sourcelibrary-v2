import { getReadDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';
import { Book } from '@/lib/types';
import { type CollectionForGrid } from '@/components/book/BookLibrary';
import { sortCollections, withTimeout, coverOverride } from '@/lib/collections-utils';
import { browseBooks, type CatalogBook } from '@/lib/books-catalog';
import { toGalleryCardUrl } from '@/lib/utils';
import { type Plate } from '@/components/GalleryMasonry';
import { type HomeLang } from '@/lib/home-i18n';
import { type LocalizedBookMap } from '@/lib/localized';
import { spanishReaderHref } from '@/lib/es-collections';

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

  // Pick 1 random collection with enough books for the editorial spread.
  // homepage_exclude opts a collection out of this random rotation without
  // hiding its /collections page — set on sensitive collections (e.g. erotica)
  // that shouldn't front the site.
  const collections = await db.collection('collections').aggregate([
    { $match: { book_count: { $gte: 10 }, parent: { $exists: false }, type: { $ne: 'curated' }, collection_type: { $ne: 'visual_art' }, visible: true, homepage_exclude: { $ne: true } } },
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
    const featuredUrl = typeof hero === 'string' ? hero : ((hero as Record<string, unknown>)?.thumbnail_url || (hero as Record<string, unknown>)?.extracted_url || (hero as Record<string, unknown>)?.image_url || null) as string | null;
    // Honour the curated cover with the SAME precedence as the /collections card
    // helper (cardImageCandidates): coverOverride → hero_image → featured_images.
    // Without this the homepage grid ignored `hero_image` and showed a different
    // image than /collections for every collection with a curated cover.
    const heroUrl = coverOverride(rest.slug) || (rest.hero_image as string | undefined) || featuredUrl;
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
      total_book_count: rest.total_book_count,
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

const RECENTLY_TRANSLATED_COUNT = 15;

// A book renders a real cover only when its thumbnail is a rehosted R2 URL
// (images.sourcelibrary.org) or a whitelisted Wikimedia Commons URL — those are
// the hosts the site CSP `img-src` allows. Freshly-imported books still point at
// the raw source (archive.org, …), which the browser blocks → the card falls
// back to a placeholder. We only want real covers in this slider, so filter to
// renderable ones. Mirrors the resolution order in getBookThumbnailUrl().
function hasRenderableCover(b: CatalogBook): boolean {
  const t = b.thumbnail || '';
  return t.includes('images.sourcelibrary.org/') || t.includes('upload.wikimedia.org/wikipedia/commons/');
}

// Collapse multi-volume sets / series to one entry so a single work (e.g. the
// 20-volume "Herculaneum Volumes") can't fill the whole slider. Key on the title
// with volume/part/collection markers, parentheticals, and digits stripped, plus
// the author.
function workKey(b: CatalogBook): string {
  const title = (b.display_title || b.title || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(vol|volume|part|book|tome|band|no|first collection|second collection)\.?\s*[ivxlcdm0-9]*\b/g, '')
    .replace(/[0-9]+/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
  return `${title}|${(b.author || '').toLowerCase().trim().slice(0, 18)}`;
}

// The 15 most recently translated *distinct* works that have a real cover.
// Reads the Supabase `books_catalog` mirror (indexed on `last_translation_at`)
// rather than Mongo — the equivalent Mongo sort is a 15s full scan because that
// field is unindexed, whereas this returns in well under a second. `hasTranslation`
// filters to books with a translated page (which also excludes artworks,
// pages_translated: 0) and browseBooks already constrains to `visible: true`.
// We over-fetch because the newest translations are batch imports whose covers
// aren't rehosted yet, and big multi-volume sets dedupe down (15 distinct
// cover-complete works currently sit within the first ~140 rows).
async function getRecentlyTranslated(): Promise<CatalogBook[]> {
  const { books } = await browseBooks({
    hasTranslation: true,
    sort: 'last_translated',
    limit: 400,
    skipCount: true,
  });

  const seen = new Set<string>();
  const out: CatalogBook[] = [];
  for (const b of books) {
    if (!hasRenderableCover(b)) continue;
    const key = workKey(b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
    if (out.length >= RECENTLY_TRANSLATED_COUNT) break;
  }
  return out;
}

// How often the gallery selection rotates. It stays identical to everyone within
// a window (so it does NOT reshuffle on every refresh) and picks a fresh 48 each
// window. Tune this one number to change the cadence.
const GALLERY_ROTATION_HOURS = 12;

// Tiny deterministic PRNG (mulberry32) — same seed → same sequence, so the
// shuffle is reproducible for a given time window across all renders/visitors.
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 1 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gallery masonry — high-quality illustrations from across the library,
// mirroring the Mycology gallery. A deterministic, indexed sort (on the
// `{gallery_quality:-1, book_year, book_id, page_number}` index — far cheaper
// than the old `$sample` over 3000 docs) builds a stable POOL of the best plates;
// we then pick 48 via a shuffle seeded by the current time window, so the display
// stays fixed within a `GALLERY_ROTATION_HOURS` window and rotates between windows
// (dynamic, but not per-refresh). `extracted_width/height` come back so the
// masonry reserves each cell's aspect ratio and loads without layout shift.
async function getHomeGalleryPlates(): Promise<Plate[]> {
  const db = await getReadDb();
  const raw = await db.collection('gallery_images').find(
    {
      book_hidden: { $ne: true },
      gallery_quality: { $gte: 0.85 },
      extracted_width: { $gt: 0 },
      extracted_height: { $gt: 0 },
      $or: [
        { thumbnail_url: { $type: 'string', $gt: '' } },
        { extracted_url: { $type: 'string', $gt: '' } },
      ],
    },
    {
      projection: { _id: 0, book_id: 1, page_id: 1, detection_index: 1, thumbnail_url: 1, extracted_url: 1, image_url: 1, extracted_width: 1, extracted_height: 1, museum_description: 1, book_title: 1 },
      maxTimeMS: 8000,
    },
  ).sort({ gallery_quality: -1, book_year: 1, book_id: 1, page_number: 1 }).limit(500).toArray();

  // Build the candidate pool (max 2 plates per book for variety), in the stable
  // quality-sorted order.
  const perBook = new Map<string, number>();
  const pool: Plate[] = [];
  for (const g of raw as Array<Record<string, unknown>>) {
    const bookId = String(g.book_id ?? '');
    const n = perBook.get(bookId) ?? 0;
    if (n >= 2) continue;
    const thumb = g.thumbnail_url as string | undefined;
    const full = (g.extracted_url as string) || (g.image_url as string) || undefined;
    const src = (thumb && toGalleryCardUrl(thumb)) || thumb || full;
    if (!src) continue;
    const id = g.page_id != null && g.detection_index != null ? `${g.page_id}-${g.detection_index}` : undefined;
    perBook.set(bookId, n + 1);
    pool.push({
      src,
      fallback: full || thumb,
      href: id ? `/gallery/image/${id}` : undefined,
      label: (g.museum_description as string) || (g.book_title as string) || 'Illustration',
      w: g.extracted_width as number | undefined,
      h: g.extracted_height as number | undefined,
    });
  }

  // Shuffle the pool with a per-window seed, then take 48. Same window → same 48.
  const windowSeed = Math.floor(Date.now() / (GALLERY_ROTATION_HOURS * 3600 * 1000));
  const rand = mulberry32(windowSeed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 48);
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
  { slug: 'natural-philosophy', name: 'Natural Philosophy & Science', subtitle: 'From Aristotle to Newton', description: '', book_count: 1720, hero_image: 'https://images.sourcelibrary.org/archived/6952d0fa77f38f6761bc5aef/24.jpg', languages: ['Latin', 'Chinese', 'English'] },
  { slug: 'theology', name: 'Theology & Religious Thought', subtitle: 'Scholasticism, Reformation & Apologetics', description: '', book_count: 1633, hero_image: 'https://images.sourcelibrary.org/gallery/e48a21de-4db2-4c94-a71a-e952b9fa5393/69500507f426a210d109c2be-0.jpg', languages: ['Latin', 'English', 'German'] },
  { slug: 'classical-philosophy', name: 'Classical Philosophy', subtitle: 'Ancient Greek & Roman Thought', description: '', book_count: 1485, hero_image: 'https://images.sourcelibrary.org/gallery/69568900be7c607c5f03c2d7/69569e3b1479a63c11092796-0.jpg', languages: ['Greek', 'Latin', 'English'] },
  { slug: 'alchemy', name: 'Alchemy', subtitle: 'The Art of Transmutation', description: '', book_count: 1209, hero_image: 'https://images.sourcelibrary.org/gallery/69520c46ab34727b1f044141/69520c46ab34727b1f044158-0.jpg', languages: ['Latin', 'German', 'English'] },
  { slug: 'indic-traditions', name: 'Indic Traditions', subtitle: 'Vedas, Yoga, Tantra & Buddhist Texts', description: '', book_count: 864, hero_image: 'https://images.sourcelibrary.org/gallery/6991d8978c1030b12444c035/6991d8978c1030b12444c04c-1.jpg', languages: ['Sanskrit', 'English', 'Tamil'] },
  { slug: 'chinese-classics', name: 'Chinese Classics', subtitle: 'Confucian, Daoist & Buddhist Texts', description: '', book_count: 585, hero_image: 'https://images.sourcelibrary.org/gallery/6992cacfd4d545ae73feeb33/dunhuang-hero.jpg', languages: ['Chinese', 'English', 'French'] },
  { slug: 'magic', name: 'Magic & Occult Arts', subtitle: 'Grimoires, Natural Magic & Ceremonial Practice', description: '', book_count: 679, hero_image: 'https://images.sourcelibrary.org/gallery/a5d0c381-d4ea-42cd-8864-44457e7fda33/69500509f426a210d109c5bd-0.jpg', languages: ['Latin', 'English', 'French'] },
  { slug: 'medicine', name: 'Medicine & Natural History', subtitle: 'From Hippocrates to Paracelsus', description: '', book_count: 1191, hero_image: 'https://images.sourcelibrary.org/gallery/6ff1a28b-f7cd-4fcd-8d08-77d2f7818be1/695004d8f426a210d1099e4b-0.jpg', languages: ['Latin', 'Chinese', 'English'] },
  { slug: 'art-illustrated', name: 'Art & Illustrated Books', subtitle: 'Illustrated Books, Emblems & Visual Knowledge', description: '', book_count: 1404, hero_image: 'https://images.sourcelibrary.org/gallery/e532b010-6d2e-40ca-9f95-c67e74c5ee61/695004b4f426a210d10975f4-0.jpg', languages: ['Chinese', 'Latin', 'Italian'] },
  { slug: 'secret-societies', name: 'Secret Societies', subtitle: 'Freemasonry, Rosicrucians & Fraternal Orders', description: '', book_count: 670, hero_image: 'https://images.sourcelibrary.org/gallery/6952587bab34727b1f045546/6959068695a91542b28bd761-0.jpg', languages: ['German', 'Latin', 'French'] },
  { slug: 'leonardo-da-vinci', name: 'Leonardo da Vinci', subtitle: 'Manuscripts, codices, treatises, and anatomical drawings', description: '', book_count: 48, hero_image: 'https://images.sourcelibrary.org/archived/6991e93135ed50020acc1458/8.jpg', languages: ['Italian', 'French', 'English'] },
  { slug: 'hermetica', name: 'Hermetica', subtitle: 'Hermetic Philosophy & Prisca Theologia', description: '', book_count: 1191, hero_image: 'https://images.sourcelibrary.org/gallery/69520176ab34727b1f04136b/69520177ab34727b1f041503-0.jpg', languages: ['Latin', 'German', 'English'] },
  { slug: 'kabbalah', name: 'Kabbalah', subtitle: 'Jewish Mysticism & Christian Cabala', description: '', book_count: 471, hero_image: 'https://images.sourcelibrary.org/gallery/4d4089b9-9227-4cc5-b0a2-9b06ee731061/6950050cf426a210d109ca95-0.jpg', languages: ['Latin', 'Hebrew', 'German'] },
  { slug: 'astrology', name: 'Astrology & Divination', subtitle: 'Celestial Science & the Mantic Arts', description: '', book_count: 1484, hero_image: 'https://images.sourcelibrary.org/gallery/6990688d249ce014347d6e76/6990688d249ce014347d6eb2-0.jpg', languages: ['Sanskrit', 'Latin', 'Chinese'] },
  { slug: 'mysticism', name: 'Mysticism', subtitle: 'Direct Experience of the Divine', description: '', book_count: 1200, hero_image: 'https://images.sourcelibrary.org/gallery/6991d89d8c1030b12444c140/6991d89e8c1030b12444c146-0.jpg', languages: ['German', 'English', 'Latin'] },
  { slug: 'sacred-texts', name: 'Sacred Texts', subtitle: 'Foundational Scriptures of the World\'s Traditions', description: '', book_count: 1513, hero_image: 'https://images.sourcelibrary.org/gallery/69528b19ab34727b1f04f2fe/69528b19ab34727b1f04f306-0.jpg', languages: ['English', 'Latin', 'Greek'] },
  { slug: 'renaissance-philosophy', name: 'Renaissance Philosophy', subtitle: 'Humanism, Neoplatonism & the Dignity of Man', description: '', book_count: 1099, hero_image: 'https://images.sourcelibrary.org/gallery/f20894c1-495f-4afe-815b-e8bf3c8938a5/695004b9f426a210d1097a97-0.jpg', languages: ['Latin', 'English', 'Italian'] },
  { slug: 'demonology', name: 'Demonology & Witchcraft', subtitle: 'Witch Trials, Possession & the Demonic', description: '', book_count: 298, hero_image: 'https://images.sourcelibrary.org/gallery/6952db2477f38f6761bc70c4/6952db2477f38f6761bc70cc-0.jpg', languages: ['English', 'Latin', 'German'] },
  { slug: 'literature', name: 'Literature & Poetry', subtitle: 'From Gilgamesh to the Divine Comedy', description: '', book_count: 1588, hero_image: 'https://images.sourcelibrary.org/gallery/a0461b95-c56a-463a-beed-a6a2fb11cec2/695004c2f426a210d1097f09-0.jpg', languages: ['Greek', 'English', 'Latin'] },
  { slug: 'herbalism', name: 'Herbalism & Botany', subtitle: 'Herbals, Materia Medica & the Science of Plants', description: '', book_count: 388, hero_image: 'https://images.sourcelibrary.org/archived/6958dec2cf7070242ed42151/100.jpg', languages: ['Italian', 'Chinese', 'Latin'] },
  { slug: 'music-sound', name: 'Music & Sound', subtitle: 'Pythagorean Harmonics to Baroque Music Theory', description: '', book_count: 320, hero_image: 'https://images.sourcelibrary.org/archived/e48a21de-4db2-4c94-a71a-e952b9fa5393/7.jpg', languages: ['Latin', 'Chinese', 'Greek'] },
];

// Hardcoded discover books — shown when getDiscoverBooks() times out during DB stress.
// Curated selection of translated books across diverse subjects/languages.
// Last updated: 2026-03-10 from production DB.
const FALLBACK_DISCOVER_BOOKS = [
  { id: '6991e7a99d63c80e615599b5', slug: 'codex-atlanticus-partial-vinci', title: 'Codex Atlanticus (partial)', display_title: 'The Atlantic Codex', author: 'Leonardo da Vinci', language: 'Italian', published: 'Unknown', thumbnail: 'https://images.sourcelibrary.org/archived/6991e7a99d63c80e615599b5/5.jpg', thumbnail_blob: 'https://images.sourcelibrary.org/thumbnails/6991e7a99d63c80e615599b5/5.jpg', is_first_translation: true, pages_count: 10, pages_translated: 10, pages_ocr: 10, translation_percent: 100 },
  { id: '695937303b43cb6630c91e62', slug: 'the-sword-of-moses-trans', title: 'The Sword of Moses (Harba de-Mosheh)', display_title: 'The Sword of Moses', author: 'Moses (attr.) / Moses Gaster (trans.)', language: 'Syriac', published: 'Unknown', thumbnail: 'https://images.sourcelibrary.org/gallery/695937303b43cb6630c91e62/695937303b43cb6630c91e63-0.jpg', thumbnail_blob: 'https://images.sourcelibrary.org/thumbnails/695937303b43cb6630c91e62/1.jpg', is_first_translation: false, pages_count: 10, pages_translated: 10, pages_ocr: 10, translation_percent: 100 },
  { id: '6953aeb177f38f6761bd85d1', slug: 'hekate-selene-artemis-in-greek-magical-papyri-hopfner', title: 'Hekate-Selene-Artemis in Greek Magical Papyri', display_title: 'Hekate-Selene-Artemis and Related Deities in the Greek Magical Papyri', author: 'Theodor Hopfner', language: 'German', published: 'Unknown', thumbnail: 'https://images.sourcelibrary.org/archived/6953aeb177f38f6761bd85d1/4.jpg', thumbnail_blob: 'https://images.sourcelibrary.org/thumbnails/6953aeb177f38f6761bd85d1/1.jpg', is_first_translation: true, pages_count: 11, pages_translated: 11, pages_ocr: 11, translation_percent: 100 },
  { id: '695931d4b91a6184ea9433a8', slug: 'amulet-composed-by-al-buni-al-buni', title: 'Amulette composée par Al-Buni', display_title: 'The Amulet of Al-Buni', author: 'Ahmad al-Buni', language: 'Arabic', published: 'Unknown', thumbnail: 'https://images.sourcelibrary.org/archived/695931d4b91a6184ea9433a8/4.jpg', thumbnail_blob: 'https://images.sourcelibrary.org/thumbnails/695931d4b91a6184ea9433a8/1.jpg', is_first_translation: true, pages_count: 10, pages_translated: 10, pages_ocr: 10, translation_percent: 100 },
  { id: '6991d89d8c1030b12444c140', slug: 'chakra-and-nadi-in-the-shaiva-tradition', title: 'Chakra and Nadi in the Shaiva Tradition', display_title: 'Energy Centers and Channels in the Shiva Tradition', author: 'Unknown', language: 'Hindi', published: 'undated', thumbnail: 'https://images.sourcelibrary.org/archived/6991d89d8c1030b12444c140/6.jpg', thumbnail_blob: 'https://images.sourcelibrary.org/thumbnails/6991d89d8c1030b12444c140/6.jpg', is_first_translation: true, pages_count: 10, pages_translated: 10, pages_ocr: 10, translation_percent: 100 },
  { id: '6953c83377f38f6761bdbf5a', slug: 'gheranda-samhita-the-collection-of-gheranda-gheranda', title: 'Gheranda Samhita', display_title: 'The Collection of Gheranda', author: 'Gheranda', language: 'Sanskrit', published: 'Unknown', thumbnail: 'https://images.sourcelibrary.org/archived/6953c83377f38f6761bdbf5a/1.jpg', thumbnail_blob: 'https://images.sourcelibrary.org/thumbnails/6953c83377f38f6761bdbf5a/1.jpg', is_first_translation: false, pages_count: 11, pages_translated: 11, pages_ocr: 11, translation_percent: 100 },
  { id: '6991d8a38c1030b12444c221', slug: 'vajramrtatantra-ms-or-158-1', title: 'Vajramratatantra', display_title: 'Treatise on the Nectar of the Thunderbolt', author: 'Unknown', language: 'Sanskrit', published: 'undated', thumbnail: 'https://images.sourcelibrary.org/archived/6991d8a38c1030b12444c221/4.jpg', thumbnail_blob: 'https://images.sourcelibrary.org/thumbnails/6991d8a38c1030b12444c221/1.jpg', is_first_translation: true, pages_count: 12, pages_translated: 12, pages_ocr: 12, translation_percent: 100 },
  { id: '69907cf65f855ec553e784e3', slug: 'shani-chakram', title: 'Shani Chakram (Saturn)', display_title: 'The Wheel of Saturn', author: 'Unknown', language: 'Sanskrit', published: '1800', thumbnail: 'https://images.sourcelibrary.org/archived/69907cf65f855ec553e784e3/3.jpg', thumbnail_blob: 'https://images.sourcelibrary.org/thumbnails/69907cf65f855ec553e784e3/3.jpg', is_first_translation: true, pages_count: 10, pages_translated: 10, pages_ocr: 10, translation_percent: 100 },
  { id: '6992ca1cd4d545ae73fed82b', slug: 'dunhuang-illustrated-scroll', title: 'Pelliot chinois 4518 (Dunhuang Illustrated Scroll)', display_title: 'Dunhuang Monastic Ledger and Rhyme Dictionary Prefaces', author: 'Unknown', language: 'Chinese', published: 'Unknown', thumbnail: 'https://images.sourcelibrary.org/thumbnails/6992ca1cd4d545ae73fed82b/1.jpg', thumbnail_blob: 'https://images.sourcelibrary.org/thumbnails/6992ca1cd4d545ae73fed82b/1.jpg', is_first_translation: true, pages_count: 10, pages_translated: 10, pages_ocr: 10, translation_percent: 100 },
  { id: '69906828249ce014347d5b4d', slug: 'the-great-journey-of-yoga-brhadyogayatra-varahamihira', title: 'Brhadyogayatra of Varahamihira', display_title: 'The Great Journey of Yoga (Brhadyogayatra)', author: 'Varahamihira', language: 'Sanskrit', published: 'Unknown', thumbnail: 'https://images.sourcelibrary.org/archived/69906828249ce014347d5b4d/4.jpg', thumbnail_blob: 'https://images.sourcelibrary.org/thumbnails/69906828249ce014347d5b4d/1.jpg', is_first_translation: false, pages_count: 11, pages_translated: 11, pages_ocr: 11, translation_percent: 100 },
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
    image: 'https://images.sourcelibrary.org/archived/695230c6ab34727b1f044784/93.jpg',
  },
  {
    slug: 'philosophers-stone',
    title: "What Is the Philosopher's Stone? Eight Answers from the Primary Sources",
    subtitle: 'An allegorical emblem sequence, a universal salt, a red powder found in a bishop\'s tomb — eight primary sources, eight different answers.',
    date: '27 February 2026',
    readTime: '20 min read',
    tagKey: 'deepDive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://images.sourcelibrary.org/uploads/69804b952c52aad359879321/69804ceaefc8a337f6e2717b.jpg',
  },
  {
    slug: 'rithmomachia',
    title: 'Rithmomachia: The Forgotten Game That Taught Europe to Think Like Pythagoras',
    subtitle: 'Five treatises in five languages document a mathematical board game played across Europe for six centuries.',
    date: '2 March 2026',
    readTime: '18 min read',
    tagKey: 'collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://images.sourcelibrary.org/archived/699fcd499ff0f1d2c4518062/498.jpg',
  },
  {
    slug: 'first-translations',
    title: 'Over 500 First English Translations',
    subtitle: 'Alchemical lab manuals, radical theology, women alchemists, Sanskrit astrology manuscripts — all previously inaccessible in English.',
    date: '20 February 2026',
    readTime: '14 min read',
    tagKey: 'collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://images.sourcelibrary.org/archived/4d4089b9-9227-4cc5-b0a2-9b06ee731061/2.jpg',
  },
];

// ---------- Featured podcast episode (both homepages) ----------

export interface PodcastSource {
  bookId: string;
  slug?: string;
  title: string;
  author?: string;
  origin?: string;
}

export interface FeaturedPodcast {
  threadId: string;
  title: string;
  topic: string;
  audioUrl: string;
  heroImageUrl: string | null;
  sources: PodcastSource[];
}

// Latest published deep-dive episode in the homepage's own language.
//
// This began as a Spanish-only feature. It is now rendered on both homepages
// because the measurement said the placement is the thing that works: in the
// 30 days to 2026-08-13 the podcast drew 113 plays, and 66 of them (58%) were
// this one featured Spanish episode — which also had the best completion rate
// of any episode (33% vs 29% overall). The other ten-plus episodes, reachable
// only from the header nav, averaged about five plays each. So the nav item was
// retired (SiteHeader) and English got the placement that actually earns
// listens. A language with no published episode simply renders nothing.
//
// The language match is NOT `{ language }`. English threads carry no `language`
// field at all — measured 2026-08-13, all six published English deep-dives have
// it absent while the single Spanish one has `language: 'es'`. `language: 'en'`
// therefore matches zero documents, and the English feature would have rendered
// nothing forever while looking perfectly correct in code review. Absent means
// English here, so `en` has to accept the missing field.
async function getFeaturedPodcast(language: HomeLang): Promise<FeaturedPodcast | null> {
  const db = await getReadDb();
  const languageMatch =
    language === 'en'
      ? { $or: [{ language: 'en' }, { language: { $exists: false } }, { language: null }] }
      : { language };
  const thread = await db.collection('embassy_threads').findOne(
    { ...languageMatch, 'podcasts.deep-dive.published': true, 'podcasts.deep-dive.audioUrl': { $exists: true } },
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

/**
 * How much of the library a Spanish reader can actually read.
 *
 * Stated on the page because the honest answer is "a small, growing corner":
 * 103 books of 37,821. A Spanish front door that shows fifteen covers and says
 * nothing about scale implies a Spanish library, and the reader finds out by
 * clicking. Counted live rather than hard-coded — the number grows every time
 * the worker runs.
 */
export interface SpanishCounts { books: number; pages: number }

async function getSpanishCounts(): Promise<SpanishCounts | null> {
  const db = await getReadDb();
  const [row] = await db.collection('books').aggregate<{ books: number; pages: number }>([
    { $match: { pages_translated_es: { $gt: 0 }, visible: true, pages_count: { $gt: 0 } } },
    { $group: { _id: null, books: { $sum: 1 }, pages: { $sum: '$pages_translated_es' } } },
    { $project: { _id: 0, books: 1, pages: 1 } },
  ], { maxTimeMS: 8000 }).toArray();
  return row ?? null;
}

// ---------- Aggregate ----------

// ---------- Books with a Spanish edition (the /es "Leer en español" band) ----------

/** Slug of the curated collection that gathers every book with a Spanish edition. */
export const SPANISH_COLLECTION_SLUG = 'en-espanol';
const SPANISH_BOOKS_COUNT = 15;

// Minimal card shape for the slider: BookSlider's MiniBook plus the Spanish
// counter that switches on the card's "Español" tag.
export interface SpanishBook {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  year?: number;
  language?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  pages_translated_es?: number;
  localized?: LocalizedBookMap;
  is_first_translation?: boolean;
  ft_disposition?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  image_display?: string;
  image_thumb?: string;
  /** Straight into the reader in Spanish (first chapter / first readable page). */
  href: string;
}

// Most-read first (`read_count`), so the band leads with what Spanish readers
// are most likely to be looking for. `pages_translated_es` is the book-level
// counter kept by scripts/maintenance/sync-pages-translated-es.mjs — the per-
// page fields are not indexed and must never be scanned on a request path.
async function getSpanishBooks(): Promise<SpanishBook[]> {
  const db = await getReadDb();
  const books = await db.collection('books').find(
    { pages_translated_es: { $gt: 0 }, visible: true, pages_count: { $gt: 0 }, content_type: { $ne: 'artwork' } },
    {
      projection: {
        _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1,
        pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_translated_es: 1, localized: 1,
        is_first_translation: 1, ft_disposition: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1,
        'chapters.pageNumber': 1,
      },
      sort: { read_count: -1, pages_translated_es: -1 },
      limit: SPANISH_BOOKS_COUNT,
      maxTimeMS: 8000,
    },
  ).toArray();
  // The card opens the Spanish reader directly — the English book page would
  // drop the reader out of the Spanish experience (until #4082 gives it a twin).
  type Raw = Omit<SpanishBook, 'href'> & { chapters?: { pageNumber?: number }[] };
  return JSON.parse(JSON.stringify((books as unknown as Raw[]).map(({ chapters, ...b }) => ({
    ...b,
    href: spanishReaderHref({ ...b, chapters }),
  })))) as SpanishBook[];
}

// ---------- Aggregate ----------

export interface HomeData {
  featuredItems: FeaturedItem[];
  discoverBooks: Book[];
  recentlyTranslated: CatalogBook[];
  galleryPlates: Plate[];
  counts: HomeCounts;
  collections: CollectionForGrid[];
  blogPosts: HomeBlogPost[];
  featuredPodcast: FeaturedPodcast | null;
  /** Books with a Spanish edition, most-read first. Empty on the English homepage. */
  spanishBooks: SpanishBook[];
  /** Size of the Spanish corpus, for the honest scale line. Null off /es. */
  spanishCounts: SpanishCounts | null;
}

// `lang` selects the podcast episode's language and the Spanish-edition band,
// and nothing else — every other query is language-agnostic, which is what
// keeps the two homepages structurally identical (see the note at the top of
// this file).
export async function getHomeData(lang: HomeLang = 'en'): Promise<HomeData> {
  const [featuredItems, discoverBooks, recentlyTranslated, galleryPlates, counts, collections, featuredPodcast, spanishBooks, spanishCounts] = await Promise.all([
    withTimeout(getFeaturedCollections(), 20000, [] as FeaturedItem[]),
    withTimeout(getDiscoverBooks(), 20000, FALLBACK_DISCOVER_BOOKS),
    withTimeout(getRecentlyTranslated(), 20000, [] as CatalogBook[]),
    withTimeout(getHomeGalleryPlates(), 20000, [] as Plate[]),
    getBookCounts(),
    withTimeout(getRemainingCollections(), 20000, SORTED_FALLBACK_COLLECTIONS),
    withTimeout(getFeaturedPodcast(lang), 8000, null),
    lang === 'es' ? withTimeout(getSpanishBooks(), 8000, [] as SpanishBook[]) : Promise.resolve([] as SpanishBook[]),
    lang === 'es' ? withTimeout(getSpanishCounts(), 8000, null) : Promise.resolve(null),
  ]);

  return { featuredItems, discoverBooks, recentlyTranslated, galleryPlates, counts, collections, blogPosts: BLOG_POSTS, featuredPodcast, spanishBooks, spanishCounts };
}
