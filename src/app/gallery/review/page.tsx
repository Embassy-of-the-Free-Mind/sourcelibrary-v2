'use client';

import { useState, useEffect, useCallback } from 'react';
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
  Loader2
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
  const limit = 10;

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

        {/* Pages with detections */}
        {!loading && data && (
          <div className="space-y-8">
            {data.pages.map(pageData => (
              <PageReviewCard
                key={pageData.pageId}
                page={pageData}
                onUpdateStatus={updateStatus}
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
  saving
}: {
  page: PageWithDetections;
  onUpdateStatus: (pageId: string, index: number, status: 'approved' | 'rejected' | 'pending') => void;
  saving: string | null;
}) {
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-stone-50 border-b border-stone-200">
        <div className="flex items-center justify-between">
          <div>
            <Link
              href={`/book/${page.bookId}/read?page=${page.pageNumber}`}
              className="font-medium text-stone-900 hover:text-amber-700"
            >
              {page.bookTitle}
            </Link>
            <span className="text-stone-500 ml-2">p. {page.pageNumber}</span>
          </div>
          <span className="text-sm text-stone-500">
            {page.detections.length} detection{page.detections.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Image with bounding boxes */}
      <div className="relative bg-stone-200">
        <div className="relative w-full" style={{ maxHeight: '600px' }}>
          <Image
            src={page.imageUrl}
            alt={`Page ${page.pageNumber}`}
            width={800}
            height={1200}
            className="w-full h-auto object-contain"
            onLoad={(e) => {
              const img = e.target as HTMLImageElement;
              setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
            }}
            unoptimized
          />

          {/* Bounding box overlays */}
          {imageDimensions && page.detections.map((det, idx) => {
            if (!det.bbox) return null;

            const status = det.status || 'pending';
            const isPixels = det.bbox.x > 1 || det.bbox.y > 1 || det.bbox.width > 1 || det.bbox.height > 1;

            // Normalize if pixels
            const bbox = isPixels ? {
              x: det.bbox.x / imageDimensions.width,
              y: det.bbox.y / imageDimensions.height,
              width: det.bbox.width / imageDimensions.width,
              height: det.bbox.height / imageDimensions.height
            } : det.bbox;

            const borderColor = status === 'approved'
              ? 'border-green-500'
              : status === 'rejected'
                ? 'border-red-500'
                : 'border-amber-500';

            const bgColor = status === 'approved'
              ? 'bg-green-500/20'
              : status === 'rejected'
                ? 'bg-red-500/20'
                : 'bg-amber-500/20';

            return (
              <div
                key={idx}
                className={`absolute border-2 ${borderColor} ${bgColor} cursor-pointer transition-all hover:border-4`}
                style={{
                  left: `${bbox.x * 100}%`,
                  top: `${bbox.y * 100}%`,
                  width: `${bbox.width * 100}%`,
                  height: `${bbox.height * 100}%`
                }}
                title={`${det.description} (${det.type || 'unknown'})`}
              >
                {/* Label */}
                <div className="absolute -top-6 left-0 px-2 py-0.5 bg-stone-900 text-white text-xs rounded whitespace-nowrap">
                  {idx + 1}. {det.type || 'unknown'}
                  {det.confidence && ` (${Math.round(det.confidence * 100)}%)`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detection list with actions */}
      <div className="p-4 space-y-2">
        {page.detections.map((det, idx) => {
          const status = det.status || 'pending';
          const isSaving = saving === `${page.pageId}-${idx}`;

          return (
            <div
              key={idx}
              className={`flex items-center justify-between p-3 rounded-lg ${
                status === 'approved' ? 'bg-green-50' :
                status === 'rejected' ? 'bg-red-50' : 'bg-stone-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-stone-200 flex items-center justify-center text-sm font-medium">
                  {idx + 1}
                </span>
                <div>
                  <span className="font-medium">{det.description}</span>
                  <span className="text-stone-500 text-sm ml-2">
                    {det.type}
                    {det.model && ` via ${det.model}`}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isSaving ? (
                  <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
                ) : (
                  <>
                    <button
                      onClick={() => onUpdateStatus(page.pageId, idx, 'approved')}
                      className={`p-2 rounded-lg transition-colors ${
                        status === 'approved'
                          ? 'bg-green-600 text-white'
                          : 'bg-stone-200 text-stone-600 hover:bg-green-100 hover:text-green-700'
                      }`}
                      title="Approve"
                    >
                      <CheckCircle className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => onUpdateStatus(page.pageId, idx, 'rejected')}
                      className={`p-2 rounded-lg transition-colors ${
                        status === 'rejected'
                          ? 'bg-red-600 text-white'
                          : 'bg-stone-200 text-stone-600 hover:bg-red-100 hover:text-red-700'
                      }`}
                      title="Reject"
                    >
                      <XCircle className="w-5 h-5" />
                    </button>
                    {status !== 'pending' && (
                      <button
                        onClick={() => onUpdateStatus(page.pageId, idx, 'pending')}
                        className="p-2 rounded-lg bg-stone-200 text-stone-600 hover:bg-amber-100 hover:text-amber-700 transition-colors"
                        title="Reset to pending"
                      >
                        <Clock className="w-5 h-5" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
