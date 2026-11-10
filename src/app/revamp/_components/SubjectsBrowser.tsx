'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, List, Rows3 } from 'lucide-react';
import { BAND_TINT } from './PlateWall';
import SortSelect from '@/components/search-kit/SortSelect';
import SearchAskBars from '@/components/search-kit/SearchAskBars';
import { statBox, ShareBox } from '@/components/search-kit/StatParts';
import { LightBar } from './CollectionBars';
import type { Look } from './IndexLook';
import { FIRST, TOOLBAR, TOP, filtersBtn, vbtn } from './CollectionsBrowser';

export interface Pic { src: string; aspect?: number | null; label?: string | null }
export interface SubjectRow { id: string; label: string; href?: string; alt: string[]; home?: boolean; pics: Pic[] }
type Group = SubjectRow & { narrower: SubjectRow[] };

const WRAP = 'max-w-[var(--container-wide)] mx-auto px-6 md:px-12';
// Every subject will have a page; in the prototype only some do, so the rest point at their own place on this page.
const to = (s: SubjectRow) => s.href ?? `#${s.id}`;
const Arrow = () => <span aria-hidden className="inline-block transition-transform group-hover:translate-x-1">→</span>;

/** A no-gap row of pictures, each at its own proportions. */
function Strip({ pics, className = '' }: { pics: Pic[]; className?: string }) {
  return (
    <div className={`flex overflow-hidden ${className}`} style={{ background: '#1a1612' }}>
      {pics.map((p, i) => <img key={i} src={p.src} alt="" loading="lazy" className="h-full w-auto max-w-none shrink-0 block" />)}
    </div>
  );
}

/** Box with a small square picture at the left. */
function PicBox({ s, also }: { s: SubjectRow; also?: string }) {
  return (
    <Link id={s.home ? s.id : undefined} href={to(s)} className="group flex items-stretch bg-white border border-border-light text-[15px] text-primary hover:border-primary transition-colors scroll-mt-20">
      <span className="w-[58px] h-[58px] shrink-0 overflow-hidden bg-warm">{s.pics[0] && <img src={s.pics[0].src} alt="" loading="lazy" className="w-full h-full object-cover" />}</span>
      <span className="min-w-0 self-center px-3.5 py-2"><span>{s.label}</span>{also && <span className="block text-[12.5px] text-muted">Also called {also}</span>}</span>
    </Link>
  );
}


