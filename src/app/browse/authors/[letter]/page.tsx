import { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import { authorSlug } from '@/lib/slugify';
import { browseAuthors } from '@/lib/books-catalog';
import { notFound } from 'next/navigation';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// ISR: rebuild every 10 min.
export const revalidate = 600;
export const maxDuration = 60;
export const dynamicParams = true;

export function generateStaticParams() {
  return []; // Generate on first request, not at build time
}

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

  let authors: { name: string; count: number }[] = [];
  try {
    authors = await browseAuthors(l);
  } catch {
    // Supabase error — render empty page
  }

  return (
    <>
      <SiteHeader variant="light" breadcrumbs={[{ label: 'Browse', href: '/browse' }]} />
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
            href={`/browse/authors/${lt}`}
            className={`w-8 h-8 flex items-center justify-center rounded text-xs font-medium transition-colors ${
              lt === l ? 'text-white' : 'hover:opacity-70'
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
