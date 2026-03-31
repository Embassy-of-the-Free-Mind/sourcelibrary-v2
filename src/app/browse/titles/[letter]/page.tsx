import { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import { getDb } from '@/lib/mongodb';
import { bookUrl } from '@/lib/slugify';
import { notFound } from 'next/navigation';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// ISR: rebuild daily. Allow 60s for first-hit generation.
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
    title: `Books starting with ${l} - Source Library`,
    description: `Browse all translated books in Source Library whose titles begin with the letter ${l}.`,
    alternates: { canonical: `/browse/titles/${l}` },
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
}

export default async function BrowseTitlesPage({ params }: PageProps) {
  const { letter } = await params;
  const l = letter.toUpperCase();
  if (l.length !== 1 || !/[A-Z]/.test(l)) notFound();

  let books: BrowseBook[] = [];
  try {
    const db = await getDb();
    const regex = new RegExp(`^${l}`, 'i');
    // pages_translated > 0 implies pages_count > 0, so skip redundant filter.
    // Use books_hidden_translated_idx for the base filter, then regex on title.
    const rawBooks = await db.collection('books').find(
      {
        visible: true,
        pages_translated: { $gt: 0 },
        $or: [
          { display_title: { $regex: regex } },
          { display_title: { $exists: false }, title: { $regex: regex } },
        ],
      },
      {
        projection: {
          id: 1, slug: 1, title: 1, display_title: 1,
          author: 1, language: 1, published: 1,
        },
        sort: { display_title: 1, title: 1 },
        maxTimeMS: 45000,
      }
    ).toArray();

    books = rawBooks.map(b => ({
      id: (b.id as string) || b._id.toString(),
      slug: b.slug as string | undefined,
      title: b.title as string,
      display_title: b.display_title as string | undefined,
      author: b.author as string,
      language: b.language as string,
      published: b.published as string,
    }));
  } catch {
    // DB timeout — render empty page with message
  }

  return (
    <>
      <SiteHeader variant="light" breadcrumbs={[{ label: 'Browse', href: '/browse' }]} />
      <div className="max-w-4xl mx-auto px-6 md:px-12 py-12 md:py-20">
      <h1 className="text-3xl md:text-4xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
        Titles: {l}
      </h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
        {books.length.toLocaleString('en-US')} {books.length === 1 ? 'book' : 'books'}
      </p>

      {/* Letter nav */}
      <div className="flex flex-wrap gap-1.5 mb-10">
        {LETTERS.map(lt => (
          <Link
            key={lt}
            href={`/browse/titles/${lt}`}
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
          No books found starting with {l}.
        </p>
      )}
    </div>
    </>
  );
}
