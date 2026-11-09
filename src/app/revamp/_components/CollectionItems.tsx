'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, LayoutGrid, List } from 'lucide-react';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import CollectionListView from '@/components/collections/CollectionListView';
import CatalogPagination from '@/components/collections/CatalogPagination';
import SortSelect from '@/components/search-kit/SortSelect';
import FilterChips from '@/components/search-kit/FilterChips';
import GalleryMasonry, { type Plate } from '@/components/GalleryMasonry';
import type { Book } from '../_lib/types';
import { getBookThumbnailUrl } from '@/lib/utils';
import CollectionEditor from './CollectionEditor';
import { SORTS, docKey, initialDoc, type CollectionDoc } from '../_lib/collection-doc';

const PER = 20;
/** The /gallery filter pill (GalleryControls), unchanged. */
const pill = (on: boolean) => `h-[30px] px-3 border text-[13px] ${on ? 'bg-primary border-primary text-cream' : 'bg-white border-border-medium text-primary hover:border-primary'}`;
const H2 = 'text-2xl sm:text-3xl text-primary font-display';
const fmt = (v: number) => v.toLocaleString('en-GB');
const titleOf = (b: Book) => (b.display_title || b.title || '').replace(/^(the|a|an)\s+/i, '');
type Pics = 'tab' | 'together' | 'mixA' | 'mixB' | 'mixC';
type Entry = { kind: 'work'; b: Book } | { kind: 'image'; p: Plate; from: Book };
const MIXED: [Pics, string][] = [['mixA', 'Mixed A: columns'], ['mixB', 'Mixed B: rows'], ['mixC', 'Mixed C: each work, then its pictures']];
const decade = (y?: number) => (y ? `${Math.floor(y / 100) * 100}s` : 'Undated');

export interface ItemsProps {
  slug: string;
  books: Book[];
  notes: { id: string; rank: number; note: string }[];
  plates: Plate[];
  imagesTotal: number;
  byBook: Record<string, Plate[]>;
}

/**
 * The base collection page below the hero: works and images, sorted, filtered and grouped with the
 * Library's own controls. How much shows depends on the size: up to 12 works, just the works and
 * their notes; over 60, filters too. What the maker sets (order, sections, notes, default order) comes
 * from the collection document, edited in CollectionEditor.
 */
