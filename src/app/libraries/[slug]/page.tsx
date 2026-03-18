import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, ExternalLink, Images, ArrowLeft, Library } from 'lucide-react';
import { getDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import { getPartnerBySlug, getAllPartnerSlugs } from '@/lib/library-partners';
import CollectionBookCard from '@/components/CollectionBookCard';
import CollectionFilters from '@/components/collections/CollectionFilters';

const PER_PAGE = 60;

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// ---------- Static params ----------

export async function generateStaticParams() {
  return getAllPartnerSlugs().map(slug => ({ slug }));
}

// ---------- Metadata ----------

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const partner = getPartnerBySlug(slug);

  if (!partner) {
    return { title: 'Library Not Found - Source Library' };
  }

  const description = `Browse books digitized by ${partner.name} on Source Library. ${partner.description.slice(0, 120)}...`;

  return {
    title: `${partner.name} - Source Library`,
    description,
    alternates: { canonical: `/libraries/${slug}` },
    openGraph: {
      title: `${partner.name} - Source Library`,
      description,
      type: 'website',
    },
  };
}

// ---------- Helpers ----------

function bookTitle(book: { display_title?: string; title: string }): string {
  const dt = book.display_title;
  return (dt && dt !== 'None') ? dt : book.title;
}

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
}

// ---------- Data fetching ----------

