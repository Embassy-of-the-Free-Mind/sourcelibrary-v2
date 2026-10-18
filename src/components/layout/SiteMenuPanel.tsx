'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { Search, User as UserIcon } from 'lucide-react';

// The full-screen phone menu (variant "A" from the 2026-10-18 mockups). It
// fades in under the header bar, which stays put and turns its hamburger into a
// close button. The logo's three rings, scaled up, sit behind the links; they
// are sized from the content so they run into the search bar on every phone
// (a fixed size missed it on tall phones and swallowed it on short ones).
//
// Every href arrives already localized and tenant-filtered from SiteHeader, so
// this component writes no paths of its own.

export interface MenuLink { key: string; label: string; href: string; active: boolean }

interface Props {
  id: string;
  open: boolean;
  onClose: () => void;
  links: MenuLink[];
  search: { action: string; label: string };
  languages: { locale: string; href: string; label: string; current: boolean }[] | null;
  /** Signed in: label is "Account" and `avatar` carries their picture or initials. */
  account: { href: string; label: string; avatar?: { image?: string | null; initials: string } };
  support: { href: string; label: string; onClick: () => void } | null;
}

// Tighten steps, applied one at a time until the open menu fits the screen
// without scrolling. Level 2 is for very short screens (an iPhone SE in Safari).
const LINK_SIZE = ['text-[29px] py-[9px]', 'text-[25px] py-1.5', 'text-[22px] py-1'];
const CONTROL_H = ['h-12', 'h-11', 'h-11'];

export default function SiteMenuPanel({ id, open, onClose, links, search, languages, account, support }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLFormElement>(null);
  const ringsRef = useRef<SVGSVGElement>(null);
  const [level, setLevel] = useState(0);
  const [viewport, setViewport] = useState(0);
  // A value, not the array: SiteHeader rebuilds `links` on every render.
  const linksKey = links.map((l) => l.label).join('|');

  // Lock the page behind the menu, and put the reader back where they were.
  useEffect(() => {
    if (!open) return;
    const y = window.scrollY;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const onResize = () => setViewport(window.innerHeight * 10000 + window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => {
      document.body.style.overflow = prev;
      window.scrollTo(0, y);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open, onClose]);

  // Start from the roomiest layout whenever the menu opens or the screen changes.
  useLayoutEffect(() => { if (open) setLevel(0); }, [open, viewport, linksKey]);

  const placeRings = useCallback(() => {
    const rings = ringsRef.current, list = linksRef.current;
    if (!rings || !list) return;
    const target = searchRef.current ?? (list.lastElementChild as HTMLElement | null);
    if (!target) return;
    const top = list.offsetTop - 14;
    // The outer ring's edge sits at 22.5/24 of the box; land it just past the target.
    const size = (target.offsetTop + target.offsetHeight + 10 - top) / (22.5 / 24);
    Object.assign(rings.style, { top: `${top}px`, width: `${size}px`, height: `${size}px`, right: `${-size * 0.38}px` });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (panel && level < 2 && panel.scrollHeight > panel.clientHeight + 1) { setLevel(level + 1); return; }
    placeRings();
  }, [open, level, viewport, linksKey, placeRings]);

  const stagger = (i: number) => ({
    transitionDelay: open ? `${120 + i * 45}ms` : '0ms',
  });
  const item = `transition-[opacity,transform] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] ${open ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3.5'}`;

  let i = 0;
  return (
    <div
      id={id}
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
      className={`fixed inset-0 z-40 flex flex-col overflow-y-auto bg-cream text-primary px-[22px] pt-[64px] pb-6 transition-[opacity,visibility] duration-300 ${
        open ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'
      }`}
    >
      <svg
        ref={ringsRef}
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="absolute pointer-events-none z-0"
        style={{ top: 50, right: -160, width: 420, height: 420 }}
      >
        {[10, 7, 4].map((r, k) => (
          <circle
            key={r}
            cx="12"
            cy="12"
            r={r}
            fill="none"
            stroke="var(--border-light)"
            strokeWidth="1"
            style={{
              transformOrigin: '12px 12px',
              transform: open ? 'scale(1)' : 'scale(0.2)',
              opacity: open ? 1 : 0,
              transition: `transform 1.2s cubic-bezier(.2,.8,.2,1) ${open ? k * 80 : 0}ms, opacity .6s`,
            }}
          />
        ))}
      </svg>

      <nav ref={linksRef} className="relative z-10 mt-2.5" aria-label="Site">
        {links.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            onClick={onClose}
            tabIndex={open ? 0 : -1}
            aria-current={l.active ? 'page' : undefined}
            className={`block w-full font-medium leading-none tracking-[-0.02em] active:text-accent-rust ${LINK_SIZE[level]} ${item}`}
            style={stagger(i++)}
          >
            {l.label}
          </Link>
        ))}
      </nav>

      <form
        ref={searchRef}
        action={search.action}
        role="search"
        onSubmit={onClose}
        className={`relative z-10 flex items-center gap-2.5 mt-4 mb-3.5 px-3.5 border border-border-medium focus-within:border-primary bg-cream text-muted ${CONTROL_H[level]} ${item}`}
        style={stagger(i++)}
      >
        <Search className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
        {/* 16px so iOS does not zoom the page on focus */}
        <input
          type="search"
          name="q"
          tabIndex={open ? 0 : -1}
          placeholder={search.label}
          aria-label={search.label}
          className="flex-1 min-w-0 bg-transparent outline-none text-base text-primary placeholder:text-muted"
        />
      </form>

      <div className="flex-1 min-h-[18px]" />

      {languages && languages.length > 1 && (
        <div
          className={`relative z-10 flex border border-border-medium bg-cream mb-3 ${level ? 'h-10' : 'h-11'} ${item}`}
          style={stagger(i++)}
        >
          {languages.map((l) => (
            <Link
              key={l.locale}
              href={l.href}
              hrefLang={l.locale}
              lang={l.locale}
              tabIndex={open ? 0 : -1}
              aria-current={l.current ? 'page' : undefined}
              className={`flex-auto flex items-center justify-center px-2 text-sm font-medium whitespace-nowrap transition-colors ${
                l.current ? 'bg-dark text-white' : 'text-muted hover:text-primary'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}

      <div className={`relative z-10 flex gap-2.5 ${item}`} style={stagger(i++)}>
        <Link
          href={account.href}
          onClick={onClose}
          tabIndex={open ? 0 : -1}
          className={`flex-1 flex items-center justify-center gap-2 text-base font-medium bg-accent-rust text-white ${CONTROL_H[level]}`}
        >
          {account.avatar?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={account.avatar.image} alt="" className="w-6 h-6 rounded-full border border-white/40" />
          ) : account.avatar ? (
            <span aria-hidden="true" className="w-6 h-6 rounded-full bg-white/20 text-xs flex items-center justify-center">{account.avatar.initials}</span>
          ) : (
            <UserIcon className="w-[18px] h-[18px]" aria-hidden="true" />
          )}
          {account.label}
        </Link>
        {support && (
          <Link
            href={support.href}
            onClick={() => { support.onClick(); onClose(); }}
            tabIndex={open ? 0 : -1}
            className={`flex-1 flex items-center justify-center text-base font-medium bg-dark text-white ${CONTROL_H[level]}`}
          >
            {support.label}
          </Link>
        )}
      </div>
    </div>
  );
}
