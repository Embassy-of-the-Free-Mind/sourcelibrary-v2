import { getDb } from '@/lib/mongodb';
import { Book } from '@/lib/types';
import { type CollectionForGrid } from '@/components/book/BookLibrary';
import HeroSection from '@/components/layout/HeroSection';
import HomePageSchema from '@/components/seo/HomePageSchema';
import FeaturedCollectionCarousel from '@/components/prototype/FeaturedCollectionHero';
import FromTheCollection from '@/components/prototype/FromTheCollection';
import BookCard from '@/components/book/BookCard';
import SocietyGate from '@/components/layout/SocietyGate';
import SignUpCTA from '@/components/auth/SignUpCTA';
import Link from 'next/link';

// ISR: serve cached HTML, revalidate in background every 60 seconds.
// Short revalidation so stale fallback data (from DB stress) doesn't persist long.
export const revalidate = 60;
export const maxDuration = 60;

// ---------- Collection ordering (user-specified) ----------

const COLLECTION_ORDER = [
  'Natural Philosophy',
  'Theology',
  'Classical Philosophy',
  'Alchemy',
  'Indic',
  'Chinese',
  'Magic',
  'Medicine',
  'Art',
  'Secret Societies',
  'Leonardo',
];

function collectionSortIndex(name: string): number {
  const idx = COLLECTION_ORDER.findIndex(prefix => name.includes(prefix));
  return idx === -1 ? COLLECTION_ORDER.length : idx;
}

// ---------- Book projection shared across queries ----------

const BOOK_PROJECTION = {
  _id: 0,
  id: { $ifNull: ['$id', { $toString: '$_id' }] },
  slug: 1,
  title: 1,
  display_title: 1,
  author: 1,
  thumbnail: 1,
  thumbnail_blob: 1,
  language: 1,
  published: 1,
  is_first_translation: 1,
  pages_count: { $ifNull: ['$pages_count', 0] },
  pages_translated: { $ifNull: ['$pages_translated', 0] },
  pages_ocr: { $ifNull: ['$pages_ocr', 0] },
  translation_percent: {
    $cond: {
      if: { $gt: [{ $ifNull: ['$pages_ocr', 0] }, 0] },
      then: { $round: [{ $multiply: [{ $divide: [{ $ifNull: ['$pages_translated', 0] }, { $ifNull: ['$pages_ocr', 0] }] }, 100] }] },
      else: 0,
    },
  },
};

// ---------- Data fetching ----------

async function getFeaturedCollections() {
  const db = await getDb();

  // Pick 5 random collections that have enough books
  const collections = await db.collection('collections').aggregate([
    { $match: { book_count: { $gte: 5 } } },
    { $sample: { size: 5 } },
  ]).toArray();

  if (collections.length === 0) return [];

  // Batch-fetch books for ALL 5 collections in a single query instead of 5 separate queries.
  // Each individual query was doing a full collection sort (no read_count index) → 5x full scan.
  const allSlugs = collections.map(c => c.slug);
  const allBooks = await db.collection('books').aggregate([
    {
      $match: {
        collections: { $in: allSlugs },
        hidden: { $ne: true },
        pages_count: { $gt: 0 },
        pages_translated: { $gt: 0 },
      },
    },
    { $project: { _id: 0, id: { $ifNull: ['$id', { $toString: '$_id' }] }, slug: 1, title: 1, display_title: 1, author: 1, thumbnail: 1, thumbnail_blob: 1, collections: 1 } },
  ], { maxTimeMS: 8000 }).toArray();

  // Group books by collection slug (a book can appear in multiple collections)
  const booksBySlug = new Map<string, typeof allBooks>();
  for (const book of allBooks) {
    const bookCollections = Array.isArray(book.collections) ? book.collections : [];
    for (const slug of allSlugs) {
      if (bookCollections.includes(slug)) {
        if (!booksBySlug.has(slug)) booksBySlug.set(slug, []);
        const arr = booksBySlug.get(slug)!;
        if (arr.length < 10) arr.push(book);
      }
    }
  }

  const results = collections.map((collection) => {
    const images = collection.featured_images || [];
    const hero = images.find(
      (img: unknown) => typeof img === 'string' || (img && typeof img === 'object' && ((img as Record<string, unknown>).extracted_url || (img as Record<string, unknown>).image_url || (img as Record<string, unknown>).thumbnail_url))
    );
    const heroUrl = typeof hero === 'string' ? hero : ((hero as Record<string, unknown>)?.extracted_url || (hero as Record<string, unknown>)?.image_url || (hero as Record<string, unknown>)?.thumbnail_url || null) as string | null;

    const books = (booksBySlug.get(collection.slug as string) || []).map(({ collections: _c, ...rest }) => rest);

    // Fall back to hardcoded hero image if DB doesn't have featured_images
    const fallbackHero = FALLBACK_COLLECTIONS.find(f => f.slug === collection.slug)?.hero_image;
    return {
      collection: {
        slug: collection.slug as string,
        name: collection.name as string,
        subtitle: (collection.subtitle || '') as string,
        description: (collection.description || '') as string,
        book_count: (collection.book_count || 0) as number,
        hero_image: (heroUrl || fallbackHero || null) as string | null,
      },
      books: JSON.parse(JSON.stringify(books)),
    };
  });

  // Only return collections that have translated books to show
  return results.filter(r => r.books.length > 0);
}

