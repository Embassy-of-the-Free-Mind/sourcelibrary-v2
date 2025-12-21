'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  RotateCcw,
  Check,
  Info,
  Scissors,
  X
} from 'lucide-react';
import type { Book, Page } from '@/lib/types';
import SplitModeOverlay from '@/components/SplitModeOverlay';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function SplitPage({ params }: PageProps) {
  const [bookId, setBookId] = useState<string>('');
  const [book, setBook] = useState<Book | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);

  // Split state
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [splitPositions, setSplitPositions] = useState<Record<string, number>>({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [reviewingSplits, setReviewingSplits] = useState<Page[]>([]);
  const [resettingPage, setResettingPage] = useState<string | null>(null);

  useEffect(() => {
    params.then(({ id }) => setBookId(id));
  }, [params]);

  const fetchBook = useCallback(async () => {
    if (!bookId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/books/${bookId}`);
      if (res.ok) {
        const data = await res.json();
        setBook(data);
        setPages(data.pages || []);
      }
    } catch (error) {
      console.error('Error fetching book:', error);
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    fetchBook();
  }, [fetchBook]);

  // Filter to only show pages that can be split (not already split)
  const splittablePages = pages.filter(p => !p.split_from);

  const togglePageSelection = (pageId: string) => {
    setSelectedPages(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
        setSplitPositions(p => {
          const updated = { ...p };
          delete updated[pageId];
          return updated;
        });
      } else {
        next.add(pageId);
        setSplitPositions(p => ({ ...p, [pageId]: 500 }));
      }
      return next;
    });
  };

  const selectAll = () => {
    const allIds = new Set(splittablePages.map(p => p.id));
    setSelectedPages(allIds);
    const positions: Record<string, number> = {};
    splittablePages.forEach(p => {
      positions[p.id] = splitPositions[p.id] ?? 500;
    });
    setSplitPositions(positions);
  };

  const clearSelection = () => {
    setSelectedPages(new Set());
    setSplitPositions({});
  };

  const resetAllPositions = () => {
    const positions: Record<string, number> = {};
    selectedPages.forEach(id => {
      positions[id] = 500;
    });
    setSplitPositions(positions);
  };

  const adjustSplitPosition = (pageId: string, delta: number) => {
    setSplitPositions(prev => ({
      ...prev,
      [pageId]: Math.max(100, Math.min(900, (prev[pageId] ?? 500) + delta))
    }));
  };

  const setSplitPosition = (pageId: string, position: number) => {
    setSplitPositions(prev => ({
      ...prev,
      [pageId]: position
    }));
  };

  const applySplits = async () => {
    const pagesToSplit = Array.from(selectedPages);
    if (pagesToSplit.length === 0) return;

    const originalIds = new Set(pagesToSplit);
    setSplitting(true);
    setShowConfirm(false);

    try {
      const splits = pagesToSplit.map(pageId => ({
        pageId,
        splitPosition: splitPositions[pageId] ?? 500
      }));

      await fetch('/api/pages/batch-split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ splits })
      });

      // Fetch updated book and show results
      const res = await fetch(`/api/books/${bookId}`);
      if (res.ok) {
        const data = await res.json();
        setBook(data);
        setPages(data.pages || []);

        // Find all pages from the splits
        const allSplitPages = (data.pages || []).filter((p: Page) =>
          originalIds.has(p.id) || (p.split_from && originalIds.has(p.split_from))
        );

        if (allSplitPages.length > 0) {
          allSplitPages.sort((a: Page, b: Page) => a.page_number - b.page_number);
          setReviewingSplits(allSplitPages);
        }
      }

      // Clear selection
      setSelectedPages(new Set());
      setSplitPositions({});
    } catch (error) {
      console.error('Batch split failed:', error);
    } finally {
      setSplitting(false);
    }
  };

  // Reset a split page back to original (delete it and its sibling, restore original)
  const resetSplitPage = async (pageId: string) => {
    const page = pages.find(p => p.id === pageId);
    if (!page) return;

    setResettingPage(pageId);
    try {
      // Find the original page and its split sibling
      const originalId = page.split_from || page.id;
      const siblingId = page.split_from ? page.id : pages.find(p => p.split_from === page.id)?.id;

      // Call reset endpoint for this page
      await fetch(`/api/pages/${originalId}/reset`, { method: 'POST' });

      // Refresh
      await fetchBook();
      setReviewingSplits(prev => prev.filter(p => p.id !== pageId && p.id !== siblingId && p.id !== originalId));
    } catch (error) {
      console.error('Reset error:', error);
    } finally {
      setResettingPage(null);
    }
  };

  const getImageUrl = (page: Page, width: number = 300) => {
    if (page.crop?.xStart !== undefined && page.crop?.xEnd !== undefined) {
      return `/api/image?url=${encodeURIComponent(page.photo_original || page.photo)}&w=${width}&q=70&cx=${page.crop.xStart}&cw=${page.crop.xEnd}`;
    }
    return `/api/image?url=${encodeURIComponent(page.photo)}&w=${width}&q=70`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  if (!book) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <p>Book not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href={`/book/${bookId}`} className="text-stone-600 hover:text-stone-900">
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-lg font-semibold text-stone-900">Split Pages</h1>
                <p className="text-sm text-stone-500">{book.display_title || book.title}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={`/book/${bookId}/prepare`}
                className="flex items-center gap-2 px-3 py-2 text-sm text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg"
              >
                OCR & Translation →
              </Link>
            </div>
          </div>
        </div>

        {/* Explanation */}
        <div className="border-t border-stone-100 bg-blue-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-1">How page splitting works:</p>
                <p>Click pages to select them. Drag the red line or click the grey zones to adjust.
                Each page becomes two. <strong>Originals are safe</strong> — we create cropped views with 2% overlap.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="border-t border-stone-100 bg-stone-50/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex items-center gap-8 text-sm">
              <span className="text-stone-600">
                <strong>{pages.length}</strong> total pages
              </span>
              <span className="text-stone-600">
                <strong>{splittablePages.length}</strong> can be split
              </span>
              <span className="text-stone-600">
                <strong>{pages.length - splittablePages.length}</strong> already split
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Action Bar */}
      <div className="bg-white border-b border-stone-200 sticky top-[157px] z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-amber-700">
                {selectedPages.size} page{selectedPages.size !== 1 ? 's' : ''} selected
              </span>
              <button
                onClick={selectAll}
                className="px-4 py-2 text-sm font-medium bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200"
              >
                Select All ({splittablePages.length})
              </button>
              {selectedPages.size > 0 && (
                <>
                  <button onClick={clearSelection} className="text-sm text-stone-500 hover:text-stone-700">
                    Clear
                  </button>
                  <button
                    onClick={resetAllPositions}
                    className="flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset to 50%
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Pages Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {splittablePages.map((page) => {
            const isSelected = selectedPages.has(page.id);
            const imageUrl = getImageUrl(page, 400);

            return (
              <div
                key={page.id}
                className={`bg-white rounded-lg border p-3 transition-all cursor-pointer ${
                  isSelected
                    ? 'border-amber-400 ring-2 ring-amber-200'
                    : 'border-stone-200 hover:border-stone-300'
                }`}
                onClick={() => togglePageSelection(page.id)}
              >
                {/* Image */}
                <div className="relative aspect-[3/4] rounded overflow-hidden mb-2 bg-stone-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl}
                    alt={`Page ${page.page_number}`}
                    className="w-full h-full object-contain"
                  />
                  {/* Already split indicator */}
                  {page.crop && !isSelected && (
                    <div className="absolute top-2 right-2 px-2 py-1 bg-blue-500/90 text-white text-xs rounded">
                      Split (left)
                    </div>
                  )}
                  {/* Split overlay */}
                  {isSelected && splitPositions[page.id] !== undefined && (
                    <SplitModeOverlay
                      splitPosition={splitPositions[page.id]}
                      onAdjust={(delta) => adjustSplitPosition(page.id, delta)}
                      onSetPosition={(pos) => setSplitPosition(page.id, pos)}
                    />
                  )}
                </div>

                {/* Page info */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-stone-600">Page {page.page_number}</span>
                  {isSelected ? (
                    <span className="text-xs text-amber-600 font-medium">
                      {((splitPositions[page.id] ?? 500) / 10).toFixed(1)}%
                    </span>
                  ) : page.crop ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        resetSplitPage(page.id);
                      }}
                      disabled={resettingPage === page.id}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-stone-500 hover:text-amber-600 hover:bg-amber-50 rounded disabled:opacity-50"
                      title="Reset this split"
                    >
                      {resettingPage === page.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3 h-3" />
                      )}
                      Reset
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {splittablePages.length === 0 && (
          <div className="text-center py-16 bg-white rounded-lg border border-stone-200">
            <p className="text-stone-500">All pages have been split</p>
            <Link
              href={`/book/${bookId}/prepare`}
              className="inline-block mt-4 text-amber-600 hover:text-amber-800"
            >
              Continue to OCR & Translation →
            </Link>
          </div>
        )}
      </main>

      {/* Floating Split Button */}
      {selectedPages.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30">
          <button
            onClick={() => setShowConfirm(true)}
            disabled={splitting}
            className="flex items-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-full shadow-lg hover:bg-amber-700 disabled:opacity-50 text-sm font-medium"
          >
            {splitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Scissors className="w-5 h-5" />
            )}
            Split {selectedPages.size} Page{selectedPages.size !== 1 ? 's' : ''}
          </button>
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-stone-900 mb-2">Confirm Split</h3>
            <p className="text-sm text-stone-600 mb-4">
              You&apos;re about to split <strong>{selectedPages.size} page{selectedPages.size !== 1 ? 's' : ''}</strong> into {selectedPages.size * 2} pages.
              This may take a moment.
            </p>
            <p className="text-sm text-stone-500 mb-6">
              Your original images are preserved. You can reset any split if needed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 text-sm text-stone-600 hover:text-stone-900"
              >
                Cancel
              </button>
              <button
                onClick={applySplits}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm"
              >
                <Scissors className="w-4 h-4" />
                Split Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Splitting Progress */}
      {splitting && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-8 text-center">
            <Loader2 className="w-12 h-12 animate-spin text-amber-600 mx-auto mb-4" />
            <p className="text-lg font-medium text-stone-900">Splitting pages...</p>
            <p className="text-sm text-stone-500 mt-2">This may take a moment</p>
          </div>
        </div>
      )}

      {/* Split Results Modal */}
      {reviewingSplits.length > 0 && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full mx-4 max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-stone-200">
              <div>
                <h2 className="text-lg font-semibold text-stone-900">Split Results</h2>
                <p className="text-sm text-stone-500">{reviewingSplits.length} pages created — reset any that don&apos;t look right</p>
              </div>
              <button
                onClick={() => setReviewingSplits([])}
                className="flex items-center gap-2 px-4 py-2 bg-stone-800 text-white rounded-lg hover:bg-stone-700"
              >
                <Check className="w-4 h-4" />
                Done
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {reviewingSplits.map((page) => {
                  const imageUrl = page.crop?.xStart !== undefined
                    ? `/api/image?url=${encodeURIComponent(page.photo_original || page.photo)}&w=400&q=80&cx=${page.crop.xStart}&cw=${page.crop.xEnd}`
                    : `/api/image?url=${encodeURIComponent(page.photo)}&w=400&q=80`;
                  const isResetting = resettingPage === page.id;

                  return (
                    <div key={page.id} className="relative group">
                      <div className={`aspect-[3/4] bg-stone-100 rounded-lg overflow-hidden border border-stone-200 ${isResetting ? 'opacity-50' : ''}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imageUrl}
                          alt={`Page ${page.page_number}`}
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm text-stone-600">Page {page.page_number}</span>
                        <button
                          onClick={() => resetSplitPage(page.id)}
                          disabled={isResetting}
                          className="flex items-center gap-1 p-1 text-stone-500 hover:text-amber-600 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                          title="Reset this split"
                        >
                          {isResetting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <RotateCcw className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
