import Link from 'next/link';
import type { ReactNode } from 'react';
import { Bell } from 'lucide-react';
import PlateWall from './PlateWall';
import CollectionBars from './CollectionBars';
import AskPanel from './AskPanel';
import CollectionItems from './CollectionItems';
import { RAMP } from '../_lib/ramp';
import type { CollectionModel } from '../_lib/types';

const WRAP = 'max-w-[var(--container-wide)] mx-auto px-6 md:px-12';
const n = (v: number) => v.toLocaleString('en-GB');

/** A single period or language, in the single subject design: plate hero, counts, the bar, then the works. */
export default function AxisPage({ m, crumb, sub, counts, scope, pictures = false, tiles }: {
  m: CollectionModel; crumb: { label: string; href: string }; sub?: ReactNode; counts: string[]; scope: 'period' | 'language' | 'type';
  /** A page of pictures (a picture type) rather than of books. */ pictures?: boolean; tiles?: string[];
}) {
  const total = pictures ? m.stats.images : m.stats.works;
  const shown = pictures ? m.plates.length : m.all.length;
  const wall = tiles ?? m.heroTiles;
  return (
    <div className="bg-cream min-h-screen">
      <section className="relative overflow-hidden text-white flex items-end min-h-[56svh] md:min-h-[75vh]" style={{ backgroundColor: '#1a1612' }}>
        {wall.length >= 4 && <PlateWall tiles={wall} rows={3} still />}
        <div className={`${WRAP} relative w-full pt-10 md:pt-14 pb-20 md:pb-24`}>
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 uppercase text-[10.5px] md:text-[13px] tracking-[0.15em] mb-3 text-white/70">
            <Link href={crumb.href} className="hover:text-white">{crumb.label}</Link>
          </nav>
          <h1 className="font-serif text-[40px] md:text-[clamp(52px,5.6vw,84px)] leading-[1.02] tracking-[-0.03em]">{m.name}</h1>
          {sub && <div className="mt-4 text-lg md:text-xl text-stone-200 max-w-2xl leading-relaxed">{sub}</div>}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] md:text-[13.5px] font-medium">
            {counts.map((t, i) => <span key={t} style={{ color: RAMP[Math.min(i, RAMP.length - 1)] }}>{t}</span>)}
          </div>
        </div>
        <CollectionBars strip panel works={total} tone="ink" after={<>
          <span aria-hidden className="w-px my-4 bg-white/25 ml-1 sm:ml-2" />
          <Link href="/auth/signin" className="inline-flex items-center gap-2 px-3.5 sm:px-5 -mr-3.5 sm:-mr-5 text-[13px] sm:text-sm hover:bg-white/10"><Bell className="w-4 h-4" aria-hidden /><span className="hidden sm:inline">Follow</span></Link>
        </>} />
      </section>
      <AskPanel books={m.all} plates={m.plates} byBook={m.byBook} scope={scope === 'type' ? 'subject' : scope} name={m.name} />
      <CollectionItems slug={m.slug} books={m.all} notes={[]} plates={m.plates} imagesTotal={m.plates.length} byBook={m.byBook} curated={false}
        protoNote={`The first ${n(shown)} of ${n(total)} ${pictures ? 'pictures, as the Gallery lists them' : 'books, as the Library lists them'}${pictures || !m.plates.length ? '' : ', and pictures from the first few'}. Live, this lists them all.`} />
    </div>
  );
}
