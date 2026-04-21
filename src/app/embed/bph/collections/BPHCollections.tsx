'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Book, ChevronLeft, ChevronRight } from 'lucide-react';
import AuthorName from '@/components/AuthorName';

interface Collection {
  slug: string; name: string; description: string | null;
  subtitle: string | null; image: any | null; item_count: number;
}
interface BookItem {
  id: string; slug: string; title: string; display_title?: string;
  author: string; language: string; published: string; year: number;
  pages_count: number; pages_translated: number; thumbnail: string | null; url: string;
}
interface CollectionDetail extends Collection {
  books: BookItem[]; total: number; limit: number; offset: number;
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
        const params = new URLSearchParams({ slug: areaSlug, limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
        const res = await fetch(`/api/embed/bph/collections?${params}`);
        setDetail((await res.json()).collection);
      } else {
        const res = await fetch('/api/embed/bph/collections');
        setCollections((await res.json()).collections || []);
      }
    } catch (err) { console.error('Failed to fetch collections:', err); }
    finally { setLoading(false); }
  }, [areaSlug, page]);

  useEffect(() => { fetchCollections(); }, [fetchCollections]);

  useEffect(() => {
    if (typeof window === 'undefined' || window.self === window.top) return;
    window.parent.postMessage({ type: 'sl-navigate', path: areaSlug ? `/collections/${areaSlug}` : '/collections' }, '*');
  }, [areaSlug]);

  const tp = (b: BookItem) => b.pages_count > 0 ? Math.round((b.pages_translated / b.pages_count) * 100) : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50">
        <div className="relative overflow-hidden text-white py-12 md:py-16">
          <div className="absolute inset-0 bg-gradient-to-b from-[#2a1f17] to-[#1a1612]" />
          <div className="relative max-w-[var(--container-wide)] mx-auto px-6">
            <div className="h-10 w-64 bg-white/10 rounded animate-pulse" />
          </div>
        </div>
        <main className="max-w-[var(--container-wide)] mx-auto px-6 py-8">
          <div className="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="aspect-[4/3] bg-stone-200 rounded-lg animate-pulse" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  // Single collection detail
  if (areaSlug && detail) {
    const totalPages = Math.ceil(detail.total / PAGE_SIZE);
    return (
      <div className="min-h-screen bg-stone-50">
        <div className="relative overflow-hidden text-white py-12 md:py-16">
          <div className="absolute inset-0 bg-gradient-to-b from-[#2a1f17] to-[#1a1612]" />
          <div className="relative max-w-[var(--container-wide)] mx-auto px-6">
            <button onClick={() => router.push('/embed/bph/collections')}
              className="inline-flex items-center gap-2 text-stone-400 hover:text-white mb-4 text-sm transition-colors">
              <ArrowLeft className="w-4 h-4" /> All collection areas
            </button>
            <h1 className="font-serif text-3xl md:text-4xl tracking-tight">{detail.name}</h1>
            {detail.subtitle && <p className="text-stone-300 mt-2">{detail.subtitle}</p>}
            {detail.description && <p className="text-stone-400 mt-2 max-w-2xl leading-relaxed text-sm">{detail.description}</p>}
            <p className="text-stone-500 mt-2 text-sm">{detail.total} texts</p>
          </div>
        </div>
        <main className="max-w-[var(--container-wide)] mx-auto px-6 py-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {detail.books.map((book) => (
              <Link key={book.id} href={`/embed/bph/book/${book.slug}`} className="group">
                <div className="bg-white border border-light rounded-lg overflow-hidden hover:shadow-lg transition-shadow duration-200 h-full flex flex-col">
                  <div className="aspect-[3/4] relative bg-stone-100 overflow-hidden flex-shrink-0">
                    {book.thumbnail ? (
                      <img src={book.thumbnail} alt={book.display_title || book.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Book className="w-16 h-16 text-stone-300" /></div>
                    )}
                  </div>
                  <div className="p-4 flex-1 flex flex-col">
                    <h3 className="font-serif font-semibold text-primary line-clamp-2 group-hover:text-accent-rust transition-colors text-sm">
                      {book.display_title || book.title}
                    </h3>
                    <p className="text-sm text-secondary mt-1 line-clamp-1"><AuthorName author={book.author} /></p>
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-2 text-xs text-muted">
                      <span className="px-2 py-0.5 bg-stone-100 rounded">{book.language}</span>
                      {book.published && <span>{book.published}</span>}
                    </div>
                    {book.pages_count > 0 && (
                      <div className="mt-auto pt-3">
                        <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                          <div className={`h-full ${tp(book) >= 95 ? 'bg-status-success' : tp(book) > 0 ? 'bg-accent-gold/80' : 'bg-stone-200'}`}
                            style={{ width: `${Math.min(tp(book), 100)}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-10">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="inline-flex items-center gap-1 px-4 py-2 text-sm border border-medium rounded-lg disabled:opacity-30 hover:bg-warm">
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>
              <span className="text-sm text-muted">Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="inline-flex items-center gap-1 px-4 py-2 text-sm border border-medium rounded-lg disabled:opacity-30 hover:bg-warm">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </main>
      </div>
    );
  }

  // Collection areas grid — matches CollectionCard from collections page
  return (
    <div className="min-h-screen bg-stone-50">
      <div className="relative overflow-hidden text-white py-12 md:py-16">
        <div className="absolute inset-0 bg-gradient-to-b from-[#2a1f17] to-[#1a1612]" />
        <div className="relative max-w-[var(--container-wide)] mx-auto px-6">
          <h1 className="font-serif text-3xl md:text-4xl tracking-tight mb-2">Collection Areas</h1>
          <p className="text-stone-300 max-w-2xl leading-relaxed">Browse the BPH collection by subject area</p>
        </div>
      </div>
      <main className="max-w-[var(--container-wide)] mx-auto px-6 py-8">
        <div className="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {collections.map((col) => {
            const heroUrl = col.image?.extracted_url || col.image?.thumbnail_url || col.image?.image_url || null;
            return (
              <Link key={col.slug} href={`/embed/bph/collections?area=${col.slug}`}
                className="group relative block overflow-hidden rounded-lg aspect-[4/3]">
                {heroUrl ? (
                  <img src={heroUrl} alt={`Illustration from ${col.name}`}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105" loading="lazy" />
                ) : (
                  <div className="absolute inset-0 bg-warm" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />
                <div className="absolute inset-0 flex flex-col justify-end p-3 sm:p-4">
                  <p className="text-white/50 text-[11px] mb-1 hidden sm:block">
                    {col.item_count} {col.item_count === 1 ? 'book' : 'books'}
                  </p>
                  <h2 className="font-serif text-sm sm:text-base lg:text-lg text-white font-semibold leading-tight line-clamp-2 group-hover:text-accent-gold transition-colors">
                    {col.name}
                  </h2>
                </div>
              </Link>
            );
          })}
        </div>
        {collections.length === 0 && (
          <div className="text-center py-20">
            <Book className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <p className="text-muted font-serif text-lg">No collection areas found</p>
          </div>
        )}
      </main>
    </div>
  );
}
