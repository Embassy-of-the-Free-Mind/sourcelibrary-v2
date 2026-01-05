'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ChevronRight, Image as ImageIcon } from 'lucide-react';

interface FeaturedImage {
  id: string;
  pageId: string;
  detectionIndex: number;
  imageUrl: string;
  description: string;
  type?: string;
  bookTitle: string;
  bookId: string;
  author?: string;
  year?: number;
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface FeaturedGalleryProps {
  images: FeaturedImage[];
}

function getCroppedImageUrl(imageUrl: string, bbox: { x: number; y: number; width: number; height: number }): string {
  const params = new URLSearchParams({
    url: imageUrl,
    x: bbox.x.toString(),
    y: bbox.y.toString(),
    w: bbox.width.toString(),
    h: bbox.height.toString()
  });
  return `/api/crop-image?${params}`;
}

export default function FeaturedGallery({ images }: FeaturedGalleryProps) {
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());

  if (!images || images.length === 0) {
    return null;
  }

  const handleImageError = (id: string) => {
    setImageErrors(prev => new Set(prev).add(id));
  };

  return (
    <section className="py-12 md:py-16">
      <div className="px-6 md:px-12 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2
              className="text-2xl md:text-3xl text-gray-900"
              style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
            >
              From the Collection
            </h2>
            <p className="text-gray-600 mt-1">
              Illustrations, emblems & engravings from our translated texts
            </p>
          </div>
          <Link
            href="/gallery"
            className="flex items-center gap-1 text-amber-700 hover:text-amber-800 font-medium transition-colors"
          >
            Browse Gallery
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Image Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
          {images.map((image) => {
            const displayUrl = image.bbox
              ? getCroppedImageUrl(image.imageUrl, image.bbox)
              : image.imageUrl;
            const hasError = imageErrors.has(image.id);

            return (
              <Link
                key={image.id}
                href={`/gallery/image/${image.pageId}:${image.detectionIndex}`}
                className="group relative aspect-square bg-stone-100 rounded-lg overflow-hidden hover:shadow-lg transition-all hover:-translate-y-0.5"
              >
                {!hasError ? (
                  <Image
                    src={displayUrl}
                    alt={image.description}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                    sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 16vw"
                    onError={() => handleImageError(image.id)}
                    unoptimized={!!image.bbox}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-stone-300">
                    <ImageIcon className="w-8 h-8" />
                  </div>
                )}

                {/* Overlay on hover */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <p className="text-white text-xs line-clamp-2 font-medium">
                      {image.description}
                    </p>
                    <p className="text-white/70 text-[10px] mt-1 line-clamp-1">
                      {image.bookTitle}
                    </p>
                  </div>
                </div>

                {/* Type badge */}
                {image.type && (
                  <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] bg-black/50 text-white capitalize opacity-0 group-hover:opacity-100 transition-opacity">
                    {image.type}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {/* See all link for mobile */}
        <div className="mt-6 text-center md:hidden">
          <Link
            href="/gallery"
            className="inline-flex items-center gap-2 px-6 py-3 bg-stone-900 text-white rounded-full font-medium hover:bg-stone-800 transition-colors"
          >
            <ImageIcon className="w-4 h-4" />
            Explore Full Gallery
          </Link>
        </div>
      </div>
    </section>
  );
}
