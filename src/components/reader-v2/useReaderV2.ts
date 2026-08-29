'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, Page } from '@/lib/types';
import { pages as pagesApi, readingHistory } from '@/lib/api-client';
import { useStableSession } from '@/hooks/useStableSession';
import { useEmbedHref } from '@/lib/EmbedContext';
import { getPageDisplayUrl } from '@/lib/utils';

// Shared state model for the v2 reader design previews (2a "Quiet Desk" and
// 2c "Study Desk"). Owns: current page + cache + prefetch, page navigation
// (URL pushState within the variant route), the view-combination multi-toggle,
// reading settings with localStorage persistence, focus mode, and arrow-key
// paging. Both variants consume this hook so they stay comparable on the same
// data layer (per the design handoff's build order).

export type ReaderTheme = 'light' | 'sepia' | 'dark';

export interface ReaderSettings {
  theme: ReaderTheme;
  /** Reading text scale, 1 = design default */
  textScale: number;
  lineWidth: 'narrow' | 'comfortable' | 'wide';
  typeface: 'serif' | 'sans';
  lineHeight: number;
  glosses: boolean;
  /** Which translation to read, when a page carries more than one. */
  translationLang: 'en' | 'es';
}

export interface ViewState {
  scan: boolean;
  ocr: boolean;
  en: boolean;
  /** Romanised transliteration — only offered for non-Latin scripts. */
  translit: boolean;
}

const SETTINGS_KEY = 'sl-reader-v2-settings';

/**
 * Write settings through on the way to state. The Cmd +/-/0 text-zoom keys
 * used to call setSettings directly and so never reached storage, which made
 * the size look like it forgot itself between visits — except when an
 * unrelated settings change happened to flush it.
 */
function persistSettings(next: ReaderSettings): ReaderSettings {
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'light',
  textScale: 1,
  lineWidth: 'comfortable',
  typeface: 'serif',
  lineHeight: 1.7,
  glosses: true,
  translationLang: 'en',
};

function loadStored<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

