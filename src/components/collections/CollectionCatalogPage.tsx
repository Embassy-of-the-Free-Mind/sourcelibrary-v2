import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import SiteHeader from '@/components/layout/SiteHeader';
import BrowsePager, { browsePageHref } from '@/components/browse/BrowsePager';
import { browseBooks } from '@/lib/books-catalog';
import { getReadDb } from '@/lib/mongodb';

// PRIOR ART: src/components/collections/CollectionAllBooks.tsx — the full book
// list on a collection page, but client-rendered, so crawlers see only the ~25
// highlighted books (natural-philosophy linked 29 of 5,103 on 2026-10-04,
// #2266). This is the server-rendered, link-only twin: one plain <a> per book,
// paginated with real hrefs, for search engines and for readers who want the
// whole shelf as a list.

// A single Supabase response is capped at 1,000 rows; 500 keeps each page light.
const PER_PAGE = 500;

export interface CollectionCatalogProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

async function getCollection(slug: string): Promise<{ slug: string; name: string } | null> {
  const db = await getReadDb();
  const doc = await db.collection('collections').findOne(
    { slug, visible: { $ne: false } },
    { projection: { slug: 1, name: 1 }, maxTimeMS: 8000 },
  );
  return doc ? { slug: doc.slug as string, name: (doc.name as string) || slug } : null;
}

export async function collectionCatalogMetadata(
  slug: string,
  searchParams: CollectionCatalogProps['searchParams'],
): Promise<Metadata> {
  const page = parsePage((await searchParams).page);
  const collection = await getCollection(slug);
  if (!collection) return { title: 'Collection not found - Source Library' };
  return {
    title: `${collection.name}: all books${page > 1 ? ` (page ${page})` : ''} - Source Library`,
    description: `The complete list of books in the ${collection.name} collection at Source Library, with links to read each one.`,
    // Each page is its own canonical, as on /browse — page 2+ links books page 1 does not.
    alternates: { canonical: browsePageHref(`/collections/${collection.slug}/catalog`, page) },
  };
}

export default async function CollectionCatalogPage({
  slug,
  searchParams,
}: {
  slug: string;
  searchParams: CollectionCatalogProps['searchParams'];
}) {
  // Apex-only: the book list is global, and a partner subdomain must never
  // list books outside its own catalogue (tenant-lockdown invariant 2).
  const h = await headers();
  if (h.get('x-tenant-id')) notFound();

  const page = parsePage((await searchParams).page);
  const collection = await getCollection(slug);
  if (!collection) notFound();

  const { books, total } = await browseBooks({
    collection: collection.slug,
    sort: 'title',
    offset: (page - 1) * PER_PAGE,
    limit: PER_PAGE,
    exactCount: true,
  });
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (page > totalPages) notFound();

  const basePath = `/collections/${collection.slug}/catalog`;

  return (
    <>
      <SiteHeader
        variant="light"
        breadcrumbs={[
          { label: 'Collections', href: '/collections' },
          { label: collection.name, href: `/collections/${collection.slug}` },
        ]}
      />
      <div className="max-w-4xl mx-auto px-6 md:px-12 py-12 md:py-20">
        <h1 className="text-3xl md:text-4xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
          {collection.name}: all books
        </h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
          {total.toLocaleString('en-US')} {total === 1 ? 'book' : 'books'}, A–Z by title
          {totalPages > 1 && ` · page ${page} of ${totalPages}`}
          {' · '}
          <Link href={`/collections/${collection.slug}`} className="underline hover:opacity-70">
            back to the collection
          </Link>
        </p>

        <ol className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
          {books.map(b => {
            const href = `/book/${b.slug || b.id}`;
            const title = b.display_title || b.title;
            const meta = [b.author, b.year ? String(b.year) : b.published, b.language].filter(Boolean).join(' · ');
            return (
              <li key={b.id} className="py-2.5">
                <Link href={href} className="font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>
                  {title}
                </Link>
                {meta && (
                  <span className="block text-sm" style={{ color: 'var(--text-muted)' }}>
                    {meta}
                    {b.pages_translated > 0 ? ' · English translation' : ''}
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        <BrowsePager basePath={basePath} currentPage={page} totalPages={totalPages} />
      </div>
    </>
  );
}
