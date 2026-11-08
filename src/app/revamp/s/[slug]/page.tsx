import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { CollectionBook } from '@/components/CollectionBookCard';
import WorksGrid from '../../_components/WorksGrid';
import GalleryMasonry from '@/components/GalleryMasonry';
import PlateWall from '../../_components/PlateWall';
import SubjectSearch from '../../_components/SubjectSearch';
import OverviewBand from '../../_components/OverviewBand';
import { Thumb } from '../../_components/CollectionsBrowser';
import { collectionModel, dataFile, indexItems } from '../../_lib/data';

interface Sorted { source: string; slug: string; proposed: string; proposed_subject?: string | null }
interface Subj { id: string; label: string; level: number; parents: string[] }
const n = (v: number) => v.toLocaleString('en-GB');
const WRAP = 'max-w-[var(--container-wide)] mx-auto px-6 md:px-12';
const H2 = 'font-serif text-3xl md:text-4xl text-primary leading-[1.05] tracking-tight';
const SHOW = 10; // two rows; more go to the Collections page, filtered to this subject
const H3 = 'text-lg font-semibold text-primary mb-3';

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ hero?: string }> }) {
  const { slug } = await params;
  const full = (await searchParams).hero === '100';
  const m = collectionModel(slug);
  if (!m) notFound();
  const sorted = (dataFile<{ records: Sorted[] }>('sorting')?.records ?? []).filter((r) => r.source === 'collection');
  const about = indexItems(new Map(sorted.map((r) => [r.slug, r.proposed]))).filter((i) => sorted.find((r) => r.slug === i.slug)?.proposed_subject?.toLowerCase() === m.name.toLowerCase());
  const subjects = dataFile<{ subjects: Subj[] }>('subjects')?.subjects ?? [];
  const self = subjects.find((s) => s.label.toLowerCase() === m.name.toLowerCase());
  const parent = self?.parents[0] ? subjects.find((x) => x.id === self.parents[0]) : undefined;
  const narrower = self ? subjects.filter((s) => s.parents.includes(self.id)) : [];
  return (
    <div className="bg-cream min-h-screen">
      <section className={`relative overflow-hidden text-white flex items-end ${full ? 'min-h-[calc(100svh-3.5rem)] lg:min-h-[calc(100svh-4rem)]' : 'min-h-[56svh] md:min-h-[75vh]'}`}>
        <PlateWall tiles={m.heroTiles} rows={3} still />
        <div className="absolute top-3 right-4 z-20 text-xs text-white/70 flex gap-2">
          Hero height
          <Link href={`/revamp/s/${m.slug}`} className={full ? '' : 'text-white underline underline-offset-2'}>75%</Link>
          <Link href={`/revamp/s/${m.slug}?hero=100`} className={full ? 'text-white underline underline-offset-2' : ''}>100%</Link>
        </div>
        <div className={`${WRAP} relative w-full py-10 md:py-14`}>
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 uppercase text-[10.5px] md:text-[13px] tracking-[0.15em] mb-3 text-white/70">
            <Link href="/revamp/subjects" className="hover:text-white">Subjects</Link>
            {parent && <><span className="opacity-50">/</span><Link href={`/revamp/subjects#${parent.id}`} className="hover:text-white">{parent.label}</Link></>}
          </nav>
          <h1 className="font-serif text-[44px] md:text-[clamp(52px,5.6vw,84px)] leading-[1.02] tracking-[-0.03em]">{m.name}</h1>
          {m.intro[0] && <p className="mt-4 text-lg md:text-xl text-stone-200 max-w-2xl leading-relaxed">{m.intro[0]}</p>}
          <div className="on-dark mt-8 md:mt-10">
            <SubjectSearch name={m.name} authors={[...new Set(m.books.map((b) => (b.author || '').split(/[;,|]/)[0].trim()).filter((a) => a && !/unknown|anonym/i.test(a)))].slice(0, 3)} />
          </div>
        </div>
      </section>
      {m.overview && <div className={`${WRAP} py-8 md:py-10`}><OverviewBand o={m.overview} /></div>}
      {(narrower.length > 0 || about.length > 0) && (
        <section className="bg-warm border-y border-border-light">
          <div className={`${WRAP} py-10 md:py-14`}>
            <h2 className={`${H2} mb-6 md:mb-8`}>Inside {m.name}</h2>
            {narrower.length > 0 && (
              <div className={about.length > 0 ? 'mb-8 md:mb-10' : ''}>
                <h3 className={H3}>Narrower subjects</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">{narrower.map((s) => <Link key={s.id} href={`/revamp/subjects#${s.id}`} className="block bg-white border border-border-light px-[18px] py-3.5 text-[15px] text-primary hover:border-primary transition-colors">{s.label}</Link>)}</div>
              </div>
            )}
            {about.length > 0 && (
              <div>
                <div className="flex items-baseline justify-between gap-4"><h3 className={H3}>Collections</h3>{about.length > SHOW && <Link href={`/revamp/c?subject=${encodeURIComponent(m.name)}`} className="text-sm text-primary underline underline-offset-2 decoration-border-medium hover:decoration-primary">See all {about.length} collections</Link>}</div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-7">
                  {about.slice(0, SHOW).map((c) => (
                    <Link key={c.slug} href={c.href} className="block group"><Thumb item={c} mode="grid" /><span className="block mt-2.5 font-serif text-[17px] leading-snug text-primary group-hover:underline underline-offset-2">{c.name}</span></Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
      <section className={`${WRAP} py-10 md:py-14`}>
        <div className="flex items-end justify-between mb-6"><h2 className={H2}>Works</h2><span className="text-sm text-muted">{n(m.stats.works)} works</span></div>
        <WorksGrid books={m.books as unknown as CollectionBook[]} total={m.stats.works} slug={m.slug} />
      </section>
      {m.plates.length > 0 && (
        <section className="bg-warm border-t border-border-light">
          <div className={`${WRAP} py-10 md:py-14`}>
            <div className="flex items-end justify-between mb-6"><h2 className={H2}>Images</h2><span className="text-sm text-muted">{n(m.stats.images)} images</span></div>
            <div className="max-h-[720px] overflow-hidden"><GalleryMasonry plates={m.plates.slice(0, 30)} /></div>
          </div>
        </section>
      )}
    </div>
  );
}
