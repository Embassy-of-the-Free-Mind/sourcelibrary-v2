import Link from 'next/link';
import { Book } from '@/lib/types';

export default function RecentlyTranslated({ books }: { books: Book[] }) {
  if (books.length === 0) return null;

  return (
    <div>
      <div className="flex overflow-x-auto gap-4 sm:gap-5 pb-4 -mx-6 px-6 md:-mx-12 md:px-12 scrollbar-thin">
        {books.map((book) => {
          const title = book.display_title || book.title;
          const thumbnail = book.thumbnail_blob || book.thumbnail;
          const translationPercent = book.pages_count && book.pages_count > 0
            ? Math.round(((book.pages_translated || 0) / book.pages_count) * 100)
            : 0;

          return (
            <Link
              key={book.id}
              href={`/book/${book.id}`}
              className="group flex-none w-44 sm:w-48"
            >
              {/* Thumbnail */}
              <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-warm mb-3">
                {thumbnail ? (
                  <img
                    src={thumbnail}
                    alt={title}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-stone-400">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                    </svg>
                  </div>
                )}

                {/* Translation badge */}
                {translationPercent > 0 && (
                  <div className="absolute top-2 right-2 px-2 py-0.5 text-xs font-medium text-white bg-accent-rust/90 backdrop-blur-sm rounded-full">
                    {translationPercent}% translated
                  </div>
                )}
              </div>

              {/* Text */}
              <h3 className="font-serif text-sm font-semibold text-stone-800 leading-snug line-clamp-2 group-hover:text-accent-rust transition-colors">
                {title}
              </h3>
              {book.author && (
                <p className="mt-0.5 text-xs text-stone-500 line-clamp-1">
                  {book.author}
                </p>
              )}
              {book.published && (
                <p className="text-xs text-stone-400">{book.published}</p>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
