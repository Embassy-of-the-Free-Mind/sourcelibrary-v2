'use client';

import { useState } from 'react';
import SearchAskBars from '@/components/search-kit/SearchAskBars';

/**
 * The Library's own search + Ask pair, scoped to one collection. Search narrows the works below;
 * Ask is the librarian answering from this collection's works only (not wired in the prototype).
 */
export default function CollectionBars({ name, works, authors }: { name: string; works: number; authors: string[] }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [asked, setAsked] = useState('');
  const search = (v: string) => window.dispatchEvent(new CustomEvent('collection-search', { detail: v }));
  return (
    <>
      <SearchAskBars
        search={{ id: 'c-search', label: `Search within ${name}`, placeholder: 'Title, author, note', value: a, onChange: setA, onSubmit: search, examples: authors }}
        ask={{ id: 'c-ask', label: `Ask about these ${works.toLocaleString('en-GB')} works`, placeholder: 'What are you looking for?', value: b, onChange: setB, onSubmit: (v) => setAsked(v.trim()), examples: ['which work to read first'] }}
      />
      {asked && <p className="mt-3 text-[13.5px] text-white/80 max-w-2xl">Prototype: nothing is sent. Live, the librarian would answer from these {works.toLocaleString('en-GB')} works only. Today&apos;s /library Ask drops the collection filter, so it needs that one change.</p>}
    </>
  );
}
