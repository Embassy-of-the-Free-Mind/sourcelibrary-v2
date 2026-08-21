'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search, ChevronRight } from 'lucide-react';
import Logo from '@/components/layout/Logo';

/**
 * Book picker for the v2c reader preview.
 *
 * The reader route needs a page id, which nothing outside the reader knows,
 * so browsing the library had no way into the new design — every link on the
 * site goes to the current reader. This lists the library and hands each book
 * to /book/<slug>/read-v2, which resolves a page and redirects.
 *
 * Deliberately NOT under /book: that prefix is withheld from anonymous
 * callers on preview hosts (alias-host-scope.ts), and a picker that 403s is
 * worse than no picker. The reader it links to is still gated, so a preview
 * reviewer signs in once and both work.
 */

const INK = 'var(--bg-dark)';
const PAGE_SIZE = 24;

interface LibraryBook {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  published?: string;
  language?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  thumbnail?: string;
  thumbnail_blob?: string;
}

function onInk(o: number) { return `rgba(253, 252, 249, ${o})`; }

export default function ReaderPreviewPicker() {
  const [query, setQuery] = useState('');
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [skip, setSkip] = useState(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q: string, from: number, append: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        skip: String(from),
        has_translation: 'true',
        sort: 'recent-translation',
      });
      if (q.trim()) params.set('search', q.trim());
      const res = await fetch(`/api/books/library?${params}`);
      if (res.ok) {
        const data = await res.json();
        setBooks(prev => (append ? [...prev, ...(data.books || [])] : data.books || []));
        setTotal(typeof data.total === 'number' ? data.total : null);
      }
    } catch { /* transient; the empty state covers it */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { setSkip(0); load(query, 0, false); }, 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, load]);

  return (
    <div className="min-h-[100dvh]" style={{ background: 'var(--bg-warm)' }}>
      <header
        className="flex items-center gap-3 px-4 h-[58px] sticky top-0 z-10"
        style={{ background: INK, color: '#fdfcf9', borderBottom: `1px solid ${onInk(0.12)}` }}
      >
        <Logo white compact />
        <span className="font-body text-[15.5px] ml-1" style={{ color: '#fdfcf9' }}>
          Reader preview
        </span>
        <span className="font-sans text-[11.5px] hidden sm:block" style={{ color: onInk(0.5) }}>
          Pick a book to open in the new reader
        </span>
      </header>

      <div className="max-w-[1100px] mx-auto px-4 py-6">
        <div
          className="flex items-center gap-2 px-3 py-2.5 border mb-5 transition-colors focus-within:border-[var(--text-muted)]"
          style={{ borderColor: 'var(--border-medium)', background: 'var(--bg-white)' }}
        >
          {loading
            ? <Loader2 size={15} className="animate-spin" style={{ color: 'var(--text-faint)' }} />
            : <Search size={15} style={{ color: 'var(--text-faint)' }} />}
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search the library by title or author…"
            aria-label="Search the library"
            className="flex-1 bg-transparent outline-none font-sans text-[16px]"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>

        {total !== null && (
          <p className="font-sans text-[12px] mb-3" style={{ color: 'var(--text-muted)' }} aria-live="polite">
            {total === 0 ? 'No books match that.' : `${total.toLocaleString()} books with a translation`}
          </p>
        )}

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {books.map(b => {
            const cover = b.thumbnail || b.thumbnail_blob;
            const pct = b.pages_count && b.pages_translated
              ? Math.round((b.pages_translated / b.pages_count) * 100)
              : null;
            return (
              <a
                key={b.id}
                href={`/book/${b.slug || b.id}/read-v2`}
                className="group flex gap-3 p-3 border no-underline transition-colors hover:bg-[var(--bg-white)]"
                style={{ borderColor: 'var(--border-light)' }}
              >
                <span
                  className="shrink-0 w-[54px] h-[72px] overflow-hidden border flex items-center justify-center"
                  style={{ borderColor: 'var(--border-light)', background: 'var(--bg-white)' }}
                >
                  {cover && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={cover} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-body text-[14.5px] leading-snug line-clamp-2" style={{ color: 'var(--text-primary)' }}>
                    {b.display_title || b.title}
                  </span>
                  {b.author && (
                    <span className="block font-sans text-[12px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {b.author}
                    </span>
                  )}
                  <span className="block font-sans text-[11.5px] mt-1" style={{ color: 'var(--text-faint)' }}>
                    {[b.language, b.published, b.pages_count ? `${b.pages_count} pp.` : null]
                      .filter(Boolean).join(' · ')}
                  </span>
                  {pct !== null && (
                    <span className="block font-sans text-[11.5px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                      {pct}% translated
                    </span>
                  )}
                </span>
                <ChevronRight
                  size={15}
                  className="shrink-0 self-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--text-faint)' }}
                />
              </a>
            );
          })}
        </div>

        {loading && books.length === 0 && (
          <div className="py-10 flex justify-center">
            <Loader2 size={18} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
          </div>
        )}

        {total !== null && books.length < total && (
          <div className="flex justify-center pt-6">
            <button
              type="button"
              disabled={loading}
              onClick={() => { const next = skip + PAGE_SIZE; setSkip(next); load(query, next, true); }}
              className="px-4 py-2.5 border font-sans text-[13px] transition-colors hover:bg-[var(--bg-white)] disabled:opacity-50"
              style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
            >
              {loading ? 'Loading…' : `Show more (${books.length} of ${total.toLocaleString()})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
