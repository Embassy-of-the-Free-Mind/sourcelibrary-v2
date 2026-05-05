'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDebouncedCallback } from 'use-debounce';
import { Search, X, ChevronLeft, ChevronRight, BookMarked, SlidersHorizontal } from 'lucide-react';
import { tenantBookUrl } from '@/lib/slugify';

interface BphWork {
  ubn: string;
  title: string | null;
  parallel_title: string | null;
  uniform_title: string | null;
  author: string | null;
  variant_author: string | null;
  pseudonym: string | null;
  editor: string | null;
  variant_editor: string | null;
  place: string | null;
  printer: string | null;
  publisher: string | null;
  variant_printer: string | null;
  variant_publisher: string | null;
  year: number | null;
  shelf_mark: string | null;
  state_shelf_mark: string | null;
  present_location: string | null;
  keywords: string | null;
  language: string | null;
  series_title: string | null;
  volume_title: string | null;
  bibliography: string | null;
  remarks: string | null;
  number_of_copies: number | null;
  object_size_cm: string | null;
  binding: string | null;
  bound_with: string | null;
  provenance: string | null;
  thumbnail: string | null;
  file_count: number | null;
  sl_book_id: string | null;
  sl_book_slug: string | null;
  ia_identifier: string | null;
  ustc_sn: string | null;
}

interface AdvancedFilters {
  author: string;
  title: string;
  editor: string;
  place: string;
  printer: string;
  publisher: string;
  shelf_mark: string;
  language: string;
  yearFrom: string;
  yearTo: string;
  digitized: '' | 'true' | 'sl' | 'false';
}

const EMPTY_ADV: AdvancedFilters = {
  author: '', title: '', editor: '', place: '', printer: '', publisher: '',
  shelf_mark: '', language: '', yearFrom: '', yearTo: '', digitized: '',
};

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
  /** Map of UBN → { id, slug } for BPH books that exist on Source Library (overrides sl_book_id from row) */
  digitizedUbns: Record<string, { id: string; slug: string }>;
  /** Optional tenant slug to include in book URLs */
  tenantSlug?: string;
  /** When true, defaults to advanced search expanded */
  defaultAdvanced?: boolean;
}

