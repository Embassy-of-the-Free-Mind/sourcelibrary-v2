'use client';

import { useState } from 'react';

/**
 * One bar for a collection: the same words either narrow the works below (Search) or go to the
 * librarian, answering from this collection's works only (Ask; not wired in the prototype).
 * Built on the Library's bar ([data-catalog-bar], 16px text, square, button over the border);
 * tone "dark" is the see-through version for over the hero pictures. If kept, this becomes a
 * prop on search-kit/SearchAskBars rather than a second bar.
 */
export default function CollectionBars({ works, examples, tone = 'dark', onHero = true }: { works: number; examples: string[]; tone?: 'dark' | 'light'; onHero?: boolean }) {
  const [v, setV] = useState('');
  const [asked, setAsked] = useState('');
  const n = works.toLocaleString('en-GB');
  const search = (q: string) => { setAsked(''); window.dispatchEvent(new CustomEvent('collection-search', { detail: q })); };
  const dark = tone === 'dark';
  const hero = onHero; // label and examples sit on the pictures, whatever the field's tone
  const field = dark
    ? 'border-white/40 bg-black/35 backdrop-blur-sm focus-within:border-white focus-within:ring-1 focus-within:ring-white'
    : 'border-border-medium bg-white focus-within:border-primary focus-within:ring-1 focus-within:ring-primary';
  const btn = dark ? 'border-l border-white/30 text-white hover:bg-white/10' : 'border-l border-border-medium text-primary hover:bg-warm';
  return (
    <form onSubmit={(e) => { e.preventDefault(); search(v); }} role="search" className="max-w-3xl">
      <label htmlFor="c-bar" className={`block text-[12px] sm:text-[13.5px] font-semibold mb-1 sm:mb-2 ${hero ? 'text-white' : 'text-primary'}`}>Search or ask about these {n} works</label>
      <div className={`flex items-stretch h-10 sm:h-[52px] border ${field}`} data-catalog-bar>
        <input id="c-bar" type="text" value={v} onChange={(e) => setV(e.target.value)} placeholder="A title, an author or a question"
          className={`flex-1 min-w-0 px-3 sm:px-4 text-base bg-transparent outline-none focus-visible:outline-none ${dark ? 'text-white placeholder:text-white/55' : 'text-primary placeholder:text-muted/70'}`} />
        <button type="submit" className={`px-3.5 sm:px-5 text-[13px] sm:text-sm shrink-0 ${btn}`}>Search</button>
        <button type="button" onClick={() => setAsked(v.trim() || 'which work to read first')} className={`px-3.5 sm:px-5 text-[13px] sm:text-sm shrink-0 ${btn}`}>Ask</button>
      </div>
      <div className={`flex flex-wrap items-center gap-x-1 mt-1.5 sm:mt-2 text-[11.5px] sm:text-[12.5px] ${hero ? 'text-white/70' : 'text-muted'}`}>
        <span className="mr-0.5">Try</span>
        {examples.map((e) => (
          <button key={e} type="button" onClick={() => { setV(e); search(e); }} className={`px-1 py-0.5 underline underline-offset-[3px] ${hero ? 'decoration-white/40 hover:text-white hover:decoration-white' : 'decoration-border-medium hover:text-primary hover:decoration-primary'}`}>{e}</button>
        ))}
      </div>
      {asked && <p className={`mt-3 text-[13.5px] max-w-2xl ${hero ? 'text-white/80' : 'text-muted'}`}>Prototype: nothing is sent. Live, the librarian would answer “{asked}” from these {n} works only.</p>}
    </form>
  );
}
