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
  const [splitWarnings, setSplitWarnings] = useState<Record<string, string>>({});
  const [detectingPages, setDetectingPages] = useState<Set<string>>(new Set());
  const [useAutoDetect, setUseAutoDetect] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [reviewingSplits, setReviewingSplits] = useState<Page[]>([]);
  const [resettingPage, setResettingPage] = useState<string | null>(null);
  const [resettingAll, setResettingAll] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Client-side split detection using already-loaded image
  const detectSplitFromImage = (img: HTMLImageElement): { splitPosition: number; hasText: boolean } => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return { splitPosition: 500, hasText: false };

    // Resize to 500px width for analysis
    const scale = 500 / img.naturalWidth;
    canvas.width = 500;
    canvas.height = Math.round(img.naturalHeight * scale);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const width = canvas.width;
    const height = canvas.height;

    // Analyze columns in center 35-65% region
    const searchStart = Math.floor(width * 0.35);
    const searchEnd = Math.floor(width * 0.65);
    const darkThreshold = 180;

    let bestScore = -Infinity;
    let bestIdx = Math.floor(width / 2);
    let bestDarkRun = 0;
    let bestTransitions = 0;

    for (let x = searchStart; x < searchEnd; x++) {
      // Get grayscale values for this column
      const pixels: number[] = [];
      for (let y = 0; y < height; y++) {
        const i = (y * width + x) * 4;
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        pixels.push(gray);
      }

      // Sort for P10
      const sorted = [...pixels].sort((a, b) => a - b);
      const p10 = sorted[Math.floor(height * 0.1)];

      // Max dark run
      let maxDarkRun = 0, currentRun = 0;
      for (const p of pixels) {
        if (p < darkThreshold) { currentRun++; maxDarkRun = Math.max(maxDarkRun, currentRun); }
        else { currentRun = 0; }
      }
      const darkRunPercent = (maxDarkRun / height) * 100;

      // Transitions
      let transitions = 0;
      for (let i = 1; i < pixels.length; i++) {
        if ((pixels[i - 1] < darkThreshold) !== (pixels[i] < darkThreshold)) transitions++;
      }

      // Score: low P10 + high dark run + low transitions
      const score = (255 - p10) / 2.55 * 0.3 + darkRunPercent * 0.35 + Math.max(0, 100 - transitions / 5) * 0.2;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = x;
        bestDarkRun = darkRunPercent;
        bestTransitions = transitions;
      }
    }

    const splitPosition = Math.round((bestIdx / width) * 1000);
    const hasText = bestTransitions > 30 && bestDarkRun < 40;

    return { splitPosition, hasText };
  };

  // Auto-detect split position for a page (client-side, instant)
  const autoDetectSplit = (pageId: string) => {
    setDetectingPages(prev => new Set(prev).add(pageId));

    const runDetection = (img: HTMLImageElement) => {
      try {
        const result = detectSplitFromImage(img);
        setSplitPositions(prev => ({ ...prev, [pageId]: result.splitPosition }));
        // Save detected position for learning comparison
        setDetectedPositions(prev => ({ ...prev, [pageId]: result.splitPosition }));
        if (result.hasText) {
          setSplitWarnings(prev => ({ ...prev, [pageId]: 'Text detected at split line' }));
        } else {
          setSplitWarnings(prev => {
            const updated = { ...prev };
            delete updated[pageId];
            return updated;
          });
        }
      } catch (error) {
        console.error('Auto-detect failed:', error);
        setSplitPositions(prev => ({ ...prev, [pageId]: 500 }));
      } finally {
        setDetectingPages(prev => {
          const next = new Set(prev);
          next.delete(pageId);
          return next;
        });
      }
    };

    // Use requestAnimationFrame to allow UI to update
    requestAnimationFrame(() => {
      const img = document.querySelector(`img[data-page-id="${pageId}"]`) as HTMLImageElement;

      if (img && img.complete && img.naturalWidth > 0) {
        runDetection(img);
      } else if (img) {
        // Image not loaded yet, wait for it
        img.onload = () => runDetection(img);
      } else {
        // Image element not found, fallback to 500
        setSplitPositions(prev => ({ ...prev, [pageId]: 500 }));
        setDetectingPages(prev => {
          const next = new Set(prev);
          next.delete(pageId);
          return next;
        });
      }
    });
  };

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

  // Get already-split page pairs (original left pages that have a crop)
  const alreadySplitPages = pages.filter(p => p.crop && !p.split_from);

  // Reset all split pages (batch - much faster)
  const resetAllSplits = async () => {
    if (alreadySplitPages.length === 0) return;

    setResettingAll(true);
    setShowResetConfirm(false);

    try {
      await fetch('/api/pages/batch-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIds: alreadySplitPages.map(p => p.id) })
      });
      await fetchBook();
    } catch (error) {
      console.error('Reset all error:', error);
    } finally {
      setResettingAll(false);
    }
  };

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
        setSplitWarnings(p => {
          const updated = { ...p };
          delete updated[pageId];
          return updated;
        });
      } else {
        next.add(pageId);
        // Auto-detect or use 50%
        if (useAutoDetect) {
          autoDetectSplit(pageId);
        } else {
          setSplitPositions(p => ({ ...p, [pageId]: 500 }));
        }
      }
      return next;
    });
  };

  const selectAll = async () => {
    const allIds = new Set(splittablePages.map(p => p.id));
    setSelectedPages(allIds);
    // Auto-detect or set 50% for all pages that don't have a position yet
    const pagesToSet = splittablePages.filter(p => splitPositions[p.id] === undefined);
    if (useAutoDetect) {
      for (const page of pagesToSet) {
        autoDetectSplit(page.id);
      }
    } else {
      const positions: Record<string, number> = { ...splitPositions };
      pagesToSet.forEach(p => { positions[p.id] = 500; });
      setSplitPositions(positions);
    }
  };

  const clearSelection = () => {
    setSelectedPages(new Set());
    setSplitPositions({});
    setSplitWarnings({});
  };

  const redetectAllPositions = () => {
    // Re-run auto-detection for all selected pages
    selectedPages.forEach(id => {
      autoDetectSplit(id);
    });
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

  // Track detected vs chosen positions for learning
  const [detectedPositions, setDetectedPositions] = useState<Record<string, number>>({});

  const applySplits = async () => {
    const pagesToSplit = Array.from(selectedPages);
    if (pagesToSplit.length === 0) return;

    const originalIds = new Set(pagesToSplit);
    setSplitting(true);
    setShowConfirm(false);

    try {
      const splits = pagesToSplit.map(pageId => ({
        pageId,
        splitPosition: splitPositions[pageId] ?? 500,
        detectedPosition: detectedPositions[pageId],
        wasAdjusted: detectedPositions[pageId] !== undefined &&
                     detectedPositions[pageId] !== splitPositions[pageId]
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
                <p>Click pages to select them — split position is <strong>auto-detected</strong>. Adjust manually if needed.
                Each page becomes two. <strong>Originals are safe</strong> — we create cropped views with 1% overlap.</p>
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
                {detectingPages.size > 0 && (
                  <span className="ml-2 text-blue-600">
                    ({detectingPages.size} detecting...)
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-100 rounded-lg">
                <button
                  onClick={() => setUseAutoDetect(true)}
                  className={`px-3 py-1 text-xs font-medium rounded ${useAutoDetect ? 'bg-blue-600 text-white' : 'text-stone-600 hover:bg-stone-200'}`}
                >
                  Auto-detect
                </button>
                <button
                  onClick={() => setUseAutoDetect(false)}
                  className={`px-3 py-1 text-xs font-medium rounded ${!useAutoDetect ? 'bg-stone-600 text-white' : 'text-stone-600 hover:bg-stone-200'}`}
                >
                  50%
                </button>
              </div>
              <button
                onClick={selectAll}
                className="px-4 py-2 text-sm font-medium bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200"
              >
                Select All ({splittablePages.filter(p => !p.crop).length})
              </button>
              {alreadySplitPages.length > 0 && (
                <button
                  onClick={() => setShowResetConfirm(true)}
                  disabled={resettingAll}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset All ({alreadySplitPages.length})
                </button>
              )}
              {selectedPages.size > 0 && (
                <>
                  <button onClick={clearSelection} className="text-sm text-stone-500 hover:text-stone-700">
                    Clear
                  </button>
                  <button
                    onClick={redetectAllPositions}
                    disabled={detectingPages.size > 0}
                    className="flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700 disabled:opacity-50"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Re-detect All
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
                    data-page-id={page.id}
                    crossOrigin="anonymous"
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
                    detectingPages.has(page.id) ? (
                      <span className="flex items-center gap-1 text-xs text-blue-600">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Detecting...
                      </span>
                    ) : (
                      <span className={`text-xs font-medium ${splitWarnings[page.id] ? 'text-orange-600' : 'text-green-600'}`}>
                        {((splitPositions[page.id] ?? 500) / 10).toFixed(1)}%
                        {splitWarnings[page.id] ? ' ⚠️' : ' ✓'}
                      </span>
                    )
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2">
          {Object.keys(splitWarnings).length > 0 && (
            <div className="px-3 py-1 bg-orange-100 text-orange-800 text-xs rounded-full">
              ⚠️ {Object.keys(splitWarnings).length} page{Object.keys(splitWarnings).length !== 1 ? 's' : ''} may have text at split line
            </div>
          )}
          <button
            onClick={() => setShowConfirm(true)}
            disabled={splitting || detectingPages.size > 0}
            className="flex items-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-full shadow-lg hover:bg-amber-700 disabled:opacity-50 text-sm font-medium"
          >
            {splitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : detectingPages.size > 0 ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Scissors className="w-5 h-5" />
            )}
            {detectingPages.size > 0
              ? `Detecting ${detectingPages.size}...`
              : `Split ${selectedPages.size} Page${selectedPages.size !== 1 ? 's' : ''}`
            }
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

      {/* Reset Confirmation Dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-stone-900 mb-2">Confirm Reset</h3>
            <p className="text-sm text-stone-600 mb-4">
              You&apos;re about to reset <strong>{alreadySplitPages.length} split page{alreadySplitPages.length !== 1 ? 's' : ''}</strong> back to their original state.
            </p>
            <p className="text-sm text-stone-500 mb-6">
              This will merge each pair back into a single two-page spread. You can split them again if needed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 text-sm text-stone-600 hover:text-stone-900"
              >
                Cancel
              </button>
              <button
                onClick={resetAllSplits}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
              >
                <RotateCcw className="w-4 h-4" />
                Reset All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resetting Progress */}
      {resettingAll && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-8 text-center">
            <Loader2 className="w-12 h-12 animate-spin text-amber-600 mx-auto mb-4" />
            <p className="text-lg font-medium text-stone-900">Resetting pages...</p>
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
