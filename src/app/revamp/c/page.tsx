import Link from 'next/link';
import PlateWall from '../_components/PlateWall';
import CollectionBars from '../_components/CollectionBars';
import { LookSwitch, PlainHead, lookOf } from '../_components/IndexLook';
import { RAMP } from '../_lib/ramp';
import CollectionsBrowser from '../_components/CollectionsBrowser';
import { collectionModel, dataFile, indexItems } from '../_lib/data';
import { demoItems } from '../_lib/demos-index';

const MICRO = 'uppercase tracking-[0.16em] text-[10.5px] md:text-[11px]';


interface Sorted { source: string; slug: string; name: string; proposed: string; proposed_subject?: string | null }

export default async function Page({ searchParams }: { searchParams: Promise<{ subject?: string; look?: string }> }) {
  const { subject, look: lk } = await searchParams;
  const look = lookOf(lk);
  const filters = 'menus' as const;
  const sched = dataFile<{ entries: { collection: string }[] }>('schedule');
  const lead = sched?.entries[0] ? collectionModel(sched.entries[0].collection) : null;
  const sorted = (dataFile<{ records: Sorted[] }>('sorting')?.records ?? []).filter((r) => r.source === 'collection');
  const items = [...indexItems(new Map(sorted.map((r) => [r.slug, r.proposed]))), ...demoItems()];
  const bySubject = new Map<string, string[]>();
  sorted.forEach((r) => { if (r.proposed_subject) bySubject.set(r.proposed_subject, [...(bySubject.get(r.proposed_subject) ?? []), r.slug]); });
  const subjects = [...bySubject.entries()].filter(([, s]) => s.some((x) => items.some((i) => i.slug === x))).map(([name, slugs]) => ({ name, slugs })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="bg-cream min-h-screen">
      {look !== 'hero' ? <PlainHead title="Collections" path="/revamp/c" look={look} featured={lead && { name: lead.name, href: `/revamp/c/${lead.slug}` }} /> : (
      <section className="relative overflow-hidden text-white min-h-[46svh] md:min-h-[60vh] flex items-end">
        <PlateWall tiles={lead?.heroTiles ?? []} rows={3} still />
        <div className="absolute top-3 right-4 z-20"><LookSwitch path="/revamp/c" look={look} dark /></div>
        <div className={`max-w-[1500px] mx-auto px-6 md:px-12 relative w-full pt-12 md:pt-16 pb-20 md:pb-24 flex flex-col md:flex-row md:items-end md:justify-between gap-8`}>
          <div>
            <h1 className="font-serif text-[44px] md:text-[clamp(52px,5.6vw,84px)] leading-[1.02] tracking-[-0.03em]">Collections</h1>
            <p className="mt-4 text-lg md:text-xl text-stone-200 max-w-2xl leading-relaxed">Books, pages, plates and quotes chosen by Source Library and by readers.</p>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[14px] md:text-[15px] font-medium">
              {[`${items.length} collections`, `${subjects.length} subjects`].map((l, i) => <span key={l} style={{ color: RAMP[i] }}>{l}</span>)}
            </div>
          </div>
          {lead && (
            <Link href={`/revamp/c/${lead.slug}`} className={`group block md:text-right ${MICRO} text-white/70 leading-relaxed`}>
              <span className="text-white/50">Featured</span><span className="mx-2 text-white/30">/</span><span className="text-white whitespace-nowrap group-hover:underline underline-offset-[3px]">{lead.name}</span>
            </Link>
          )}
        </div>
        <CollectionBars strip live works={items.length} placeholder="Search collections or ask a question" scope={`all ${items.length} collections`} />
      </section>
      )}
      <CollectionsBrowser barSearch={look === 'hero'} look={look} items={items} featured={lead?.slug} subjects={subjects} initialSubject={subjects.some((x) => x.name === subject) ? subject : ''} hideTitle filters={filters} />
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
