import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, ArrowRight } from 'lucide-react';
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

interface EditorialSpreadProps {
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
  return dt && dt !== 'None' ? dt : book.title;
}

export default function EditorialSpread({ collection, books }: EditorialSpreadProps) {
  return (
    <section className="relative overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0">
        {collection.hero_image ? (
          <Image
            src={collection.hero_image}
            alt=""
            fill
            className="object-cover"
            sizes="100vw"
            quality={85}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#2a2018] to-[#1a1612]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/70 to-black/40" />
      </div>

      <div className="relative max-w-7xl mx-auto px-6 md:px-12 py-16 md:py-24">
        <div className="max-w-xl">
          <span className="text-xs uppercase tracking-[0.2em] text-accent-gold/80 mb-4 block">
            Featured Collection
          </span>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-display text-white leading-[1.1] mb-4">
            {collection.name}
          </h2>
          {collection.subtitle && (
            <p className="text-xl text-white/70 leading-relaxed mb-4 font-body">
              {collection.subtitle}
            </p>
          )}
          {collection.description && (
            <p className="text-base text-white/50 leading-relaxed mb-8 line-clamp-3 font-body">
              {collection.description}
            </p>
          )}
          <Link
            href={`/collections/${collection.slug}`}
            className="inline-flex items-center gap-2 bg-accent-gold/90 hover:bg-accent-gold text-white px-6 py-3 rounded-lg text-sm font-medium transition-colors"
          >
            Explore {collection.book_count} books
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Book strip at the bottom */}
      {books.length > 0 && (
        <div className="relative border-t border-white/10 bg-black/60 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-6 md:px-12 py-6">
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
              {books.slice(0, 8).map((book) => {
                const thumb = book.thumbnail || book.thumbnail_blob;
                return (
                  <Link key={book.id} href={bookUrl(book)} className="group flex-shrink-0">
                    <div className="w-[100px] md:w-[120px] aspect-[3/4] relative rounded-lg overflow-hidden bg-white/5 border border-white/10 group-hover:border-accent-gold/50 transition-all">
                      {thumb ? (
                        <Image
                          src={thumb}
                          alt={bookTitle(book)}
                          fill
                          quality={80}
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          sizes="120px"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <BookOpen className="w-6 h-6 text-white/20" />
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-white/40 mt-1.5 line-clamp-2 group-hover:text-white/70 transition-colors leading-tight w-[100px] md:w-[120px]">
                      {bookTitle(book)}
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
