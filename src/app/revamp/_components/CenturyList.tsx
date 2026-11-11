'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import SortSelect from '@/components/search-kit/SortSelect';
import { FIRST, TOOLBAR, TOP } from './CollectionsBrowser';
import type { SubjectRow } from './SubjectsBrowser';

const WRAP = 'max-w-[var(--container-wide)] mx-auto px-6 md:px-12';
const n = (v: number) => v.toLocaleString('en-GB');

/**
 * Centuries as one list in time order, each with a bar for how many books it holds, like the live
 * Centuries page. No groups: library date spans are plain spans.
 */
export default function CenturyList({ rows, how }: { rows: (SubjectRow & { name: string })[]; how: { title: string; items: ReactNode[] } }) {
  const [order, setOrder] = useState('new');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => {
    const on = (e: Event) => setQ((e as CustomEvent<string>).detail);
    window.addEventListener('collection-search', on);
    return () => window.removeEventListener('collection-search', on);
  }, []);
  const t = q.trim().toLowerCase();
  const max = Math.max(1, ...rows.map((r) => r.size ?? 0));
  const shown = rows.filter((r) => !t || [r.label, r.name, ...r.alt].some((x) => x.toLowerCase().includes(t)));
  const list = order === 'new' ? [...shown].reverse() : order === 'size' ? [...shown].sort((a, b) => (b.size ?? 0) - (a.size ?? 0)) : shown;
  return (
    <div className={`${WRAP} ${TOP} pb-16`}>
      <div className={TOOLBAR}>
        <span className="text-sm text-primary font-medium mr-1">{list.length} centuries</span>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="ml-2 text-[13px] text-muted underline decoration-border-medium underline-offset-[3px] hover:text-primary hover:decoration-primary">{how.title} {open ? '−' : '+'}</button>
        <div className="ml-auto"><SortSelect label="Order" value={order} onChange={setOrder} options={[['new', 'Newest first'], ['old', 'Oldest first'], ['size', 'Most books first']]} /></div>
      </div>
      {open && <ul className="max-w-2xl mt-3 bg-warm border border-border-light px-5 py-4 space-y-1.5 text-[14.5px] text-secondary leading-relaxed list-disc pl-9">{how.items.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      <ul className={`${FIRST} border-t border-border-light`}>
        {list.map((r) => (
          <li key={r.id} className="border-b border-border-light">
            <Link href={r.href ?? '#'} className="group grid grid-cols-[44px_1fr_auto] sm:grid-cols-[44px_220px_1fr_110px] items-center gap-3 sm:gap-5 py-2.5 hover:bg-white">
              <span className="relative w-11 h-11 overflow-hidden bg-warm">{r.pics[0] && <img src={r.pics[0].src} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}</span>
              <span className="min-w-0">
                <span className="block font-serif text-[18px] text-primary leading-tight group-hover:underline underline-offset-[3px]">{r.label}</span>
                <span className="block text-[12.5px] text-muted">{r.name}</span>
              </span>
              <span className="hidden sm:block h-2 bg-border-light" aria-hidden><span className="block h-full bg-primary/70" style={{ width: `${Math.max(0.6, (100 * (r.size ?? 0)) / max)}%` }} /></span>
              <span className="text-[13.5px] text-secondary text-right tabular-nums">{n(r.size ?? 0)} {r.size === 1 ? 'book' : 'books'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
