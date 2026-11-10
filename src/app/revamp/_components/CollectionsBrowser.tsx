'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, LayoutGrid, List, Rows3 } from 'lucide-react';
import { BAND_TINT } from './PlateWall';
import SortSelect from '@/components/search-kit/SortSelect';
import SearchAskBars from '@/components/search-kit/SearchAskBars';
import { statBox, ShareBox } from '@/components/search-kit/StatParts';
import { LightBar } from './CollectionBars';
import type { Look } from './IndexLook';
import type { IndexItem } from '../_lib/data';

const HOLDS: [string, string][] = [['books', 'Books'], ['plates', 'Plates'], ['artworks', 'Artworks'], ['pages', 'Pages'], ['quotes', 'Quotes']];
const THUMBS: [string, string][] = [['square', 'Square pictures'], ['strip', 'Strip of pictures']];
export const vbtn = (on: boolean) => `w-9 sm:w-[38px] h-9 sm:h-[38px] grid place-items-center ${on ? 'bg-warm text-primary' : 'bg-white text-muted'}`;
const SORTS: [string, string][] = [['az', 'A to Z'], ['books', 'Most books'], ['images', 'Most images']];
export type FilterLayout = 'tiles' | 'chips' | 'menus' | 'side';
/** The spacing every index page shares under the hero bar: bar to toolbar, toolbar to the first row. */
export const TOP = 'pt-6 sm:pt-8 md:pt-10';
export const FIRST = 'mt-6 md:mt-8';
export const TOOLBAR = 'flex flex-wrap items-center gap-2 sm:gap-2.5 pb-3 sm:pb-3.5 border-b border-border-light';
/** The gallery's Advanced button, here opening the filters on a phone. */
export const filtersBtn = (open: boolean) => `inline-flex items-center gap-2 h-9 sm:h-[38px] px-3 sm:px-3.5 border text-[13px] sm:text-sm ${open ? 'bg-primary text-cream border-primary' : 'bg-white text-primary border-border-medium'}`;

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
  // A maker's saved crop lives in this browser only, so it can only be read after mounting.
  // eslint-disable-next-line react-hooks/set-state-in-effect
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
  if (item.coverCrop) return <CropSquare crop={item.coverCrop} />;
  const src = item.cover || item.thumbs[0];
  if (!src) return <div className="aspect-square bg-warm" />;
  return <div className="aspect-square overflow-hidden bg-warm"><img src={src} alt="" loading="lazy" className="w-full h-full object-cover" /></div>;
}

const pl = (v: number, w: string) => (v ? `${n(v)} ${w}${v === 1 ? '' : 's'}` : '');
const meta = (c: IndexItem) => [
  pl(c.books, 'book'), pl(c.images, 'image'), pl(c.artworks, 'artwork'), pl(c.pages, 'page'), pl(c.quotes, 'quote'),
].filter(Boolean).join(' · ');

