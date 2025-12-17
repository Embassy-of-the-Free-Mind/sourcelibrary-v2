'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import TranslationEditor from '@/components/TranslationEditor';
import type { Book, Page } from '@/lib/types';

interface PageProps {
  params: Promise<{ id: string; pageId: string }>;
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

  // Only fetch book data once when bookId changes (not on every page change)
  useEffect(() => {
    if (!bookId) return;

    async function fetchData() {
      setLoading(true);
      try {
        const bookRes = await fetch(`/api/books/${bookId}`);
        if (!bookRes.ok) throw new Error('Book not found');
        const bookData = await bookRes.json();

        setBook(bookData);
        setPages(bookData.pages || []);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [bookId]);

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

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-stone-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-4 text-stone-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!book || !currentPage) {
    return (
      <div className="h-screen flex items-center justify-center bg-stone-50">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-stone-900">Page not found</h2>
          <a href={`/book/${bookId}`} className="text-amber-600 hover:underline mt-2 inline-block">
            Back to book
          </a>
        </div>
      </div>
    );
  }

  return (
    <TranslationEditor
      book={book}
      page={currentPage}
      pages={pages}
      currentIndex={currentIndex}
      onNavigate={handleNavigate}
      onSave={handleSave}
    />
  );
}
