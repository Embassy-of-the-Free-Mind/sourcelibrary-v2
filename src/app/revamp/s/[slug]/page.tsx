import { notFound } from 'next/navigation';
import Link from 'next/link';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
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

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = collectionModel(slug);
  if (!m) notFound();
  const sorted = (dataFile<{ records: Sorted[] }>('sorting')?.records ?? []).filter((r) => r.source === 'collection');
  const about = indexItems(new Map(sorted.map((r) => [r.slug, r.proposed]))).filter((i) => sorted.find((r) => r.slug === i.slug)?.proposed_subject?.toLowerCase() === m.name.toLowerCase());
  const subjects = dataFile<{ subjects: Subj[] }>('subjects')?.subjects ?? [];
  const self = subjects.find((s) => s.label.toLowerCase() === m.name.toLowerCase());
  const narrower = self ? subjects.filter((s) => s.parents.includes(self.id)) : [];
  return (
    <div className="bg-cream min-h-screen">
      <section className="relative overflow-hidden text-white min-h-[46svh] md:min-h-[56vh] flex items-end">
        <PlateWall tiles={m.heroTiles} rows={3} />
        <div className={`${WRAP} relative w-full py-10 md:py-14`}>
          <p className="uppercase text-[10.5px] md:text-[13px] tracking-[0.15em] mb-3" style={{ color: '#e0a48f' }}>Subject</p>
          <h1 className="font-serif text-[44px] md:text-[clamp(52px,5.6vw,84px)] leading-[1.02] tracking-[-0.03em]">{m.name}</h1>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] font-medium">
            <span style={{ color: '#8fbfe6' }}>{n(m.stats.works)} works</span>
            <span style={{ color: '#e6a06a' }}>{n(m.stats.images)} images</span>
            {about.length > 0 && <span className="text-stone-200">{about.length} collections</span>}
          </div>
        </div>
      </section>
      <div className={`${WRAP} py-8 md:py-10`}>
        <SubjectSearch name={m.name} authors={[...new Set(m.books.map((b) => (b.author || '').split(/[;,|]/)[0].trim()).filter((a) => a && !/unknown|anonym/i.test(a)))].slice(0, 3)} />
      </div>
      {m.overview && <div className={`${WRAP} pb-8`}><OverviewBand o={m.overview} /></div>}
      {m.intro[0] && <p className={`${WRAP} text-secondary leading-relaxed font-body max-w-3xl pb-8 !mx-0 md:!ml-[max(0px,calc((100vw-var(--container-wide))/2))]`}>{m.intro[0]}</p>}
      {narrower.length > 0 && (
        <section className={`${WRAP} pb-10`}>
          <h2 className={`${H2} mb-4`}>Narrower subjects</h2>
          <div className="columns-2 md:columns-4 gap-8 text-[15px] leading-loose">{narrower.map((s) => <Link key={s.id} href={`/revamp/subjects#${s.id}`} className="block hover:text-accent-rust">{s.label}</Link>)}</div>
        </section>
      )}
      {about.length > 0 && (
        <section className="bg-warm border-y border-border-light">
          <div className={`${WRAP} py-10 md:py-14`}>
            <h2 className={`${H2} mb-6`}>Collections about this</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-7">
              {about.slice(0, 10).map((c) => (
                <Link key={c.slug} href={c.href} className="block group"><Thumb item={c} mode="grid" /><span className="block mt-2.5 font-serif text-[17px] leading-snug text-primary group-hover:text-accent-rust">{c.name}</span></Link>
              ))}
            </div>
          </div>
        </section>
      )}
      <section className={`${WRAP} py-10 md:py-14`}>
        <div className="flex items-end justify-between mb-6"><h2 className={H2}>Works</h2><span className="text-sm text-muted">{n(m.stats.works)} works, filtered as in the Library</span></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">{m.books.slice(0, 15).map((b) => <CollectionBookCard key={b.id} book={b as unknown as CollectionBook} />)}</div>
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
