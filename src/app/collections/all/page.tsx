import { getReadDb } from '@/lib/mongodb';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import type { Metadata } from 'next';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'All Collections | Source Library',
  description: 'Browse every collection and sub-collection in Source Library, organized by wing.',
  alternates: { canonical: '/collections/all' },
};

interface SubCollection {
  slug: string;
  name: string;
  book_count: number;
  visible: boolean;
  type?: string;
}

interface Wing {
  slug: string;
  name: string;
  book_count: number;
  children: SubCollection[];
}

async function fetchWings(): Promise<Wing[]> {
  const db = await getReadDb();

  // Get the 18 top-level wings
  const wings = await db.collection('collections').find({
    parent: { $exists: false },
    type: { $ne: 'curated' },
    collection_type: { $ne: 'visual_art' },
    visible: true,
  }).project({ slug: 1, name: 1, book_count: 1, _id: 0 }).sort({ name: 1 }).toArray();

  // Get all subcollections
  const subs = await db.collection('collections').find({
    parent: { $exists: true },
  }).project({ slug: 1, name: 1, book_count: 1, parent: 1, visible: 1, type: 1, _id: 0 }).toArray();

  // Build parent → children map
  const childMap = new Map<string, SubCollection[]>();
  for (const sub of subs) {
    const parents = Array.isArray(sub.parent) ? sub.parent : [sub.parent];
    for (const p of parents) {
      if (!childMap.has(p)) childMap.set(p, []);
      childMap.get(p)!.push({
        slug: sub.slug,
        name: sub.name || sub.slug,
        book_count: sub.book_count || 0,
        visible: sub.visible !== false,
        type: sub.type,
      });
    }
  }

  // Sort children by book count descending
  for (const kids of childMap.values()) {
    kids.sort((a, b) => b.book_count - a.book_count);
  }

  return wings.map(w => ({
    slug: w.slug,
    name: w.name,
    book_count: w.book_count || 0,
    children: childMap.get(w.slug) || [],
  }));
}

export default async function AllCollectionsPage() {
  const wings = await fetchWings();

  return (
    <ContentPageLayout
      maxWidth="wide"
      header={
        <ContentHeader
          title="All Collections"
          subtitle="Every wing and sub-collection in the library."
        />
      }
    >
      <div className="mb-4">
        <Link
          href="/collections"
          className="text-sm text-accent-rust hover:text-accent-rust/80 transition-colors"
        >
          &larr; Back to collections
        </Link>
      </div>

      <div className="grid gap-8 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {wings.map(wing => (
          <div key={wing.slug} className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            {/* Wing header */}
            <Link
              href={`/collections/${wing.slug}`}
              className="block px-5 py-4 bg-gradient-to-r from-[#2a1f17] to-[#3d2e22] hover:from-[#3d2e22] hover:to-[#4a3828] transition-colors"
            >
              <h2 className="font-serif text-lg text-white font-semibold">
                {wing.name}
              </h2>
              <p className="text-white/50 text-xs mt-0.5">
                {wing.book_count.toLocaleString()} books · {wing.children.length} sub-collections
              </p>
            </Link>

            {/* Subcollections */}
            {wing.children.length > 0 ? (
              <ul className="divide-y divide-stone-100">
                {wing.children.map(sub => (
                  <li key={sub.slug}>
                    <Link
                      href={`/collections/${sub.slug}`}
                      className={`flex items-center justify-between px-5 py-2.5 hover:bg-stone-50 transition-colors ${
                        !sub.visible ? 'opacity-40' : ''
                      }`}
                    >
                      <span className="text-sm text-stone-700 truncate pr-3">
                        {sub.name}
                        {sub.type === 'curated' && (
                          <span className="ml-1.5 text-[10px] text-accent-rust font-medium uppercase tracking-wider">
                            curated
                          </span>
                        )}
                        {!sub.visible && (
                          <span className="ml-1.5 text-[10px] text-stone-400 font-medium uppercase tracking-wider">
                            hidden
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-stone-400 tabular-nums flex-shrink-0">
                        {sub.book_count.toLocaleString()}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-stone-400 italic">No sub-collections yet</p>
            )}
          </div>
        ))}
      </div>
    </ContentPageLayout>
  );
}
