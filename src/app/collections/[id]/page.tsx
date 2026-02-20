'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, Loader2 } from 'lucide-react';
import ContentPageLayout, { SubPageHeader } from '@/components/layout/ContentPageLayout';
import CollectionBookCard from '@/components/CollectionBookCard';

interface CollectionMeta {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  color: string;
  book_count: number;
  languages: { lang: string; count: number }[];
}

interface BookItem {
  id: string;
  title: string;
  display_title?: string;
  author?: string;
  year?: number;
  language?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  photo?: string;
  thumbnail?: string;
  categories?: string[];
  published?: string;
}

const SORT_OPTIONS = [
  { value: 'year_asc', label: 'Oldest first' },
  { value: 'year_desc', label: 'Newest first' },
  { value: 'title', label: 'Title A-Z' },
  { value: 'recent', label: 'Recently added' },
];

const PER_PAGE = 60;

export default function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [collection, setCollection] = useState<CollectionMeta | null>(null);
  const [books, setBooks] = useState<BookItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const sort = searchParams.get('sort') || 'year_asc';
  const language = searchParams.get('language') || '';
  const offset = parseInt(searchParams.get('offset') || '0');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ sort, limit: String(PER_PAGE), offset: String(offset) });
      if (language) qs.set('language', language);

      const res = await fetch(`/api/collections/${id}?${qs}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      setCollection(data.collection);
      setBooks(data.books);
      setTotal(data.total);
    } catch {
      setCollection(null);
    } finally {
      setLoading(false);
    }
  }, [id, sort, language, offset]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateParams = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    if (updates.sort || updates.language) params.delete('offset');
    router.push(`/collections/${id}?${params.toString()}`, { scroll: false });
  };

  if (loading && !collection) {
    return (
      <ContentPageLayout>
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted" />
        </div>
      </ContentPageLayout>
    );
  }

  if (!collection) {
    return (
      <ContentPageLayout>
        <div className="text-center py-20">
          <BookOpen className="w-12 h-12 text-muted mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-primary">Collection not found</h2>
          <Link href="/collections" className="text-accent-rust hover:underline mt-2 inline-block">
            Browse all collections
          </Link>
        </div>
      </ContentPageLayout>
    );
  }

  const totalPages = Math.ceil(total / PER_PAGE);
  const currentPage = Math.floor(offset / PER_PAGE) + 1;
  const languages = (collection.languages || []).filter(l => l.count > 2);

  return (
    <ContentPageLayout>
      <SubPageHeader title={collection.name} subtitle={collection.subtitle} backHref="/collections" backLabel="Collections" />

      <div className="mb-6">
        <p className="text-muted text-sm max-w-3xl leading-relaxed">
          {collection.description}
        </p>
        <p className="text-xs text-muted mt-2">
          {total.toLocaleString()} books
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select
          value={sort}
          onChange={(e) => updateParams({ sort: e.target.value })}
          className="text-sm border border-border-light rounded-md px-3 py-1.5 bg-white text-primary"
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {languages.length > 1 && (
          <select
            value={language}
            onChange={(e) => updateParams({ language: e.target.value })}
            className="text-sm border border-border-light rounded-md px-3 py-1.5 bg-white text-primary"
          >
            <option value="">All languages</option>
            {languages.map(l => (
              <option key={l.lang} value={l.lang}>{l.lang} ({l.count})</option>
            ))}
          </select>
        )}
      </div>

      {/* Books Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {books.map((book, i) => (
          <CollectionBookCard
            key={book.id}
            book={{
              bookId: book.id,
              id: book.id,
              title: book.display_title || book.title,
              author: book.author || '',
              year: book.year || 0,
              pages_count: book.pages_count,
              pages_ocr: book.pages_ocr,
              pages_translated: book.pages_translated,
              thumbnail: book.thumbnail || book.photo,
              language: book.language,
              published: book.published,
              translation_percent: book.pages_count && book.pages_translated
                ? Math.round((book.pages_translated / book.pages_count) * 100)
                : 0,
            }}
            index={offset + i}
            priority={i < 10}
          />
        ))}
      </div>

      {loading && (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted" />
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-8 text-sm">
          <button
            onClick={() => updateParams({ offset: String(Math.max(0, offset - PER_PAGE)) })}
            disabled={offset === 0}
            className="px-3 py-1.5 rounded border border-border-light disabled:opacity-30 hover:bg-warm transition-colors"
          >
            Previous
          </button>
          <span className="text-muted">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => updateParams({ offset: String(offset + PER_PAGE) })}
            disabled={currentPage >= totalPages}
            className="px-3 py-1.5 rounded border border-border-light disabled:opacity-30 hover:bg-warm transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </ContentPageLayout>
  );
}