async function getRemainingCollections(): Promise<CollectionForGrid[]> {
  const db = await getDb();
  const docs = await db.collection('collections').find({}).toArray();

  const result = docs.map(({ _id, ...rest }) => {
    const images = rest.featured_images || [];
    const hero = images.find(
      (img: unknown) => typeof img === 'string' || (img && typeof img === 'object' && ((img as Record<string, unknown>).extracted_url || (img as Record<string, unknown>).image_url || (img as Record<string, unknown>).thumbnail_url))
    );
    const heroUrl = typeof hero === 'string' ? hero : ((hero as Record<string, unknown>)?.extracted_url || (hero as Record<string, unknown>)?.image_url || (hero as Record<string, unknown>)?.thumbnail_url || null) as string | null;
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
      name: rest.name,
      subtitle: rest.subtitle || '',
      description: rest.description || '',
      book_count: rest.book_count || 0,
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
            hidden: { $ne: true },
            $or: [
              { thumbnail_blob: { $exists: true, $nin: [null, ''] } },
              { thumbnail: { $exists: true, $nin: [null, ''] } },
            ],
          },
        },
        { $project: { collections: 1, thumbnail_blob: 1, thumbnail: 1 } },
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

  // Sort by user-specified order
  result.sort((a, b) => collectionSortIndex(a.name) - collectionSortIndex(b.name));

  return result;
}

async function getDiscoverBooks(): Promise<Book[]> {
  const db = await getDb();

  // $sample FIRST so MongoDB uses fast random cursor (O(1) when size < 5% of collection).
  // $match after $sample filters the random sample down.
  // Over-sample to account for hidden/untranslated books being filtered out.
  const books = await db.collection('books').aggregate([
    { $sample: { size: 200 } },
    { $match: { hidden: { $ne: true }, pages_translated: { $gte: 10 } } },
    { $limit: 10 },
    { $project: BOOK_PROJECTION },
  ], { maxTimeMS: 8000 }).toArray();

  return JSON.parse(JSON.stringify(books)) as Book[];
}

