'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useLocale } from '@/lib/i18n';
import { READER_STRINGS } from '@/lib/book-i18n';
import { useParams, usePathname } from 'next/navigation';
import TranslationEditor from '@/components/pipeline/TranslationEditor';
import VersionBanner from '@/components/ui/VersionBanner';
import { useLoadingMetrics } from '@/hooks/useLoadingMetrics';
import { useSearchHighlight } from '@/hooks/useSearchHighlight';
import type { Book, Page } from '@/lib/types';
import { getTranslation } from '@/lib/page-translations';
import { pages as pagesApi, readingHistory } from '@/lib/api-client';
import Link from 'next/link';
import { localeHref, type Locale } from '@/lib/locale-path';

type ReadingLanguage = Locale;

interface PageEditorClientProps {
  initialBook: Book;
  initialPage: Page;
  initialPageList: Page[];
}

// Which reader section ('image' | 'ocr' | 'translation') is currently filling the
// viewport? Returns the section whose box straddles the viewport's vertical centre,
// else the nearest one. Used to keep a mobile reader in the same section across a
// page flip. Returns null when no sections are mounted.
function getActiveReaderSection(): string | null {
  const sections = Array.from(
    document.querySelectorAll<HTMLElement>('[data-reader-section]')
  );
  if (sections.length === 0) return null;
  const center = window.innerHeight / 2;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const el of sections) {
    const r = el.getBoundingClientRect();
    if (r.top <= center && r.bottom >= center) {
      return el.dataset.readerSection ?? null;
    }
    const dist = Math.min(Math.abs(r.top - center), Math.abs(r.bottom - center));
    if (dist < bestDist) {
      bestDist = dist;
      best = el.dataset.readerSection ?? null;
    }
  }
  return best;
}

// Component that handles search highlighting (needs Suspense)
function SearchHighlighter() {
  useSearchHighlight({ delay: 800 });
  return null;
}

