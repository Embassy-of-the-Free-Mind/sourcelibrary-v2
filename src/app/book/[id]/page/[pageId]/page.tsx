'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import TranslationEditor from '@/components/TranslationEditor';
import { BookLoader } from '@/components/ui/BookLoader';
import { useLoadingMetrics } from '@/hooks/useLoadingMetrics';
import { useSearchHighlight } from '@/hooks/useSearchHighlight';
import type { Book, Page } from '@/lib/types';

interface PageProps {
  params: Promise<{ id: string; pageId: string }>;
}

// Component that handles search highlighting (needs Suspense)
function SearchHighlighter() {
  useSearchHighlight({ delay: 800 });
  return null;
}

// Fetch with timeout for mobile networks
async function fetchWithTimeout(url: string, timeout = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out. Please check your connection and try again.');
    }
    throw error;
  }
}

export default function PageEditorPage({ params }: PageProps) {
  const [bookId, setBookId] = useState<string>('');
  const [initialPageId, setInitialPageId] = useState<string>('');
  const [currentPageId, setCurrentPageId] = useState<string>('');
  const [book, setBook] = useState<Book | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    params
      .then(({ id, pageId }) => {
        setBookId(id);
        setInitialPageId(pageId);
        setCurrentPageId(pageId);
      })
      .catch((err) => {
        console.error('Failed to resolve page params:', err);
        setError('Failed to load page parameters');
        setLoading(false);
      });
  }, [params]);

  // Track loading metrics
  const { markLoaded } = useLoadingMetrics('page_editor', { bookId });

  // Only fetch book data once when bookId changes (not on every page change)
  useEffect(() => {
    if (!bookId) return;

    async function fetchData() {
      setLoading(true);
      setError(null);
      const startTime = performance.now();
      try {
        // Use timeout to prevent hanging on slow mobile networks
        const bookRes = await fetchWithTimeout(`/api/books/${bookId}?full=true`, 30000);
        if (!bookRes.ok) {
          if (bookRes.status === 404) {
            throw new Error('Book not found');
          }
          throw new Error(`Failed to load book (status ${bookRes.status})`);
        }
        const bookData = await bookRes.json();

        setBook(bookData);
        setPages(bookData.pages || []);
        markLoaded();

        // Log fetch timing in dev
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Page Editor] Loaded in ${(performance.now() - startTime).toFixed(0)}ms`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load book data';
        console.error('Error fetching data:', err);
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [bookId, markLoaded, retryCount]);

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

    const response = await fetch(`/api/pages/${currentPage.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ocr: data.ocr ? { data: data.ocr, language: book?.language || 'Latin' } : undefined,
        translation: data.translation ? { data: data.translation, language: 'English' } : undefined,
        summary: data.summary ? { data: data.summary } : undefined
      })
    });

    if (!response.ok) {
      throw new Error('Save failed');
    }
  };

  // Retry function for error recovery
  const handleRetry = useCallback(() => {
    setRetryCount(c => c + 1);
  }, []);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-stone-50">
        <BookLoader />
      </div>
    );
  }

  // Error state - show helpful message with retry option
  if (error) {
    const isTimeout = error.includes('timed out');
    const isNotFound = error.includes('not found');

    return (
      <div className="h-screen flex items-center justify-center" style={{ background: 'var(--bg-cream, #faf8f5)' }}>
        <div className="text-center px-6 max-w-md">
          <div className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ background: isTimeout ? 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)' : 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)' }}>
            <svg className="w-12 h-12" style={{ color: isTimeout ? 'var(--accent-rust, #c45d3a)' : '#dc2626' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isTimeout ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              )}
            </svg>
          </div>

          <h2 className="text-2xl font-medium mb-3" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary, #2c2416)' }}>
            {isTimeout ? 'Connection slow' : isNotFound ? 'Page not found' : 'Unable to load'}
          </h2>
          <p className="text-base mb-6" style={{ fontFamily: 'Newsreader, Georgia, serif', color: 'var(--text-muted, #8b8579)' }}>
            {isTimeout
              ? 'The request took too long. Please check your internet connection and try again.'
              : isNotFound
                ? 'This page may have been moved or doesn\'t exist in the manuscript.'
                : error}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {!isNotFound && (
              <button
                onClick={handleRetry}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white transition-all hover:opacity-90"
                style={{ background: 'var(--accent-rust, #c45d3a)' }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Try again
              </button>
            )}
            <a
              href={bookId ? `/book/${bookId}` : '/'}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all hover:opacity-90"
              style={{ background: 'var(--bg-warm, #f5f3f0)', color: 'var(--text-secondary, #4a4539)' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              {bookId ? 'Back to book' : 'Go home'}
            </a>
          </div>
        </div>
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
          const res = await fetch(`/api/books/${bookId}?full=true`);
          if (res.ok) {
            const data = await res.json();
            setBook(data);
            setPages(data.pages || []);
          }
        }}
      />
    </>
  );
}
