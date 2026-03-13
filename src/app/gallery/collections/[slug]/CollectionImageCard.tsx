'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Image as ImageIcon } from 'lucide-react';
import LikeButton from '@/components/ui/LikeButton';

export interface CollectionImageProps {
  id: string;
  imageUrl: string;
  bookTitle: string;
  description: string;
  type?: string;
  thumbnailUrl?: string;
  extractedUrl?: string;
  galleryQuality?: number;
}

export default function CollectionImageCard({ item }: { item: CollectionImageProps }) {
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
            <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] bg-accent-gold/80 text-white">
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
