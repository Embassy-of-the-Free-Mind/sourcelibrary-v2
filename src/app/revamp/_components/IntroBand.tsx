/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import type { CollectionModel } from '../_lib/types';

const WRAP = 'max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-16';

/** About the collection: the lead paragraph large, the rest as body text, with a plate or page beside it. As on Mycology and Slime Moulds. */
export default function IntroBand({ m }: { m: CollectionModel }) {
  if (!m.intro.length) return null;
  return (
    <section id="introduction" className="bg-warm border-b border-border-light scroll-mt-16">
      <div className={WRAP}>
        <div className="flex flex-col md:flex-row-reverse md:items-start gap-8 lg:gap-12">
          <div className="font-body flex-1 min-w-0">
            <p className="text-xl sm:text-3xl text-primary leading-snug mb-6">{m.intro[0]}</p>
            {m.intro.slice(1).map((p, i) => <p key={i} className="text-secondary leading-relaxed mb-4 max-w-2xl">{p}</p>)}
          </div>
          {m.introPlate && (
            <figure className="w-full md:w-[min(33%,53.333vh)] shrink-0 m-0 mx-auto md:mx-0">
              <img src={m.introPlate.src} alt={m.introPlate.label || 'Plate from the collection'} loading="lazy" className="w-full h-auto" />
              {m.introPlate.label && <figcaption className="mt-2 text-xs text-muted text-center">{m.introPlate.href ? <Link href={m.introPlate.href} className="hover:text-primary">{m.introPlate.label}</Link> : m.introPlate.label}</figcaption>}
            </figure>
          )}
        </div>
        {m.subjects.length > 0 && (
          <p className="mt-6 text-sm text-muted">Subjects: {m.subjects.map((s, i) => (
            <span key={s.id}>{i > 0 && ', '}<Link className="underline underline-offset-2 hover:opacity-70" href={`/revamp/subjects#${s.id}`}>{s.label}</Link></span>
          ))}</p>
        )}
      </div>
    </section>
  );
}
