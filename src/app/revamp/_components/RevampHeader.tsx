'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Search, ChevronDown, ChevronRight, ChevronLeft, Menu, X } from 'lucide-react';
import Logo from '@/components/layout/Logo';

export interface NavSubject { id: string; label: string; narrower: { id: string; label: string }[] }
export interface NavCollection { slug: string; name: string; img?: string; note?: string }
export interface NavData {
  subjects: NavSubject[];
  picks: NavCollection[];
  featured: NavCollection | null;
  libraries: { name: string; count: number }[];
  /** One picture per way in, by its label. */
  ways?: Record<string, string>;
}
/** A: one Browse menu. B: Library, Gallery and Collections each open their own menu. C: Collections opens a short list. */
export type NavVariant = 'browse' | 'menus' | 'dropdown';
const KEY = 'revamp-nav-3';
const DEFAULT: NavVariant = 'browse';

export function setNavVariant(v: NavVariant) {
  localStorage.setItem(KEY, v);
  window.dispatchEvent(new Event('revamp-nav'));
}
export function readNavVariant(): NavVariant {
  const v = localStorage.getItem(KEY);
  return v === 'browse' || v === 'menus' || v === 'dropdown' ? v : DEFAULT;
}

type Way = [label: string, note: string, href: string];
// Every way in, with what it answers. Library and Gallery menus take the ones that apply to them.
const SUBJECTS: Way = ['Subjects', 'What it is about', '/revamp/subjects'];
const CENTURIES: Way = ['Centuries', 'When it was written', '/revamp/periods'];
const LANGUAGES: Way = ['Languages', 'What it is written in', '/revamp/languages'];
const PLACES: Way = ['Places', 'Where it comes from', '/revamp/places'];
const TEXT_TYPES: Way = ['Types of texts', 'Treatises, letters…', '/revamp/types/texts'];
const PIC_TYPES: Way = ['Types of pictures', 'Maps, portraits…', '/revamp/types/pictures'];
const WAYS: Way[] = [SUBJECTS, CENTURIES, LANGUAGES, PLACES, TEXT_TYPES, PIC_TYPES];
// One kind of collection, whoever made it, beside the ways in at the same size.
const COLLECTION_TILES: Way[] = [['Collections', 'Sets people chose', '/revamp/c']];
const COLLECTION_LINKS: [string, string][] = [['All collections', '/revamp/c'], ['Libraries', '/libraries']];

const LINKS = [['Articles', '/articles'], ['Explore', '/explore'], ['About', '/about'], ['Ask the librarian', '/librarian']];
const linkCls = 'py-2 text-[13.5px] whitespace-nowrap text-white/70 hover:text-white transition-colors';
const colHref = (s: string) => `/revamp/c/${s}`;
type Menu = 'browse' | 'library' | 'gallery' | 'collections';

