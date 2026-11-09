/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { Bell, Copy } from 'lucide-react';
import PlateWall from './PlateWall';
import CollectionBars from './CollectionBars';
import HeroPicture, { type HeroCandidate } from './HeroPicture';
import { dataFile } from '../_lib/data';
import { GLASS, TONES, fill } from '../_lib/tones';
import CollectionItems from './CollectionItems';
import IntroBand from './IntroBand';
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
const SIGN_IN = '/auth/signin?callbackUrl=%2Fcollections';
const ACTS: [string, string][] = [['beside', 'A Beside the bar'], ['icons', 'B Icons by the title'], ['top', 'C Top line']];

const BARS: [string, string][] = [['inside', 'A In the hero'], ['bottom', 'B Bottom strip']];
const HEROES: [string, string][] = [['wall', 'A Plate rows'], ['bleed', 'B One picture, full bleed'], ['whole', 'C One picture, whole']];

export default function CollectionBasic({ m, act = 'beside', tone = 'ink', hero = 'wall', bar = 'inside' }: { m: CollectionModel; act?: string; tone?: string; hero?: string; bar?: string }) {
  const q = (o: Record<string, string>) => `/revamp/c/${m.slug}?${new URLSearchParams({ act, tone, hero, bar, ...o })}`;
  const cands = dataFile<Record<string, HeroCandidate[]>>('snap/_hero')?.[m.slug] ?? [];
  const works = m.all.length;
  const langs = new Set(m.all.map((b) => b.language).filter(Boolean)).size;
  const years = m.all.map((b) => b.year).filter((y): y is number => !!y && y > 0);
  const span = years.length ? `${Math.min(...years)} – ${Math.max(...years)}` : '';
  const d = MAKER_DEMO[m.slug] ?? {};
  const opts: MakerOptions = { notes: d.notes ?? m.notes.length > 0, numbered: !!d.numbered, sections: !!d.sections, startHere: d.startHere ?? (works > 60 && m.notes.length >= 3) };
  const counts = [works && `${n(works)} works`, m.stats.images && `${n(m.stats.images)} images`, langs > 1 && `${langs} languages`, span].filter(Boolean) as string[];
  return (
    <div className="min-h-screen bg-cream">
      <section className="relative overflow-hidden text-white flex items-end min-h-[56svh] md:min-h-[75vh]" style={{ backgroundColor: '#1a1612' }}>
        {(() => {
          const wall = m.heroTiles.length >= 8 ? <PlateWall tiles={m.heroTiles} rows={3} still /> : m.heroImage ? <img src={m.heroImage} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" /> : null;
          return hero === 'wall' ? wall : <HeroPicture slug={m.slug} mode={hero === 'whole' ? 'whole' : 'bleed'} cands={cands} fallback={wall} />;
        })()}
        <div className="absolute top-3 right-4 z-20 text-xs text-white/70 flex flex-col items-end gap-1">
          <span className="flex gap-2">Follow and Copy
            {ACTS.map(([k, l]) => <Link key={k} href={q({ act: k })} className={act === k ? 'text-white underline underline-offset-2' : 'hover:text-white'}>{l}</Link>)}</span>
          <span className="flex gap-2">Bar
            {BARS.map(([k, l]) => <Link key={k} href={q({ bar: k })} className={bar === k ? 'text-white underline underline-offset-2' : 'hover:text-white'}>{l}</Link>)}</span>
          <span className="flex gap-2">Hero
            {HEROES.map(([k, l]) => <Link key={k} href={q({ hero: k })} className={hero === k ? 'text-white underline underline-offset-2' : 'hover:text-white'}>{l}</Link>)}</span>
          <span className="flex gap-2">Colour
            {TONES.map(([k, l]) => <Link key={k} href={q({ tone: k })} className={tone === k ? 'text-white underline underline-offset-2' : 'hover:text-white'}>{l}</Link>)}</span>
        </div>
        <div className={`${WRAP} relative w-full ${bar === 'bottom' ? 'pt-10 md:pt-14 pb-24 md:pb-28' : 'py-10 md:py-14'}`}>
          <div className="flex items-center justify-between gap-4 mb-3">
            <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 uppercase text-[10.5px] md:text-[13px] tracking-[0.15em] text-white/70">
              <Link href="/revamp/c" className="hover:text-white">Collections</Link>
            </nav>
            {act === 'top' && (
              <div className="flex items-center gap-4 text-[13px] md:text-[14px] text-white/80">
                <Link href={SIGN_IN} className="inline-flex items-center gap-1.5 hover:text-white"><Bell className="w-4 h-4" aria-hidden />Follow</Link>
                <Link href={SIGN_IN} className="inline-flex items-center gap-1.5 hover:text-white"><Copy className="w-4 h-4" aria-hidden />Copy to my collections</Link>
              </div>
            )}
          </div>
          <div className="flex items-end justify-between gap-6">
            <h1 className="font-serif text-[40px] md:text-[clamp(52px,5.6vw,84px)] leading-[1.02] tracking-[-0.03em]">{m.name}</h1>
            {act === 'icons' && (
              <div className="flex gap-1.5 shrink-0 mb-2">
                <Link href={SIGN_IN} aria-label="Follow" title="Follow" className={`w-11 h-11 grid place-items-center ${GLASS}`} style={{ background: fill(tone) }}><Bell className="w-[18px] h-[18px]" aria-hidden /></Link>
                <Link href={SIGN_IN} aria-label="Copy to my collections" title="Copy to my collections" className={`w-11 h-11 grid place-items-center ${GLASS}`} style={{ background: fill(tone) }}><Copy className="w-[18px] h-[18px]" aria-hidden /></Link>
              </div>
            )}
          </div>
          {m.short && <p className="mt-4 text-lg md:text-xl text-stone-200 max-w-2xl leading-relaxed">{m.short}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] md:text-[13.5px] font-medium">
            {counts.map((t, i) => <span key={t} style={{ color: RAMP[Math.min(i, RAMP.length - 1)] }}>{t}</span>)}
            <span className="text-white/60">{m.byline}</span>
          </div>
          {bar === 'inside' && <div className="mt-8 md:mt-10">
            <CollectionBars works={works} tone={tone} after={act === 'beside' && <>
              <Link href={SIGN_IN} className={`inline-flex items-center gap-2 px-4 sm:px-5 text-[13px] sm:text-sm ${GLASS}`} style={{ background: fill(tone) }}><Bell className="w-4 h-4" aria-hidden /><span className="hidden sm:inline">Follow</span></Link>
              <Link href={SIGN_IN} className={`inline-flex items-center gap-2 px-4 sm:px-5 text-[13px] sm:text-sm ${GLASS}`} style={{ background: fill(tone) }}><Copy className="w-4 h-4" aria-hidden /><span className="hidden sm:inline">Copy</span></Link>
            </>} />
          </div>}
        </div>
        {bar === 'bottom' && (
          <CollectionBars strip works={works} tone={tone} after={act === 'beside' && <>
            <span aria-hidden className="w-px my-4 bg-white/25 ml-1 sm:ml-2" />
            <Link href={SIGN_IN} className="inline-flex items-center gap-2 px-3.5 sm:px-5 text-[13px] sm:text-sm hover:bg-white/10"><Bell className="w-4 h-4" aria-hidden /><span className="hidden sm:inline">Follow</span></Link>
            <span aria-hidden className="w-px my-4 bg-white/25" />
            <Link href={SIGN_IN} className="inline-flex items-center gap-2 px-3.5 sm:px-5 text-[13px] sm:text-sm hover:bg-white/10 -mr-3.5 sm:-mr-5"><Copy className="w-4 h-4" aria-hidden /><span className="hidden sm:inline">Copy</span></Link>
          </>} />
        )}
      </section>

      <IntroBand m={m} />

      <CollectionItems slug={m.slug} books={m.all} notes={m.notes} plates={m.plates} imagesTotal={m.stats.images} byBook={m.byBook} opts={opts} />
    </div>
  );
}
