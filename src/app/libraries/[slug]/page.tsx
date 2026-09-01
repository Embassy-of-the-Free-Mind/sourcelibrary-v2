import { Metadata } from 'next';
import { getReadDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';
import { browseBooks, getLanguageCounts } from '@/lib/books-catalog';
import { notFound } from 'next/navigation';
import { getPartnerBySlug, getProviderKeys } from '@/lib/library-partners';
import SharedLibraryView, { type SharedLibraryViewProps } from '@/components/libraries/SharedLibraryView';
import LibrarySchema from '@/components/seo/LibrarySchema';

// Must be a plain server-side constant. Importing PER_PAGE from the (client)
// SharedLibraryView gave the server a client-reference STUB (a function), so
// `limit` became a function → range(0, NaN) → empty grid. This was the whole
// "library pages show no books" bug.
const PER_PAGE_LOCAL = 60;

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function sanitizeGalleryImageDoc(doc: Record<string, unknown>): Record<string, unknown> {
  return {
    id: toStringOrUndefined(doc.id),
    pageId: toStringOrUndefined(doc.pageId),
    page_id: toStringOrUndefined(doc.page_id),
    detectionIndex: toNumberOrUndefined(doc.detectionIndex),
    detection_index: toNumberOrUndefined(doc.detection_index),
    thumbnailUrl: toStringOrUndefined(doc.thumbnailUrl),
    thumbnail_url: toStringOrUndefined(doc.thumbnail_url),
    extractedUrl: toStringOrUndefined(doc.extractedUrl),
    extracted_url: toStringOrUndefined(doc.extracted_url),
    imageUrl: toStringOrUndefined(doc.imageUrl),
    image_url: toStringOrUndefined(doc.image_url),
    museumDescription: toStringOrUndefined(doc.museumDescription),
    museum_description: toStringOrUndefined(doc.museum_description),
    description: toStringOrUndefined(doc.description),
    bookTitle: toStringOrUndefined(doc.bookTitle),
    book_title: toStringOrUndefined(doc.book_title),
    type: toStringOrUndefined(doc.type),
  };
}

// ---------- Static params ----------

// This page reads searchParams (sort / language / offset / search), so render it
// per request rather than pre-baking it statically.
export const dynamic = 'force-dynamic';

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
      // Defining openGraph replaces the root layout's block wholesale, so an
      // explicit image is required or the page ships no og:image at all.
      images: [{
        url: partner.heroImageOverride || 'https://sourcelibrary.org/og-image.jpg',
        alt: `${partner.name} — Source Library`,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      images: [{
        url: partner.heroImageOverride || 'https://sourcelibrary.org/og-image.jpg',
        alt: `${partner.name} — Source Library`,
      }],
    },
  };
}

// ---------- Data fetching ----------