export default function BphCatalogBrowser({ basePath, digitizedUbns, tenantSlug, defaultAdvanced = false }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialQ = searchParams.get('cq') || '';
  const initialSort = searchParams.get('csort') || 'title';
  const initialKeyword = searchParams.get('ckeyword') || '';
  const initialOffset = parseInt(searchParams.get('coffset') || '0') || 0;
  const initialAdv: AdvancedFilters = {
    author: searchParams.get('cauthor') || '',
    title: searchParams.get('ctitle') || '',
    editor: searchParams.get('ceditor') || '',
    place: searchParams.get('cplace') || '',
    printer: searchParams.get('cprinter') || '',
    publisher: searchParams.get('cpublisher') || '',
    shelf_mark: searchParams.get('cshelf') || '',
    language: searchParams.get('clang') || '',
    yearFrom: searchParams.get('cyfrom') || '',
    yearTo: searchParams.get('cyto') || '',
    digitized: (searchParams.get('cdig') || '') as AdvancedFilters['digitized'],
  };
  const hasAnyAdv = Object.values(initialAdv).some(v => v !== '');

  const [works, setWorks] = useState<BphWork[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(initialQ);
  const [sort, setSort] = useState(initialSort);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [offset, setOffset] = useState(initialOffset);
  const [adv, setAdv] = useState<AdvancedFilters>(initialAdv);
  const [showAdvanced, setShowAdvanced] = useState(defaultAdvanced || hasAnyAdv);

  const buildParams = useCallback((q: string, s: string, kw: string, off: number, a: AdvancedFilters) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (s) params.set('sort', s);
    if (kw) params.set('keyword', kw);
    if (off) params.set('offset', String(off));
    if (a.author) params.set('author', a.author);
    if (a.title) params.set('title', a.title);
    if (a.editor) params.set('editor', a.editor);
    if (a.place) params.set('place', a.place);
    if (a.printer) params.set('printer', a.printer);
    if (a.publisher) params.set('publisher', a.publisher);
    if (a.shelf_mark) params.set('shelf_mark', a.shelf_mark);
    if (a.language) params.set('language', a.language);
    if (a.yearFrom) params.set('yearFrom', a.yearFrom);
    if (a.yearTo) params.set('yearTo', a.yearTo);
    if (a.digitized) params.set('digitized', a.digitized);
    return params;
  }, []);

  const fetchWorks = useCallback(async (q: string, s: string, kw: string, off: number, a: AdvancedFilters) => {
    setLoading(true);
    try {
      const params = buildParams(q, s, kw, off, a);
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
  }, [buildParams]);

  // Sync URL params (using c-prefixed keys so they don't collide with parent page params)
  const updateUrl = useCallback((q: string, s: string, kw: string, off: number, a: AdvancedFilters) => {
    const params = new URLSearchParams(searchParams.toString());
    const setOrDel = (key: string, val: string) => {
      if (val) params.set(key, val);
      else params.delete(key);
    };
    setOrDel('cq', q);
    setOrDel('csort', s !== 'title' ? s : '');
    setOrDel('ckeyword', kw);
    setOrDel('coffset', off ? String(off) : '');
    setOrDel('cauthor', a.author);
    setOrDel('ctitle', a.title);
    setOrDel('ceditor', a.editor);
    setOrDel('cplace', a.place);
    setOrDel('cprinter', a.printer);
    setOrDel('cpublisher', a.publisher);
    setOrDel('cshelf', a.shelf_mark);
    setOrDel('clang', a.language);
    setOrDel('cyfrom', a.yearFrom);
    setOrDel('cyto', a.yearTo);
    setOrDel('cdig', a.digitized);
    router.replace(`${basePath}?${params}`, { scroll: false });
  }, [searchParams, router, basePath]);

  useEffect(() => {
    fetchWorks(initialQ, initialSort, initialKeyword, initialOffset, initialAdv);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const debouncedSearch = useDebouncedCallback((value: string) => {
    setOffset(0);
    fetchWorks(value, sort, keyword, 0, adv);
    updateUrl(value, sort, keyword, 0, adv);
  }, 300);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    debouncedSearch(value);
  };

  const handleSortChange = (newSort: string) => {
    setSort(newSort);
    setOffset(0);
    fetchWorks(searchQuery, newSort, keyword, 0, adv);
    updateUrl(searchQuery, newSort, keyword, 0, adv);
  };

  const handleKeywordChange = (newKw: string) => {
    setKeyword(newKw);
    setOffset(0);
    fetchWorks(searchQuery, sort, newKw, 0, adv);
    updateUrl(searchQuery, sort, newKw, 0, adv);
  };

  const handlePage = (newOffset: number) => {
    setOffset(newOffset);
    fetchWorks(searchQuery, sort, keyword, newOffset, adv);
    updateUrl(searchQuery, sort, keyword, newOffset, adv);
  };

  const applyAdvanced = () => {
    setOffset(0);
    fetchWorks(searchQuery, sort, keyword, 0, adv);
    updateUrl(searchQuery, sort, keyword, 0, adv);
  };

  const clearAll = () => {
    setSearchQuery('');
    setKeyword('');
    setAdv(EMPTY_ADV);
    setOffset(0);
    fetchWorks('', sort, '', 0, EMPTY_ADV);
    updateUrl('', sort, '', 0, EMPTY_ADV);
  };

  const advCount = useMemo(() => Object.values(adv).filter(v => v !== '').length, [adv]);
  const currentPage = Math.floor(offset / PER_PAGE) + 1;
  const totalPages = Math.ceil(total / PER_PAGE);

  // Resolve digitized status: prefer parent-supplied map (live MongoDB), fall back to row.sl_book_id.
  const resolveDigitized = (w: BphWork) => {
    const fromMap = digitizedUbns[w.ubn];
    if (fromMap) return fromMap;
    if (w.sl_book_id) return { id: w.sl_book_id, slug: w.sl_book_slug || w.sl_book_id };
    return null;
  };

  // Detail-page URL for a catalog entry. On the BPH subdomain this resolves to
  // /catalog/{ubn} (rewritten to /embed/bph/catalog/{ubn}); on the main site it
  // resolves to the same path nested under the library page basePath.
  const detailUrl = (ubn: string) => {
    // basePath examples: "/embed/bph", "/libraries/bibliotheca-philosophica-hermetica"
    if (basePath === '/embed/bph' || basePath === '/embed/bph/') {
      return `/catalog/${encodeURIComponent(ubn)}`;
    }
    return `${basePath.replace(/\/$/, '')}/catalog/${encodeURIComponent(ubn)}`;
  };

  return (
    <div>
      {/* Simple search row */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative flex-1 min-w-[14rem] max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search across all fields…"
            className="w-full text-sm border border-border-light rounded-md pl-9 pr-9 py-2 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
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
          className="text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary"
        >
          {KEYWORD_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(e) => handleSortChange(e.target.value)}
          className="text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary"
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <button
          onClick={() => setShowAdvanced(s => !s)}
          className="inline-flex items-center gap-1.5 text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary hover:bg-warm transition-colors"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Advanced
          {advCount > 0 && (
            <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs rounded-full bg-accent-rust text-white">
              {advCount}
            </span>
          )}
        </button>

        <span className="text-sm text-muted ml-auto">
          {total.toLocaleString()} works
        </span>
      </div>

      {/* Advanced search panel */}
      {showAdvanced && (
        <div className="mb-4 p-4 bg-warm border border-border-light rounded-lg">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <AdvField label="Author" value={adv.author} onChange={v => setAdv({ ...adv, author: v })} placeholder="Behme, Böhme, …" />
            <AdvField label="Title" value={adv.title} onChange={v => setAdv({ ...adv, title: v })} />
            <AdvField label="Editor / translator" value={adv.editor} onChange={v => setAdv({ ...adv, editor: v })} />
            <AdvField label="Place of publication" value={adv.place} onChange={v => setAdv({ ...adv, place: v })} placeholder="London, Lyon, Amsterdam…" />
            <AdvField label="Printer" value={adv.printer} onChange={v => setAdv({ ...adv, printer: v })} />
            <AdvField label="Publisher" value={adv.publisher} onChange={v => setAdv({ ...adv, publisher: v })} />
            <AdvField label="Shelfmark" value={adv.shelf_mark} onChange={v => setAdv({ ...adv, shelf_mark: v })} />
            <AdvField label="Language" value={adv.language} onChange={v => setAdv({ ...adv, language: v })} placeholder="Latin, German, English…" />
            <div>
              <label className="block text-xs text-muted mb-1">Year range</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  value={adv.yearFrom}
                  onChange={(e) => setAdv({ ...adv, yearFrom: e.target.value })}
                  placeholder="from"
                  className="w-full text-sm border border-border-light rounded-md px-2.5 py-1.5 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
                />
                <input
                  type="number"
                  inputMode="numeric"
                  value={adv.yearTo}
                  onChange={(e) => setAdv({ ...adv, yearTo: e.target.value })}
                  placeholder="to"
                  className="w-full text-sm border border-border-light rounded-md px-2.5 py-1.5 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Digitization</label>
              <select
                value={adv.digitized}
                onChange={(e) => setAdv({ ...adv, digitized: e.target.value as AdvancedFilters['digitized'] })}
                className="w-full text-sm border border-border-light rounded-md px-2.5 py-1.5 bg-white text-primary"
              >
                <option value="">All</option>
                <option value="sl">On Source Library</option>
                <option value="true">Digitized anywhere</option>
                <option value="false">Not digitized</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={applyAdvanced}
              className="px-4 py-1.5 text-sm rounded-md bg-accent-rust text-white hover:bg-accent-rust/90 transition-colors"
            >
              Apply
            </button>
            <button
              onClick={clearAll}
              className="px-3 py-1.5 text-sm text-muted hover:text-primary transition-colors"
            >
              Clear all
            </button>
            <span className="text-xs text-muted ml-auto">
              Tip: simple search above queries every field at once.
            </span>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="border border-border-light rounded-lg overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-warm">
                <th className="text-left px-3 py-2.5 font-medium text-secondary">Title</th>
                <th className="text-left px-3 py-2.5 font-medium text-secondary hidden sm:table-cell">Author</th>
                <th className="text-left px-3 py-2.5 font-medium text-secondary w-16">Year</th>
                <th className="text-left px-3 py-2.5 font-medium text-secondary hidden md:table-cell">Place</th>
                <th className="text-left px-3 py-2.5 font-medium text-secondary hidden md:table-cell">Shelfmark</th>
                <th className="text-left px-3 py-2.5 font-medium text-secondary hidden lg:table-cell">Subject</th>
                <th className="text-center px-3 py-2.5 font-medium text-secondary w-10" title="On Source Library">SL</th>
              </tr>
            </thead>
            <tbody className={loading ? 'opacity-50' : ''}>
              {works.map((w) => {
                const digitized = resolveDigitized(w);
                const displayTitle = w.title || w.parallel_title || w.uniform_title || '(untitled)';
                const displayAuthor = w.author || w.variant_author || w.pseudonym;
                return (
                  <tr
                    key={w.ubn}
                    className="border-b border-border-light last:border-0 hover:bg-cream/50 transition-colors"
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-primary leading-snug">
                        <a
                          href={digitized ? tenantBookUrl({ id: digitized.id, slug: digitized.slug }, tenantSlug) : detailUrl(w.ubn)}
                          className="hover:text-accent-rust transition-colors"
                        >
                          {displayTitle}
                        </a>
                      </div>
                      {digitized && (
                        <a
                          href={tenantBookUrl({ id: digitized.id, slug: digitized.slug }, tenantSlug)}
                          className="inline-flex items-center gap-1 mt-1 text-xs text-accent-rust hover:underline"
                        >
                          <BookMarked className="w-3 h-3" />
                          Read on Source Library
                        </a>
                      )}
                      {/* Mobile: show author + place inline */}
                      <div className="text-xs text-muted sm:hidden mt-0.5">
                        {displayAuthor}{w.place ? ` · ${w.place}` : ''}
                      </div>
                      {w.printer && (
                        <div className="text-[11px] text-muted mt-0.5 hidden md:block">
                          {w.printer}{w.publisher && w.publisher !== w.printer ? ` / ${w.publisher}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-secondary hidden sm:table-cell">
                      {displayAuthor || <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2 align-top text-secondary tabular-nums">
                      {w.year || <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2 align-top text-secondary hidden md:table-cell">
                      {w.place || <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2 align-top text-secondary font-mono text-xs hidden md:table-cell">
                      {w.shelf_mark || <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2 align-top hidden lg:table-cell">
                      {w.keywords ? (
                        <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-cream border border-border-light text-secondary capitalize">
                          {w.keywords}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-center">
                      {digitized ? (
                        <a
                          href={tenantBookUrl({ id: digitized.id, slug: digitized.slug }, tenantSlug)}
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
                  <td colSpan={7} className="px-3 py-12 text-center text-muted">
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

function AdvField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-sm border border-border-light rounded-md px-2.5 py-1.5 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
      />
    </div>
  );
}
