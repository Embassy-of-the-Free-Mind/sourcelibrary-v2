import { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import { headers } from 'next/headers';
import { browseBooks } from '@/lib/books-catalog';
import { tenantBrowseTitles } from '@/lib/tenant-browse';
import { notFound } from 'next/navigation';
import BrowseViewToggle from '@/components/browse/BrowseViewToggle';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const dynamic = 'force-dynamic';
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

export default async function BrowseTitlesPage({ params }: PageProps) {
  const { letter } = await params;
  const l = letter.toUpperCase();
  if (l.length !== 1 || !/[A-Z]/.test(l)) notFound();

  const h = await headers();
  const tenantId = h.get('x-tenant-id');
  const tenantSlug = h.get('x-tenant-slug');
  const base = tenantSlug ? `/${tenantSlug}/browse` : '/browse';

  let books: Array<{
    id: string;
    slug?: string;
    title: string;
    display_title?: string;
    author: string;
    language: string;
    published: string;
    year: number;
    pages_count: number;
    pages_translated: number;
    thumbnail: string | null;
    thumbnail_blob: string | null;
    is_first_translation: boolean;
    ft_disposition?: string;
  }> = [];
  try {
    if (tenantId) {
      books = await tenantBrowseTitles(tenantId, l);
    } else {
      const result = await browseBooks({
        titlePrefix: l,
        hasTranslation: true,
        sort: 'title',
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
        year: b.year || 0,
        pages_count: b.pages_count || 0,
        pages_translated: b.pages_translated || 0,
        thumbnail: b.thumbnail,
        thumbnail_blob: b.thumbnail_blob,
        is_first_translation: b.is_first_translation || false,
        ft_disposition: undefined,
      }));
    }
  } catch {
    // Supabase error — render empty page
  }

  return (
    <>
      <SiteHeader variant="light" breadcrumbs={[{ label: 'Browse', href: base }]} />
      <div className="max-w-6xl mx-auto px-6 md:px-12 py-12 md:py-20">
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
              href={`${base}/titles/${lt}`}
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

        {books.length > 0 ? (
          <BrowseViewToggle books={books} />
        ) : (
          <p className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
            No books found starting with {l}.
          </p>
        )}
      </div>
    </>
  );
}
