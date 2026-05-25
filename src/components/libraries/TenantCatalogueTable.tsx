import Link from 'next/link';

export interface CatalogueRow {
  id: string;
  slug: string | null;
  title: string;
  display_title: string | null;
  author: string | null;
  year: number | null;
  language: string | null;
  pages_count: number;
  pages_ocr: number;
  pages_translated: number;
  source_url: string | null;
}

export type CatalogueSort =
  | 'title' | 'title_desc'
  | 'author' | 'author_desc'
  | 'pages' | 'pages_desc'
  | 'translation' | 'translation_desc'
  | 'ocr' | 'ocr_desc'
  | 'shelfmark';

interface Props {
  rows: CatalogueRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: CatalogueSort;
  /** basePath used to construct column-header links (e.g. "/catalogue"). */
  basePath: string;
}

// Extract an EAP shelfmark like "EAP039-1-2-1" from a source_url like
// "https://eap.bl.uk/archive-file/EAP039-1-2-1/manifest". Returns "" when
// the pattern doesn't match.
function eapShelfmark(sourceUrl: string | null): string {
  if (!sourceUrl) return '';
  const m = sourceUrl.match(/EAP\d+(?:[-_]\d+)+/i);
  return m ? m[0] : '';
}

function pct(num: number, denom: number): string {
  if (!denom) return '—';
  return `${Math.round((num / denom) * 100)}%`;
}

function sortHref(basePath: string, sort: CatalogueSort, current: CatalogueSort, column: 'title' | 'author' | 'pages' | 'translation' | 'ocr' | 'shelfmark'): string {
  const ascending = column as CatalogueSort;
  const descending = (`${column}_desc`) as CatalogueSort;
  const next: CatalogueSort = current === ascending ? descending : ascending;
  // Sort param only valid for columns with a desc variant; shelfmark has no desc.
  const isShelfmark = column === 'shelfmark';
  const params = new URLSearchParams();
  params.set('sort', isShelfmark ? 'shelfmark' : next);
  return `${basePath}?${params.toString()}`;
}

function ArrowIcon({ direction }: { direction: 'asc' | 'desc' | null }) {
  if (direction === null) return <span aria-hidden className="ml-1 text-stone-300">↕</span>;
  return <span aria-hidden className="ml-1">{direction === 'asc' ? '↑' : '↓'}</span>;
}

function arrowFor(column: 'title' | 'author' | 'pages' | 'translation' | 'ocr', current: CatalogueSort): 'asc' | 'desc' | null {
  if (current === column) return 'asc';
  if (current === `${column}_desc`) return 'desc';
  return null;
}

export default function TenantCatalogueTable({ rows, total, page, pageSize, sort, basePath }: Props) {
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(start + rows.length - 1, total);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (sort !== 'title') params.set('sort', sort);
    if (p !== 1) params.set('page', String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted">
          Showing <span className="font-medium">{start.toLocaleString()}–{end.toLocaleString()}</span> of <span className="font-medium">{total.toLocaleString()}</span> manuscripts
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium text-stone-700">
                <Link href={sortHref(basePath, sort, sort, 'title')} className="inline-flex items-center hover:underline">
                  Title<ArrowIcon direction={arrowFor('title', sort)} />
                </Link>
              </th>
              <th className="px-3 py-2 font-medium text-stone-700">
                <Link href={sortHref(basePath, sort, sort, 'author')} className="inline-flex items-center hover:underline">
                  Monastery / Source<ArrowIcon direction={arrowFor('author', sort)} />
                </Link>
              </th>
              <th className="px-3 py-2 font-medium text-stone-700">
                <Link href={sortHref(basePath, sort, sort, 'shelfmark')} className="inline-flex items-center hover:underline">
                  EAP Shelfmark<ArrowIcon direction={sort === 'shelfmark' ? 'asc' : null} />
                </Link>
              </th>
              <th className="px-3 py-2 font-medium text-stone-700 text-right">
                <Link href={sortHref(basePath, sort, sort, 'pages')} className="inline-flex items-center hover:underline">
                  Pages<ArrowIcon direction={arrowFor('pages', sort)} />
                </Link>
              </th>
              <th className="px-3 py-2 font-medium text-stone-700 text-right">
                <Link href={sortHref(basePath, sort, sort, 'ocr')} className="inline-flex items-center hover:underline">
                  OCR<ArrowIcon direction={arrowFor('ocr', sort)} />
                </Link>
              </th>
              <th className="px-3 py-2 font-medium text-stone-700 text-right">
                <Link href={sortHref(basePath, sort, sort, 'translation')} className="inline-flex items-center hover:underline">
                  Translated<ArrowIcon direction={arrowFor('translation', sort)} />
                </Link>
              </th>
              <th className="px-3 py-2 font-medium text-stone-700">Language</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const titleText = row.display_title || row.title;
              const href = `/book/${row.slug || row.id}`;
              const shelfmark = eapShelfmark(row.source_url);
              return (
                <tr key={row.id} className="border-t border-stone-100 hover:bg-stone-50">
                  <td className="px-3 py-2">
                    <Link href={href} className="text-stone-900 hover:underline">{titleText}</Link>
                  </td>
                  <td className="px-3 py-2 text-stone-700">{row.author || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-stone-600">{shelfmark || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.pages_count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(row.pages_ocr, row.pages_count)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(row.pages_translated, row.pages_count)}</td>
                  <td className="px-3 py-2 text-stone-700">{row.language || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-between" aria-label="Pagination">
          <div className="text-sm text-muted">Page {page} of {totalPages}</div>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={pageHref(page - 1)} className="px-3 py-1 text-sm rounded border border-stone-300 hover:bg-stone-50">
                ← Previous
              </Link>
            )}
            {page < totalPages && (
              <Link href={pageHref(page + 1)} className="px-3 py-1 text-sm rounded border border-stone-300 hover:bg-stone-50">
                Next →
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
