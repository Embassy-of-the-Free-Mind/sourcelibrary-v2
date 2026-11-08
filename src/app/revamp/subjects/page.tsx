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
          <p className="mt-4 text-lg md:text-xl text-stone-200 max-w-2xl leading-relaxed">Everything in the library by what it is about: {groups.length} broad subjects, each with narrower ones inside.</p>
        </div>
      </section>
      <SubjectsBrowser groups={groups} />
      <section id="how" className="bg-warm border-t border-border-light scroll-mt-16">
        <div className={`${WRAP} py-12 md:py-16`}>
          <h2 className="font-serif text-3xl md:text-4xl text-primary leading-[1.05] tracking-tight mb-8">How we choose subjects</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-8 max-w-6xl">
            {[
              ['From what the library holds', 'A subject is added when there are books or images about it here, not from a list drawn up in advance. Librarians call this literary warrant.'],
              ['Two levels', `${groups.length} broad subjects, each with narrower ones. A narrower subject can sit under two broad ones when it belongs to both, as Arabic alchemy belongs to Alchemy and to Islam.`],
              ['Linked to library standards', 'Where a match exists, each subject is linked to FAST, the subject headings OCLC builds from the Library of Congress list, and to Wikidata. That lets our records connect with other catalogues.'],
              ['One subject, many names', 'Each subject has one name in plain English, plus the other names and spellings people search for, in Latin, German, Dutch, Chinese and more. Searching any of them finds it.'],
              ['Periods and places are filters', 'Early modern, Renaissance, Persia or Japan narrow a search in the Library rather than being subjects of their own, so a subject means the same thing in every century.'],
              ['Subjects and collections', 'A subject covers everything we hold on a topic. A collection is a set someone chose, with a point of view, made by Source Library or by readers.'],
            ].map(([h, t]) => (
              <div key={h}><h3 className="text-lg font-semibold text-primary mb-2">{h}</h3><p className="text-secondary leading-relaxed">{t}</p></div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
