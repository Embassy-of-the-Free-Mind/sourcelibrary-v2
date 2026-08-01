'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { X, Pencil, Loader2, Check } from 'lucide-react';
import { books } from '@/lib/api-client';
import type { Page } from '@/lib/types';
import { getPageImageUrl } from '@/lib/page-image-url';
import { AuthCheck } from '../auth/AuthCheck';

/** Minimal shape of a gallery plate, as prepared on the book page. */
interface PlateLite {
  id: string;
  thumbnail_url?: string;
  extracted_url?: string;
  image_url?: string;
  description?: string;
}

interface BookAboutPickerProps {
  bookId: string;
  bookSlug: string;
  pages: Page[];
  plates: PlateLite[];
  /** Current About visual src, so it can be flagged as selected. */
  currentSrc?: string;
  /** The visual element to overlay the "Change plate" affordance on. */
  children: ReactNode;
}

type Choice = { src: string; href: string; caption?: string };

/**
 * Editor (inner_circle) affordance to change the book page's About side visual.
 * Non-editors just see `children`. Editors get a "Change plate" overlay that
 * opens a picker of the book's illustrations (plates) and pages; choosing one
 * writes `about_visual` on the book (overriding the auto-picked representative
 * plate) and refreshes.
 */
export default function BookAboutPicker({ bookId, bookSlug, pages, plates, currentSrc, children }: BookAboutPickerProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleClose = useCallback(() => setIsOpen(false), []);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, handleClose]);

  const save = async (key: string, choice: Choice) => {
    setSaving(key);
    setSaveError(null);
    try {
      await books.update(bookId, { about_visual: choice } as unknown as Record<string, unknown>);
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      console.error('Error setting About visual:', error);
      setSaveError(error instanceof Error ? error.message : 'Could not save. Please try again.');
    } finally {
      setSaving(null);
    }
  };

  const plateHref = (p: PlateLite) => {
    const pageId = p.id.match(/^(.+)[:\-]\d+$/)?.[1];
    return pageId ? `/book/${bookSlug}/page/${pageId}` : `/gallery/image/${p.id}`;
  };

  const Cell = ({ k, src, thumb, label, choice }: { k: string; src: string; thumb: string; label: string; choice: Choice }) => (
    <button
      onClick={() => save(k, choice)}
      disabled={saving === k}
      className={`relative aspect-[3/4] overflow-hidden border-2 bg-stone-100 transition-all hover:shadow-lg ${
        currentSrc && src === currentSrc ? 'border-accent-gold ring-2 ring-accent-gold/25' : 'border-stone-200 hover:border-stone-400'
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={thumb} alt={label} className="w-full h-full object-contain" loading="lazy" decoding="async" />
      {currentSrc && src === currentSrc && (
        <div className="absolute top-1 right-1 p-0.5 bg-accent-gold/80 rounded-full"><Check className="w-3 h-3 text-white" /></div>
      )}
      {saving === k && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><Loader2 className="w-6 h-6 text-white animate-spin" /></div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1">
        <span className="text-[10px] text-white">{label}</span>
      </div>
    </button>
  );

  const plateItems = plates
    .map((p) => {
      const src = p.extracted_url || p.image_url || p.thumbnail_url;
      const thumb = p.thumbnail_url || p.image_url || p.extracted_url;
      if (!src || !thumb) return null;
      return { key: `plate:${p.id}`, src, thumb, label: p.description || 'Plate', choice: { src, href: plateHref(p), caption: p.description } as Choice };
    })
    .filter(Boolean) as Array<{ key: string; src: string; thumb: string; label: string; choice: Choice }>;

  const pageItems = pages
    .map((pg) => {
      const src = getPageImageUrl(pg as Parameters<typeof getPageImageUrl>[0], 'display');
      const thumb = getPageImageUrl(pg as Parameters<typeof getPageImageUrl>[0], 'thumb');
      if (!src || !thumb) return null;
      return { key: `page:${pg.id}`, src, thumb, label: pg.page_number != null ? `p. ${pg.page_number}` : 'Page', choice: { src, href: `/book/${bookSlug}/page/${pg.id}`, caption: pg.page_number != null ? `p. ${pg.page_number}` : undefined } as Choice };
    })
    .filter(Boolean) as Array<{ key: string; src: string; thumb: string; label: string; choice: Choice }>;

  return (
    <>
      {/* The visual stays navigable for everyone; editors get a corner button
          (not a wrapping button — the visual is an <a>, which can't nest). */}
      <div className="relative group">
        {children}
        <AuthCheck role="inner_circle">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsOpen(true); }}
            className="absolute top-2 right-2 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-white bg-black/65 hover:bg-black/85 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            title="Change the About illustration"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Change plate
          </button>
        </AuthCheck>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div role="dialog" aria-modal="true" aria-labelledby="about-picker-title" className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[85vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-stone-200">
              <h2 id="about-picker-title" className="text-lg font-semibold text-stone-900">Choose About Illustration</h2>
              <button onClick={handleClose} aria-label="Close dialog" className="p-1 text-stone-400 hover:text-stone-600 rounded"><X className="w-5 h-5" aria-hidden="true" /></button>
            </div>

            {saveError && (
              <div role="alert" className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</div>
            )}

            <div className="p-4 overflow-y-auto max-h-[calc(85vh-80px)] space-y-6">
              {plateItems.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-2">Illustrations &amp; plates</h3>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                    {plateItems.map((it) => <Cell key={it.key} k={it.key} src={it.src} thumb={it.thumb} label={it.label} choice={it.choice} />)}
                  </div>
                </section>
              )}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-2">Pages</h3>
                {pageItems.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                    {pageItems.map((it) => <Cell key={it.key} k={it.key} src={it.src} thumb={it.thumb} label={it.label} choice={it.choice} />)}
                  </div>
                ) : (
                  <div className="text-center py-8 text-stone-500">No pages available</div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
