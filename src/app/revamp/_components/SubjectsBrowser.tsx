'use client';

/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import Link from 'next/link';

export interface Pic { src: string; aspect?: number | null; label?: string | null }
export interface SubjectRow { id: string; label: string; href?: string; alt: string[]; home?: boolean; pics: Pic[] }
type Group = SubjectRow & { narrower: SubjectRow[] };
export type Variant = 'banner' | 'cards';

const WRAP = 'max-w-[var(--container-wide)] mx-auto px-6 md:px-12';
// Every subject will have a page; in the prototype only some do, so the rest point at their own place on this page.
const to = (s: SubjectRow) => s.href ?? `#${s.id}`;
const Arrow = () => <span aria-hidden className="inline-block transition-transform group-hover:translate-x-1">→</span>;

/** A no-gap row of pictures, each at its own proportions. */
function Strip({ pics, className = '' }: { pics: Pic[]; className?: string }) {
  return (
    <div className={`flex overflow-hidden ${className}`} style={{ background: '#1a1612' }}>
      {pics.map((p, i) => <img key={i} src={p.src} alt="" loading="lazy" className="h-full w-auto max-w-none shrink-0 block" />)}
    </div>
  );
}

/** Box with a small square picture at the left. */
function PicBox({ s, also }: { s: SubjectRow; also?: string }) {
  return (
    <Link id={s.home ? s.id : undefined} href={to(s)} className="group flex items-center gap-3 bg-white border border-border-light p-1.5 pr-4 text-[15px] text-primary hover:border-primary transition-colors scroll-mt-20">
      <span className="w-12 h-12 shrink-0 overflow-hidden bg-warm">{s.pics[0] && <img src={s.pics[0].src} alt="" loading="lazy" className="w-full h-full object-cover" />}</span>
      <span className="min-w-0"><span className="group-hover:underline underline-offset-2">{s.label}</span>{also && <span className="block text-[12.5px] text-muted">Also called {also}</span>}</span>
    </Link>
  );
}