async function fetchLibraryData(
  // All provider keys for the partner — canonical + aliases (ndl/ndl_japan,
  // mdz/bsb). Single-element for most partners.
  providerKeys: string[],
  sort: string,
  language: string,
  offset: number,
  q?: string
): Promise<Pick<SharedLibraryViewProps, 'books' | 'total' | 'topBooks' | 'languages' | 'galleryImages' | 'contributingLibraries'>> {
  const providerKey = providerKeys.length === 1 ? providerKeys[0] : providerKeys;
  // Every query is independently guarded: one slow/failing catalog call must
  // degrade its own slice, never 500 the whole page.
  const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); } catch { return fallback; }
  };
  type BrowseResult = Awaited<ReturnType<typeof browseBooks>>;
  const emptyResult: BrowseResult = { books: [], total: 0 };
  const chosenSort = (sort as 'popular' | 'title' | 'year_asc' | 'year_desc' | 'recent') || 'popular';
  // Show ALL of the library's holdings (not only translated ones — that hid
  // every book for untranslated collections). Query with the default
  // pages_count>0 first (fast + safe, even over huge providers); only if that
  // yields NOTHING (e.g. an art-only provider like the Met, whose single-object
  // items have pages_count:0) fall back to including page-less artworks. Never
  // exactCount (it times out over big providers and empties the page).
  const fetchGrid = async (): Promise<BrowseResult> => {
    const paged = await safe(() => browseBooks({
      provider: providerKey,
      language: language || undefined,
      search: q && q.length >= 2 ? q : undefined,
      sort: chosenSort,
      offset,
      limit: PER_PAGE_LOCAL,
    }), emptyResult);
    if (paged.books.length > 0) return paged;
    return safe(() => browseBooks({
      provider: providerKey,
      language: language || undefined,
      search: q && q.length >= 2 ? q : undefined,
      sort: chosenSort,
      offset,
      limit: PER_PAGE_LOCAL,
      hasPages: false,
    }), paged);
  };
  const fetchSample = async (): Promise<BrowseResult> => {
    const paged = await safe(() => browseBooks({ provider: providerKey, sort: 'popular', limit: 50 }), emptyResult);
    if (paged.books.length > 0) return paged;
    return safe(() => browseBooks({ provider: providerKey, sort: 'popular', limit: 50, hasPages: false }), paged);
  };
  // The grid query is the critical one — run it FIRST and alone. The aux queries
  // (especially getLanguageCounts, which scans every row for the provider) are
  // heavy enough that running them concurrently starved/timed-out the grid query
  // and emptied the page. Books first, then the supporting data.
  const booksResult = await fetchGrid();
  const [languages, sampleResult] = await Promise.all([
    safe(() => getLanguageCounts({ provider: providerKey }), [] as Array<{ lang: string; count: number }>),
    fetchSample(),
  ]);

  const sampleBookIds = sampleResult.books.map(b => b.id);

  let galleryImages: unknown[] = [];
  if (sampleBookIds.length > 0) {
    try {
      const db = await getReadDb();
      galleryImages = await db.collection('gallery_images').aggregate([
        {
          $match: {
            book_id: { $in: sampleBookIds },
            gallery_quality: { $gte: 0.7 },
            book_visible: true,
            type: { $nin: ['decorative', 'symbol', 'musical_score', 'exlibris', 'bookplate'] },
          }
        },
        { $sort: { gallery_quality: -1 } },
        { $group: { _id: '$book_id', images: { $push: '$$ROOT' } } },
        { $project: { images: { $slice: ['$images', 2] } } },
        { $unwind: '$images' },
        { $replaceRoot: { newRoot: '$images' } },
        { $sort: { gallery_quality: -1 } },
        { $limit: 12 },
      ], { maxTimeMS: 15_000 }).toArray();
    } catch { /* Gallery is optional */ }
  }

  const sanitizedGalleryImages = galleryImages
    .filter((img): img is Record<string, unknown> => !!img && typeof img === 'object')
    .map((img) => sanitizeGalleryImageDoc(img));

  const contribData = await safe(async () => {
    const { data } = await supabase
      .from('books_catalog')
      .select('contributing_library')
      .eq('visible', true)
      .in('image_source_provider', providerKeys)
      .gt('pages_count', 0)
      .gt('pages_translated', 0)
      .not('contributing_library', 'is', null);
    return data;
  }, null as { contributing_library: string | null }[] | null);

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
    books: booksResult.books as SharedLibraryViewProps['books'],
    total: booksResult.total,
    topBooks: sampleResult.books.slice(0, 5) as SharedLibraryViewProps['topBooks'],
    languages: languages as SharedLibraryViewProps['languages'],
    galleryImages: sanitizedGalleryImages as SharedLibraryViewProps['galleryImages'],
    contributingLibraries,
  };
}

/** Build a UBN → { id, slug } map for BPH books on Source Library */
async function fetchBphDigitizedMap(): Promise<Record<string, { id: string; slug: string }>> {
  try {
    const db = await getReadDb();
    const bphBooks = await db.collection('books').find(
      { 'image_source.provider': 'bph', 'dublin_core.dc_identifier': { $exists: true } },
      { projection: { id: 1, slug: 1, 'dublin_core.dc_identifier': 1 }, maxTimeMS: 15_000 }
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
  const rawView = typeof sp.view === 'string' ? sp.view : '';
  const view = rawView === 'catalogue' ? 'catalog' : rawView;

  const isBph = partner.providerKey === 'bph';

  // Fetch data — catalog data only for BPH
  const [libraryData, digitizedUbns, catalogTotal] = await Promise.all([
    fetchLibraryData(getProviderKeys(partner), sort, language, offset, q || undefined),
    isBph ? fetchBphDigitizedMap() : Promise.resolve({}),
    isBph ? fetchBphCatalogTotal() : Promise.resolve(0),
  ]);

  const { books, total, topBooks, languages, galleryImages, contributingLibraries } = libraryData;
  const basePath = `/libraries/${slug}`;

  const viewProps: SharedLibraryViewProps = {
    partner: {
      name: partner.name,
      description: partner.description,
      url: partner.url,
      providerKey: partner.providerKey,
      slug: partner.slug,
    },
    books,
    total,
    topBooks,
    languages,
    galleryImages,
    contributingLibraries,
    basePath,
    sort,
    language,
    q,
    offset,
    view,
    isBph,
    digitizedUbns,
    catalogTotal,
  };

  return (
    <>
      <LibrarySchema
        slug={slug}
        name={partner.name}
        description={partner.description}
        url={partner.url}
        bookCount={total}
      />
      <SharedLibraryView {...viewProps} />
    </>
  );
}
