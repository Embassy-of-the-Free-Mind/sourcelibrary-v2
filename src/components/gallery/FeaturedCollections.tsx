'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Image as ImageIcon, Layers, ChevronRight } from 'lucide-react';
import { gallery } from '@/lib/api-client';

interface CollectionListItem {
  id: string;
  slug: string;
  title: string;
  description: string;
  imageCount: number;
  featured: boolean;
  coverImage: { url: string; description: string } | null;
}

interface FeaturedCollectionsProps {
  initialCollections?: CollectionListItem[];
}

export default function FeaturedCollections({ initialCollections }: FeaturedCollectionsProps) {
  const [collections, setCollections] = useState<CollectionListItem[]>(initialCollections || []);
  const [loaded, setLoaded] = useState(!!initialCollections);

  useEffect(() => {
    // Skip fetch if we already have server-provided data
    if (initialCollections) return;

    gallery.collections
      .list(true)
      .then((data) => setCollections(data.collections))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [initialCollections]);

  if (!loaded || collections.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-amber-600" />
          <h2 className="text-lg font-serif text-stone-800">Collections</h2>
        </div>
        <Link
          href="/gallery/collections"
          className="flex items-center gap-1 text-sm text-amber-600 hover:text-amber-700 transition-colors"
        >
          View all
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {collections.slice(0, 4).map((collection) => (
          <Link
            key={collection.id}
            href={`/gallery/collections/${collection.slug}`}
            className="group bg-white rounded-lg shadow-sm overflow-hidden hover:shadow-md transition-all hover:-translate-y-0.5"
          >
            <div className="relative aspect-[16/10] bg-stone-100">
              {collection.coverImage?.url ? (
                <Image
                  src={collection.coverImage.url}
                  alt={collection.coverImage.description || collection.title}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                  unoptimized
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-stone-300">
                  <ImageIcon className="w-8 h-8" />
                </div>
              )}
            </div>
            <div className="p-3">
              <h3 className="font-medium text-sm text-stone-800 group-hover:text-amber-700 transition-colors">
                {collection.title}
              </h3>
              <p className="text-xs text-stone-500 line-clamp-1 mt-0.5">
                {collection.description}
              </p>
              <p className="text-xs text-stone-400 mt-1">
                {collection.imageCount} {collection.imageCount === 1 ? 'image' : 'images'}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
