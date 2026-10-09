/**
 * The four parts of the journey film, written out as plain prose (#5861).
 * Built from the same `buildJourneyCopy` as the film's captions, so the page
 * and the film cannot say different things. Server-renderable: this is what
 * a crawler and a reader without WebGL get.
 */
import Link from 'next/link';
import { buildJourneyCopy, type JourneyData } from '@/lib/journey/types';

export default function JourneyProse({
  data,
  intro,
  children,
}: {
  data: JourneyData;
  intro?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { steps, parts } = buildJourneyCopy(data);
  return (
    <div className="max-w-[var(--container-narrow)] mx-auto px-6 py-14 md:py-20">
      {intro}
      {parts.map(p => (
        <section key={p.key} className="mb-12" aria-labelledby={`journey-${p.key}`}>
          <p className="font-sans text-xs font-semibold uppercase tracking-[0.12em] text-accent-rust mb-2">{p.eyebrow}</p>
          <h2 id={`journey-${p.key}`} className="text-3xl md:text-4xl text-primary leading-tight mb-3">{p.title}</h2>
          <p className="text-lg italic text-secondary mb-6">{p.body}</p>
          {p.steps.map(k => {
            const st = steps.find(x => x.key === k)!;
            const n = steps.indexOf(st) + 1;
            return (
              <div key={k} className="mb-5">
                <h3 className="font-sans text-sm font-semibold text-primary mb-1">
                  <span className="text-accent-rust mr-2">{n}</span>{st.title}
                </h3>
                <p className="text-lg text-secondary leading-relaxed">{st.body}</p>
              </div>
            );
          })}
        </section>
      ))}
      <div className="border-t border-border-light pt-8 flex flex-wrap gap-x-8 gap-y-3 font-sans text-sm">
        <Link href={data.readerPath} className="text-accent-rust hover:underline">
          Read {data.citation.locator} on Source Library
        </Link>
        <Link href={data.bookPath} className="text-accent-rust hover:underline">The whole book</Link>
        {children}
      </div>
    </div>
  );
}
