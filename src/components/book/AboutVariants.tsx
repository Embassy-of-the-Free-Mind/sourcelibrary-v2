'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import type { Page } from '@/lib/types';
import BookAboutPicker from './BookAboutPicker';

type Visual = { src: string; href: string; caption?: string };
type PlateLite = { id: string; thumbnail_url?: string; extracted_url?: string; image_url?: string; description?: string };

/**
 * "About this book" section: an eyebrow title over serif prose on the cream
 * background, an interesting page / plate beside it (desktop only), the subject
 * tags below, and the reading-guide / contents dropdowns under that.
 */
export default function AboutVariants({
  heading = 'About this book',
  content,
  visual,
  tags = [],
  belowContent,
  bookId,
  bookSlug,
  pages,
  plates,
}: {
  /** Section heading — localized by the page (see src/lib/book-i18n.ts). */
  heading?: string;
  /** About prose. When null, the heading + prose are omitted and only the
   *  dropdowns render in the left column (the plate still shows on the right). */
  content?: ReactNode | null;
  visual?: Visual | null;
  tags?: string[];
  /** Reading guide / Contents / etc. dropdowns, rendered under the text+tags. */
  belowContent?: ReactNode;
  /** When provided, editors (inner_circle) can change the side visual. */
  bookId?: string;
  bookSlug?: string;
  pages?: Page[];
  plates?: PlateLite[];
}) {
  const tagRow = tags.length > 0 ? (
    <div className="flex flex-wrap gap-1.5 md:gap-2 mt-6 md:mt-8">
      {tags.map((tag) => (
        <Link key={tag} href={`/search?q=${encodeURIComponent(tag)}`} className="text-[11px] md:text-[13px] px-2 py-0.5 md:px-3 md:py-1 transition-colors hover:bg-[#f0eadd]" style={{ border: '1px solid #ddd5c5', color: '#5c5546' }}>{tag}</Link>
      ))}
    </div>
  ) : null;

  return (
    <section id="about" className="relative pt-12 md:pt-16 pb-10 md:pb-14 scroll-mt-4" style={{ background: 'linear-gradient(180deg, #fdfcf9 0%, #f8f2ea 100%)' }}>
      <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12">
        <div className={visual ? 'grid md:grid-cols-5 gap-10 md:gap-12 items-start' : ''}>
          {/* Text + tags + dropdowns: 3/5 on desktop (below the plate on mobile) */}
          <div className="order-2 md:order-1 md:col-span-3">
            {content != null && (
              <>
                <h2 className="hidden md:block font-display font-medium text-[22px] md:text-[28px] mb-3 md:mb-4" style={{ color: '#2b2620' }}>{heading}</h2>
                <div className="font-display text-[15px] md:text-[21px] leading-[1.6] md:leading-[1.62]" style={{ color: '#2b2620' }}>{content}</div>
                {tagRow}
              </>
            )}
            {belowContent && <div className={`${content != null ? 'mt-6 md:mt-8' : ''} space-y-3 md:space-y-6`}>{belowContent}</div>}
          </div>
          {/* Interesting page / plate: desktop only (hidden on mobile), 2/5 wide.
              No shadow — sits flush on the cream background. */}
          {visual && (() => {
            const visualEl = (
              <Link href={visual.href} className="block group">
                <div className="overflow-hidden border" style={{ borderColor: '#e6e0d3', background: '#fff' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={visual.src} alt={visual.caption || ''} className="w-full h-auto object-contain transition-transform duration-500 group-hover:scale-[1.02]" loading="lazy" />
                </div>
                {visual.caption && <div className="mt-3 text-[13px] italic" style={{ color: '#948d80' }}>{visual.caption}</div>}
              </Link>
            );
            return (
              <div className="hidden md:block order-1 md:order-2 md:col-span-2">
                {bookId ? (
                  <BookAboutPicker bookId={bookId} bookSlug={bookSlug ?? ''} pages={pages ?? []} plates={plates ?? []} currentSrc={visual.src}>
                    {visualEl}
                  </BookAboutPicker>
                ) : visualEl}
              </div>
            );
          })()}
        </div>
      </div>
    </section>
  );
}
