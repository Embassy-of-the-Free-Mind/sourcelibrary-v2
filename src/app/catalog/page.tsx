import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import CatalogBrowser from '@/components/catalog/CatalogBrowser';
import { browseBooks, getCatalogFacets } from '@/lib/books-catalog';
import { getReadDb } from '@/lib/mongodb';
import { LIBRARY_CATEGORIES } from '@/app/api/categories/route';
import { LIBRARY_PARTNERS } from '@/lib/library-partners';

export const revalidate = 86400;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'The Library - Source Library',
  description: 'Every book in the Source Library — thousands of translated primary sources in alchemy, philosophy, theology, and the esoteric traditions, with filters for language, subject, date and more.',
  alternates: { canonical: '/catalog' },
};

/**
 * Nothing on this page catches its own data errors.
 *
 * `revalidate = 86400` means one bad render is cached as the truth for a day:
 * an empty grid under a headline of 22,081, or a Collection facet with nothing
 * in it, both of which look like the catalogue rather than like a failure. A
 * throw is the safe direction — ISR keeps serving the last good page through a
 * failed revalidation, and `src/app/error.tsx` covers a cold one. This is the
 * pattern that froze /explore/timeline and /explore/map (#2973, #2974); see
 * CLAUDE.md, Development Workflow.
 */

async function getCollectionName(slug: string): Promise<string | null> {
  const db = await getReadDb();
  const c = await db.collection('collections').findOne(
    { slug },
    { projection: { name: 1 }, maxTimeMS: 8000 },
  );
  return (c?.name as string) || null;
}

/** slug → display name for every collection worth filtering by. */
async function getCollectionNames(): Promise<Record<string, string>> {
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
}

export default async function CatalogPage(
  { searchParams }: { searchParams: Promise<{ collection?: string }> },
) {
  const { collection } = await searchParams;

  const [browseResult, facets, collectionName, collectionNames] = await Promise.all([
    browseBooks({ sort: 'popular', limit: 60, collection }),
    // One sweep feeds every facet.
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
        facets={facets}
        collectionNames={collectionNames}
        categoryNames={categoryNames}
        providerNames={providerNames}
        collection={collection}
        collectionName={collectionName}
      />
    </div>
  );
}
