'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Chapter {
  title: string;
  startPage?: number;
}

interface BookData {
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
  pages_ocr: number;
  thumbnail: string | null;
  catalogue_number: string | null;
  description: string | null;
  summary: string | null;
  categories: string[];
  chapters: Chapter[];
  doi: string | null;
  is_first_translation: boolean;
}

export default function BPHBookDetail({ book }: { book: BookData }) {
  const router = useRouter();

  // Notify parent iframe
  useEffect(() => {
    if (typeof window === 'undefined' || window.self === window.top) return;
    window.parent.postMessage({ type: 'sl-navigate', book: book.slug }, '*');
  }, [book.slug]);

  const translationPercent = book.pages_count > 0
    ? Math.round((book.pages_translated / book.pages_count) * 100)
    : 0;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      {/* Back button */}
      <button
        onClick={() => router.push('/embed/bph')}
        className="text-sm text-stone-500 hover:text-stone-700 mb-4 flex items-center gap-1"
      >
        ← Back to catalogue
      </button>

      <div className="flex flex-col sm:flex-row gap-6">
        {/* Cover image */}
        <div className="sm:w-64 flex-shrink-0">
          {book.thumbnail ? (
            <img
              src={book.thumbnail}
              alt={book.display_title || book.title}
              className="w-full rounded shadow-lg"
            />
          ) : (
            <div className="w-full aspect-[3/4] bg-stone-200 rounded flex items-center justify-center text-stone-400">
              No image
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex-1">
          <h1 className="text-2xl font-serif font-medium leading-tight">
            {book.display_title || book.title}
          </h1>
          {book.display_title && book.display_title !== book.title && (
            <p className="text-sm text-stone-500 italic mt-1">{book.title}</p>
          )}
          <p className="text-stone-600 mt-2">{book.author}</p>

          {/* Metadata pills */}
          <div className="flex flex-wrap gap-2 mt-4">
            <Pill label={book.language} />
            {book.published && <Pill label={book.published} />}
            <Pill label={`${book.pages_count} pages`} />
            {book.pages_translated > 0 && (
              <Pill label={`${translationPercent}% translated`} color="emerald" />
            )}
            {book.is_first_translation && (
              <Pill label="First English translation" color="amber" />
            )}
            {book.doi && <Pill label="DOI" />}
          </div>

          {book.catalogue_number && (
            <p className="text-xs text-stone-400 mt-3">{book.catalogue_number}</p>
          )}

          {/* Read button */}
          <a
            href={`/book/${book.slug}`}
            target="_self"
            className="inline-flex items-center gap-2 mt-6 px-6 py-3 bg-stone-900 text-white rounded-lg
                       hover:bg-stone-800 font-medium text-sm transition-colors"
          >
            <BookIcon />
            Read this book
          </a>

          {/* Summary */}
          {book.summary && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-stone-700 mb-2">About this text</h2>
              <p className="text-sm text-stone-600 leading-relaxed">{book.summary}</p>
            </div>
          )}

          {/* Description */}
          {book.description && !book.summary && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-stone-700 mb-2">Description</h2>
              <p className="text-sm text-stone-600 leading-relaxed">{book.description}</p>
            </div>
          )}

          {/* Categories */}
          {book.categories.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-stone-700 mb-2">Collection areas</h2>
              <div className="flex flex-wrap gap-2">
                {book.categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => router.push(`/embed/bph?category=${cat}`)}
                    className="text-xs px-2.5 py-1 bg-stone-100 rounded-full text-stone-600
                               hover:bg-stone-200 transition-colors capitalize"
                  >
                    {cat.replace(/-/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chapters */}
          {book.chapters.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-stone-700 mb-2">
                Contents ({book.chapters.length} chapters)
              </h2>
              <ul className="text-sm text-stone-600 space-y-1 max-h-48 overflow-y-auto">
                {book.chapters.map((ch, i) => (
                  <li key={i} className="truncate">
                    <span className="text-stone-400 mr-2">{i + 1}.</span>
                    {ch.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Pill({ label, color }: { label: string; color?: 'emerald' | 'amber' }) {
  const colorClasses = color === 'emerald'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : color === 'amber'
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-stone-100 text-stone-600 border-stone-200';

  return (
    <span className={`text-xs px-2.5 py-1 rounded-full border ${colorClasses}`}>
      {label}
    </span>
  );
}

function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 2.5h4.5a2 2 0 012 2v9a1.5 1.5 0 00-1.5-1.5H2V2.5z" />
      <path d="M14 2.5H9.5a2 2 0 00-2 2v9a1.5 1.5 0 011.5-1.5H14V2.5z" />
    </svg>
  );
}
