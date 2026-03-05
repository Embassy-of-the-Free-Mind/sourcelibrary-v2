import Link from 'next/link';
import Image from 'next/image';
import { BookOpen } from 'lucide-react';
import UnifiedSearch from '@/components/search/UnifiedSearch';
import UserMenu from '@/components/layout/UserMenu';
import { bookUrl } from '@/lib/slugify';

interface FeaturedBook {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author: string;
  thumbnail?: string;
  thumbnail_blob?: string;
}

interface FeaturedCollectionHeroProps {
  collection: {
    slug: string;
    name: string;
    subtitle: string;
    description: string;
    book_count: number;
    hero_image: string | null;
  };
  books: FeaturedBook[];
}

function bookTitle(book: { display_title?: string; title: string }): string {
  const dt = book.display_title;
  return (dt && dt !== 'None') ? dt : book.title;
}

export default function FeaturedCollectionHero({ collection, books }: FeaturedCollectionHeroProps) {
  return (
    <section className="relative min-h-screen w-full overflow-hidden bg-dark">
      {/* Background image */}
      {collection.hero_image && (
        <Image
          src={collection.hero_image}
          alt=""
          fill
          className="object-cover z-0"
          priority
          sizes="100vw"
        />
      )}

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/40 to-black/70 z-0" />

      {/* Header Navigation */}
      <header className="relative z-50 flex items-center justify-between px-6 md:px-12 py-4">
        <Link href="/" className="text-white flex items-center gap-3" aria-label="Source Library home">
          <svg className="w-10 h-10 md:w-12 md:h-12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="1" />
            <circle cx="12" cy="12" r="7" stroke="white" strokeWidth="1" />
            <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1" />
          </svg>
          <span className="text-xl md:text-2xl uppercase tracking-wider text-white">
            <span className="font-semibold text-white">Source</span>
            <span className="font-light text-white">Library</span>
          </span>
        </Link>
        <UserMenu variant="hero" />
      </header>

      {/* Hero Content */}
      <div className="relative z-10 h-full flex flex-col justify-center px-6 md:px-12 pb-32 pt-8">
        <div className="max-w-4xl">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs uppercase tracking-[0.2em] text-white/60">Featured Collection</span>
            <span className="text-white/30">|</span>
            <span className="text-xs text-white/60">{collection.book_count} books</span>
          </div>

          <Link href={`/collections/${collection.slug}`}>
            <h1 className="text-4xl md:text-5xl lg:text-6xl text-white mb-4 leading-tight tracking-wide font-display hover:text-white/90 transition-colors">
              {collection.name}
            </h1>
          </Link>

          {collection.subtitle && (
            <p className="text-xl md:text-2xl font-light text-white/80 leading-relaxed max-w-2xl mb-6">
              {collection.subtitle}
            </p>
          )}

          {/* Featured books row */}
          {books.length > 0 && (
            <div className="flex gap-3 mb-8 overflow-x-auto pb-2">
              {books.map((book) => {
                const thumb = book.thumbnail || book.thumbnail_blob;
                return (
                  <Link
                    key={book.id}
                    href={bookUrl(book)}
                    className="group flex-shrink-0 w-28 md:w-32"
                  >
                    <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-white/10 border border-white/10 group-hover:border-white/30 transition-all">
                      {thumb ? (
                        <Image
                          src={thumb}
                          alt={bookTitle(book)}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          sizes="128px"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <BookOpen className="w-8 h-8 text-white/30" />
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-white/70 mt-2 line-clamp-2 group-hover:text-white transition-colors">
                      {bookTitle(book)}
                    </p>
                  </Link>
                );
              })}
              <Link
                href={`/collections/${collection.slug}`}
                className="flex-shrink-0 w-28 md:w-32 flex flex-col items-center justify-center rounded-lg border border-white/10 hover:border-white/30 transition-all group"
              >
                <span className="text-sm text-white/50 group-hover:text-white transition-colors">Browse all</span>
              </Link>
            </div>
          )}

          {/* Search */}
          <div className="max-w-xl">
            <UnifiedSearch />
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <a
        href="#library"
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 group"
        aria-label="Scroll to library"
      >
        <span className="text-xs uppercase tracking-[0.2em] text-white/70 group-hover:text-white transition-colors">
          Explore the collection
        </span>
        <svg className="w-5 h-5 text-white/70 group-hover:text-white animate-bounce transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </a>
    </section>
  );
}
