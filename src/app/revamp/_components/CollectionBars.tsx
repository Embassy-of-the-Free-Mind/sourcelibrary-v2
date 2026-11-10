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
export default function CollectionBars({ works, after, tone = 'ink', strip = false, placeholder = 'Search or ask a question', scope, live = false, panel = false }: {
  works: number; after?: ReactNode; tone?: string; strip?: boolean;
  /** What the field says before anything is typed. */ placeholder?: string;
  /** What a question would be answered from, for the prototype note. Defaults to "these N works". */ scope?: string;
  /** Narrow the list below while typing (index pages), not only on Enter. */ live?: boolean;
  /** Questions open the answer panel under the hero (AskPanel) instead of the one-line note. */ panel?: boolean;
}) {
  const [v, setV] = useState('');
  const [asked, setAsked] = useState('');
  const search = (q: string) => { setAsked(''); window.dispatchEvent(new CustomEvent('collection-search', { detail: q })); };
  const btn = 'px-3.5 sm:px-5 text-[13px] sm:text-sm shrink-0 hover:bg-white/10';
  // One field, no buttons: a question goes to the librarian, anything else searches the works.
  const isQuestion = (t: string) => /\?\s*$/.test(t) || /^(who|what|which|when|where|why|how|is|are|does|did|do|can|was|were|tell|show|find|explain)\b/i.test(t.trim());
  const submit = (t: string) => (!isQuestion(t) ? search(t) : panel ? window.dispatchEvent(new CustomEvent('collection-ask', { detail: t.trim() })) : setAsked(t.trim()));
  const note = asked && <p className={`text-[13.5px] max-w-2xl text-white/80 ${strip ? 'mb-3' : 'mt-3'}`}>Prototype: nothing is sent. Live, the librarian would answer “{asked}” from {scope ?? `these ${works.toLocaleString('en-GB')} works`} only.</p>;
  // Strip: one full-width band along the bottom edge of the hero, everything in it divided by hairlines.
  if (strip) return (
    <div className="absolute inset-x-0 bottom-0 z-10">
      <div className="max-w-[1500px] mx-auto px-6 md:px-12">{note}</div>
      <div className="text-white" style={{ background: fill(tone) }}>
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 flex items-stretch h-12 sm:h-[52px]">
          <form onSubmit={(e) => { e.preventDefault(); submit(v); }} role="search" className="flex-1 min-w-0 flex items-stretch" data-catalog-bar>
            <label htmlFor="c-bar" className="sr-only">{placeholder}</label>
            <span className="group/field relative flex-1 min-w-0 flex items-stretch">
              <SearchIcon aria-hidden className="self-center w-[18px] h-[18px] mr-3 shrink-0 text-white/60 group-hover/field:text-white group-focus-within/field:text-white transition-colors" />
              <input id="c-bar" type="text" value={v} onChange={(e) => { setV(e.target.value); if (live && !isQuestion(e.target.value)) search(e.target.value); }}
                placeholder={placeholder}
                className={`flex-1 min-w-0 pr-4 text-base bg-transparent text-white placeholder:text-white/60 outline-none focus-visible:outline-none`} />
            </span>
            <button type="submit" className="sr-only">Search or ask</button>
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

/**
 * The same one field for a page with no picture hero (the Gallery look): the Library's bar in size,
 * border and type, with the search icon. A question shows the prototype note; anything else narrows
 * the list below as you type.
 */
export function LightBar({ placeholder, scope }: { placeholder: string; scope: string }) {
  const [v, setV] = useState('');
  const [asked, setAsked] = useState('');
  const isQuestion = (t: string) => /\?\s*$/.test(t) || /^(who|what|which|when|where|why|how|is|are|does|did|do|can|was|were|tell|show|find|explain)\b/i.test(t.trim());
  const search = (q: string) => { setAsked(''); window.dispatchEvent(new CustomEvent('collection-search', { detail: q })); };
  return (
    <div>
      <form role="search" onSubmit={(e) => { e.preventDefault(); if (isQuestion(v)) setAsked(v.trim()); else search(v); }}
        className="group/field flex items-center h-11 sm:h-[52px] border border-border-medium bg-white focus-within:border-primary focus-within:ring-1 focus-within:ring-primary" data-catalog-bar>
        <label htmlFor="l-bar" className="sr-only">{placeholder}</label>
        <SearchIcon aria-hidden className="w-[18px] h-[18px] ml-3.5 sm:ml-4 mr-3 shrink-0 text-muted group-focus-within/field:text-primary transition-colors" />
        <input id="l-bar" type="text" value={v} placeholder={placeholder}
          onChange={(e) => { setV(e.target.value); if (!isQuestion(e.target.value)) search(e.target.value); }}
          className="flex-1 min-w-0 h-full pr-4 text-base text-primary bg-transparent outline-none placeholder:text-muted/70" />
        <button type="submit" className="sr-only">Search or ask</button>
      </form>
      {asked && <p className="mt-2 text-[13.5px] text-secondary max-w-2xl">Prototype: nothing is sent. Live, the librarian would answer “{asked}” from {scope} only.</p>}
    </div>
  );
}
