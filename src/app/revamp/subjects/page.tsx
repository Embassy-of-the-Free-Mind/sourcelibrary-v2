import PlateWall from '../_components/PlateWall';
import SubjectsBrowser, { type SubjectRow } from '../_components/SubjectsBrowser';
import { collectionModel, dataFile, snapshotSlugs } from '../_lib/data';

interface Subj { id: string; label: string; level: number; parents: string[]; altLabels?: Record<string, string[]> }

const WRAP = 'max-w-[var(--container-wide)] mx-auto px-6 md:px-12';

export default function Page() {
  const all = dataFile<{ subjects: Subj[] }>('subjects')?.subjects ?? [];
  // Subjects with saved data get their own page in the prototype; the rest are listed without a link.
  const pages = new Map<string, string>();
  const tiles: string[] = [];
  for (const slug of snapshotSlugs()) {
    const m = collectionModel(slug);
    if (!m) continue;
    const hit = all.find((s) => s.label.toLowerCase() === m.name.toLowerCase());
    if (hit) { pages.set(hit.id, slug); tiles.push(...m.heroTiles.slice(0, 4)); }
  }
  const row = (s: Subj): SubjectRow => ({ id: s.id, label: s.label, href: pages.has(s.id) ? `/revamp/s/${pages.get(s.id)}` : undefined, alt: Object.values(s.altLabels ?? {}).flat() });
  const groups = all.filter((s) => s.level === 1).map((t) => ({ ...row(t), narrower: all.filter((s) => s.level === 2 && s.parents.includes(t.id)).map((s) => ({ ...row(s), home: s.parents[0] === t.id })) }));
  return (
    <div className="bg-cream min-h-screen">
      <section className="relative overflow-hidden text-white min-h-[46svh] md:min-h-[60vh] flex items-end">
        <PlateWall tiles={tiles.slice(0, 40)} rows={3} still />
        <div className={`${WRAP} relative w-full py-10 md:py-14`}>
          <h1 className="font-serif text-[44px] md:text-[clamp(52px,5.6vw,84px)] leading-[1.02] tracking-[-0.03em]">Subjects</h1>
          <p className="mt-4 text-lg md:text-xl text-stone-200 max-w-2xl leading-relaxed">Everything in the library by what it is about: {groups.length} broad subjects, each made up of more specific ones.</p>
        </div>
      </section>
      <SubjectsBrowser groups={groups} />
    </div>
  );
}
