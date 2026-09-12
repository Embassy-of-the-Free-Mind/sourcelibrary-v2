/**
 * PRIOR ART: the "Featured books" band inside `src/app/collections/[id]/page.tsx`
 * is the closest existing thing and its card markup is deliberately mirrored
 * here (same cover ratio, same type ramp, same tokens) — but it renders
 * COLLECTION MEMBERS and assumes a readable book, so it cannot carry a list of
 * unreadable non-members or the second, bookless half. `CollectionAllBooks` is a
 * client component over the paginated catalogue; `CollectionListView` is its
 * table view. Neither renders an authored, ordered list.
 *
 * Further reading — two halves, one band.
 *
 *   1. Works we HOLD that sit next to the collection without belonging to it
 *      (`collections.further_reading`). Adjacent, not member: nothing here
 *      feeds `book_count` or `total_book_count`.
 *   2. Works we do NOT hold (`collections.reading_list_gaps`), named with their
 *      manuscript or edition witnesses — which doubles as a public acquisition
 *      wishlist. That field had been carried on the collection document with
 *      nothing in `src/` reading it (#4653).
 *
 * DESIGN: every value maps to an existing token — the band reuses the warm
 * surface, the hairline divider, the display serif for headings, and the
 * primary/secondary/muted text tokens already used by the sibling bands. No new
 * typefaces, sizes, colours, radii or spacing scales
 * (`.claude/docs/collection-page-redesign-spec.md` §0).
 */

import Link from 'next/link';
import Image from 'next/image';
import { BookOpen } from 'lucide-react';
import { bookTitle } from '@/lib/collections-utils';
import { tenantBookUrl } from '@/lib/slugify';
import {
  furtherReadingStatus,
  type FurtherReadingEntry,
  type ReadingListGap,
} from '@/lib/further-reading';

interface Props {
  books: FurtherReadingEntry[];
  gaps: ReadingListGap[];
  tenantSlug?: string | null;
}

export default function CollectionFurtherReading({ books, gaps, tenantSlug }: Props) {
  if (books.length === 0 && gaps.length === 0) return null;

  return (
    <section id="further-reading" className="border-t border-border-light bg-warm">
      <div className="max-w-[1500px] mx-auto px-6 py-10">
        <h2 className="text-2xl sm:text-3xl text-primary font-display mb-2">
          Further reading
        </h2>
        <p className="text-sm text-secondary leading-relaxed max-w-3xl mb-8">
          Works that sit beside this collection rather than inside it — held here but
          not part of its claim, or not held at all. Nothing below is counted among
          the collection&rsquo;s works.
        </p>

        {books.length > 0 && (
          <div className="mb-10">
            <h3 className="text-lg sm:text-xl text-primary font-display mb-1">
              In the library
            </h3>
            <p className="text-xs text-muted mb-5">
              {books.length.toLocaleString('en-US')} adjacent {books.length === 1 ? 'work' : 'works'} we
              hold. Most are scanned but not yet translated — the page images and
              whatever has been transcribed are readable now.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-5">
              {books.map((b) => {
                const status = furtherReadingStatus(b);
                return (
                  <Link
                    key={b.id}
                    href={tenantBookUrl({ id: b.id, slug: b.slug }, tenantSlug)}
                    className="group block"
                  >
                    <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-white shadow-sm group-hover:shadow-md transition-shadow mb-2">
                      {b.thumbnail ? (
                        <Image
                          src={b.thumbnail}
                          alt={bookTitle(b)}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          sizes="(min-width: 1024px) 280px, (min-width: 640px) 30vw, 45vw"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <BookOpen className="w-8 h-8 text-muted" />
                        </div>
                      )}
                    </div>
                    <h4 className="text-sm font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug">
                      {bookTitle(b)}
                    </h4>
                    {(b.author || b.year || b.published) && (
                      <p className="text-xs text-muted line-clamp-1 mt-0.5">
                        {[b.author, b.year || (b.published !== 'Unknown' ? b.published : undefined)]
                          .filter(Boolean).join(', ')}
                      </p>
                    )}
                    {b.note && (
                      <p className="text-xs text-secondary leading-relaxed line-clamp-2 mt-1">
                        {b.note}
                      </p>
                    )}
                    {/* Readability, stated rather than implied. A book with no
                        translated pages says so — see furtherReadingStatus. */}
                    <p className="text-xs text-muted mt-1">
                      {[b.language, b.pages_count ? `${b.pages_count.toLocaleString('en-US')} pp` : null]
                        .filter(Boolean).join(' · ')}
                      {b.language || b.pages_count ? ' · ' : ''}
                      <span className={status.readable ? 'text-accent-gold-dark' : undefined}>
                        {status.label}
                      </span>
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {gaps.length > 0 && (
          <div>
            <h3 className="text-lg sm:text-xl text-primary font-display mb-1">
              Not yet in the library
            </h3>
            <p className="text-xs text-muted mb-5">
              Works this collection wants and does not hold, with the witnesses a
              digitisation would come from. If you can point us at a scan of one of
              these,{' '}
              <Link href="/feedback" className="text-accent-rust hover:underline">
                tell us
              </Link>
              .
            </p>
            <ul className="divide-y divide-border-light border-y border-border-light">
              {gaps.map((g, i) => (
                <li key={g.n || `${i}-${g.want}`} className="py-3 flex gap-3">
                  {g.n && (
                    <span className="text-xs text-muted tabular-nums pt-0.5 w-10 flex-shrink-0">
                      {g.n}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p
                      className="text-sm text-primary leading-snug"
                      style={{ fontFamily: 'var(--font-serif)' }}
                    >
                      {g.want}
                    </p>
                    {g.witnesses && (
                      <p className="text-xs text-muted leading-relaxed mt-0.5">
                        {g.witnesses}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
