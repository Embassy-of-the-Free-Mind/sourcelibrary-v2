'use client';

import Link from 'next/link';
import { useState } from 'react';

// The homepage subject index: every top-level collection as a text row with
// its count. On a phone the full list is 33 rows of single-column scroll, so
// below `lg` only the first `initialCount` (the pinned "ancient roots" through
// "knowledge & world" rows) show until the reader asks for the rest. Desktop
// always shows everything — four columns make the whole list one glance.

export interface SubjectIndexItem {
  slug: string;
  href: string;
  name: string;
  count: string;
}

interface Props {
  items: SubjectIndexItem[];
  initialCount: number;
  /** "See 21 more" — computed by the server parent; a function cannot cross the client boundary. */
  showMoreLabel: string;
}

export default function SubjectIndex({ items, initialCount, showMoreLabel }: Props) {
  const [expanded, setExpanded] = useState(false);
  const remaining = items.length - initialCount;

  return (
    <>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-10">
        {items.map((item, i) => (
          <li
            key={item.slug}
            className={`border-b border-border-light ${i >= initialCount && !expanded ? 'hidden lg:block' : ''}`}
          >
            <Link
              href={item.href}
              className="group flex items-baseline justify-between gap-4 py-2.5"
            >
              <span className="font-serif text-lg text-primary group-hover:text-accent-rust transition-colors leading-snug">
                {item.name}
              </span>
              <span className="text-xs text-muted tabular-nums whitespace-nowrap">
                {item.count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {remaining > 0 && !expanded && (
        <div className="mt-4 lg:hidden">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-sm text-accent-rust hover:underline"
          >
            {showMoreLabel} &darr;
          </button>
        </div>
      )}
    </>
  );
}
