'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { BookMarked, ExternalLink, Search, BookOpen } from 'lucide-react';

interface Work {
  work_key: string;
  author: string | null;
  title: string;
  scope: string | null;
  edition_ids: string[];
  edition_count: number;
  first_year: number | null;
  last_year: number | null;
  ustc_sn: number | null;
  sl_book_id: string | null;
  sl_book_slug: string | null;
}

interface Catalog {
  indexId: string;
  indexName: string;
  startYear: number | null;
  totalEntries: number;
  heldCount: number;
}

interface Props {
  collectionSlug: string;
  catalogs: Catalog[];
}

type Filter = 'all' | 'held' | 'unheld';
type Sort = 'author' | 'first_year' | 'edition_count';
type Mode = 'any' | 'all';

const PAGE_SIZE = 50;

export default function IndexCatalogWorksTable({ collectionSlug, catalogs }: Props) {
  // Sort editions ascending by year for column order
  const sortedCatalogs = useMemo(() =>
    [...catalogs].sort((a, b) => (a.startYear ?? 9999) - (b.startYear ?? 9999)),
  [catalogs]);

  const [works, setWorks] = useState<Work[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [q, setQ] = useState('');
  const [selectedEditions, setSelectedEditions] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>('any');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('edition_count');
  const [page, setPage] = useState(1);

  const totalAllEntries = sortedCatalogs.reduce((s, c) => s + c.totalEntries, 0);
  const totalAllHeld = sortedCatalogs.reduce((s, c) => s + c.heldCount, 0);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        collection: collectionSlug,
        page: String(page),
        page_size: String(PAGE_SIZE),
        filter,
        filter_mode: mode,
        sort,
      });
      if (q.trim().length >= 2) params.set('q', q.trim());
      if (selectedEditions.size > 0) params.set('editions', [...selectedEditions].join(','));
      const r = await fetch(`/api/catalogs/works?${params}`, { signal });
      if (!r.ok) throw new Error(`API ${r.status}`);
      const data = await r.json();
      setWorks(data.works || []);
      setTotal(data.total ?? 0);
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return;
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, [collectionSlug, page, filter, mode, sort, q, selectedEditions]);

  useEffect(() => {
    const ctrl = new AbortController();
    const id = setTimeout(() => load(ctrl.signal), q ? 300 : 0);
    return () => { clearTimeout(id); ctrl.abort(); };
  }, [load, q]);

  const toggleEdition = (id: string) => {
    setSelectedEditions(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setPage(1);
  };

  const clearEditions = () => { setSelectedEditions(new Set()); setPage(1); };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="mt-16 border-t border-stone-300 pt-12">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-stone-500 mb-2">
          <BookMarked className="w-3.5 h-3.5" />
          <span>Reference catalog · {sortedCatalogs.length} editions ({sortedCatalogs[0]?.startYear}–{sortedCatalogs[sortedCatalogs.length - 1]?.startYear})</span>
        </div>
        <h2 className="text-3xl font-display font-semibold mb-2 text-stone-900">
          What was banned, by edition
        </h2>
        <p className="text-stone-700 max-w-3xl">
          Each row is one banned work. The columns show which Index editions condemned it. <strong>{totalAllEntries.toLocaleString()}</strong> raw entries across editions deduplicate to ~{Math.round(total > 0 ? total : totalAllEntries * 0.5).toLocaleString()} distinct works. <strong>{totalAllHeld.toLocaleString()}</strong> link to a book held by Source Library. Click any year header to filter.
        </p>
      </header>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
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
          {(['all', 'held', 'unheld'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => { setPage(1); setFilter(f); }}
              className={`px-3 py-1.5 ${filter === f ? 'bg-stone-800 text-white' : 'bg-white text-stone-700 hover:bg-stone-100'}`}
            >
              {f === 'all' ? 'All' : f === 'held' ? 'In library' : 'Not held'}
            </button>
          ))}
        </div>

        <select
          value={sort}
          onChange={e => { setPage(1); setSort(e.target.value as Sort); }}
          className="px-3 py-1.5 border border-stone-300 rounded bg-white"
        >
          <option value="edition_count">Sort: Most banned editions</option>
          <option value="author">Sort: Author</option>
          <option value="first_year">Sort: First appearance</option>
        </select>

        <div className="ml-auto text-stone-600 text-xs">
          {total.toLocaleString()} {total === 1 ? 'work' : 'works'}
        </div>
      </div>

      {/* Edition selector */}
      {selectedEditions.size > 0 && (
        <div className="flex items-center gap-3 mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm">
          <span className="text-stone-700">
            Filtering to {selectedEditions.size} edition{selectedEditions.size > 1 ? 's' : ''} —
          </span>
          <div className="flex gap-1 border border-stone-300 rounded overflow-hidden bg-white">
            {(['any', 'all'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setPage(1); }}
                className={`px-3 py-1 ${mode === m ? 'bg-stone-700 text-white' : 'text-stone-700 hover:bg-stone-100'}`}
              >
                {m === 'any' ? 'banned in ANY' : 'banned in ALL'}
              </button>
            ))}
          </div>
          <button onClick={clearEditions} className="ml-auto text-stone-500 hover:text-stone-800 underline">clear</button>
        </div>
      )}

      {/* Table */}
      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded text-sm">Failed to load: {error}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-t border-b border-stone-200">
            <thead className="bg-stone-50">
              <tr>
                <th className="text-left py-2 px-3 font-medium text-stone-700">Author</th>
                <th className="text-left py-2 px-3 font-medium text-stone-700">Work</th>
                {sortedCatalogs.map(c => (
                  <th
                    key={c.indexId}
                    onClick={() => toggleEdition(c.indexId)}
                    className={
                      'py-2 px-2 font-medium text-center text-xs cursor-pointer select-none border-l border-stone-200 ' +
                      (selectedEditions.has(c.indexId)
                        ? 'bg-stone-800 text-white hover:bg-stone-900'
                        : 'text-stone-600 hover:bg-stone-100')
                    }
                    title={c.indexName}
                  >
                    {c.startYear ?? '?'}
                  </th>
                ))}
                <th className="py-2 px-3 text-center font-medium text-stone-700 border-l border-stone-200">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && works.length === 0 ? (
                <tr><td colSpan={sortedCatalogs.length + 3} className="py-8 text-center text-stone-500">Loading…</td></tr>
              ) : works.length === 0 ? (
                <tr><td colSpan={sortedCatalogs.length + 3} className="py-8 text-center text-stone-500">No matching works.</td></tr>
              ) : works.map(w => (
                <tr key={w.work_key} className="border-t border-stone-100 hover:bg-stone-50">
                  <td className="py-2 px-3 align-top">
                    <div className="text-stone-800">{w.author || <span className="text-stone-400 italic">anonymous</span>}</div>
                  </td>
                  <td className="py-2 px-3 align-top">
                    <div className="text-stone-900 font-display">
                      {w.sl_book_slug ? (
                        <Link href={`/book/${w.sl_book_slug}`} className="hover:underline">{w.title}</Link>
                      ) : (
                        w.title
                      )}
                    </div>
                    {w.scope === 'opera_omnia' && (
                      <span className="inline-block mt-1 text-[10px] uppercase tracking-wider bg-red-100 text-red-900 px-1.5 py-0.5 rounded">Opera omnia</span>
                    )}
                    {w.scope === 'donec_corrigatur' && (
                      <span className="inline-block mt-1 text-[10px] uppercase tracking-wider bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded">Donec corrigatur</span>
                    )}
                    {w.scope === 'expurgated' && (
                      <span className="inline-block mt-1 text-[10px] uppercase tracking-wider bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded">Expurgated</span>
                    )}
                  </td>
                  {sortedCatalogs.map(c => (
                    <td key={c.indexId} className="py-2 px-2 text-center border-l border-stone-100">
                      {w.edition_ids.includes(c.indexId) ? <span className="text-stone-800">●</span> : <span className="text-stone-200">·</span>}
                    </td>
                  ))}
                  <td className="py-2 px-3 text-center border-l border-stone-100">
                    {w.sl_book_slug ? (
                      <Link href={`/book/${w.sl_book_slug}`} className="inline-flex items-center gap-1 text-xs bg-stone-800 text-white px-2 py-1 rounded hover:bg-stone-900">
                        <BookOpen className="w-3 h-3" />Read
                      </Link>
                    ) : w.ustc_sn ? (
                      <a href={`https://www.ustc.ac.uk/editions/${w.ustc_sn}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs text-stone-600 hover:text-stone-900">
                        <ExternalLink className="w-3 h-3" />USTC {w.ustc_sn}
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-between mt-6 text-sm">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="px-3 py-1.5 border border-stone-300 rounded disabled:opacity-40"
          >← Previous</button>
          <span className="text-stone-600">Page {page.toLocaleString()} of {totalPages.toLocaleString()}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="px-3 py-1.5 border border-stone-300 rounded disabled:opacity-40"
          >Next →</button>
        </nav>
      )}
    </section>
  );
}
