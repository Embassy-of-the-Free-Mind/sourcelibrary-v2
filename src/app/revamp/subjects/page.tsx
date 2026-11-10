import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import PlateWall from '../_components/PlateWall';
import CollectionBars from '../_components/CollectionBars';
import SubjectsBrowser, { type Pic, type SubjectRow } from '../_components/SubjectsBrowser';
import { collectionModel, dataFile, snapshotSlugs } from '../_lib/data';
import { RAMP } from '../_lib/ramp';

interface Subj { id: string; label: string; level: number; parents: string[]; altLabels?: Record<string, string[]> }

const WRAP = 'max-w-[var(--container-wide)] mx-auto px-6 md:px-12';

// Enough to feature: this many works and images, and enough pictures for the hero rows.
const FEATURE_MIN = { works: 10, images: 20, pictures: 8 };

function featuredSubject(slugs: string[]) {
  const ok = slugs.map((s) => collectionModel(s)).filter((m): m is NonNullable<typeof m> => !!m
    && m.stats.works >= FEATURE_MIN.works && m.stats.images >= FEATURE_MIN.images && m.heroTiles.length >= FEATURE_MIN.pictures)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  if (!ok.length) return null;
  const week = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  return ok[week % ok.length];
}

const MICRO = 'uppercase tracking-[0.16em] text-[10.5px] md:text-[11px]';

const INTRO = 'Browse the library by what its books and images are about.';

/** Pictures per subject, saved from the public gallery by _tools/snapshot-subject-images.py. */
function pictures(): Record<string, Pic[]> {
  const read = (f: string) => { try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/app/revamp/_data/snap', f), 'utf8')); } catch { return {}; } };
  const main = read('_subject-images.json');
  const extra = read('_subject-images-extra.json'); // broad subjects the gallery files under another name
  for (const [k, v] of Object.entries(extra)) if (!main[k]?.length) main[k] = v;
  return main;
}

export default function Page() {
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
  // Featured: one subject a week, chosen in turn from the subjects with enough in them to carry the hero.
  const featured = featuredSubject([...pages.values()]);
  const total = new Set(all.map((x) => x.id)).size;
  const groups = all.filter((s) => s.level === 1).map((t) => ({ ...row(t), narrower: all.filter((s) => s.level === 2 && s.parents.includes(t.id)).map((s) => ({ ...row(s), home: s.parents[0] === t.id })).sort((a, b) => a.label.localeCompare(b.label, 'en')) }));
  return (
    <div className="bg-cream min-h-screen">
      <section className="relative overflow-hidden text-white min-h-[46svh] md:min-h-[60vh] flex items-end">
        <PlateWall tiles={featured ? featured.heroTiles : [...tiles, ...Object.values(pics).flat().map((p) => p.src)].filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 40)} rows={3} still />
        <div className={`${WRAP} relative w-full pt-12 md:pt-16 pb-20 md:pb-24 flex flex-col md:flex-row md:items-end md:justify-between gap-8`}>
          <div>
            <h1 className="font-serif text-[44px] md:text-[clamp(52px,5.6vw,84px)] leading-[1.02] tracking-[-0.03em]">Subjects</h1>
            <p className="mt-4 text-lg md:text-xl text-stone-200 max-w-2xl leading-relaxed">{INTRO}</p>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[14px] md:text-[15px] font-medium">
              {[`${groups.length} broad subjects`, `${total} subjects`].map((l, i) => <span key={l} style={{ color: RAMP[i] }}>{l}</span>)}
            </div>
          </div>
          {featured && (
            <Link href={`/revamp/s/${featured.slug}`} className={`group block md:text-right ${MICRO} text-white/70 leading-relaxed`}>
              <span className="text-white/50">Featured</span><span className="mx-2 text-white/30">/</span><span className="text-white whitespace-nowrap group-hover:underline underline-offset-[3px]">{featured.name}</span>
            </Link>
          )}
        </div>
        <CollectionBars strip live works={total} placeholder="Search subjects or ask a question" scope={`all ${total} subjects`} />
      </section>
      <SubjectsBrowser groups={groups} barSearch />
    </div>
  );
}
