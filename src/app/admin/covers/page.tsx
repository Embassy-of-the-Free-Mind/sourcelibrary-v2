import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/auth-helpers';
import CoverCatalogue from './CoverCatalogue';

/**
 * /admin/covers — concept covers made from books' own scans. Admin only (the
 * admin layout gates it; the page re-checks). Deliberately not in AdminNav.
 * Concepts are never applied to a book; see /api/admin/cover-concepts.
 */
export const metadata: Metadata = { title: 'Cover concepts', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface ConceptRow { id: string; book_id: string; book_title: string; name: string; thumb: string | null; updated_at: Date; updated_by: string | null }

export default async function CoverConceptsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const initial = { q: sp.q || '', collection: sp.collection || '', language: sp.language || '', century: sp.century || '', sort: sp.sort || 'date_asc' };
  const db = await getDb();
  const concepts = await db.collection<ConceptRow>('cover_concepts')
    .find({ deleted_at: null }, { projection: { _id: 0, id: 1, book_id: 1, book_title: 1, name: 1, thumb: 1, updated_at: 1, updated_by: 1 } })
    .sort({ updated_at: -1 })
    .limit(300)
    .toArray();

  const conceptBooks: Record<string, number> = {};
  for (const c of concepts) conceptBooks[c.book_id] = (conceptBooks[c.book_id] || 0) + 1;

  return (
    <main className="max-w-[var(--container-wide)] mx-auto px-4 py-10">
      <h1 className="text-3xl font-medium mb-1">Cover concepts</h1>
      <p className="text-[var(--text-secondary)] mb-8 max-w-2xl">
        New covers made from a book&apos;s own binding, title page and plates. These are concepts only: saving one never changes the book&apos;s cover. Only admins can see this page.
      </p>

      <section className="mb-12">
        <h2 className="text-lg font-medium mb-3">Saved</h2>
        {!concepts.length && <p className="text-sm text-[var(--text-muted)]">Nothing saved yet. Choose a book below, make a cover and press Save.</p>}
        <ul className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-5">
          {concepts.map(c => (
            <li key={c.id}>
              <Link href={`/admin/covers/${c.book_id}?design=${c.id}`} className="block group">
                <div className="aspect-[2/3] bg-[var(--bg-warm)] rounded-sm overflow-hidden shadow group-hover:ring-2 ring-[var(--accent-rust)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {c.thumb && <img src={c.thumb} alt={c.name} className="w-full h-full object-cover" />}
                </div>
                <span className="block text-sm mt-2 font-medium">{c.name}</span>
                <span className="text-xs text-[var(--text-muted)] line-clamp-2">{c.book_title}</span>
                <span className="block text-xs text-[var(--text-muted)]">{new Date(c.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}{c.updated_by ? ` · ${c.updated_by.split('@')[0]}` : ''}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">Choose a book</h2>
        <CoverCatalogue initial={initial} conceptBooks={conceptBooks} />
      </section>
    </main>
  );
}
