import { notFound } from 'next/navigation';
import Link from 'next/link';
import PlateWall from '../../_components/PlateWall';
import { Bell } from 'lucide-react';
import CollectionBars from '../../_components/CollectionBars';
import AskPanel from '../../_components/AskPanel';
import IntroBand from '../../_components/IntroBand';
import CollectionItems from '../../_components/CollectionItems';
import { RAMP } from '../../_lib/ramp';
import { Thumb } from '../../_components/CollectionsBrowser';
import { collectionModel, dataFile, indexItems } from '../../_lib/data';

interface Sorted { source: string; slug: string; proposed: string; proposed_subject?: string | null }
interface Subj { id: string; label: string; level: number; parents: string[] }
const n = (v: number) => v.toLocaleString('en-GB');
const WRAP = 'max-w-[var(--container-wide)] mx-auto px-6 md:px-12';
const H2 = 'text-2xl sm:text-3xl text-primary font-display'; // as CollectionItems
const SHOW = 10; // two rows; more go to the Collections page, filtered to this subject
const H3 = 'text-lg font-semibold text-primary mb-3';

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = collectionModel(slug);
  if (!m) notFound();
  const sorted = (dataFile<{ records: Sorted[] }>('sorting')?.records ?? []).filter((r) => r.source === 'collection');
  const about = indexItems(new Map(sorted.map((r) => [r.slug, r.proposed]))).filter((i) => sorted.find((r) => r.slug === i.slug)?.proposed_subject?.toLowerCase() === m.name.toLowerCase());
  const subjects = dataFile<{ subjects: Subj[] }>('subjects')?.subjects ?? [];
  const self = subjects.find((s) => s.label.toLowerCase() === m.name.toLowerCase());
  const parent = self?.parents[0] ? subjects.find((x) => x.id === self.parents[0]) : undefined;
  const works = m.all.length || m.stats.works;
  const langs = new Set(m.all.map((b) => b.language).filter(Boolean)).size;
  const years = m.all.map((b) => b.year).filter((y): y is number => !!y && y > 0);
  // The same coloured counts as a collection's hero; a subject has no maker, so no "Curated by".
  const counts = [works && `${n(works)} works`, m.stats.images && `${n(m.stats.images)} images`, langs > 1 && `${langs} languages`, years.length ? `${Math.min(...years)} – ${Math.max(...years)}` : ''].filter(Boolean) as string[];
  const narrower = self ? subjects.filter((s) => s.parents.includes(self.id)) : [];
  return (
    <div className="bg-cream min-h-screen">
      {/* The collection hero, minus what only a collection has (byline, Copy, a chosen picture). */}
      <section className="relative overflow-hidden text-white flex items-end min-h-[56svh] md:min-h-[75vh]" style={{ backgroundColor: '#1a1612' }}>
        <PlateWall tiles={m.heroTiles} rows={3} still />
        <div className={`${WRAP} relative w-full pt-10 md:pt-14 pb-20 md:pb-24`}>
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 uppercase text-[10.5px] md:text-[13px] tracking-[0.15em] mb-3 text-white/70">
            <Link href="/revamp/subjects" className="hover:text-white">Subjects</Link>
            {parent && <><span className="opacity-50">/</span><Link href={`/revamp/subjects#${parent.id}`} className="hover:text-white">{parent.label}</Link></>}
          </nav>
          <h1 className="font-serif text-[40px] md:text-[clamp(52px,5.6vw,84px)] leading-[1.02] tracking-[-0.03em]">{m.name}</h1>
          {m.short && <p className="mt-4 text-lg md:text-xl text-stone-200 max-w-2xl leading-relaxed">{m.short}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] md:text-[13.5px] font-medium">
            {counts.map((t, i) => <span key={t} style={{ color: RAMP[Math.min(i, RAMP.length - 1)] }}>{t}</span>)}
          </div>
        </div>
        <CollectionBars strip panel works={works} tone="ink" after={<>
          <span aria-hidden className="w-px my-4 bg-white/25 ml-1 sm:ml-2" />
          <Link href="/auth/signin?callbackUrl=%2Fsubjects" className="inline-flex items-center gap-2 px-3.5 sm:px-5 -mr-3.5 sm:-mr-5 text-[13px] sm:text-sm hover:bg-white/10"><Bell className="w-4 h-4" aria-hidden /><span className="hidden sm:inline">Follow</span></Link>
        </>} />
      </section>
      <AskPanel books={m.all} plates={m.plates} byBook={m.byBook} scope="subject" name={m.name} />
      <IntroBand m={m} />
      {(narrower.length > 0 || about.length > 0) && (
        <section className="bg-cream border-b border-border-light">
          <div className={`${WRAP} py-10 md:py-14`}>
            <h2 className={`${H2} mb-6 md:mb-8`}>Inside {m.name}</h2>
            {narrower.length > 0 && (
              <div className={about.length > 0 ? 'mb-8 md:mb-10' : ''}>
                <h3 className={H3}>Subjects</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">{narrower.map((s) => <Link key={s.id} href={`/revamp/subjects#${s.id}`} className="block bg-white border border-border-light px-[18px] py-3.5 text-[15px] text-primary hover:border-primary transition-colors">{s.label}</Link>)}</div>
              </div>
            )}
            {about.length > 0 && (
              <div>
                <div className="flex items-baseline justify-between gap-4"><h3 className={H3}>Collections</h3>{about.length > SHOW && <Link href={`/revamp/c?subject=${encodeURIComponent(m.name)}`} className="text-sm text-primary underline underline-offset-2 decoration-border-medium hover:decoration-primary">See all {about.length} collections</Link>}</div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-7">
                  {about.slice(0, SHOW).map((c) => (
                    <Link key={c.slug} href={c.href} className="block group"><Thumb item={c} mode="square" /><span className="block mt-2.5 font-serif text-[17px] leading-snug text-primary group-hover:underline underline-offset-2">{c.name}</span></Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
      <CollectionItems slug={m.slug} books={m.all} notes={[]} plates={m.plates} imagesTotal={m.stats.images} byBook={m.byBook} curated={false} />
    </div>
  );
}