async function getCollectionShowcase() {
  const db = await getDb();

  // $sample FIRST (before $match) so MongoDB uses fast random cursor algorithm.
  // When $sample is after $match, Mongo scans all matching docs first → 22s on 77k docs.
  // $sample first on full collection with size < 5% uses O(1) random selection.
  // Use $gt:'' for thumbnail_url — $ne:'' doesn't exclude null values.
  const rawImages = await db.collection('gallery_images').aggregate([
    { $sample: { size: 500 } },
    {
      $match: {
        gallery_quality: { $gte: 0.85 },
        museum_description: { $exists: true, $ne: '' },
        $or: [
          { thumbnail_url: { $type: 'string', $gt: '' } },
          { extracted_url: { $type: 'string', $gt: '' } },
        ],
        book_hidden: { $ne: true },
      },
    },
    { $limit: 40 },
  ], { maxTimeMS: 8000 }).toArray();

  // Diversify: max 1 per book, take 8
  const seen = new Set<string>();
  const selected = [];
  for (const img of rawImages) {
    if (seen.has(img.book_id)) continue;
    seen.add(img.book_id);
    selected.push(img);
    if (selected.length >= 8) break;
  }

  // Batch-fetch quotes + slugs for all selected books in ONE query (not N+1)
  const bookIds = [...new Set(selected.map(img => img.book_id))];
  const booksWithQuotes = await db.collection('books').find(
    { id: { $in: bookIds } },
    { projection: { id: 1, 'reading_summary.quotes': 1, slug: 1 } },
  ).toArray();
  const bookMap = new Map(booksWithQuotes.map(b => [b.id, b]));

  const items = selected.map((img) => {
    const book = bookMap.get(img.book_id);
    let quote: { text: string; page: number } | undefined;
    const quotes = book?.reading_summary?.quotes;
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
      quote,
    };
  });

  return JSON.parse(JSON.stringify(items));
}

async function getBookCounts(): Promise<{ totalBooks: number; translatedCount: number }> {
  // Hardcoded to avoid a 22s full-collection aggregation that was timing out the homepage.
  // TODO: replace with a cached/indexed query. Actual counts as of 2026-03-10: ~7100 / ~4200.
  return { totalBooks: 7100, translatedCount: 4200 };
}

// ---------- Hardcoded fallback data (DB resilience) ----------
// Used when MongoDB is unreachable. Same pattern as getBookCounts().
// Last updated: 2026-03-10 from /api/collections.

