'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Image as ImageIcon, Loader2, Layers } from 'lucide-react';
import LikeButton from '@/components/ui/LikeButton';
import { gallery } from '@/lib/api-client';

interface CollectionImage {
  id: string;
  pageId: string;
  bookId: string;
  pageNumber: number;
  detectionIndex: number;
  imageUrl: string;
  bookTitle: string;
  author?: string;
  year?: number;
  description: string;
  type?: string;
  thumbnailUrl?: string;
  extractedUrl?: string;
  galleryQuality?: number;
  museumDescription?: string;
}

interface CollectionDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  featured: boolean;
  imageCount: number;
  items: CollectionImage[];
}

export default function CollectionDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [slug, setSlug] = useState<string | null>(null);
  const [data, setData] = useState<CollectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => setSlug(p.slug));
  }, [params]);

  useEffect(() => {
    if (!slug) return;

    async function fetchCollection() {
      try {
        const json = await gallery.collections.get(slug!);
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load collection');
      } finally {
        setLoading(false);
      }
    }

    fetchCollection();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amber-600 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] flex items-center justify-center">
        <div className="text-center">
          <p className="text-stone-600 text-xl mb-4">{error || 'Collection not found'}</p>
          <Link href="/gallery/collections" className="text-amber-600 hover:text-amber-700">
            Browse all collections
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      {/* Header */}
      <header className="bg-stone-900 text-white py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <Link href="/gallery/collections" className="flex items-center gap-2 text-stone-400 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
              <span>Collections</span>
            </Link>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <h1 className="text-lg font-serif">{data.title}</h1>
                <p className="text-stone-400 text-xs">
                  {data.imageCount} {data.imageCount === 1 ? 'image' : 'images'}
                </p>
              </div>
              <Layers className="w-6 h-6 text-amber-500" />
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Collection description */}
        <div className="mb-8">
          <p className="text-stone-600 max-w-3xl">{data.description}</p>
        </div>

        {/* Image grid */}
        {data.items.length === 0 ? (
          <div className="text-center py-20">
            <ImageIcon className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <p className="text-stone-500">This collection is empty.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {data.items.map((item) => (
              <CollectionImageCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CollectionImageCard({ item }: { item: CollectionImage }) {
  const [imageError, setImageError] = useState(false);
  const displayUrl = item.thumbnailUrl || item.extractedUrl || item.imageUrl;

  return (
    <div className="relative group bg-white rounded-lg shadow-sm overflow-hidden hover:shadow-md transition-all hover:-translate-y-0.5">
      <Link href={`/gallery/image/${item.id}`}>
        <div className="relative aspect-square bg-stone-100">
          {!imageError ? (
            <Image
              src={displayUrl}
              alt={item.description}
              fill
              className="object-contain group-hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 16vw"
              onError={() => setImageError(true)}
              unoptimized
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-stone-300">
              <ImageIcon className="w-8 h-8" />
            </div>
          )}

          {item.type && (
            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] bg-black/60 text-white capitalize">
              {item.type}
            </span>
          )}

          {item.galleryQuality && item.galleryQuality >= 0.9 && (
            <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500 text-white">
              ★
            </span>
          )}
        </div>

        <div className="p-2">
          <p className="text-xs text-stone-700 line-clamp-2 mb-1" title={item.description}>
            {item.description}
          </p>
          <p className="text-[10px] text-stone-400 line-clamp-1">
            {item.bookTitle}
          </p>
        </div>
      </Link>

      <div className="absolute top-1.5 left-1.5 z-10">
        <div className="flex items-center bg-white/90 backdrop-blur-sm rounded-full shadow-sm hover:bg-white transition-colors px-1.5 py-0.5">
          <LikeButton
            targetType="image"
            targetId={item.id}
            size="sm"
            showCount={true}
          />
        </div>
      </div>
    </div>
  );
}
