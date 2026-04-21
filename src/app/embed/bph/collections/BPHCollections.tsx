'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

interface Collection {
  slug: string;
  name: string;
  description: string | null;
  subtitle: string | null;
  item_count: number;
}

interface Book {
  id: string;
  slug: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published: string;
  year: number;
  pages_count: number;
  pages_translated: number;
  thumbnail: string | null;
  url: string;
}

interface CollectionDetail extends Collection {
  books: Book[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 24;

export default function BPHCollections() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const areaSlug = searchParams.get('area');

  const [collections, setCollections] = useState<Collection[]>([]);
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const fetchCollections = useCallback(async () => {
    setLoading(true);
    try {
      if (areaSlug) {
        const params = new URLSearchParams({
          slug: areaSlug,
          limit: String(PAGE_SIZE),
          offset: String((page - 1) * PAGE_SIZE),
        });
        const res = await fetch(`/api/embed/bph/collections?${params}`);
        const json = await res.json();
        setDetail(json.collection);
      } else {
        const res = await fetch('/api/embed/bph/collections');
        const json = await res.json();
        setCollections(json.collections || []);
      }
    } catch (err) {
      console.error('Failed to fetch collections:', err);
    } finally {
      setLoading(false);
    }
  }, [areaSlug, page]);

  useEffect(() => { fetchCollections(); }, [fetchCollections]);

  // Notify parent
  useEffect(() => {
    if (typeof window === 'undefined' || window.self === window.top) return;
    window.parent.postMessage({
      type: 'sl-navigate',
      path: areaSlug ? `/collections/${areaSlug}` : '/collections',
    }, '*');
  }, [areaSlug]);

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="h-8 w-48 bg-stone-200 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-32 bg-stone-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Single collection detail view
  if (areaSlug && detail) {
    const totalPages = Math.ceil(detail.total / PAGE_SIZE);
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <button
          onClick={() => router.push('/embed/bph/collections')}
          className="text-sm text-stone-500 hover:text-stone-700 mb-4 flex items-center gap-1"
        >
          ← All collection areas
        </button>

        <h1 className="text-2xl font-serif font-medium">{detail.name}</h1>
        {detail.subtitle && (
          <p className="text-stone-500 mt-1">{detail.subtitle}</p>
        )}
        {detail.description && (
          <p className="text-sm text-stone-600 mt-2 max-w-2xl leading-relaxed">{detail.description}</p>
        )}
        <p className="text-sm text-stone-400 mt-2">{detail.total} items</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-6">
          {detail.books.map((book) => (
            <button
              key={book.id}
              onClick={() => router.push(`/embed/bph/book/${book.slug}`)}
              className="group text-left flex flex-col"
            >
              <div className="aspect-[3/4] bg-stone-100 rounded overflow-hidden mb-2">
                {book.thumbnail ? (
                  <img
                    src={book.thumbnail}
                    alt={book.display_title || book.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-stone-400 text-xs p-2 text-center">
                    {book.display_title || book.title}
                  </div>
                )}
              </div>
              <h3 className="text-xs font-medium leading-tight line-clamp-2 group-hover:text-stone-600">
                {book.display_title || book.title}
              </h3>
              <p className="text-[11px] text-stone-500 mt-0.5 line-clamp-1">
                {book.author}{book.published ? `, ${book.published}` : ''}
              </p>
            </button>
          ))}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-8">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm border border-stone-300 rounded disabled:opacity-30 hover:bg-stone-100"
            >
              ← Prev
            </button>
            <span className="text-sm text-stone-500 px-3">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-sm border border-stone-300 rounded disabled:opacity-30 hover:bg-stone-100"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    );
  }

  // Collection areas grid
  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-serif font-medium mb-6">Collection Areas</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {collections.map((col) => (
          <button
            key={col.slug}
            onClick={() => router.push(`/embed/bph/collections?area=${col.slug}`)}
            className="text-left p-5 border border-stone-200 rounded-lg hover:border-stone-400
                       hover:shadow-sm transition-all group"
          >
            <h2 className="text-lg font-serif font-medium group-hover:text-stone-600">
              {col.name}
            </h2>
            {col.subtitle && (
              <p className="text-xs text-stone-400 mt-0.5">{col.subtitle}</p>
            )}
            {col.description && (
              <p className="text-sm text-stone-500 mt-2 line-clamp-2">{col.description}</p>
            )}
            <p className="text-sm text-stone-400 mt-3">
              {col.item_count} {col.item_count === 1 ? 'item' : 'items'}
            </p>
          </button>
        ))}
      </div>

      {collections.length === 0 && (
        <p className="text-stone-500 text-center py-12">No collection areas found.</p>
      )}
    </div>
  );
}