export default function CollectionsBrowser({ items, subjects, initialSubject = '', hideTitle = false, filters = 'tiles', barSearch = false, look = 'hero' }: { barSearch?: boolean; look?: Look; items: IndexItem[]; featured?: string; subjects: { name: string; slugs: string[] }[]; initialSubject?: string; hideTitle?: boolean; filters?: FilterLayout }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [ask, setAsk] = useState('');
  const [maker, setMaker] = useState<'all' | 'source-library' | 'reader'>('all');
  const [holds, setHolds] = useState<string[]>([]);
  const [lang, setLang] = useState('');
  const [subject, setSubject] = useState(initialSubject);
  const [sort, setSort] = useState('az');
  const [view, setView] = useState<'grid' | 'list' | 'bands'>('grid');
  const [thumb, setThumb] = useState<'square' | 'strip'>('square');
  const [open, setOpen] = useState(false); // phone: the filter menus behind one button
  const [asked, setAsked] = useState('');
  // The hero bar sends its words here while typing.
  useEffect(() => {
    const on = (e: Event) => { const v = (e as CustomEvent<string>).detail; setText(v); setQuery(v); };
    window.addEventListener('collection-search', on);
    return () => window.removeEventListener('collection-search', on);
  }, []);

  const languages = useMemo(() => {
    const c = new Map<string, number>();
    items.forEach((i) => i.languages.forEach((l) => c.set(l, (c.get(l) ?? 0) + 1)));
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([l]) => l);
  }, [items]);
  const langCount = useMemo(() => {
    const c = new Map<string, number>();
    items.forEach((i) => i.languages.forEach((l) => c.set(l, (c.get(l) ?? 0) + 1)));
    return c;
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
      books: (a, b) => b.books - a.books,
      images: (a, b) => (b.images + b.artworks) - (a.images + a.artworks),
      az: (a, b) => a.name.replace(/^The /, '').localeCompare(b.name.replace(/^The /, '')),
    };
    // The two made-up examples always go last, whatever the sort.
    return [...r].sort((a, b) => Number(!!a.example) - Number(!!b.example) || by[sort](a, b));
  }, [items, query, maker, holds, lang, subject, sort, subjects]);

  const tile = 'bg-warm border border-border-light px-3 py-2.5 sm:p-5';
  const pick = (on: boolean) => `text-left px-2 py-0.5 -mx-0.5 text-sm ${on ? 'bg-primary text-cream' : 'text-primary hover:bg-border-light'}`;
  const count = (k: string) => items.filter((i) => i.holds.includes(k)).length;
  // The /gallery filter pill (GalleryControls), unchanged.
  const chip = (on: boolean) => `h-[30px] px-3 border text-[13px] ${on ? 'bg-primary border-primary text-cream' : 'bg-white border-border-medium text-primary hover:border-primary'}`;
  const active = [maker !== 'all', holds.length > 0, !!subject, !!lang].filter(Boolean).length;
  const toggleHold = (k: string) => setHolds(holds.includes(k) ? holds.filter((h) => h !== k) : [...holds, k]);
  const makerOpts = [['all', 'Anyone', items.length], ['source-library', 'Source Library', items.filter((i) => i.maker === 'source-library').length], ['reader', 'Readers', items.filter((i) => i.maker === 'reader').length]] as const;

  return (
    <div className={`max-w-[1500px] mx-auto px-6 md:px-12 ${barSearch ? TOP : look === 'hero' ? 'py-8 md:py-10' : ''} pb-16 md:pb-20`}>
      {!hideTitle && <h1 className="text-4xl sm:text-5xl text-primary font-display mb-5">Collections</h1>}
      {look === 'gallery' && <div className="mb-6 md:mb-8"><LightBar placeholder="Search collections or ask a question" scope={`all ${items.length} collections`} /></div>}
      {!barSearch && look !== 'gallery' && <SearchAskBars
        search={{ id: 'col-search', label: 'Search the collections', placeholder: 'Name, subject, person', value: text, onChange: (v) => { setText(v); setQuery(v); }, onSubmit: setQuery, examples: ['Slime Moulds', 'Sibyls', 'Yoga'] }}
        ask={{ id: 'col-ask', label: 'Ask the librarian', placeholder: 'What are you looking for?', value: ask, onChange: setAsk, onSubmit: (v) => setAsked(v.trim()), examples: ['dragons and monsters', 'witch trials in German'] }}
      />}
      {asked && <p className="mt-3 text-[13.5px] text-secondary max-w-2xl">Prototype: nothing is sent. Live, the librarian would answer “{asked}” from all {items.length} collections only.</p>}
      {look === 'library' && (
        // The Library's numbers band, for collections: each named part narrows the list, as there.
        <div className="hidden sm:grid mt-7 mb-7 gap-3 grid-cols-2 lg:[grid-template-columns:1fr_1.6fr_1.6fr_1.6fr]">
          <div className={statBox}>
            <div className="text-[28px] font-medium leading-tight tabular-nums text-primary">{n(shown.length)}</div>
            <div className="text-[13px] text-muted mt-0.5 leading-snug">{shown.length === items.length ? 'collections' : `of ${n(items.length)} collections`}</div>
            <div className="text-[12.5px] text-secondary mt-1.5">{n(items.filter((i) => i.maker === 'source-library').length)} by Source Library, {n(items.filter((i) => i.maker === 'reader').length)} by readers</div>
          </div>
          <ShareBox title="Holds" parts={HOLDS.map(([k, l]) => ({ value: l, count: count(k) })).sort((a, b) => b.count - a.count)} selected={HOLDS.filter(([k]) => holds.includes(k)).map(([, l]) => l)} onPick={(l) => { const k = HOLDS.find(([, x]) => x === l)?.[0]; if (k) toggleHold(k); }} />
          <ShareBox title={`${n(langCount.size)} languages`} parts={[...langCount.entries()].sort((a, b) => b[1] - a[1]).map(([value, c]) => ({ value, count: c }))} selected={lang ? [lang] : []} onPick={(l) => setLang(lang === l ? '' : l)} />
          <ShareBox title={`${n(subjects.length)} subjects`} parts={subjects.map((x) => ({ value: x.name, count: x.slugs.filter((sl) => items.some((i) => i.slug === sl)).length })).sort((a, b) => b.count - a.count)} selected={subject ? [subject] : []} onPick={(v) => setSubject(subject === v ? '' : v)} />
        </div>
      )}
      {look === 'library' && <div className="sm:hidden mt-5" />}
      {look === 'hero' && !barSearch && <div className="mt-4" />}

      {filters === 'tiles' && (
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
      )}
      {filters === 'chips' && (
        // B: no boxes. The count, then who made it and what it holds as small toggles on one line.
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="text-primary font-medium">{n(shown.length)} {shown.length === 1 ? 'collection' : 'collections'}</span>
          <span className="flex flex-wrap items-center gap-1"><span className="text-muted mr-1">Made by</span>{makerOpts.map(([k, l, c]) => <button key={k} type="button" aria-pressed={maker === k} onClick={() => setMaker(k)} className={chip(maker === k)}>{l} <span className="opacity-60">{n(c)}</span></button>)}</span>
          <span className="flex flex-wrap items-center gap-1"><span className="text-muted mr-1">Holds</span>{HOLDS.map(([k, l]) => <button key={k} type="button" aria-pressed={holds.includes(k)} onClick={() => toggleHold(k)} className={chip(holds.includes(k))}>{l} <span className="opacity-60">{n(count(k))}</span></button>)}</span>
        </div>
      )}
      <div className={filters === 'side' ? 'lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-10 mt-6' : ''}>
      {filters === 'side' && (
        // D: a filter column beside the results, as in a library catalogue.
        <aside className="mb-6 lg:mb-0 space-y-6 text-sm">
          <div className="text-primary font-medium text-base">{n(shown.length)} {shown.length === 1 ? 'collection' : 'collections'}</div>
          <div><div className="text-muted mb-2">Made by</div><div className="flex flex-wrap lg:flex-col gap-1 lg:items-start">{makerOpts.map(([k, l, c]) => <button key={k} type="button" aria-pressed={maker === k} onClick={() => setMaker(k)} className={pick(maker === k)}>{l} <span className="opacity-60">{n(c)}</span></button>)}</div></div>
          <div><div className="text-muted mb-2">Holds</div><div className="flex flex-wrap lg:flex-col gap-1 lg:items-start">{HOLDS.map(([k, l]) => <button key={k} type="button" aria-pressed={holds.includes(k)} onClick={() => toggleHold(k)} className={pick(holds.includes(k))}>{l} <span className="opacity-60">{n(count(k))}</span></button>)}</div></div>
          {subjects.length > 0 && <div><div className="text-muted mb-2">Subject</div><SortSelect label="Subject" value={subject} onChange={setSubject} options={[['', 'All subjects'], ...subjects.map((x) => [x.name, x.name] as const)]} /></div>}
          <div><div className="text-muted mb-2">Language</div><SortSelect label="Language" value={lang} onChange={setLang} options={[['', 'All languages'], ...languages.map((l) => [l, l] as const)]} /></div>
        </aside>
      )}
      <div className="min-w-0">
      <div className={`${TOOLBAR} ${filters === 'side' ? 'mt-4' : ''}`}>
        {filters === 'menus' && <>
          {/* C: everything is a menu in one toolbar. Below laptop width the menus fold behind Filters. */}
          <span className="hidden sm:inline text-sm text-primary font-medium mr-1">{n(shown.length)} {shown.length === 1 ? 'collection' : 'collections'}</span>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`lg:hidden ${filtersBtn(open)}`}>
            Filters{active > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-cream text-primary border border-border-medium text-xs grid place-items-center">{active}</span>}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          <div className={`${open ? 'flex' : 'hidden'} lg:contents order-last lg:order-none w-full flex-wrap gap-2`}>
            <SortSelect label="Made by" value={maker} onChange={(v) => setMaker(v as typeof maker)} options={makerOpts.map(([k, l]) => [k, k === 'all' ? 'Made by anyone' : `By ${l === 'Readers' ? 'readers' : l}`] as const)} />
            <SortSelect label="Holds" value={holds[0] ?? ''} onChange={(v) => setHolds(v ? [v] : [])} options={[['', 'Holds anything'], ...HOLDS.map(([k, l]) => [k, `Holds ${l.toLowerCase()}`] as const)]} />
            {subjects.length > 0 && <SortSelect label="Subject" value={subject} onChange={setSubject} options={[['', 'All subjects'], ...subjects.map((x) => [x.name, x.name] as const)]} />}
            <SortSelect label="Language" value={lang} onChange={setLang} options={[['', 'All languages'], ...languages.map((l) => [l, l] as const)]} />
            {view === 'grid' && <span className="sm:hidden"><SortSelect label="Thumbnails" value={thumb} onChange={(v) => setThumb(v as typeof thumb)} options={THUMBS} /></span>}
          </div>
        </>}
        {filters !== 'side' && filters !== 'menus' && <>
          {subjects.length > 0 && <SortSelect label="Subject" value={subject} onChange={setSubject} options={[['', 'All subjects'], ...subjects.map((x) => [x.name, x.name] as const)]} />}
          <SortSelect label="Language" value={lang} onChange={setLang} options={[['', 'All languages'], ...languages.map((l) => [l, l] as const)]} />
        </>}
        <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
          {view === 'grid' && <span className="hidden sm:inline-flex"><SortSelect label="Thumbnails" value={thumb} onChange={(v) => setThumb(v as typeof thumb)} options={THUMBS} /></span>}
          <SortSelect label="Sort" value={sort} onChange={setSort} options={SORTS} />
          <div className="flex border border-border-medium" role="group" aria-label="View">
            <button type="button" aria-label="Grid" aria-pressed={view === 'grid'} onClick={() => setView('grid')} className={vbtn(view === 'grid')}><LayoutGrid className="w-4 h-4" /></button>
            <button type="button" aria-label="List" aria-pressed={view === 'list'} onClick={() => setView('list')} className={vbtn(view === 'list')}><List className="w-4 h-4" /></button>
            <button type="button" aria-label="Picture bands" aria-pressed={view === 'bands'} onClick={() => setView('bands')} className={vbtn(view === 'bands')}><Rows3 className="w-4 h-4" /></button>
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-16 text-center text-muted">{maker === 'reader' ? <>No reader collections are public yet. <Link href="/auth/signin?callbackUrl=%2Fcollections" className="text-primary underline underline-offset-2">Sign in to make the first one</Link>.</> : 'Nothing matches all of that. Remove one of the filters above.'}</p>
      ) : view === 'bands' ? (
        // Picture bands, as on All subjects: the whole band is the way in.
        <div className={`${FIRST} space-y-3`}>
          {shown.map((c) => (
            <Link key={c.slug} href={c.href} className="group relative flex min-h-[128px] md:min-h-[170px] overflow-hidden">
              <div className="absolute inset-0 flex overflow-hidden" style={{ background: '#1a1612' }}>
                {(c.strip?.length ? c.strip : c.thumbs).map((src, i) => <img key={i} src={src} alt="" loading="lazy" className="h-full w-auto max-w-none shrink-0 block" />)}
              </div>
              <span className="absolute inset-0 transition-opacity group-hover:opacity-80" style={{ background: BAND_TINT }} />
              <span className="relative self-end w-full flex flex-col md:flex-row items-start md:items-end md:justify-between gap-1.5 md:gap-6 p-4 pt-10 md:p-6 text-white">
                <span className="min-w-0">
                  <span className="block font-serif text-[24px] md:text-[36px] leading-[1.05] tracking-tight">{c.name}</span>
                  {c.short && <span className="block text-[14px] md:text-[15px] text-stone-200 mt-1.5 max-w-2xl">{c.short}</span>}
                  <span className="block text-[13px] md:text-[14px] text-white/70 mt-1">{[c.label, c.example ? 'Example' : null, meta(c)].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="text-[13px] md:text-[14px] font-medium md:whitespace-nowrap border-b border-white/60 group-hover:border-white pb-0.5 shrink-0">See the collection <span aria-hidden className="inline-block transition-transform group-hover:translate-x-1">→</span></span>
              </span>
            </Link>
          ))}
        </div>
      ) : view === 'grid' ? (
        <div className={`grid gap-x-4 sm:gap-x-5 gap-y-7 sm:gap-y-8 ${FIRST} ${thumb === 'strip' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : filters === 'side' ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'}`}>
          {shown.map((c) => (
            <Link key={c.slug} href={c.href} className="block group">
              <div className="border border-transparent group-hover:border-primary transition-colors"><Thumb item={c} mode={thumb} /></div>
              <span className="block mt-2.5 text-[17px] leading-snug text-primary font-display">{c.name}</span>
              {c.short && <span className="block text-[13.5px] text-secondary mt-0.5 line-clamp-2 leading-snug">{c.short}</span>}
              <span className="block text-[13px] text-muted mt-0.5">{[c.label, c.example ? 'Example' : null, meta(c)].filter(Boolean).join(' · ')}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className={FIRST}>
          {shown.map((c) => (
            <Link key={c.slug} href={c.href} className="grid grid-cols-[72px_1fr] gap-4 py-3 border-t border-border-light group">
              <Thumb item={c} mode="square" />
              <span className="min-w-0">
                <span className="block text-[17px] text-primary font-display">{c.name}</span>
                <span className="block text-sm text-secondary truncate">{c.short || c.deck}</span>
                <span className="block text-[13px] text-muted">{[c.label, c.example ? 'Example' : null, meta(c)].filter(Boolean).join(' · ')}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
      </div>
      </div>
    </div>
  );
}
