'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { LayoutGrid, List } from 'lucide-react';
import SearchAskBars from '@/components/search-kit/SearchAskBars';
import type { IndexItem } from '../_lib/data';

const HOLDS: [string, string][] = [['books', 'Books'], ['plates', 'Plates'], ['artworks', 'Artworks'], ['pages', 'Pages'], ['quotes', 'Quotes']];
const SORTS: [string, string][] = [['featured', 'Featured first'], ['books', 'Most books'], ['images', 'Most images'], ['az', 'A to Z']];
const n = (v: number) => v.toLocaleString('en-GB');

export interface Crop { src: string; x: number; y: number; w: number; aspect: number }
export const cropKey = (slug: string) => `revamp-thumb:${slug}`;

/** A square cut from one image. x, y: top-left as fractions of the image; w: side as a fraction of its width; aspect: width / height. */
export function CropSquare({ crop, className = '' }: { crop: Crop; className?: string }) {
  return (
    <div className={`aspect-square overflow-hidden relative bg-warm ${className}`}>
      <img src={crop.src} alt="" loading="lazy" className="absolute max-w-none" style={{ width: `${100 / crop.w}%`, left: `${(-crop.x / crop.w) * 100}%`, top: `${(-crop.y / (crop.w * crop.aspect)) * 100}%` }} />
    </div>
  );
}

/** Square: one representative picture, the maker's own crop if they chose one. Strip: covers, pages and plates in a row, no gaps, each at its own proportions. */
export function Thumb({ item, mode }: { item: IndexItem; mode: 'square' | 'strip' }) {
  const [own, setOwn] = useState<Crop | null>(null);
  useEffect(() => { try { const v = localStorage.getItem(cropKey(item.slug)); if (v) setOwn(JSON.parse(v)); } catch { /* none saved */ } }, [item.slug]);
  if (mode === 'strip') {
    const s = item.strip?.length ? item.strip : item.thumbs;
    return (
      <div className="aspect-[5/2] overflow-hidden flex" style={{ background: '#1a1612' }}>
        {s.map((src, i) => <img key={i} src={src} alt="" loading="lazy" className="h-full w-auto max-w-none shrink-0 block" />)}
      </div>
    );
  }
  if (own) return <CropSquare crop={own} />;
  const src = item.cover || item.thumbs[0];
  if (!src) return <div className="aspect-square bg-warm" />;
  return <div className="aspect-square overflow-hidden bg-warm"><img src={src} alt="" loading="lazy" className="w-full h-full object-cover" /></div>;
}

const pl = (v: number, w: string) => (v ? `${n(v)} ${w}${v === 1 ? '' : 's'}` : '');
const meta = (c: IndexItem) => [
  pl(c.books, 'book'), pl(c.images, 'image'), pl(c.artworks, 'artwork'), pl(c.pages, 'page'), pl(c.quotes, 'quote'),
].filter(Boolean).join(' · ');

