'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  CheckCircle,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Filter,
  Loader2,
  Eye,
  EyeOff,
  PenTool,
  Trash2
} from 'lucide-react';

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Detection {
  id?: string;
  description: string;
  type?: string;
  bbox?: BBox;
  confidence?: number;
  model?: string;
  status?: 'pending' | 'approved' | 'rejected';
  detection_source?: 'ocr_tag' | 'vision_model' | 'manual';
}

interface PageWithDetections {
  pageId: string;
  bookId: string;
  pageNumber: number;
  imageUrl: string;
  bookTitle: string;
  author?: string;
  detections: Detection[];
}

interface ReviewResponse {
  pages: PageWithDetections[];
  total: number;
  limit: number;
  offset: number;
  books: Array<{ id: string; title: string }>;
  counts: { pending: number; approved: number; rejected: number };
}

export default function DetectionReviewPage() {
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [selectedBook, setSelectedBook] = useState('');
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const limit = 20;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        limit: limit.toString(),
        offset: (page * limit).toString()
      });
      if (selectedBook) params.set('bookId', selectedBook);

      const res = await fetch(`/api/detections?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error('Fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, selectedBook, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateStatus = async (pageId: string, detectionIndex: number, status: 'approved' | 'rejected' | 'pending') => {
    setSaving(`${pageId}-${detectionIndex}`);
    try {
      const res = await fetch('/api/detections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, detectionIndex, status })
      });
      if (!res.ok) throw new Error('Failed to update');

      // Update local state
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          pages: prev.pages.map(p => {
            if (p.pageId !== pageId) return p;
            return {
              ...p,
              detections: p.detections.map((d, i) =>
                i === detectionIndex ? { ...d, status } : d
              )
            };
          })
        };
      });
    } catch (e) {
      console.error('Update error:', e);
    } finally {
      setSaving(null);
    }
  };

  const addManualDetection = async (pageId: string, bbox: BBox, description: string) => {
    try {
      const res = await fetch('/api/detections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, bbox, description })
      });
      if (!res.ok) throw new Error('Failed to add');
      const json = await res.json();

      // Update local state
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          pages: prev.pages.map(p => {
            if (p.pageId !== pageId) return p;
            return {
              ...p,
              detections: [...p.detections, json.detection]
            };
          })
        };
      });
    } catch (e) {
      console.error('Add error:', e);
    }
  };

  const deleteDetection = async (pageId: string, detectionIndex: number) => {
    try {
      const res = await fetch('/api/detections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, detectionIndex })
      });
      if (!res.ok) throw new Error('Failed to delete');

      // Update local state
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          pages: prev.pages.map(p => {
            if (p.pageId !== pageId) return p;
            return {
              ...p,
              detections: p.detections.filter((_, i) => i !== detectionIndex)
            };
          })
        };
      });
    } catch (e) {
      console.error('Delete error:', e);
    }
  };

  const markReviewed = async (pageId: string, approved: boolean) => {
    try {
      const res = await fetch('/api/detections/mark-reviewed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, skipped: !approved })
      });
      if (!res.ok) throw new Error('Failed to mark reviewed');

      // Remove page from local state and update counts
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          pages: prev.pages.filter(p => p.pageId !== pageId),
          total: prev.total - 1,
          counts: {
            ...prev.counts,
            pending: prev.counts.pending - 1,
            approved: approved ? prev.counts.approved + 1 : prev.counts.approved,
            rejected: !approved ? prev.counts.rejected + 1 : prev.counts.rejected
          }
        };
      });

      // If we're running low on pages, fetch more
      setData(prev => {
        if (!prev) return prev;
        if (prev.pages.length <= 3 && prev.total > prev.pages.length) {
          // Trigger a refetch to get more pages
          setTimeout(() => fetchMorePages(), 100);
        }
        return prev;
      });
    } catch (e) {
      console.error('Mark reviewed error:', e);
    }
  };

  const fetchMorePages = async () => {
    if (statusFilter !== 'pending') return; // Only auto-fetch for pending
    try {
      const params = new URLSearchParams({
        status: 'pending',
        limit: limit.toString(),
        offset: '0' // Always get fresh pages from the start
      });
      if (selectedBook) params.set('bookId', selectedBook);

      const res = await fetch(`/api/detections?${params}`);
      if (!res.ok) return;
      const json = await res.json();

      // Merge new pages, avoiding duplicates
      setData(prev => {
        if (!prev) return json;
        const existingIds = new Set(prev.pages.map(p => p.pageId));
        const newPages = json.pages.filter((p: PageWithDetections) => !existingIds.has(p.pageId));
        return {
          ...prev,
          pages: [...prev.pages, ...newPages].slice(0, limit),
          total: json.total,
          counts: json.counts
        };
      });
    } catch (e) {
      console.error('Fetch more error:', e);
    }
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div className="min-h-screen bg-stone-100">
      {/* Header */}
      <header className="bg-stone-900 text-white py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-serif">Detection Review</h1>
              <p className="text-stone-400 text-sm">
                Approve or reject detected illustrations
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Link
                href="/gallery"
                className="text-stone-400 hover:text-white transition-colors flex items-center gap-2"
              >
                <BookOpen className="w-4 h-4" />
                Gallery
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Status counts */}
        {data && (
          <div className="flex items-center gap-4 mb-6">
            <button
              onClick={() => { setStatusFilter('pending'); setPage(0); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                statusFilter === 'pending'
                  ? 'bg-amber-600 text-white'
                  : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
              }`}
            >
              <Clock className="w-4 h-4" />
              Pending ({data.counts.pending})
            </button>
            <button
              onClick={() => { setStatusFilter('approved'); setPage(0); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                statusFilter === 'approved'
                  ? 'bg-green-600 text-white'
                  : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
              }`}
            >
              <CheckCircle className="w-4 h-4" />
              Approved ({data.counts.approved})
            </button>
            <button
              onClick={() => { setStatusFilter('rejected'); setPage(0); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                statusFilter === 'rejected'
                  ? 'bg-red-600 text-white'
                  : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
              }`}
            >
              <XCircle className="w-4 h-4" />
              Rejected ({data.counts.rejected})
            </button>
          </div>
        )}

        {/* Book filter */}
        <div className="mb-6">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 text-stone-600 hover:text-stone-900 transition-colors"
          >
            <Filter className="w-4 h-4" />
            Filter by book
          </button>

          {showFilters && data?.books && (
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                onClick={() => { setSelectedBook(''); setPage(0); }}
                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                  !selectedBook
                    ? 'bg-amber-600 text-white'
                    : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                }`}
              >
                All books
              </button>
              {data.books.map(book => (
                <button
                  key={book.id}
                  onClick={() => { setSelectedBook(book.id); setPage(0); }}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    selectedBook === book.id
                      ? 'bg-amber-600 text-white'
                      : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                  }`}
                >
                  {book.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
          </div>
        )}

        {/* Pages with detections - Grid layout */}
        {!loading && data && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {data.pages.map(pageData => (
              <PageReviewCard
                key={pageData.pageId}
                page={pageData}
                onUpdateStatus={updateStatus}
                onAddManualDetection={addManualDetection}
                onDeleteDetection={deleteDetection}
                onMarkReviewed={markReviewed}
                saving={saving}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && data?.pages.length === 0 && (
          <div className="text-center py-20 text-stone-500">
            No {statusFilter === 'all' ? '' : statusFilter} detections found
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-8">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center gap-1 px-4 py-2 rounded-lg bg-stone-200 text-stone-700 hover:bg-stone-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
            <span className="text-stone-600">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="flex items-center gap-1 px-4 py-2 rounded-lg bg-stone-200 text-stone-700 hover:bg-stone-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PageReviewCard({
  page,
  onUpdateStatus,
  onAddManualDetection,
  onDeleteDetection,
  onMarkReviewed,
  saving
}: {
  page: PageWithDetections;
  onUpdateStatus: (pageId: string, index: number, status: 'approved' | 'rejected' | 'pending') => void;
  onAddManualDetection: (pageId: string, bbox: BBox, description: string) => Promise<void>;
  onDeleteDetection: (pageId: string, index: number) => Promise<void>;
  onMarkReviewed: (pageId: string, approved: boolean) => Promise<void>;
  saving: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showAutoBoxes, setShowAutoBoxes] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<BBox | null>(null);
  const [drawnBoxes, setDrawnBoxes] = useState<Array<{ bbox: BBox; description: string }>>([]);
  const [reviewSaving, setReviewSaving] = useState(false);

  const getRelativeCoords = (e: React.MouseEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left click only
    const coords = getRelativeCoords(e);
    setDrawStart(coords);
    setIsDrawing(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !drawStart) return;
    const coords = getRelativeCoords(e);
    setCurrentBox({
      x: Math.min(drawStart.x, coords.x),
      y: Math.min(drawStart.y, coords.y),
      width: Math.abs(coords.x - drawStart.x),
      height: Math.abs(coords.y - drawStart.y)
    });
  };

  const handleMouseUp = () => {
    if (isDrawing && currentBox && currentBox.width > 0.02 && currentBox.height > 0.02) {
      // Add to drawn boxes immediately
      setDrawnBoxes(prev => [...prev, { bbox: currentBox, description: 'illustration' }]);
    }
    setCurrentBox(null);
    setIsDrawing(false);
    setDrawStart(null);
  };

  const removeDrawnBox = (index: number) => {
    setDrawnBoxes(prev => prev.filter((_, i) => i !== index));
  };

  const handleApprove = async () => {
    setReviewSaving(true);
    // Save all drawn boxes first
    for (const box of drawnBoxes) {
      await onAddManualDetection(page.pageId, box.bbox, box.description);
    }
    // Then mark as reviewed
    await onMarkReviewed(page.pageId, true);
    setReviewSaving(false);
  };

  // Filter detections for display
  const manualDetections = page.detections.filter(d => d.detection_source === 'manual');
  const autoDetections = page.detections.filter(d => d.detection_source !== 'manual');

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      {/* Compact Header */}
      <div className="px-2 py-1.5 bg-stone-50 border-b border-stone-200">
        <div className="flex items-center justify-between text-xs">
          <Link
            href={`/book/${page.bookId}/guide?page=${page.pageNumber}`}
            className="font-medium text-stone-700 hover:text-amber-700 truncate max-w-[70%]"
            title={page.bookTitle}
          >
            {page.bookTitle}
          </Link>
          <span className="text-stone-400">p.{page.pageNumber}</span>
        </div>
      </div>

      {/* Full page image with drawing */}
      <div
        ref={containerRef}
        className="relative bg-stone-800 cursor-crosshair select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { if (isDrawing) handleMouseUp(); }}
      >
        <Image
          src={page.imageUrl}
          alt={`Page ${page.pageNumber}`}
          width={600}
          height={900}
          className="w-full h-auto"
          draggable={false}
          unoptimized
        />

        {/* Auto-detected boxes (toggleable) */}
        {showAutoBoxes && autoDetections.map((det, idx) => {
          if (!det.bbox) return null;
          const actualIdx = page.detections.indexOf(det);
          const status = det.status || 'pending';

          // Handle both pixel and normalized coords
          const isPixels = det.bbox.x > 1 || det.bbox.width > 1;
          const bbox = isPixels ? {
            x: det.bbox.x / 2555, // Approximate - will be slightly off
            y: det.bbox.y / 3906,
            width: det.bbox.width / 2555,
            height: det.bbox.height / 3906
          } : det.bbox;

          return (
            <div
              key={`auto-${idx}`}
              className={`absolute border-2 border-dashed pointer-events-none ${
                status === 'approved' ? 'border-green-500 bg-green-500/10' :
                status === 'rejected' ? 'border-red-500 bg-red-500/10' :
                'border-amber-500 bg-amber-500/10'
              }`}
              style={{
                left: `${bbox.x * 100}%`,
                top: `${bbox.y * 100}%`,
                width: `${bbox.width * 100}%`,
                height: `${bbox.height * 100}%`
              }}
            >
              <span className="absolute -top-5 left-0 px-1 bg-amber-500 text-white text-xs rounded">
                {det.type}
              </span>
            </div>
          );
        })}

        {/* Manual detections (already saved) */}
        {manualDetections.map((det, idx) => {
          if (!det.bbox) return null;
          const actualIdx = page.detections.indexOf(det);

          return (
            <div
              key={`manual-${idx}`}
              className="absolute border-2 border-green-500 bg-green-500/20"
              style={{
                left: `${det.bbox.x * 100}%`,
                top: `${det.bbox.y * 100}%`,
                width: `${det.bbox.width * 100}%`,
                height: `${det.bbox.height * 100}%`
              }}
            >
              <span className="absolute -top-5 left-0 px-1 bg-green-600 text-white text-xs rounded">
                {det.description}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteDetection(page.pageId, actualIdx); }}
                className="absolute -top-5 right-0 p-0.5 bg-red-600 text-white rounded hover:bg-red-700"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        {/* Drawn boxes (not yet saved - will save on Approve) */}
        {drawnBoxes.map((box, idx) => (
          <div
            key={`drawn-${idx}`}
            className="absolute border-2 border-blue-500 bg-blue-500/20"
            style={{
              left: `${box.bbox.x * 100}%`,
              top: `${box.bbox.y * 100}%`,
              width: `${box.bbox.width * 100}%`,
              height: `${box.bbox.height * 100}%`
            }}
          >
            <span className="absolute -top-5 left-0 px-1 bg-blue-600 text-white text-xs rounded">
              {idx + 1}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); removeDrawnBox(idx); }}
              className="absolute -top-5 right-0 p-0.5 bg-red-600 text-white rounded hover:bg-red-700"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* Currently drawing box */}
        {currentBox && (
          <div
            className="absolute border-2 border-blue-500 bg-blue-500/30 pointer-events-none"
            style={{
              left: `${currentBox.x * 100}%`,
              top: `${currentBox.y * 100}%`,
              width: `${currentBox.width * 100}%`,
              height: `${currentBox.height * 100}%`
            }}
          />
        )}
      </div>

      {/* Approve/Reject buttons */}
      <div className="p-2 border-t border-stone-200 flex items-center justify-center gap-2">
        <button
          onClick={async () => {
            setReviewSaving(true);
            await onMarkReviewed(page.pageId, false);
            setReviewSaving(false);
          }}
          disabled={reviewSaving}
          className="flex items-center gap-1 px-3 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50 transition-colors text-sm"
        >
          <XCircle className="w-4 h-4" />
          Reject
        </button>
        <button
          onClick={handleApprove}
          disabled={reviewSaving}
          className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors text-sm"
        >
          {reviewSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle className="w-4 h-4" />
          )}
          Approve{drawnBoxes.length > 0 ? ` (${drawnBoxes.length})` : ''}
        </button>
      </div>

    </div>
  );
}
