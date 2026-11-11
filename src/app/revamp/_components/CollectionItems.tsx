'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronDown, LayoutGrid, List } from 'lucide-react';
import { filtersBtn } from './CollectionsBrowser';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import CollectionListView from '@/components/collections/CollectionListView';
import CatalogPagination from '@/components/collections/CatalogPagination';
import SortSelect from '@/components/search-kit/SortSelect';
import FilterChips from '@/components/search-kit/FilterChips';
import GalleryMasonry, { type Plate } from '@/components/GalleryMasonry';
import type { Book, RPlate } from '../_lib/types';
import { PERIODS, PICTURE_TYPES, TEXT_TYPES, centuryLabel, centuryOf, periodLabel, periodsOf } from '../_lib/facets';
import CollectionEditor from './CollectionEditor';
import { SORTS, docKey, initialDoc, type CollectionDoc } from '../_lib/collection-doc';

const PER = 20;
/** The /gallery filter pill (GalleryControls), unchanged. */
const pill = (on: boolean) => `h-[30px] px-3 border text-[13px] ${on ? 'bg-primary border-primary text-cream' : 'bg-white border-border-medium text-primary hover:border-primary'}`;
const H2 = 'text-2xl sm:text-3xl text-primary font-display';
const fmt = (v: number) => v.toLocaleString('en-GB');
const titleOf = (b: Book) => (b.display_title || b.title || '').replace(/^(the|a|an)\s+/i, '');
type Pics = 'tab' | 'mixA';
type Entry = { kind: 'work'; b: Book } | { kind: 'image'; p: Plate; from: Book };
const NONE = 'none';
/** Options for a facet menu: every value with its count, in the given order, then the untagged. */
const facetOptions = (all: string, counts: Map<string, number>, order: string[], label: (v: string) => string, none: string): [string, string][] => [
  ['all', all],
  ...order.filter((v) => counts.has(v)).map((v) => [v, `${label(v)} (${counts.get(v)})`] as [string, string]),
  ...(counts.has(NONE) ? [[NONE, `${none} (${counts.get(NONE)})`] as [string, string]] : []),
];
const tally = (lists: string[][]) => { const m = new Map<string, number>(); for (const l of lists) for (const v of l.length ? l : [NONE]) m.set(v, (m.get(v) ?? 0) + 1); return m; };
const matches = (pick: string, vs: string[]) => pick === 'all' || (pick === NONE ? vs.length === 0 : vs.includes(pick));
const typesOf = (b: Book) => (b.form ?? []).filter((f) => TEXT_TYPES[f]);
const ORDER_T = Object.keys(TEXT_TYPES);
const ORDER_P = PERIODS.map((p) => p.id);
const ORDER_I = Object.keys(PICTURE_TYPES);
const FORMATS: Record<string, string> = { book: 'Printed', manuscript: 'Manuscript' };
const formatOf = (b: Book) => (b.material && FORMATS[b.material] ? [b.material] : []);

export interface ItemsProps {
  slug: string;
  books: Book[];
  notes: { id: string; rank: number; note: string }[];
  plates: RPlate[];
  imagesTotal: number;
  byBook: Record<string, RPlate[]>;
  /** False on a subject page: nobody makes a subject, so there is no maker's version to load or edit. */
  curated?: boolean;
  /** Prototype only: a line in the prototype box, such as how much of the list is saved. */
  protoNote?: string;
}

/**
 * The base collection page below the hero: works and images, sorted, filtered and grouped with the
 * Library's own controls. How much shows depends on the size: up to 12 works, just the works and
 * their notes; over 60, filters too. What the maker sets (order, sections, notes, default order) comes
 * from the collection document, edited in CollectionEditor.
 */
