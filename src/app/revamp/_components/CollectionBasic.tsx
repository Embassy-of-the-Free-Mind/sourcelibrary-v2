/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import PlateWall from './PlateWall';
import CollectionBars from './CollectionBars';
import CollectionItems from './CollectionItems';
import { RAMP } from '../_lib/ramp';
import { MAKER_DEMO, type MakerOptions } from '../_data/maker-demo';
import type { CollectionModel } from '../_lib/types';

const WRAP = 'max-w-[1500px] mx-auto px-6 md:px-12';
const n = (v: number) => v.toLocaleString('en-GB');

/**
 * The base page for every collection except the hand-made ones (Mycology, Slime Moulds).
 * Hero, the collection's own search and Ask, then its works and images. Everything else is a
 * switch the maker turns on, and nothing shows that the collection has no material for.
 */
export default function CollectionBasic({ m }: { m: CollectionModel }) {
  const works = m.all.length;
  const langs = new Set(m.all.map((b) => b.language).filter(Boolean)).size;
  const years = m.all.map((b) => b.year).filter((y): y is number => !!y && y > 0);
  const span = years.length ? `${Math.min(...years)} – ${Math.max(...years)}` : '';
  const authors = [...new Set(m.all.map((b) => (b.author || '').split(/[;,|]/)[0].trim()).filter((a) => a && !/unknown|anonym|various/i.test(a)))].slice(0, 3);
  const d = MAKER_DEMO[m.slug] ?? {};
  const opts: MakerOptions = { notes: d.notes ?? m.notes.length > 0, numbered: !!d.numbered, sections: !!d.sections, startHere: d.startHere ?? (works > 60 && m.notes.length >= 3) };
  const counts = [works && `${n(works)} works`, m.stats.images && `${n(m.stats.images)} images`, langs > 1 && `${langs} languages`, span].filter(Boolean) as string[];
  return (
    <div className="min-h-screen bg-cream">
      <section className="relative overflow-hidden text-white flex items-end min-h-[56svh] md:min-h-[75vh]" style={{ backgroundColor: '#1a1612' }}>
        {m.heroTiles.length >= 8 ? <PlateWall tiles={m.heroTiles} rows={3} still /> : m.heroImage ? <img src={m.heroImage} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" /> : null}
        <div className={`${WRAP} relative w-full py-10 md:py-14`}>
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 uppercase text-[10.5px] md:text-[13px] tracking-[0.15em] mb-3 text-white/70">
            <Link href="/revamp/c" className="hover:text-white">Collections</Link>
          </nav>
          <h1 className="font-serif text-[40px] md:text-[clamp(52px,5.6vw,84px)] leading-[1.02] tracking-[-0.03em]">{m.name}</h1>
          {m.short && <p className="mt-4 text-lg md:text-xl text-stone-200 max-w-2xl leading-relaxed">{m.short}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] md:text-[13.5px] font-medium">
            {counts.map((t, i) => <span key={t} style={{ color: RAMP[Math.min(i, RAMP.length - 1)] }}>{t}</span>)}
            <span className="text-white/60">{m.byline}</span>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/auth/signin?callbackUrl=%2Fcollections" className="inline-flex items-center h-9 px-4 bg-white text-primary text-[13.5px] font-medium hover:opacity-90">Follow</Link>
            <Link href="/auth/signin?callbackUrl=%2Fcollections" className="inline-flex items-center h-9 px-4 bg-white text-primary text-[13.5px] font-medium hover:opacity-90">Copy to my collections</Link>
          </div>
          <div className="on-dark mt-8 md:mt-10"><CollectionBars name={m.name} works={works} authors={authors} /></div>
        </div>
      </section>

      {m.intro.length > 0 && (
        <div className="bg-warm border-b border-border-light">
          <details className={`${WRAP} py-4 group/about`}>
            <summary className="cursor-pointer list-none text-[14px] text-primary underline decoration-border-medium underline-offset-[3px] w-fit">About this collection <span className="group-open/about:hidden">+</span><span className="hidden group-open/about:inline">−</span></summary>
            <div className="max-w-3xl pt-4 pb-2 space-y-3 text-secondary leading-relaxed font-body">{m.intro.map((p, i) => <p key={i}>{p}</p>)}</div>
          </details>
        </div>
      )}

      <CollectionItems slug={m.slug} books={m.all} notes={m.notes} plates={m.plates} imagesTotal={m.stats.images} byBook={m.byBook} opts={opts} />
    </div>
  );
}
