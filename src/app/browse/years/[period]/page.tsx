import { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import { headers } from 'next/headers';
import { browseBooks } from '@/lib/books-catalog';
import { tenantBrowseYears } from '@/lib/tenant-browse';
import { notFound } from 'next/navigation';
import BrowseViewToggle from '@/components/browse/BrowseViewToggle';
import BrowsePager, { browsePageHref } from '@/components/browse/BrowsePager';

// One page must fit in a single Supabase response, which is silently capped at
// 1,000 rows (a single 2,000-row request used to truncate every large period).
// Larger periods paginate via ?page=N.
const PER_PAGE = 1000;

const PERIODS: Record<string, { label: string; min: number; max: number }> = {
  ancient: { label: 'Ancient (before 500 CE)', min: -9999, max: 499 },
  medieval: { label: 'Medieval (500–1400)', min: 500, max: 1399 },
  '1400s': { label: '15th Century (1400–1499)', min: 1400, max: 1499 },
  '1500s': { label: '16th Century (1500–1599)', min: 1500, max: 1599 },
  '1600s': { label: '17th Century (1600–1699)', min: 1600, max: 1699 },
  '1700s': { label: '18th Century (1700–1799)', min: 1700, max: 1799 },
  '1800s': { label: '19th Century (1800–1899)', min: 1800, max: 1899 },
  '1900s': { label: '20th Century (1900–1930)', min: 1900, max: 1930 },
};

const PERIOD_SLUGS = Object.keys(PERIODS);

// Must be dynamic: this page reads request headers (x-tenant-id) for tenant
// scoping. Pairing `revalidate` (ISR) with `await headers()` throws
// DYNAMIC_SERVER_USAGE and 500s the whole route in Next 16 (see PR #2260,
// which fixed authors/titles/artists but missed this route).
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const dynamicParams = true;

export function generateStaticParams() {
  return []; // Generate on first request, not at build time
}

interface PageProps {
  params: Promise<{ period: string }>;
  searchParams: Promise<{ page?: string }>;
}

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { period } = await params;
  const page = parsePage((await searchParams).page);
  const p = PERIODS[period];
  if (!p) return { title: 'Not Found' };
  return {
    title: `${p.label}${page > 1 ? ` (page ${page})` : ''} - Source Library`,
    description: `Browse all translated books from the ${p.label.toLowerCase()} in Source Library.`,
    // Each page is its own canonical — see browse/titles/[letter].
    alternates: { canonical: browsePageHref(`/browse/years/${period}`, page) },
  };
}

export default async function BrowseYearsPage({ params, searchParams }: PageProps) {
  const { period } = await params;
  const page = parsePage((await searchParams).page);
  const p = PERIODS[period];
  if (!p) notFound();

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
  }> = [];
  let total = 0;
  try {
    if (tenantId) {
      books = await tenantBrowseYears(tenantId, p.min, p.max);
      total = books.length;
    } else {
      const result = await browseBooks({
        yearMin: p.min,
        yearMax: p.max,
        hasTranslation: true,
        sort: 'year_asc',
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
          {p.label}
        </h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
          {total.toLocaleString('en-US')} {total === 1 ? 'book' : 'books'}
          {totalPages > 1 && ` · page ${page} of ${totalPages}`}
        </p>

        {/* Period nav */}
        <div className="flex flex-wrap gap-2 mb-10">
          {PERIOD_SLUGS.map(slug => (
            <Link
              key={slug}
              href={`${base}/years/${slug}`}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${slug === period ? 'text-white' : 'hover:opacity-70'
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

        {books.length > 0 ? (
          <>
            <BrowseViewToggle books={books} />
            <BrowsePager basePath={`${base}/years/${period}`} currentPage={page} totalPages={totalPages} />
          </>
        ) : (
          <p className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
            No books found for this period.
          </p>
        )}
      </div>
    </>
  );
}
