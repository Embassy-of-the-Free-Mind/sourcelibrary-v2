import { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import { browseBooks } from '@/lib/books-catalog';
import { bookUrl } from '@/lib/slugify';
import { notFound } from 'next/navigation';

const PERIODS: Record<string, { label: string; min: number; max: number }> = {
  ancient:   { label: 'Ancient (before 500 CE)', min: -9999, max: 499 },
  medieval:  { label: 'Medieval (500–1400)', min: 500, max: 1399 },
  '1400s':   { label: '15th Century (1400–1499)', min: 1400, max: 1499 },
  '1500s':   { label: '16th Century (1500–1599)', min: 1500, max: 1599 },
  '1600s':   { label: '17th Century (1600–1699)', min: 1600, max: 1699 },
  '1700s':   { label: '18th Century (1700–1799)', min: 1700, max: 1799 },
  '1800s':   { label: '19th Century (1800–1899)', min: 1800, max: 1899 },
  '1900s':   { label: '20th Century (1900–1930)', min: 1900, max: 1930 },
};

const PERIOD_SLUGS = Object.keys(PERIODS);

// ISR: rebuild daily. Allow 60s for first-hit generation.
export const revalidate = false;
export const maxDuration = 60;
export const dynamicParams = true;

export function generateStaticParams() {
  return []; // Generate on first request, not at build time
}

interface PageProps {
  params: Promise<{ period: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { period } = await params;
  const p = PERIODS[period];
  if (!p) return { title: 'Not Found' };
  return {
    title: `${p.label} - Source Library`,
    description: `Browse all translated books from the ${p.label.toLowerCase()} in Source Library.`,
    alternates: { canonical: `/browse/years/${period}` },
  };
}

interface BrowseBook {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published: string;
  _pub_year: number;
}

export default async function BrowseYearsPage({ params }: PageProps) {
  const { period } = await params;
  const p = PERIODS[period];
  if (!p) notFound();

  let books: BrowseBook[] = [];
  try {
    const result = await browseBooks({
      yearMin: p.min,
      yearMax: p.max,
      hasTranslation: true,
      sort: 'year_asc',
      limit: 2000,
    });
    books = result.books.map(b => ({
      id: b.id,
      slug: b.slug || undefined,
      title: b.title,
      display_title: b.display_title || undefined,
      author: b.author || '',
      language: b.language || '',
      published: b.published || '',
      _pub_year: b.year || 0,
    }));
  } catch {
    // Supabase error — render empty page
  }

  return (
    <>
      <SiteHeader variant="light" breadcrumbs={[{ label: 'Browse', href: '/browse' }]} />
      <div className="max-w-4xl mx-auto px-6 md:px-12 py-12 md:py-20">
      <h1 className="text-3xl md:text-4xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
        {p.label}
      </h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
        {books.length.toLocaleString('en-US')} {books.length === 1 ? 'book' : 'books'}
      </p>

      {/* Period nav */}
      <div className="flex flex-wrap gap-2 mb-10">
        {PERIOD_SLUGS.map(slug => (
          <Link
            key={slug}
            href={`/browse/years/${slug}`}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              slug === period ? 'text-white' : 'hover:opacity-70'
            }`}
            style={slug === period
              ? { background: 'var(--text-primary)', color: '#fff' }
              : { background: 'var(--bg-warm)', color: 'var(--text-muted)', border: '1px solid var(--border-light)' }
            }
          >
            {PERIODS[slug].label.split(' (')[0]}
          </Link>
        ))}
      </div>

      {/* Book list */}
      <div className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
        {books.map(book => (
          <Link
            key={book.id}
            href={bookUrl(book)}
            className="block py-3 hover:opacity-70 transition-opacity"
          >
            <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
              {book.display_title || book.title}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {book.author}
              {book.published ? ` · ${book.published}` : ''}
              {book.language ? ` · ${book.language}` : ''}
            </p>
          </Link>
        ))}
      </div>

      {books.length === 0 && (
        <p className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
          No books found for this period.
        </p>
      )}
    </div>
    </>
  );
}