const FALLBACK_COLLECTIONS: CollectionForGrid[] = [
  { slug: 'natural-philosophy', name: 'Natural Philosophy & Science', subtitle: 'From Aristotle to Newton', description: '', book_count: 971, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6952d0fa77f38f6761bc5aef/24.jpg', languages: ['Latin', 'Chinese', 'English'] },
  { slug: 'theology', name: 'Theology & Religious Thought', subtitle: 'Scholasticism, Reformation & Apologetics', description: '', book_count: 1456, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/e48a21de-4db2-4c94-a71a-e952b9fa5393/69500507f426a210d109c2be-0.jpg', languages: ['Latin', 'English', 'German'] },
  { slug: 'classical-philosophy', name: 'Classical Philosophy', subtitle: 'Ancient Greek & Roman Thought', description: '', book_count: 753, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69568900be7c607c5f03c2d7/69569e3b1479a63c11092796-0.jpg', languages: ['Greek', 'Latin', 'English'] },
  { slug: 'alchemy', name: 'Alchemy', subtitle: 'The Art of Transmutation', description: '', book_count: 577, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69520c46ab34727b1f044141/69520c46ab34727b1f044158-0.jpg', languages: ['Latin', 'German', 'English'] },
  { slug: 'indic-traditions', name: 'Indic Traditions', subtitle: 'Vedas, Yoga, Tantra & Buddhist Texts', description: '', book_count: 654, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6991d8978c1030b12444c035/6991d8978c1030b12444c04c-1.jpg', languages: ['Sanskrit', 'English', 'Tamil'] },
  { slug: 'chinese-classics', name: 'Chinese Classics', subtitle: 'Confucian, Daoist & Buddhist Texts', description: '', book_count: 589, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6992cacfd4d545ae73feeb33/dunhuang-hero.jpg', languages: ['Chinese', 'English', 'French'] },
  { slug: 'magic', name: 'Magic & Occult Arts', subtitle: 'Grimoires, Natural Magic & Ceremonial Practice', description: '', book_count: 337, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/a5d0c381-d4ea-42cd-8864-44457e7fda33/69500509f426a210d109c5bd-0.jpg', languages: ['Latin', 'English', 'French'] },
  { slug: 'medicine', name: 'Medicine & Natural History', subtitle: 'Herbalism, Anatomy & the Living World', description: '', book_count: 510, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6ff1a28b-f7cd-4fcd-8d08-77d2f7818be1/695004d8f426a210d1099e4b-0.jpg', languages: ['Latin', 'Chinese', 'English'] },
  { slug: 'art-illustrated', name: 'Art & Illustrated Books', subtitle: 'Emblems, Engravings & Visual Knowledge', description: '', book_count: 252, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/e532b010-6d2e-40ca-9f95-c67e74c5ee61/695004b4f426a210d10975f4-0.jpg', languages: ['Chinese', 'Latin', 'Italian'] },
  { slug: 'secret-societies', name: 'Secret Societies', subtitle: 'Freemasonry, Rosicrucians & Fraternal Orders', description: '', book_count: 211, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6952587bab34727b1f045546/6959068695a91542b28bd761-0.jpg', languages: ['German', 'Latin', 'French'] },
  { slug: 'leonardo-da-vinci', name: 'Leonardo da Vinci', subtitle: 'Manuscripts, codices, treatises, and anatomical drawings', description: '', book_count: 30, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6991e93135ed50020acc1458/8.jpg', languages: ['Italian', 'French', 'English'] },
  { slug: 'hermetica', name: 'Hermetica', subtitle: 'Hermetic Philosophy & Prisca Theologia', description: '', book_count: 677, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69520176ab34727b1f04136b/69520177ab34727b1f041503-0.jpg', languages: ['Latin', 'German', 'English'] },
  { slug: 'kabbalah', name: 'Kabbalah', subtitle: 'Jewish Mysticism & Christian Cabala', description: '', book_count: 158, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/4d4089b9-9227-4cc5-b0a2-9b06ee731061/6950050cf426a210d109ca95-0.jpg', languages: ['Latin', 'Hebrew', 'German'] },
  { slug: 'astrology', name: 'Astrology & Divination', subtitle: 'Celestial Science & the Mantic Arts', description: '', book_count: 494, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6990688d249ce014347d6e76/6990688d249ce014347d6eb2-0.jpg', languages: ['Sanskrit', 'Latin', 'Chinese'] },
  { slug: 'mysticism', name: 'Mysticism', subtitle: 'Direct Experience of the Divine', description: '', book_count: 719, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6991d89d8c1030b12444c140/6991d89e8c1030b12444c146-0.jpg', languages: ['German', 'English', 'Latin'] },
  { slug: 'sacred-texts', name: 'Sacred Texts', subtitle: 'Scripture, Church Fathers & Liturgy', description: '', book_count: 495, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69528b19ab34727b1f04f2fe/69528b19ab34727b1f04f306-0.jpg', languages: ['English', 'Latin', 'Greek'] },
  { slug: 'renaissance-philosophy', name: 'Renaissance Philosophy', subtitle: 'Florentine Platonism & Humanist Thought', description: '', book_count: 388, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/f20894c1-495f-4afe-815b-e8bf3c8938a5/695004b9f426a210d1097a97-0.jpg', languages: ['Latin', 'English', 'Italian'] },
  { slug: 'demonology', name: 'Demonology & Witchcraft', subtitle: 'Witch Trials, Possession & the Demonic', description: '', book_count: 152, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6952db2477f38f6761bc70c4/6952db2477f38f6761bc70cc-0.jpg', languages: ['English', 'Latin', 'German'] },
  { slug: 'literature', name: 'Literature & Poetry', subtitle: 'Epic, Allegory & Early Fiction', description: '', book_count: 531, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/a0461b95-c56a-463a-beed-a6a2fb11cec2/695004c2f426a210d1097f09-0.jpg', languages: ['Greek', 'English', 'Latin'] },
  { slug: 'herbalism', name: 'Herbalism & Botany', subtitle: 'Herbals, Materia Medica & the Science of Plants', description: '', book_count: 192, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6958dec2cf7070242ed42151/100.jpg', languages: ['Italian', 'Chinese', 'Latin'] },
  { slug: 'music-harmony', name: 'Music, Harmony & Resonance', subtitle: 'The mathematical and mystical dimensions of sound', description: '', book_count: 39, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/e48a21de-4db2-4c94-a71a-e952b9fa5393/7.jpg', languages: ['Latin', 'Chinese', 'Greek'] },
  { slug: 'shwep', name: 'SHWEP Reading Room', subtitle: 'Primary Sources from the Secret History of Western Esotericism Podcast', description: '', book_count: 440, hero_image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/c87fadfa-1543-44b9-a138-573c144246e6/6959af9b1dfc1806c080b7e6-0.jpg', languages: ['Greek', 'Latin', 'English'] },
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

// Pre-sorted fallback (matches collectionSortIndex order)
const SORTED_FALLBACK_COLLECTIONS = [...FALLBACK_COLLECTIONS].sort(
  (a, b) => collectionSortIndex(a.name) - collectionSortIndex(b.name)
);

// ---------- Blog posts (curated subset for homepage) ----------

const BLOG_POSTS = [
  {
    slug: 'hidden-engineers',
    title: 'The Hidden Engineers: Steam Engines in Spell Books, Automata in Alchemy',
    subtitle: 'Before engineering was a discipline, its knowledge lived inside alchemy, natural magic, and mystical philosophy.',
    date: '27 February 2026',
    readTime: '22 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/695230c6ab34727b1f044784/93.jpg',
  },
  {
    slug: 'philosophers-stone',
    title: "What Is the Philosopher's Stone? Eight Answers from the Primary Sources",
    subtitle: 'An allegorical emblem sequence, a universal salt, a red powder found in a bishop\'s tomb — eight primary sources, eight different answers.',
    date: '27 February 2026',
    readTime: '20 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/uploads/69804b952c52aad359879321/69804ceaefc8a337f6e2717b.jpg',
  },
  {
    slug: 'rithmomachia',
    title: 'Rithmomachia: The Forgotten Game That Taught Europe to Think Like Pythagoras',
    subtitle: 'Five treatises in five languages document a mathematical board game played across Europe for six centuries.',
    date: '2 March 2026',
    readTime: '18 min read',
    tag: 'Collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd499ff0f1d2c4518062/498.jpg',
  },
  {
    slug: 'first-translations',
    title: 'Over 500 First English Translations',
    subtitle: 'Alchemical lab manuals, radical theology, women alchemists, Sanskrit astrology manuscripts — all previously inaccessible in English.',
    date: '20 February 2026',
    readTime: '14 min read',
    tag: 'Collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/4d4089b9-9227-4cc5-b0a2-9b06ee731061/2.jpg',
  },
];

// ---------- Page ----------

// Race a promise against a timeout, returning fallback on timeout OR error
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch((err) => {
      console.error('[Homepage] query failed:', err?.message || err);
      return fallback;
    }),
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export default async function HomePage() {
  const [featuredItems, discoverBooks, showcase, counts, collections] = await Promise.all([
    withTimeout(getFeaturedCollections(), 20000, []),
    withTimeout(getDiscoverBooks(), 20000, FALLBACK_DISCOVER_BOOKS),
    withTimeout(getCollectionShowcase(), 20000, []),
    getBookCounts(),
    withTimeout(getRemainingCollections(), 20000, SORTED_FALLBACK_COLLECTIONS),
  ]);

  return (
    <SocietyGate>
      <div className="min-h-screen">
        <HomePageSchema books={discoverBooks} bookCount={counts.totalBooks} translatedCount={counts.translatedCount} />

        {/* Video Hero — same as current homepage */}
        <HeroSection />

        {/* Collections Grid */}
        <section id="library" className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
          <div className="px-6 md:px-12 max-w-7xl mx-auto">
            <div className="flex items-baseline justify-between mb-8">
              <div>
                <h2 className="text-3xl md:text-4xl text-primary font-display">
                  Collections
                </h2>
                <p className="text-muted mt-2">
                  {counts.totalBooks.toLocaleString('en-US')} books &middot; {counts.translatedCount.toLocaleString('en-US')} with translations
                </p>
              </div>
              <Link
                href="/search"
                className="text-sm text-accent-rust hover:underline hidden md:block"
              >
                Browse all books
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {collections.map((col, i) => (
                <Link
                  key={col.slug}
                  href={`/collections/${col.slug}`}
                  className="group relative bg-white rounded-xl border border-border-light overflow-hidden hover:shadow-lg hover:border-accent-rust/20 transition-all"
                >
                  {/* Hero image */}
                  <div className="aspect-[16/9] relative bg-warm overflow-hidden">
                    {col.hero_image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={col.hero_image}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        loading={i < 8 ? 'eager' : 'lazy'}
                        // eslint-disable-next-line react/no-unknown-property
                        fetchPriority={i < 4 ? 'high' : 'auto'}
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-accent-rust/10 to-accent-gold/10" />
                    )}
                  </div>

                  {/* Text */}
                  <div className="p-4">
                    <h3 className="font-display text-lg text-primary group-hover:text-accent-rust transition-colors line-clamp-1">
                      {col.name}
                    </h3>
                    {col.subtitle && (
                      <p className="text-sm text-muted mt-1 line-clamp-2">{col.subtitle}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 text-xs text-faint">
                      <span>{col.book_count} books</span>
                      {col.languages && col.languages.length > 0 && (
                        <>
                          <span>&middot;</span>
                          <span>{col.languages.join(', ')}</span>
                        </>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Featured Collection Carousel — flip through collections */}
        {featuredItems.length > 0 && (
          <FeaturedCollectionCarousel items={featuredItems} />
        )}

        {/* From the Collection — image-heavy gallery showcase */}
        <FromTheCollection items={showcase} />

        {/* Discover Section */}
        <section className="bg-white py-16 md:py-24">
          <div className="px-6 md:px-12 max-w-7xl mx-auto">
            <h2 className="text-3xl md:text-4xl text-primary mb-3 font-display">
              Discover
            </h2>
            <p className="text-muted mb-10 max-w-2xl">
              Translated primary sources from the collection.
            </p>

            {discoverBooks.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5">
                {discoverBooks.map((book, i) => (
                  <BookCard key={book.id} book={book} priority={i < 2} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-muted mb-4">Browse the collection to discover translated primary sources.</p>
                <Link href="/search?has_translation=true" className="inline-block px-6 py-3 bg-accent-rust text-white rounded-lg hover:bg-accent-rust/90 transition-colors">
                  Browse all books
                </Link>
              </div>
            )}
          </div>
        </section>

        {/* Blog Section */}
        <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
          <div className="px-6 md:px-12 max-w-7xl mx-auto">
            <div className="flex items-baseline justify-between mb-10">
              <div>
                <h2 className="text-3xl md:text-4xl text-primary font-display">
                  From the Blog
                </h2>
                <p className="text-muted mt-2">
                  Essays on the history behind the collection
                </p>
              </div>
              <Link
                href="/blog"
                className="text-sm text-accent-rust hover:underline hidden md:block"
              >
                All posts
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {BLOG_POSTS.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="group bg-white rounded-xl border border-border-light overflow-hidden hover:shadow-lg hover:border-accent-rust/20 transition-all"
                >
                  {post.image && (
                    <div className="aspect-[16/10] relative bg-warm overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={post.image}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        loading="lazy"
                      />
                    </div>
                  )}
                  <div className="p-4">
                    {post.tag && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${post.tagColor}`}>
                        {post.tag}
                      </span>
                    )}
                    <h3 className="font-display text-lg text-primary mt-2 group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug">
                      {post.title}
                    </h3>
                    <p className="text-sm text-muted mt-1.5 line-clamp-2">
                      {post.subtitle}
                    </p>
                    <p className="text-xs text-faint mt-3">
                      {post.date} &middot; {post.readTime}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* About Section */}
        <section id="about" className="bg-white py-16 md:py-24">
          <div className="px-6 md:px-12 max-w-5xl mx-auto">
            <h2 className="text-3xl md:text-4xl lg:text-5xl text-gray-900 mb-8 leading-tight font-display">
              The rediscovery of ancient wisdom helped spark the Renaissance. It&apos;s time for another.
            </h2>
            <div className="space-y-6 text-lg md:text-xl text-gray-600 leading-relaxed">
              <p>
                Centuries of humanity&apos;s deepest thinking sit locked in Latin and other inaccessible
                languages. These aren&apos;t just inaccessible to humans; contemporary AI systems were trained
                on Reddit but not the Renaissance. Millions of books and manuscripts are unscanned and
                untranslated. These aren&apos;t obscure footnotes. They are the roots of modern science,
                psychology, philosophy of mind, and the perennial questions about what it means to be human.
              </p>
              <p>
                The Source Library uses scholarship and AI systems to recover this knowledge and make it
                accessible to all. We are building the world&apos;s largest open-access collection of translated
                primary sources&mdash;so that scholars, seekers, and AI systems can draw on the full depth of
                the human intellectual tradition.
              </p>
              <p className="text-gray-500 text-base">
                The Source Library is an initiative of the{' '}
                <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:underline">Embassy of the Free Mind</a>{' '}
                in Amsterdam, home to the Bibliotheca Philosophica Hermetica: one of the world&apos;s most
                important collections of Hermetic, alchemical, and esoteric books.
              </p>
            </div>
          </div>
        </section>

        {/* Sign Up CTA — only shows for anonymous users */}
        <SignUpCTA />

        {/* Search Section */}
        <section className="bg-gradient-to-b from-white to-[#f6f3ee] py-16 md:py-20">
          <div className="px-6 md:px-12 max-w-2xl mx-auto text-center">
            <h2 className="text-2xl md:text-3xl text-gray-900 mb-3 font-display">
              Search the collection
            </h2>
            <p className="text-stone-500 mb-6">
              Search across books, translations, and AI-generated indexes
            </p>
            <form action="/search" method="get" className="relative max-w-lg mx-auto">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                name="q"
                placeholder="Hermes, alchemy, Ficino..."
                className="w-full pl-12 pr-4 py-3.5 bg-white border border-stone-200 rounded-full text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-accent-rust/20 focus:border-accent-rust shadow-sm"
              />
            </form>
          </div>
        </section>

        {/* Footer */}
        <footer className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
          <div className="px-6 md:px-12 max-w-5xl mx-auto">
            <div className="max-w-4xl border-t border-stone-300 pt-10 mt-8">
              <p className="text-sm uppercase tracking-[0.2em] text-stone-500 mb-6">
                In the spirit of
              </p>
              <div className="flex flex-col md:flex-row md:items-start gap-8 md:gap-12">
                <div className="flex-1">
                  <h3 className="text-xl md:text-2xl text-stone-800 mb-1 font-display">
                    Marsilio Ficino
                  </h3>
                  <p className="text-stone-500 text-sm mb-3">
                    1433&ndash;1499 &middot; Philosopher &amp; Translator
                  </p>
                  <p className="text-stone-600 text-base leading-relaxed">
                    Ficino translated the complete works of Plato, Plotinus, Proclus, Iamblichus, and the
                    Hermetic writings into Latin&mdash;making them accessible to all of Europe for the first
                    time. His work ignited the Renaissance recovery of Neoplatonism, Hermeticism, and
                    the <em>prisca theologia</em>: the belief in an ancient wisdom tradition uniting all
                    seekers of truth.
                  </p>
                </div>
                <div className="flex-1">
                  <h3 className="text-xl md:text-2xl text-stone-800 mb-1 font-display">
                    Cosimo de&apos; Medici
                  </h3>
                  <p className="text-stone-500 text-sm mb-3">
                    1389&ndash;1464 &middot; Florence
                  </p>
                  <p className="text-stone-600 text-base leading-relaxed">
                    The inventor of modern banking, Cosimo de&apos; Medici used his wealth to fund the
                    Renaissance. In addition to commissioning art, he funded Ficino to make translations
                    of Plato and other lost works into Latin so that they could be read. Around 1460,
                    a Greek manuscript of the <em>Corpus Hermeticum</em> arrived in Florence, brought from
                    Macedonia by a monk named Leonardo of Pistoia. The dying Cosimo asked Ficino to pause
                    his translation of Plato so that he could read it&mdash;sensing that Hermes held
                    the key to the most ancient wisdom.
                  </p>
                </div>
              </div>
              <div className="mt-8 bg-accent-gold/5 rounded-lg p-5 border border-accent-gold/15">
                <p className="text-stone-700 text-base leading-relaxed">
                  <strong>The Source Library continues in the spirit of their work.</strong> Translating
                  ancient wisdom and sharing it freely has the power to transform civilization. Centuries
                  after Ficino, thousands of texts remain untranslated and unread&mdash;including many
                  of Ficino&apos;s own works. We are recovering them&mdash;for scholars, for seekers,
                  and for the AI systems that will shape how future generations think.
                </p>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </SocietyGate>
  );
}