export default function RevampHeader({ nav }: { nav: NavData }) {
  const [variant, setVariant] = useState<NavVariant>(DEFAULT);
  const [open, setOpen] = useState<null | Menu>(null);
  const [phone, setPhone] = useState<null | 'root' | 'browse'>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const read = () => setVariant(readNavVariant());
    read();
    window.addEventListener('revamp-nav', read);
    return () => window.removeEventListener('revamp-nav', read);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(null); setPhone(null); } };
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', down);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', down); };
  }, []);

  const enter = (k: Menu) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(k), 120); };
  const leave = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(null), 200); };

  // A picture already in the cache never fires onLoad after hydration, so check on mount too.
  const shown = (el: HTMLImageElement | null) => { if (el?.complete && el.naturalWidth) el.classList.replace('opacity-0', 'opacity-100'); };
  const small = 'text-[12.5px] text-muted mb-2';
  const rowLink = 'block py-1 text-[14.5px] hover:underline underline-offset-2';

  const wayList = (ways: Way[]) => (
    <ul className="m-0 p-0 list-none">
      {ways.map(([a, b, h]) => (
        <li key={a} className="m-0">
          <Link href={h} className="group block py-1.5">
            <span className="block text-[15px] group-hover:underline underline-offset-2">{a}</span>
            <span className="block text-[12.5px] text-muted">{b}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
  const featuredBlock = nav.featured && (
    <Link href={colHref(nav.featured.slug)} className="group block mb-4">
      <p className={small}>Featured</p>
      <span className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {nav.featured.img && <img src={nav.featured.img} alt="" className="w-28 h-20 shrink-0 object-cover bg-warm" />}
        <span className="text-[15px] font-medium group-hover:underline underline-offset-2">{nav.featured.name}</span>
      </span>
    </Link>
  );
  // Panels stay in the page, hidden, so their pictures have loaded before anyone opens a menu;
  // opening only fades the panel in. Contents sit in the same container as the page below.
  const PANEL_OF: Record<Menu, NavVariant> = { browse: 'browse', library: 'menus', gallery: 'menus', collections: 'menus' };
  const panel = (k: Menu, body: ReactNode) => variant === PANEL_OF[k] && (
    <div aria-hidden={open !== k} className={`absolute left-0 right-0 top-full z-50 bg-white text-primary border-b border-border-medium shadow-lg hidden lg:block transition-opacity duration-150 ${open === k ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'}`} onMouseEnter={() => enter(k)} onMouseLeave={leave}>
      <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-7">{body}</div>
    </div>
  );
  const col = 'border-l border-border-light pl-10';

  const dropdown = open === 'collections' && variant === 'dropdown' && (
    <div className="absolute left-0 top-full z-50 w-[300px] bg-white text-primary border border-border-medium shadow-lg hidden lg:block">
      {[...(nav.featured ? [['Featured', nav.featured.name, colHref(nav.featured.slug)]] : []), ['All collections', 'Chosen by Source Library and readers', '/revamp/c'], ...WAYS, ['Libraries', 'Who holds the books', '/libraries']].map(([a, b, h]) => (
        <Link key={a} href={h} className="block px-4 py-2.5 border-b border-border-light last:border-0 hover:bg-warm">
          <span className="block text-[14.5px]">{a}</span>
          <span className="block text-[12.5px] text-muted">{b}</span>
        </Link>
      ))}
    </div>
  );

  const trigger = (k: Menu, label: string, href: string) => (
    <div className="relative flex items-center h-14 lg:h-16" onMouseEnter={() => enter(k)} onMouseLeave={leave}>
      <Link href={href} className={`${linkCls} ${open === k ? 'text-white' : ''}`}>{label}</Link>
      <button type="button" aria-label={`Open ${label} menu`} aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)} className="text-white/60 hover:text-white pl-0.5">
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open === k ? 'rotate-180' : ''}`} />
      </button>
      {k === 'collections' && dropdown}
    </div>
  );
  const plain = (label: string, href: string) => <Link href={href} className={linkCls}>{label}</Link>;

  return (
    <div ref={root} className="relative z-50">
      <header className="bg-dark text-white relative">
        <div className="flex items-center gap-6 h-14 lg:h-16 pl-5 pr-2.5 md:pl-10 md:pr-8 lg:pr-10">
          <Logo white />
          <nav aria-label="Site" className="hidden lg:flex flex-1 justify-end items-center gap-[22px]">
            {variant === 'menus' ? trigger('library', 'Library', '/library') : plain('Library', '/library')}
            {variant === 'menus' ? trigger('gallery', 'Gallery', '/gallery') : plain('Gallery', '/gallery')}
            {variant === 'browse' ? trigger('browse', 'Browse', '/revamp/subjects') : trigger('collections', 'Collections', '/revamp/c')}
            {LINKS.map(([l, h]) => <Link key={h} href={h} className={linkCls}>{l}</Link>)}
          </nav>
          <div className="hidden lg:flex items-center gap-3 shrink-0 text-[13.5px]">
            <Search className="w-[17px] h-[17px] text-white/70" aria-hidden />
            <span className="w-px h-5 bg-white/15" aria-hidden />
            <span className="text-white/70">English</span>
            <span className="inline-flex items-center h-[34px] px-[15px] font-medium text-white" style={{ background: '#9e4a3a' }}>Sign in</span>
            <span className="inline-flex items-center h-[34px] px-[15px] font-medium border border-white/70">Support</span>
          </div>
          <button type="button" aria-label="Menu" aria-expanded={!!phone} onClick={() => setPhone(phone ? null : 'root')} className="lg:hidden ml-auto p-2 text-white">
            {phone ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* A: one Browse menu holding every way in and the collections. */}
      {panel('browse', (
        <ul className="m-0 p-0 list-none grid grid-cols-7 gap-5">
          {[...WAYS, ...COLLECTION_TILES].map(([a, b, h]) => (
            <li key={a} className="m-0">
              <Link href={h} className="group block">
                <span className="flex items-center justify-center aspect-square bg-warm border border-border-light group-hover:border-primary p-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {nav.ways?.[a] && <img src={nav.ways[a]} alt="" decoding="async" ref={shown} onLoad={(e) => e.currentTarget.classList.replace('opacity-0', 'opacity-100')} className="max-w-full max-h-full object-contain opacity-0 transition-opacity duration-300" />}
                </span>
                <span className="block mt-2.5 text-[15.5px] group-hover:underline underline-offset-2">{a}</span>
                <span className="block text-[13px] text-muted leading-snug">{b}</span>
              </Link>
            </li>
          ))}
        </ul>
      ))}

      {/* B: Library and Gallery each list the ways in that apply to them; Collections has its own menu. */}
      {panel('library', (
        <div className="grid grid-cols-[230px_230px_1fr] gap-10">
          <div>
            <p className={small}>Search</p>
            <Link href="/library" className={rowLink}>Search all texts</Link>
            <Link href="/revamp/library-search" className={rowLink}>Advanced search</Link>
          </div>
          <div className={col}><p className={small}>Browse texts by</p>{wayList([SUBJECTS, CENTURIES, LANGUAGES, PLACES, TEXT_TYPES])}</div>
          <div className={col}><div className="max-w-[300px]">{featuredBlock}</div></div>
        </div>
      ))}
      {panel('gallery', (
        <div className="grid grid-cols-[230px_230px_1fr] gap-10">
          <div>
            <p className={small}>Search</p>
            <Link href="/gallery" className={rowLink}>Search all images</Link>
          </div>
          <div className={col}><p className={small}>Browse images by</p>{wayList([SUBJECTS, PIC_TYPES, CENTURIES])}</div>
          <div className={col}><div className="max-w-[300px]">{featuredBlock}</div></div>
        </div>
      ))}
      {panel('collections', (
        <div className="grid grid-cols-5 gap-5">
          {nav.picks.slice(0, 4).map((c) => (
            <Link key={c.slug} href={colHref(c.slug)} className="group block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.img && <img src={c.img} alt="" className="w-full h-32 object-cover mb-2 bg-warm" />}
              <span className="text-[14.5px] group-hover:underline underline-offset-2">{c.name}</span>
            </Link>
          ))}
          <ul className="m-0 p-0 list-none border-l border-border-light pl-5">{COLLECTION_LINKS.map(([l, h]) => <li key={h} className="m-0"><Link href={h} className={rowLink}>{l}</Link></li>)}</ul>
        </div>
      ))}

      {/* Phone: the same for every option. Browse slides to a second panel, so the menu never scrolls. */}
      {phone && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 top-14 z-50 bg-dark text-white px-6 py-5 overflow-hidden">
          {phone === 'root' ? (
            <div className="text-[22px] leading-[2.05]">
              <Link href="/library" className="block">Library</Link>
              <Link href="/gallery" className="block">Gallery</Link>
              <button type="button" onClick={() => setPhone('browse')} className="w-full flex items-center justify-between">{variant === 'browse' ? 'Browse' : 'Collections'} <ChevronRight className="w-5 h-5 opacity-60" /></button>
              {LINKS.map(([l, h]) => <Link key={h} href={h} className="block">{l}</Link>)}
            </div>
          ) : (
            <div>
              <button type="button" onClick={() => setPhone('root')} className="flex items-center gap-1 text-white/70 text-[16px] mb-3"><ChevronLeft className="w-4 h-4" /> Menu</button>
              <ul className="m-0 p-0 list-none">
                {[...WAYS, ...COLLECTION_TILES].map(([a, b, h]) => (
                  <li key={a} className="m-0 border-b border-white/10 last:border-0">
                    <Link href={h} className="flex items-center gap-4 py-2.5">
                      <span className="flex items-center justify-center w-14 h-14 shrink-0 bg-white/5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {nav.ways?.[a] && <img src={nav.ways[a]} alt="" decoding="async" className="max-w-full max-h-full object-contain" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[18px] leading-tight">{a}</span>
                        <span className="block text-[14px] text-white/60 mt-0.5">{b}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
