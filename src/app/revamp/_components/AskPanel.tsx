'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import GalleryMasonry, { type Plate } from '@/components/GalleryMasonry';
import type { Book } from '../_lib/types';

const WRAP = 'max-w-[var(--container-wide)] mx-auto px-6 md:px-12';
const SHOW = 10; // two rows of five

// Words that say nothing about what is being asked for.
const STOP = new Set('a an and are as at be by can could did do does for from had has have how i in into is it its me my of on or our so tell than that the their them there these they this those to was we were what when where which who whom why will with would you your about any some show find explain read first best book books work works most more text texts write wrote written say said'.split(' '));
const words = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ies|es|s)$/, ''));
const has = (hay: string | null | undefined, w: string) => !!hay && hay.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(w);

/**
 * Where the librarian's answer to a question asked in the hero bar appears: under the hero, above
 * everything else. Prototype: nothing is sent, so the answer itself is left empty. The works and
 * pictures under it are this collection's (or subject's) own, matched on the words of the question;
 * live, they are the ones the librarian cites.
 */
export default function AskPanel({ books, plates, byBook, scope, name }: { books: Book[]; plates: Plate[]; byBook: Record<string, Plate[]>; scope: 'collection' | 'subject'; name: string }) {
  const [q, setQ] = useState('');
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const on = (e: Event) => { setQ((e as CustomEvent<string>).detail); requestAnimationFrame(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); };
    window.addEventListener('collection-ask', on);
    return () => window.removeEventListener('collection-ask', on);
  }, []);
  if (!q) return null;

  // The collection's own name says nothing here (every work in Yoga is about yoga), unless it is all the question has.
  const all = words(q);
  const own = new Set(words(name));
  const ws = all.some((w) => !own.has(w)) ? all.filter((w) => !own.has(w)) : all;
  const scored = books.map((b) => {
    let s = 0;
    for (const w of ws) {
      if (has(b.display_title, w) || has(b.title, w)) s += 3;
      if (has(b.author, w)) s += 2;
      if (has(b.language, w) || String(b.year ?? '') === w) s += 1;
    }
    return { b, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || (a.b.year ?? 9999) - (b.b.year ?? 9999));
  const found = scored.slice(0, SHOW).map((x) => x.b);
  // Pictures: those whose caption matches, then those from the matched works.
  const seen = new Set<string>();
  const pics = [...plates.filter((p) => ws.some((w) => has(p.label, w))), ...found.flatMap((b) => byBook[b.id!] ?? [])]
    .filter((p) => !seen.has(p.src) && seen.add(p.src)).slice(0, SHOW);
  const here = `this ${scope}`;

  return (
    <section ref={box} aria-label="The librarian's answer" className="bg-cream border-b border-border-light scroll-mt-16">
      <div className={`${WRAP} py-10 md:py-14`}>
        <div className="flex items-start justify-between gap-6">
          <h2 className="font-serif text-[28px] md:text-[40px] text-primary leading-[1.1] tracking-tight max-w-4xl">{q}</h2>
          <button type="button" onClick={() => setQ('')} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm text-primary hover:bg-warm shrink-0"><X className="w-4 h-4" aria-hidden />Close</button>
        </div>

        <div className="mt-6 max-w-3xl border border-border-light bg-warm px-5 py-4 text-[15px] text-secondary leading-relaxed">
          The librarian&apos;s answer appears here, written from the works in {here} only, with links to the pages it quotes.
          <span className="block text-[13px] text-muted mt-1.5">Prototype: no question is sent, so there is no answer. The works below match the words of your question.</span>
        </div>

        <div className="mt-12 md:mt-16">
          <div className="flex items-end justify-between gap-4 mb-6">
            <h3 className="font-serif text-2xl md:text-[32px] text-primary leading-tight">From {here}</h3>
            {found.length > 0 && <span className="text-sm text-muted">{scored.length > SHOW ? `${SHOW} of ${scored.length.toLocaleString('en-GB')}` : scored.length} {scored.length === 1 ? 'work' : 'works'}</span>}
          </div>
          {found.length === 0 ? (
            <p className="text-[15px] text-secondary">Nothing in {here} matches those words. Live, the librarian would say so and offer to ask the whole library.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-6">
              {found.map((b) => <div key={b.id}><CollectionBookCard book={b as unknown as CollectionBook} /></div>)}
            </div>
          )}
        </div>

        {pics.length > 0 && (
          <div className="mt-12 md:mt-16">
            <h3 className="font-serif text-2xl md:text-[32px] text-primary leading-tight mb-6">Pictures</h3>
            <GalleryMasonry plates={pics} />
          </div>
        )}

        <p className="mt-10 text-[13.5px] text-muted">Live, &ldquo;Continue in the librarian&rdquo; would open this conversation at the librarian, still inside {here}, for follow-up questions.</p>
      </div>
    </section>
  );
}
