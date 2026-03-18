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
      // Brief delay so new images start loading before fade-in
      setTimeout(() => {
        setFading(false);
        fadingRef.current = false;
      }, 80);
    }, 250);
  }, []);

  if (items.length === 0) return null;

  const current = items[index];
  const { collection, books, galleryImages = [] } = current;

  const prev = () => goTo(index > 0 ? index - 1 : items.length - 1);
  const next = () => goTo(index < items.length - 1 ? index + 1 : 0);

  const hasGallery = galleryImages.length >= 2;

  return (
    <section className="bg-dark py-12 md:py-16 relative overflow-hidden">
      <div className="px-6 md:px-12 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="text-xs uppercase tracking-[0.2em] text-white/40">Featured Collection</span>
            <span className="text-white/20">&middot;</span>
            <span className="text-xs text-white/40">{index + 1} of {items.length}</span>
          </div>

          {/* Navigation arrows */}
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
          className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-10 transition-opacity duration-250 ease-in-out"
          style={{ opacity: fading ? 0 : 1 }}
        >
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

          {/* Right: gallery images (preferred) or book thumbnails (fallback) */}
          {hasGallery ? (
            <div className="lg:col-span-3 grid grid-cols-[3fr_2fr] gap-3 h-[420px]">
              {/* Hero image — portrait/book-proportioned */}
              <Link
                href={`/gallery/image/${galleryImages[0].id}`}
                className="relative rounded-lg overflow-hidden bg-white/5 border border-white/10 group"
              >
                <Image
                  src={galleryImages[0].image_url}
                  alt={galleryImages[0].museum_description || galleryImages[0].book_title}
                  fill
                  quality={90}
                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                  sizes="(max-width: 1024px) 60vw, 35vw"
                />
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-4">
                  {galleryImages[0].type && (
                    <span className="text-[10px] uppercase tracking-wider text-white/60 mb-1 block">
                      {galleryImages[0].type}
                    </span>
                  )}
                  <p className="text-sm text-white/90 line-clamp-2 leading-snug">
                    {galleryImages[0].book_title}
                  </p>
                </div>
              </Link>

              {/* Side — 2 square images */}
              <div className="flex flex-col gap-3">
                {galleryImages.slice(1, 3).map((img) => (
                  <Link
                    key={img.id}
                    href={`/gallery/image/${img.id}`}
                    className="relative flex-1 aspect-square rounded-lg overflow-hidden bg-white/5 border border-white/10 group min-h-0"
                  >
                    <Image
                      src={img.image_url}
                      alt={img.museum_description || img.book_title}
                      fill
                      quality={85}
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                      sizes="(max-width: 640px) 40vw, 15vw"
                    />
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-[11px] text-white/80 line-clamp-1">
                        {img.book_title}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ) : books.length > 0 ? (
            <div className="lg:col-span-3 grid grid-cols-4 sm:grid-cols-5 gap-3">
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
                          quality={85}
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          sizes="(max-width: 640px) 22vw, 12vw"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <BookOpen className="w-8 h-8 text-white/20" />
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-white/50 mt-1.5 line-clamp-2 group-hover:text-white/70 transition-colors leading-tight">
                      {bookTitle(book)}
                    </p>
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>

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
