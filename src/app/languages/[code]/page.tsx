import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, ArrowLeft, Images } from 'lucide-react';
import { getDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import CollectionBookCard from '@/components/CollectionBookCard';
import CollectionFilters from '@/components/collections/CollectionFilters';
import { bookTitle } from '@/lib/collections-utils';

const PER_PAGE = 60;

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Decode slug back to language name — handles multi-word languages
function decodeLanguageSlug(slug: string): string {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ---------- Metadata ----------

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const langName = decodeLanguageSlug(code);

  let count: number;
  try {
    const db = await getDb();
    count = await db.collection('books').countDocuments({
      language: langName,
      status: { $ne: 'deleted' },
      hidden: { $ne: true },
      pages_count: { $gt: 0 },
    });
  } catch {
    return { title: 'Source Library', robots: { index: false, follow: false } };
  }

  if (count === 0) return { title: 'Language Not Found - Source Library', robots: { index: false, follow: true } };

  const description = `Browse ${count} ${langName} texts in Source Library — digitized and translated from original manuscripts and early printed books.`;

  return {
    title: `${langName} Texts | Source Library`,
    description,
    alternates: { canonical: `/languages/${code}` },
    openGraph: {
      title: `${langName} Texts | Source Library`,
      description,
      type: 'website',
    },
  };
}

// ---------- Data types ----------

interface BookItem {
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
  photo?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  published?: string;
  read_count?: number;
  is_first_translation?: boolean;
}

// ---------- Data fetching ----------

async function fetchLanguageData(langName: string, sort: string, offset: number, q?: string) {
  const db = await getDb();

  const baseFilter: Record<string, unknown> = {
    language: langName,
    status: { $ne: 'deleted' },
    hidden: { $ne: true },
    pages_count: { $gt: 0 },
  };

  const filter = { ...baseFilter };
  if (q && q.length >= 2) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = { $regex: escaped, $options: 'i' };
    filter.$or = [{ title: regex }, { display_title: regex }, { author: regex }];
  }

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    year_asc: { published: 1, title: 1 },
    year_desc: { published: -1, title: 1 },
    title: { title: 1 },
    recent: { created_at: -1 },
    popular: { read_count: -1, title: 1 },
  };
  const sortObj = sortMap[sort] || sortMap.popular;

  const projection = {
    _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1,
    language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
    photo: 1, thumbnail: 1, thumbnail_blob: 1, published: 1, read_count: 1,
    is_first_translation: 1,
  };

  // Sample book IDs for gallery
  const sampleBookIds = await db.collection('books')
    .find(baseFilter, { projection: { _id: 0, id: 1 } })
    .sort({ read_count: -1 })
    .limit(50)
    .toArray()
    .then(docs => docs.map(d => d.id as string));

  const [books, total, firstTranslationCount, galleryImages] = await Promise.all([
    db.collection('books')
      .find(filter, { projection })
      .sort(sortObj)
      .skip(offset)
      .limit(PER_PAGE)
      .toArray(),
    db.collection('books').countDocuments(filter),
    db.collection('books').countDocuments({
      ...baseFilter,
      is_first_translation: true,
    }),
    sampleBookIds.length > 0
      ? db.collection('gallery_images').aggregate([
          { $match: {
            book_id: { $in: sampleBookIds },
            gallery_quality: { $gte: 0.7 },
            book_hidden: { $ne: true },
            type: { $nin: ['decorative', 'symbol', 'musical_score', 'exlibris', 'bookplate'] },
          }},
          { $sort: { gallery_quality: -1 } },
          { $group: { _id: '$book_id', images: { $push: '$$ROOT' } } },
          { $project: { images: { $slice: ['$images', 2] } } },
          { $unwind: '$images' },
          { $replaceRoot: { newRoot: '$images' } },
          { $sort: { gallery_quality: -1 } },
          { $limit: 12 },
        ]).toArray().catch(() => [])
      : Promise.resolve([]),
  ]);

  return {
    books: books as unknown as BookItem[],
    total,
    firstTranslationCount,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    galleryImages: galleryImages as any[],
  };
}

// ---------- Page ----------

