'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Image as ImageIcon, BookOpen, ExternalLink, Filter, ChevronLeft, ChevronRight, CheckCircle, AlertCircle, Trash2, Square, CheckSquare, X } from 'lucide-react';

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
  detectionIndex: number;
  imageUrl: string;
  bookTitle: string;
  author?: string;
  year?: number;
  description: string;
  type?: string;
  bbox?: BBox;
  confidence?: number;
  model?: 'gemini' | 'mistral' | 'grounding-dino';
  detectionSource?: string;
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const limit = 24;

  // Generate unique key for an item
  const getItemKey = (item: GalleryItem, idx: number) => `${item.pageId}-${item.description}-${idx}`;

  // Toggle selection
  const toggleSelect = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Select all on current page
  const selectAll = () => {
    if (!data) return;
    const allKeys = data.items.map((item, idx) => getItemKey(item, idx));
    setSelected(new Set(allKeys));
  };

  // Clear selection
  const clearSelection = () => setSelected(new Set());

  // Delete selected items
  const deleteSelected = async () => {
    if (selected.size === 0 || !data) return;
    if (!confirm(`Delete ${selected.size} selected image${selected.size > 1 ? 's' : ''}?`)) return;

    setDeleting(true);
    const errors: string[] = [];
    const deletedKeys = new Set<string>();

    for (const key of selected) {
      const idx = data.items.findIndex((item, i) => getItemKey(item, i) === key);
      if (idx === -1) continue;

      const item = data.items[idx];
      try {
        const params = new URLSearchParams({ description: item.description });
        const res = await fetch(`/api/detections/${item.pageId}?${params}`, { method: 'DELETE' });
        if (res.ok) {
          deletedKeys.add(key);
        } else {
          const err = await res.json();
          errors.push(err.error || 'Unknown error');
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Unknown error');
      }
    }

    // Update local state
    const newItems = data.items.filter((item, idx) => !deletedKeys.has(getItemKey(item, idx)));
    setData({ ...data, items: newItems, total: data.total - deletedKeys.size });
    setSelected(new Set());
    setDeleting(false);

    if (errors.length > 0) {
      alert(`Deleted ${deletedKeys.size} items. ${errors.length} failed.`);
    }
  };

  // Clear selection when page/filters change
  useEffect(() => {
    clearSelection();
  }, [page, selectedBook, verifiedOnly, selectedModel]);

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

        {/* Selection toolbar */}
        {data && data.items.length > 0 && (
          <div className="flex items-center gap-4 mb-4 p-3 bg-white rounded-lg shadow-sm">
            <button
              onClick={selected.size === data.items.length ? clearSelection : selectAll}
              className="flex items-center gap-2 text-sm text-stone-600 hover:text-stone-900"
            >
              {selected.size === data.items.length ? (
                <>
                  <CheckSquare className="w-4 h-4" />
                  Deselect all
                </>
              ) : (
                <>
                  <Square className="w-4 h-4" />
                  Select all
                </>
              )}
            </button>

            {selected.size > 0 && (
              <>
                <span className="text-sm text-stone-500">
                  {selected.size} selected
                </span>
                <button
                  onClick={deleteSelected}
                  disabled={deleting}
                  className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  {deleting ? 'Deleting...' : `Delete ${selected.size}`}
                </button>
                <button
                  onClick={clearSelection}
                  className="text-stone-400 hover:text-stone-600"
                  title="Clear selection"
                >
                  <X className="w-4 h-4" />
                </button>
              </>
            )}

            <span className="ml-auto text-sm text-stone-500">
              {data.total} illustration{data.total !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Stats - only show when no items */}
        {data && data.items.length === 0 && (
          <div className="flex items-center gap-4 text-sm mb-4">
            <span className="text-stone-500">No illustrations found</span>
            {verifiedOnly && (
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
            {data.items.map((item, idx) => {
              const key = getItemKey(item, idx);
              return (
                <GalleryCard
                  key={key}
                  item={item}
                  isSelected={selected.has(key)}
                  onToggleSelect={() => toggleSelect(key)}
                  onDelete={() => handleDelete(item, idx)}
                />
              );
            })}
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

function GalleryCard({ item, isSelected, onToggleSelect, onDelete }: {
  item: GalleryItem;
  isSelected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
}) {
  const [imageError, setImageError] = useState(false);

  // Use cropped image if bbox available, otherwise full page
  const displayUrl = item.bbox
    ? getCroppedImageUrl(item.imageUrl, item.bbox)
    : item.imageUrl;

  return (
    <div className={`bg-white rounded-lg shadow-sm overflow-hidden hover:shadow-md transition-shadow group ${isSelected ? 'ring-2 ring-amber-500' : ''}`}>
      {/* Image - links to detail view */}
      <Link href={`/gallery/image/${item.pageId}:${item.detectionIndex}`}>
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

          {/* Checkbox for selection */}
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleSelect();
            }}
            className={`absolute top-2 left-2 z-10 p-1 rounded transition-opacity ${
              isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            title={isSelected ? 'Deselect' : 'Select'}
          >
            {isSelected ? (
              <CheckSquare className="w-5 h-5 text-amber-500" />
            ) : (
              <Square className="w-5 h-5 text-white drop-shadow-lg" />
            )}
          </button>

          {/* Delete button */}
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
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
            <span className={`absolute bottom-2 left-2 px-2 py-0.5 rounded-full text-xs text-white ${
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
            href={`/book/${item.bookId}/page/${item.pageId}`}
            className="shrink-0 text-xs text-stone-500 hover:text-amber-700"
          >
            p. {item.pageNumber}
          </Link>
        </div>
      </div>
    </div>
  );
}