export default function CollectionsBrowser({ items, featured, subjects, initialSubject = '' }: { items: IndexItem[]; featured?: string; subjects: { name: string; slugs: string[] }[]; initialSubject?: string }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [ask, setAsk] = useState('');
  const [maker, setMaker] = useState<'all' | 'source-library' | 'reader'>('all');
  const [holds, setHolds] = useState<string[]>([]);
  const [lang, setLang] = useState('');
  const [subject, setSubject] = useState(initialSubject);
  const [sort, setSort] = useState('featured');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [thumb, setThumb] = useState<'square' | 'strip'>('square');

  const languages = useMemo(() => {
    const c = new Map<string, number>();
    items.forEach((i) => i.languages.forEach((l) => c.set(l, (c.get(l) ?? 0) + 1)));
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([l]) => l);
  }, [items]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sub = subjects.find((s) => s.name === subject);
    const r = items.filter((i) => (maker === 'all' || i.maker === maker)
      && holds.every((h) => i.holds.includes(h))
      && (!lang || i.languages.includes(lang))
      && (!sub || sub.slugs.includes(i.slug))
      && (!q || `${i.name} ${i.deck}`.toLowerCase().includes(q)));
    const by: Record<string, (a: IndexItem, b: IndexItem) => number> = {
      featured: (a, b) => Number(b.slug === featured) - Number(a.slug === featured) || Number(!!a.example) - Number(!!b.example) || a.order - b.order,
      books: (a, b) => b.books - a.books,
      images: (a, b) => (b.images + b.artworks) - (a.images + a.artworks),
      az: (a, b) => a.name.localeCompare(b.name),
    };
    return [...r].sort(by[sort]);
  }, [items, query, maker, holds, lang, subject, sort, featured, subjects]);

  const tile = 'bg-warm border border-border-light px-3 py-2.5 sm:p-5';
  const pick = (on: boolean) => `text-left px-2 py-0.5 -mx-0.5 text-sm ${on ? 'bg-primary text-cream' : 'text-primary hover:bg-border-light'}`;
  const sel = 'h-9 sm:h-[38px] px-2.5 border border-border-medium bg-white text-base sm:text-sm';
  const count = (k: string) => items.filter((i) => i.holds.includes(k)).length;

  return (
    <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-10">
      <h1 className="text-4xl sm:text-5xl text-primary font-display mb-5">Collections</h1>
      <SearchAskBars
        search={{ id: 'col-search', label: 'Search the collections', placeholder: 'Name, subject, person', value: text, onChange: (v) => { setText(v); setQuery(v); }, onSubmit: setQuery, examples: ['Slime Moulds', 'Sibyls', 'Yoga'] }}
        ask={{ id: 'col-ask', label: 'Ask the librarian', placeholder: 'What are you looking for?', value: ask, onChange: setAsk, onSubmit: (v) => window.open(`https://sourcelibrary.org/librarian?q=${encodeURIComponent(v)}`, '_blank', 'noopener'), examples: ['dragons and monsters', 'witch trials in German'] }}
      />

      <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_2.2fr] mt-5">
        <div className={`${tile} hidden md:block`}>
          <div className="text-3xl sm:text-[34px] leading-none text-primary font-medium">{n(shown.length)}</div>
          <div className="text-sm text-muted mt-1.5">{shown.length === 1 ? 'collection' : 'collections'}</div>
        </div>
        <div className={tile}>
          <div className="text-sm text-muted mb-1.5">Made by</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {([['all', 'Anyone', items.length], ['source-library', 'Source Library', items.filter((i) => i.maker === 'source-library').length], ['reader', 'Readers', items.filter((i) => i.maker === 'reader').length]] as const).map(([k, l, c]) => (
              <button key={k} type="button" aria-pressed={maker === k} onClick={() => setMaker(k)} className={pick(maker === k)}>{l} <span className="opacity-60">{n(c)}</span></button>
            ))}
          </div>
        </div>
        <div className={tile}>
          <div className="text-sm text-muted mb-1.5">Holds</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {HOLDS.map(([k, l]) => (
              <button key={k} type="button" aria-pressed={holds.includes(k)} onClick={() => setHolds(holds.includes(k) ? holds.filter((h) => h !== k) : [...holds, k])} className={pick(holds.includes(k))}>{l} <span className="opacity-60">{n(count(k))}</span></button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 mt-4 pb-3 border-b border-border-light">
        {subjects.length > 0 && (
          <select aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={sel}>
            <option value="">All subjects</option>{subjects.map((s) => <option key={s.name}>{s.name}</option>)}
          </select>
        )}
        <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)} className={sel}>
          <option value="">All languages</option>{languages.map((l) => <option key={l}>{l}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} className={sel}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <div className="flex border border-border-medium" role="group" aria-label="View">
            <button type="button" aria-label="Grid" aria-pressed={view === 'grid'} onClick={() => setView('grid')} className={`w-[38px] h-9 grid place-items-center ${view === 'grid' ? 'bg-warm text-primary' : 'bg-white text-muted'}`}><LayoutGrid className="w-4 h-4" /></button>
            <button type="button" aria-label="List" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`w-[38px] h-9 grid place-items-center ${view === 'list' ? 'bg-warm text-primary' : 'bg-white text-muted'}`}><List className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      <div className="flex justify-between md:justify-end gap-2 items-center text-xs text-muted mt-2">
        <span className="md:hidden">{n(shown.length)} collections</span><span className="flex gap-2 items-center">Thumbnails
        {(['square', 'strip'] as const).map((k) => <button key={k} type="button" aria-pressed={thumb === k} onClick={() => setThumb(k)} className={thumb === k ? 'text-primary underline underline-offset-2' : ''}>{k === 'square' ? 'Square' : 'Strip'}</button>)}</span>
      </div>

      {shown.length === 0 ? (
        <p className="py-16 text-center text-muted">{maker === 'reader' ? 'No reader collections are public yet.' : 'Nothing matches all of that. Remove one of the filters above.'}</p>
      ) : view === 'grid' ? (
        <div className={`grid gap-x-5 gap-y-8 mt-4 ${thumb === 'strip' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'}`}>
          {shown.map((c) => (
            <Link key={c.slug} href={c.href} className="block group">
              <Thumb item={c} mode={thumb} />
              <span className="block mt-2.5 text-[17px] leading-snug text-primary font-display group-hover:underline underline-offset-2">{c.name}</span>
              <span className="block text-[13px] text-muted mt-0.5">{[c.label, c.example ? 'Example' : null, meta(c)].filter(Boolean).join(' · ')}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-4">
          {shown.map((c) => (
            <Link key={c.slug} href={c.href} className="grid grid-cols-[72px_1fr] gap-4 py-3 border-t border-border-light group">
              <Thumb item={c} mode="square" />
              <span className="min-w-0">
                <span className="block text-[17px] text-primary font-display group-hover:underline underline-offset-2">{c.name}</span>
                <span className="block text-sm text-secondary truncate">{c.deck}</span>
                <span className="block text-[13px] text-muted">{[c.label, c.example ? 'Example' : null, meta(c)].filter(Boolean).join(' · ')}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