export default function SubjectsBrowser({ groups, barSearch = false, look = 'hero' }: { groups: Group[]; barSearch?: boolean; look?: Look }) {
  const [q, setQ] = useState('');
  const [how, setHow] = useState(false);
  const [order, setOrder] = useState<'theme' | 'az'>('theme');
  const [theme, setTheme] = useState('');
  const [view, setView] = useState<'bands' | 'list'>('bands');
  const [open, setOpen] = useState(false); // phone: the menu behind Filters
  const [ask, setAsk] = useState('');
  const [asked, setAsked] = useState('');
  // The hero bar sends its words here while typing.
  useEffect(() => {
    const on = (e: Event) => setQ((e as CustomEvent<string>).detail);
    window.addEventListener('collection-search', on);
    return () => window.removeEventListener('collection-search', on);
  }, []);
  const sorted = order === 'az' ? [...groups].sort((a, b) => a.label.localeCompare(b.label, 'en')) : groups; // By theme: the list's own order, related subjects side by side
  const t = q.trim().toLowerCase();
  // Matches the English name or any other name, and says which other name matched.
  const match = (s: SubjectRow) => {
    if (!t || s.label.toLowerCase().includes(t)) return { ok: true, also: '' };
    const a = s.alt.find((x) => x.toLowerCase().includes(t));
    return { ok: !!a, also: a ?? '' };
  };
  const shown = sorted.filter((g) => !theme || g.id === theme).map((g) => {
    const self = match(g);
    const narrower = g.narrower.map((s) => ({ s, m: match(s) })).filter((x) => (!t ? true : x.m.ok));
    return { g, self, narrower };
  }).filter((x) => !t || x.self.ok || x.narrower.length);
  const total = new Set(groups.flatMap((g) => [g.id, ...g.narrower.map((s) => s.id)])).size;
  const count = new Set(shown.flatMap(({ g, narrower }) => [g.id, ...narrower.map((x) => x.s.id)])).size;
  const n = (v: number) => v.toLocaleString('en-GB');

  const search = (
    <div className={`${WRAP} ${barSearch ? TOP : look === 'hero' ? 'py-8 md:py-10' : ''}`}>
      {look === 'gallery' && <div className="mb-6 md:mb-8"><LightBar placeholder="Search subjects or ask a question" scope={`all ${total} subjects`} /></div>}
      {look === 'library' && <SearchAskBars
        search={{ id: 'subj-search', label: 'Find a subject', placeholder: `${total} subjects, in any language`, value: q, onChange: setQ, onSubmit: setQ, examples: ['Alchemy', 'Yoga', 'Fungi'] }}
        ask={{ id: 'subj-ask', label: 'Ask the librarian', placeholder: 'What are you looking for?', value: ask, onChange: setAsk, onSubmit: (v) => setAsked(v.trim()), examples: ['books about breath', 'early maps of the sky'] }}
      />}
      {asked && <p className="mt-3 text-[13.5px] text-secondary max-w-2xl">Prototype: nothing is sent. Live, the librarian would answer “{asked}” from the whole library.</p>}
      {look === 'library' && (
        <div className="hidden sm:grid mt-7 mb-7 gap-3 grid-cols-2 lg:[grid-template-columns:1fr_1fr_3.2fr]">
          <div className={statBox}>
            <div className="text-[28px] font-medium leading-tight tabular-nums text-primary">{n(total)}</div>
            <div className="text-[13px] text-muted mt-0.5 leading-snug">subjects</div>
          </div>
          <div className={statBox}>
            <div className="text-[28px] font-medium leading-tight tabular-nums text-primary">{n(groups.length)}</div>
            <div className="text-[13px] text-muted mt-0.5 leading-snug">broad subjects</div>
          </div>
          <ShareBox title="Largest broad subjects" parts={[...groups].sort((a, b) => b.narrower.length - a.narrower.length).map((g) => ({ value: g.label, count: g.narrower.length }))} selected={groups.filter((g) => g.id === theme).map((g) => g.label)} onPick={(l) => { const g = groups.find((x) => x.label === l); if (g) setTheme(theme === g.id ? '' : g.id); }} />
        </div>
      )}
      {look === 'library' && <div className="sm:hidden mt-5" />}
      {look === 'hero' && !barSearch && <form role="search" onSubmit={(e) => e.preventDefault()} className="max-w-2xl">
        <label htmlFor="subj-find" className="block text-[12px] sm:text-[13.5px] font-semibold text-primary mb-1 sm:mb-2">Find a subject</label>
        <div className="flex items-stretch h-10 sm:h-[52px] border border-border-medium bg-white focus-within:border-primary focus-within:ring-1 focus-within:ring-primary" data-catalog-bar>
          <input id="subj-find" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${total} subjects, in any language`} className="flex-1 min-w-0 px-3 sm:px-4 text-base text-primary bg-transparent outline-none placeholder:text-muted/70" />
        </div>
      </form>}
      {/* One toolbar, as on All collections: the count, a menu, then order and view on the right. */}
      <div className={`${TOOLBAR} ${barSearch || look !== 'hero' ? '' : 'mt-6'}`}>
        <span className="hidden sm:inline text-sm text-primary font-medium mr-1">{n(count)} {count === 1 ? 'subject' : 'subjects'}</span>
<button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`sm:hidden ${filtersBtn(open)}`}>
          Filters{theme && <span className="min-w-5 h-5 px-1.5 rounded-full bg-cream text-primary border border-border-medium text-xs grid place-items-center">1</span>}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        <div className={`${open ? 'flex' : 'hidden'} sm:contents order-last sm:order-none w-full`}>
          <SortSelect label="Broad subject" value={theme} onChange={setTheme} options={[['', 'All broad subjects'], ...[...groups].sort((x, y) => x.label.localeCompare(y.label, 'en')).map((g) => [g.id, g.label] as const)]} />
        </div>
        <button type="button" aria-expanded={how} aria-controls="how" onClick={() => setHow(!how)} className="hidden md:inline ml-2 text-[13px] text-muted underline decoration-border-medium underline-offset-[3px] hover:text-primary hover:decoration-primary">How we choose subjects {how ? '−' : '+'}</button>
        <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
          <SortSelect label="Order" value={order} onChange={(v) => setOrder(v as 'theme' | 'az')} options={[['theme', 'By theme'], ['az', 'A to Z']]} />
          <div className="flex border border-border-medium" role="group" aria-label="View">
            <button type="button" aria-label="Picture bands" aria-pressed={view === 'bands'} onClick={() => setView('bands')} className={vbtn(view === 'bands')}><Rows3 className="w-4 h-4" /></button>
            <button type="button" aria-label="List" aria-pressed={view === 'list'} onClick={() => setView('list')} className={vbtn(view === 'list')}><List className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
      <button type="button" aria-expanded={how} aria-controls="how" onClick={() => setHow(!how)} className="md:hidden mt-3 text-[13px] text-muted underline decoration-border-medium underline-offset-[3px]">How we choose subjects {how ? '−' : '+'}</button>
      {how && (
        <ul id="how" className="max-w-2xl mt-3 bg-warm border border-border-light px-5 py-4 space-y-1.5 text-[14.5px] text-secondary leading-relaxed list-disc pl-9">
          <li>A subject exists when the library holds books or images about it.</li>
          <li>Broad subjects hold more specific ones, and a specific one can sit under two.</li>
          <li>Each is linked to library standards (FAST and Wikidata) where a match exists.</li>
          <li>Search finds it by any of its names, in Latin, German, Chinese and more.</li>
        </ul>
      )}
    </div>
  );

  const empty = shown.length === 0 && <p className={`${WRAP} py-12 text-muted`}>No subject by that name. Try a broader word, or search the Library instead.</p>;

  return (
    <>
      {search}{empty}
      {view === 'list' ? (
        // List: every broad subject with its subjects under it, names only.
        <div className={`${WRAP} ${FIRST} pb-16 columns-1 sm:columns-2 lg:columns-4 gap-8`}>
          {shown.map(({ g, narrower }) => (
            <div key={g.id} className="break-inside-avoid mb-8">
              <Link href={to(g)} className="block font-serif text-[22px] text-primary leading-tight hover:underline underline-offset-[3px] mb-2">{g.label}</Link>
              <ul className="space-y-1">{narrower.map(({ s: x, m }) => <li key={x.id}><Link href={to(x)} className="text-[15px] text-secondary hover:text-primary hover:underline underline-offset-[3px]">{x.label}</Link>{m.also && <span className="text-[12.5px] text-muted"> · {m.also}</span>}</li>)}</ul>
            </div>
          ))}
        </div>
      ) : (
      <div className={`${FIRST} pb-16`}>
        {shown.map(({ g, self, narrower }, i) => (
          <section key={g.id} id={`g-${g.id}`} className="scroll-mt-16">
            <div className={`${WRAP} ${i ? 'pt-5 md:pt-8' : ''} pb-5 md:pb-8`}>
              {(
                // The whole picture band is the way into the subject.
                <Link href={to(g)} className="group relative flex min-h-[132px] md:min-h-[200px] overflow-hidden mb-3 md:mb-4">
                  <Strip pics={g.pics} className="absolute inset-0 h-full" />
                  <span className="absolute inset-0 transition-opacity group-hover:opacity-80" style={{ background: BAND_TINT }} />
                  <span className="relative self-end w-full flex flex-col md:flex-row items-start md:items-end md:justify-between gap-1.5 md:gap-4 p-4 pt-10 md:p-7 text-white">
                    <span className="font-serif text-[26px] md:text-[48px] leading-[1.05] tracking-tight">{g.label}</span>
                    <span className="text-[13px] md:text-[15px] font-medium md:whitespace-nowrap border-b border-white/60 group-hover:border-white pb-0.5">Everything in {g.label} <Arrow /></span>
                  </span>
                </Link>
              )}
              {self.also && <p className="text-[13px] text-muted -mt-2 mb-3">Also called {self.also}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">{narrower.map(({ s, m }) => <PicBox key={s.id} s={s} also={m.also} />)}</div>
            </div>
          </section>
        ))}
      </div>
      )}
    </>
  );
}
