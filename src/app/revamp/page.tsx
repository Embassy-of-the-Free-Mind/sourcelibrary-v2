import Link from 'next/link';
import { dataFile } from './_lib/data';
import { languageGroups, periodGroups, typeGroups, typeOfSlug, typeSlugs } from './_lib/axes';

// The overview of the revamp: what the groupings were, what they are now, every page built, and what comes next.

interface Sorted { source: 'collection' | 'gallery'; proposed: string }
const n = (v: number) => v.toLocaleString('en-GB');
const WRAP = 'max-w-[1100px] mx-auto px-6 md:px-10';
const H2 = 'font-display text-3xl text-primary mb-2';

// Two sources, one colour each (validated: CVD ΔE 18.8, both above 3:1 on cream).
const SRC = { collection: { label: 'Collections', color: '#7c5db5' }, gallery: { label: 'Gallery sets', color: '#9e4a3a' } } as const;

function Flow({ rows }: { rows: Sorted[] }) {
  const destKey = (p: string) => (p === 'library_slice' || p === 'historic_library' ? 'libraries' : p);
  const dests = [['subject', 'Subject pages'], ['libraries', 'Libraries'], ['collection', 'Collections'], ['merge', 'Folded into a subject'], ['retire', 'Retired']] as const;
  const W = 900, H = 400, GAP = 12, BAR = 12, LX = 150, RX = W - 230;
  const total = rows.length;
  const k = (H - GAP * (dests.length - 1)) / total;
  const count = (s: string, d: string) => rows.filter((r) => r.source === s && destKey(r.proposed) === d).length;
  // Left nodes
  const left: Record<string, { y: number; h: number }> = {};
  let y = 0;
  for (const s of ['collection', 'gallery'] as const) { const h = rows.filter((r) => r.source === s).length * k; left[s] = { y, h }; y += h + GAP * 2; }
  // Right nodes
  const right: Record<string, { y: number; h: number; n: number }> = {};
  y = 0;
  for (const [d] of dests) { const c = rows.filter((r) => destKey(r.proposed) === d).length; right[d] = { y, h: c * k, n: c }; y += c * k + GAP; }
  const outAt = { collection: left.collection.y, gallery: left.gallery.y };
  const inAt: Record<string, number> = Object.fromEntries(dests.map(([d]) => [d, right[d].y]));
  const ribbons: { s: 'collection' | 'gallery'; d: string; c: number; path: string }[] = [];
  for (const [d] of dests) for (const s of ['collection', 'gallery'] as const) {
    const c = count(s, d); if (!c) continue;
    const h = c * k, y0 = outAt[s], y1 = inAt[d]; outAt[s] += h; inAt[d] += h;
    const x0 = LX + BAR, x1 = RX, mx = (x0 + x1) / 2;
    ribbons.push({ s, d, c, path: `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + h} C${mx},${y1 + h} ${mx},${y0 + h} ${x0},${y0 + h} Z` });
  }
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H + 24}`} className="w-full h-auto" role="img" aria-label={`Before and after: ${total} groupings sorted into subjects, collections, libraries, folded or retired`}>
        <style>{`.rb{opacity:.38;transition:opacity .15s}.rb:hover{opacity:.75}`}</style>
        {ribbons.map((r) => (
          <path key={`${r.s}-${r.d}`} d={r.path} fill={SRC[r.s].color} className="rb">
            <title>{`${SRC[r.s].label} → ${dests.find(([d]) => d === r.d)![1]}: ${r.c}`}</title>
          </path>
        ))}
        {(['collection', 'gallery'] as const).map((s) => (
          <g key={s}>
            <rect x={LX} y={left[s].y} width={BAR} height={left[s].h} rx={2} fill={SRC[s].color} />
            <text x={LX - 10} y={left[s].y + left[s].h / 2 - 6} textAnchor="end" fontSize="15" fill="var(--text-primary, #1a1612)">{SRC[s].label}</text>
            <text x={LX - 10} y={left[s].y + left[s].h / 2 + 13} textAnchor="end" fontSize="13" fill="var(--text-muted, #7a7065)">{rows.filter((r) => r.source === s).length} on the site now</text>
          </g>
        ))}
        {dests.map(([d, label]) => (
          <g key={d}>
            <rect x={RX} y={right[d].y} width={BAR} height={Math.max(2, right[d].h)} rx={2} fill="#1a1612" />
            <text x={RX + BAR + 10} y={right[d].y + Math.max(right[d].h, 2) / 2 + 5} fontSize="15" fill="#1a1612">{label} <tspan fill="#7a7065">{right[d].n}</tspan></text>
          </g>
        ))}
        <text x={LX} y={H + 20} fontSize="12" fill="#7a7065">BEFORE</text>
        <text x={RX} y={H + 20} fontSize="12" fill="#7a7065">AFTER</text>
      </svg>
      <details className="mt-3 text-sm text-secondary">
        <summary className="cursor-pointer text-muted">As a table</summary>
        <table className="mt-3 text-sm"><thead><tr className="text-left text-muted"><th className="pr-6 font-normal">Now</th><th className="pr-6 font-normal">From collections</th><th className="font-normal">From gallery sets</th></tr></thead>
          <tbody>{dests.map(([d, label]) => <tr key={d}><td className="pr-6 py-0.5">{label}</td><td className="pr-6 tabular-nums">{count('collection', d)}</td><td className="tabular-nums">{count('gallery', d)}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}

type Node = { href?: string; title: string; note?: string; kids?: Node[] };

function Tree({ nodes }: { nodes: Node[] }) {
  return (
    <ul className="border-l border-border-light ml-1">
      {nodes.map((x) => (
        <li key={x.title} className="relative pl-6 py-1.5 before:absolute before:left-0 before:top-[1.15rem] before:w-4 before:border-t before:border-border-light">
          {x.href ? <Link href={x.href} className="text-[16px] text-primary underline decoration-border-medium underline-offset-[3px] hover:decoration-primary">{x.title}</Link> : <span className="text-[16px] text-primary font-medium">{x.title}</span>}
          {x.note && <span className="block text-[13.5px] text-muted leading-snug">{x.note}</span>}
          {x.kids && <div className="mt-1.5"><Tree nodes={x.kids} /></div>}
        </li>
      ))}
    </ul>
  );
}

export default function Page() {
  const rows = (dataFile<{ records: Sorted[] }>('sorting')?.records ?? []);
  const periods = periodGroups(), langs = languageGroups(), types = typeGroups();
  const subjects = (dataFile<{ subjects: unknown[] }>('subjects')?.subjects ?? []).length;
  const aType = typeSlugs()[0];
  const tiles: [string, string][] = [[n(subjects), 'subjects, in two levels'], [n(periods.count), 'centuries'], [n(langs.named), 'languages'], [n(types.groups.reduce((s, g) => s + g.narrower.length, 0)), 'types of picture and text']];

  const SITE: Node[] = [
    { title: 'Homepage', href: '/revamp/home', note: 'Three full-height featured layouts, Popular this week below', kids: [{ title: 'Featured collection schedule', href: '/revamp/featured', note: 'One file drives the homepage, Library and Gallery' }] },
    { title: 'Subjects', href: '/revamp/subjects', note: 'What books and pictures are about. Every subject has a picture.', kids: [
      { title: 'A subject: Alchemy', href: '/revamp/s/alchemy', note: 'Sub-subjects, then Works · Images · Collections · About' },
      { title: 'A subject: Yoga', href: '/revamp/s/yoga' },
      { title: 'Draft subject list', href: '/revamp/subjects/draft', note: 'The working list, linked to FAST and Wikidata' },
    ] },
    { title: 'Collections', href: '/revamp/c', note: 'Chosen sets, made by Source Library or readers', kids: [
      { title: 'A collection: Music of the Spheres', href: '/revamp/c/music-of-the-spheres', note: 'Three listings to compare: chapters, like a subject, contents rail' },
      { title: 'Hand-made: Slime Moulds', href: '/revamp/c/slime-moulds', note: 'The Mycology and Slime Moulds format' },
    ] },
    { title: 'Centuries', href: '/revamp/periods', note: 'When works were written', kids: [{ title: 'A century: 1900–1999', href: '/revamp/p/period-1900' }] },
    { title: 'Languages', href: '/revamp/languages', note: 'The language of the copy', kids: [{ title: 'A language: Latin', href: '/revamp/l/language-latin' }] },
    { title: 'Types of pictures', href: '/revamp/types/pictures', note: 'What it shows · How it was made · Where it sits in the book', kids: aType ? [{ title: `A type: ${typeOfSlug(aType)?.map.label ?? aType}`, href: `/revamp/t/${aType}` }] : [] },
    { title: 'Types of texts', href: '/revamp/types/texts', note: 'What it’s written on · What kind of writing' },
    { title: 'Behind the scenes', kids: [
      { title: 'Every term against its standard', href: '/revamp/standards' },
      { title: 'Sorting review', href: '/revamp/review', note: 'Every collection and gallery set sorted into the new types, to correct' },
      { title: 'Navigation options', href: '/revamp/nav' },
      { title: 'Thumbnail maker', href: '/revamp/thumbnail/music-of-the-spheres', note: 'Make a collection’s square thumbnail' },
    ] },
  ];

  return (
    <main className="bg-cream min-h-screen pb-24">
      <header className={`${WRAP} pt-14 pb-10`}>
        <p className="text-[12px] uppercase tracking-[0.14em] text-muted mb-3">Collections revamp · overview · 12 November 2026</p>
        <h1 className="font-display text-5xl text-primary mb-4">From one pile of collections to clear ways in</h1>
        <p className="text-lg text-secondary max-w-2xl leading-relaxed">A prototype on your Mac only. It reads a saved copy of public data, has no database connection, and can&apos;t change the site. Nothing here is live.</p>
      </header>

      <section className={`${WRAP} py-10 border-t border-border-light`}>
        <h2 className={H2}>Before and after</h2>
        <p className="text-secondary max-w-2xl mb-8">Today the site has {n(rows.length)} groupings, all called collections or gallery sets, mixing fields, chosen sets and libraries. Each one sorted into what it really is. Hover a ribbon for its number.</p>
        <Flow rows={rows} />
        <h3 className="text-lg font-medium text-primary mt-12 mb-4">New ways in that did not exist before</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {tiles.map(([v, l]) => <div key={l} className="bg-white border border-border-light px-5 py-4"><div className="font-display text-4xl text-primary">{v}</div><div className="text-sm text-muted mt-1">{l}</div></div>)}
        </div>
      </section>

      <section className={`${WRAP} py-10 border-t border-border-light`}>
        <h2 className={H2}>Every page in the prototype</h2>
        <p className="text-secondary max-w-2xl mb-6">How the pages hang together. Each link opens the prototype page.</p>
        <Tree nodes={SITE} />
      </section>

      <section className={`${WRAP} py-10 border-t border-border-light grid md:grid-cols-3 gap-8`}>
        <div>
          <h2 className={H2}>Decided</h2>
          <ul className="list-disc pl-5 space-y-1.5 text-[15px] text-secondary leading-relaxed">
            <li>Three kinds: Subjects, Collections, Libraries. Plus Centuries, Languages and Types as ways in.</li>
            <li>Collections are made by Source Library or readers.</li>
            <li>One hero height everywhere; pictures stop above the search bar.</li>
            <li>Categories: heading tabs for Works, Images, Collections, About.</li>
            <li>Sub-subjects as picture boxes under the hero; every subject has a picture.</li>
            <li>Filters on one line; count, tags, sort and view on a fixed second line; menu numbers follow the other filters.</li>
            <li>One set of control styles for every search, filter and sort.</li>
            <li>Every type and era is linked to a standard: LCGFT or Getty, plus Wikidata for names in other languages.</li>
            <li>Types became two pages: Types of pictures (what it shows, how it was made, where it sits) and Types of texts (what it’s written on, what kind of writing).</li>
            <li>Catalogue fixes wait for one combined round.</li>
            <li>New subjects are semi-automatic: proposed from new books, public only past a minimum.</li>
          </ul>
        </div>
        <div>
          <h2 className={H2}>Your decisions</h2>
          <ol className="list-decimal pl-5 space-y-1.5 text-[15px] text-secondary leading-relaxed">
            <li>How a collection lists its works: <Link className="underline underline-offset-[3px]" href="/revamp/c/music-of-the-spheres">compare A, B and C</Link>.</li>
            <li>The first featured collection, and how often it changes.</li>
            <li>Comments on collections: yes or no.</li>
            <li>The navigation menu.</li>
          </ol>
        </div>
        <div>
          <h2 className={H2}>To go live</h2>
          <ol className="list-decimal pl-5 space-y-1.5 text-[15px] text-secondary leading-relaxed">
            <li>A written plan: what the real pages need from the site and the database (subject list, featured schedule, sub-subject tags on books, subject pictures).</li>
            <li>Split into small pull requests, the shared control styles first, since /library and /gallery already use them.</li>
            <li>Derek reviews each one; nothing merges without your yes.</li>
            <li>One catalogue round, all together: write the missing summaries first (26,595 books have text but no summary); record each text&apos;s form (scroll, tablet, papyrus…); tag kinds of writing and sub-subjects; give each picture all three answers (what it shows, how it was made, where it sits) and add title pages, initials, bookplates and musical scores; give subject pictures a proper home.</li>
            <li>In the same round, split the close matches into exact ones: Poetry, Drama and Fiction apart; Recipes as its own type, out of Handbook or manual.</li>
            <li>After it: publish each type&apos;s standard term in the book and picture pages&apos; hidden data (schema.org genre, linking LCGFT, Getty and Wikidata), so search engines and other libraries read it exactly.</li>
            <li>Subjects that grow: new books get subjects from the list automatically, and counts update. When new books point to a FAST heading we have no subject for, it becomes a proposed subject; it goes public once it holds a minimum number of works and images (10 suggested, a setting) and someone has checked the name.</li>
          </ol>
        </div>
      </section>
    </main>
  );
}