async function fetchLibraryData(providerKey: string, sort: string, language: string, offset: number, q?: string) {
  const db = await getDb();

  const filter: Record<string, unknown> = {
    'image_source.provider': providerKey,
    status: { $ne: 'deleted' },
    hidden: { $ne: true },
    pages_count: { $gt: 0 },
    pages_translated: { $gt: 0 },
  };
  if (language) filter.language = language;
  if (q && q.length >= 2) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = { $regex: escaped, $options: 'i' };
    filter.$or = [{ title: regex }, { display_title: regex }, { author: regex }];
  }

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    year_asc: { year: 1, title: 1 },
    year_desc: { year: -1, title: 1 },
    title: { title: 1 },
    recent: { created_at: -1 },
    popular: { read_count: -1, title: 1 },
  };
  const sortObj = sortMap[sort] || sortMap.popular;

  const projection = {
    _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1,
    language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
    photo: 1, thumbnail: 1, thumbnail_blob: 1, published: 1, read_count: 1,
  };

  // Get all unique languages for this provider (unfiltered by language/search, but exclude hidden)
  const langFilter = {
    'image_source.provider': providerKey,
    status: { $ne: 'deleted' },
    hidden: { $ne: true },
    pages_count: { $gt: 0 },
    pages_translated: { $gt: 0 },
  };

  // Get a sample of book IDs for gallery image lookup
  const sampleBookIds = await db.collection('books')
    .find(langFilter, { projection: { _id: 0, id: 1 } })
    .sort({ read_count: -1 })
    .limit(50)
    .toArray()
    .then(docs => docs.map(d => d.id as string));

  const [books, total, langAgg, galleryImages] = await Promise.all([
    db.collection('books')
      .find(filter, { projection })
      .sort(sortObj)
      .skip(offset)
      .limit(PER_PAGE)
      .toArray(),
    db.collection('books').countDocuments(filter),
    db.collection('books').aggregate([
      { $match: langFilter },
      { $group: { _id: '$language', count: { $sum: 1 } } },
      { $match: { _id: { $ne: null } } },
      { $sort: { count: -1 } },
    ]).toArray(),
    sampleBookIds.length > 0
      ? db.collection('gallery_images').aggregate([
          { $match: {
            book_id: { $in: sampleBookIds },
            gallery_quality: { $gte: 0.7 },
            book_hidden: { $ne: true },
            type: { $nin: ['decorative', 'symbol', 'musical_score', 'exlibris', 'bookplate'] },
          }},
          { $sort: { gallery_quality: -1 } },
          // Limit to 2 per book for diversity
          { $group: {
            _id: '$book_id',
            images: { $push: '$$ROOT' },
          }},
          { $project: { images: { $slice: ['$images', 2] } } },
          { $unwind: '$images' },
          { $replaceRoot: { newRoot: '$images' } },
          { $sort: { gallery_quality: -1 } },
          { $limit: 12 },
        ]).toArray().catch(() => [])
      : Promise.resolve([]),
  ]);

  const languages = langAgg.map(l => ({ lang: l._id as string, count: l.count as number }));

  // Aggregate contributing libraries (for providers like IA that track this)
  const contributorsAgg = await db.collection('books').aggregate([
    { $match: { ...langFilter, 'image_source.contributing_library': { $exists: true, $ne: null } } },
    { $group: { _id: '$image_source.contributing_library', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]).toArray().catch(() => []);

  const contributingLibraries = contributorsAgg.map(c => ({
    name: c._id as string,
    count: c.count as number,
  }));

  return {
    books: books as unknown as BookItem[],
    total,
    languages,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    galleryImages: galleryImages as any[],
    contributingLibraries,
  };
}

// ---------- Page ----------

export default async function LibraryDetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const partner = getPartnerBySlug(slug);
  if (!partner) notFound();

  const sp = await searchParams;
  const sort = (typeof sp.sort === 'string' ? sp.sort : '') || 'popular';
  const language = typeof sp.language === 'string' ? sp.language : '';
  const q = typeof sp.q === 'string' ? sp.q : '';
  const offset = parseInt(typeof sp.offset === 'string' ? sp.offset : '0') || 0;

  const { books, total, languages, galleryImages, contributingLibraries } = await fetchLibraryData(
    partner.providerKey, sort, language, offset, q || undefined
  );

  const totalPages = Math.ceil(total / PER_PAGE);
  const currentPage = Math.floor(offset / PER_PAGE) + 1;
  const filteredLanguages = languages.filter(l => l.count > 2);
  const basePath = `/libraries/${slug}`;

  return (
    <div className="min-h-screen bg-cream">
      {/* Hero Section */}
      <div className="relative bg-dark overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-transparent" />

        <div className="relative max-w-7xl mx-auto px-6 pt-8 pb-12 sm:pb-16">
          <Link
            href="/libraries"
            className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Libraries
          </Link>

          <h1
            className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3 font-display"
          >
            {partner.name}
          </h1>

          <p className="text-lg text-white/70 max-w-3xl leading-relaxed mb-4">
            {partner.description}
          </p>

          <div className="flex flex-wrap items-center gap-4 text-sm text-white/50">
            <span>{total.toLocaleString()} books</span>
            {languages.length > 0 && (
              <>
                <span className="w-px h-4 bg-white/20" />
                <span>{languages.slice(0, 5).map(l => l.lang).join(', ')}</span>
              </>
            )}
            <span className="w-px h-4 bg-white/20" />
            <a
              href={partner.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-white/50 hover:text-white/80 transition-colors"
            >
              {partner.url.replace('https://', '')}
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>

      {/* Gallery Grid */}
      {galleryImages.length > 0 && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-7xl mx-auto px-6 py-6">
            <h2
              className="text-xl sm:text-2xl text-primary mb-4 font-display"
            >
              Illustrations
            </h2>
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

      {/* Contributing Libraries (for IA and similar aggregators) */}
      {contributingLibraries.length > 0 && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-7xl mx-auto px-6 py-6">
            <div className="flex items-center gap-2 mb-4">
              <Library className="w-5 h-5 text-accent-rust" />
              <h2
                className="text-xl sm:text-2xl text-primary font-display"
              >
                Contributing Libraries
              </h2>
            </div>
            <p className="text-sm text-muted mb-4">
              These institutions provided the physical books digitized through {partner.name}.
            </p>
            <div className="flex flex-wrap gap-2">
              {contributingLibraries.map((lib) => (
                <span
                  key={lib.name}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-border-light rounded-full text-secondary"
                >
                  {lib.name}
                  <span className="text-xs text-muted">({lib.count})</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* All Books Header */}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h2
              className="text-2xl sm:text-3xl text-primary font-display"
            >
              All Books
            </h2>
            <p className="text-sm text-muted mt-1">
              {total.toLocaleString()} books from {partner.name}
            </p>
          </div>

          <CollectionFilters
            collectionId={slug}
            languages={filteredLanguages}
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
            <p className="text-lg text-secondary">No books found matching your filters.</p>
            <Link
              href={basePath}
              className="text-sm text-accent-rust hover:underline mt-2 inline-block"
            >
              Clear filters
            </Link>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-10 text-sm">
            {offset > 0 ? (
              <Link
                href={`${basePath}?sort=${sort}${language ? `&language=${language}` : ''}&offset=${Math.max(0, offset - PER_PAGE)}`}
                className="px-4 py-2 rounded-lg border border-border-light hover:bg-warm transition-colors"
              >
                Previous
              </Link>
            ) : (
              <span className="px-4 py-2 rounded-lg border border-border-light opacity-30">
                Previous
              </span>
            )}
            <span className="text-muted">
              Page {currentPage} of {totalPages}
            </span>
            {currentPage < totalPages ? (
              <Link
                href={`${basePath}?sort=${sort}${language ? `&language=${language}` : ''}&offset=${offset + PER_PAGE}`}
                className="px-4 py-2 rounded-lg border border-border-light hover:bg-warm transition-colors"
              >
                Next
              </Link>
            ) : (
              <span className="px-4 py-2 rounded-lg border border-border-light opacity-30">
                Next
              </span>
            )}
          </div>
        )}

        {/* Attribution */}
        <div className="mt-16 pt-8 border-t border-border-light">
          <p className="text-sm text-muted leading-relaxed max-w-3xl">
            All book images and metadata are sourced from{' '}
            <a
              href={partner.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-rust hover:underline"
            >
              {partner.name}
            </a>
            . Original provenance is preserved for every page. Source Library provides OCR transcription, translation, and indexing as a scholarly service.
          </p>
        </div>
      </div>
    </div>
  );
}
