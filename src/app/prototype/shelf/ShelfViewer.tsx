'use client';

/**
 * Client half of /prototype/shelf (#6855): fetches one collection, mounts the
 * three.js bookcase, and draws the HTML around it (collection switcher, hover
 * label, and the card for the book that has been pulled out).
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ShelfBook, ShelfScene } from './shelf-scene';

interface CollectionOption { slug: string; title: string; book_count?: number }

interface ApiBook extends ShelfBook {
  display_title?: string;
  pages_translated?: number;
  pages_translatable?: number;
  published?: string;
  thumbnail_blob?: string | null;
}

const MAX_BOOKS = 200;

export default function ShelfViewer() {
  const router = useRouter();
  const params = useSearchParams();
  const slug = params.get('c') || 'alchemy';

  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ShelfScene | null>(null);
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [books, setBooks] = useState<ApiBook[] | null>(null);
  const [total, setTotal] = useState(0);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ApiBook | null>(null);
  const [hover, setHover] = useState<{ book: ShelfBook; x: number; y: number } | null>(null);

  useEffect(() => {
    fetch('/api/collections?limit=100')
      .then(r => r.json())
      .then(d => setCollections(
        (d.collections ?? [])
          .filter((c: CollectionOption & { visible?: boolean }) => c.visible !== false && (c.book_count ?? 0) >= 12)
          .map((c: CollectionOption) => ({ ...c, title: c.title || c.slug }))
          .sort((a: CollectionOption, b: CollectionOption) => a.title.localeCompare(b.title)),
      ))
      .catch(() => { /* the switcher is optional */ });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBooks(null); setPicked(null); setError(null);
    fetch(`/api/collections/${encodeURIComponent(slug)}?limit=${MAX_BOOKS}&sort=year_asc`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => {
        if (cancelled) return;
        setTitle(d.collection?.title ?? slug);
        setTotal(d.total ?? 0);
        setBooks((d.books ?? []).map((b: ApiBook) => ({
          ...b,
          title: b.display_title || b.title,
          thumbnail: b.thumbnail_blob || b.thumbnail || null,
        })));
      })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !books || books.length === 0) return;
    let disposed = false;
    let scene: ShelfScene | null = null;
    const byId = new Map(books.map(b => [b.id, b]));
    const resize = () => scene?.resize(host.clientWidth, host.clientHeight);
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    (async () => {
      // Spine lettering is drawn into canvases, so the serif must be loaded before the first spine is painted.
      await Promise.race([document.fonts?.ready, new Promise(r => setTimeout(r, 1500))]);
      const mod = await import('./shelf-scene');
      if (disposed) return;
      scene = mod.createShelfScene(books, {
        onPick: id => { scene?.select(id); setPicked(id ? byId.get(id) ?? null : null); setHover(null); },
        onHover: (b, x, y) => setHover(b ? { book: b, x, y } : null),
      });
      sceneRef.current = scene;
      host.appendChild(scene.canvas);
      resize();
    })();
    return () => {
      disposed = true;
      ro.disconnect();
      sceneRef.current = null;
      if (scene) { scene.canvas.remove(); scene.dispose(); }
    };
  }, [books]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = sceneRef.current;
      if (!s || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.key === 'Escape') { s.select(null); setPicked(null); }
      if (e.key === 'ArrowLeft') s.pan(-0.6, 0);
      if (e.key === 'ArrowRight') s.pan(0.6, 0);
      if (e.key === 'ArrowUp') s.pan(0, 0.6);
      if (e.key === 'ArrowDown') s.pan(0, -0.6);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const close = () => { sceneRef.current?.select(null); setPicked(null); };
  const translatedPct = picked?.pages_translatable
    ? Math.round(((picked.pages_translated ?? 0) / picked.pages_translatable) * 100)
    : null;

  return (
    // z-index clears the site footer, which otherwise paints its logo over the case.
    <div className="fixed inset-0 z-[45] bg-[#1a120c] text-stone-100">
      <div ref={hostRef} className="absolute inset-0" />

      <header className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 bg-gradient-to-b from-black/60 to-transparent px-4 pb-10 pt-4">
        <div className="pointer-events-auto">
          <Link href="/" className="text-xs uppercase tracking-wider text-amber-300/80 hover:text-amber-200">Source Library</Link>
          <h1 className="font-serif text-2xl leading-tight text-amber-50">{title || ' '}</h1>
          {books && (
            <p className="text-xs text-stone-300/80">
              {books.length < total ? `The ${books.length} earliest of ${total.toLocaleString()} books` : `${books.length} books`}
              {' · '}oldest top left · drag to move along the shelf · scroll or pinch to step closer
            </p>
          )}
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          {collections.length > 0 && (
            <select
              aria-label="Collection"
              value={slug}
              onChange={e => router.replace(`/prototype/shelf?c=${encodeURIComponent(e.target.value)}`)}
              className="max-w-[60vw] rounded border border-amber-200/20 bg-black/50 px-2 py-1 text-sm text-amber-50"
            >
              {!collections.some(c => c.slug === slug) && <option value={slug}>{title || slug}</option>}
              {collections.map(c => <option key={c.slug} value={c.slug}>{c.title}</option>)}
            </select>
          )}
          <Link href={`/collections/${slug}`} className="rounded border border-amber-200/20 bg-black/50 px-2 py-1 text-sm text-amber-50 hover:bg-black/70">
            List view
          </Link>
        </div>
      </header>

      {!books && !error && <p className="absolute inset-0 flex items-center justify-center font-serif text-lg text-amber-100/70">Fetching the books…</p>}
      {error && <p className="absolute inset-0 flex items-center justify-center text-amber-100/80">Could not load this collection ({error}).</p>}

      {hover && (
        <div
          className="pointer-events-none fixed z-10 max-w-xs rounded bg-black/80 px-2 py-1 text-xs text-amber-50 shadow"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <span className="font-serif text-sm">{hover.book.title}</span>
          {hover.book.author && <span className="block text-stone-300">{hover.book.author}{hover.book.year ? `, ${hover.book.year}` : ''}</span>}
        </div>
      )}

      {picked && (
        <aside className="absolute bottom-0 left-0 right-0 z-20 max-h-[45vh] overflow-y-auto rounded-t-lg border-t border-amber-200/20 bg-[#f4ecdc] p-4 text-stone-900 shadow-2xl sm:bottom-auto sm:left-auto sm:right-4 sm:top-24 sm:max-h-[calc(100vh-8rem)] sm:w-80 sm:rounded-lg sm:border">
          <button onClick={close} aria-label="Put the book back" className="float-right -mr-1 -mt-1 px-2 text-xl leading-none text-stone-500 hover:text-stone-900">×</button>
          {picked.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={picked.thumbnail} alt="" className="mx-auto mb-3 hidden max-h-56 rounded shadow sm:block" />
          )}
          <h2 className="font-serif text-xl leading-snug">{picked.title}</h2>
          {picked.author && <p className="mt-1 text-sm text-stone-700">{picked.author}</p>}
          <p className="mt-1 text-sm text-stone-600">
            {[picked.published && picked.published !== 'MS' ? picked.published : picked.year, picked.language, picked.pages_count ? `${picked.pages_count} pages` : null]
              .filter(Boolean).join(' · ')}
          </p>
          {translatedPct !== null && (
            <p className="mt-1 text-sm text-stone-600">{translatedPct >= 99 ? 'Translated into English' : `${translatedPct}% translated into English`}</p>
          )}
          <Link href={`/book/${picked.id}`} className="mt-4 block rounded bg-stone-900 px-3 py-2 text-center text-sm font-medium text-amber-50 hover:bg-stone-700">
            Open the book
          </Link>
        </aside>
      )}
    </div>
  );
}
