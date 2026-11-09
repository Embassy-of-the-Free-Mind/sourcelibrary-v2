'use client';

import { useRef, useState } from 'react';
import CatalogPagination from '@/components/collections/CatalogPagination';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';

const PER = 20;

/** Twenty works a page, paginated in place with the Library's own pagination (CatalogPagination, variant "search"). Pages past the saved ones load from the live site. */
export default function WorksGrid({ books, total, slug }: { books: CollectionBook[]; total: number; slug: string }) {
  const [page, setPage] = useState(1);
  const [fetched, setFetched] = useState<Record<number, CollectionBook[]>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const top = useRef<HTMLDivElement>(null);
  const last = Math.max(1, Math.ceil(total / PER));
  const local = books.slice((page - 1) * PER, page * PER);
  const shown = fetched[page] ?? local;

  const go = async (p: number) => {
    setPage(p); setErr('');
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const need = books.slice((p - 1) * PER, p * PER).length < Math.min(PER, total - (p - 1) * PER);
    if (!need || fetched[p]) return;
    setBusy(true);
    try {
      const r = await fetch(`/revamp/api/works?slug=${slug}&offset=${(p - 1) * PER}`);
      const j = await r.json();
      if (!r.ok) throw new Error(r.status === 429 ? 'The live site asked us to slow down. Try again in a minute.' : 'This page could not load.');
      setFetched((f) => ({ ...f, [p]: j.books }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div ref={top} className="scroll-mt-24">
      <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 transition-opacity ${busy ? 'opacity-40' : ''}`}>
        {shown.map((b) => <CollectionBookCard key={b.id} book={b} />)}
      </div>
      {err && <p className="mt-6 text-center text-sm text-muted">{err}</p>}
      <div className="mt-8"><CatalogPagination currentPage={page} totalPages={last} onPageChange={go} variant="search" /></div>
    </div>
  );
}
