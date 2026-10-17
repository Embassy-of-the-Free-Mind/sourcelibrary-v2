import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import SiteHeader from '@/components/layout/SiteHeader';
import CatalogExplorer, { type CatalogRow } from '@/components/catalog/explorer/CatalogExplorer';
import type { BandStats } from '@/components/catalog/explorer/StatsBand';
import { browseCatalog, catalogStats } from '@/lib/catalog/query';
import { catalogFiltersOf, parseCatalogState } from '@/lib/catalog/filters';
import { isSingleRealLanguage } from '@/lib/language-canonical';
import { LIBRARY_CATEGORIES } from '@/app/api/categories/route';
import { getReadDb } from '@/lib/mongodb';

export const revalidate = 86400;
export const maxDuration = 30;

export const metadata: Metadata = {
  title: 'Catalogue - Source Library',
  description: 'Search and browse the complete Source Library catalogue: thousands of translated primary sources in alchemy, philosophy, theology, and the esoteric traditions. Ask the librarian in your own words.',
  alternates: { canonical: '/catalog' },
};

async function getCollections(): Promise<{ value: string; label: string }[]> {
  try {
    const db = await getReadDb();
    const rows = await db.collection('collections')
      .find({ hidden: { $ne: true }, name: { $type: 'string' }, book_count: { $gt: 0 } }, { projection: { _id: 0, slug: 1, name: 1 } })
      .sort({ name: 1 }).limit(1000).toArray();
    return rows.map((r) => ({ value: r.slug as string, label: r.name as string })).filter((r) => r.value && r.label);
  } catch {
    return [];
  }
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) for (const one of [v].flat()) if (one != null) sp.append(k, one);
  const state = parseCatalogState(sp);
  const filters = catalogFiltersOf(state);
  // An asked topic is answered in the browser (it is a full-text search of
  // several seconds); everything else renders here.
  const listed = !state.topic;

  const [list, stats, library, collections] = await Promise.all([
    listed
      ? browseCatalog(filters, state.sort, 1, 48).catch((err) => {
        console.error('[catalog] list failed:', err?.message || err);
        return { books: [], total: 0 };
      })
      : Promise.resolve({ books: [], total: 0 }),
    listed ? catalogStats(filters).catch(() => null) : Promise.resolve(null),
    catalogStats({}).catch(() => null),
    getCollections(),
  ]);

  // The reader's vocabulary: every single real language the catalogue holds
  // (largest first), the curated subjects, the collections.
  const languages = (library?.languages ?? []).map((l) => l.value).filter((l) => isSingleRealLanguage(l));
  const categories = LIBRARY_CATEGORIES.map((c) => ({ value: c.id, label: c.name }));
  const collectionName = state.collection ? collections.find((c) => c.value === state.collection)?.label : null;

  return (
    <>
      <SiteHeader variant="dark" />
      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 md:px-12 pt-10 md:pt-11 pb-12">
        {state.collection && (
          <Link href={`/collections/${state.collection}`} className="inline-flex items-center gap-1 text-sm text-accent-rust hover:opacity-70 transition-opacity mb-4">
            <ArrowLeft className="w-4 h-4" /> Back to {collectionName || state.collection}
          </Link>
        )}
        <h1 className="text-3xl md:text-4xl font-display mb-[26px] text-primary">The Library</h1>
        <CatalogExplorer
          initialState={state}
          initialBooks={list.books as unknown as CatalogRow[]}
          initialTotal={list.total}
          initialStats={(stats as BandStats | null) ?? null}
          libraryTotal={library?.total ?? list.total}
          vocab={{ languages, pillLanguages: languages.slice(0, 14), categories, collections }}
        />
      </div>
    </>
  );
}
