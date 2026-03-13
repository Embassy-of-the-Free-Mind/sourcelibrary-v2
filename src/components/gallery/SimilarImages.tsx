'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Loader2 } from 'lucide-react';

interface SimilarItem {
  pageId: string;
  bookId: string;
  detectionIndex: number;
  imageUrl: string;
  bookTitle: string;
  description: string;
  type?: string;
  extractedUrl?: string;
  thumbnailUrl?: string;
  similarity?: number;
}

interface SimilarImagesProps {
  imageId: string; // pageId-detectionIndex
}

export default function SimilarImages({ imageId }: SimilarImagesProps) {
  const [items, setItems] = useState<SimilarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    async function fetchSimilar() {
      try {
        const res = await fetch(`/api/gallery/similar?id=${encodeURIComponent(imageId)}&limit=3`);
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        if (!cancelled) {
          setItems(data.items || []);
          setMethod(data.method || '');
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSimilar();
    return () => { cancelled = true; };
  }, [imageId]);

  if (loading) {
    return (
      <div className="bg-stone-800 rounded-lg p-5">
        <h3 className="text-base font-medium text-stone-300 mb-3">Related images</h3>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-stone-500" />
        </div>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="bg-stone-800 rounded-lg p-5">
      <h3 className="text-base font-medium text-stone-300 mb-3">
        Related images
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => {
          const id = `${item.pageId}-${item.detectionIndex}`;
          const imgSrc = item.thumbnailUrl || item.extractedUrl || item.imageUrl;

          return (
            <Link
              key={id}
              href={`/gallery/image/${id}`}
              className="group relative aspect-square bg-stone-700 rounded overflow-hidden"
              title={item.description}
            >
              <Image
                src={imgSrc}
                alt={item.description}
                fill
                sizes="100px"
                className="object-cover group-hover:scale-105 transition-transform duration-200"
                unoptimized
              />
              {item.type && (
                <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[10px] text-stone-300 px-1 py-0.5 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                  {item.type}
                </span>
              )}
            </Link>
          );
        })}
      </div>
      {method === 'embedding' && (
        <p className="text-[10px] text-stone-600 mt-2">AI similarity</p>
      )}
    </div>
  );
}
