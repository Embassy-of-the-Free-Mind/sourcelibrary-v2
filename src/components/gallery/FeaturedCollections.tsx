'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Image as ImageIcon, ArrowRight } from 'lucide-react';
import { gallery } from '@/lib/api-client';

const MAX_SHOWN = 11;

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
    if (initialCollections) return;

    gallery.collections
      .list()
      .then((data) => setCollections(data.collections))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [initialCollections]);

  if (!loaded || collections.length === 0) return null;

  const shown = collections.slice(0, MAX_SHOWN);
  const hasMore = collections.length > MAX_SHOWN;

  return (
    <div className="mb-10">
      <h2 className="text-2xl font-serif text-stone-800 mb-1">Collections</h2>
      <p className="text-stone-500 text-base mb-5">Curated selections of illustrations from rare alchemical, Hermetic, and philosophical manuscripts.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {shown.map((collection) => (
          <Link
            key={collection.id}
            href={`/gallery/collections/${collection.slug}`}
            className="group relative rounded-xl overflow-hidden hover:shadow-md transition-all hover:-translate-y-0.5 aspect-[4/3]"
          >
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
              <div className="absolute inset-0 bg-stone-200 flex items-center justify-center text-stone-400">
                <ImageIcon className="w-8 h-8" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-4">
              <h3 className="font-serif text-xl text-white group-hover:text-accent-gold transition-colors">
                {collection.title}
              </h3>
              <p className="text-white/60 text-sm mt-1">
                {collection.imageCount} {collection.imageCount === 1 ? 'image' : 'images'}
              </p>
            </div>
          </Link>
        ))}

        {hasMore && (
          <Link
            href="/gallery/collections"
            className="group bg-warm rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-all hover:-translate-y-0.5 flex flex-col items-center justify-center"
          >
            <div className="flex flex-col items-center justify-center gap-3 p-8 text-center h-full">
              <div className="w-12 h-12 rounded-full bg-accent-rust/10 flex items-center justify-center group-hover:bg-accent-rust/20 transition-colors">
                <ArrowRight className="w-5 h-5 text-accent-rust" />
              </div>
              <h3 className="font-serif text-lg text-stone-800 group-hover:text-accent-rust transition-colors">
                See all collections
              </h3>
              <p className="text-stone-500 text-sm">
                {collections.length - MAX_SHOWN} more to explore
              </p>
            </div>
          </Link>
        )}
      </div>
    </div>
  );
}
