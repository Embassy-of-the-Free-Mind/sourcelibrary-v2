'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Image as ImageIcon, Layers } from 'lucide-react';
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
      .list()
      .then((data) => setCollections(data.collections))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [initialCollections]);

  if (!loaded || collections.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Layers className="w-5 h-5 text-accent-rust" />
        <h2 className="text-lg font-serif text-stone-800">Collections</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {collections.map((collection) => (
          <Link
            key={collection.id}
            href={`/gallery/collections/${collection.slug}`}
            className="group bg-white rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-all hover:-translate-y-0.5"
          >
            <div className="relative aspect-[16/10] bg-stone-100">
              {collection.coverImage?.url ? (
                <Image
                  src={collection.coverImage.url}
                  alt={collection.coverImage.description || collection.title}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  unoptimized
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-stone-300">
                  <ImageIcon className="w-8 h-8" />
                </div>
              )}
              {collection.featured && (
                <span className="absolute top-3 left-3 px-2 py-0.5 bg-accent-rust text-white text-xs rounded-full">
                  Featured
                </span>
              )}
            </div>
            <div className="p-4">
              <h3 className="font-serif text-lg text-stone-800 group-hover:text-accent-rust transition-colors">
                {collection.title}
              </h3>
              <p className="text-stone-500 text-sm mt-1 line-clamp-2">
                {collection.description}
              </p>
              <p className="text-stone-400 text-xs mt-3">
                {collection.imageCount} {collection.imageCount === 1 ? 'image' : 'images'}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
