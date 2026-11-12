import { PicBox, type SubjectRow } from './SubjectsBrowser';


/** The narrower subjects of a subject, all of them, as picture boxes, so you can narrow before you scroll. */
export default function SubSubjects({ name, rows }: { name: string; rows: SubjectRow[] }) {
  if (!rows.length) return null;
  return (
    <section className="bg-cream border-b border-border-light"><div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-10">
      <h2 className="font-sans text-[12px] sm:text-[13px] uppercase tracking-[0.14em] text-muted mb-3">Inside {name}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-3">
        {rows.map((s) => <PicBox key={s.id} s={s} />)}
      </div>
    </div></section>
  );
}
