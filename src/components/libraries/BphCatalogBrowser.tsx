'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDebouncedCallback } from 'use-debounce';
import { Search, X, ChevronLeft, ChevronRight, BookMarked } from 'lucide-react';

interface BphWork {
  ubn: string;
  title: string;
  author: string | null;
  year: number | null;
  shelf_mark: string | null;
  keywords: string | null;
  place: string | null;
  publisher: string | null;
  printer: string | null;
  ia_identifier: string | null;
  ustc_sn: string | null;
}

const PER_PAGE = 50;

const SORT_OPTIONS = [
  { value: 'title', label: 'Title A-Z' },
  { value: 'author', label: 'Author A-Z' },
  { value: 'year_asc', label: 'Oldest first' },
  { value: 'year_desc', label: 'Newest first' },
  { value: 'shelfmark', label: 'Shelfmark' },
];

const KEYWORD_OPTIONS = [
  { value: '', label: 'All subjects' },
  { value: 'hermetica', label: 'Hermetica' },
  { value: 'alchemy', label: 'Alchemy' },
  { value: 'mysticism', label: 'Mysticism' },
  { value: 'esotericism', label: 'Esotericism' },
  { value: 'rosicrucianism', label: 'Rosicrucianism' },
  { value: 'Kabbalah', label: 'Kabbalah' },
  { value: 'freemasonry', label: 'Freemasonry' },
  { value: 'theosophy', label: 'Theosophy' },
  { value: 'anthroposophy', label: 'Anthroposophy' },
  { value: 'gnosis', label: 'Gnosis' },
  { value: 'magic', label: 'Magic' },
  { value: 'astrology', label: 'Astrology' },
  { value: 'Sufism', label: 'Sufism' },
  { value: 'Buddhism', label: 'Buddhism' },
  { value: 'Judaica', label: 'Judaica' },
  { value: 'grail', label: 'Grail' },
  { value: 'catharism', label: 'Catharism' },
  { value: 'tarot', label: 'Tarot' },
  { value: 'reference', label: 'Reference' },
  { value: 'history of religion', label: 'History of Religion' },
];

interface Props {
  basePath: string;
  /** Map of UBN → { id, slug } for BPH books that exist on Source Library */
  digitizedUbns: Record<string, { id: string; slug: string }>;
}

