'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

export interface SubjectRow { id: string; label: string; href?: string; alt: string[]; home?: boolean }
type Group = SubjectRow & { narrower: SubjectRow[] };

const WRAP = 'max-w-[var(--container-wide)] mx-auto px-6 md:px-12';
const BOX = 'block bg-white border border-border-light px-[18px] py-3.5 text-[15px] text-primary';

function Box({ s, also }: { s: SubjectRow; also?: string }) {
  const body = <>{s.label}{also && <span className="block text-[12.5px] text-muted mt-0.5">Also called {also}</span>}</>;
  return s.href
    ? <Link id={s.home ? s.id : undefined} href={s.href} className={`${BOX} hover:border-primary transition-colors scroll-mt-20`}>{body}</Link>
    : <span id={s.home ? s.id : undefined} className={`${BOX} scroll-mt-20`}>{body}</span>;
}

export default function SubjectsBrowser({ groups }: { groups: Group[] }) {
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  // Matches the English name or any other name, and says which other name matched.
  const match = (s: SubjectRow) => {
    if (!t || s.label.toLowerCase().includes(t)) return { ok: true, also: '' };
    const a = s.alt.find((x) => x.toLowerCase().includes(t));
    return { ok: !!a, also: a ?? '' };
  };
  const shown = useMemo(() => groups.map((g) => {
    const self = match(g);
    const narrower = g.narrower.map((s) => ({ s, m: match(s) })).filter((x) => self.ok && !t ? true : x.m.ok);
    return { g, self, narrower };
  }).filter((x) => !t || x.self.ok || x.narrower.length), [groups, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = new Set(groups.flatMap((g) => [g.id, ...g.narrower.map((s) => s.id)])).size;

  return (
    <>
      <div className={`${WRAP} py-8 md:py-10`}>
        <form role="search" onSubmit={(e) => e.preventDefault()} className="max-w-2xl">
          <label htmlFor="subj-find" className="block text-[12px] sm:text-[13.5px] font-semibold text-primary mb-1 sm:mb-2">Find a subject</label>
          <div className="flex items-stretch h-10 sm:h-[52px] border border-border-medium bg-white focus-within:border-primary focus-within:ring-1 focus-within:ring-primary" data-catalog-bar>
            <input id="subj-find" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${total} subjects, in any language`} className="flex-1 min-w-0 px-3 sm:px-4 text-base text-primary bg-transparent outline-none placeholder:text-muted/70" />
          </div>
          <div className="flex flex-wrap gap-x-1 mt-1.5 sm:mt-2 text-[11.5px] sm:text-[12.5px]">
            <span className="text-muted mr-0.5">Try</span>
            {['Alchemie', 'medicine', '佛教'].map((x) => <button key={x} type="button" onClick={() => setQ(x)} className="px-1 text-muted underline decoration-border-medium underline-offset-[3px] hover:text-primary hover:decoration-primary">{x}</button>)}
            <a href="#how" className="ml-auto text-muted underline decoration-border-medium underline-offset-[3px] hover:text-primary hover:decoration-primary">How we choose subjects</a>
          </div>
        </form>

        {!t && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3 mt-8">
            {groups.map((g) => (
              <a key={g.id} href={`#${g.id}`} className="block bg-warm border border-border-light px-4 py-3 hover:border-primary transition-colors">
                <span className="block text-[15px] text-primary leading-snug">{g.label}</span>
                <span className="block text-[12.5px] text-muted mt-0.5">{g.narrower.length} narrower</span>
              </a>
            ))}
          </div>
        )}
      </div>

      <div className={`${WRAP} pb-14`}>
        {shown.length === 0 && <p className="py-12 text-muted">No subject by that name. Try a broader word, or search the Library instead.</p>}
        {shown.map(({ g, self, narrower }) => (
          <section key={g.id} id={g.id} className="border-t border-border-light py-8 md:py-10 scroll-mt-16">
            <div className="flex items-baseline justify-between gap-4 mb-4">
              <h2 className="font-serif text-2xl md:text-3xl text-primary leading-tight tracking-tight">
                {g.href ? <Link href={g.href} className="hover:underline underline-offset-4">{g.label}</Link> : g.label}
              </h2>
              {g.href && <Link href={g.href} className="text-sm text-primary underline underline-offset-2 decoration-border-medium hover:decoration-primary shrink-0">Open {g.label}</Link>}
            </div>
            {self.also && <p className="text-[13px] text-muted -mt-2 mb-3">Also called {self.also}</p>}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
              {narrower.map(({ s, m }) => <Box key={s.id} s={s} also={m.also} />)}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