export default function CollectionItems({ slug, books, notes, plates, imagesTotal, byBook, curated = true, protoNote }: ItemsProps) {
  const original = initialDoc(books, notes);
  const [saved, setSaved] = useState<CollectionDoc | null>(null);
  const [editing, setEditing] = useState(false);
  const [pics, setPics] = useState<Pics>('tab');
  const [tab, setTab] = useState<'works' | 'images'>('works');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sortPick, setSort] = useState<string | null>(null);
  const [groupPick, setGroup] = useState('none');
  const [lang, setLang] = useState('all');
  const [ttype, setTtype] = useState('all');
  const [period, setPeriod] = useState('all');
  const [ptype, setPtype] = useState('all');
  const [fmtPick, setFmt] = useState('all');
  const [made, setMade] = useState('all');
  const [how, setHow] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  // The hero's "Search within" bar sends its words here.
  useEffect(() => {
    const on = (e: Event) => { setQ((e as CustomEvent<string>).detail.trim()); setTab('works'); setPage(1); top.current?.scrollIntoView({ behavior: 'smooth' }); };
    window.addEventListener('collection-search', on);
    return () => window.removeEventListener('collection-search', on);
  }, []);

  // The maker's saved version (prototype: this browser only), read once after mounting.
  useEffect(() => {
    if (!curated) return;
    const raw = localStorage.getItem(docKey(slug));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (raw) try { setSaved(JSON.parse(raw)); } catch { /* ignore a broken save */ }
  }, [slug, curated]);
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
  // Type and period: each its own menu; a work must match every one chosen.
  const typeCount = tally(works.map(typesOf));
  const periodCount = tally(works.map(periodsOf));
  const formatCount = tally(works.map(formatOf));
  const canFormat = !small && formatCount.has('book') && formatCount.has('manuscript');
  const madeOf = (b: Book) => { const c = centuryOf(b.year); return c ? [String(c)] : []; };
  const madeCount = tally(works.map(madeOf));
  const madeOrder = [...madeCount.keys()].filter((k) => k !== NONE).sort((a, b) => Number(a) - Number(b));
  const canMade = !small && madeOrder.length > 1;
  const canType = !small && [...typeCount.keys()].filter((k) => k !== NONE).length > 1;
  const canPeriod = !small && [...periodCount.keys()].filter((k) => k !== NONE).length > 1;
  const firstPeriod = (b: Book) => [...periodsOf(b)].sort((x, y) => ORDER_P.indexOf(x) - ORDER_P.indexOf(y))[0] ?? NONE;
  const canLang = !small && langs.length >= 3;
  // A subject has no maker's order: oldest first, and no "Maker's order" to choose.
  const sort = sortPick ?? (curated ? doc.sort : 'year_asc');
  const sorts = curated ? SORTS : SORTS.filter(([k]) => k !== 'maker');
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
  let list = works.filter((b) => (lang === 'all' || b.language === lang) && matches(ttype, typesOf(b)) && matches(fmtPick, formatOf(b)) && matches(made, madeOf(b)) && matches(period, periodsOf(b))
    && (!t || `${b.display_title} ${b.title} ${b.author} ${noteOf[b.id!] ?? ''}`.toLowerCase().includes(t)));
  list = [...list].sort(by[group === 'sections' ? 'maker' : sort] ?? by.year_asc);
  const keyOf = (b: Book) => group === 'made' ? (madeOf(b)[0] ?? NONE) : group === 'period' ? firstPeriod(b) : group === 'type' ? (typesOf(b)[0] ?? NONE) : group === 'language' ? (b.language || 'Language not recorded') : group === 'sections' ? (sectionOf.get(b.id!) ?? '') : '';
  const rank = (order: string[], v: string) => (v === NONE ? 999 : order.indexOf(v));
  if (group === 'made') list.sort((a, b) => (centuryOf(a.year) ?? 9999) - (centuryOf(b.year) ?? 9999));
  if (group === 'period') list.sort((a, b) => rank(ORDER_P, firstPeriod(a)) - rank(ORDER_P, firstPeriod(b)));
  if (group === 'type') list.sort((a, b) => rank(ORDER_T, typesOf(a)[0] ?? NONE) - rank(ORDER_T, typesOf(b)[0] ?? NONE));
  if (group === 'language') list.sort((a, b) => (langCount.get(b.language!) ?? 0) - (langCount.get(a.language!) ?? 0) || (a.language || '').localeCompare(b.language || ''));
  const keyed = list.map((b) => ({ b, k: keyOf(b) }));
  const groupSize = new Map<string, number>();
  for (const x of keyed) groupSize.set(x.k, (groupSize.get(x.k) ?? 0) + 1);

  const mixed = pics.startsWith('mix');
  // Pictures: their own type, and the period of the work they come from.
  const picOk = (p: RPlate) => ptype === 'all' || (ptype === NONE ? !p.kind || !PICTURE_TYPES[p.kind] : p.kind === ptype);
  const plateBook = (p: RPlate) => (p.bookId ? byId[p.bookId] : undefined);
  const shownPlates = plates.filter((p) => picOk(p) && (period === 'all' || (() => { const b = plateBook(p); return b ? matches(period, periodsOf(b)) : period === NONE; })()));
  const picCount = tally(plates.map((p) => (p.kind && PICTURE_TYPES[p.kind] ? [p.kind] : [])));
  const canPicType = [...picCount.keys()].filter((k) => k !== NONE).length > 1;
  const picPeriodCount = tally(plates.map((p) => { const b = plateBook(p); return b ? periodsOf(b) : []; }));
  const mine = (b: Book) => (byBook[b.id!] ?? []).filter(picOk).map((p) => ({ kind: 'image' as const, p, from: b }));
  const entries: Entry[] = [];
  if (mixed) {
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
  // Mixed: works and pictures in one grid, five to a row. Works keep the usual book card; pictures
  // the gallery's picture card at their own proportions. Each cell sits on the row's bottom line.
  const tile = (e: Entry) => e.kind === 'work' ? card(e.b) : (
    <a key={`i-${e.p.src}`} href={e.p.href} title={e.p.label} className="group block">
      <span className="block w-full overflow-hidden border border-border-light">
        <img src={e.p.src} alt={e.p.label || 'Illustration'} loading="lazy" decoding="async" width={e.p.w} height={e.p.h}
          style={e.p.w && e.p.h ? { aspectRatio: `${e.p.w} / ${e.p.h}` } : undefined}
          className="w-full h-auto block bg-warm group-hover:scale-105 transition-transform duration-300" />
      </span>
    </a>
  );
  const columns = (es: Entry[]) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-6 items-end">{es.map(tile)}</div>
  );
  const body = (items: Book[]) => view === 'list' ? <CollectionListView books={items as never} sort={sort} onSort={reset(setSort)} notes={notesOn} fromCollection={slug} />
    : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-6">{items.map(card)}</div>;

  const imagesHere = plates.length > 0;
  const tabs = !small && imagesHere && pics === 'tab';
  const chips = [q && { key: 'q', label: `“${q}”` }, lang !== 'all' && { key: 'lang', label: lang },
    fmtPick !== 'all' && { key: 'format', label: fmtPick === NONE ? 'Format not recorded' : FORMATS[fmtPick] },
    ttype !== 'all' && { key: 'type', label: ttype === NONE ? 'Type not recorded' : TEXT_TYPES[ttype] },
    period !== 'all' && { key: 'period', label: period === NONE ? 'Written: not recorded' : `Written: ${periodLabel(period)}` },
    made !== 'all' && { key: 'made', label: made === NONE ? 'Made: undated' : `Made: ${centuryLabel(Number(made))}` },
    ptype !== 'all' && { key: 'ptype', label: ptype === NONE ? 'Picture type not recorded' : PICTURE_TYPES[ptype] }].filter(Boolean) as { key: string; label: string }[];
  const clear = (k: string) => { if (k === 'q') setQ(''); if (k === 'lang') setLang('all'); if (k === 'type') setTtype('all'); if (k === 'format') setFmt('all'); if (k === 'period') setPeriod('all'); if (k === 'made') setMade('all'); if (k === 'ptype') setPtype('all'); setPage(1); };
  const formatMenu = canFormat && <SortSelect label="Format" value={fmtPick} onChange={reset(setFmt)} options={facetOptions('Printed or manuscript', formatCount, ['book', 'manuscript'], (v) => FORMATS[v], 'Not recorded')} />;
  const hasMenus = (big && canLang) || canType || canFormat || canPeriod || canMade || (mixed && canPicType);
  const active = [lang, ttype, fmtPick, period, made, ...(mixed ? [ptype] : [])].filter((v) => v !== 'all').length;
  // How each filter is described, and the standard it follows. Same pattern as "How we choose subjects".
  const howBtn = (cls: string) => <button type="button" aria-expanded={how} aria-controls="how-described" onClick={() => setHow(!how)} className={`${cls} text-[13px] text-muted underline decoration-border-medium underline-offset-[3px] hover:text-primary hover:decoration-primary`}>How we describe works {how ? '−' : '+'}</button>;
  const howList = how && (
    <ul id="how-described" className="max-w-3xl -mt-2 mb-8 bg-warm border border-border-light px-5 py-4 space-y-1.5 text-[14.5px] text-secondary leading-relaxed list-disc pl-9">
      <li><b className="font-medium text-primary">Subjects</b> are our own list, each linked to the library standards FAST and Wikidata where a match exists.</li>
      <li><b className="font-medium text-primary">Type</b> is the kind of text, named after the Library of Congress genre and form terms.</li>
      <li><b className="font-medium text-primary">Printed or manuscript</b> follows the split library catalogue records already make.</li>
      <li><b className="font-medium text-primary">Period written</b> is when the original text was written, by era with fixed dates. The era names are ours: no shared standard covers every culture.</li>
      <li><b className="font-medium text-primary">Date made</b> is the century this copy was printed or written out, as a date span, the way library catalogues give dates (FAST).</li>
      <li><b className="font-medium text-primary">Picture type</b> is named after the Getty Art &amp; Architecture Thesaurus.</li>
      <li><b className="font-medium text-primary">Language</b> is the language of this copy, which can differ from the original&apos;s.</li>
      <li>Not every work is described yet. Those that aren&apos;t are counted under &ldquo;not recorded&rdquo;. <Link href="/revamp/standards" className="text-primary underline underline-offset-[3px]">Every term against its standard</Link></li>
    </ul>
  );
  const typeMenu = canType && <SortSelect label="Type" value={ttype} onChange={reset(setTtype)} options={facetOptions('Any type', typeCount, ORDER_T, (v) => TEXT_TYPES[v], 'Type not recorded')} />;
  const periodMenu = (counts: Map<string, number>) => <SortSelect label="Period written" value={period} onChange={reset(setPeriod)} options={facetOptions('Written any time', counts, ORDER_P, periodLabel, 'Not recorded')} />;
  const madeMenu = canMade && <SortSelect label="Date made" value={made} onChange={reset(setMade)} options={facetOptions('Made any time', madeCount, madeOrder, (v) => centuryLabel(Number(v)), 'Undated')} />;
  const picTypeMenu = canPicType && <SortSelect label="Picture type" value={ptype} onChange={reset(setPtype)} options={facetOptions(mixed ? 'Any picture' : 'Any type', picCount, ORDER_I, (v) => PICTURE_TYPES[v], 'Type not recorded')} />;

  const images = (
    <>
      {(canPicType || canPeriod) && (
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 mb-6">
          <span className="text-[13.5px] text-muted mr-2">{fmt(shownPlates.length)} {shownPlates.length === 1 ? 'picture' : 'pictures'}{shownPlates.length < plates.length ? ` of ${fmt(plates.length)}` : ''}</span>
          {picTypeMenu}
          {canPeriod && periodMenu(picPeriodCount)}
          <FilterChips chips={chips.filter((c) => c.key === 'ptype' || c.key === 'period')} onRemove={clear} onClearAll={() => { clear('ptype'); clear('period'); }} />
          {howBtn('ml-2')}
        </div>
      )}
      {(canPicType || canPeriod) && howList}
      {shownPlates.length === 0 ? <p className="py-10 text-muted">No pictures match. <button type="button" className="underline underline-offset-[3px]" onClick={() => { clear('ptype'); clear('period'); }}>Clear the filters</button></p> : <GalleryMasonry plates={shownPlates} />}
      {imagesTotal > plates.length && (
        <div className="mt-6"><Link href={`/gallery?collection=${slug}`} className="inline-flex items-center gap-2 h-11 px-5 bg-primary text-cream text-sm font-medium hover:opacity-90">See all {fmt(imagesTotal)} in the Gallery <ArrowRight className="w-4 h-4" /></Link></div>
      )}
    </>
  );

  const done = (d: CollectionDoc) => { setSaved(d); localStorage.setItem(docKey(slug), JSON.stringify(d)); setEditing(false); setSort(null); setPage(1); };

  // A page of pictures only (a picture type): no works, so just the pictures and their filters.
  if (n === 0 && !curated && imagesHere) return (
    <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-12" id="works">
      {protoNote && <p className="border border-dashed border-border-medium bg-white px-4 py-3 mb-10 text-[13px] text-muted">Prototype only. {protoNote}</p>}
      <h2 className={`${H2} mb-5`}>Pictures</h2>
      {images}
    </div>
  );

  return (
    <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-12">
      {/* Prototype only: not part of the page. */}
      <div className="border border-dashed border-border-medium bg-white px-4 py-3 mb-10 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted mr-1">Prototype only.{protoNote && ` ${protoNote}`}</span>
        {curated && <button type="button" onClick={() => setEditing(true)} className="h-[30px] px-3 bg-primary text-cream text-[13px]">Edit as the maker</button>}
        {saved && <span className="text-muted ml-1">Your edits are kept in this browser.</span>}
        {imagesHere && <>
          <span className="text-muted ml-3 mr-1">Pictures:</span>
          <button type="button" aria-pressed={pics === 'tab'} onClick={() => setPics('tab')} className={pill(pics === 'tab')}>Separate</button>
          <button type="button" aria-pressed={pics === 'mixA'} onClick={() => { setPics('mixA'); setPage(1); }} className={pill(pics === 'mixA')}>Mixed A: columns</button>
        </>}
      </div>

      {curated && editing && <div className="mb-12"><CollectionEditor start={doc} original={original} books={byId} onDone={done} onCancel={() => setEditing(false)} /></div>}

      <div ref={top} className="scroll-mt-24" id="works">
        {tabs ? (
          <div className="flex items-center gap-2 mb-5" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'works'} onClick={() => setTab('works')} className={pill(tab === 'works')}>Works {fmt(n)}</button>
            <button type="button" role="tab" aria-selected={tab === 'images'} onClick={() => setTab('images')} className={pill(tab === 'images')}>Images {fmt(imagesTotal)}</button>
          </div>
        ) : group === 'sections' && !mixed ? null /* the sections' own headings lead */ : <h2 className={`${H2} mb-5`}>{mixed && imagesHere ? "Works and images" : "Works"}</h2>}

        {(!tabs || tab === 'works') && <>
          {!small && (
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 mb-6">
              <span className="hidden sm:inline text-[13.5px] text-muted mr-2">{fmt(list.length)} {list.length === 1 ? 'work' : 'works'}{list.length < n ? ` of ${fmt(n)}` : ''}</span>
              {hasMenus && <>
                {/* Below laptop width the filter menus fold behind Filters, as on the index pages. */}
                <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`lg:hidden ${filtersBtn(open)}`}>
                  Filters{active > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-cream text-primary border border-border-medium text-xs grid place-items-center">{active}</span>}
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
                </button>
                <div className={`${open ? 'flex' : 'hidden'} lg:contents order-last lg:order-none w-full flex-wrap gap-2`}>
                  {big && canLang && <SortSelect label="Language" value={lang} onChange={reset(setLang)} options={[['all', 'Any language'], ...langs.map(([l, c]) => [l, `${l} (${c})`] as [string, string])]} />}
                  {typeMenu}
                  {formatMenu}
                  {canPeriod && periodMenu(periodCount)}
                  {madeMenu}
                  {mixed && picTypeMenu}
                </div>
              </>}
              <FilterChips chips={chips} onRemove={clear} onClearAll={() => chips.forEach((c) => clear(c.key))} />
              {hasMenus && howBtn('hidden md:inline ml-2')}
              <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
                {group !== 'sections' && !mixed && (canPeriod || canMade || canType || canLang) && <SortSelect label="Group" value={groupPick} onChange={reset(setGroup)} options={[['none', 'Not grouped'], ...(canType ? [['type', 'By type'] as [string, string]] : []), ...(canPeriod ? [['period', 'By period written'] as [string, string]] : []), ...(canMade ? [['made', 'By date made'] as [string, string]] : []), ...(canLang ? [['language', 'By language'] as [string, string]] : [])]} />}
                <SortSelect value={sort} onChange={reset(setSort)} options={sorts} />
                {pics === 'tab' && (
                  <div className="flex border border-border-medium" role="group" aria-label="View">
                    <button type="button" aria-pressed={view === 'grid'} aria-label="Grid" onClick={() => setView('grid')} className={`w-8 h-[34px] sm:w-[38px] sm:h-9 grid place-items-center ${view === 'grid' ? 'bg-warm text-primary' : 'bg-white text-muted'}`}><LayoutGrid className="w-4 h-4" /></button>
                    <button type="button" aria-pressed={view === 'list'} aria-label="List" onClick={() => setView('list')} className={`w-8 h-[34px] sm:w-[38px] sm:h-9 grid place-items-center ${view === 'list' ? 'bg-warm text-primary' : 'bg-white text-muted'}`}><List className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
            </div>
          )}
          {!small && hasMenus && <>{howBtn('md:hidden -mt-3 mb-4')}{howList}</>}
          {list.length === 0 && <p className="py-10 text-muted">No works match. <button type="button" className="underline underline-offset-[3px]" onClick={() => chips.forEach((c) => clear(c.key))}>Clear the search</button></p>}
          {mixed && columns(pageEntries)}
          {!mixed && blocks.map((g, i) => (
            <div key={`${g.k}-${i}`} className={g.k ? `${i > 0 ? 'mt-16 md:mt-24 pt-10 md:pt-14 border-t border-border-light' : 'mt-4'}` : ''}>
              {g.k && (
                // Section header: the heading at H2 scale, its line as a standfirst, the count kept small.
                <header className="mb-8 md:mb-10 max-w-3xl">
                  <h3 className="font-serif text-[32px] md:text-[44px] leading-[1.05] tracking-[-0.02em] text-primary">{group === 'sections' ? (sections.get(g.k)?.heading || 'Untitled section') : group === 'made' ? (g.k === NONE ? 'Undated' : centuryLabel(Number(g.k))) : group === 'period' ? (g.k === NONE ? 'Period not recorded' : periodLabel(g.k)) : group === 'type' ? (g.k === NONE ? 'Type not recorded' : TEXT_TYPES[g.k]) : g.k}</h3>
                  {group === 'sections' && sections.get(g.k)?.text && <p className="mt-3 md:mt-4 text-[17px] md:text-[19px] text-secondary leading-relaxed">{sections.get(g.k)!.text}</p>}
                  <p className="mt-3 text-[13px] text-muted">{groupSize.get(g.k)} {groupSize.get(g.k) === 1 ? 'work' : 'works'}</p>
                </header>
              )}
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
