'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Menu, X, Loader2 } from 'lucide-react';
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentPageNumber, setCurrentPageNumber] = useState(1);
  const contentRef = useRef<HTMLDivElement>(null);

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
      <header className="bg-white border-b border-stone-200 sticky top-0 z-20">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <Link
              href={`/book/${bookId}`}
              className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </Link>

            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg hover:bg-stone-100 text-stone-600"
              title={sidebarOpen ? 'Hide sections' : 'Show sections'}
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <div className="hidden sm:block">
              <h1 className="font-serif font-semibold text-stone-900 truncate max-w-md">
                {book.display_title || book.title}
              </h1>
            </div>
          </div>

          {/* Section navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={goToPrevSection}
              disabled={currentSectionIndex === 0}
              className="p-2 rounded-lg hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Previous section (Alt+←)"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <span className="text-sm text-stone-600 min-w-[120px] text-center">
              {currentSection?.title || 'All Pages'}
            </span>

            <button
              onClick={goToNextSection}
              disabled={currentSectionIndex >= sections.length - 1}
              className="p-2 rounded-lg hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next section (Alt+→)"
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
          className={`flex-1 overflow-y-auto transition-all duration-300 ${
            sidebarOpen ? 'lg:ml-0' : ''
          }`}
        >
          <div className="max-w-3xl mx-auto px-4 sm:px-8 py-8">
            {/* Section header */}
            {currentSection && (
              <div className="mb-8 pb-6 border-b border-stone-200">
                <h2 className="text-2xl font-serif font-bold text-stone-900">
                  {currentSection.title}
                </h2>
                <p className="text-sm text-stone-500 mt-1">
                  Pages {currentSection.startPage}–{currentSection.endPage}
                </p>
                {currentSection.summary && (
                  <p className="text-stone-600 mt-3 leading-relaxed">
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
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer className="bg-white border-t border-stone-200 px-4 py-2">
        <div className="flex items-center justify-between text-sm text-stone-600">
          <span>Page {currentPageNumber} of {totalPages}</span>
          <span>{Math.round(progress)}% complete</span>
        </div>
      </footer>
    </div>
  );
}