export function useReaderV2(
  variant: '2a' | '2c',
  initialBook: Book,
  initialPage: Page,
  initialPageList: Page[],
  defaultViews: ViewState,
) {
  const book = initialBook;
  const pageList = initialPageList;
  const embedHref = useEmbedHref();

  // A reader on the Spanish site should be offered the Spanish translation
  // first. Only as an initial default: once they choose in the pane, the
  // stored preference wins, because the choice is theirs to keep.
  const spanishSite = typeof window !== 'undefined' && window.location.pathname.startsWith('/es');
  const [currentPageId, setCurrentPageId] = useState(initialPage.id);
  const [currentPage, setCurrentPage] = useState<Page>(initialPage);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState(false);

  const bookPath = book.slug || book.id;

  // ── page cache + prefetch ──────────────────────────────────────────────
  const cacheRef = useRef<Map<string, Page>>(new Map());
  useEffect(() => {
    cacheRef.current.set(initialPage.id, initialPage);
  }, [initialPage]);

  const fetchPage = useCallback(async (pageId: string): Promise<Page | null> => {
    const cached = cacheRef.current.get(pageId);
    if (cached) return cached;
    try {
      const page = await pagesApi.get(pageId);
      cacheRef.current.set(pageId, page);
      return page;
    } catch {
      return null;
    }
  }, []);

  const prefetchAround = useCallback((index: number) => {
    const start = Math.max(0, index - 2);
    const end = Math.min(pageList.length - 1, index + 5);
    const wanted: string[] = [];
    for (let i = start; i <= end; i++) {
      if (i === index) continue;
      if (!cacheRef.current.has(pageList[i].id)) wanted.push(pageList[i].id);
    }
    if (!wanted.length) return;
    pagesApi.getBatch(wanted).then((batch) => {
      for (const p of batch) cacheRef.current.set(p.id, p);
    }).catch(() => {
      for (const id of wanted) fetchPage(id);
    });
  }, [pageList, fetchPage]);

  const currentIndex = pageList.findIndex(p => p.id === currentPageId);

  useEffect(() => {
    if (currentIndex >= 0) prefetchAround(currentIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load page data on navigation
  useEffect(() => {
    if (currentPageId === currentPage.id) return;
    let cancelled = false;
    const cached = cacheRef.current.get(currentPageId);
    if (cached) {
      setCurrentPage(cached);
    } else {
      setPageLoading(true);
      setPageError(false);
      fetchPage(currentPageId).then((p) => {
        if (cancelled) return;
        setPageLoading(false);
        // A null here means the fetch 404'd, 429'd or timed out. Leaving
        // currentPage alone renders the PREVIOUS page's scan and text under the
        // new page's URL, with nothing saying anything went wrong.
        if (p) setCurrentPage(p); else setPageError(true);
      });
    }
    const idx = pageList.findIndex(p => p.id === currentPageId);
    if (idx >= 0) prefetchAround(idx);
    return () => { cancelled = true; };
  }, [currentPageId, currentPage.id, fetchPage, pageList, prefetchAround]);

  // Metered reader (#4357): the ISR HTML and any pre-sign-in fetches carry
  // the STRIPPED variant of gated pages (the static render can't see who is
  // asking). Once a session is present, purge those from the cache and
  // refetch the one on screen — the API serves signed-in callers the full
  // text. Without this, a reader who signs in at the wall keeps staring at
  // the wall until a hard reload.
  const { data: gateSessionData } = useStableSession();
  const signedIn = !!gateSessionData?.user;
  useEffect(() => {
    if (!signedIn) return;
    for (const [id, p] of cacheRef.current) {
      if ((p as Page & { gated?: boolean }).gated) cacheRef.current.delete(id);
    }
    if ((currentPage as Page & { gated?: boolean }).gated) {
      fetchPage(currentPageId).then((p) => {
        // Only swap in a real page: on a fetch failure (or a still-gated
        // response) keep what's on screen — the wall, not a blank.
        if (p && !(p as Page & { gated?: boolean }).gated) setCurrentPage(p);
      });
    }
  }, [signedIn, currentPage, currentPageId, fetchPage]);

  // Reading history beacon (same contract as the production reader)
  useEffect(() => {
    // currentPageId moves synchronously on a page turn; currentPage arrives a
    // commit later. Recording before they agree stored the new page's id
    // against the PREVIOUS page's number, which is what made "continue where
    // you left off" offer a page one off from where you stopped.
    if (currentPage?.id !== currentPageId) return;
    if (currentPage.page_number == null) return;
    const referrer = typeof document !== 'undefined' ? document.referrer : '';
    readingHistory.record(book.id, currentPageId, currentPage.page_number, referrer || undefined);
  }, [book.id, currentPageId, currentPage?.id, currentPage?.page_number]);

  /**
   * The URL a page turn writes.
   *
   * This hook was built for the /v2a and /v2c design-preview routes and
   * appended that suffix unconditionally. Now that the reader also mounts on
   * the real route, that rewrote a canonical URL into a preview one on the
   * FIRST page turn — and the preview route is noindex, carries no JSON-LD, no
   * embed reporting and no hidden-book allowance, so an editor previewing an
   * unpublished book was 404'd a page in, and anyone citing the URL after a
   * turn was citing the wrong thing. Keep whatever suffix the reader was
   * actually mounted under.
   */
  const pageUrl = useCallback((pageId: string, params?: Record<string, string>) => {
    const here = typeof window !== 'undefined' ? window.location.pathname : '';
    const suffix = /\/v2[ac]\/?$/.test(here) ? `/v${variant}` : '';
    // The locale prefix is part of the route, not decoration. Dropping it
    // rewrote /es/book/… to /book/… on the first page turn, which flipped the
    // whole interface and the translation pane back to English mid-read and
    // made the shared URL the English one.
    const prefix = /^\/es(\/|$)/.test(here) ? '/es' : '';
    // Query carries the citation pin (?v=) and the search mark (?highlight=).
    // Rebuilding a bare path dropped both on the first turn, so a pinned
    // citation quietly became live text with the banner gone.
    const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    // An explicit param replaces what was there; ?highlight= from a search
    // result should not stack up with the last one.
    if (params) for (const [k, v] of Object.entries(params)) sp.set(k, v);
    const qs = sp.toString();
    const query = qs ? `?${qs}` : '';
    // Embedded readers live under /embed/<tenant>/…; writing a bare /book/…
    // URL there navigates the iframe out of the reading room it belongs to.
    // useEmbedHref is a no-op off an embed route, so this is safe everywhere.
    return embedHref(`${prefix}/book/${bookPath}/page/${pageId}${suffix}${query}`);
  }, [bookPath, variant, embedHref]);

  // ── navigation ─────────────────────────────────────────────────────────
  const goToPage = useCallback((pageId: string, params?: Record<string, string>) => {
    if (!pageId || pageId === currentPageId) return;
    setCurrentPageId(pageId);
    window.history.pushState(null, '', pageUrl(pageId, params));
    // Embedded readers mirror navigation to the host frame; without this the
    // partner page's own URL freezes on whatever page the iframe opened at.
    if (window.self !== window.top) {
      window.parent.postMessage({ type: 'sl-navigate', book: bookPath, page: pageId }, '*');
    }
  }, [bookPath, currentPageId, pageUrl]);

  // Scroll-driven position sync (2a's continuous column): same page swap but
  // with replaceState, so reading past a page break doesn't spam history.
  const syncCurrentPage = useCallback((pageId: string) => {
    if (!pageId || pageId === currentPageId) return;
    setCurrentPageId(pageId);
    window.history.replaceState(null, '', pageUrl(pageId));
    if (window.self !== window.top) {
      window.parent.postMessage({ type: 'sl-navigate', book: bookPath, page: pageId }, '*');
    }
  }, [bookPath, currentPageId, pageUrl]);

  const goToIndex = useCallback((index: number) => {
    if (index < 0 || index >= pageList.length) return;
    goToPage(pageList[index].id);
  }, [pageList, goToPage]);

  // currentIndex is -1 on a page the nav list excludes (archived spreads,
  // digitizer inserts, negative page numbers — 182k pages in the corpus).
  // Without this guard goNext() fell through to goToIndex(0) and jumped the
  // reader to page 1 of the book.
  const goNext = useCallback(
    () => { if (currentIndex >= 0) goToIndex(currentIndex + 1); },
    [goToIndex, currentIndex],
  );
  const goPrev = useCallback(
    () => { if (currentIndex >= 0) goToIndex(currentIndex - 1); },
    [goToIndex, currentIndex],
  );

  // Jump by the printed page number shown in the stepper
  const goToPageNumber = useCallback((num: number) => {
    const target = pageList.find(p => p.page_number === num);
    if (target) goToPage(target.id);
  }, [pageList, goToPage]);

  // ── views ──────────────────────────────────────────────────────────────
  const viewsKey = `sl-reader-v2-views-${variant}`;
  const [views, setViews] = useState<ViewState>(defaultViews);
  useEffect(() => {
    let hasChosen = false;
    try { hasChosen = window.localStorage.getItem(viewsKey) !== null; } catch { /* private mode */ }
    const stored = loadStored(viewsKey, defaultViews);
    // Views are stored globally, not per book, so a reader who last turned off
    // OCR and translation arrives at an image-less book (6,743 pages, the CDLI
    // tablets among them) with scan on, nothing to show in it, and a blank
    // reader. Fall back to whatever this page actually has.
    const hasScan = !!getPageDisplayUrl(initialPage as unknown as Record<string, unknown>);
    if (!hasScan && !stored.ocr && !stored.en) {
      setViews({ ...stored, scan: false, ocr: true, en: true });
      return;
    }
    // On a phone the three panes stack, and a full OCR pane pushes the
    // translation a long scroll away — so a reader who has never chosen gets
    // scan + translation only. Not persisted: their first explicit toggle is
    // what writes localStorage, and this default must not follow them to
    // desktop. (<lg, same line the stacked mobile layout uses.)
    if (!hasChosen && hasScan && window.matchMedia('(max-width: 1023px)').matches) {
      setViews({ ...stored, ocr: false });
      return;
    }
    setViews(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleView = useCallback((key: keyof ViewState) => {
    setViews(prev => {
      const next = { ...prev, [key]: !prev[key] };
      // At least one pane must stay on — clicking the last active pane is a no-op
      if (!next.scan && !next.ocr && !next.en) return prev;
      try { window.localStorage.setItem(viewsKey, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, [viewsKey]);

  // ── settings ───────────────────────────────────────────────────────────
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    const stored = window.localStorage.getItem(SETTINGS_KEY);
    const base = loadStored(SETTINGS_KEY, DEFAULT_SETTINGS);
    // On the Spanish site, open in Spanish — but only for a reader who has
    // never chosen. Once they have picked a language in the pane their stored
    // choice wins, because the choice is theirs to keep.
    setSettings(spanishSite && !stored ? { ...base, translationLang: 'es' } : base);
  }, [spanishSite]);
  const updateSettings = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings(prev => persistSettings({ ...prev, ...patch }));
  }, []);

  const [settingsOpen, setSettingsOpen] = useState(false);

  /**
   * Land on something to read. A reader arriving from a search result or a
   * shared link at a cover or flyleaf sees a blank page and nothing else;
   * every other book reader skips forward to the first real page.
   */
  const skippedBlank = useRef(false);
  useEffect(() => {
    if (skippedBlank.current) return;
    skippedBlank.current = true;
    if (initialPage.page_type !== 'blank') return;
    const firstReal = pageList.findIndex(p => p.page_type !== 'blank');
    const here = pageList.findIndex(p => p.id === initialPage.id);
    if (firstReal > 0 && here >= 0 && here < firstReal) {
      setCurrentPageId(pageList[firstReal].id);
      window.history.replaceState(null, '', pageUrl(pageList[firstReal].id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── keyboard ───────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      // SELECT was missing: the reading-language dropdown is one, so pressing
      // Left/Right to change language also turned the page underneath it.
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
        || target.tagName === 'SELECT' || target.isContentEditable) return;
      // A dialog owning the screen owns the arrow keys with it.
      if (document.querySelector('[data-reader-modal-open]')) return;
      if (e.key === 'ArrowRight') { goNext(); }
      else if (e.key === 'ArrowLeft') { goPrev(); }
      else if (e.key === 'Escape') { setSettingsOpen(false); }
    }
    // Cmd/Ctrl +, -, 0 resize the reading text rather than the browser. Kept
    // separate from the plain-key handler above because these must fire even
    // while focus is in a field.
    function onZoomKey(e: KeyboardEvent) {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        setSettings(prev => persistSettings({ ...prev, textScale: Math.min(2, Math.round(prev.textScale * 1.1 * 100) / 100) }));
      } else if (e.key === '-') {
        e.preventDefault();
        setSettings(prev => persistSettings({ ...prev, textScale: Math.max(0.7, Math.round(prev.textScale / 1.1 * 100) / 100) }));
      } else if (e.key === '0') {
        e.preventDefault();
        setSettings(prev => persistSettings({ ...prev, textScale: 1 }));
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onZoomKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onZoomKey);
    };
  }, [goNext, goPrev]);

  // Editing (or a refresh) hands back an updated page: sync cache + state.
  const applyPageUpdate = useCallback((page: Page) => {
    cacheRef.current.set(page.id, page);
    setCurrentPage(page);
  }, []);

  // Browser back/forward: re-derive the page id from the URL
  useEffect(() => {
    function onPop() {
      const segments = window.location.pathname.split('/');
      const at = segments.lastIndexOf('page') + 1;
      const pid = segments[at];
      if (pid && pageList.some(p => p.id === pid)) setCurrentPageId(pid);
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [pageList]);

  const totalPages = pageList.length;
  const progress = totalPages > 1 && currentIndex >= 0 ? currentIndex / (totalPages - 1) : 0;

  // Chapter containing the current page (by nav-list position of chapter start)
  const chapters = (book.chapters || []) as Array<{
    title: string; titleEn?: string; pageId?: string; pageNumber?: number; level?: number;
  }>;
  let currentChapter: (typeof chapters)[number] | null = null;
  if (chapters.length && currentPage?.page_number != null) {
    for (const ch of chapters) {
      if (ch.pageNumber != null && ch.pageNumber <= currentPage.page_number) currentChapter = ch;
    }
  }

  return {
    book, bookPath, pageList, currentPage, currentPageId, currentIndex, totalPages,
    pageLoading, pageError, progress,
    goToPage, goToIndex, goNext, goPrev, goToPageNumber, syncCurrentPage, fetchPage, applyPageUpdate,
    views, toggleView,
    settings, updateSettings, settingsOpen, setSettingsOpen,
    chapters, currentChapter,
  };
}
