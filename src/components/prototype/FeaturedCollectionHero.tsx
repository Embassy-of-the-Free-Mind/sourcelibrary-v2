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

interface FeaturedCollectionCardProps {
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

export default function FeaturedCollectionCard({ collection, books }: FeaturedCollectionCardProps) {
  return (
    <section className="bg-dark py-12 md:py-16">
      <div className="px-6 md:px-12 max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <span className="text-xs uppercase tracking-[0.2em] text-white/40">Featured Collection</span>
          <span className="text-white/20">&middot;</span>
          <span className="text-xs text-white/40">Different every visit</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
          {/* Left: text + description */}
          <div className="flex flex-col justify-center">
            <Link href={`/collections/${collection.slug}`} className="group">
              <h2 className="text-3xl md:text-4xl text-white mb-3 leading-tight font-display group-hover:text-accent-gold transition-colors">
                {collection.name}
              </h2>
            </Link>

            {collection.subtitle && (
              <p className="text-lg text-white/70 leading-relaxed mb-4">
                {collection.subtitle}
              </p>
            )}

            {collection.description && (
              <p className="text-base text-white/50 leading-relaxed mb-6 line-clamp-4 font-body">
                {collection.description}
              </p>
            )}

            <div className="flex items-center gap-4">
              <Link
                href={`/collections/${collection.slug}`}
                className="inline-flex items-center gap-2 text-sm text-accent-gold hover:text-accent-gold/80 transition-colors group"
              >
                Explore {collection.book_count} books
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>
          </div>

          {/* Right: book thumbnails grid */}
          {books.length > 0 && (
            <div className="grid grid-cols-5 gap-3">
              {books.map((book) => {
                const thumb = book.thumbnail || book.thumbnail_blob;
                return (
                  <Link
                    key={book.id}
                    href={bookUrl(book)}
                    className="group"
                  >
                    <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-white/5 border border-white/10 group-hover:border-white/30 transition-all">
                      {thumb ? (
                        <Image
                          src={thumb}
                          alt={bookTitle(book)}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          sizes="(max-width: 1024px) 18vw, 10vw"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <BookOpen className="w-6 h-6 text-white/20" />
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-white/50 mt-1.5 line-clamp-2 group-hover:text-white/70 transition-colors leading-tight">
                      {bookTitle(book)}
                    </p>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