export default async function LanguageDetailPage({ params, searchParams }: Props) {
  const { code } = await params;
  const langName = decodeLanguageSlug(code);

  const sp = await searchParams;
  const sort = (typeof sp.sort === 'string' ? sp.sort : '') || 'popular';
  const q = typeof sp.q === 'string' ? sp.q : '';
  const offset = parseInt(typeof sp.offset === 'string' ? sp.offset : '0') || 0;

  const { books, total, firstTranslationCount, galleryImages } = await fetchLanguageData(
    langName, sort, offset, q || undefined
  );

  if (total === 0 && !q) notFound();

  const totalPages = Math.ceil(total / PER_PAGE);
  const currentPage = Math.floor(offset / PER_PAGE) + 1;
  const basePath = `/languages/${code}`;

  return (
    <div className="min-h-screen bg-cream">
      {/* Hero Section */}
      <div className="relative bg-dark overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-transparent" />
        <div className="relative max-w-7xl mx-auto px-6 pt-8 pb-12 sm:pb-16">
          <Link
            href="/languages"
            className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Languages
          </Link>

          <h1 className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3 font-display">
            {langName}
          </h1>

          <div className="flex flex-wrap items-center gap-4 text-sm text-white/50">
            <span>{total.toLocaleString()} books</span>
            {firstTranslationCount > 0 && (
              <>
                <span className="w-px h-4 bg-white/20" />
                <span className="text-accent-gold-light">{firstTranslationCount} first English translations</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Gallery Grid */}
      {galleryImages.length > 0 && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-7xl mx-auto px-6 py-6">
            <h2 className="text-xl sm:text-2xl text-primary mb-4 font-display">Illustrations</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {galleryImages.map((img: { pageId?: string; page_id?: string; detectionIndex?: number; detection_index?: number; thumbnailUrl?: string; thumbnail_url?: string; extractedUrl?: string; extracted_url?: string; imageUrl?: string; image_url?: string; museumDescription?: string; museum_description?: string; description?: string; bookTitle?: string; book_title?: string; type?: string }) => {
                const thumb = img.thumbnailUrl || img.thumbnail_url || img.extractedUrl || img.extracted_url || img.imageUrl || img.image_url;
                const pageId = img.pageId || img.page_id;
                const detIdx = img.detectionIndex ?? img.detection_index;
                const galleryId = `${pageId}-${detIdx}`;
                return (
                  <Link
                    key={galleryId}
                    href={`/gallery/image/${galleryId}`}
                    className="group relative aspect-square rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md"
                    title={img.museumDescription || img.museum_description || img.description || img.bookTitle || img.book_title}
                  >
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={img.description || img.bookTitle || img.book_title || 'Illustration'}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(min-width: 1024px) 160px, (min-width: 640px) 140px, 120px"
                      />
                    ) : (
                      <div className="w-full h-full bg-cream flex items-center justify-center">
                        <Images className="w-6 h-6 text-muted" />
                      </div>
                    )}
                    {img.type && (
                      <span className="absolute bottom-1.5 left-1.5 text-[10px] bg-dark/70 text-white px-1.5 py-0.5 rounded capitalize leading-none">
                        {img.type}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Books Header */}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl sm:text-3xl text-primary font-display">All Books</h2>
            <p className="text-sm text-muted mt-1">
              {total.toLocaleString()} {langName} texts
            </p>
          </div>

          <CollectionFilters
            collectionId={code}
            languages={[]}
            basePath={basePath}
            showSearch
          />
        </div>

        {/* Books Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {books.map((book, i) => (
            <CollectionBookCard
              key={book.id}
              book={{
                bookId: book.id,
                id: book.id,
                slug: book.slug,
                title: bookTitle(book),
                author: book.author || '',
                year: book.year || 0,
                pages_count: book.pages_count,
                pages_ocr: book.pages_ocr,
                pages_translated: book.pages_translated,
                thumbnail: book.thumbnail || book.thumbnail_blob || book.photo,
                thumbnail_blob: book.thumbnail_blob,
                language: book.language,
                published: book.published,
                is_first_translation: book.is_first_translation,
                translation_percent: book.pages_ocr && book.pages_translated
                  ? Math.round((book.pages_translated / book.pages_ocr) * 100)
                  : 0,
              }}
              priority={i < 10}
            />
          ))}
        </div>

        {/* Empty state */}
        {books.length === 0 && (
          <div className="text-center py-16">
            <BookOpen className="w-12 h-12 text-muted mx-auto mb-4" />
            <p className="text-lg text-secondary">No books found matching your search.</p>
            <Link href={basePath} className="text-sm text-accent-rust hover:underline mt-2 inline-block">
              Clear search
            </Link>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-10 text-sm">
            {offset > 0 ? (
              <Link
                href={`${basePath}?sort=${sort}${q ? `&q=${encodeURIComponent(q)}` : ''}&offset=${Math.max(0, offset - PER_PAGE)}`}
                className="px-4 py-2 rounded-lg border border-border-light hover:bg-warm transition-colors"
              >
                Previous
              </Link>
            ) : (
              <span className="px-4 py-2 rounded-lg border border-border-light opacity-30">Previous</span>
            )}
            <span className="text-muted">Page {currentPage} of {totalPages}</span>
            {currentPage < totalPages ? (
              <Link
                href={`${basePath}?sort=${sort}${q ? `&q=${encodeURIComponent(q)}` : ''}&offset=${offset + PER_PAGE}`}
                className="px-4 py-2 rounded-lg border border-border-light hover:bg-warm transition-colors"
              >
                Next
              </Link>
            ) : (
              <span className="px-4 py-2 rounded-lg border border-border-light opacity-30">Next</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
