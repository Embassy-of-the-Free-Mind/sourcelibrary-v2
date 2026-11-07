'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen } from 'lucide-react';
import HeroScrim from '@/components/HeroScrim';
import { Thumb } from './CollectionsBrowser';
import type { IndexItem } from '../_lib/data';

export interface HomeBook { id: string; href: string; cover: string; title: string; author: string; year?: number }
export interface HomeFeature { slug: string; name: string; deck: string; plates: { src: string; ratio: number }[]; books: HomeBook[]; works: number; images: number; years: string | null; firstTranslations: number }

const LAYOUTS = [['a', 'A'], ['b', 'B'], ['c', 'C']] as const;
type L = (typeof LAYOUTS)[number][0];
const n = (v: number) => v.toLocaleString('en-GB');
const FULL = 'relative overflow-hidden text-white min-h-[calc(100svh-3.5rem)] lg:min-h-[calc(100svh-4rem)] flex flex-col';
const PAD = 'w-full max-w-[var(--container-wide)] mx-auto px-6 md:px-12';
const TITLE = 'text-balance font-serif text-[44px] leading-[1.02] md:text-[clamp(56px,6.2vw,92px)] tracking-[-0.03em]';

/* The /about pills. */
function Pills({ f }: { f: HomeFeature }) {
  const items: [string, string, string][] = [
    [n(f.works), 'works', '#8fbfe6'], [n(f.images), 'images', '#86c9b4'],
    ...(f.firstTranslations ? [[String(f.firstTranslations), 'first translations', '#e0b46a'] as [string, string, string]] : []),
  ];
  return (
    <ul className="flex flex-wrap gap-2 m-0 p-0 list-none">
      {items.map(([v, l, c]) => <li key={l} className="m-0 px-3 py-1.5 text-sm md:text-[15px] text-stone-200 border border-white/20 bg-white/[0.06]"><b className="font-semibold tabular-nums" style={{ color: c }}>{v}</b> {l}</li>)}
    </ul>
  );
}

const Open = ({ f }: { f: HomeFeature }) => (
  <Link href={`/revamp/c/${f.slug}`} className="inline-flex items-center gap-2.5 bg-accent-rust text-white text-[15px] font-medium px-6 py-3.5">
    <BookOpen className="w-4 h-4" /> Explore the collection
  </Link>
);
const All = ({ dark }: { dark?: boolean }) => (
  <Link href="/revamp/c" className={`inline-flex items-center gap-1.5 text-[15px] underline underline-offset-4 decoration-1 ${dark ? 'text-primary' : 'text-white'}`}>See all collections <ArrowRight className="w-4 h-4" /></Link>
);

/* A plain row of covers. No frame, no arrows: it just scrolls. */
function Covers({ f, h }: { f: HomeFeature; h: string }) {
  return (
    <div className="flex gap-3 md:gap-4 overflow-x-auto [scrollbar-width:none] snap-x">
      {f.books.map((b) => (
        <Link key={b.id} href={b.href} className="shrink-0 snap-start" title={b.title}>
          <img src={b.cover} alt={b.title} loading="lazy" className={`${h} w-auto block shadow-[0_8px_24px_rgba(0,0,0,.45)]`} />
        </Link>
      ))}
    </div>
  );
}

