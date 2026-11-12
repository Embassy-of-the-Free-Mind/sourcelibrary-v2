'use client';

import { useState } from 'react';
import { PicBox, type SubjectRow } from './SubjectsBrowser';

const ROW = 4; // one row on a laptop; the rest behind "+ n more"

/** The narrower subjects of a subject, as one row of picture boxes above the works, so you can narrow before you scroll. */
export default function SubSubjects({ name, rows }: { name: string; rows: SubjectRow[] }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, ROW);
  return (
    <section className="bg-cream border-b border-border-light"><div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-10">
      <h2 className="font-sans text-[12px] sm:text-[13px] uppercase tracking-[0.14em] text-muted mb-3">Inside {name}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-3">
        {shown.map((s) => <PicBox key={s.id} s={s} />)}
      </div>
      {rows.length > ROW && (
        <button type="button" aria-expanded={all} onClick={() => setAll(!all)} className="mt-3 text-[13.5px] text-muted underline underline-offset-[3px] hover:text-primary">
          {all ? 'Show fewer' : `+ ${rows.length - ROW} more`}
        </button>
      )}
    </div></section>
  );
}
