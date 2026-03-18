'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
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

interface GalleryImage {
  id: string;
  image_url: string;
  type: string;
  museum_description: string;
  book_title: string;
  book_id: string;
  book_slug?: string;
}

interface FeaturedCollectionItem {
  collection: {
    slug: string;
    name: string;
    subtitle: string;
    description: string;
    book_count: number;
    hero_image: string | null;
  };
  books: FeaturedBook[];
  galleryImages?: GalleryImage[];
}

interface FeaturedCollectionCarouselProps {
  items: FeaturedCollectionItem[];
}

function bookTitle(book: { display_title?: string; title: string }): string {
  const dt = book.display_title;
  return (dt && dt !== 'None') ? dt : book.title;
}

export default function FeaturedCollectionCarousel({ items }: FeaturedCollectionCarouselProps) {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const fadingRef = useRef(false);

  const goTo = useCallback((nextIndex: number) => {
    if (fadingRef.current) return;
    fadingRef.current = true;
    setFading(true);
    setTimeout(() => {
      setIndex(nextIndex);
      setTimeout(() => {
        setFading(false);
        fadingRef.current = false;
      }, 80);
    }, 250);
  }, []);

  if (items.length === 0) return null;

  const current = items[index];
  const { collection, books } = current;

  const prev = () => goTo(index > 0 ? index - 1 : items.length - 1);
  const next = () => goTo(index < items.length - 1 ? index + 1 : 0);

  // Use first book's thumbnail as the hero page image
  const heroBook = books.find(b => b.thumbnail || b.thumbnail_blob);
  const heroThumb = heroBook ? (heroBook.thumbnail_blob || heroBook.thumbnail) : collection.hero_image;
  // Remaining books for the title list (skip the hero book)
  const listBooks = heroBook ? books.filter(b => b.id !== heroBook.id) : books;

  return (
    <section className="bg-dark py-12 md:py-16 relative overflow-hidden">
      <div className="px-6 md:px-12 max-w-6xl mx-auto overflow-hidden">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="text-xs uppercase tracking-[0.2em] text-white/40">Featured Collection</span>
            <span className="text-white/20">&middot;</span>
            <span className="text-xs text-white/40">{index + 1} of {items.length}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={prev}
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              aria-label="Previous collection"
            >
              <ChevronLeft className="w-5 h-5 text-white" />
            </button>
            <button
              onClick={next}
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              aria-label="Next collection"
            >
              <ChevronRight className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        <div
          className="grid grid-cols-1 lg:grid-cols-[2fr_auto_1fr] gap-8 lg:gap-10 transition-opacity duration-250 ease-in-out"
          style={{ opacity: fading ? 0 : 1 }}
        >
          {/* Left: text + description */}
          <div className="flex flex-col justify-center min-w-0">
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

          {/* Center: tall book-page hero image */}
          {heroThumb ? (
            <div className="hidden lg:block">
              <Link
                href={heroBook ? bookUrl(heroBook) : `/collections/${collection.slug}`}
                className="group block relative w-[220px] h-[340px] rounded-lg overflow-hidden bg-white/5 border border-white/10 shadow-2xl"
              >
                <Image
                  src={heroThumb}
                  alt={heroBook ? bookTitle(heroBook) : collection.name}
                  fill
                  quality={90}
                  className="object-cover group-hover:scale-[1.03] transition-transform duration-500"
                  sizes="220px"
                />
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent p-3">
                  <p className="text-xs text-white/80 line-clamp-2 leading-snug">
                    {heroBook ? bookTitle(heroBook) : ''}
                  </p>
                  {heroBook?.author && (
                    <p className="text-[10px] text-white/50 mt-0.5 line-clamp-1">
                      {heroBook.author}
                    </p>
                  )}
                </div>
              </Link>
            </div>
          ) : null}

          {/* Right: book title list */}
          {listBooks.length > 0 ? (
            <div className="min-w-0 flex flex-col gap-0.5 justify-center max-h-[340px] overflow-hidden">
              <p className="text-[10px] uppercase tracking-[0.15em] text-white/30 mb-2">In this collection</p>
              {listBooks.slice(0, 8).map((book) => {
                const thumb = book.thumbnail_blob || book.thumbnail;
                return (
                  <Link
                    key={book.id}
                    href={bookUrl(book)}
                    className="group flex items-center gap-3 py-1.5 hover:bg-white/5 rounded-md px-1.5 -mx-1.5 transition-colors"
                  >
                    <div className="w-7 h-9 flex-shrink-0 relative rounded overflow-hidden bg-white/5 border border-white/10">
                      {thumb ? (
                        <Image
                          src={thumb}
                          alt=""
                          fill
                          className="object-cover"
                          sizes="28px"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <BookOpen className="w-3.5 h-3.5 text-white/20" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white/70 group-hover:text-white transition-colors line-clamp-1 leading-tight">
                        {bookTitle(book)}
                      </p>
                      {book.author && (
                        <p className="text-[11px] text-white/35 line-clamp-1 leading-tight mt-0.5">
                          {book.author}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
              {books.length > 9 && (
                <Link
                  href={`/collections/${collection.slug}`}
                  className="text-xs text-white/30 hover:text-white/50 transition-colors mt-1 pl-1.5"
                >
                  + {collection.book_count - 9} more
                </Link>
              )}
            </div>
          ) : null}
        </div>

        {/* Mobile: show hero image + book grid for small screens */}
        {books.length > 0 && (
          <div
            className="lg:hidden mt-6 transition-opacity duration-250 ease-in-out"
            style={{ opacity: fading ? 0 : 1 }}
          >
            <div className="flex gap-4">
              {/* Mobile hero book */}
              {heroThumb && heroBook && (
                <Link
                  href={bookUrl(heroBook)}
                  className="group flex-shrink-0"
                >
                  <div className="w-[140px] h-[210px] relative rounded-lg overflow-hidden bg-white/5 border border-white/10 shadow-lg">
                    <Image
                      src={heroThumb}
                      alt={bookTitle(heroBook)}
                      fill
                      quality={85}
                      className="object-cover"
                      sizes="140px"
                    />
                  </div>
                  <p className="text-xs text-white/50 mt-1.5 line-clamp-2 w-[140px] leading-tight">
                    {bookTitle(heroBook)}
                  </p>
                </Link>
              )}
              {/* Mobile book list */}
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                {listBooks.slice(0, 5).map((book) => (
                  <Link
                    key={book.id}
                    href={bookUrl(book)}
                    className="group flex items-center gap-2.5 py-1"
                  >
                    <div className="w-6 h-8 flex-shrink-0 relative rounded overflow-hidden bg-white/5 border border-white/10">
                      {(book.thumbnail_blob || book.thumbnail) ? (
                        <Image
                          src={(book.thumbnail_blob || book.thumbnail)!}
                          alt=""
                          fill
                          className="object-cover"
                          sizes="24px"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <BookOpen className="w-3 h-3 text-white/20" />
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-white/60 group-hover:text-white/80 transition-colors line-clamp-1 leading-tight">
                      {bookTitle(book)}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Dots */}
        <div className="flex justify-center gap-2 mt-8">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`w-2 h-2 rounded-full transition-colors ${i === index ? 'bg-accent-gold' : 'bg-white/20 hover:bg-white/40'}`}
              aria-label={`Go to collection ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
