import Link from 'next/link';
import { getRecentlyTranslatedLinks } from '@/lib/recently-translated-links';
import { bookUrl } from '@/lib/slugify';

/**
 * A compact, server-rendered list of plain links to books recently made readable
 * in English (#3755). The slider and grids on the homepage and collection pages
 * are client-heavy; this is the shelf a crawler (and a skimming reader) sees in
 * the HTML with no JavaScript, and it changes whenever a new translation lands.
 *
 * Async server component — no 'use client', no client fetch. Renders nothing when
 * the query returns nothing.
 */
export default async function RecentlyTranslatedLinks({
  collection,
  excludeIds,
  limit = 48,
  heading = 'Recently translated',
  className = '',
}: {
  collection?: string;
  excludeIds?: Iterable<string>;
  limit?: number;
  heading?: string;
  className?: string;
}) {
  const books = await getRecentlyTranslatedLinks({ collection, excludeIds, limit });
  if (books.length === 0) return null;
  return (
    <section className={className} aria-labelledby="recently-translated-links">
      <h2 id="recently-translated-links" className="text-2xl text-primary font-display mb-4">
        {heading}
      </h2>
      <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
        {books.map((b) => (
          <li key={b.id} className="leading-snug">
            <Link href={bookUrl({ slug: b.slug ?? undefined, id: b.id })} className="text-primary underline-offset-2 hover:underline">
              {b.display_title || b.title}
            </Link>
            {b.author && <span className="text-muted"> — {b.author}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
