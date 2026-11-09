'use client';

import { useState, type ReactNode } from 'react';

/** The see-through fill shared by the bar and anything set beside it on the hero. */
export const GLASS = 'bg-white/[0.13] backdrop-blur-md text-white';

/**
 * One bar for a collection: the same words either narrow the works below (Search) or go to the
 * librarian, answering from this collection's works only (Ask; not wired in the prototype).
 * The Library's bar in size and type (16px text, square), as a see-through fill with no border
 * for over the hero pictures; focus shows as a white ring. If kept, this becomes a tone on
 * search-kit/SearchAskBars rather than a second bar.
 */
export default function CollectionBars({ works, after }: { works: number; after?: ReactNode }) {
  const [v, setV] = useState('');
  const [asked, setAsked] = useState('');
  const search = (q: string) => { setAsked(''); window.dispatchEvent(new CustomEvent('collection-search', { detail: q })); };
  const btn = 'px-3.5 sm:px-5 text-[13px] sm:text-sm shrink-0 hover:bg-white/10';
  return (
    <div>
      <div className="flex items-stretch gap-1.5 sm:gap-2 max-w-4xl">
        <form onSubmit={(e) => { e.preventDefault(); search(v); }} role="search" className={`flex-1 min-w-0 flex items-stretch h-11 sm:h-[52px] ${GLASS} focus-within:ring-1 focus-within:ring-white/80`} data-catalog-bar>
          <label htmlFor="c-bar" className="sr-only">Search or ask about these {works} works</label>
          <input id="c-bar" type="text" value={v} onChange={(e) => setV(e.target.value)} placeholder="Search or ask a question"
            className="flex-1 min-w-0 px-3.5 sm:px-5 text-base bg-transparent text-white placeholder:text-white/60 outline-none focus-visible:outline-none" />
          <button type="submit" className={btn}>Search</button>
          <span aria-hidden className="w-px my-3 bg-white/25" />
          <button type="button" onClick={() => setAsked(v.trim() || 'which work to read first')} className={btn}>Ask</button>
        </form>
        {after}
      </div>
      {asked && <p className="mt-3 text-[13.5px] max-w-2xl text-white/80">Prototype: nothing is sent. Live, the librarian would answer “{asked}” from these {works.toLocaleString('en-GB')} works only.</p>}
    </div>
  );
}
