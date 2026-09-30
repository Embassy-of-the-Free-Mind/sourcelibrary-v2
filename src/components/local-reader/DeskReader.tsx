'use client';

/**
 * The desk reader: a facing-page edition for someone seated at a laptop with no
 * signal and an hour to spend (the "desk" room of the three-rooms vision).
 *
 * Original on the left leaf, translation on the right, equal measure, one gutter,
 * one shared line height. Keyboard first: ← → turn pages, ⌘K asks, Esc closes.
 * Chrome is one rail at the top and one at the bottom; status lives in the bottom
 * rail and never in the header. A pane with nothing to show does not exist — the
 * opening collapses to one leaf and the footer says why in a few words.
 *
 * Data arrives fully parsed from the server (src/lib/local-mode/page-text.ts);
 * this component only decides placement. It makes one kind of request of its own,
 * the in-book search behind ⌘K, and that is same-origin and served off the disk.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Block, ParsedPage, Run } from '@/lib/local-mode/page-text';
import type { LocalScan } from '@/lib/local-mode/loader';
import s from './desk.module.css';

export interface DeskReaderProps {
  book: {
    id: string;
    slug: string;
    title: string;
    originalTitle?: string;
    author?: string;
    published?: string;
    language?: string;
    pagesCount?: number;
  };
  pageNumber: number;
  pageNumbers: number[];
  prev: number | null;
  next: number | null;
  position: number;
  pageType: string;
  original: ParsedPage;
  translation: ParsedPage;
  translationIsDescription: boolean;
  scan: LocalScan | null;
  chapters: Array<{ title: string; page_number: number }>;
  fount: { available: boolean; provenance: 'own-type' | 'reading-face' };
}

const PREFS_KEY = 'sl_local_reader';
const SIZES = [15, 16, 17, 18, 19, 20, 22];
const DEFAULT_SIZE = 17;

interface Prefs {
  size: number;
  aldine: boolean;
}

function loadPrefs(): Prefs {
  const d: Prefs = { size: DEFAULT_SIZE, aldine: true };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      size: typeof p.size === 'number' && SIZES.includes(p.size) ? p.size : d.size,
      aldine: typeof p.aldine === 'boolean' ? p.aldine : d.aldine,
    };
  } catch {
    return d;
  }
}

function savePrefs(p: Prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private window */ }
}

/* ------------------------------------------------------------------------- */
/* Text                                                                      */
/* ------------------------------------------------------------------------- */

function Runs({ runs, active, onGloss }: { runs: Run[]; active: string | null; onGloss: (id: string | null) => void }) {
  return (
    <>
      {runs.map((r, i) => {
        switch (r.t) {
          case 'text':
            return <span key={i}>{r.s}</span>;
          case 'anchor':
            return (
              <span
                key={i}
                className={s.anchor}
                data-active={active === r.gloss}
                tabIndex={0}
                aria-describedby={r.gloss}
                onMouseEnter={() => onGloss(r.gloss)}
                onMouseLeave={() => onGloss(null)}
                onFocus={() => onGloss(r.gloss)}
                onBlur={() => onGloss(null)}
              >
                {r.s}
              </span>
            );
          case 'unclear':
            return <span key={i} className={s.unclear} title="Uncertain reading">{r.s}</span>;
          case 'sup':
            return <sup key={i}>{r.s}</sup>;
          case 'em':
            return <em key={i}>{r.s}</em>;
          case 'strong':
            return <strong key={i}>{r.s}</strong>;
          case 'break':
            return <br key={i} />;
        }
      })}
    </>
  );
}

function Blocks({ blocks, active, onGloss }: { blocks: Block[]; active: string | null; onGloss: (id: string | null) => void }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'para':
            return <p key={i}><Runs runs={b.runs} active={active} onGloss={onGloss} /></p>;
          case 'centred':
            return <span key={i} className={s.centred}>{b.text}</span>;
          case 'marginalia':
            return <p key={i} className={s.marginalia}>{b.text}</p>;
          case 'column-break':
            return <div key={i} className={s.columnBreak} role="separator" />;
        }
      })}
    </>
  );
}

