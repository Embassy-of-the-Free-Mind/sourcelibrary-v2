import { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import { headers } from 'next/headers';
import { browseBooks } from '@/lib/books-catalog';
import { tenantBrowseTitles } from '@/lib/tenant-browse';
import { notFound } from 'next/navigation';
import BrowseViewToggle from '@/components/browse/BrowseViewToggle';
import BrowsePager, { browsePageHref } from '@/components/browse/BrowsePager';

// One page must fit in a single Supabase response, which is silently capped at
// 1,000 rows (a single 2,000-row request used to truncate every large letter —
// T listed 1,000 of 3,745 books). Larger letters paginate via ?page=N.
const PER_PAGE = 1000;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const dynamicParams = true;

export function generateStaticParams() {
  return []; // Generate on first request, not at build time
}

interface PageProps {
  params: Promise<{ letter: string }>;
  searchParams: Promise<{ page?: string }>;
}

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { letter } = await params;
  const page = parsePage((await searchParams).page);
  const l = letter.toUpperCase();
  return {
    title: `Books starting with ${l}${page > 1 ? ` (page ${page})` : ''} - Source Library`,
    description: `Browse all translated books in Source Library whose titles begin with the letter ${l}.`,
    // Each page is its own canonical — pointing page 2+ at page 1 would tell
    // crawlers to drop the books only those pages link to.
    alternates: { canonical: browsePageHref(`/browse/titles/${l}`, page) },
  };
}

export default async function BrowseTitlesPage({ params, searchParams }: PageProps) {
  const { letter } = await params;
  const page = parsePage((await searchParams).page);
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
  let total = 0;
  try {
    if (tenantId) {
      books = await tenantBrowseTitles(tenantId, l);
      total = books.length;
    } else {
      const result = await browseBooks({
        titlePrefix: l,
        hasTranslation: true,
        sort: 'title',
        offset: (page - 1) * PER_PAGE,
        limit: PER_PAGE,
        exactCount: true,
      });
      total = result.total;
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
  const totalPages = tenantId ? 1 : Math.ceil(total / PER_PAGE);
  if (page > 1 && page > totalPages) notFound();

  return (
    <>
      <SiteHeader variant="light" breadcrumbs={[{ label: 'Browse', href: base }]} />
      <div className="max-w-6xl mx-auto px-6 md:px-12 py-12 md:py-20">
        <h1 className="text-3xl md:text-4xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
          Titles: {l}
        </h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
          {total.toLocaleString('en-US')} {total === 1 ? 'book' : 'books'}
          {totalPages > 1 && ` · page ${page} of ${totalPages}`}
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
          <>
            <BrowseViewToggle books={books} />
            <BrowsePager basePath={`${base}/titles/${l}`} currentPage={page} totalPages={totalPages} />
          </>
        ) : (
          <p className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
            No books found starting with {l}.
          </p>
        )}
      </div>
    </>
  );
}
