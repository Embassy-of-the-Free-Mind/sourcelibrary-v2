import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, ExternalLink, Images, Library } from 'lucide-react';
import SiteHeader from '@/components/layout/SiteHeader';
import { getDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';
import { browseBooks, getLanguageCounts } from '@/lib/books-catalog';
import { notFound } from 'next/navigation';
import { getPartnerBySlug, getAllPartnerSlugs } from '@/lib/library-partners';
import CollectionBookCard from '@/components/CollectionBookCard';
import CollectionFilters from '@/components/collections/CollectionFilters';
import { bookTitle } from '@/lib/collections-utils';
import LibraryViewTabs from '@/components/libraries/LibraryViewTabs';
import BphCatalogBrowser from '@/components/libraries/BphCatalogBrowser';

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
  let partner: ReturnType<typeof getPartnerBySlug>;
  try {
    partner = getPartnerBySlug(slug);
  } catch {
    return { title: 'Source Library', robots: { index: false, follow: false } };
  }

  if (!partner) {
    return { title: 'Library Not Found - Source Library', robots: { index: false, follow: true } };
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
  pages_blank?: number;
  photo?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  published?: string;
  read_count?: number;
}

// ---------- Data fetching ----------

async function fetchLibraryData(providerKey: string, sort: string, language: string, offset: number, q?: string) {
  // Books + languages from Supabase (instant), gallery + contributors from MongoDB
  const [booksResult, languages, sampleResult] = await Promise.all([
    browseBooks({
      provider: providerKey,
      language: language || undefined,
      hasTranslation: true,
      search: q && q.length >= 2 ? q : undefined,
      sort: (sort as 'popular' | 'title' | 'year_asc' | 'year_desc' | 'recent') || 'popular',
      offset,
      limit: PER_PAGE,
    }),
    getLanguageCounts({ provider: providerKey }),
    browseBooks({ provider: providerKey, hasTranslation: true, sort: 'popular', limit: 50 }),
  ]);

  const sampleBookIds = sampleResult.books.map(b => b.id);

  // Gallery images from MongoDB (fast, well-indexed)
  let galleryImages: unknown[] = [];
  if (sampleBookIds.length > 0) {
    try {
      const db = await getDb();
      galleryImages = await db.collection('gallery_images').aggregate([
        { $match: {
          book_id: { $in: sampleBookIds },
          gallery_quality: { $gte: 0.7 },
          book_visible: true,
          type: { $nin: ['decorative', 'symbol', 'musical_score', 'exlibris', 'bookplate'] },
        }},
        { $sort: { gallery_quality: -1 } },
        { $group: { _id: '$book_id', images: { $push: '$$ROOT' } } },
        { $project: { images: { $slice: ['$images', 2] } } },
        { $unwind: '$images' },
        { $replaceRoot: { newRoot: '$images' } },
        { $sort: { gallery_quality: -1 } },
        { $limit: 12 },
      ]).toArray();
    } catch { /* Gallery is optional */ }
  }

  // Contributing libraries from Supabase (was 5s+ MongoDB aggregation)
  const { data: contribData } = await supabase
    .from('books_catalog')
    .select('contributing_library')
    .eq('visible', true)
    .eq('image_source_provider', providerKey)
    .gt('pages_count', 0)
    .gt('pages_translated', 0)
    .not('contributing_library', 'is', null);

  const contribCounts = new Map<string, number>();
  for (const row of (contribData || [])) {
    if (row.contributing_library) {
      contribCounts.set(row.contributing_library, (contribCounts.get(row.contributing_library) || 0) + 1);
    }
  }
  const contributingLibraries = [...contribCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    books: booksResult.books as unknown as BookItem[],
    total: booksResult.total,
    topBooks: sampleResult.books.slice(0, 5) as unknown as BookItem[],
    languages,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    galleryImages: galleryImages as any[],
    contributingLibraries,
  };
}

/** Build a UBN → { id, slug } map for BPH books on Source Library */
async function fetchBphDigitizedMap(): Promise<Record<string, { id: string; slug: string }>> {
  try {
    const db = await getDb();
    const bphBooks = await db.collection('books').find(
      { 'image_source.provider': 'bph', 'dublin_core.dc_identifier': { $exists: true } },
      { projection: { id: 1, slug: 1, 'dublin_core.dc_identifier': 1 } }
    ).toArray();

    const map: Record<string, { id: string; slug: string }> = {};
    for (const b of bphBooks) {
      const ubn = b.dublin_core?.dc_identifier;
      if (ubn) {
        map[ubn] = { id: b.id, slug: b.slug || b.id };
      }
    }
    return map;
  } catch {
    return {};
  }
}

/** Get total count of BPH catalog works */
async function fetchBphCatalogTotal(): Promise<number> {
  const { count } = await supabase
    .from('bph_works')
    .select('*', { count: 'exact', head: true });
  return count || 0;
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
  const view = typeof sp.view === 'string' ? sp.view : 'books';

  const isBph = partner.providerKey === 'bph';

  // Fetch data — catalog data only for BPH
  const [libraryData, digitizedUbns, catalogTotal] = await Promise.all([
    fetchLibraryData(partner.providerKey, sort, language, offset, q || undefined),
    isBph ? fetchBphDigitizedMap() : Promise.resolve({}),
    isBph ? fetchBphCatalogTotal() : Promise.resolve(0),
  ]);

  const { books, total, topBooks, languages, galleryImages, contributingLibraries } = libraryData;

  const totalPages = Math.ceil(total / PER_PAGE);
  const currentPage = Math.floor(offset / PER_PAGE) + 1;
  const filteredLanguages = languages.filter(l => l.count > 2);
  const basePath = `/libraries/${slug}`;

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="dark" />
      {/* Hero Section */}
      <div className="relative bg-dark overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-transparent" />

        <div className="relative max-w-7xl mx-auto px-6 pt-8 pb-12 sm:pb-16">
          <h1
            className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3 font-display"
          >
            {partner.name}
          </h1>

          <p className="text-lg text-white/70 max-w-3xl leading-relaxed mb-4">
            {partner.description}
          </p>

          <div className="flex flex-wrap items-center gap-4 text-sm text-white/50">
            <span>{total.toLocaleString()} translated books</span>
            {isBph && catalogTotal > 0 && (
              <>
                <span className="w-px h-4 bg-white/20" />
                <span>{catalogTotal.toLocaleString()} works in catalog</span>
              </>
            )}
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
              {galleryImages.slice(0, 11).map((img: { pageId?: string; page_id?: string; detectionIndex?: number; detection_index?: number; thumbnailUrl?: string; thumbnail_url?: string; extractedUrl?: string; extracted_url?: string; imageUrl?: string; image_url?: string; museumDescription?: string; museum_description?: string; description?: string; bookTitle?: string; book_title?: string; type?: string }) => {
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
              <Link
                href="/gallery"
                className="group relative aspect-square rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md bg-cream flex items-center justify-center"
              >
                <div className="text-center px-2">
                  <Images className="w-6 h-6 text-muted mx-auto mb-1.5 group-hover:text-accent-rust transition-colors" />
                  <span className="text-xs text-secondary group-hover:text-accent-rust transition-colors font-medium">
                    See all illustrations
                  </span>
                </div>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Contributing Libraries (for IA and similar aggregators — hide for BPH since it IS the library) */}
      {contributingLibraries.length > 0 && !isBph && (
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
        {/* View tabs (BPH only) */}
        {isBph && (
          <LibraryViewTabs
            basePath={basePath}
            catalogTotal={catalogTotal}
            booksTotal={total}
          />
        )}

        {/* Catalog View */}
        {isBph && view === 'catalog' ? (
          <div>
            {/* Selected Books row */}
            {topBooks.length > 0 && (
              <div className="mb-10">
                <h2 className="text-2xl sm:text-3xl text-primary font-display mb-1">
                  Selected Books
                </h2>
                <p className="text-sm text-muted mb-4">
                  {total.toLocaleString()} books from the BPH collection translated on Source Library.
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                  {topBooks.map((book, i) => (
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
                          ? Math.round((book.pages_translated / Math.max((book.pages_ocr || 0) - (book.pages_blank || 0), 1)) * 100)
                          : 0,
                      }}
                      priority={i < 5}
                    />
                  ))}
                  <Link
                    href={basePath}
                    className="group flex flex-col items-center justify-center rounded-lg border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md bg-cream aspect-[2/3] min-h-[180px]"
                  >
                    <BookOpen className="w-6 h-6 text-muted mb-2 group-hover:text-accent-rust transition-colors" />
                    <span className="text-sm text-secondary group-hover:text-accent-rust transition-colors font-medium text-center px-3">
                      See all books
                    </span>
                  </Link>
                </div>
              </div>
            )}

            <div className="mb-6">
              <h2 className="text-2xl sm:text-3xl text-primary font-display">
                Library Catalog
              </h2>
              <p className="text-sm text-muted mt-1">
                Complete catalog of the Bibliotheca Philosophica Hermetica — {catalogTotal.toLocaleString()} works in the collection.
                Works available on Source Library are marked with a book icon.
              </p>
            </div>
            <BphCatalogBrowser
              basePath={basePath}
              digitizedUbns={digitizedUbns}
            />
          </div>
        ) : (
          <>
            {/* All Books Header */}
            <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
              <div>
                <h2
                  className="text-2xl sm:text-3xl text-primary font-display"
                >
                  {isBph ? 'Translated Books' : 'All Books'}
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
                      ? Math.round((book.pages_translated / Math.max((book.pages_ocr || 0) - (book.pages_blank || 0), 1)) * 100)
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
          </>
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