function Glosses({ page, active, onGloss }: { page: ParsedPage; active: string | null; onGloss: (id: string | null) => void }) {
  if (!page.glosses.length) return null;
  return (
    <ol className={s.glosses} aria-label="Notes">
      {page.glosses.map((g) => (
        <li
          key={g.id}
          id={g.id}
          className={s.gloss}
          data-active={active === g.id}
          onMouseEnter={() => onGloss(g.id)}
          onMouseLeave={() => onGloss(null)}
        >
          {g.anchor && <b>{g.anchor}</b>}{g.anchor ? ' — ' : ''}{g.text}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------------- */
/* The librarian drawer                                                      */
/* ------------------------------------------------------------------------- */

interface Hit { page: number; field: 'original' | 'translation'; snippet: string }

function Drawer({ bookRef, currentPage, onClose, onGo }: {
  bookRef: string;
  currentPage: number;
  onClose: () => void;
  onGo: (page: number) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [total, setTotal] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setHits(null); setTotal(0); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/local/search?book=${encodeURIComponent(bookRef)}&q=${encodeURIComponent(query)}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((d: { hits: Hit[]; total: number }) => { setHits(d.hits); setTotal(d.total); })
        .catch(() => { /* aborted by the next keystroke */ });
    }, 120);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, bookRef]);

  return (
    <aside className={s.drawer} aria-label="Librarian" role="dialog">
      <div className={s.drawerHead}>
        <span>Librarian</span>
        <button type="button" className={s.key} onClick={onClose}><kbd>Esc</kbd>close</button>
      </div>
      <input
        ref={input}
        className={s.drawerInput}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits?.length) onGo(hits[0].page);
        }}
        placeholder="Find in this book…"
        aria-label="Find in this book"
      />
      <p className={s.drawerNote}>
        Searches this book&apos;s transcription and translation, on this disk. Questions across the whole
        library go to the librarian (sl-ask), which this build does not yet reach.
      </p>
      {hits && (
        <p className={s.drawerNote}>
          {total === 0 ? 'Nothing on any page.' : `${total} page${total === 1 ? '' : 's'}${total > hits.length ? `, first ${hits.length} shown` : ''}.`}
        </p>
      )}
      {hits && hits.length > 0 && (
        <ul className={s.hits}>
          {hits.map((h) => (
            <li key={`${h.page}-${h.field}`}>
              <button type="button" className={s.hit} data-current={h.page === currentPage} onClick={() => onGo(h.page)}>
                <span className={s.hitHead}>Page {h.page} · {h.field === 'translation' ? 'English' : 'Original'}</span>
                <span className={s.hitText}>{h.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------------- */
/* The desk                                                                  */
/* ------------------------------------------------------------------------- */

export default function DeskReader(props: DeskReaderProps) {
  const { book, pageNumber, prev, next, original, translation, scan, chapters, fount } = props;
  const router = useRouter();

  const [prefs, setPrefs] = useState<Prefs>({ size: DEFAULT_SIZE, aldine: true });
  useEffect(() => { setPrefs(loadPrefs()); }, []);
  const update = useCallback((p: Partial<Prefs>) => {
    setPrefs((cur) => { const n = { ...cur, ...p }; savePrefs(n); return n; });
  }, []);

  const [drawer, setDrawer] = useState(false);
  const [activeGloss, setActiveGloss] = useState<string | null>(null);
  /** With a scan, the left leaf shows it; 'o' swaps the original in beneath it. */
  const [showScan, setShowScan] = useState(true);
  /** Narrow windows hold one leaf; 't' chooses which. */
  const [narrowLeaf, setNarrowLeaf] = useState<'left' | 'right'>('right');

  // A plate page often carries no printed words but its running head
  // ("Tomus I. in præfatione Caput III."). Then the head IS the page's text: set
  // it centred, as the printer did, rather than calling the page untranscribed.
  const originalBlocks: Block[] = !original.isEmpty
    ? original.blocks
    : original.furniture.header
      ? [{ kind: 'centred', text: original.furniture.header }]
      : [];
  // The OCR's picture description is a caption of last resort: only when no
  // translation is there to describe the plate, so it is never said twice.
  const plateCaption = translation.isEmpty ? original.imageDescription : undefined;
  const hasOriginal = originalBlocks.length > 0 || !!plateCaption;
  const hasTranslation = !translation.isEmpty;
  const leftIsScan = !!scan?.url && showScan;
  const hasLeft = leftIsScan || hasOriginal;
  const single = !(hasLeft && hasTranslation);

  const href = useCallback((n: number) => `/local/${encodeURIComponent(book.slug)}/${n}`, [book.slug]);
  const go = useCallback((n: number | null) => { if (n !== null) router.push(href(n)); }, [router, href]);

  // The page scrolls inside the room, never the document behind the desk.
  useEffect(() => {
    const el = document.documentElement;
    const before = el.style.overflow;
    el.style.overflow = 'hidden';
    return () => { el.style.overflow = before; };
  }, []);

  // A new page opens at its head.
  const room = useRef<HTMLElement>(null);
  useEffect(() => { room.current?.scrollTo({ top: 0 }); }, [pageNumber]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setDrawer((d) => !d); return; }
      if (e.key === 'Escape') { if (drawer) { e.preventDefault(); setDrawer(false); } return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case 'ArrowLeft': e.preventDefault(); go(prev); break;
        case 'ArrowRight': e.preventDefault(); go(next); break;
        case '/': e.preventDefault(); setDrawer(true); break;
        case 'a': if (fount.available) update({ aldine: !prefs.aldine }); break;
        case 'o': if (scan?.url) setShowScan((v) => !v); break;
        case 't': setNarrowLeaf((l) => (l === 'left' ? 'right' : 'left')); break;
        case '-': update({ size: SIZES[Math.max(0, SIZES.indexOf(prefs.size) - 1)] ?? DEFAULT_SIZE }); break;
        case '=': case '+': update({ size: SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(prefs.size) + 1)] ?? DEFAULT_SIZE }); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, go, prev, next, fount.available, prefs, update, scan?.url]);

  const setInAldine = fount.available && prefs.aldine;
  const language = book.language || 'Original';
  const leftLabel = leftIsScan
    ? 'Page image'
    : setInAldine && fount.provenance === 'own-type'
      ? `${language} · as printed`
      : `${language} · transcription`;
  const rightLabel = props.translationIsDescription ? 'Description' : 'English';

  const furniture = original.furniture;
  const pagesCount = book.pagesCount && book.pagesCount >= pageNumber ? book.pagesCount : props.pageNumbers[props.pageNumbers.length - 1];
  const progress = pagesCount ? Math.min(100, Math.round((pageNumber / pagesCount) * 100)) : 0;

  const statuses: string[] = [];
  if (!scan?.url) statuses.push('Image not mirrored');
  if (!hasTranslation && hasOriginal) statuses.push('Not translated');
  if (!hasOriginal && !leftIsScan) statuses.push('No transcription');
  if (furniture.warning) statuses.push('OCR flagged this page');

  const currentChapter = useMemo(() => {
    let c: string | undefined;
    for (const ch of chapters) if (ch.page_number <= pageNumber) c = String(ch.page_number);
    return c ?? '';
  }, [chapters, pageNumber]);

  const glossProps = { active: activeGloss, onGloss: setActiveGloss };

  const leftLeaf = hasLeft && (
    <section className={`${s.leaf} ${single ? '' : s.verso}`} data-hidden-narrow={!single && narrowLeaf !== 'left'} aria-label={leftLabel}>
      <div className={s.column}>
        <div className={s.label}>
          <span>{leftLabel}</span>
          {furniture.header && !leftIsScan && !original.isEmpty && <span className={s.running}>{furniture.header}</span>}
        </div>
        {leftIsScan && scan?.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a same-origin file off the disk; next/image would add nothing offline
          <img
            className={s.scan}
            src={scan.url}
            alt={`Page ${pageNumber} of ${book.title}`}
            width={scan.width || 1000}
            height={scan.height || 1400}
            style={scan.width && scan.height ? { aspectRatio: `${scan.width} / ${scan.height}` } : undefined}
          />
        ) : (
          <div className={`${s.text} ${setInAldine ? s.aldine : s.original}`} lang={languageTag(book.language)}>
            <Blocks blocks={originalBlocks} {...glossProps} />
            {plateCaption && <p className={s.caption}>{plateCaption}</p>}
            <Glosses page={original} {...glossProps} />
          </div>
        )}
      </div>
    </section>
  );

  const rightLeaf = hasTranslation && (
    <section className={`${s.leaf} ${single ? '' : s.recto}`} data-hidden-narrow={!single && narrowLeaf !== 'right'} aria-label={rightLabel}>
      <div className={s.column}>
        <div className={s.label}><span>{rightLabel}</span></div>
        <div className={`${s.text} ${s.english}`} lang="en">
          <Blocks blocks={translation.blocks} {...glossProps} />
          <Glosses page={translation} {...glossProps} />
        </div>
      </div>
    </section>
  );

  return (
    <div className={s.desk} style={{ ['--text-size' as string]: `${prefs.size}px` }}>
      <header className={s.rail}>
        <span className={s.brand}>Source Library</span>
        <span className={s.meta} title={book.originalTitle}>
          <i>{book.title}</i>
          {book.author ? ` · ${book.author}` : ''}
          {book.published ? ` · ${book.published}` : ''}
          {book.language ? ` · ${book.language}` : ''}
        </span>
        <span className={s.spacer} />
        <span className={s.opts}>
          {!single && (
            <button type="button" className={`${s.key} ${s.narrowOnly}`} onClick={() => setNarrowLeaf((l) => (l === 'left' ? 'right' : 'left'))}>
              <kbd>T</kbd>{narrowLeaf === 'left' ? rightLabel : 'Original'}
            </button>
          )}
          {scan?.url && hasOriginal && (
            <button type="button" className={s.key} aria-pressed={!showScan} onClick={() => setShowScan((v) => !v)}>
              <kbd>O</kbd>{showScan ? 'Text' : 'Image'}
            </button>
          )}
          {fount.available && hasOriginal && !leftIsScan && (
            <button type="button" className={s.key} aria-pressed={prefs.aldine} onClick={() => update({ aldine: !prefs.aldine })}>
              <kbd>A</kbd>Aldine type
            </button>
          )}
          {chapters.length > 0 && (
            <select className={s.select} aria-label="Contents" value={currentChapter} onChange={(e) => go(Number(e.target.value))}>
              <option value="" disabled>Contents</option>
              {chapters.map((c) => <option key={`${c.page_number}-${c.title}`} value={c.page_number}>{c.title}</option>)}
            </select>
          )}
          <button type="button" className={s.key} aria-pressed={drawer} onClick={() => setDrawer((d) => !d)}>
            <kbd>⌘K</kbd>Ask
          </button>
        </span>
      </header>

      <main className={s.room} ref={room}>
        <article className={`${s.opening} ${single ? s.single : ''}`}>
          {leftLeaf}
          {rightLeaf}
          {!hasLeft && !hasTranslation && (
            <section className={s.leaf}>
              <div className={s.column}>
                <div className={s.label}><span>Page {pageNumber}</span></div>
                <p className={s.quiet}>{props.pageType === 'blank' ? 'A blank page.' : 'Nothing was transcribed from this page.'}</p>
              </div>
            </section>
          )}
        </article>
      </main>

      <footer className={s.foot}>
        <span className={s.turn}>
          <Link className={s.arrow} href={prev !== null ? href(prev) : '#'} aria-disabled={prev === null} aria-label="Previous page" prefetch={prev !== null}>◀</Link>
          <Link className={s.arrow} href={next !== null ? href(next) : '#'} aria-disabled={next === null} aria-label="Next page" prefetch={next !== null}>▶</Link>
          <span className={s.folio}>
            Page {pageNumber}{pagesCount ? ` of ${pagesCount}` : ''}
            {furniture.printedNumber && furniture.printedNumber !== String(pageNumber) ? ` · printed ${furniture.printedNumber}` : ''}
          </span>
          {furniture.signature && <span className={s.folio}>sig. {furniture.signature}</span>}
        </span>
        <span className={s.progress} aria-hidden="true"><i style={{ width: `${progress}%` }} /></span>
        <span className={s.status}>
          {statuses.map((t) => <span key={t}>{t}</span>)}
          {drawer && <span>Esc closes the librarian</span>}
        </span>
      </footer>

      {drawer && (
        <Drawer bookRef={book.slug} currentPage={pageNumber} onClose={() => setDrawer(false)} onGo={(n) => go(n)} />
      )}
    </div>
  );
}

/** BCP-47 tag for the original pane, so the browser picks the right hyphenation and fonts. */
function languageTag(language?: string): string | undefined {
  if (!language) return undefined;
  const l = language.toLowerCase();
  const map: Record<string, string> = {
    latin: 'la', greek: 'grc', german: 'de', french: 'fr', italian: 'it', spanish: 'es', dutch: 'nl',
    english: 'en', hebrew: 'he', arabic: 'ar', syriac: 'syr', persian: 'fa', tibetan: 'bo', chinese: 'zh',
    japanese: 'ja', sanskrit: 'sa', portuguese: 'pt', czech: 'cs', polish: 'pl', russian: 'ru',
  };
  return map[l];
}