export default function BphCatalogBrowser({ basePath, digitizedUbns }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialQ = searchParams.get('cq') || '';
  const initialSort = searchParams.get('csort') || 'title';
  const initialKeyword = searchParams.get('ckeyword') || '';
  const initialOffset = parseInt(searchParams.get('coffset') || '0') || 0;

  const [works, setWorks] = useState<BphWork[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(initialQ);
  const [sort, setSort] = useState(initialSort);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [offset, setOffset] = useState(initialOffset);

  const fetchWorks = useCallback(async (q: string, s: string, kw: string, off: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (s) params.set('sort', s);
      if (kw) params.set('keyword', kw);
      if (off) params.set('offset', String(off));
      const res = await fetch(`/api/catalog/bph?${params}`);
      const data = await res.json();
      setWorks(data.works || []);
      setTotal(data.total || 0);
    } catch {
      setWorks([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Sync URL params
  const updateUrl = useCallback((q: string, s: string, kw: string, off: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (q) params.set('cq', q); else params.delete('cq');
    if (s && s !== 'title') params.set('csort', s); else params.delete('csort');
    if (kw) params.set('ckeyword', kw); else params.delete('ckeyword');
    if (off) params.set('coffset', String(off)); else params.delete('coffset');
    router.replace(`${basePath}?${params}`, { scroll: false });
  }, [searchParams, router, basePath]);

  useEffect(() => {
    fetchWorks(initialQ, initialSort, initialKeyword, initialOffset);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const debouncedSearch = useDebouncedCallback((value: string) => {
    setOffset(0);
    fetchWorks(value, sort, keyword, 0);
    updateUrl(value, sort, keyword, 0);
  }, 300);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    debouncedSearch(value);
  };

  const handleSortChange = (newSort: string) => {
    setSort(newSort);
    setOffset(0);
    fetchWorks(searchQuery, newSort, keyword, 0);
    updateUrl(searchQuery, newSort, keyword, 0);
  };

  const handleKeywordChange = (newKw: string) => {
    setKeyword(newKw);
    setOffset(0);
    fetchWorks(searchQuery, sort, newKw, 0);
    updateUrl(searchQuery, sort, newKw, 0);
  };

  const handlePage = (newOffset: number) => {
    setOffset(newOffset);
    fetchWorks(searchQuery, sort, keyword, newOffset);
    updateUrl(searchQuery, sort, keyword, newOffset);
  };

  const currentPage = Math.floor(offset / PER_PAGE) + 1;
  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div>
      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search catalog..."
            className="text-sm border border-border-light rounded-md pl-8 pr-8 py-1.5 bg-white text-primary w-56 focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <select
          value={keyword}
          onChange={(e) => handleKeywordChange(e.target.value)}
          className="text-sm border border-border-light rounded-md px-3 py-1.5 bg-white text-primary"
        >
          {KEYWORD_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(e) => handleSortChange(e.target.value)}
          className="text-sm border border-border-light rounded-md px-3 py-1.5 bg-white text-primary"
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <span className="text-sm text-muted ml-auto">
          {total.toLocaleString()} works
        </span>
      </div>

      {/* Table */}
      <div className="border border-border-light rounded-lg overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-warm">
                <th className="text-left px-3 py-2.5 font-medium text-secondary">Title</th>
                <th className="text-left px-3 py-2.5 font-medium text-secondary hidden sm:table-cell">Author</th>
                <th className="text-left px-3 py-2.5 font-medium text-secondary w-16">Year</th>
                <th className="text-left px-3 py-2.5 font-medium text-secondary hidden md:table-cell">Shelfmark</th>
                <th className="text-left px-3 py-2.5 font-medium text-secondary hidden lg:table-cell">Subject</th>
                <th className="text-center px-3 py-2.5 font-medium text-secondary w-10" title="On Source Library">SL</th>
              </tr>
            </thead>
            <tbody className={loading ? 'opacity-50' : ''}>
              {works.map((w) => {
                const digitized = digitizedUbns[w.ubn];
                return (
                  <tr
                    key={w.ubn}
                    className="border-b border-border-light last:border-0 hover:bg-cream/50 transition-colors"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-primary leading-snug">
                        {digitized ? (
                          <a
                            href={`/book/${digitized.slug || digitized.id}`}
                            className="hover:text-accent-rust transition-colors"
                          >
                            {w.title}
                          </a>
                        ) : (
                          w.title
                        )}
                      </div>
                      {/* Mobile: show author + place inline */}
                      <div className="text-xs text-muted sm:hidden mt-0.5">
                        {w.author}{w.place ? ` · ${w.place}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-secondary hidden sm:table-cell">
                      {w.author || <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2 text-secondary tabular-nums">
                      {w.year || <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2 text-secondary font-mono text-xs hidden md:table-cell">
                      {w.shelf_mark || <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2 hidden lg:table-cell">
                      {w.keywords ? (
                        <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-cream border border-border-light text-secondary capitalize">
                          {w.keywords}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {digitized ? (
                        <a
                          href={`/book/${digitized.slug || digitized.id}`}
                          title="Read on Source Library"
                        >
                          <BookMarked className="w-4 h-4 text-accent-rust inline-block" />
                        </a>
                      ) : (
                        <span className="text-muted/30">·</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && works.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center text-muted">
                    No works found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => handlePage(Math.max(0, offset - PER_PAGE))}
            disabled={offset === 0}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-border-light rounded-md hover:bg-warm transition-colors disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>
          <span className="text-sm text-muted">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => handlePage(offset + PER_PAGE)}
            disabled={currentPage >= totalPages}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-border-light rounded-md hover:bg-warm transition-colors disabled:opacity-30 disabled:cursor-default"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
