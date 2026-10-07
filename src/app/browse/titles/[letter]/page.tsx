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
// Titles that begin with no Latin letter (Chinese, Greek, Arabic, digits,
// "[Blockbook] …") — 12,157 of 42,072 live books on 2026-10-04, which the
// A–Z letters alone left with no crawlable index page at all.
const OTHER = 'OTHER';
const OTHER_LABEL = 'Other scripts & numbers';

function bucketLabel(l: string): string {
  return l === OTHER ? OTHER_LABEL : l;
}
function bucketPath(l: string): string {
  return l === OTHER ? 'other' : l;
}
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
  const pageSuffix = page > 1 ? ` (page ${page})` : '';
  return {
    title: l === OTHER
      ? `Books with titles in other scripts${pageSuffix} - Source Library`
      : `Books starting with ${l}${pageSuffix} - Source Library`,
    description: l === OTHER
      ? 'Browse every book in Source Library whose title begins with a non-Latin script, a number, or a bracket — Chinese, Greek, Arabic, Hebrew and more.'
      : `Browse every book in Source Library whose title begins with the letter ${l}.`,
    // Each page is its own canonical — pointing page 2+ at page 1 would tell
    // crawlers to drop the books only those pages link to.
    alternates: { canonical: browsePageHref(`/browse/titles/${bucketPath(l)}`, page) },
  };
}

export default async function BrowseTitlesPage({ params, searchParams }: PageProps) {
  const { letter } = await params;
  const page = parsePage((await searchParams).page);
  const l = letter.toUpperCase();
  if (l !== OTHER && (l.length !== 1 || !/[A-Z]/.test(l))) notFound();

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
      // Partner rooms keep their own translated-only A–Z; no "other" bucket.
      books = l === OTHER ? [] : await tenantBrowseTitles(tenantId, l);
      total = books.length;
    } else {
      // Every live book, translated or not: this index is how search engines
      // reach books that no collection or related-books rail links to (#2266).
      const result = await browseBooks({
        ...(l === OTHER ? { titleNonLatin: true } : { titlePrefix: l }),
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
          Titles: {bucketLabel(l)}
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
          {!tenantId && (
            <Link
              href={`${base}/titles/other`}
              className={`h-8 px-2.5 flex items-center justify-center rounded text-xs font-medium transition-colors ${l === OTHER ? 'text-white' : 'hover:opacity-70'}`}
              style={l === OTHER
                ? { background: 'var(--text-primary)', color: '#fff' }
                : { color: 'var(--text-muted)' }
              }
            >
              {OTHER_LABEL}
            </Link>
          )}
        </div>

        {books.length > 0 ? (
          <>
            <BrowseViewToggle books={books} />
            <BrowsePager basePath={`${base}/titles/${bucketPath(l)}`} currentPage={page} totalPages={totalPages} />
          </>
        ) : (
          <p className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
            No books found {l === OTHER ? 'in this index' : `starting with ${l}`}.
          </p>
        )}
      </div>
    </>
  );
}
