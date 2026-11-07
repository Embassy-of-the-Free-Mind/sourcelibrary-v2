'use client';

/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import Link from 'next/link';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import GalleryMasonry, { type Plate } from '@/components/GalleryMasonry';
import HeroScrim from '@/components/HeroScrim';
import HeroMosaic from './HeroMosaic';

export interface FeaturedItem { slug: string; name: string; deck: string; start: string; end: string; tiles: string[]; books: CollectionBook[]; plates: Plate[]; total: number }
const TABS = ['Homepage', 'Library', 'Gallery'] as const;

export default function FeaturedPreview({ items }: { items: FeaturedItem[] }) {
  const [i, setI] = useState(0);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Homepage');
  const c = items[i];
  if (!c) return <p className="p-10 text-muted">Waiting for the snapshot of these collections.</p>;
  const btn = (on: boolean) => `px-3 py-1.5 text-sm border ${on ? 'bg-dark text-white border-dark' : 'border-border-medium text-primary'}`;
  const sort = (what: string) => (
    <div className="flex flex-wrap justify-between gap-3 items-center text-sm mb-5">
      <span className="text-secondary">Showing {what} from <Link className="underline underline-offset-2" href={`/revamp/c/${c.slug}`}>{c.name}</Link> first, then {tab === 'Library' ? 'the whole library' : 'everything else'}</span>
      <span className="border border-border-medium px-3 py-1.5">Sort: Featured first ▾</span>
    </div>
  );
  return (
    <div>
      <div className="max-w-[1500px] mx-auto px-6 md:px-12 pt-8 pb-5">
        <h1 className="text-3xl text-primary font-display mb-2">Featured collection</h1>
        <p className="text-sm text-muted mb-4 max-w-2xl">Everything below comes from one schedule file. Pick a week to see what the site would show. These dates and collections are examples, not suggestions. The schedule works the same for daily or weekly changes.</p>
        <div className="flex flex-wrap gap-2 mb-3">{items.map((x, n) => <button key={x.slug} type="button" aria-pressed={n === i} className={btn(n === i)} onClick={() => setI(n)}>{x.start}: {x.name}</button>)}</div>
        <div className="flex flex-wrap gap-2">{TABS.map((t) => <button key={t} type="button" aria-pressed={t === tab} className={btn(t === tab)} onClick={() => setTab(t)}>{t}</button>)}</div>
      </div>
      {tab === 'Homepage' && (
        <>
          <section className="relative overflow-hidden min-h-[60vh] flex items-end" style={{ backgroundColor: '#1a1612' }}>
            <HeroMosaic tiles={c.tiles} />
            <div className="absolute inset-0"><HeroScrim variant="bottom" /></div>
            <div className="relative z-10 w-full max-w-[1500px] mx-auto px-6 md:px-12 py-12">
              <h2 className="text-4xl md:text-6xl text-white font-display mb-3">{c.name}</h2>
              <p className="text-white/75 max-w-3xl text-lg mb-5">{c.deck}</p>
              <Link href={`/revamp/c/${c.slug}`} className="inline-flex bg-white text-primary text-sm font-medium px-5 py-2.5">Explore the {c.total.toLocaleString('en-GB')} books</Link>
            </div>
          </section>
          <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {c.books.slice(0, 5).map((b) => <CollectionBookCard key={b.id} book={b} />)}
          </div>
        </>
      )}
      {tab === 'Library' && (
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-6">
          {sort('books')}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">{c.books.slice(0, 15).map((b) => <CollectionBookCard key={b.id} book={b} />)}</div>
        </div>
      )}
      {tab === 'Gallery' && (
        <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-6">
          {sort('plates')}
          <GalleryMasonry plates={c.plates.slice(0, 30)} />
        </div>
      )}
    </div>
  );
}
