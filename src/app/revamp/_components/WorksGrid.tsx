'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';

const STEP = 20;
const n = (v: number) => v.toLocaleString('en-GB');

/** Four rows, then Show more. Past what the page holds, the Library takes over with its own filters. */
export default function WorksGrid({ books, total, slug }: { books: CollectionBook[]; total: number; slug: string }) {
  const [shown, setShown] = useState(STEP);
  const more = books.length - shown;
  const box = 'inline-flex items-center gap-2 h-11 px-5 border border-border-medium bg-white text-sm text-primary hover:border-primary transition-colors';
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {books.slice(0, shown).map((b) => <CollectionBookCard key={b.id} book={b} />)}
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        {more > 0 && <button type="button" onClick={() => setShown(shown + STEP)} className={box}>Show {Math.min(STEP, more)} more</button>}
        {total > Math.min(shown, books.length) && <Link href={`/library?collection=${slug}`} className={box}>See all {n(total)} in the Library <ArrowRight className="w-4 h-4" /></Link>}
      </div>
    </>
  );
}
