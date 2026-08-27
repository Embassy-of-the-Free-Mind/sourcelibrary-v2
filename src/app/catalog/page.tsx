import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import CatalogBrowser from '@/components/catalog/CatalogBrowser';
import { browseBooks, getCatalogFacets, type CatalogFacets } from '@/lib/books-catalog';
import { getReadDb } from '@/lib/mongodb';
import { LIBRARY_CATEGORIES } from '@/app/api/categories/route';
import { LIBRARY_PARTNERS } from '@/lib/library-partners';

export const revalidate = 86400;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Catalogue - Source Library',
  description: 'Browse the complete Source Library catalogue — thousands of translated primary sources in alchemy, philosophy, theology, and the esoteric traditions.',
  alternates: { canonical: '/catalog' },
};

/** Every facet dimension, empty — what the page renders if Supabase is down. */
const EMPTY_FACETS: CatalogFacets = {
  total: 0,
  languages: [],
  languageCount: 0,
  categories: [],
  collections: [],
  providers: [],
  decades: [],
  yearMin: null,
  yearMax: null,
  firstTranslations: 0,
  translated: 0,
  transcribed: 0,
};

async function getCollectionName(slug: string): Promise<string | null> {
  try {
    const db = await getReadDb();
    const c = await db.collection('collections').findOne({ slug }, { projection: { name: 1 } });
    return (c?.name as string) || null;
  } catch {
    return null;
  }
}

/** slug → display name for every collection worth filtering by. */
async function getCollectionNames(): Promise<Record<string, string>> {
  try {
    const db = await getReadDb();
    const rows = await db.collection('collections')
      .find(
        { hidden: { $ne: true }, name: { $type: 'string' }, book_count: { $gt: 0 } },
        { projection: { _id: 0, slug: 1, name: 1 }, maxTimeMS: 8000 },
      )
      .sort({ name: 1 }).limit(1000).toArray();
    const out: Record<string, string> = {};
    for (const r of rows) {
      if (r.slug && r.name) out[r.slug as string] = r.name as string;
    }
    return out;
  } catch {
    return {};
  }
}

export default async function CatalogPage(
  { searchParams }: { searchParams: Promise<{ collection?: string }> },
) {
  const { collection } = await searchParams;

  const [browseResult, facets, collectionName, collectionNames] = await Promise.all([
    browseBooks({ sort: 'popular', limit: 60, collection }).catch((err) => {
      console.error('[catalog] browseBooks failed:', err?.message || err);
      return { books: [], total: 0 };
    }),
    // One sweep feeds every facet. It throws on failure rather than rendering a
    // zeroed catalogue: a fallback baked into a `revalidate = 86400` page would
    // be cached as the truth until the next deploy (CLAUDE.md, Development
    // Workflow). ISR keeps serving the last good page instead.
    getCatalogFacets({ collection }),
    collection ? getCollectionName(collection) : Promise.resolve(null),
    getCollectionNames(),
  ]);

  // The grid's first page comes from `browseBooks`, but its TOTAL comes from
  // the facet sweep: an unfiltered browse counts with PostgREST's `estimated`
  // mode (a planner guess, which read 28,559 for a corpus of 22,081), and a
  // headline number that disagrees with the facet counts underneath it is worse
  // than no number. Every later request asks for an exact count.
  const { books } = browseResult;
  const total = facets.total || browseResult.total;

  const categoryNames: Record<string, string> = {};
  for (const c of LIBRARY_CATEGORIES) categoryNames[c.id] = c.name;

  const providerNames: Record<string, string> = {};
  for (const p of Object.values(LIBRARY_PARTNERS)) providerNames[p.providerKey] = p.name;

  return (
    <div className="min-h-screen bg-cream">
      {/* Dark navbar: the catalogue opens on the same dark band as the book
          page and the collection pages it sits between. */}
      <SiteHeader variant="dark" />
      <CatalogBrowser
        initialBooks={books}
        initialTotal={total}
        facets={facets ?? EMPTY_FACETS}
        collectionNames={collectionNames}
        categoryNames={categoryNames}
        providerNames={providerNames}
        collection={collection}
        collectionName={collectionName}
      />
    </div>
  );
}