export default function SubjectsBrowser({ groups, variant }: { groups: Group[]; variant: Variant }) {
  const [q, setQ] = useState('');
  const [how, setHow] = useState(false);
  const [open, setOpen] = useState<string[]>([]);
  const t = q.trim().toLowerCase();
  // Matches the English name or any other name, and says which other name matched.
  const match = (s: SubjectRow) => {
    if (!t || s.label.toLowerCase().includes(t)) return { ok: true, also: '' };
    const a = s.alt.find((x) => x.toLowerCase().includes(t));
    return { ok: !!a, also: a ?? '' };
  };
  const shown = groups.map((g) => {
    const self = match(g);
    const narrower = g.narrower.map((s) => ({ s, m: match(s) })).filter((x) => (!t ? true : x.m.ok));
    return { g, self, narrower };
  }).filter((x) => !t || x.self.ok || x.narrower.length);
  const total = new Set(groups.flatMap((g) => [g.id, ...g.narrower.map((s) => s.id)])).size;

  const search = (
    <div className={`${WRAP} py-8 md:py-10`}>
      <form role="search" onSubmit={(e) => e.preventDefault()} className="max-w-2xl">
        <label htmlFor="subj-find" className="block text-[12px] sm:text-[13.5px] font-semibold text-primary mb-1 sm:mb-2">Find a subject</label>
        <div className="flex items-stretch h-10 sm:h-[52px] border border-border-medium bg-white focus-within:border-primary focus-within:ring-1 focus-within:ring-primary" data-catalog-bar>
          <input id="subj-find" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${total} subjects, in any language`} className="flex-1 min-w-0 px-3 sm:px-4 text-base text-primary bg-transparent outline-none placeholder:text-muted/70" />
        </div>
        <div className="flex flex-wrap gap-x-1 mt-1.5 sm:mt-2 text-[11.5px] sm:text-[12.5px]">
          <span className="text-muted mr-0.5">Try</span>
          {['Alchemie', 'medicine', '佛教'].map((x) => <button key={x} type="button" onClick={() => setQ(x)} className="px-1 text-muted underline decoration-border-medium underline-offset-[3px] hover:text-primary hover:decoration-primary">{x}</button>)}
          <button type="button" aria-expanded={how} aria-controls="how" onClick={() => setHow(!how)} className="ml-auto text-muted underline decoration-border-medium underline-offset-[3px] hover:text-primary hover:decoration-primary">How we choose subjects {how ? '−' : '+'}</button>
        </div>
      </form>
      {how && (
        <ul id="how" className="max-w-2xl mt-4 bg-warm border border-border-light px-5 py-4 space-y-1.5 text-[14.5px] text-secondary leading-relaxed list-disc pl-9">
          <li>A subject exists when the library holds books or images about it.</li>
          <li>Broad subjects hold more specific ones, and a specific one can sit under two.</li>
          <li>Each is linked to library standards (FAST and Wikidata) where a match exists.</li>
          <li>Search finds it by any of its names, in Latin, German, Chinese and more.</li>
        </ul>
      )}
      {!t && variant !== 'cards' && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3 mt-8">
          {groups.map((g) => (
            <a key={g.id} href={`#g-${g.id}`} className="group block bg-warm border border-border-light px-4 py-3 hover:border-primary transition-colors">
              <span className="block text-[15px] text-primary leading-snug group-hover:underline underline-offset-2">{g.label}</span>
              <span className="block text-[12.5px] text-muted mt-0.5">{g.narrower.length} subjects</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );

  const empty = shown.length === 0 && <p className={`${WRAP} py-12 text-muted`}>No subject by that name. Try a broader word, or search the Library instead.</p>;

  // B: one card per broad subject, its subjects listed as links under the picture.
  if (variant === 'cards') {
    return (
      <>
        {search}{empty}
        <div className={`${WRAP} pb-16 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-12`}>
          {shown.map(({ g, self, narrower }) => {
            const more = open.includes(g.id) || !!t;
            const list = more ? narrower : narrower.slice(0, 8);
            return (
              <section key={g.id} id={`g-${g.id}`} className="scroll-mt-20">
                <Link href={to(g)} className="group block">
                  <Strip pics={g.pics.slice(0, 6)} className="h-[180px] border border-transparent group-hover:border-primary transition-colors" />
                  <span className="flex items-baseline justify-between gap-3 mt-3">
                    <span className="font-serif text-[26px] leading-tight text-primary group-hover:underline underline-offset-4">{g.label}</span>
                    <span className="text-[13px] text-primary whitespace-nowrap">All of it <Arrow /></span>
                  </span>
                </Link>
                {self.also && <p className="text-[13px] text-muted">Also called {self.also}</p>}
                <ul className="mt-3 border-t border-border-light">
                  {list.map(({ s, m }) => (
                    <li key={s.id} className="border-b border-border-light">
                      <Link id={s.home ? s.id : undefined} href={to(s)} className="group flex items-baseline justify-between gap-3 py-2 text-[15px] text-primary scroll-mt-20">
                        <span className="group-hover:underline underline-offset-2">{s.label}{m.also && <span className="text-muted text-[12.5px]"> · {m.also}</span>}</span>
                        <span aria-hidden className="text-muted opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {!t && narrower.length > 8 && (
                  <button type="button" onClick={() => setOpen(more ? open.filter((x) => x !== g.id) : [...open, g.id])} className="mt-2 text-[13px] text-muted underline underline-offset-2 hover:text-primary">{more ? 'Show fewer' : `Show all ${narrower.length}`}</button>
                )}
              </section>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <>
      {search}{empty}
      <div className="pb-16">
        {shown.map(({ g, self, narrower }) => (
          <section key={g.id} id={`g-${g.id}`} className="scroll-mt-16">
            <div className={`${WRAP} py-8 md:py-10`}>
              {(
                // A: the whole picture band is the way into the subject.
                <Link href={to(g)} className="group relative block h-[170px] md:h-[200px] overflow-hidden mb-4">
                  <Strip pics={g.pics} className="absolute inset-0 h-full" />
                  <span className="absolute inset-0 bg-black/55 group-hover:bg-black/40 transition-colors" />
                  <span className="absolute inset-0 flex items-end justify-between gap-4 p-5 md:p-7 text-white">
                    <span className="font-serif text-[34px] md:text-[48px] leading-none tracking-tight">{g.label}</span>
                    <span className="text-[15px] font-medium whitespace-nowrap border-b border-white/60 group-hover:border-white pb-0.5">Everything in {g.label} <Arrow /></span>
                  </span>
                </Link>
              )}
              {self.also && <p className="text-[13px] text-muted -mt-2 mb-3">Also called {self.also}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">{narrower.map(({ s, m }) => <PicBox key={s.id} s={s} also={m.also} />)}</div>
            </div>
            <div className={WRAP}><div className="border-t border-border-light" /></div>
          </section>
        ))}
      </div>
    </>
  );
}
