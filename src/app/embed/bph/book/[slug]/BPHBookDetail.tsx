'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Book, ArrowLeft } from 'lucide-react';
import AuthorName from '@/components/AuthorName';

interface Chapter { title: string; startPage?: number; }
interface BookData {
  id: string; slug: string; title: string; display_title?: string;
  author: string; language: string; published: string; year: number;
  pages_count: number; pages_translated: number; pages_ocr: number;
  thumbnail: string | null; catalogue_number: string | null;
  description: string | null; summary: string | null;
  categories: string[]; chapters: Chapter[];
  doi: string | null; is_first_translation: boolean;
}

export default function BPHBookDetail({ book }: { book: BookData }) {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined' || window.self === window.top) return;
    window.parent.postMessage({ type: 'sl-navigate', book: book.slug }, '*');
  }, [book.slug]);

  const tp = book.pages_count > 0 ? Math.round((book.pages_translated / book.pages_count) * 100) : 0;

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="relative overflow-hidden text-white py-12 md:py-16">
        <div className="absolute inset-0 bg-gradient-to-b from-[#2a1f17] to-[#1a1612]" />
        <div className="relative max-w-[var(--container-standard)] mx-auto px-6">
          <button onClick={() => router.push('/embed/bph')}
            className="inline-flex items-center gap-2 text-stone-400 hover:text-white mb-6 text-sm transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to catalogue
          </button>
          <h1 className="font-serif text-3xl md:text-4xl tracking-tight leading-tight">
            {book.display_title || book.title}
          </h1>
          {book.display_title && book.display_title !== book.title && (
            <p className="text-stone-400 italic mt-2">{book.title}</p>
          )}
          <p className="text-stone-300 mt-2 text-lg"><AuthorName author={book.author} /></p>
        </div>
      </div>

      <main className="max-w-[var(--container-standard)] mx-auto px-6 py-10">
        <div className="flex flex-col md:flex-row gap-8">
          <div className="md:w-72 flex-shrink-0">
            <div className="bg-white border border-light rounded-lg overflow-hidden shadow-md">
              {book.thumbnail ? (
                <img src={book.thumbnail} alt={book.display_title || book.title} className="w-full" />
              ) : (
                <div className="aspect-[3/4] flex items-center justify-center bg-stone-100">
                  <Book className="w-20 h-20 text-stone-300" />
                </div>
              )}
            </div>
            <a href={`/book/${book.slug}`} target="_self"
              className="mt-4 w-full inline-flex items-center justify-center gap-2 px-6 py-3
                         bg-accent-rust text-white rounded-lg hover:bg-accent-rust/90
                         font-medium text-sm transition-colors">
              <Book className="w-4 h-4" /> Read this book
            </a>
          </div>

          <div className="flex-1">
            <div className="flex items-center flex-wrap gap-2 mb-6">
              <span className="px-3 py-1 bg-stone-100 rounded text-sm text-secondary">{book.language}</span>
              {book.published && <span className="px-3 py-1 bg-stone-100 rounded text-sm text-secondary">{book.published}</span>}
              <span className="px-3 py-1 bg-stone-100 rounded text-sm text-secondary">{book.pages_count} pages</span>
              {book.is_first_translation && (
                <span className="px-3 py-1 bg-accent-gold/20 rounded text-sm text-accent-gold font-medium">First English translation</span>
              )}
              {book.doi && <span className="px-3 py-1 bg-blue-50 rounded text-sm text-blue-700">DOI</span>}
            </div>

            {book.pages_count > 0 && (
              <div className="mb-6 p-4 bg-white border border-light rounded-lg">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className={tp >= 95 ? 'text-status-success font-medium' : 'text-secondary'}>
                    {tp >= 95 ? '✓ Fully translated' : `${tp}% translated`}
                  </span>
                  <span className="text-faint text-xs">{book.pages_translated}/{book.pages_count} pages</span>
                </div>
                <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${tp >= 95 ? 'bg-status-success' : tp > 0 ? 'bg-accent-gold/80' : 'bg-stone-200'}`}
                    style={{ width: `${Math.min(tp, 100)}%` }} />
                </div>
              </div>
            )}

            {book.catalogue_number && <p className="text-xs text-faint mb-4">{book.catalogue_number}</p>}

            {book.summary && (
              <div className="mb-6">
                <h2 className="font-display text-lg text-primary mb-2">About this text</h2>
                <p className="text-secondary leading-relaxed">{book.summary}</p>
              </div>
            )}
            {book.description && !book.summary && (
              <div className="mb-6">
                <h2 className="font-display text-lg text-primary mb-2">Description</h2>
                <p className="text-secondary leading-relaxed">{book.description}</p>
              </div>
            )}

            {book.categories.length > 0 && (
              <div className="mb-6">
                <h2 className="font-display text-lg text-primary mb-2">Collection areas</h2>
                <div className="flex flex-wrap gap-2">
                  {book.categories.map(cat => (
                    <Link key={cat} href={`/embed/bph?category=${cat}`}
                      className="px-3 py-1.5 bg-stone-100 rounded-lg text-sm text-secondary
                                 hover:bg-accent-rust/10 hover:text-accent-rust transition-colors capitalize">
                      {cat.replace(/-/g, ' ')}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {book.chapters.length > 0 && (
              <div className="mb-6">
                <h2 className="font-display text-lg text-primary mb-2">Contents ({book.chapters.length} chapters)</h2>
                <div className="bg-white border border-light rounded-lg divide-y divide-stone-100 max-h-64 overflow-y-auto">
                  {book.chapters.map((ch, i) => (
                    <div key={i} className="px-4 py-2.5 text-sm text-secondary">
                      <span className="text-faint mr-2 font-mono text-xs">{i + 1}.</span>{ch.title}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
