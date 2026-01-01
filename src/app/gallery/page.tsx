'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Image as ImageIcon, BookOpen, ExternalLink, Filter, ChevronLeft, ChevronRight, CheckCircle, AlertCircle, Trash2 } from 'lucide-react';

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GalleryItem {
  pageId: string;
  bookId: string;
  pageNumber: number;
  imageUrl: string;
  bookTitle: string;
  author?: string;
  year?: number;
  description: string;
  type?: string;
  bbox?: BBox;
  confidence?: number;
  model?: 'gemini' | 'mistral' | 'grounding-dino';
  detectionIndex?: number;
}

interface GalleryResponse {
  items: GalleryItem[];
  total: number;
  limit: number;
  offset: number;
  books: Array<{ id: string; title: string }>;
  imageTypes: string[];
  verified: boolean;
}

function getCroppedImageUrl(imageUrl: string, bbox: BBox): string {
  const params = new URLSearchParams({
    url: imageUrl,
    x: bbox.x.toString(),
    y: bbox.y.toString(),
    w: bbox.width.toString(),
    h: bbox.height.toString()
  });
  return `/api/crop-image?${params}`;
}

export default function GalleryPage() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<GalleryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBook, setSelectedBook] = useState<string>(searchParams.get('bookId') || '');
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [selectedModel, setSelectedModel] = useState<'gemini' | 'mistral' | 'grounding-dino' | ''>('');
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const limit = 24;

  // Sync with URL params
  useEffect(() => {
    const bookId = searchParams.get('bookId');
    if (bookId && bookId !== selectedBook) {
      setSelectedBook(bookId);
    }
  }, [searchParams]);

  useEffect(() => {
    fetchGallery();
  }, [selectedBook, verifiedOnly, selectedModel, page]);

  const fetchGallery = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: (page * limit).toString()
      });
      if (selectedBook) params.set('bookId', selectedBook);
      if (verifiedOnly) params.set('verified', 'true');
      if (selectedModel) params.set('model', selectedModel);

      const res = await fetch(`/api/gallery?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load gallery');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (item: GalleryItem, displayIndex: number) => {
    if (!confirm('Delete this image from the gallery?')) return;

    try {
      const params = new URLSearchParams({
        description: item.description
      });
      const res = await fetch(`/api/detections/${item.pageId}?${params}`, {
        method: 'DELETE'
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete');
      }

      // Remove from local state
      if (data) {
        const newItems = [...data.items];
        newItems.splice(displayIndex, 1);
        setData({ ...data, items: newItems, total: data.total - 1 });
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div className="min-h-screen bg-stone-100">
      {/* Header */}
      <header className="bg-stone-900 text-white py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ImageIcon className="w-8 h-8 text-amber-500" />
              <div>
                <h1 className="text-2xl font-serif">Image Gallery</h1>
                <p className="text-stone-400 text-sm">
                  Illustrations from historical texts
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Link
                href="/gallery/review"
                className="text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-2"
              >
                Review Detections
              </Link>
              <Link
                href="/"
                className="text-stone-400 hover:text-white transition-colors flex items-center gap-2"
              >
                <BookOpen className="w-4 h-4" />
                Back to Library
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Filters */}
        <div className="mb-6 space-y-4">
          {/* Verified toggle */}
          <div className="flex items-center gap-4 flex-wrap">
            <button
              onClick={() => { setVerifiedOnly(true); setPage(0); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                verifiedOnly
                  ? 'bg-green-600 text-white'
                  : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
              }`}
            >
              <CheckCircle className="w-4 h-4" />
              Verified only
            </button>
            <button
              onClick={() => { setVerifiedOnly(false); setPage(0); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                !verifiedOnly
                  ? 'bg-amber-600 text-white'
                  : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
              }`}
            >
              <AlertCircle className="w-4 h-4" />
              All (including unverified)
            </button>
          </div>

          {/* Model filter */}
          {verifiedOnly && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-stone-500">Model:</span>
              <button
                onClick={() => { setSelectedModel(''); setPage(0); }}
                className={`px-3 py-1 rounded-full text-sm transition-colors ${
                  !selectedModel
                    ? 'bg-stone-700 text-white'
                    : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                }`}
              >
                All
              </button>
              <button
                onClick={() => { setSelectedModel('gemini'); setPage(0); }}
                className={`px-3 py-1 rounded-full text-sm transition-colors ${
                  selectedModel === 'gemini'
                    ? 'bg-blue-600 text-white'
                    : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                }`}
              >
                Gemini
              </button>
              <button
                onClick={() => { setSelectedModel('mistral'); setPage(0); }}
                className={`px-3 py-1 rounded-full text-sm transition-colors ${
                  selectedModel === 'mistral'
                    ? 'bg-orange-600 text-white'
                    : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                }`}
              >
                Mistral
              </button>
              <button
                onClick={() => { setSelectedModel('grounding-dino'); setPage(0); }}
                className={`px-3 py-1 rounded-full text-sm transition-colors ${
                  selectedModel === 'grounding-dino'
                    ? 'bg-green-600 text-white'
                    : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                }`}
              >
                Grounding DINO
              </button>
            </div>
          )}

          {/* Book filter */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 text-stone-600 hover:text-stone-900 transition-colors"
          >
            <Filter className="w-4 h-4" />
            Filter by book
          </button>

          {showFilters && data?.books && (
            <div className="flex flex-wrap gap-2">
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

        {/* Stats */}
        {data && (
          <div className="flex items-center gap-4 text-sm mb-4">
            <span className="text-stone-500">
              {data.total === 0
                ? 'No illustrations found'
                : `${data.total} illustration${data.total !== 1 ? 's' : ''}`}
            </span>
            {verifiedOnly && data.total === 0 && (
              <span className="text-amber-600">
                Run image extraction to populate the gallery
              </span>
            )}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600" />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="text-center py-20 text-red-600">
            {error}
          </div>
        )}

        {/* Gallery Grid */}
        {!loading && data && data.items.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {data.items.map((item, idx) => (
              <GalleryCard
                key={`${item.bookId}-${item.pageNumber}-${idx}`}
                item={item}
                onDelete={() => handleDelete(item, idx)}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && data?.items.length === 0 && (
          <div className="text-center py-20">
            <ImageIcon className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <p className="text-stone-500 mb-2">No verified illustrations yet</p>
            {verifiedOnly && (
              <p className="text-stone-400 text-sm">
                Add MISTRAL_API_KEY to Vercel and run extraction via
                <code className="mx-1 px-2 py-0.5 bg-stone-200 rounded">/api/extract-images</code>
              </p>
            )}
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

function GalleryCard({ item, onDelete }: { item: GalleryItem; onDelete: () => void }) {
  const [imageError, setImageError] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Use cropped image if bbox available, otherwise full page
  const displayUrl = item.bbox
    ? getCroppedImageUrl(item.imageUrl, item.bbox)
    : item.imageUrl;

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden hover:shadow-md transition-shadow group">
      {/* Image */}
      <Link href={`/book/${item.bookId}/read?page=${item.pageNumber}`}>
        <div className="relative aspect-square bg-stone-200">
          {!imageError ? (
            <Image
              src={displayUrl}
              alt={item.description}
              fill
              className="object-contain group-hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
              onError={() => setImageError(true)}
              unoptimized={!!item.bbox} // Skip Next.js optimization for cropped images
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-stone-400">
              <ImageIcon className="w-12 h-12" />
            </div>
          )}

          {/* Delete button */}
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
            disabled={deleting}
            className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-red-600/80 hover:bg-red-600 text-white opacity-0 group-hover:opacity-100 transition-opacity"
            title="Delete from gallery"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {/* Overlay on hover */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none">
            <ExternalLink className="w-8 h-8 text-white drop-shadow-lg" />
          </div>

          {/* Type badge */}
          {item.type && (
            <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full text-xs bg-black/60 text-white capitalize">
              {item.type}
            </span>
          )}

          {/* Model badge */}
          {item.model && (
            <span className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs text-white ${
              item.model === 'gemini' ? 'bg-blue-600/80' :
              item.model === 'grounding-dino' ? 'bg-green-600/80' : 'bg-orange-600/80'
            }`}>
              {item.model === 'grounding-dino' ? 'DINO' : item.model}
            </span>
          )}
        </div>
      </Link>

      {/* Metadata */}
      <div className="p-3">
        <p className="text-sm text-stone-800 line-clamp-2 mb-2" title={item.description}>
          {item.description}
        </p>

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              href={`/book/${item.bookId}`}
              className="text-xs text-amber-700 hover:text-amber-800 font-medium line-clamp-1"
              title={item.bookTitle}
            >
              {item.bookTitle}
            </Link>
            {item.author && (
              <p className="text-xs text-stone-500 line-clamp-1">
                {item.author}
                {item.year && ` (${item.year})`}
              </p>
            )}
          </div>
          <Link
            href={`/book/${item.bookId}/read?page=${item.pageNumber}`}
            className="shrink-0 text-xs text-stone-500 hover:text-amber-700"
          >
            p. {item.pageNumber}
          </Link>
        </div>
      </div>
    </div>
  );
}
