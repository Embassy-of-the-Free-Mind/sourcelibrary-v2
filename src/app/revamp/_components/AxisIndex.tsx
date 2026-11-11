import Link from 'next/link';
import type { ReactNode } from 'react';
import PlateWall from './PlateWall';
import CollectionBars from './CollectionBars';
import SubjectsBrowser, { type SubjectRow } from './SubjectsBrowser';
import { RAMP } from '../_lib/ramp';

const WRAP = 'max-w-[var(--container-wide)] mx-auto px-6 md:px-12';
const MICRO = 'uppercase tracking-[0.16em] text-[10.5px] md:text-[11px]';

/** An index page in the Subjects design: plate hero with counts and the featured one, the bar, then picture bands. */
export default function AxisIndex({ title, intro, counts, tiles, featured, groups, noun, group, how, orders, placeholder, flat = false, listOnly = false, switcher, children, wall }: {
  title: string; intro: string; counts: string[]; tiles: string[]; featured: { name: string; href: string } | null;
  groups: (SubjectRow & { narrower: SubjectRow[] })[]; noun: [string, string]; group: [string, string];
  how: { title: string; items: ReactNode[] }; orders: [string, string][]; placeholder: string; flat?: boolean; /** Names only: no cards, no view switch. */ listOnly?: boolean;
  /** Prototype: links to compare looks, top right of the hero. */ switcher?: ReactNode; /** Replaces the bands below the hero. */ children?: ReactNode; /** Replaces the picture wall behind the hero. */ wall?: ReactNode;
}) {
  const total = groups.reduce((s, g) => s + g.narrower.length, 0);
  return (
    <div className="bg-cream min-h-screen">
      <section className="relative overflow-hidden text-white min-h-[46svh] md:min-h-[60vh] flex items-end">
        {wall ?? <PlateWall tiles={tiles} rows={3} still />}
        {switcher && <div className="absolute top-3 right-4 z-20 text-xs text-white/70 flex gap-2">{switcher}</div>}
        <div className={`${WRAP} relative w-full pt-12 md:pt-16 pb-20 md:pb-24 flex flex-col md:flex-row md:items-end md:justify-between gap-8`}>
          <div>
            <h1 className="font-serif text-[44px] md:text-[clamp(52px,5.6vw,84px)] leading-[1.02] tracking-[-0.03em]">{title}</h1>
            <p className="mt-4 text-lg md:text-xl text-stone-200 max-w-2xl leading-relaxed">{intro}</p>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[14px] md:text-[15px] font-medium">
              {counts.map((l, i) => <span key={l} style={{ color: RAMP[i] }}>{l}</span>)}
            </div>
          </div>
          {featured && (
            <Link href={featured.href} className={`group block md:text-right ${MICRO} text-white/70 leading-relaxed`}>
              <span className="text-white/50">Featured</span><span className="mx-2 text-white/30">/</span><span className="text-white whitespace-nowrap group-hover:underline underline-offset-[3px]">{featured.name}</span>
            </Link>
          )}
        </div>
        <CollectionBars strip live works={total} placeholder={placeholder} scope={`all ${total} ${noun[1]}`} />
      </section>
      {children ?? <SubjectsBrowser groups={groups} barSearch noun={noun} group={group} how={how} orders={orders} countGroups={false} flat={flat} listOnly={listOnly} />}
    </div>
  );
}
