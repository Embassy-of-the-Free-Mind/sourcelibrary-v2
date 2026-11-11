'use client';

import { useEffect, useRef, useState } from 'react';
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
}
export type NavVariant = 'plain' | 'panel' | 'dropdown' | 'split';
const KEY = 'revamp-nav-2';

export function setNavVariant(v: NavVariant) {
  localStorage.setItem(KEY, v);
  window.dispatchEvent(new Event('revamp-nav'));
}

const LINKS = [['Articles', '/articles'], ['Explore', '/explore'], ['About', '/about'], ['Ask the librarian', '/librarian']];
const linkCls = 'py-2 text-[13.5px] whitespace-nowrap text-white/70 hover:text-white transition-colors';
const colHref = (s: string) => `/revamp/c/${s}`;

export default function RevampHeader({ nav }: { nav: NavData }) {
  const [variant, setVariant] = useState<NavVariant>('plain');
  const [open, setOpen] = useState<null | 'collections' | 'subjects'>(null);
  const [hot, setHot] = useState(nav.subjects[0]?.id);
  const [phone, setPhone] = useState<null | 'root' | 'collections'>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const read = () => setVariant((localStorage.getItem(KEY) as NavVariant) || 'plain');
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

  const enter = (k: 'collections' | 'subjects') => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(k), 120); };
  const leave = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(null), 200); };

  const dropdown = open === 'collections' && variant === 'dropdown' && (
        <div className="absolute left-0 top-full z-50 w-[300px] bg-white text-primary border border-border-medium shadow-lg hidden lg:block">
          {[
            ['Featured', nav.featured?.name ?? '', nav.featured ? colHref(nav.featured.slug) : '/revamp/c'],
            ['All collections', 'Chosen by Source Library', '/revamp/c'],
            ['Subjects', 'The map of the whole library', '/revamp/subjects'],
            ['Periods', 'When the works were written', '/revamp/periods'],
            ['Languages', 'What the books are written in', '/revamp/languages'],
            ['Types', 'Engravings, maps, treatises, letters…', '/revamp/types'],
            ['From readers', 'Collections people have made', '/revamp/c#readers'],
            ['Libraries', 'Who holds the books', '/libraries'],
          ].map(([a, b, h]) => (
            <Link key={a} href={h} className="block px-4 py-2.5 border-b border-border-light last:border-0 hover:bg-warm">
              <span className="block text-[14.5px]">{a}</span>
              <span className="block text-[12.5px] text-muted">{b}</span>
            </Link>
          ))}
        </div>
  );

  const trigger = (k: 'collections' | 'subjects', label: string, href: string) => (
    <div className="relative flex items-center h-14 lg:h-16" onMouseEnter={() => enter(k)} onMouseLeave={leave}>
      <Link href={href} className={`${linkCls} ${open === k ? 'text-white' : ''}`}>{label}</Link>
      <button type="button" aria-label={`Open ${label} menu`} aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)} className="text-white/60 hover:text-white pl-0.5">
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open === k ? 'rotate-180' : ''}`} />
      </button>
      {k === 'collections' && dropdown}
    </div>
  );

  const hotSubject = nav.subjects.find((s) => s.id === hot);
  const panelShell = 'absolute left-0 right-0 top-full z-50 bg-white text-primary border-b border-border-medium shadow-lg';
  const small = 'text-[11px] text-muted mb-2';

  return (
    <div ref={root} className="relative z-50">
      <header className="bg-dark text-white relative">
        <div className="flex items-center gap-6 h-14 lg:h-16 pl-5 pr-2.5 md:pl-10 md:pr-8 lg:pr-10">
          <Logo white />
          <nav aria-label="Site" className="hidden lg:flex flex-1 justify-end items-center gap-[22px]">
            <Link href="/library" className={linkCls}>Library</Link>
            <Link href="/gallery" className={linkCls}>Gallery</Link>
            {variant === 'split' && trigger('subjects', 'Subjects', '/revamp/subjects')}
            {variant === 'plain' ? <Link href="/revamp/c" className={linkCls}>Collections</Link> : trigger('collections', 'Collections', '/revamp/c')}
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

      {open === 'collections' && variant === 'panel' && (
        <div className={`${panelShell} hidden lg:block`} onMouseEnter={() => enter('collections')} onMouseLeave={leave}>
          <div className="grid grid-cols-[230px_1fr_300px] gap-10 max-w-[1500px] mx-auto px-10 py-7 min-h-[380px]">
            <div>
              <p className={small}>Subjects</p>
              <ul className="m-0 p-0 list-none max-h-[420px] overflow-y-auto">
                {nav.subjects.map((s) => (
                  <li key={s.id} className="m-0">
                    <Link href={`/revamp/subjects#${s.id}`} onMouseEnter={() => setHot(s.id)} onFocus={() => setHot(s.id)}
                      className={`flex justify-between items-center py-1 text-[14.5px] ${hot === s.id ? 'text-accent-rust' : 'text-primary'}`}>
                      {s.label}<ChevronRight className="w-3.5 h-3.5 opacity-40" />
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href="/revamp/subjects" className="inline-block mt-3 text-[13px] underline underline-offset-2">All subjects</Link>
            </div>
            <div className="border-l border-border-light pl-10">
              <p className={small}>{hotSubject?.label}</p>
              <ul className="m-0 p-0 list-none columns-2 gap-8">
                {hotSubject?.narrower.slice(0, 20).map((n) => (
                  <li key={n.id} className="m-0 break-inside-avoid"><Link href={`/revamp/subjects#${n.id}`} className="block py-1 text-[14px] hover:underline underline-offset-2">{n.label}</Link></li>
                ))}
              </ul>
            </div>
            <div className="border-l border-border-light pl-10">
              {nav.featured && (
                <Link href={colHref(nav.featured.slug)} className="block mb-5">
                  <p className={small}>Featured now</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {nav.featured.img && <img src={nav.featured.img} alt="" className="w-full h-32 object-cover mb-2" />}
                  <span className="text-[15px] font-medium">{nav.featured.name}</span>
                </Link>
              )}
              <ul className="m-0 p-0 list-none text-[14px]">
                <li className="m-0"><Link href="/revamp/c" className="block py-1 hover:underline underline-offset-2">All collections</Link></li>
                <li className="m-0"><Link href="/revamp/c#readers" className="block py-1 hover:underline underline-offset-2">From readers</Link></li>
                <li className="m-0"><Link href="/libraries" className="block py-1 hover:underline underline-offset-2">Libraries</Link></li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {open === 'subjects' && variant === 'split' && (
        <div className={`${panelShell} hidden lg:block`} onMouseEnter={() => enter('subjects')} onMouseLeave={leave}>
          <div className="max-w-[1500px] mx-auto px-10 py-7 columns-4 gap-10">
            {nav.subjects.map((s) => (
              <div key={s.id} className="break-inside-avoid mb-5">
                <Link href={`/revamp/subjects#${s.id}`} className="block text-[14.5px] font-medium mb-1 hover:underline underline-offset-2">{s.label}</Link>
                {s.narrower.slice(0, 5).map((n) => <Link key={n.id} href={`/revamp/subjects#${n.id}`} className="block text-[13px] text-secondary py-0.5 hover:underline underline-offset-2">{n.label}</Link>)}
              </div>
            ))}
          </div>
        </div>
      )}

      {open === 'collections' && variant === 'split' && (
        <div className={`${panelShell} hidden lg:block`} onMouseEnter={() => enter('collections')} onMouseLeave={leave}>
          <div className="max-w-[1500px] mx-auto px-10 py-7 grid grid-cols-5 gap-5">
            {nav.picks.slice(0, 4).map((c) => (
              <Link key={c.slug} href={colHref(c.slug)} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.img && <img src={c.img} alt="" className="w-full h-32 object-cover mb-2" />}
                <span className="text-[14.5px]">{c.name}</span>
              </Link>
            ))}
            <ul className="m-0 p-0 list-none text-[14px] border-l border-border-light pl-5">
              <li className="m-0"><Link href="/revamp/c" className="block py-1 hover:underline underline-offset-2">All collections</Link></li>
              <li className="m-0"><Link href="/revamp/c#readers" className="block py-1 hover:underline underline-offset-2">From readers</Link></li>
              <li className="m-0"><Link href="/libraries" className="block py-1 hover:underline underline-offset-2">Libraries</Link></li>
            </ul>
          </div>
        </div>
      )}

      {phone && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 top-14 z-50 bg-dark text-white px-6 py-5 overflow-hidden">
          {phone === 'root' ? (
            <div className="text-[22px] leading-[2.05]">
              <Link href="/library" className="block">Library</Link>
              <Link href="/gallery" className="block">Gallery</Link>
              <button type="button" onClick={() => setPhone('collections')} className="w-full flex items-center justify-between">Collections <ChevronRight className="w-5 h-5 opacity-60" /></button>
              {LINKS.map(([l, h]) => <Link key={h} href={h} className="block">{l}</Link>)}
            </div>
          ) : (
            <div>
              <button type="button" onClick={() => setPhone('root')} className="flex items-center gap-1 text-white/70 text-[15px] mb-3"><ChevronLeft className="w-4 h-4" /> Menu</button>
              <div className="text-[18px] leading-[1.9]">
                {nav.featured && <Link href={colHref(nav.featured.slug)} className="block">Featured: {nav.featured.name}</Link>}
                <Link href="/revamp/c" className="block">All collections</Link>
                <Link href="/revamp/c#readers" className="block">From readers</Link>
                <Link href="/libraries" className="block">Libraries</Link>
              </div>
              <p className="text-white/60 text-[13px] mt-4 mb-1">Subjects</p>
              <div className="grid grid-cols-2 gap-x-4 text-[15px] leading-[1.9]">
                {nav.subjects.slice(0, 10).map((s) => <Link key={s.id} href={`/revamp/subjects#${s.id}`} className="block truncate">{s.label}</Link>)}
              </div>
              <Link href="/revamp/subjects" className="inline-block mt-2 text-[15px] underline underline-offset-2">All subjects</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
