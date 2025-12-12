'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Book as BookIcon } from 'lucide-react';
import type { Book } from '@/lib/types';

interface BookCardProps {
  book: Book;
}

export default function BookCard({ book }: BookCardProps) {
  return (
    <Link href={`/book/${book.id}`} className="group">
      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow duration-200">
        <div className="aspect-[3/4] relative bg-stone-100">
          {book.thumbnail ? (
            <Image
              src={book.thumbnail}
              alt={book.title}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-200"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <BookIcon className="w-16 h-16 text-stone-300" />
            </div>
          )}
        </div>
        <div className="p-4">
          <h3 className="font-serif font-semibold text-stone-900 line-clamp-2 group-hover:text-amber-700 transition-colors">
            {book.display_title || book.title}
          </h3>
          <p className="text-sm text-stone-600 mt-1">{book.author}</p>
          <div className="flex items-center gap-2 mt-2 text-xs text-stone-500">
            <span className="px-2 py-0.5 bg-stone-100 rounded">{book.language}</span>
            {book.published && <span>{book.published}</span>}
            {book.pages_count !== undefined && (
              <span>{book.pages_count} pages</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
