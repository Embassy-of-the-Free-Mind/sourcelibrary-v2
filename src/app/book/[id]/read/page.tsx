'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Menu, Loader2, List } from 'lucide-react';
import { Book, Page, Section } from '@/lib/types';
import ReadingSidebar from '@/components/ReadingSidebar';
import ModernizedReader from '@/components/ModernizedReader';

interface ReadPageProps {
  params: Promise<{ id: string }>;
}

export default function ReadPage({ params }: ReadPageProps) {
  const [bookId, setBookId] = useState<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false); // Closed by default on mobile
  const [currentPageNumber, setCurrentPageNumber] = useState(1);
  const contentRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Resolve params
  useEffect(() => {
    params.then(p => setBookId(p.id));
  }, [params]);

  // Fetch book data
  useEffect(() => {
    if (!bookId) return;

    async function fetchData() {
      try {
        setLoading(true);

        // Fetch book with pages
        const bookRes = await fetch(`/api/books/${bookId}`);
        if (!bookRes.ok) {
          throw new Error('Book not found');
        }
        const bookData = await bookRes.json();
        setBook(bookData);
        setPages(bookData.pages || []);

        // Fetch sections
        const sectionsRes = await fetch(`/api/books/${bookId}/sections`);
        if (sectionsRes.ok) {
          const sectionsData = await sectionsRes.json();
          setSections(sectionsData.sections || []);
        }

        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load book');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [bookId]);

  // Get pages for current section
  const currentSection = sections[currentSectionIndex];
  const sectionPages = currentSection
    ? pages.filter(p => p.page_number >= currentSection.startPage && p.page_number <= currentSection.endPage)
    : pages;

  // Navigation handlers
  const goToSection = useCallback((index: number) => {
    setCurrentSectionIndex(index);
    if (sections[index]) {
      setCurrentPageNumber(sections[index].startPage);
    }
    // Scroll to top
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [sections]);

  const goToPrevSection = useCallback(() => {
    if (currentSectionIndex > 0) {
      goToSection(currentSectionIndex - 1);
    }
  }, [currentSectionIndex, goToSection]);

  const goToNextSection = useCallback(() => {
    if (currentSectionIndex < sections.length - 1) {
      goToSection(currentSectionIndex + 1);
    }
  }, [currentSectionIndex, sections.length, goToSection]);

  // Track visible page as user scrolls
  const handlePageVisible = useCallback((pageNumber: number) => {
    setCurrentPageNumber(pageNumber);
  }, []);

  // Calculate progress
  const totalPages = pages.length;
  const progress = totalPages > 0 ? ((currentPageNumber - 1) / (totalPages - 1)) * 100 : 0;

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && e.altKey) {
        goToPrevSection();
      } else if (e.key === 'ArrowRight' && e.altKey) {
        goToNextSection();
      } else if (e.key === 'Escape') {
        setSidebarOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToPrevSection, goToNextSection]);

  // Swipe navigation for mobile
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;

    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;

    // Only trigger if horizontal swipe is dominant and significant
    if (Math.abs(deltaX) > 80 && Math.abs(deltaX) > Math.abs(deltaY) * 2) {
      if (deltaX > 0) {
        goToPrevSection();
      } else {
        goToNextSection();
      }
    }

    touchStartRef.current = null;
  }, [goToPrevSection, goToNextSection]);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-amber-600 mx-auto mb-4" />
          <p className="text-stone-600">Loading book...</p>
        </div>
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <BookOpen className="w-12 h-12 text-stone-400 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-stone-900 mb-2">Book Not Found</h1>
          <p className="text-stone-600 mb-4">{error || 'Unable to load book'}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-amber-600 hover:text-amber-700"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Library
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-20 safe-area-inset-top">
        <div className="flex items-center justify-between px-2 sm:px-4 py-2 sm:py-3">
          {/* Left side - Back + Menu */}
          <div className="flex items-center gap-1 sm:gap-3">
            <Link
              href={`/book/${bookId}`}
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg"
              aria-label="Back to book"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>

            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-stone-100 text-stone-600"
              aria-label={sidebarOpen ? 'Hide contents' : 'Show contents'}
            >
              <List className="w-5 h-5" />
            </button>
          </div>

          {/* Center - Section selector (tap to open sidebar on mobile) */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex-1 mx-2 sm:mx-4 text-center sm:hidden"
          >
            <p className="text-sm font-medium text-stone-900 truncate">
              {currentSection?.title || book.display_title || book.title}
            </p>
            <p className="text-xs text-stone-500">
              {sections.length > 1 ? `Section ${currentSectionIndex + 1} of ${sections.length}` : `Page ${currentPageNumber}`}
            </p>
          </button>

          {/* Desktop title */}
          <div className="hidden sm:flex flex-1 mx-4 items-center justify-center">
            <h1 className="font-serif font-semibold text-stone-900 truncate max-w-md text-center">
              {book.display_title || book.title}
            </h1>
          </div>

          {/* Right side - Section navigation */}
          <div className="flex items-center">
            <button
              onClick={goToPrevSection}
              disabled={currentSectionIndex === 0}
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Previous section"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            {/* Section indicator - desktop only */}
            <span className="hidden sm:block text-sm text-stone-600 min-w-[100px] text-center">
              {sections.length > 1 ? `${currentSectionIndex + 1} / ${sections.length}` : ''}
            </span>

            <button
              onClick={goToNextSection}
              disabled={currentSectionIndex >= sections.length - 1}
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Next section"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-stone-200">
          <div
            className="h-full bg-amber-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <ReadingSidebar
          sections={sections}
          currentSectionIndex={currentSectionIndex}
          onSectionSelect={goToSection}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        {/* Reading content */}
        <main
          ref={contentRef}
          className="flex-1 overflow-y-auto"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
            {/* Section header */}
            {currentSection && (
              <div className="mb-6 sm:mb-8 pb-4 sm:pb-6 border-b border-stone-200">
                <h2 className="text-xl sm:text-2xl font-serif font-bold text-stone-900">
                  {currentSection.title}
                </h2>
                <p className="text-xs sm:text-sm text-stone-500 mt-1">
                  Pages {currentSection.startPage}–{currentSection.endPage}
                </p>
                {currentSection.summary && (
                  <p className="text-sm sm:text-base text-stone-600 mt-3 leading-relaxed">
                    {currentSection.summary}
                  </p>
                )}
              </div>
            )}

            {/* Modernized content */}
            <ModernizedReader
              pages={sectionPages}
              onPageVisible={handlePageVisible}
            />

            {/* Swipe hint on mobile */}
            {sections.length > 1 && (
              <div className="sm:hidden mt-8 text-center text-xs text-stone-400">
                Swipe left/right to change sections
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Footer - compact on mobile */}
      <footer className="bg-white border-t border-stone-200 px-4 py-2 safe-area-inset-bottom">
        <div className="flex items-center justify-between text-xs sm:text-sm text-stone-600">
          <span>Page {currentPageNumber} of {totalPages}</span>
          <div className="flex items-center gap-2">
            <div className="w-24 sm:w-32 h-1.5 bg-stone-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-all duration-300 rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span>{Math.round(progress)}%</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
