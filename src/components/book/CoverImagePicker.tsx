'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { BookOpen, X, Check, Loader2 } from 'lucide-react';
import { books } from '@/lib/api-client';
import type { Page } from '@/lib/types';

interface CoverImagePickerProps {
  bookId: string;
  currentThumbnail?: string;
  bookTitle: string;
  pages: Page[];
}

export default function CoverImagePicker({ bookId, currentThumbnail, bookTitle, pages }: CoverImagePickerProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  // Handle Escape key to close
  const handleClose = useCallback(() => setIsOpen(false), []);
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  const getPageImageUrl = (page: Page, width: number = 150) => {
    // Priority: archived_photo > photo_original > photo (same as utils.ts)
    const typedPage = page as Page & { archived_photo?: string };
    const baseUrl = typedPage.archived_photo || page.photo_original || page.photo;
    if (!baseUrl) return null;
    if (page.crop?.xStart !== undefined && page.crop?.xEnd !== undefined) {
      return `/api/image?url=${encodeURIComponent(baseUrl)}&w=${width}&q=60&cx=${page.crop.xStart}&cw=${page.crop.xEnd}`;
    }
    return `/api/image?url=${encodeURIComponent(baseUrl)}&w=${width}&q=60`;
  };

  const selectCover = async (page: Page) => {
    setSaving(page.id);
    try {
      const thumbnailUrl = getPageImageUrl(page, 400);

      await books.update(bookId, { thumbnail: thumbnailUrl });
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      console.error('Error setting cover:', error);
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      {/* Clickable Cover Image */}
      <button
        onClick={() => setIsOpen(true)}
        className="w-32 sm:w-48 aspect-[3/4] relative rounded-lg overflow-hidden shadow-xl bg-stone-700 cursor-pointer group"
        title="Click to change cover image"
      >
        {currentThumbnail ? (
          <Image
            src={currentThumbnail}
            alt={bookTitle}
            fill
            className="object-cover group-hover:opacity-80 transition-opacity"
            sizes="(max-width: 640px) 128px, 192px"
            priority
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center group-hover:bg-stone-600 transition-colors">
            <BookOpen className="w-12 sm:w-16 h-12 sm:h-16 text-stone-500" />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
          <span className="text-white text-sm font-medium px-2 py-1 bg-black/50 rounded">
            Change Cover
          </span>
        </div>
      </button>

      {/* Picker Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cover-picker-title"
            className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[85vh] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-stone-200">
              <h2 id="cover-picker-title" className="text-lg font-semibold text-stone-900">Choose Cover Image</h2>
              <button
                onClick={handleClose}
                aria-label="Close dialog"
                className="p-1 text-stone-400 hover:text-stone-600 rounded"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {/* Pages Grid */}
            <div className="p-4 overflow-y-auto max-h-[calc(85vh-80px)]">
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
                {pages.map((page) => {
                  const imageUrl = getPageImageUrl(page);
                  const typedPage = page as Page & { archived_photo?: string };
                  const baseUrl = typedPage.archived_photo || page.photo_original || page.photo;
                  const isCurrentCover = currentThumbnail?.includes(encodeURIComponent(baseUrl));
                  const isSaving = saving === page.id;

                  return (
                    <button
                      key={page.id}
                      onClick={() => selectCover(page)}
                      disabled={isSaving}
                      className={`relative aspect-[3/4] rounded-lg overflow-hidden border-2 transition-all hover:shadow-lg ${
                        isCurrentCover
                          ? 'border-amber-500 ring-2 ring-amber-200'
                          : 'border-stone-200 hover:border-stone-400'
                      }`}
                    >
                      {imageUrl && (
                        <img
                          src={imageUrl}
                          alt={`Page ${page.page_number}`}
                          className="w-full h-full object-cover"
                        />
                      )}
                      {isCurrentCover && (
                        <div className="absolute top-1 right-1 p-0.5 bg-amber-500 rounded-full">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                      {isSaving && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <Loader2 className="w-6 h-6 text-white animate-spin" />
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1">
                        <span className="text-[10px] text-white">{page.page_number}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {pages.length === 0 && (
                <div className="text-center py-12 text-stone-500">
                  No pages available
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
