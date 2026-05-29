import Link from 'next/link';
import Image from 'next/image';
import { BookMarked } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getReadDb } from '@/lib/mongodb';
import IndexCatalogSection from './IndexCatalogSection';

/**
 * The Index catalogue browser, mounted on a collection page that has catalog
 * editions (index_catalogs.collection_slug === the collection). Two halves:
 *   1. "The printed editions" — the actual scanned Index volumes we hold, each
 *      linking to the book so a reader meets the primary source itself.
 *   2. <IndexCatalogSection> — the searchable, per-edition, held-filtered
 *      browser of all entries, each linking to the exact scanned folio.
 *
 * Self-gating: returns null for collections with no catalog editions, so it's
 * safe to render unconditionally on every collection page.
 */
export default async function IndexCatalogBrowser({ collectionSlug }: { collectionSlug: string }) {
  const { data: editionsRaw } = await supabase
    .from('index_catalogs')
    .select('id, name, short_name, start_year, entry_count, source_url')
    .eq('collection_slug', collectionSlug)
    .order('start_year', { ascending: true });
  const editions = editionsRaw || [];
  if (!editions.length) return null;

  const slugFor = (e: { source_url: string | null }) =>
    (e.source_url || '').split('/book/')[1]?.replace(/\/$/, '') || null;

  // Per-edition held count + scanned-volume thumbnails, in parallel.
  const [heldCounts, books] = await Promise.all([
    Promise.all(editions.map(async (e) => {
      const { count } = await supabase
        .from('index_catalog_entries')
        .select('id', { count: 'exact', head: true })
        .eq('index_id', e.id)
        .not('sl_book_id', 'is', null);
      return count ?? 0;
    })),
    (async () => {
      const slugs = editions.map(slugFor).filter((s): s is string => !!s);
      const db = await getReadDb();
      const rows = await db.collection('books')
        .find({ slug: { $in: slugs } }, { projection: { _id: 0, slug: 1, thumbnail: 1, image_thumb: 1, title: 1 } })
        .toArray();
      return new Map(rows.map((b) => [b.slug as string, b]));
    })(),
  ]);

  const totalEntries = editions.reduce((s, e) => s + (e.entry_count || 0), 0);
  const totalHeld = heldCounts.reduce((s, n) => s + n, 0);

  const catalogs = editions.map((e, i) => ({
    indexId: e.id,
    indexName: e.short_name || e.name,
    startYear: e.start_year,
    totalEntries: e.entry_count || 0,
    heldCount: heldCounts[i],
  }));

  return (
    <section className="mt-16 border-t border-stone-200 pt-12">
      <div className="flex items-center gap-2 text-stone-900">
        <BookMarked className="w-5 h-5" />
        <h2 className="font-display text-2xl">The Index itself</h2>
      </div>
      <p className="mt-2 max-w-2xl text-stone-600 text-sm leading-relaxed">
        We scanned {editions.length} printed editions of the <em>Index Librorum Prohibitorum</em> and read them
        cover to cover — <strong>{totalEntries.toLocaleString()}</strong> condemnations in all, of which{' '}
        <strong>{totalHeld.toLocaleString()}</strong> link to a banned book you can read here. Open any edition to
        see the bans as they were printed; search below to trace a work or author across the editions.
      </p>

      {/* The printed editions — the primary sources themselves */}
      <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        {editions.map((e) => {
          const slug = slugFor(e);
          const b = slug ? books.get(slug) : null;
          const thumb = (b?.thumbnail || b?.image_thumb) as string | undefined;
          if (!slug) return null;
          return (
            <Link
              key={e.id}
              href={`/book/${slug}`}
              className="group flex flex-col rounded-md border border-stone-200 bg-stone-50 overflow-hidden hover:border-stone-400 transition-colors"
              title={`Open the ${e.start_year} edition`}
            >
              <div className="relative aspect-[3/4] bg-stone-200">
                {thumb && (
                  <Image src={thumb} alt={`${e.start_year} Index, scanned`} fill sizes="160px"
                    className="object-cover group-hover:opacity-90" />
                )}
              </div>
              <div className="px-2 py-2">
                <div className="font-display text-stone-900 text-sm leading-tight">{e.start_year}</div>
                <div className="text-[11px] text-stone-500 leading-tight">{e.short_name || e.name}</div>
                <div className="text-[11px] text-stone-400 mt-0.5">{(e.entry_count || 0).toLocaleString()} entries</div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Searchable browser over all entries */}
      <div className="mt-12">
        <IndexCatalogSection catalogs={catalogs} />
      </div>
    </section>
  );
}
