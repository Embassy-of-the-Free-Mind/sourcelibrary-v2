import { Metadata } from 'next';
import { getReadDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';
import { browseBooks, getLanguageCounts } from '@/lib/books-catalog';
import { notFound } from 'next/navigation';
import { getPartnerBySlug, getAllPartnerSlugs } from '@/lib/library-partners';
import SharedLibraryView, { PER_PAGE, type SharedLibraryViewProps } from '@/components/libraries/SharedLibraryView';

const PER_PAGE_LOCAL = PER_PAGE;

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

// ---------- Data fetching ----------

async function fetchLibraryData(
  providerKey: string,
  sort: string,
  language: string,
  offset: number,
  q?: string
): Promise<Pick<SharedLibraryViewProps, 'books' | 'total' | 'topBooks' | 'languages' | 'galleryImages' | 'contributingLibraries'>> {
  const [booksResult, languages, sampleResult] = await Promise.all([
    browseBooks({
      provider: providerKey,
      language: language || undefined,
      hasTranslation: true,
      search: q && q.length >= 2 ? q : undefined,
      sort: (sort as 'popular' | 'title' | 'year_asc' | 'year_desc' | 'recent') || 'popular',
      offset,
      limit: PER_PAGE_LOCAL,
    }),
    getLanguageCounts({ provider: providerKey }),
    browseBooks({ provider: providerKey, hasTranslation: true, sort: 'popular', limit: 50 }),
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
    books: booksResult.books as SharedLibraryViewProps['books'],
    total: booksResult.total,
    topBooks: sampleResult.books.slice(0, 5) as SharedLibraryViewProps['topBooks'],
    languages: languages as SharedLibraryViewProps['languages'],
    galleryImages: galleryImages as SharedLibraryViewProps['galleryImages'],
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
  const view = typeof sp.view === 'string' ? sp.view : '';

  const isBph = partner.providerKey === 'bph';

  // Fetch data — catalog data only for BPH
  const [libraryData, digitizedUbns, catalogTotal] = await Promise.all([
    fetchLibraryData(partner.providerKey, sort, language, offset, q || undefined),
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

  return <SharedLibraryView {...viewProps} />;
}
