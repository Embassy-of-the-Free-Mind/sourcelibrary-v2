'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { BookMarked, ExternalLink, Search, BookOpen, User } from 'lucide-react';

interface CatalogEntry {
  id: number;
  source_id: string | null;
  title: string;
  author: string | null;
  publication_date: string | null;
  condemnation_year: number | null;
  condemnation_period: string | null;
  scope: string | null;
  reason: string | null;
  ustc_sn: number | null;
  sl_book_id: string | null;
  sl_book_slug: string | null;
  source_book_slug?: string | null;
  source_page?: number | null;
  author_held_count?: number | null;
  author_held_sample_slug?: string | null;
}

interface Catalog {
  indexId: string;
  indexName: string;
  startYear: number | null;
  totalEntries: number;
  heldCount: number;
}

interface Props {
  catalogs: Catalog[];
}

type Filter = 'all' | 'held' | 'author_held' | 'unheld';
type Sort = 'author' | 'year' | 'condemned';

const PAGE_SIZE = 50;

export default function IndexCatalogSection({ catalogs }: Props) {
  const [activeIndexId, setActiveIndexId] = useState<string>(catalogs[0]?.indexId ?? '');
  const active = useMemo(() => catalogs.find(c => c.indexId === activeIndexId) || catalogs[0], [activeIndexId, catalogs]);

  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [total, setTotal] = useState(active?.totalEntries ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('author');
  const [page, setPage] = useState(1);

  // Reset paging when switching tabs
  useEffect(() => { setPage(1); }, [activeIndexId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!active) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(PAGE_SIZE),
        filter,
        sort,
      });
      if (q.trim().length >= 2) params.set('q', q.trim());
      const r = await fetch(`/api/catalogs/${active.indexId}/entries?${params}`, { signal });
      if (!r.ok) throw new Error(`API ${r.status}`);
      const data = await r.json();
      setEntries(data.entries || []);
      setTotal(data.total ?? 0);
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return;
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, [active, page, filter, sort, q]);

  useEffect(() => {
    const ctrl = new AbortController();
    const id = setTimeout(() => load(ctrl.signal), q ? 300 : 0);
    return () => { clearTimeout(id); ctrl.abort(); };
  }, [load, q]);

  if (!active) return null;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Header copy adapts to single-catalog vs multi-catalog
  const totalAllEditions = catalogs.reduce((s, c) => s + c.totalEntries, 0);
  const totalHeldAllEditions = catalogs.reduce((s, c) => s + c.heldCount, 0);

  return (
    <section className="mt-16 border-t border-stone-300 pt-12">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-stone-500 mb-2">
          <BookMarked className="w-3.5 h-3.5" />
          <span>Reference catalog</span>
        </div>
        <h2 className="text-3xl font-display font-semibold mb-2 text-stone-900">
          The Index, by edition
        </h2>
        <p className="text-stone-700 max-w-3xl">
          The catalog is extracted directly from the OCR of our own scanned printed editions of the Index Librorum Prohibitorum. Across {catalogs.length} editions ({Math.min(...catalogs.map(c => c.startYear || 9999))}&ndash;{Math.max(...catalogs.map(c => c.startYear || 0))}), <strong>{totalAllEditions.toLocaleString()}</strong> banned-book entries. Of these, <strong>{totalHeldAllEditions.toLocaleString()}</strong> link to a book held by Source Library.
        </p>
      </header>

      {/* Edition tabs */}
      {catalogs.length > 1 && (
        <div className="flex flex-wrap gap-1 mb-6 border-b border-stone-200">
          {catalogs.map(c => (
            <button
              key={c.indexId}
              onClick={() => setActiveIndexId(c.indexId)}
              className={
                'px-4 py-2 text-sm border-b-2 -mb-px ' +
                (c.indexId === active.indexId
                  ? 'border-stone-800 text-stone-900 font-medium'
                  : 'border-transparent text-stone-500 hover:text-stone-800 hover:border-stone-300')
              }
            >
              <span className="font-display">{c.startYear ?? '?'}</span>
              <span className="ml-1 text-xs text-stone-400">({c.totalEntries.toLocaleString()})</span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-4">
        <div className="font-display text-lg text-stone-800">{active.indexName}</div>
        <div className="text-sm text-stone-500 mt-0.5">
          {active.totalEntries.toLocaleString()} entries · <strong>{active.heldCount}</strong> held by Source Library
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6 text-sm">
        <div className="relative flex-grow min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="search"
            value={q}
            onChange={e => { setPage(1); setQ(e.target.value); }}
            placeholder="Search title or author…"
            className="w-full pl-9 pr-3 py-2 border border-stone-300 rounded bg-white focus:border-stone-500 focus:outline-none"
          />
        </div>

        <div className="flex gap-1 border border-stone-300 rounded overflow-hidden">
          {(['all', 'held', 'author_held', 'unheld'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => { setPage(1); setFilter(f); }}
              className={`px-3 py-1.5 ${filter === f ? 'bg-stone-800 text-white' : 'bg-white text-stone-700 hover:bg-stone-100'}`}
              title={
                f === 'held' ? 'This exact work is in the library' :
                f === 'author_held' ? 'We hold writings by this author, though not this specific work' :
                f === 'unheld' ? 'Neither the work nor the author is in the library' :
                undefined
              }
            >
              {f === 'all' ? 'All' :
               f === 'held' ? 'Work in library' :
               f === 'author_held' ? 'Author in library' :
               'Not held'}
            </button>
          ))}
        </div>

        <select
          value={sort}
          onChange={e => { setPage(1); setSort(e.target.value as Sort); }}
          className="px-3 py-1.5 border border-stone-300 rounded bg-white"
        >
          <option value="author">Sort: Author</option>
          <option value="year">Sort: Publication year</option>
          <option value="condemned">Sort: Condemnation year</option>
        </select>

        <div className="ml-auto text-stone-600 text-xs">
          {total.toLocaleString()} {total === 1 ? 'entry' : 'entries'}
        </div>
      </div>

      {/* Entries list */}
      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded text-sm">
          Failed to load: {error}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left">
                <tr className="text-stone-700">
                  <th className="px-3 py-2 font-medium">Author</th>
                  <th className="px-3 py-2 font-medium">Work</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Condemned</th>
                  <th className="px-3 py-2 font-medium">Scope</th>
                  <th className="px-3 py-2 font-medium">In the library</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {loading && entries.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-stone-500">Loading…</td></tr>
                ) : entries.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-stone-500">No matching entries.</td></tr>
                ) : entries.map(e => {
                  const scopeBadge =
                    e.scope === 'opera_omnia' ? { label: 'Opera omnia', cls: 'bg-red-100 text-red-900' } :
                    e.scope === 'donec_corrigatur' ? { label: 'Donec corrigatur', cls: 'bg-amber-100 text-amber-900' } :
                    e.scope === 'expurgated' ? { label: 'Expurgated', cls: 'bg-amber-100 text-amber-900' } :
                    e.scope === 'single_work' ? { label: 'Banned', cls: 'bg-stone-100 text-stone-700' } : null;
                  return (
                    <tr key={e.id} className="align-top hover:bg-stone-50/60">
                      <td className="px-3 py-2.5 text-stone-700 whitespace-nowrap">{e.author || <span className="text-stone-400">—</span>}</td>
                      <td className="px-3 py-2.5 font-display text-stone-900 min-w-[14rem]">
                        {e.sl_book_slug
                          ? <Link href={`/book/${e.sl_book_slug}`} className="hover:underline">{e.title}</Link>
                          : <span>{e.title}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-stone-500 whitespace-nowrap">{e.condemnation_year ?? e.publication_date ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        {scopeBadge && (
                          <span className={`inline-block text-[10px] uppercase tracking-wider ${scopeBadge.cls} px-1.5 py-0.5 rounded`}>
                            {scopeBadge.label}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {e.sl_book_slug ? (
                          <Link href={`/book/${e.sl_book_slug}`} className="inline-flex items-center gap-1 text-stone-800 hover:underline">
                            <BookOpen className="w-3.5 h-3.5" /> Read
                          </Link>
                        ) : e.author_held_count && e.author_held_count > 0 && e.author_held_sample_slug ? (
                          <Link href={`/book/${e.author_held_sample_slug}`} className="inline-flex items-center gap-1 text-amber-800 hover:underline"
                            title={`We hold ${e.author_held_count} book${e.author_held_count === 1 ? '' : 's'} by this author, not this specific work`}>
                            <User className="w-3.5 h-3.5" /> {e.author_held_count} by author
                          </Link>
                        ) : e.ustc_sn ? (
                          <a href={`https://www.ustc.ac.uk/editions/${e.ustc_sn}`} target="_blank" rel="noopener"
                            className="inline-flex items-center gap-1 text-stone-500 hover:underline">
                            <ExternalLink className="w-3.5 h-3.5" /> USTC
                          </a>
                        ) : <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {e.source_book_slug && e.source_page != null ? (
                          <Link href={`/book/${e.source_book_slug}/page-number/${e.source_page}`}
                            className="inline-flex items-center gap-1 text-stone-500 hover:underline"
                            title="See this entry on the original scanned page of the printed Index">
                            <BookMarked className="w-3.5 h-3.5" /> p.{e.source_page}
                          </Link>
                        ) : <span className="text-stone-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <nav className="flex items-center justify-between mt-6 text-sm">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="px-3 py-1.5 border border-stone-300 rounded disabled:opacity-40"
              >
                ← Previous
              </button>
              <span className="text-stone-600">Page {page.toLocaleString()} of {totalPages.toLocaleString()}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="px-3 py-1.5 border border-stone-300 rounded disabled:opacity-40"
              >
                Next →
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