export default function PageEditorClient({
  initialBook,
  initialPage,
  initialPageList,
}: PageEditorClientProps) {
  const [book] = useState<Book>(initialBook);
  const [pageList] = useState<Page[]>(initialPageList);
  const [currentPageId, setCurrentPageId] = useState<string>(initialPage.id);
  const [currentPage, setCurrentPage] = useState<Page>(initialPage);
  const params = useParams<{ tenant: string }>();
  const pathname = usePathname();
  // Reading language IS the URL (#4112): /book/… is English, /es/book/… is
  // Spanish. No stored preference, no client state — the same value the rest of
  // the page's chrome is rendered from, so the address bar can never disagree
  // with what the reader is looking at. The EN/ES control below is a LINK
  // between the two URLs, not a view toggle.
  const lang: ReadingLanguage = useLocale();
  const isOnTenantSubdomain = typeof window !== 'undefined' && /^[a-z]+\.sourcelibrary\.org$/.test(window.location.hostname);
  const isOnEmbedRoute = pathname?.startsWith('/embed/');
  // On the Spanish twin (/es/book/…) every URL this component writes keeps the
  // /es prefix, so page flips never drop the reader out of the Spanish site (#4082).
  const isOnEsRoute = pathname === '/es' || (pathname?.startsWith('/es/') ?? false);
  const rs = READER_STRINGS[lang];
  const tenantPrefix = isOnTenantSubdomain ? '' : isOnEsRoute ? '/es' : (params?.tenant ? `${isOnEmbedRoute ? '/embed' : ''}/${params.tenant}` : '');
  // Every reader URL this component writes uses the book's slug — the same
  // human-readable segment the book page uses (/book/a-sacred-repository-…),
  // never the raw ObjectId. The route resolves either (findBookByIdOrSlug) and
  // the canonical <link> was already slug-based, but the address bar is what
  // readers copy and share, so it has to be the readable one.
  const bookPath = book.slug || book.id;

  // Canonical (English, unprefixed) path of the page currently on screen. Built
  // from currentPageId rather than usePathname() because page flips use
  // history.pushState, which Next's router does not observe — usePathname would
  // still name the page the reader landed on. localeHref() adds the /es prefix.
  const readerPath = `/book/${bookPath}/page/${currentPageId}`;

  // Version pinning: detect ?v= param for citation-pinned reading
  const [pinnedVersion, setPinnedVersion] = useState<string | null>(null);
  const [versionedTranslation, setVersionedTranslation] = useState<string | null>(null);
  const [versionEdition, setVersionEdition] = useState<{
    version: string;
    versionLabel?: string;
    publishedAt: string;
    isCurrentVersion: boolean;
    doi?: string;
    doiUrl?: string;
  } | null>(null);

  // Page cache: stores full page data keyed by page ID
  const pageCacheRef = useRef<Map<string, Page>>(new Map());

  // Seed cache with the server-provided page
  useEffect(() => {
    pageCacheRef.current.set(initialPage.id, initialPage);
  }, [initialPage]);

  // Detect ?v= on mount and fetch versioned content
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('v');
    if (!v) return;
    setPinnedVersion(v);

    fetch(`/api/books/${book.id}/edition-page?page_id=${initialPage.id}&v=${encodeURIComponent(v)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data) return;
        setVersionedTranslation(data.translation);
        setVersionEdition({
          version: data.edition.version,
          versionLabel: data.edition.versionLabel,
          publishedAt: data.edition.publishedAt,
          isCurrentVersion: data.is_current_version,
          doi: data.edition.doi,
          doiUrl: data.edition.doiUrl,
        });
      })
      .catch(() => {
        // Version not found — fall back to current
        setPinnedVersion(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch versioned content when navigating to a new page while version-pinned
  useEffect(() => {
    if (!pinnedVersion || currentPageId === initialPage.id) return;

    fetch(`/api/books/${book.id}/edition-page?page_id=${currentPageId}&v=${encodeURIComponent(pinnedVersion)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data) {
          setVersionedTranslation(null);
          return;
        }
        setVersionedTranslation(data.translation);
        if (data.edition) {
          setVersionEdition(prev => prev ? {
            ...prev,
            isCurrentVersion: data.is_current_version,
          } : prev);
        }
      })
      .catch(() => setVersionedTranslation(null));
  }, [currentPageId, pinnedVersion, book.id, initialPage.id]);

  // Track loading metrics
  const { markLoaded } = useLoadingMetrics('page_editor', { bookId: book.id });

  useEffect(() => {
    markLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch a single page's full data, with cache
  const fetchPageData = useCallback(async (pageId: string): Promise<Page | null> => {
    const cached = pageCacheRef.current.get(pageId);
    if (cached) return cached;

    try {
      const page = await pagesApi.get(pageId);
      pageCacheRef.current.set(pageId, page);
      return page;
    } catch (error) {
      console.error(`Failed to fetch page ${pageId}:`, error);
      return null;
    }
  }, []);

  // Prefetch pages around the current index (5 ahead, 2 behind) in a single batch request
  const prefetchAround = useCallback((index: number, pages: Page[]) => {
    const start = Math.max(0, index - 2);
    const end = Math.min(pages.length - 1, index + 5);

    const uncachedIds: string[] = [];
    for (let i = start; i <= end; i++) {
      if (i === index) continue;
      const pageId = pages[i].id;
      if (!pageCacheRef.current.has(pageId)) {
        uncachedIds.push(pageId);
      }
    }

    if (uncachedIds.length === 0) return;

    // Single batch request instead of N individual requests
    pagesApi.getBatch(uncachedIds).then((batchPages) => {
      for (const page of batchPages) {
        pageCacheRef.current.set(page.id, page);
      }
    }).catch(() => {
      // Fallback: fetch individually if batch fails
      for (const id of uncachedIds) {
        fetchPageData(id);
      }
    });
  }, [fetchPageData]);

  // Auto-skip leading blank pages: if landed on a blank page before any substantive content,
  // navigate to the first non-blank page (mirrors Google Books / IA behavior)
  useEffect(() => {
    if (initialPage.page_type !== 'blank') return;
    const firstSubstantive = pageList.findIndex(p => p.page_type !== 'blank');
    if (firstSubstantive <= 0) return;
    const currentIdx = pageList.findIndex(p => p.id === initialPage.id);
    if (currentIdx >= 0 && currentIdx < firstSubstantive) {
      handleNavigate(pageList[firstSubstantive].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefetch nearby pages on initial mount
  useEffect(() => {
    const idx = pageList.findIndex(p => p.id === initialPage.id);
    if (idx >= 0) {
      prefetchAround(idx, pageList);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When currentPageId changes (navigation), load that page's data
  useEffect(() => {
    // Skip on initial render — we already have the page from server
    if (currentPageId === initialPage.id && currentPage.id === initialPage.id) return;

    async function loadPage() {
      const cached = pageCacheRef.current.get(currentPageId);
      if (cached) {
        setCurrentPage(cached);
      } else {
        const pageData = await fetchPageData(currentPageId);
        if (pageData) {
          setCurrentPage(pageData);
        }
      }

      const idx = pageList.findIndex(p => p.id === currentPageId);
      if (idx >= 0) {
        prefetchAround(idx, pageList);
      }
    }

    loadPage();
  }, [currentPageId, initialPage.id, currentPage.id, pageList, fetchPageData, prefetchAround]);

  // Track reading progress (fire-and-forget, debounced).
  //
  // `document.referrer` is the document-load referrer, so it survives every
  // client-side page turn and keeps naming the surface the reader entered the
  // book from (a search result, a collection, an external link). The API only
  // stores it on the row that OPENS a session — later beacons in the same
  // sitting update the existing row and drop it — so sending it each time is
  // idempotent and records the entry point, not the last page turn.
  //
  // It was never sent until 2026-07-29, so every reading_history row written
  // before that date has an empty `referrer` and we cannot say how members
  // reached a book. Don't remove the argument again: the field looks unused
  // precisely because nothing was filling it.
  useEffect(() => {
    if (!currentPage?.page_number) return;
    const referrer = typeof document !== 'undefined' ? document.referrer : '';
    readingHistory.record(book.id, currentPageId, currentPage.page_number, referrer || undefined);
  }, [book.id, currentPageId, currentPage?.page_number]);

  // Readers land on the ObjectId form of this URL from search results, quote
  // links, shortlinks and old shares. The route serves it either way and the
  // canonical <link> is already slug-based, but the address bar is what gets
  // copied into a citation or a message — so swap the id segment for the slug
  // once on mount. replaceState preserves the query string (?highlight=, ?v=)
  // and adds no history entry, and it costs no server redirect on the site's
  // highest-volume URL set (the per-page route is ISR — a redirect there would
  // have to read searchParams and force it dynamic).
  // Rewrites whatever sits in the book position, not just an ObjectId, so a
  // stale slug from a rename (resolved via slug_aliases in findBookByIdOrSlug)
  // lands on the current one too.
  useEffect(() => {
    const slug = book.slug;
    if (!slug) return;
    const segments = window.location.pathname.split('/');
    const bookAt = segments.lastIndexOf('book') + 1;
    if (bookAt === 0 || !segments[bookAt] || segments[bookAt] === slug) return;
    segments[bookAt] = slug;
    window.history.replaceState(
      null,
      '',
      `${segments.join('/')}${window.location.search}${window.location.hash}`
    );
  }, [book.slug]);

  // Client-side navigation - update URL and current page
  const handleNavigate = useCallback((newPageId: string, opts?: { toTop?: boolean }) => {
    // On mobile the panels stack vertically (image, then OCR, then translation).
    // Flipping a page used to dump the reader back to the top of the page even
    // when they were mid-way through the translation. Capture which panel is
    // currently filling the viewport *before* the swap, so we can land on the
    // same panel of the new page. (Reader feedback: "going to the next page from
    // the OCR or translation should take you to the same part of the next page.")
    // Exception: a swipe passes { toTop: true } — readers expect a swipe to land
    // at the top of the new page, and section-preserving read as "lands mid-page"
    // there (#3085).
    const isMobile = window.innerWidth < 1024;
    const activeSection = isMobile && !opts?.toTop ? (getActiveReaderSection() || 'image') : null;

    setCurrentPageId(newPageId);
    // Build URL with supported query params (version pinning)
    const newParams = new URLSearchParams();
    if (pinnedVersion) newParams.set('v', pinnedVersion);
    // No language param: on the Spanish twin the /es prefix rides on
    // tenantPrefix, so every flipped-to URL is already a Spanish URL (#4112).
    const suffix = newParams.toString() ? `?${newParams.toString()}` : '';
    window.history.pushState(null, '', `${tenantPrefix}/book/${bookPath}/page/${newPageId}${suffix}`);

    if (isMobile && activeSection) {
      // Land on the same section the reader was in (image / OCR / translation),
      // at its top. The section <div>s persist across the page swap (only their
      // content changes), so the same selector resolves on the new page. Two rAFs
      // wait for the swap + the child's content render before measuring/scrolling.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = document.querySelector(`[data-reader-section="${activeSection}"]`);
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
        else window.scrollTo({ top: 0, behavior: 'instant' });
      }));
    } else if (isMobile) {
      // Swipe (opts.toTop): always land at the very top of the new page. Wait two
      // rAFs so the page swap has committed before scrolling.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }));
    } else {
      // Desktop: go to the top.
      window.scrollTo({ top: 0, behavior: 'instant' });
    }

    // Notify embed.js host frame (no-op when not in an iframe)
    if (window.self !== window.top) {
      window.parent.postMessage(
        { type: 'sl-navigate', book: bookPath, page: newPageId },
        '*'
      );
    }
  }, [bookPath, pinnedVersion, tenantPrefix]);

  const currentIndex = pageList.findIndex(p => p.id === currentPageId);

  const handleSave = async (data: { ocr?: string; translation?: string; summary?: string }) => {
    if (!currentPage) return;

    const updatedPage = await pagesApi.update(currentPage.id, {
      ocr: data.ocr ? { data: data.ocr, language: book?.language || 'Latin' } : undefined,
      translation: data.translation ? { data: data.translation, language: 'English' } : undefined,
      summary: data.summary ? { data: data.summary } : undefined
    });

    if (updatedPage) {
      pageCacheRef.current.set(currentPage.id, updatedPage as unknown as Page);
      setCurrentPage(updatedPage as unknown as Page);
    }
  };

  // Spanish edition availability (per-page; pivot-translated from English).
  // Read via the language-keyed model (translations.es) with legacy
  // translation_es fallback, so this keeps working through the #2835 migration.
  const spanishTranslation = getTranslation(currentPage, 'es');
  const hasSpanish = !!spanishTranslation?.data;
  // Version pinning is English-edition-specific, so it disables the ES view.
  const showSpanish = lang === 'es' && hasSpanish && !pinnedVersion;

  // Build the page handed to the reader, overlaying (in precedence order):
  //   1. Spanish edition when the ES toggle is active
  //   2. the version-pinned English translation when ?v= is set
  let displayPage = currentPage;
  if (showSpanish) {
    displayPage = {
      ...currentPage,
      translation: { ...(currentPage.translation || {}), ...spanishTranslation!, language: 'Spanish' },
    } as Page;
  } else if (pinnedVersion && versionedTranslation != null) {
    displayPage = {
      ...currentPage,
      translation: currentPage.translation
        ? { ...currentPage.translation, data: versionedTranslation }
        : { data: versionedTranslation, language: 'en', model: 'versioned' },
    } as Page;
  }

  // EN/ES as LINKS between `/book/…` and `/es/book/…`, not as a view toggle:
  // the language a reader is in is always the URL they are on (#4112). It rides
  // INSIDE the reader's own header (#4124) rather than in a band above it — a
  // separate strip made the ~100 books with a Spanish edition look like they
  // carried a site notice, and put the one control that changes what you are
  // reading outside the bar holding every other reading control.
  // Hidden inside a tenant reading room or an embed — those surfaces have no
  // `/es` twin and must never link off-tenant — and hidden on a pinned citation
  // URL, whose whole point is that it resolves to one fixed text.
  const showLanguageSwitch =
    hasSpanish && !pinnedVersion && !isOnTenantSubdomain && !isOnEmbedRoute && !params?.tenant;
  const languageSwitch = showLanguageSwitch ? (
    <div
      className="inline-flex shrink-0 overflow-hidden rounded-lg text-xs font-medium"
      style={{ background: 'var(--bg-warm)' }}
      role="group"
      aria-label={rs.readingLanguage}
    >
      {(['en', 'es'] as const).map((code) => (
        <Link
          key={code}
          href={localeHref(code, readerPath)}
          aria-current={lang === code ? 'page' : undefined}
          className="px-2 sm:px-2.5 py-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-accent-rust focus-visible:outline-none"
          style={{
            background: lang === code ? 'var(--accent-rust)' : 'transparent',
            color: lang === code ? '#fff' : 'var(--text-muted)',
          }}
        >
          <span className="hidden sm:inline">{code === 'en' ? 'English' : 'Español'}</span>
          <span className="sm:hidden">{code === 'en' ? 'EN' : 'ES'}</span>
        </Link>
      ))}
    </div>
  ) : null;

  return (
    <>
      <Suspense fallback={null}>
        <SearchHighlighter />
      </Suspense>

      {versionEdition && (
        <VersionBanner
          version={versionEdition.version}
          versionLabel={versionEdition.versionLabel}
          publishedAt={versionEdition.publishedAt}
          isCurrentVersion={versionEdition.isCurrentVersion}
          doi={versionEdition.doi}
          doiUrl={versionEdition.doiUrl}
          bookUrl={`${tenantPrefix}/book/${bookPath}/page/${currentPageId}`}
        />
      )}

      <TranslationEditor
        book={book}
        languageSwitch={languageSwitch}
        page={displayPage}
        pages={pageList}
        currentIndex={currentIndex}
        onNavigate={handleNavigate}
        onSave={pinnedVersion ? async () => { } : handleSave}
        onRefresh={pinnedVersion ? async () => { } : async () => {
          try {
            const pageData = await pagesApi.get(currentPageId);
            pageCacheRef.current.set(currentPageId, pageData);
            setCurrentPage(pageData);
          } catch (error) {
            console.error('Failed to refresh page data:', error);
          }
        }}
      />
    </>
  );
}
