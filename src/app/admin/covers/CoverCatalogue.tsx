'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

/**
 * Choose a book to make a cover for: the library as a filterable grid of
 * covers. Reads the public /api/books/library (visible books only) with the
 * same filters the catalogue uses; the filters live in the URL so Back keeps
 * your place.
 */

interface Book {
  id: string; title: string; display_title?: string | null; author?: string; language?: string;
  year?: number | string | null; published?: string; image_thumb?: string; thumbnail?: string; pages_count?: number;
}
interface Option { value: string; label: string }

const CENTURIES: Option[] = [
  { value: '', label: 'Any date' },
  { value: '0-1449', label: 'Manuscript era (before 1450)' },
  ...[1450, 1500, 1600, 1700, 1800, 1900].map(y => ({ value: `${y}-${y === 1450 ? 1499 : y + 99}`, label: y === 1450 ? 'Incunabula (1450–1500)' : `${y}s` })),
];

const SORTS: Option[] = [
  { value: 'date_asc', label: 'Oldest first' },
  { value: 'date_desc', label: 'Newest first' },
  { value: 'title-asc', label: 'Title A–Z' },
  { value: 'recent', label: 'Recently added' },
];

const PAGE = 48;

export interface CatalogueFilters { q: string; collection: string; language: string; century: string; sort: string }

export default function CoverCatalogue({ conceptBooks, initial }: { conceptBooks: Record<string, number>; initial: CatalogueFilters }) {
  const [f, setF] = useState<CatalogueFilters>(initial);
  const [q, setQ] = useState(f.q);
  const [books, setBooks] = useState<Book[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [collections, setCollections] = useState<Option[]>([]);
  const [languages, setLanguages] = useState<Option[]>([]);
  const req = useRef(0);

  useEffect(() => {
    fetch('/api/collections').then(r => r.json()).then(d => {
      const list = (d.collections || d || []) as { slug: string; name: string }[];
      setCollections(list.map(c => ({ value: c.slug, label: c.name })).sort((a, b) => a.label.localeCompare(b.label)));
    }).catch(() => {});
    fetch('/api/languages').then(r => r.json()).then(d => {
      setLanguages(((d.languages || []) as { code: string; name: string; book_count: number }[]).slice(0, 40).map(l => ({ value: l.code, label: `${l.name} (${l.book_count.toLocaleString()})` })));
    }).catch(() => {});
  }, []);

  // Debounce typing into the filter state.
  useEffect(() => {
    const t = setTimeout(() => setF(x => (x.q === q.trim() ? x : { ...x, q: q.trim() })), 300);
    return () => clearTimeout(t);
  }, [q]);

  const query = (skip: number) => {
    const p = new URLSearchParams({ limit: String(PAGE), skip: String(skip), sort: f.sort });
    if (f.q) p.set('search', f.q);
    if (f.collection) p.set('collection', f.collection);
    if (f.language) p.set('language', f.language);
    if (f.century) { const [a, b] = f.century.split('-'); p.set('year_from', a); p.set('year_to', b); }
    return `/api/books/library?${p}`;
  };

  useEffect(() => {
    const url = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    window.history.replaceState(null, '', `${window.location.pathname}${url.size ? `?${url}` : ''}`);
    const n = ++req.current;
    // Loading state for a fetch an effect starts: the result lands asynchronously.
     
    setLoading(true);
    fetch(query(0)).then(r => r.json()).then(d => {
      if (n !== req.current) return;
      setBooks(d.books || []);
      setTotal(typeof d.total === 'number' ? d.total : null);
    }).catch(() => {}).finally(() => { if (n === req.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);

  const more = () => {
    const n = ++req.current;
    setLoading(true);
    fetch(query(books.length)).then(r => r.json()).then(d => {
      if (n === req.current) setBooks(b => [...b, ...(d.books || [])]);
    }).catch(() => {}).finally(() => { if (n === req.current) setLoading(false); });
  };

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement>) => setF(x => ({ ...x, [k]: e.target.value }));
  const active = !!(f.q || f.collection || f.language || f.century);
  const select = 'px-3 py-2 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-white)] max-w-full';

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <label className="relative flex-1 min-w-[240px]">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Title, author, subject…"
            className="w-full pl-10 pr-3 py-2 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-white)]"
            style={{ fontSize: 16 }}
          />
        </label>
        <select className={select} style={{ fontSize: 16 }} value={f.collection} onChange={set('collection')} aria-label="Collection">
          <option value="">All collections</option>
          {collections.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className={select} style={{ fontSize: 16 }} value={f.language} onChange={set('language')} aria-label="Language">
          <option value="">All languages</option>
          {languages.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className={select} style={{ fontSize: 16 }} value={f.century} onChange={set('century')} aria-label="Date">
          {CENTURIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className={select} style={{ fontSize: 16 }} value={f.sort} onChange={set('sort')} aria-label="Sort">
          {SORTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {active && (
          <button className="flex items-center gap-1 text-sm px-2 py-2 rounded hover:bg-[var(--bg-warm)]"
            onClick={() => { setQ(''); setF(x => ({ ...x, q: '', collection: '', language: '', century: '' })); }}>
            <X className="w-4 h-4" /> Clear
          </button>
        )}
      </div>
      <p className="text-sm text-[var(--text-muted)] mb-4">
        {total == null ? (loading ? 'Loading…' : '') : `${total.toLocaleString()} book${total === 1 ? '' : 's'}`}
      </p>

      <ul className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-x-4 gap-y-6">
        {books.map(b => {
          const img = b.image_thumb || b.thumbnail;
          const saved = conceptBooks[b.id];
          return (
            <li key={b.id}>
              <Link href={`/admin/covers/${b.id}`} className="block group">
                <div className="relative aspect-[2/3] bg-[var(--bg-warm)] rounded-sm overflow-hidden shadow-sm group-hover:ring-2 ring-[var(--accent-rust)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {img && <img src={img} alt="" loading="lazy" className="w-full h-full object-cover" />}
                  {saved ? <span className="absolute top-1.5 left-1.5 text-[11px] px-1.5 py-0.5 rounded bg-[var(--text-primary)] text-[var(--bg-cream)]">{saved} saved</span> : null}
                </div>
                <span className="text-sm mt-1.5 leading-snug line-clamp-2">{b.title}</span>
                <span className="text-xs text-[var(--text-muted)] line-clamp-1">{[b.author?.replace(/\s*\([^)]*\)/g, ''), b.year || b.published].filter(Boolean).join(' · ')}</span>
                {b.language && <span className="block text-xs text-[var(--text-muted)]">{b.language}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
      {!loading && total === 0 && <p className="text-sm text-[var(--text-muted)]">No books match. Try fewer filters.</p>}
      {total != null && books.length < total && (
        <div className="flex justify-center mt-8">
          <button className="px-4 py-2 rounded-lg border border-[var(--border-medium)] hover:bg-[var(--bg-warm)] disabled:opacity-50" onClick={more} disabled={loading}>
            {loading ? 'Loading…' : `Show more (${(total - books.length).toLocaleString()} left)`}
          </button>
        </div>
      )}
    </div>
  );
}
