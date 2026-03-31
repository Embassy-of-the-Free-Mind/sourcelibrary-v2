import Link from 'next/link';
import type { RelatedBooks as RelatedBooksType } from '@/lib/types';
import AuthorName from '@/components/AuthorName';

interface RelatedBooksProps {
  relatedBooks: RelatedBooksType;
}

/**
 * Renders pre-computed related books from book.related_books.
 * Zero extra queries — data is stored on the book document.
 *
 * "Direct" = this book mentions someone who authored another book in our library.
 * "Shared" = books that discuss many of the same people/places/concepts.
 */
export default function RelatedBooks({ relatedBooks }: RelatedBooksProps) {
  const { direct, shared } = relatedBooks;
  if (direct.length === 0 && shared.length === 0) return null;

  const counts = [
    direct.length > 0 ? `${direct.length} cited` : '',
    shared.length > 0 ? `${shared.length} related` : '',
  ].filter(Boolean).join(', ');

  return (
    <details className="card mt-6">
      <summary className="flex items-center justify-between p-6 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Related Books</h2>
          {counts && <span className="text-xs text-stone-400">{counts}</span>}
        </div>
        <span className="text-sm text-accent-rust hover:text-accent-gold-dark">
          See All &rarr;
        </span>
      </summary>
      <div className="px-6 pb-6">
        {/* Direct citations — this book mentions authors of these works */}
        {direct.length > 0 && (
          <div className={shared.length > 0 ? 'mb-4 pb-4 border-b border-stone-100' : ''}>
            <p className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">
              Cited authors in our library ({direct.length})
            </p>
            <div className="space-y-1.5">
              {direct.map((rb) => (
                <Link
                  key={rb.id}
                  href={`/book/${rb.id}`}
                  className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-stone-50 transition-colors group"
                >
                  <span className="text-stone-800 group-hover:text-accent-gold-dark transition-colors flex-1 min-w-0 truncate">
                    {rb.title}
                  </span>
                  {rb.cited_as && (
                    <span className="text-xs text-accent-rust shrink-0">via {rb.cited_as}</span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Shared entity context — books discussing the same people/places/concepts */}
        {shared.length > 0 && (
          <div>
            <p className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">
              Related works ({shared.length})
            </p>
            <div className="space-y-1.5">
              {shared.map((rb) => (
                <Link
                  key={rb.id}
                  href={`/book/${rb.id}`}
                  className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-stone-50 transition-colors group"
                >
                  <span className="text-stone-800 group-hover:text-accent-gold-dark transition-colors flex-1 min-w-0 truncate">
                    {rb.title}
                  </span>
                  {rb.author && rb.author !== 'Unknown' && (
                    <span className="text-xs text-stone-400 shrink-0 truncate max-w-[120px]"><AuthorName author={rb.author} /></span>
                  )}
                  <span className="text-xs text-accent-sage shrink-0">
                    {rb.shared_names?.length ? rb.shared_names.join(', ') : `${rb.shared_count} shared`}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
