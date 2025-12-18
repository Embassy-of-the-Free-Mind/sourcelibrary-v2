'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  Scissors,
  Trash2,
  RotateCcw,
  Check,
  X,
  Loader2,
  ChevronUp,
  ChevronDown,
  Wand2,
  RefreshCw
} from 'lucide-react';
import type { Book, Page } from '@/lib/types';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface SplitDetection {
  isTwoPageSpread: boolean;
  confidence: string;
  reasoning?: string;
  leftPage?: { xmin: number; xmax: number; ymin: number; ymax: number };
  rightPage?: { xmin: number; xmax: number; ymin: number; ymax: number };
}

export default function PreparePage({ params }: PageProps) {
  const [bookId, setBookId] = useState<string>('');
  const [book, setBook] = useState<Book | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState<string | null>(null);
  const [detectionResults, setDetectionResults] = useState<Record<string, SplitDetection>>({});
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

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
        // Filter to only original pages (not split ones)
        const originalPages = (data.pages || []).filter((p: Page) => !p.split_from);
        setPages(originalPages);

        // Load existing detection results
        const results: Record<string, SplitDetection> = {};
        for (const page of data.pages || []) {
          if (page.split_detection) {
            results[page.id] = page.split_detection;
          }
        }
        setDetectionResults(results);
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

  const detectSplit = async (pageId: string) => {
    const page = pages.find(p => p.id === pageId);
    if (!page) return;

    setDetecting(pageId);
    try {
      const res = await fetch(`/api/pages/${pageId}/detect-split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: page.photo })
      });

      if (res.ok) {
        const result = await res.json();
        setDetectionResults(prev => ({ ...prev, [pageId]: result }));
      }
    } catch (error) {
      console.error('Detection error:', error);
    } finally {
      setDetecting(null);
    }
  };

  const detectAllSplits = async () => {
    for (const page of pages) {
      if (!detectionResults[page.id]) {
        await detectSplit(page.id);
        // Rate limit
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  };

  const togglePageSelection = (pageId: string) => {
    setSelectedPages(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  };

  const deletePage = async (pageId: string) => {
    if (!confirm('Delete this page? This cannot be undone.')) return;

    try {
      const res = await fetch(`/api/pages/${pageId}`, { method: 'DELETE' });
      if (res.ok) {
        setPages(prev => prev.filter(p => p.id !== pageId));
      }
    } catch (error) {
      console.error('Delete error:', error);
    }
  };

  const applySelectedSplits = async () => {
    if (selectedPages.size === 0) {
      alert('Select pages to split first');
      return;
    }

    setApplying(true);
    try {
      for (const pageId of selectedPages) {
        const detection = detectionResults[pageId];
        if (detection?.isTwoPageSpread) {
          await fetch(`/api/pages/${pageId}/split`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ detection })
          });
        }
      }
      // Refresh
      await fetchBook();
      setSelectedPages(new Set());
    } catch (error) {
      console.error('Apply error:', error);
    } finally {
      setApplying(false);
    }
  };

  const resetBook = async () => {
    if (!confirm('Reset all pages to original state? This will delete all splits.')) return;

    setApplying(true);
    try {
      await fetch(`/api/books/${bookId}/reset`, { method: 'POST' });
      await fetchBook();
      setDetectionResults({});
      setSelectedPages(new Set());
    } catch (error) {
      console.error('Reset error:', error);
    } finally {
      setApplying(false);
    }
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

  const pagesWithSplits = pages.filter(p => detectionResults[p.id]?.isTwoPageSpread);
  const pagesDetected = pages.filter(p => detectionResults[p.id]);

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href={`/book/${bookId}`} className="text-stone-600 hover:text-stone-900">
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-lg font-semibold text-stone-900">Prepare Pages</h1>
                <p className="text-sm text-stone-500">{book.display_title || book.title}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={resetBook}
                disabled={applying}
                className="flex items-center gap-2 px-3 py-2 text-sm text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
              <button
                onClick={detectAllSplits}
                disabled={detecting !== null}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-stone-800 text-white rounded-lg hover:bg-stone-700 disabled:opacity-50"
              >
                <Wand2 className="w-4 h-4" />
                Detect All Splits
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6 text-sm">
              <span className="text-stone-600">
                <strong>{pages.length}</strong> original pages
              </span>
              <span className="text-stone-600">
                <strong>{pagesDetected.length}</strong> analyzed
              </span>
              <span className="text-teal-600">
                <strong>{pagesWithSplits.length}</strong> two-page spreads detected
              </span>
              {selectedPages.size > 0 && (
                <span className="text-amber-600">
                  <strong>{selectedPages.size}</strong> selected
                </span>
              )}
            </div>

            {selectedPages.size > 0 && (
              <button
                onClick={applySelectedSplits}
                disabled={applying}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {applying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Scissors className="w-4 h-4" />
                )}
                Apply {selectedPages.size} Split{selectedPages.size > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Pages List */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-4">
          {pages.map((page, index) => {
            const detection = detectionResults[page.id];
            const isSelected = selectedPages.has(page.id);
            const isDetecting = detecting === page.id;

            return (
              <div
                key={page.id}
                className={`bg-white rounded-lg border ${isSelected ? 'border-amber-400 ring-2 ring-amber-100' : 'border-stone-200'} overflow-hidden`}
              >
                <div className="flex items-stretch">
                  {/* Checkbox */}
                  <div className="flex items-center px-4 border-r border-stone-100">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => togglePageSelection(page.id)}
                      disabled={!detection?.isTwoPageSpread}
                      className="w-5 h-5 rounded border-stone-300 text-amber-600 focus:ring-amber-500 disabled:opacity-30"
                    />
                  </div>

                  {/* Page Number */}
                  <div className="flex items-center justify-center w-16 bg-stone-50 text-stone-500 font-medium">
                    {page.page_number}
                  </div>

                  {/* Image Preview */}
                  <div className="relative w-48 h-32 bg-stone-100 flex-shrink-0">
                    {page.photo && (
                      <Image
                        src={page.photo}
                        alt={`Page ${page.page_number}`}
                        fill
                        className="object-contain"
                        sizes="192px"
                      />
                    )}
                    {/* Overlay crop boxes if detected */}
                    {detection?.isTwoPageSpread && detection.leftPage && detection.rightPage && (
                      <div className="absolute inset-0 pointer-events-none">
                        <div
                          className="absolute border-2 border-blue-500 bg-blue-500/10"
                          style={{
                            left: `${detection.leftPage.xmin / 10}%`,
                            top: `${detection.leftPage.ymin / 10}%`,
                            width: `${(detection.leftPage.xmax - detection.leftPage.xmin) / 10}%`,
                            height: `${(detection.leftPage.ymax - detection.leftPage.ymin) / 10}%`,
                          }}
                        />
                        <div
                          className="absolute border-2 border-red-500 bg-red-500/10"
                          style={{
                            left: `${detection.rightPage.xmin / 10}%`,
                            top: `${detection.rightPage.ymin / 10}%`,
                            width: `${(detection.rightPage.xmax - detection.rightPage.xmin) / 10}%`,
                            height: `${(detection.rightPage.ymax - detection.rightPage.ymin) / 10}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Detection Result */}
                  <div className="flex-1 p-4">
                    {isDetecting ? (
                      <div className="flex items-center gap-2 text-stone-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Analyzing...
                      </div>
                    ) : detection ? (
                      <div>
                        <div className="flex items-center gap-2">
                          {detection.isTwoPageSpread ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-teal-100 text-teal-800 rounded text-sm font-medium">
                              <Scissors className="w-3 h-3" />
                              Two-Page Spread
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-stone-100 text-stone-600 rounded text-sm font-medium">
                              <Check className="w-3 h-3" />
                              Single Page
                            </span>
                          )}
                          <span className="text-xs text-stone-400">
                            {detection.confidence} confidence
                          </span>
                        </div>
                        {detection.reasoning && (
                          <p className="mt-2 text-sm text-stone-500 line-clamp-2">
                            {detection.reasoning}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="text-stone-400 text-sm">
                        Not analyzed yet
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 px-4 border-l border-stone-100">
                    <button
                      onClick={() => detectSplit(page.id)}
                      disabled={isDetecting}
                      className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded"
                      title="Analyze page"
                    >
                      <RefreshCw className={`w-4 h-4 ${isDetecting ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                      onClick={() => deletePage(page.id)}
                      className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded"
                      title="Delete page"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {pages.length === 0 && (
          <div className="text-center py-16 bg-white rounded-lg border border-stone-200">
            <p className="text-stone-500">No pages to prepare</p>
          </div>
        )}
      </main>
    </div>
  );
}
