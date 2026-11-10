'use client';

import { useState, type ReactNode } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { fill } from '../_lib/tones';



/**
 * One bar for a collection: the same words either narrow the works below (Search) or go to the
 * librarian, answering from this collection's works only (Ask; not wired in the prototype).
 * The Library's bar in size and type (16px text, square), as a see-through fill with no border
 * for over the hero pictures; focus shows as a white ring. If kept, this becomes a tone on
 * search-kit/SearchAskBars rather than a second bar.
 */
export default function CollectionBars({ works, after, tone = 'ink', strip = false, hover = 'tint' }: { works: number; after?: ReactNode; tone?: string; strip?: boolean; hover?: string }) {
  const [v, setV] = useState('');
  const [asked, setAsked] = useState('');
  const search = (q: string) => { setAsked(''); window.dispatchEvent(new CustomEvent('collection-search', { detail: q })); };
  const btn = 'px-3.5 sm:px-5 text-[13px] sm:text-sm shrink-0 hover:bg-white/10';
  const note = asked && <p className={`text-[13.5px] max-w-2xl text-white/80 ${strip ? 'mb-3' : 'mt-3'}`}>Prototype: nothing is sent. Live, the librarian would answer “{asked}” from these {works.toLocaleString('en-GB')} works only.</p>;
  // Strip: one full-width band along the bottom edge of the hero, everything in it divided by hairlines.
  if (strip) return (
    <div className="absolute inset-x-0 bottom-0 z-10">
      <div className="max-w-[1500px] mx-auto px-6 md:px-12">{note}</div>
      <div className="text-white" style={{ background: fill(tone) }}>
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 flex items-stretch h-14 sm:h-16">
          <form onSubmit={(e) => { e.preventDefault(); search(v); }} role="search" className="flex-1 min-w-0 flex items-stretch focus-within:shadow-[inset_0_-2px_0_rgba(255,255,255,.8)]" data-catalog-bar>
            <label htmlFor="c-bar" className="sr-only">Search or ask about these {works} works</label>
            <span className="group/field flex-1 min-w-0 flex items-stretch">
              {hover === 'icon' && <SearchIcon aria-hidden className="self-center w-4 h-4 mr-3 shrink-0 text-white/45 transition-[color,transform] group-hover/field:text-white group-hover/field:translate-x-0.5 group-focus-within/field:text-white" />}
              <input id="c-bar" type="text" value={v} onChange={(e) => setV(e.target.value)} placeholder="Search or ask a question"
                className={`flex-1 min-w-0 pr-4 text-base bg-transparent text-white placeholder:text-white/60 outline-none focus-visible:outline-none transition-[background-color,box-shadow,color] ${{
                  tint: '-ml-4 pl-4 hover:bg-white/[0.06] focus:bg-white/[0.06]',
                  line: 'hover:shadow-[inset_0_-1px_0_rgba(255,255,255,.4)]',
                  bright: 'hover:placeholder:text-white/90',
                  icon: 'group-hover/field:placeholder:text-white/90',
                }[hover] ?? ''}`} />
            </span>
            <button type="submit" className={btn}>Search</button>
            <span aria-hidden className="w-px my-4 bg-white/25" />
            <button type="button" onClick={() => setAsked(v.trim() || 'which work to read first')} className={btn}>Ask</button>
          </form>
          {after}
        </div>
      </div>
    </div>
  );
  return (
    <div>
      <div className="flex items-stretch gap-1.5 sm:gap-2 max-w-4xl">
        <form onSubmit={(e) => { e.preventDefault(); search(v); }} role="search" className="flex-1 min-w-0 flex items-stretch h-11 sm:h-[52px] text-white backdrop-blur-md focus-within:ring-1 focus-within:ring-white/80" style={{ background: fill(tone) }} data-catalog-bar>
          <label htmlFor="c-bar" className="sr-only">Search or ask about these {works} works</label>
          <input id="c-bar" type="text" value={v} onChange={(e) => setV(e.target.value)} placeholder="Search or ask a question"
            className="flex-1 min-w-0 px-3.5 sm:px-5 text-base bg-transparent text-white placeholder:text-white/60 outline-none focus-visible:outline-none" />
          <button type="submit" className={btn}>Search</button>
          <span aria-hidden className="w-px my-3 bg-white/25" />
          <button type="button" onClick={() => setAsked(v.trim() || 'which work to read first')} className={btn}>Ask</button>
        </form>
        {after}
      </div>
      {note}
    </div>
  );
}