/* Secondary: smaller than the feature, on the page's light ground. */
function Popular({ pop }: { pop: IndexItem[] }) {
  return (
    <section className="bg-cream border-t border-border-light">
      <div className={`${PAD} py-8 md:py-10`}>
        <div className="flex items-baseline justify-between gap-4 mb-4">
          <h2 className="font-serif text-2xl md:text-3xl text-primary leading-tight tracking-tight">Popular this week</h2>
          <All dark />
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-x-4 gap-y-5">
          {pop.slice(0, 6).map((c) => (
            <Link key={c.slug} href={c.href} className="block group">
              <Thumb item={c} mode="grid" />
              <span className="block mt-2 text-[14px] leading-snug text-primary group-hover:underline underline-offset-2">{c.name}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function HomeLayouts({ features, popular }: { features: HomeFeature[]; popular: IndexItem[] }) {
  const [l, setL] = useState<L>('a');
  const [i, setI] = useState(0);
  const [bare, setBare] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (['a', 'b', 'c'].includes(q.get('l') ?? '')) setL(q.get('l') as L);
    setBare(q.has('bare'));
  }, []);
  const f = features[i];
  if (!f) return <p className="p-10 text-muted">Waiting for the snapshot.</p>;
  const pop = popular.filter((p) => p.slug !== f.slug);
  const deck = `${f.deck.split('. ')[0].replace(/\.$/, '')}.`;
  const eyebrow = (c: string) => <p className="uppercase text-[10.5px] md:text-[13px] tracking-[0.15em] mb-3" style={{ color: c }}>Featured collection</p>;
  const lead = f.plates[0];
  const three = f.plates.filter((p) => p.ratio < 1).slice(0, 3);

  return (
    <div className="bg-cream">
      {l === 'a' && (
        <section className="bg-warm min-h-[calc(100svh-3.5rem)] lg:min-h-[calc(100svh-4rem)] flex flex-col">
          <div className={`${PAD} flex-1 grid md:grid-cols-[1.1fr_1fr] gap-8 md:gap-14 items-center py-8 md:py-10`}>
            <div className="min-w-0 order-2 md:order-1">
              {eyebrow('#6b6560')}
              <h1 className="text-balance font-serif text-[44px] leading-[1.02] md:text-[clamp(56px,6.2vw,92px)] tracking-[-0.03em] text-primary"><Link href={`/revamp/c/${f.slug}`}>{f.name}</Link></h1>
              <p className="mt-5 text-lg md:text-xl text-secondary max-w-xl leading-relaxed">{deck}</p>
              <div className="mt-7"><Open f={f} /></div>
            </div>
            <div className="order-1 md:order-2 flex justify-center">
              {lead && <img src={lead.src} alt="" className="block max-h-[42svh] md:max-h-[calc(100svh-15rem)] w-auto max-w-full mix-blend-multiply" />}
            </div>
          </div>
          <div className={`${PAD} pb-6`}><Covers f={f} h="h-[90px] md:h-[120px]" /></div>
        </section>
      )}

      {l === 'b' && (
        <section className={FULL} style={{ background: '#1a1612' }}>
          <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 82% 18%, rgba(165,80,61,0.2) 0%, transparent 55%)' }} />
          <div className={`${PAD} relative flex-1 grid lg:grid-cols-[1fr_1.25fr] gap-8 lg:gap-14 items-center py-8 md:py-10`}>
            <div className="min-w-0">
              {eyebrow('rgba(255,255,255,.7)')}
              <h1 className="text-balance font-serif text-[44px] leading-[1.02] md:text-[clamp(52px,5.4vw,84px)] tracking-[-0.03em]"><Link href={`/revamp/c/${f.slug}`}>{f.name}</Link></h1>
              <p className="mt-5 text-lg text-stone-200 max-w-xl leading-relaxed">{deck}</p>
              <div className="mt-6"><Pills f={f} /></div>
              <div className="mt-7"><Open f={f} /></div>
            </div>
            <div className="flex gap-3 md:gap-4 items-center justify-center min-w-0">
              {three.map((p, k) => <img key={p.src} src={p.src} alt="" className={`block min-w-0 w-auto object-contain ${k === 1 ? 'max-h-[34svh] md:max-h-[calc(100svh-17rem)]' : 'max-h-[28svh] md:max-h-[calc(100svh-22rem)]'}`} style={{ maxWidth: '33%' }} />)}
            </div>
          </div>
          <div className={`${PAD} relative pb-6`}><Covers f={f} h="h-[90px] md:h-[120px]" /></div>
        </section>
      )}

      {l === 'c' && (
        <section className={FULL} style={{ background: '#1a1612' }}>
          {lead && <img src={lead.src} alt="" className="absolute inset-0 w-full h-full object-cover" />}
          <HeroScrim />
          <div className={`${PAD} relative flex-1 flex flex-col justify-end pt-12 pb-6`}>
            {eyebrow('rgba(255,255,255,.7)')}
            <h1 className="text-balance font-serif text-[44px] leading-[1.02] md:text-[clamp(56px,6.2vw,92px)] tracking-[-0.03em]"><Link href={`/revamp/c/${f.slug}`}>{f.name}</Link></h1>
            <p className="mt-5 text-lg md:text-xl text-stone-200 max-w-2xl leading-relaxed">{deck}</p>
            <div className="mt-6 flex flex-wrap items-center gap-4"><Open f={f} /></div>
          </div>
          <div className={`${PAD} relative pb-6`}><Covers f={f} h="h-[90px] md:h-[120px]" /></div>
        </section>
      )}

      <Popular pop={pop} />

      {!bare && (
        <div className="fixed top-[74px] right-4 z-[60] flex flex-wrap gap-1 items-center bg-white border border-border-medium p-1.5 text-xs shadow-lg max-w-[92vw]">
          {LAYOUTS.map(([k, t]) => <button key={k} type="button" aria-pressed={l === k} onClick={() => setL(k)} className={`w-7 h-7 ${l === k ? 'bg-primary text-cream' : 'text-primary'}`}>{t}</button>)}
          <span className="w-px h-4 bg-border-medium mx-1" />
          {features.map((x, k) => <button key={x.slug} type="button" aria-pressed={k === i} onClick={() => setI(k)} className={`px-2 h-7 ${k === i ? 'bg-primary text-cream' : 'text-primary'}`}>{x.name}</button>)}
          <a href="http://localhost:3152/phones" className="px-2 h-7 grid place-items-center underline underline-offset-2">Phones</a>
        </div>
      )}
    </div>
  );
}
