import Link from 'next/link';
import PlateWall from '../_components/PlateWall';
import { RAMP } from '../_lib/ramp';
import CollectionsBrowser from '../_components/CollectionsBrowser';
import { collectionModel, dataFile, indexItems } from '../_lib/data';
import { demoItems } from '../_lib/demos-index';

const FEATS: [string, string][] = [['box', 'A Box'], ['right', 'B Right-aligned'], ['micro', 'C Micro line'], ['label', 'D Wall label'], ['caption', 'E Caption strip'], ['credit', 'F Picture credit']];
const MICRO = 'uppercase tracking-[0.16em] text-[10.5px] md:text-[11px]';

const n = (v: number) => v.toLocaleString('en-GB');

interface Sorted { source: string; slug: string; name: string; proposed: string; proposed_subject?: string | null }

export default async function Page({ searchParams }: { searchParams: Promise<{ subject?: string; feat?: string }> }) {
  const { subject, feat: featPick } = await searchParams;
  const filters = 'menus' as const;
  const feat = FEATS.find(([k]) => k === featPick)?.[0] ?? 'box';
  const sched = dataFile<{ entries: { collection: string }[] }>('schedule');
  const lead = sched?.entries[0] ? collectionModel(sched.entries[0].collection) : null;
  const sorted = (dataFile<{ records: Sorted[] }>('sorting')?.records ?? []).filter((r) => r.source === 'collection');
  const items = [...indexItems(new Map(sorted.map((r) => [r.slug, r.proposed]))), ...demoItems()];
  const bySubject = new Map<string, string[]>();
  sorted.forEach((r) => { if (r.proposed_subject) bySubject.set(r.proposed_subject, [...(bySubject.get(r.proposed_subject) ?? []), r.slug]); });
  const subjects = [...bySubject.entries()].filter(([, s]) => s.some((x) => items.some((i) => i.slug === x))).map(([name, slugs]) => ({ name, slugs })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="bg-cream min-h-screen">
      <section className="relative overflow-hidden text-white min-h-[46svh] md:min-h-[60vh] flex items-end">
        <PlateWall tiles={lead?.heroTiles ?? []} rows={3} still />
        <div className="absolute top-3 left-4 z-20 text-xs text-white/70 flex flex-wrap gap-x-3 gap-y-1">
          Featured
          {FEATS.map(([k, l]) => <Link key={k} href={`/revamp/c?feat=${k}`} className={feat === k ? 'text-white underline underline-offset-2' : 'hover:text-white'}>{l}</Link>)}
        </div>
        {lead && feat === 'credit' && (
          // Gallery style: the hero pictures are this collection's plates, so it is credited like a picture.
          <Link href={`/revamp/c/${lead.slug}`} className="group absolute top-4 right-4 md:right-12 z-20 text-right max-w-[300px]">
            <span className={`block ${MICRO} text-white/60`}>Plates from</span>
            <span className="block text-[13px] md:text-[14px] text-white mt-0.5 underline decoration-white/40 underline-offset-[3px] group-hover:decoration-white">{lead.name}</span>
          </Link>
        )}
        <div className={`max-w-[1500px] mx-auto px-6 md:px-12 relative w-full pt-12 md:pt-16 ${feat === 'caption' ? 'pb-20 md:pb-24' : 'pb-10 md:pb-14'} flex flex-col md:flex-row md:items-end md:justify-between gap-8`}>
          <div>
            <h1 className="font-serif text-[44px] md:text-[clamp(52px,5.6vw,84px)] leading-[1.02] tracking-[-0.03em]">Collections</h1>
            <p className="mt-4 text-lg md:text-xl text-stone-200 max-w-2xl leading-relaxed">Books, pages, plates and quotes chosen by Source Library and by readers.</p>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[14px] md:text-[15px] font-medium">
              {[`${items.length} collections`, `${subjects.length} subjects`].map((l, i) => <span key={l} style={{ color: RAMP[i] }}>{l}</span>)}
            </div>
          </div>
          {lead && feat === 'box' && (
            <Link href={`/revamp/c/${lead.slug}`} className="group block md:max-w-[320px] border border-white/25 hover:border-white bg-black/30 px-4 py-3 transition-colors">
              <span className="block text-[12.5px] text-white/70">Featured</span>
              <span className="block font-serif text-[24px] leading-tight mt-0.5">{lead.name} <span aria-hidden className="inline-block text-[18px] transition-transform group-hover:translate-x-1">→</span></span>
              {lead.short && <span className="block text-[13.5px] text-stone-200 mt-1 truncate">{lead.short}</span>}
            </Link>
          )}
          {lead && feat === 'right' && (
            <Link href={`/revamp/c/${lead.slug}`} className="group block md:text-right md:max-w-[380px]">
              <span className={`block ${MICRO} text-white/60`}>Featured collection</span>
              <span className="block font-serif text-[30px] md:text-[36px] leading-[1.05] mt-2">{lead.name}</span>
              {lead.short && <span className="block text-[14.5px] text-stone-200 mt-2">{lead.short}</span>}
              <span className={`inline-block mt-3 ${MICRO} text-white border-b border-white/50 group-hover:border-white pb-0.5`}>See the collection</span>
            </Link>
          )}
          {lead && feat === 'micro' && (
            <Link href={`/revamp/c/${lead.slug}`} className={`group block md:text-right ${MICRO} text-white/70 leading-relaxed`}>
              <span className="text-white/50">Featured</span><span className="mx-2 text-white/30">/</span><span className="text-white group-hover:underline underline-offset-[3px]">{lead.name}</span>
              <span className="block normal-case tracking-normal text-[12.5px] text-white/60 mt-1">{lead.short}</span>
            </Link>
          )}
          {lead && feat === 'label' && (
            // Gallery wall label: thin rule, small type, the facts in order.
            <Link href={`/revamp/c/${lead.slug}`} className="group block md:w-[280px] border-t border-white/60 pt-3 text-[12.5px] leading-[1.55] text-white/75">
              <span className={`block ${MICRO} text-white/55 mb-1.5`}>Featured</span>
              <span className="block text-[14px] font-semibold text-white">{lead.name}</span>
              <span className="block">{lead.byline}</span>
              <span className="block">{[lead.stats.works > 0 && `${n(lead.stats.works)} works`, lead.stats.images > 0 && `${n(lead.stats.images)} images`].filter(Boolean).join(', ')}</span>
              {lead.short && <span className="block mt-2 text-white/85">{lead.short}</span>}
              <span className="block mt-2 text-white underline decoration-white/40 underline-offset-[3px] group-hover:decoration-white">See the collection</span>
            </Link>
          )}
        </div>
        {lead && feat === 'caption' && (
          <Link href={`/revamp/c/${lead.slug}`} className="group absolute inset-x-0 bottom-0 z-10 border-t border-white/10 backdrop-blur-md" style={{ background: 'rgba(20,16,12,.88)' }}>
            <span className="max-w-[1500px] mx-auto px-6 md:px-12 h-12 flex items-center gap-4 text-[12.5px] text-white/70">
              <span className={`${MICRO} text-white/50 shrink-0`}>Featured</span>
              <span className="text-white shrink-0">{lead.name}</span>
              <span className="hidden md:block truncate">{lead.short}</span>
              <span className="ml-auto shrink-0 text-white group-hover:underline underline-offset-[3px]">See the collection →</span>
            </span>
          </Link>
        )}
      </section>
      <CollectionsBrowser items={items} featured={lead?.slug} subjects={subjects} initialSubject={subjects.some((x) => x.name === subject) ? subject : ''} hideTitle filters={filters} />
      <section className="bg-warm border-t border-border-light">
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 md:py-10 grid md:grid-cols-[1fr_auto] gap-6 md:gap-12 items-center">
          <div>
            <h2 className="font-serif text-3xl md:text-4xl text-primary leading-[1.05] tracking-tight">Make your own collection</h2>
            <p className="text-secondary mt-3 max-w-2xl leading-relaxed">Gather the books, pages, plates, artworks and quotes you find as you read, in any mix. Give it a name and a picture, and it appears here under your username next to ours.</p>
          </div>
          <div className="md:text-right">
            <Link href="/auth/signin?callbackUrl=%2Fcollections" className="inline-flex bg-primary text-cream text-sm font-medium px-6 py-3">Sign in to start</Link>
            <p className="text-[13px] text-muted mt-2">New here? Signing in makes your free account.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
