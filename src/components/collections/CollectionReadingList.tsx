/**
 * PRIOR ART: `CollectionFurtherReading.tsx` is the nearest band — an authored,
 * ordered list rendered with the page's own tokens — and its "Not yet in the
 * library" half is the ancestor of the gap rows here. It cannot carry this
 * because its unit is a book (a cover card) while a reading list's unit is a
 * WORK with several witnesses under it, each needing to say what it is (the
 * manuscript named, a fallback, another edition). The "Featured books" band on
 * the page is a cover grid over members and says nothing about why they are
 * there.
 *
 * The reading list — the spine of a commissioned collection, rendered as the
 * checklist the person who wrote it will read it as.
 *
 * WHO IS IN FRONT OF IT: a scholar, seated, arriving with the list in their
 * head. They read every row and want one answer each: is it here, and in what
 * form. So the row leads with the work, states what was asked for, and then
 * names each held witness with a plain word for what it is. No cover grid:
 * this is read, not browsed.
 *
 * Nothing here feeds a counter. The rows' books are members (they are counted
 * in the works grid below); the band only explains which members were the
 * point.
 *
 * DESIGN: every value maps to an existing token — the warm surface, hairline
 * dividers, the display serif, primary/secondary/muted text, the accent-rust
 * badge already used for "First Translation" on this page, and the
 * accent-gold-dark word the Further-reading cards use for a readable book
 * (`.claude/docs/collection-page-redesign-spec.md` §0). No new primitives.
 */

import Link from 'next/link';
import { tenantBookUrl } from '@/lib/slugify';
import { READING_LIST_MATCH_LABEL, type ReadingListRow } from '@/lib/reading-list';

interface Props {
  rows: ReadingListRow[];
  tenantSlug?: string | null;
}

export default function CollectionReadingList({ rows, tenantSlug }: Props) {
  if (rows.length === 0) return null;

  return (
    <section id="reading-list" className="bg-warm border-b border-border-light">
      <div className="max-w-[1500px] mx-auto px-6 py-10">
        <h2 className="text-2xl sm:text-3xl text-primary font-display mb-2">
          The reading list
        </h2>
        <p className="text-sm text-secondary leading-relaxed max-w-3xl mb-6">
          {rows.length === 13 ? 'Thirteen' : rows.length.toLocaleString('en-US')} works this
          collection was built around, and the witnesses asked for. Everything else on
          this page is related work we hold.
        </p>

        <ol className="divide-y divide-border-light border-y border-border-light max-w-5xl">
          {rows.map((row, i) => (
            <li key={row.n || `${i}-${row.work}`} className="py-4 flex gap-4">
              <span className="text-xs text-muted font-medium w-8 shrink-0 pt-1 tabular-nums">
                {row.n || i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base text-primary font-display leading-snug">
                  {row.work}
                </p>
                {row.wanted && (
                  <p className="text-xs text-muted mt-0.5">
                    Asked for: {row.wanted}
                  </p>
                )}

                {row.state === 'held' && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {row.witnesses.map((w) => (
                      <li key={w.book_id} className="text-sm leading-snug">
                        <Link
                          href={tenantBookUrl({ id: w.book.id, slug: w.book.slug }, tenantSlug)}
                          className="text-accent-rust hover:underline"
                        >
                          {w.witness || w.book.display_title || w.book.title}
                        </Link>
                        <span className="inline-block ml-2 align-middle text-[9px] font-medium bg-accent-rust/10 text-accent-rust px-1 py-0.5 rounded">
                          {READING_LIST_MATCH_LABEL[w.match]}
                        </span>
                        {/* Readability, stated rather than implied — the same
                            word the Further-reading cards use. */}
                        <span className={`ml-2 text-xs ${w.status.readable ? 'text-accent-gold-dark' : 'text-muted'}`}>
                          {w.status.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {row.state === 'preparing' && (
                  <p className="text-sm text-muted mt-2">
                    Acquired &mdash; being prepared.
                  </p>
                )}

                {row.state === 'gap' && (
                  <p className="text-sm text-muted mt-2">
                    Not yet held.
                    {row.note ? <span className="text-secondary"> {row.note}</span> : null}
                  </p>
                )}

                {row.state !== 'gap' && row.note && (
                  <p className="text-xs text-secondary leading-relaxed mt-1">{row.note}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
