'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import TranslationEditor from '@/components/pipeline/TranslationEditor';
import VersionBanner from '@/components/ui/VersionBanner';
import { useLoadingMetrics } from '@/hooks/useLoadingMetrics';
import { useSearchHighlight } from '@/hooks/useSearchHighlight';
import type { Book, Page } from '@/lib/types';
import { pages as pagesApi, readingHistory } from '@/lib/api-client';

interface PageEditorClientProps {
  initialBook: Book;
  initialPage: Page;
  initialPageList: Page[];
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

  // Track reading progress (fire-and-forget, debounced)
  useEffect(() => {
    if (!currentPage?.page_number) return;
    readingHistory.record(book.id, currentPageId, currentPage.page_number);
  }, [book.id, currentPageId, currentPage?.page_number]);

  // Client-side navigation - update URL and current page
  const handleNavigate = useCallback((newPageId: string) => {
    setCurrentPageId(newPageId);
    const vSuffix = pinnedVersion ? `?v=${encodeURIComponent(pinnedVersion)}` : '';
    window.history.pushState(null, '', `/book/${book.id}/page/${newPageId}${vSuffix}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
    // Notify embed.js host frame (no-op when not in an iframe)
    if (window.self !== window.top) {
      window.parent.postMessage(
        { type: 'sl-navigate', book: book.slug || book.id, page: newPageId },
        '*'
      );
    }
  }, [book.id, book.slug, pinnedVersion]);

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

  // When version-pinned, overlay the versioned translation onto the page object
  const displayPage = pinnedVersion && versionedTranslation != null
    ? {
        ...currentPage,
        translation: currentPage.translation
          ? { ...currentPage.translation, data: versionedTranslation }
          : { data: versionedTranslation, language: 'en', model: 'versioned' },
      } as Page
    : currentPage;

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
          bookUrl={`/book/${book.id}/page/${currentPageId}`}
        />
      )}

      <TranslationEditor
        book={book}
        page={displayPage}
        pages={pageList}
        currentIndex={currentIndex}
        onNavigate={handleNavigate}
        onSave={pinnedVersion ? async () => {} : handleSave}
        onRefresh={pinnedVersion ? async () => {} : async () => {
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
