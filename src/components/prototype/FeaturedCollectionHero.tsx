'use client';

import { useRef, useState, useEffect } from 'react';
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  };

  useEffect(() => {
    updateScrollState();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', updateScrollState);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
    };
  }, []);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === 'left' ? -280 : 280, behavior: 'smooth' });
  };

  return (
    <section className="bg-dark py-12 md:py-16">
      <div className="px-6 md:px-12 max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <span className="text-xs uppercase tracking-[0.2em] text-white/40">Featured Collection</span>
          <span className="text-white/20">&middot;</span>
          <span className="text-xs text-white/40">Different every visit</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-10">
          {/* Left: text + description */}
          <div className="lg:col-span-2 flex flex-col justify-center">
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

          {/* Right: book carousel with arrows */}
          {books.length > 0 && (
            <div className="lg:col-span-3 relative flex items-center">
              {/* Left arrow */}
              {canScrollLeft && (
                <button
                  onClick={() => scroll('left')}
                  className="absolute -left-2 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors backdrop-blur-sm"
                  aria-label="Scroll left"
                >
                  <ChevronLeft className="w-5 h-5 text-white" />
                </button>
              )}

              {/* Scrollable book row */}
              <div
                ref={scrollRef}
                className="flex gap-4 overflow-x-auto scroll-smooth px-1 py-1"
                style={{ scrollbarWidth: 'none' }}
              >
                {books.map((book) => {
                  const thumb = book.thumbnail_blob || book.thumbnail;
                  return (
                    <Link
                      key={book.id}
                      href={bookUrl(book)}
                      className="group flex-none"
                    >
                      <div className="w-[120px] md:w-[140px]">
                        <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-white/5 border border-white/10 group-hover:border-white/30 transition-all">
                          {thumb ? (
                            <Image
                              src={thumb}
                              alt={bookTitle(book)}
                              fill
                              className="object-cover group-hover:scale-105 transition-transform duration-300"
                              sizes="140px"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <BookOpen className="w-8 h-8 text-white/20" />
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-white/50 mt-2 line-clamp-2 group-hover:text-white/70 transition-colors leading-tight">
                          {bookTitle(book)}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>

              {/* Right arrow */}
              {canScrollRight && (
                <button
                  onClick={() => scroll('right')}
                  className="absolute -right-2 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors backdrop-blur-sm"
                  aria-label="Scroll right"
                >
                  <ChevronRight className="w-5 h-5 text-white" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
