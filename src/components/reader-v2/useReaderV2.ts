'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, Page } from '@/lib/types';
import { pages as pagesApi, readingHistory } from '@/lib/api-client';

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
  const [currentPageId, setCurrentPageId] = useState(initialPage.id);
  const [currentPage, setCurrentPage] = useState<Page>(initialPage);
  const [pageLoading, setPageLoading] = useState(false);

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
      fetchPage(currentPageId).then((p) => {
        if (cancelled) return;
        setPageLoading(false);
        if (p) setCurrentPage(p);
      });
    }
    const idx = pageList.findIndex(p => p.id === currentPageId);
    if (idx >= 0) prefetchAround(idx);
    return () => { cancelled = true; };
  }, [currentPageId, currentPage.id, fetchPage, pageList, prefetchAround]);

  // Reading history beacon (same contract as the production reader)
  useEffect(() => {
    if (!currentPage?.page_number) return;
    const referrer = typeof document !== 'undefined' ? document.referrer : '';
    readingHistory.record(book.id, currentPageId, currentPage.page_number, referrer || undefined);
  }, [book.id, currentPageId, currentPage?.page_number]);

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
  const pageUrl = useCallback((pageId: string) => {
    const suffix = typeof window !== 'undefined' && /\/v2[ac]\/?$/.test(window.location.pathname)
      ? `/v${variant}`
      : '';
    return `/book/${bookPath}/page/${pageId}${suffix}`;
  }, [bookPath, variant]);

  // ── navigation ─────────────────────────────────────────────────────────
  const goToPage = useCallback((pageId: string) => {
    if (!pageId || pageId === currentPageId) return;
    setCurrentPageId(pageId);
    window.history.pushState(null, '', pageUrl(pageId));
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

  const goNext = useCallback(() => goToIndex(currentIndex + 1), [goToIndex, currentIndex]);
  const goPrev = useCallback(() => goToIndex(currentIndex - 1), [goToIndex, currentIndex]);

  // Jump by the printed page number shown in the stepper
  const goToPageNumber = useCallback((num: number) => {
    const target = pageList.find(p => p.page_number === num);
    if (target) goToPage(target.id);
  }, [pageList, goToPage]);

  // ── views ──────────────────────────────────────────────────────────────
  const viewsKey = `sl-reader-v2-views-${variant}`;
  const [views, setViews] = useState<ViewState>(defaultViews);
  useEffect(() => {
    setViews(loadStored(viewsKey, defaultViews));
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
    setSettings(loadStored(SETTINGS_KEY, DEFAULT_SETTINGS));
  }, []);
  const updateSettings = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── keyboard ───────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (e.key === 'ArrowRight') { goNext(); }
      else if (e.key === 'ArrowLeft') { goPrev(); }
      else if (e.key === 'Escape') { setSettingsOpen(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
    pageLoading, progress,
    goToPage, goToIndex, goNext, goPrev, goToPageNumber, syncCurrentPage, fetchPage, applyPageUpdate,
    views, toggleView,
    settings, updateSettings, settingsOpen, setSettingsOpen,
    chapters, currentChapter,
  };
}
