import { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import { authorSlug } from '@/lib/slugify';
import { headers } from 'next/headers';
import { browseAuthors } from '@/lib/books-catalog';
import { tenantBrowseAuthors } from '@/lib/tenant-browse';
import { notFound } from 'next/navigation';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// This route reads request headers (await headers() for tenant detection),
// so it must render dynamically. Declaring `revalidate` (ISR / static) here
// while calling headers() throws DYNAMIC_SERVER_USAGE in Next 16 and 500s the
// whole /browse/authors/[letter] route. Force dynamic instead.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface PageProps {
  params: Promise<{ letter: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { letter } = await params;
  const l = letter.toUpperCase();
  return {
    title: `Authors starting with ${l} - Source Library`,
    description: `Browse all authors in Source Library whose names begin with the letter ${l}.`,
    alternates: { canonical: `/browse/authors/${l}` },
  };
}

export default async function BrowseAuthorsPage({ params }: PageProps) {
  const { letter } = await params;
  const l = letter.toUpperCase();
  if (l.length !== 1 || !/[A-Z]/.test(l)) notFound();

  const h = await headers();
  const tenantId = h.get('x-tenant-id');
  const tenantSlug = h.get('x-tenant-slug');
  const base = tenantSlug ? `/${tenantSlug}/browse` : '/browse';

  let authors: { name: string; count: number }[] = [];
  try {
    authors = tenantId
      ? await tenantBrowseAuthors(tenantId, l)
      : await browseAuthors(l);
  } catch {
    // Supabase error — render empty page
  }

  return (
    <>
      <SiteHeader variant="light" breadcrumbs={[{ label: 'Browse', href: base }]} />
      <div className="max-w-4xl mx-auto px-6 md:px-12 py-12 md:py-20">
        <h1 className="text-3xl md:text-4xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
          Authors: {l}
        </h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
          {authors.length.toLocaleString('en-US')} {authors.length === 1 ? 'author' : 'authors'}
        </p>

        {/* Letter nav */}
        <div className="flex flex-wrap gap-1.5 mb-10">
          {LETTERS.map(lt => (
            <Link
              key={lt}
              href={`${base}/authors/${lt}`}
              className={`w-8 h-8 flex items-center justify-center rounded text-xs font-medium transition-colors ${lt === l ? 'text-white' : 'hover:opacity-70'
                }`}
              style={lt === l
                ? { background: 'var(--text-primary)', color: '#fff' }
                : { color: 'var(--text-muted)' }
              }
            >
              {lt}
            </Link>
          ))}
        </div>

        {/* Author list */}
        <div className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
          {authors.map(author => (
            <Link
              key={author.name}
              href={`/author/${authorSlug(author.name)}`}
              className="flex items-baseline justify-between py-3 hover:opacity-70 transition-opacity"
            >
              <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                {author.name}
              </p>
              <p className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {author.count} {author.count === 1 ? 'book' : 'books'}
              </p>
            </Link>
          ))}
        </div>

        {authors.length === 0 && (
          <p className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
            No authors found starting with {l}.
          </p>
        )}
      </div>
    </>
  );
}
