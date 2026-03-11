'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import TranslationEditor from '@/components/pipeline/TranslationEditor';
import { useLoadingMetrics } from '@/hooks/useLoadingMetrics';
import { useSearchHighlight } from '@/hooks/useSearchHighlight';
import type { Book, Page } from '@/lib/types';
import { pages as pagesApi, bookshelf, readingHistory } from '@/lib/api-client';

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

  // Page cache: stores full page data keyed by page ID
  const pageCacheRef = useRef<Map<string, Page>>(new Map());

  // Seed cache with the server-provided page
  useEffect(() => {
    pageCacheRef.current.set(initialPage.id, initialPage);
  }, [initialPage]);

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

  // Prefetch pages around the current index (5 ahead, 2 behind)
  const prefetchAround = useCallback((index: number, pages: Page[]) => {
    const start = Math.max(0, index - 2);
    const end = Math.min(pages.length - 1, index + 5);

    for (let i = start; i <= end; i++) {
      if (i === index) continue;
      const pageId = pages[i].id;
      if (!pageCacheRef.current.has(pageId)) {
        fetchPageData(pageId);
      }
    }
  }, [fetchPageData]);

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

  // Track reading progress for bookshelf (fire-and-forget, debounced)
  useEffect(() => {
    if (!currentPage?.page_number) return;
    bookshelf.trackProgress(book.id, currentPageId, currentPage.page_number);
  }, [book.id, currentPageId, currentPage?.page_number]);

  // Track reading history (fire-and-forget, server handles session collapsing)
  useEffect(() => {
    if (!currentPage?.page_number) return;
    readingHistory.record(book.id, currentPageId, currentPage.page_number);
  }, [book.id, currentPageId, currentPage?.page_number]);

  // Client-side navigation - update URL and current page
  const handleNavigate = useCallback((newPageId: string) => {
    setCurrentPageId(newPageId);
    window.history.pushState(null, '', `/book/${book.id}/page/${newPageId}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [book.id]);

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

  return (
    <>
      <Suspense fallback={null}>
        <SearchHighlighter />
      </Suspense>

      <TranslationEditor
        book={book}
        page={currentPage}
        pages={pageList}
        currentIndex={currentIndex}
        onNavigate={handleNavigate}
        onSave={handleSave}
        onRefresh={async () => {
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
