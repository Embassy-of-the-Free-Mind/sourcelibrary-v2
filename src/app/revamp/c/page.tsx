import Link from 'next/link';
import HeroMosaic from '../_components/HeroMosaic';
import HeroScrim from '@/components/HeroScrim';
import CollectionsBrowser from '../_components/CollectionsBrowser';
import { collectionModel, dataFile, indexItems } from '../_lib/data';
import { demoItems } from '../_lib/demos-index';

interface Sorted { source: string; slug: string; name: string; proposed: string; proposed_subject?: string | null }

export default async function Page({ searchParams }: { searchParams: Promise<{ hero?: string; subject?: string }> }) {
  const { hero, subject } = await searchParams;
  const full = hero === '100';
  const sched = dataFile<{ entries: { collection: string }[] }>('schedule');
  const lead = sched?.entries[0] ? collectionModel(sched.entries[0].collection) : null;
  const sorted = (dataFile<{ records: Sorted[] }>('sorting')?.records ?? []).filter((r) => r.source === 'collection');
  const items = [...indexItems(new Map(sorted.map((r) => [r.slug, r.proposed]))), ...demoItems()];
  const bySubject = new Map<string, string[]>();
  sorted.forEach((r) => { if (r.proposed_subject) bySubject.set(r.proposed_subject, [...(bySubject.get(r.proposed_subject) ?? []), r.slug]); });
  const subjects = [...bySubject.entries()].filter(([, s]) => s.some((x) => items.some((i) => i.slug === x))).map(([name, slugs]) => ({ name, slugs })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="bg-cream min-h-screen">
      {lead && (
        <section className={`relative overflow-hidden flex items-end md:items-center ${full ? 'min-h-[calc(100svh-3.5rem)] lg:min-h-[calc(100svh-4rem)]' : 'min-h-[56svh] md:min-h-[75vh]'}`} style={{ backgroundColor: '#1a1612' }}>
          <HeroMosaic tiles={lead.heroTiles} />
          <div className="absolute inset-0 md:hidden"><HeroScrim variant="bottom" /></div>
          <div className="absolute inset-0 hidden md:block"><HeroScrim /></div>
          <div className="absolute top-3 right-4 z-20 text-xs text-white/70 flex gap-2">
            Hero height
            <Link href="/revamp/c" className={full ? '' : 'text-white underline underline-offset-2'}>75%</Link>
            <Link href="/revamp/c?hero=100" className={full ? 'text-white underline underline-offset-2' : ''}>100%</Link>
          </div>
          <div className="relative z-10 w-full max-w-[1500px] mx-auto px-6 md:px-12 py-12 md:py-16" style={{ textShadow: '0 1px 12px rgba(0,0,0,.5)' }}>
            <p className="text-white/70 text-sm mb-2">Featured collection</p>
            <h2 className="text-4xl sm:text-5xl md:text-7xl text-white font-semibold leading-tight mb-3 font-display"><Link href={`/revamp/c/${lead.slug}`}>{lead.name}</Link></h2>
            <p className="text-lg sm:text-xl text-white/75 max-w-3xl leading-relaxed mb-6">{lead.deck}</p>
            <Link href={`/revamp/c/${lead.slug}`} className="inline-flex bg-white text-primary text-sm font-medium px-5 py-2.5" style={{ textShadow: 'none' }}>Open the collection</Link>
          </div>
        </section>
      )}
      <section className="bg-warm border-b border-border-light">
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
      <CollectionsBrowser items={items} featured={lead?.slug} subjects={subjects} initialSubject={subjects.some((x) => x.name === subject) ? subject : ''} />
    </div>
  );
}
