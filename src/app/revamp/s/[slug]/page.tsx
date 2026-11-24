import { notFound } from 'next/navigation';
import Link from 'next/link';
import PlateWall from '../../_components/PlateWall';
import { Bell } from 'lucide-react';
import CollectionBars from '../../_components/CollectionBars';
import AskPanel from '../../_components/AskPanel';
import CollectionItems from '../../_components/CollectionItems';
import { RAMP } from '../../_lib/ramp';
import { Thumb } from '../../_components/CollectionsBrowser';
import { collectionModel, dataFile, indexItems } from '../../_lib/data';
import { HERO_H } from '../../_lib/hero';
import SubSubjects from '../../_components/SubSubjects';
import { subjectPages, subjectPictures } from '../../_lib/subject-pics';

interface Sorted { source: string; slug: string; proposed: string; proposed_subject?: string | null }
interface Subj { id: string; label: string; level: number; parents: string[] }
const n = (v: number) => v.toLocaleString('en-GB');
const WRAP = 'max-w-[var(--container-wide)] mx-auto px-6 md:px-12';
const SHOW = 10; // two rows; more go to the Collections page, filtered to this subject

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
  const counts = [works && `${n(works)} texts`, m.stats.images && `${n(m.stats.images)} images`, langs > 1 && `${langs} languages`, years.length ? `${Math.min(...years)} – ${Math.max(...years)}` : ''].filter(Boolean) as string[];
  const narrower = self ? subjects.filter((s) => s.parents.includes(self.id)) : [];
  // The same boxes as the Subjects page: a picture at the left, the name beside it.
  const subPics = subjectPictures();
  const subPages = subjectPages(subjects);
  // The intro's first sentence goes in the hero; the rest of it is the About tab, after the material it describes.
  const first = m.intro[0] ?? '';
  const cut = first.search(/[.!?]\s+(?=[A-Z“"‘'])/);
  const lead = m.short || (cut > 0 ? first.slice(0, cut + 1) : first);
  const rest = m.short ? m.intro : [...(cut > 0 ? [first.slice(cut + 1).trim()] : []), ...m.intro.slice(1)];
  const aboutTab = (rest.length || m.introPlate) ? [{ key: 'about', label: 'About', count: 0, body: (
    <div className="flex flex-col md:flex-row md:items-start gap-8 lg:gap-12 pb-6">
      {m.introPlate && (
        <figure className="w-full md:w-[min(30%,46vh)] shrink-0 m-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.introPlate.src} alt={m.introPlate.label || 'Plate from the subject'} loading="lazy" className="w-full h-auto" />
          {m.introPlate.label && <figcaption className="mt-2 text-xs text-muted">{m.introPlate.href ? <Link href={m.introPlate.href} className="hover:text-primary">{m.introPlate.label}</Link> : m.introPlate.label}</figcaption>}
        </figure>
      )}
      <div className="font-body flex-1 min-w-0 max-w-2xl">
        {rest.map((p, i) => <p key={i} className="text-secondary text-[17px] leading-relaxed mb-4">{p}</p>)}
      </div>
    </div>
  ) }] : [];
  return (
    <div className="bg-cream min-h-screen">
      {/* The collection hero, minus what only a collection has (byline, Copy, a chosen picture). */}
      <section className={`relative overflow-hidden text-white flex items-end ${HERO_H}`} style={{ backgroundColor: '#1a1612' }}>
        <PlateWall tiles={m.heroTiles} rows={3} still />
        <div className={`${WRAP} relative w-full pt-10 md:pt-14 pb-20 md:pb-24`}>
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 uppercase text-[10.5px] md:text-[13px] tracking-[0.15em] mb-3 text-white/70">
            <Link href="/revamp/subjects" className="hover:text-white">Subjects</Link>
            {parent && <><span className="opacity-50">/</span><Link href={`/revamp/subjects#${parent.id}`} className="hover:text-white">{parent.label}</Link></>}
          </nav>
          <h1 className="font-serif text-[40px] md:text-[clamp(52px,5.6vw,84px)] leading-[1.02] tracking-[-0.03em]">{m.name}</h1>
          {lead && <p className="mt-4 text-lg md:text-xl text-stone-200 max-w-2xl leading-relaxed">{lead}</p>}
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
      {/* Narrower subjects, as their own section straight under the hero: they are how you narrow a big subject. */}
      <SubSubjects name={m.name} rows={narrower.map((x) => ({ id: x.id, label: x.label, alt: [], href: subPages.has(x.id) ? `/revamp/s/${subPages.get(x.id)}` : `/revamp/subjects#${x.id}`, pics: (subPics[x.id] ?? []).filter((p) => p.src) }))} />
      <CollectionItems slug={m.slug} books={m.all} notes={[]} plates={m.plates} imagesTotal={m.stats.images} byBook={m.byBook} curated={false}
        extraTabs={(about.length ? [{ key: 'collections', label: 'Collections', count: about.length, body: (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-x-5 gap-y-7">
              {about.slice(0, SHOW).map((c) => (
                <Link key={c.slug} href={c.href} className="block group"><Thumb item={c} mode="square" /><span className="block mt-2.5 font-serif text-[17px] leading-snug text-primary group-hover:underline underline-offset-2">{c.name}</span></Link>
              ))}
            </div>
            {about.length > SHOW && <Link href={`/revamp/c?subject=${encodeURIComponent(m.name)}`} className="inline-block mt-8 text-sm text-primary underline underline-offset-2 decoration-border-medium hover:decoration-primary">See all {about.length} collections</Link>}
          </>
        ) }] : []).concat(aboutTab)} />
    </div>
  );
}
