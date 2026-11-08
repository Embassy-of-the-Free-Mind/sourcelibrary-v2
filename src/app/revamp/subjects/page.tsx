import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import PlateWall from '../_components/PlateWall';
import SubjectsBrowser, { type Pic, type SubjectRow, type Variant } from '../_components/SubjectsBrowser';
import { collectionModel, dataFile, snapshotSlugs } from '../_lib/data';
import { RAMP } from '../_lib/ramp';

interface Subj { id: string; label: string; level: number; parents: string[]; altLabels?: Record<string, string[]> }

const WRAP = 'max-w-[var(--container-wide)] mx-auto px-6 md:px-12';

const VARIANTS: [Variant, string][] = [['banner', 'A Picture bands'], ['cards', 'B Cards']];
// Ways to say what a subject is.
const INTROS = [
  'Browse the whole library by topic. Each subject gathers every book and image we hold on it.',
  'Every book and image in the library, filed by what it is about.',
  'Find everything we hold on a topic, from broad fields like Medicine to specific ones like Paracelsianism.',
  'The library by topic: every book and image, filed under what it is about, from broad fields to specific ones.',
];

/** Pictures per subject, saved from the public gallery by _tools/snapshot-subject-images.py. */
function pictures(): Record<string, Pic[]> {
  const read = (f: string) => { try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/app/revamp/_data/snap', f), 'utf8')); } catch { return {}; } };
  const main = read('_subject-images.json');
  const extra = read('_subject-images-extra.json'); // broad subjects the gallery files under another name
  for (const [k, v] of Object.entries(extra)) if (!main[k]?.length) main[k] = v;
  return main;
}

export default async function Page({ searchParams }: { searchParams: Promise<{ v?: string; t?: string }> }) {
  const { v, t } = await searchParams;
  const ti = Math.min(Math.max(Number(t) || 1, 1), INTROS.length) - 1;
  const variant: Variant = VARIANTS.some(([k]) => k === v) ? (v as Variant) : 'banner';
  const pics = pictures();
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
  const row = (s: Subj): SubjectRow => ({ id: s.id, label: s.label, href: pages.has(s.id) ? `/revamp/s/${pages.get(s.id)}` : undefined, alt: Object.values(s.altLabels ?? {}).flat(), pics: (pics[s.id] ?? []).filter((p) => p.src) });
  const groups = all.filter((s) => s.level === 1).map((t) => ({ ...row(t), narrower: all.filter((s) => s.level === 2 && s.parents.includes(t.id)).map((s) => ({ ...row(s), home: s.parents[0] === t.id })).sort((a, b) => a.label.localeCompare(b.label, 'en')) }));
  return (
    <div className="bg-cream min-h-screen">
      <section className="relative overflow-hidden text-white min-h-[46svh] md:min-h-[60vh] flex items-end">
        <PlateWall tiles={[...tiles, ...Object.values(pics).flat().map((p) => p.src)].filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 40)} rows={3} still />
        <div className="absolute top-3 right-4 z-20 text-xs text-white/70 flex gap-3">
          {VARIANTS.map(([k, l]) => <Link key={k} href={`/revamp/subjects?v=${k}&t=${ti + 1}`} className={variant === k ? 'text-white underline underline-offset-2' : 'hover:text-white'}>{l}</Link>)}
          <span className="ml-2">Intro</span>
          {INTROS.map((_x, i) => <Link key={i} href={`/revamp/subjects?v=${variant}&t=${i + 1}`} className={ti === i ? 'text-white underline underline-offset-2' : 'hover:text-white'}>{i + 1}</Link>)}
        </div>
        <div className={`${WRAP} relative w-full py-10 md:py-14`}>
          <h1 className="font-serif text-[44px] md:text-[clamp(52px,5.6vw,84px)] leading-[1.02] tracking-[-0.03em]">Subjects</h1>
          <p className="mt-4 text-lg md:text-xl text-stone-200 max-w-2xl leading-relaxed">{INTROS[ti]}</p>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[14px] md:text-[15px] font-medium">
            {[`${groups.length} broad subjects`, `${new Set(all.map((x) => x.id)).size} subjects`].map((l, i) => <span key={l} style={{ color: RAMP[i] }}>{l}</span>)}
          </div>
        </div>
      </section>
      <SubjectsBrowser groups={groups} variant={variant} />
    </div>
  );
}
