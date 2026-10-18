'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';

interface Shot {
  src: string;
  thumb: string;
  /** The original file, before the optimiser: the full-resolution scan. */
  original: string;
  alt: string;
  caption: string;
  href: string | null;
}

// Pictures smaller than this on the page (icons, inline marks) don't open.
const MIN_SIZE = 120;

/** A picture at a given width: next/image URLs re-asked for that width. */
function sized(img: HTMLImageElement, w: number): string {
  const src = img.currentSrc || img.src;
  try {
    const u = new URL(src, window.location.href);
    if (u.pathname === '/_next/image') {
      u.searchParams.set('w', String(w));
      return u.pathname + u.search;
    }
  } catch {
    /* keep src */
  }
  return src;
}

function originalSrc(img: HTMLImageElement): string {
  const src = img.currentSrc || img.src;
  try {
    const u = new URL(src, window.location.href);
    if (u.pathname === '/_next/image') return u.searchParams.get('url') || src;
  } catch {
    /* keep src */
  }
  return src;
}

function qualifies(img: HTMLImageElement): boolean {
  if (img.closest('[data-no-lightbox]')) return false;
  // Article pictures count even before they load (lazy images measure 0 until then).
  if (img.closest('figure, [data-lightbox-href]')) return true;
  const r = img.getBoundingClientRect();
  return r.width >= MIN_SIZE && r.height >= MIN_SIZE;
}

function describe(img: HTMLImageElement): Shot {
  const holder = img.closest<HTMLElement>('[data-lightbox-href]');
  const figure = img.closest('figure');
  const caption =
    holder?.dataset.lightboxCaption ||
    figure?.querySelector('figcaption')?.textContent?.replace(/\s+/g, ' ').trim() ||
    img.alt ||
    '';
  const href = holder?.dataset.lightboxHref || img.closest('a')?.getAttribute('href') || null;
  return { src: sized(img, 1920), thumb: sized(img, 150), original: originalSrc(img), alt: img.alt || '', caption, href };
}

/**
 * Click any picture in an article to see it large, with every other picture in
 * the article in the same viewer: arrows, swipe, thumbnails, caption and a
 * link to the source page. Works on every article, shared components or not,
 * by listening on the article body; a picture inside a link opens here instead
 * of following the link (the link is offered in the viewer).
 */
export default function ArticleLightbox() {
  const [shots, setShots] = useState<Shot[]>([]);
  const [index, setIndex] = useState<number | null>(null);
  const touchX = useRef<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const imagesOnPage = () =>
    Array.from(document.querySelectorAll<HTMLImageElement>('.article-page main img')).filter(qualifies);

  useEffect(() => {
    const main = document.querySelector<HTMLElement>('.article-page main');
    if (!main) return;
    main.classList.add('has-lightbox');
    const onClick = (e: MouseEvent) => {
      const img = (e.target as HTMLElement).closest?.('img') as HTMLImageElement | null;
      if (!img || !main.contains(img) || !qualifies(img)) return;
      e.preventDefault();
      e.stopPropagation();
      const all = imagesOnPage();
      opener.current = img;
      setShots(all.map(describe));
      setIndex(Math.max(0, all.indexOf(img)));
    };
    main.addEventListener('click', onClick, true);
    return () => {
      main.removeEventListener('click', onClick, true);
      main.classList.remove('has-lightbox');
    };
  }, []);

  const close = useCallback(() => {
    setIndex(null);
    opener.current?.focus?.();
  }, []);
  const step = useCallback((d: number) => setIndex((i) => (i === null ? i : (i + d + shots.length) % shots.length)), [shots.length]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [index, close, step]);

  // Keep the current thumbnail in view.
  useEffect(() => {
    if (index === null) return;
    strip.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [index]);

  if (index === null || !shots[index]) return null;
  const shot = shots[index];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pictures in this article"
      className="fixed inset-0 z-[10000] flex flex-col text-stone-200"
      style={{ background: "#14110e" }}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
        touchX.current = null;
      }}
    >
      <div className="flex items-center justify-between px-4 md:px-8 py-3 text-sm">
        <span className="tabular-nums text-stone-400">
          {index + 1} / {shots.length}
        </span>
        <button type="button" onClick={close} autoFocus className="px-3 py-1.5 text-stone-200 hover:text-white outline-none focus-visible:ring-1 focus-visible:ring-white/70" aria-label="Close">
          Close ✕
        </button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center px-12 md:px-20" onClick={(e) => e.target === e.currentTarget && close()}>
        {shots.length > 1 && (
          <button type="button" onClick={() => step(-1)} aria-label="Previous picture" className="absolute left-2 md:left-6 top-1/2 -translate-y-1/2 w-10 h-10 md:w-12 md:h-12 flex items-center justify-center border border-white/20 text-white hover:bg-white/10">
            ‹
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={shot.src} src={shot.src} alt={shot.alt} className="max-h-full max-w-full object-contain select-none" />
        {shots.length > 1 && (
          <button type="button" onClick={() => step(1)} aria-label="Next picture" className="absolute right-2 md:right-6 top-1/2 -translate-y-1/2 w-10 h-10 md:w-12 md:h-12 flex items-center justify-center border border-white/20 text-white hover:bg-white/10">
            ›
          </button>
        )}
      </div>

      <div className="px-4 md:px-8 pt-3 pb-2 max-w-4xl mx-auto w-full text-center">
        {shot.caption && <p className="text-sm leading-relaxed text-stone-300 line-clamp-3">{shot.caption}</p>}
        <p className="mt-1.5 flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm">
          {shot.href && (
            <Link href={shot.href} onClick={close} className="text-white underline decoration-accent-gold/70 underline-offset-4 hover:decoration-white">
              Open the source page
            </Link>
          )}
          <a href={shot.original} target="_blank" rel="noopener noreferrer" className="text-white underline decoration-accent-gold/70 underline-offset-4 hover:decoration-white">
            Full resolution
          </a>
        </p>
      </div>

      {shots.length > 1 && (
        <div ref={strip} className="flex gap-2 overflow-x-auto px-4 md:px-8 py-3 border-t border-white/10" style={{ scrollbarWidth: 'thin' }}>
          {shots.map((s, i) => (
            <button
              key={i}
              data-i={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Picture ${i + 1}`}
              aria-current={i === index ? 'true' : undefined}
              className={`shrink-0 h-16 w-16 md:h-20 md:w-20 overflow-hidden border-2 ${i === index ? 'border-accent-gold' : 'border-transparent opacity-60 hover:opacity-100'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
