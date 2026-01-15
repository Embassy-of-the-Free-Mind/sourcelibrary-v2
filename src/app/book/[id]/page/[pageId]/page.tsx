'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import TranslationEditor from '@/components/pipeline/TranslationEditor';
import { BookLoader } from '@/components/ui/BookLoader';
import { useLoadingMetrics } from '@/hooks/useLoadingMetrics';
import { useSearchHighlight } from '@/hooks/useSearchHighlight';
import type { Book, Page } from '@/lib/types';
import { books, pages as pagesApi } from '@/lib/api-client';

interface PageProps {
  params: Promise<{ id: string; pageId: string }>;
}

// Component that handles search highlighting (needs Suspense)
function SearchHighlighter() {
  useSearchHighlight({ delay: 800 });
  return null;
}

export default function PageEditorPage({ params }: PageProps) {
  const router = useRouter();
  const [bookId, setBookId] = useState<string>('');
  const [initialPageId, setInitialPageId] = useState<string>('');
  const [currentPageId, setCurrentPageId] = useState<string>('');
  const [book, setBook] = useState<Book | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    params.then(({ id, pageId }) => {
      setBookId(id);
      setInitialPageId(pageId);
      setCurrentPageId(pageId);
    });
  }, [params]);

  // Track loading metrics
  const { markLoaded } = useLoadingMetrics('page_editor', { bookId });

  // Only fetch book data once when bookId changes (not on every page change)
  useEffect(() => {
    if (!bookId) return;

    async function fetchData() {
      setLoading(true);
      const startTime = performance.now();
      try {
        const bookData = await books.get(bookId, { full: true }) as import('@/lib/api-client').BookWithPages;

        setBook(bookData);
        setPages(bookData.pages || []);
        markLoaded();

        // Log fetch timing in dev
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Page Editor] Loaded in ${(performance.now() - startTime).toFixed(0)}ms`);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [bookId, markLoaded]);

  // Client-side navigation - no refetch, just update URL and current page
  const handleNavigate = useCallback((newPageId: string) => {
    setCurrentPageId(newPageId);
    // Update URL without triggering a refetch
    window.history.pushState(null, '', `/book/${bookId}/page/${newPageId}`);
  }, [bookId]);

  // Derive current page from pages array
  const currentPage = pages.find(p => p.id === currentPageId) || null;
  const currentIndex = pages.findIndex(p => p.id === currentPageId);

  const handleSave = async (data: { ocr?: string; translation?: string; summary?: string }) => {
    if (!currentPage) return;

    await pagesApi.update(currentPage.id, {
      ocr: data.ocr ? { data: data.ocr, language: book?.language || 'Latin' } : undefined,
      translation: data.translation ? { data: data.translation, language: 'English' } : undefined,
      summary: data.summary ? { data: data.summary } : undefined
    });
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-stone-50">
        <BookLoader />
      </div>
    );
  }

  if (!book || !currentPage) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: 'var(--bg-cream, #faf8f5)' }}>
        <div className="text-center px-6 max-w-md">
          {/* Decorative illustration */}
          <div className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)' }}>
            <svg className="w-12 h-12" style={{ color: 'var(--accent-rust, #c45d3a)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>

          <h2 className="text-2xl font-medium mb-3" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary, #2c2416)' }}>
            Page not found
          </h2>
          <p className="text-base mb-6" style={{ fontFamily: 'Newsreader, Georgia, serif', color: 'var(--text-muted, #8b8579)' }}>
            This page may have been moved or doesn&apos;t exist in the manuscript.
          </p>

          <a
            href={`/book/${bookId}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white transition-all hover:opacity-90"
            style={{ background: 'var(--accent-rust, #c45d3a)' }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to book
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Search highlighting - wrapped in Suspense for useSearchParams */}
      <Suspense fallback={null}>
        <SearchHighlighter />
      </Suspense>

      <TranslationEditor
        book={book}
        page={currentPage}
        pages={pages}
        currentIndex={currentIndex}
        onNavigate={handleNavigate}
        onSave={handleSave}
        onRefresh={async () => {
          try {
            const data = await books.get(bookId, { full: true }) as import('@/lib/api-client').BookWithPages;
            setBook(data);
            setPages(data.pages || []);
          } catch (error) {
            console.error('Failed to refresh book data:', error);
          }
        }}
      />
    </>
  );
}
