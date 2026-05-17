'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { BookMarked, ExternalLink, Search, BookOpen } from 'lucide-react';

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
}

interface Props {
  indexId: string;        // e.g. 'roman-1948'
  indexName: string;      // e.g. 'Index Librorum Prohibitorum (1946 final)'
  totalEntries: number;   // for the header label
  heldCount: number;      // how many we have in SL
}

type Filter = 'all' | 'held' | 'unheld';
type Sort = 'author' | 'year' | 'condemned';

const PAGE_SIZE = 50;

export default function IndexCatalogSection({ indexId, indexName, totalEntries, heldCount }: Props) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [total, setTotal] = useState(totalEntries);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('author');
  const [page, setPage] = useState(1);

  const load = useCallback(async (signal?: AbortSignal) => {
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
      const r = await fetch(`/api/catalogs/${indexId}/entries?${params}`, { signal });
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
  }, [indexId, page, filter, sort, q]);

  useEffect(() => {
    const ctrl = new AbortController();
    // Debounce search input
    const id = setTimeout(() => load(ctrl.signal), q ? 300 : 0);
    return () => { clearTimeout(id); ctrl.abort(); };
  }, [load, q]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="mt-16 border-t border-stone-300 pt-12">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-stone-500 mb-2">
          <BookMarked className="w-3.5 h-3.5" />
          <span>Reference catalog</span>
        </div>
        <h2 className="text-3xl font-display font-semibold mb-2 text-stone-900">
          The full {indexName}
        </h2>
        <p className="text-stone-700 max-w-3xl">
          Every work on the index. <strong>{heldCount.toLocaleString()}</strong> are held in Source Library
          and link back to the book; the remaining <strong>{(totalEntries - heldCount).toLocaleString()}</strong>
          {' '}are reference entries with USTC and acquisition pointers.
        </p>
      </header>

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
          <ul className="divide-y divide-stone-200 border-t border-b border-stone-200">
            {loading && entries.length === 0 ? (
              <li className="py-8 text-center text-stone-500 text-sm">Loading…</li>
            ) : entries.length === 0 ? (
              <li className="py-8 text-center text-stone-500 text-sm">No matching entries.</li>
            ) : entries.map(e => (
              <li key={e.id} className="py-4 flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-4">
                <div className="flex-grow min-w-0">
                  <div className="font-display text-base text-stone-900 leading-snug">
                    {e.sl_book_slug ? (
                      <Link href={`/book/${e.sl_book_slug}`} className="hover:underline">{e.title}</Link>
                    ) : (
                      <span>{e.title}</span>
                    )}
                  </div>
                  <div className="text-sm text-stone-600 mt-0.5">
                    {e.author && <span>{e.author}</span>}
                    {e.publication_date && <span className="text-stone-400"> · {e.publication_date}</span>}
                    {e.condemnation_year && (
                      <span className="text-stone-400"> · Condemned {e.condemnation_period || e.condemnation_year}</span>
                    )}
                    {e.scope === 'opera_omnia' && (
                      <span className="ml-2 inline-block text-[10px] uppercase tracking-wider bg-red-100 text-red-900 px-1.5 py-0.5 rounded">
                        Opera omnia
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {e.sl_book_slug ? (
                    <Link
                      href={`/book/${e.sl_book_slug}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-stone-800 text-white rounded hover:bg-stone-900"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      Read at Source Library
                    </Link>
                  ) : e.ustc_sn ? (
                    <a
                      href={`https://www.ustc.ac.uk/editions/${e.ustc_sn}`}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1 px-3 py-1.5 border border-stone-400 text-stone-700 rounded hover:bg-stone-100"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      USTC {e.ustc_sn}
                    </a>
                  ) : (
                    <span className="px-3 py-1.5 text-stone-400 italic">Not yet linked</span>
                  )}
                </div>
              </li>
            ))}
          </ul>

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