export default function CollectionItems({ slug, books, notes, plates, imagesTotal, byBook }: ItemsProps) {
  const original = initialDoc(books, notes);
  const [saved, setSaved] = useState<CollectionDoc | null>(null);
  const [editing, setEditing] = useState(false);
  const [pics, setPics] = useState<Pics>('tab');
  const [tab, setTab] = useState<'works' | 'images'>('works');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sortPick, setSort] = useState<string | null>(null);
  const [groupPick, setGroup] = useState('none');
  const [lang, setLang] = useState('all');
  const [cent, setCent] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  // Each cover's own proportions, measured as it loads (pictures know theirs already).
  const [asp, setAsp] = useState<Record<string, number>>({});
  const top = useRef<HTMLDivElement>(null);

  // The hero's "Search within" bar sends its words here.
  useEffect(() => {
    const on = (e: Event) => { setQ((e as CustomEvent<string>).detail.trim()); setTab('works'); setPage(1); top.current?.scrollIntoView({ behavior: 'smooth' }); };
    window.addEventListener('collection-search', on);
    return () => window.removeEventListener('collection-search', on);
  }, []);

  // The maker's saved version (prototype: this browser only), read once after mounting.
  useEffect(() => {
    const raw = localStorage.getItem(docKey(slug));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (raw) try { setSaved(JSON.parse(raw)); } catch { /* ignore a broken save */ }
  }, [slug]);
  const doc = saved ?? original;
  const byId: Record<string, Book> = { ...Object.fromEntries(books.map((b) => [b.id!, b])), ...doc.added };
  const works = doc.order.flatMap((e) => (e.kind === 'work' && byId[e.id] ? [byId[e.id]] : []));
  const place = new Map(doc.order.map((e, i) => [e.id, i]));
  // Each work's section: the last heading above it in the maker's order.
  const sectionOf = new Map<string, string>();
  const sections = new Map<string, { heading: string; text: string }>();
  let cur = '';
  for (const e of doc.order) { if (e.kind === 'section') { cur = e.id; sections.set(e.id, e); } else sectionOf.set(e.id, cur); }
  const noteOf = doc.notes;
  const n = works.length;
  const small = n <= 12;
  const big = n > 60;
  const langCount = new Map<string, number>();
  for (const b of works) if (b.language) langCount.set(b.language, (langCount.get(b.language) ?? 0) + 1);
  const langs = [...langCount.entries()].sort((a, b) => b[1] - a[1]);
  const cents = [...new Set(works.map((b) => decade(b.year)))].sort();
  const canCentury = !small && works.filter((b) => b.year).length >= n * 0.8 && cents.length > 1;
  const canLang = !small && langs.length >= 3;
  const sort = sortPick ?? doc.sort;
  // In the maker's order, their sections are the groups.
  const hasSections = sections.size > 0;
  const group = sort === 'maker' && hasSections ? 'sections' : groupPick;
  const by: Record<string, (a: Book, b: Book) => number> = {
    maker: (a, b) => (place.get(a.id!) ?? 0) - (place.get(b.id!) ?? 0),
    year_asc: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || titleOf(a).localeCompare(titleOf(b)),
    year_desc: (a, b) => (b.year ?? 0) - (a.year ?? 0) || titleOf(a).localeCompare(titleOf(b)),
    title: (a, b) => titleOf(a).localeCompare(titleOf(b), 'en'),
    author: (a, b) => (a.author || '~').localeCompare(b.author || '~', 'en'),
  };
  const t = q.toLowerCase();
  let list = works.filter((b) => (lang === 'all' || b.language === lang) && (cent === 'all' || decade(b.year) === cent)
    && (!t || `${b.display_title} ${b.title} ${b.author} ${noteOf[b.id!] ?? ''}`.toLowerCase().includes(t)));
  list = [...list].sort(by[group === 'sections' ? 'maker' : sort] ?? by.year_asc);
  const keyOf = (b: Book) => group === 'century' ? decade(b.year) : group === 'language' ? (b.language || 'Language not recorded') : group === 'sections' ? (sectionOf.get(b.id!) ?? '') : '';
  if (group === 'century') list.sort((a, b) => decade(a.year).localeCompare(decade(b.year)));
  if (group === 'language') list.sort((a, b) => (langCount.get(b.language!) ?? 0) - (langCount.get(a.language!) ?? 0) || (a.language || '').localeCompare(b.language || ''));
  const keyed = list.map((b) => ({ b, k: keyOf(b) }));
  const groupSize = new Map<string, number>();
  for (const x of keyed) groupSize.set(x.k, (groupSize.get(x.k) ?? 0) + 1);

  const mixed = pics.startsWith('mix');
  const mine = (b: Book) => (byBook[b.id!] ?? []).map((p) => ({ kind: 'image' as const, p, from: b }));
  let entries: Entry[] = [];
  if (pics === 'mixC') entries = list.flatMap((b) => [{ kind: 'work' as const, b }, ...mine(b)]);
  else if (mixed) {
    // Works and pictures taken in turn, one of each, until one runs out.
    const w = list.map((b) => ({ kind: 'work' as const, b }));
    const im = list.flatMap(mine);
    for (let i = 0; i < Math.max(w.length, im.length); i++) entries.push(...(w[i] ? [w[i]] : []), ...(im[i] ? [im[i]] : []));
  }
  const MPER = 24;
  const last = Math.max(1, Math.ceil((mixed ? entries.length : keyed.length) / (mixed ? MPER : PER)));
  const at = Math.min(page, last);
  const shown = small || mixed ? keyed : keyed.slice((at - 1) * PER, at * PER);
  const pageEntries = entries.slice((at - 1) * MPER, at * MPER);
  const blocks: { k: string; items: Book[] }[] = [];
  for (const x of shown) { if (blocks.at(-1)?.k !== x.k) blocks.push({ k: x.k, items: [] }); blocks.at(-1)!.items.push(x.b); }

  const go = (p: number) => { setPage(p); top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const notesOn = noteOf;

  const card = (b: Book) => (
    <div key={b.id} className="relative">
      {/* Wrapped so the card's own full height doesn't push the note into the next row. */}
      <div><CollectionBookCard book={b as unknown as CollectionBook} /></div>
      {notesOn[b.id!] && <p className="mt-2 text-[13px] text-secondary leading-snug line-clamp-4">{notesOn[b.id!]}</p>}
    </div>
  );
  // Together: each work as a row, its own pictures beside it at their own proportions.
  const row = (b: Book) => (
    <div key={b.id} className="grid grid-cols-[110px_minmax(0,1fr)] sm:grid-cols-[150px_minmax(0,1fr)] gap-4 sm:gap-6 py-5 border-t border-border-light first:border-t-0">
      {card({ ...b })}
      <div className="min-w-0">
        {notesOn[b.id!] && <p className="text-[14.5px] text-secondary leading-relaxed max-w-2xl mb-3">{notesOn[b.id!]}</p>}
        {byBook[b.id!]?.length ? (
          <div className="flex h-[150px] sm:h-[190px] overflow-x-auto [scrollbar-width:thin]" style={{ background: '#1a1612' }}>
            {byBook[b.id!].map((p) => <a key={p.src} href={p.href} className="shrink-0 h-full"><img src={p.src} alt={p.label || ''} loading="lazy" className="h-full w-auto max-w-none block hover:opacity-85" /></a>)}
          </div>
        ) : <p className="text-[13px] text-muted">No pictures saved for this work in the prototype.</p>}
      </div>
    </div>
  );
  // Mixed grid: every item at its own proportions, bottom-aligned and centred, caption under it.
  const src = (e: Entry) => e.kind === 'work' ? getBookThumbnailUrl(e.b as never, 'display') : e.p.src;
  const href = (e: Entry) => e.kind === 'work' ? `/book/${e.b.slug || e.b.id}` : e.p.href;
  const key = (e: Entry) => e.kind === 'work' ? `w-${e.b.id}` : `i-${e.p.src}`;
  const ratio = (e: Entry) => e.kind === 'image' ? (e.p.w && e.p.h ? e.p.w / e.p.h : 0.75) : (asp[e.b.id!] ?? 0.7);
  const capH = Object.values(noteOf).some(Boolean) ? 'h-[138px]' : 'h-[70px]';
  const caption = (e: Entry) => (
    <div className={`pt-3 overflow-hidden ${capH}`}>
      {e.kind === 'work' ? <>
        <p className="font-serif text-[15.5px] leading-snug text-primary line-clamp-2">{e.b.display_title || e.b.title}</p>
        <p className="text-[12.5px] text-muted truncate">{[e.b.author, e.b.year].filter(Boolean).join(', ')}</p>
        {notesOn[e.b.id!] && <p className="mt-1 text-[12.5px] text-secondary leading-snug line-clamp-3">{notesOn[e.b.id!]}</p>}
      </> : <p className="text-[12.5px] text-muted leading-snug line-clamp-2">Picture from {e.from.display_title || e.from.title}</p>}
    </div>
  );
  const picture = (e: Entry, cls: string) => {
    const u = src(e);
    return u ? <img src={u} alt={e.kind === 'work' ? (e.b.display_title || e.b.title) : (e.p.label || '')} loading="lazy" className={cls}
      onLoad={e.kind === 'work' && !asp[e.b.id!] ? (ev) => { const t = ev.currentTarget; if (t.naturalWidth) setAsp((a) => ({ ...a, [e.b.id!]: t.naturalWidth / t.naturalHeight })); } : undefined} />
      : <span className="block w-full aspect-[7/10] bg-warm" />;
  };
  const columns = (es: Entry[]) => (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 md:gap-x-10 gap-y-10 md:gap-y-12">
      {es.map((e) => (
        <a key={key(e)} href={href(e)} className="group flex flex-col">
          <span className="flex-1 flex items-end justify-center min-h-0"><span className="block group-hover:opacity-90 transition-opacity">{picture(e, 'block max-w-full max-h-[420px] w-auto h-auto mx-auto')}</span></span>
          {caption(e)}
        </a>
      ))}
    </div>
  );
  const rows = (es: Entry[]) => (
    <div className="flex flex-wrap gap-x-6 md:gap-x-8 gap-y-10">
      {es.map((e) => {
        const r = ratio(e);
        return (
          <a key={key(e)} href={href(e)} className="group block min-w-0" style={{ flexGrow: r * 100, flexBasis: `${r * 230}px` }}>
            <span className="block relative w-full bg-warm" style={{ paddingBottom: `${100 / r}%` }}>{picture(e, 'absolute inset-0 w-full h-full object-cover group-hover:opacity-90 transition-opacity')}</span>
            {caption(e)}
          </a>
        );
      })}
      <span aria-hidden style={{ flexGrow: 1e6 }} />
    </div>
  );
  const body = (items: Book[]) => pics === 'together' ? <div>{items.map(row)}</div>
    : view === 'list' ? <CollectionListView books={items as never} sort={sort} onSort={reset(setSort)} notes={notesOn} fromCollection={slug} />
    : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-6">{items.map(card)}</div>;

  const imagesHere = plates.length > 0;
  const tabs = !small && imagesHere && pics === 'tab';
  const chips = [q && { key: 'q', label: `“${q}”` }, lang !== 'all' && { key: 'lang', label: lang }, cent !== 'all' && { key: 'cent', label: cent }].filter(Boolean) as { key: string; label: string }[];
  const clear = (k: string) => { if (k === 'q') setQ(''); if (k === 'lang') setLang('all'); if (k === 'cent') setCent('all'); setPage(1); };

  const images = (
    <>
      <GalleryMasonry plates={plates} />
      {imagesTotal > plates.length && (
        <div className="mt-6"><Link href={`/gallery?collection=${slug}`} className="inline-flex items-center gap-2 h-11 px-5 bg-primary text-cream text-sm font-medium hover:opacity-90">See all {fmt(imagesTotal)} in the Gallery <ArrowRight className="w-4 h-4" /></Link></div>
      )}
    </>
  );

  const done = (d: CollectionDoc) => { setSaved(d); localStorage.setItem(docKey(slug), JSON.stringify(d)); setEditing(false); setSort(null); setPage(1); };

  return (
    <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-12">
      {/* Prototype only: not part of the page. */}
      <div className="border border-dashed border-border-medium bg-white px-4 py-3 mb-10 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted mr-1">Prototype only.</span>
        <button type="button" onClick={() => setEditing(true)} className="h-[30px] px-3 bg-primary text-cream text-[13px]">Edit as the maker</button>
        {saved && <span className="text-muted ml-1">Your edits are kept in this browser.</span>}
        {imagesHere && <>
          <span className="text-muted ml-3 mr-1">Pictures:</span>
          <button type="button" aria-pressed={pics === 'tab'} onClick={() => setPics('tab')} className={pill(pics === 'tab')}>Separate</button>
          <button type="button" aria-pressed={pics === 'together'} onClick={() => setPics('together')} className={pill(pics === 'together')}>With their works</button>
          {MIXED.map(([k, l]) => <button key={k} type="button" aria-pressed={pics === k} onClick={() => { setPics(k); setPage(1); }} className={pill(pics === k)}>{l}</button>)}
        </>}
      </div>

      {editing && <div className="mb-12"><CollectionEditor start={doc} original={original} books={byId} onDone={done} onCancel={() => setEditing(false)} /></div>}

      <div ref={top} className="scroll-mt-24" id="works">
        {tabs ? (
          <div className="flex items-center gap-2 mb-5" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'works'} onClick={() => setTab('works')} className={pill(tab === 'works')}>Works {fmt(n)}</button>
            <button type="button" role="tab" aria-selected={tab === 'images'} onClick={() => setTab('images')} className={pill(tab === 'images')}>Images {fmt(imagesTotal)}</button>
          </div>
        ) : <h2 className={`${H2} mb-5`}>{mixed && imagesHere ? "Works and images" : "Works"}</h2>}

        {(!tabs || tab === 'works') && <>
          {!small && (
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 mb-6">
              <span className="text-[13.5px] text-muted mr-2">{fmt(list.length)} {list.length === 1 ? 'work' : 'works'}{list.length < n ? ` of ${fmt(n)}` : ''}</span>
              {big && canLang && <SortSelect label="Language" value={lang} onChange={reset(setLang)} options={[['all', 'Any language'], ...langs.map(([l, c]) => [l, `${l} (${c})`] as [string, string])]} />}
              {big && canCentury && <SortSelect label="Century" value={cent} onChange={reset(setCent)} options={[['all', 'Any date'], ...cents.map((c) => [c, c] as [string, string])]} />}
              <FilterChips chips={chips} onRemove={clear} onClearAll={() => chips.forEach((c) => clear(c.key))} />
              <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
                {group !== 'sections' && !mixed && (canCentury || canLang) && <SortSelect label="Group" value={groupPick} onChange={reset(setGroup)} options={[['none', 'Not grouped'], ...(canCentury ? [['century', 'By century'] as [string, string]] : []), ...(canLang ? [['language', 'By language'] as [string, string]] : [])]} />}
                <SortSelect value={sort} onChange={reset(setSort)} options={SORTS} />
                {pics === 'tab' && (
                  <div className="flex border border-border-medium" role="group" aria-label="View">
                    <button type="button" aria-pressed={view === 'grid'} aria-label="Grid" onClick={() => setView('grid')} className={`w-8 h-[34px] sm:w-[38px] sm:h-9 grid place-items-center ${view === 'grid' ? 'bg-warm text-primary' : 'bg-white text-muted'}`}><LayoutGrid className="w-4 h-4" /></button>
                    <button type="button" aria-pressed={view === 'list'} aria-label="List" onClick={() => setView('list')} className={`w-8 h-[34px] sm:w-[38px] sm:h-9 grid place-items-center ${view === 'list' ? 'bg-warm text-primary' : 'bg-white text-muted'}`}><List className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
            </div>
          )}
          {list.length === 0 && <p className="py-10 text-muted">No works match. <button type="button" className="underline underline-offset-[3px]" onClick={() => chips.forEach((c) => clear(c.key))}>Clear the search</button></p>}
          {mixed && (pics === 'mixB' ? rows(pageEntries) : columns(pageEntries))}
          {!mixed && blocks.map((g, i) => (
            <div key={`${g.k}-${i}`} className={g.k ? 'mb-10' : ''}>
              {g.k && (
                <div className="flex items-baseline gap-3 mb-4">
                  <h3 className="text-xl text-primary font-display">{group === 'sections' ? (sections.get(g.k)?.heading || 'Untitled section') : g.k}</h3>
                  <span className="text-[13px] text-muted">{groupSize.get(g.k)} {groupSize.get(g.k) === 1 ? 'work' : 'works'}</span>
                </div>
              )}
              {group === 'sections' && sections.get(g.k)?.text && <p className="text-[15px] text-secondary leading-relaxed -mt-2 mb-5 max-w-2xl">{sections.get(g.k)!.text}</p>}
              {body(g.items)}
            </div>
          ))}
          {(!small || mixed) && last > 1 && <div className="mt-8"><CatalogPagination currentPage={at} totalPages={last} onPageChange={go} variant="search" /></div>}
        </>}

        {tabs && tab === 'images' && images}
      </div>

      {!tabs && imagesHere && pics === 'tab' && (
        <section className="mt-14">
          <h2 className={`${H2} mb-5`}>Images</h2>
          {images}
        </section>
      )}
    </div>
  );
}
