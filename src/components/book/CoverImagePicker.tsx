'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { BookOpen, X, Check, Loader2, Pencil } from 'lucide-react';
import { books } from '@/lib/api-client';
import type { Page } from '@/lib/types';
import { buildCoverUpdate } from '@/lib/cover-fields';
import { getPageImageUrl } from '@/lib/page-image-url';
import { AuthCheck } from '../auth/AuthCheck';
import { useEmbed } from '@/lib/EmbedContext';
import PlaceholderCover from '@/components/book/PlaceholderCover';

interface CoverImagePickerProps {
  bookId: string;
  currentThumbnail?: string;
  currentThumbnailBlob?: string;
  bookTitle: string;
  /** Byline + year, used by the generated placeholder cover when there is no
   *  thumbnail. Optional — the placeholder omits each line when absent. */
  bookAuthor?: string | null;
  bookYear?: string | number | null;
  pages: Page[];
  /** Optional custom cover element to render in place of the built-in
   *  thumbnail (e.g. the large hero cover). Editors get a "Change cover"
   *  hover affordance over it; everyone else sees it plain. */
  trigger?: ReactNode;
}

export default function CoverImagePicker({ bookId, currentThumbnail, currentThumbnailBlob, bookTitle, bookAuthor, bookYear, pages, trigger }: CoverImagePickerProps) {
  const router = useRouter();
  // Placeholder cover is an embedded-reading-room feature; the main site keeps
  // the plain icon fallback.
  const embed = useEmbed();
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [displayThumbnail, setDisplayThumbnail] = useState(currentThumbnail || currentThumbnailBlob);
  const [thumbnailError, setThumbnailError] = useState(false);

  // If the primary thumbnail fails, fall back to thumbnail_blob
  const handleThumbnailError = () => {
    if (!thumbnailError && currentThumbnailBlob && displayThumbnail !== currentThumbnailBlob) {
      setDisplayThumbnail(currentThumbnailBlob);
      setThumbnailError(true);
    } else {
      setThumbnailError(true);
    }
  };

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

  const selectCover = async (page: Page) => {
    setSaving(page.id);
    setSaveError(null);
    try {
      const update = buildCoverUpdate(page, {
        source: 'manual',
        actor: 'admin',
        method: 'cover-picker-ui',
        confidence: 1,
      });
      if (!update) {
        console.error('Cover Picker: page has no usable image URL', page);
        setSaveError('That page has no usable image to use as a cover.');
        return;
      }
      await books.update(bookId, update as unknown as Record<string, unknown>);
      setDisplayThumbnail(update.image_display);
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      // Surface the failure instead of silently doing nothing — the picker used
      // to swallow every error, which is how a failed save read as "changing the
      // cover isn't working" with no clue why.
      console.error('Error setting cover:', error);
      setSaveError(error instanceof Error ? error.message : 'Could not save the cover. Please try again.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      {/* Cover — editors (inner_circle) can click to change it; everyone else
          sees it plain. When `trigger` is provided (e.g. the hero cover), it
          renders in place of the built-in thumbnail. */}
      <AuthCheck
        role="inner_circle"
        fallback={
          trigger ?? (
            // Non-authenticated users see the cover image but cannot click
            <div className="w-32 sm:w-48 aspect-[3/4] relative rounded-lg overflow-hidden shadow-xl bg-stone-700">
              {displayThumbnail && !thumbnailError ? (
                <Image src={displayThumbnail} alt={bookTitle} fill className="object-cover" sizes="(max-width: 640px) 128px, 192px" priority onError={handleThumbnailError} />
              ) : embed ? (
                <PlaceholderCover title={bookTitle} author={bookAuthor} year={bookYear} />
              ) : (
                <div className="w-full h-full flex items-center justify-center"><BookOpen className="w-12 sm:w-16 h-12 sm:h-16 text-stone-500" /></div>
              )}
            </div>
          )
        }
      >
        {trigger ? (
          /* Custom trigger (hero cover): overlay a "Change cover" affordance */
          <button
            onClick={() => setIsOpen(true)}
            className="group relative block w-full cursor-pointer text-left"
            title="Change cover image"
          >
            {trigger}
            <span
              className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 py-2.5 text-[12.5px] font-semibold text-white opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.78), transparent)' }}
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Change cover
            </span>
          </button>
        ) : (
          /* Built-in clickable thumbnail for authenticated users */
          <button
            onClick={() => setIsOpen(true)}
            className="w-32 sm:w-48 aspect-[3/4] relative rounded-lg overflow-hidden shadow-xl bg-stone-700 cursor-pointer group"
            title="Click to change cover image"
          >
            {displayThumbnail && !thumbnailError ? (
              <Image src={displayThumbnail} alt={bookTitle} fill className="object-cover group-hover:opacity-80 transition-opacity" sizes="(max-width: 640px) 128px, 192px" priority onError={handleThumbnailError} />
            ) : embed ? (
              <PlaceholderCover title={bookTitle} author={bookAuthor} year={bookYear} />
            ) : (
              <div className="w-full h-full flex items-center justify-center group-hover:bg-stone-600 transition-colors"><BookOpen className="w-12 sm:w-16 h-12 sm:h-16 text-stone-500" /></div>
            )}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
              <span className="text-white text-sm font-medium px-2 py-1 bg-black/50 rounded">Change Cover</span>
            </div>
          </button>
        )}
      </AuthCheck>

      {/* Picker Modal - Only rendered for authenticated users */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
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

            {saveError && (
              <div role="alert" className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {saveError}
              </div>
            )}

            {/* Pages Grid */}
            <div className="p-4 overflow-y-auto max-h-[calc(85vh-80px)]">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {pages.map((page) => {
                  // Canonical resolver: always a size-bounded thumbnail (pre-sized
                  // R2 variant, IIIF resize, or /api/image proxy) — never the raw
                  // full-res scan. Fixes the picker loading multi-MB images per cell.
                  const imageUrl = getPageImageUrl(page, 'thumb');
                  const typedPage = page as Page & { archived_photo?: string };
                  const baseUrl = typedPage.archived_photo || page.photo_original || page.photo;
                  const isCurrentCover = currentThumbnail?.includes(encodeURIComponent(baseUrl));
                  const isSaving = saving === page.id;

                  return (
                    <button
                      key={page.id}
                      onClick={() => selectCover(page)}
                      disabled={isSaving}
                      className={`relative aspect-[3/4] rounded-lg overflow-hidden border-2 bg-stone-100 transition-all hover:shadow-lg ${isCurrentCover
                        ? 'border-accent-gold ring-2 ring-accent-gold/25'
                        : 'border-stone-200 hover:border-stone-400'
                        }`}
                    >
                      {imageUrl && (
                        <img
                          src={imageUrl}
                          alt={`Page ${page.page_number}`}
                          className="w-full h-full object-contain"
                          loading="lazy"
                          decoding="async"
                        />
                      )}
                      {isCurrentCover && (
                        <div className="absolute top-1 right-1 p-0.5 bg-accent-gold/80 rounded-full">
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
