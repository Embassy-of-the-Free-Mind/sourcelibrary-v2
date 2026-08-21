'use client';

import HorizontalSlider from '@/components/HorizontalSlider';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import type { Locale } from '@/lib/i18n';

export interface MiniBook {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  year?: number;
  language?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  is_first_translation?: boolean;
  ft_disposition?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  image_display?: string;
  image_thumb?: string;
  /** Optional full link target (e.g. straight into the Spanish reader); defaults to the book page. */
  href?: string;
}

/**
 * Book-cover slider: desktop 5-up / tablet 3-up / mobile ~1.5, built on the
 * shared HorizontalSlider. Extracted from the Mycology "First translations"
 * band so it can be reused on the homepage and beyond.
 */
export default function BookSlider({ books, lang = 'en', hideStatus = false }: { books: MiniBook[]; lang?: Locale; hideStatus?: boolean }) {
  return (
    <HorizontalSlider ariaLabel="books">
      {books.map((b) => (
        <div
          key={b.id}
          data-card
          className="snap-start shrink-0 basis-[66%] sm:basis-[calc((100%-2rem)/3)] lg:basis-[calc((100%-4rem)/5)]"
        >
          <CollectionBookCard book={b as unknown as CollectionBook} lang={lang} href={b.href} hideStatus={hideStatus} />
        </div>
      ))}
    </HorizontalSlider>
  );
}
