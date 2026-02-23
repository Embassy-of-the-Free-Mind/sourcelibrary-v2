'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Image as ImageIcon, Layers } from 'lucide-react';
import { gallery } from '@/lib/api-client';
import { BookLoader } from '@/components/ui/BookLoader';

interface CollectionListItem {
  id: string;
  slug: string;
  title: string;
  description: string;
  imageCount: number;
  featured: boolean;
  coverImage: { url: string; description: string } | null;
}

export default function CollectionsPage() {
  const [collections, setCollections] = useState<CollectionListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCollections() {
      try {
        const data = await gallery.collections.list();
        setCollections(data.collections);
      } catch (e) {
        console.error('Failed to load collections:', e);
      } finally {
        setLoading(false);
      }
    }
    fetchCollections();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      {/* Header */}
      <header className="bg-stone-900 text-white py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <Link href="/gallery" className="flex items-center gap-2 text-stone-400 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
              <span>Gallery</span>
            </Link>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <h1 className="text-lg font-serif">Collections</h1>
                <p className="text-stone-400 text-xs">
                  {collections.length} curated collections
                </p>
              </div>
              <Layers className="w-6 h-6 text-amber-500" />
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Intro */}
        <div className="text-center mb-10">
          <h2 className="text-2xl font-serif text-stone-800 mb-2">Curated Image Collections</h2>
          <p className="text-stone-500 max-w-2xl mx-auto">
            Thematic collections of illustrations drawn from rare alchemical, Hermetic, and philosophical manuscripts.
          </p>
        </div>

        {loading && (
          <div className="py-20">
            <BookLoader size="xs" />
          </div>
        )}

        {!loading && collections.length === 0 && (
          <div className="text-center py-20">
            <Layers className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <p className="text-stone-500">No collections yet.</p>
          </div>
        )}

        {!loading && collections.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {collections.map((collection) => (
              <Link
                key={collection.id}
                href={`/gallery/collections/${collection.slug}`}
                className="group bg-white rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-all hover:-translate-y-0.5"
              >
                {/* Cover image */}
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
                      <ImageIcon className="w-12 h-12" />
                    </div>
                  )}
                  {collection.featured && (
                    <span className="absolute top-3 left-3 px-2 py-0.5 bg-amber-600 text-white text-xs rounded-full">
                      Featured
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="p-4">
                  <h3 className="font-serif text-lg text-stone-800 group-hover:text-amber-700 transition-colors">
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
        )}
      </div>
    </div>
  );
}
