import { Fragment, ReactNode } from 'react';

// Figures for the "What we actually know about the boat" box (Derek, 2026-10-29:
// "can you make some figures?"). They are our own diagrams of what each text says,
// never a picture of the boat: every label is a phrase from the source it sits under.
// Colours come from the site tokens; water is accent-sage at low opacity.

const WATER = 'var(--color-accent-sage)';
const HULL = 'var(--color-warm)';
const INK = 'var(--color-primary)';
const SOFT = 'var(--color-muted)';
const GOLD = 'var(--color-accent-gold-dark)';

/* ------------------------------------------------------------------ */
/* Who reports what                                                     */
/* ------------------------------------------------------------------ */

const SOURCES = [
  { name: 'Beeckman', year: 1620 },
  { name: 'Mersenne', year: 1644 },
  { name: 'Wilkins', year: 1648 },
  { name: 'Harsdörffer', year: 1651 },
  { name: 'Boyle', year: 1660 },
  { name: 'Papin', year: 1695 },
] as const;

/** 'y' = says Drebbel's boat did or had this; 'p' = proposes it as a way to build one, without saying Drebbel did; a string is shown as written. */
type Cell = 'y' | 'p' | string | undefined;

const ROWS: { claim: string; cells: Cell[] }[] = [
  { claim: 'Had it from', cells: ['his father’s letter', '“well known”', 'not said', 'a kinsman of Drebbel', 'Drebbel’s family', '“they report”'] },
  { claim: 'Went under water', cells: ['y', 'y', 'y', 'y', 'y', 'y'] },
  { claim: 'On the Thames', cells: [, , , 'y', 'y'] },
  { claim: 'Sank by taking water in', cells: ['p', 'p', , 'y', , 'p'] },
  { claim: 'Oars', cells: [, 'p', , 'y', 'y', 'y'] },
  { claim: 'Oars sealed with leather', cells: [, 'p', , , , 'y'] },
  { claim: 'Walls and deck of greased leather', cells: [, , , 'y'] },
  { claim: 'Glass to look out', cells: [, 'p', , 'y'] },
  { claim: 'Air by a tube from the surface', cells: [, 'p', , 'y', , 'p'] },
  { claim: 'A liquor that restored the air', cells: [, , , , 'y', 'reports it, doubts it'] },
  { claim: 'Twelve rowers', cells: [, , , , 'y'] },
  { claim: 'Passengers', cells: [, , , 'the King', 'y'] },
  { claim: 'Two boats', cells: [, , , 'y'] },
];

function Mark({ c }: { c: Cell }) {
  if (c === 'y') return <span aria-label="says so" title="says Drebbel’s boat did or had this" style={{ color: INK }}>●</span>;
  if (c === 'p') return <span aria-label="proposes it" title="proposes it as a way to build such a boat" style={{ color: GOLD }}>○</span>;
  if (c) return <span className="text-xs leading-tight text-secondary">{c}</span>;
  return <span aria-label="not mentioned" className="text-border-medium">·</span>;
}

export function SourcesTable() {
  return (
    <figure className="not-prose my-10">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse font-body text-sm">
          <thead>
            <tr className="border-b border-border-medium">
              <th className="py-2 pr-3 text-left font-normal text-muted" scope="col">
                <span className="sr-only">Claim</span>
              </th>
              {SOURCES.map((s) => (
                <th key={s.name} scope="col" className="px-2 py-2 text-center align-bottom font-normal">
                  <span className="block text-primary">{s.name}</span>
                  <span className="block text-xs text-muted tabular-nums">{s.year}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r, i) => (
              <tr key={r.claim} className={i === 0 ? 'border-b border-border-medium' : 'border-b border-border-light'}>
                <th scope="row" className="py-2 pr-3 text-left font-normal text-primary">{r.claim}</th>
                {SOURCES.map((s, j) => (
                  <td key={s.name} className="px-2 py-2 text-center align-middle">
                    <Mark c={r.cells[j]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="mt-3 text-sm text-muted leading-relaxed">
        Who reports what. <span style={{ color: INK }}>●</span> says Drebbel&rsquo;s boat did or had
        this. <span style={{ color: GOLD }}>○</span> proposes it as a way to build such a boat,
        without saying Drebbel did. Beeckman&rsquo;s tank is his own guess; Papin&rsquo;s tube and
        pump are for his own boat.
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* How it sank: three diagrams                                          */
/* ------------------------------------------------------------------ */

const W = 240;
const H = 210;

function Panel({ title, source, children, label }: { title: string; source: string; children: ReactNode; label: string }) {
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={label} style={{ fontFamily: 'inherit' }}>
        {children}
      </svg>
      <p className="mt-2 text-sm text-primary font-body leading-snug">{title}</p>
      <p className="text-xs text-muted">{source}</p>
    </div>
  );
}

function Water({ y }: { y: number }) {
  return (
    <>
      <rect x={0} y={y} width={W} height={H - y} fill={WATER} opacity={0.18} />
      <line x1={0} x2={W} y1={y} y2={y} stroke={WATER} strokeWidth={1.5} />
    </>
  );
}

function Label({ x, y, children, anchor = 'start' }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end' }) {
  return (
    <text x={x} y={y} fontSize={11} fill={SOFT} textAnchor={anchor}>
      {children}
    </text>
  );
}

/** A thin leader line from a label to the thing it names. */
function Lead({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={SOFT} strokeWidth={0.75} />;
}

function FishBox() {
  const holes = [0, 1, 2, 3].flatMap((i) => [
    <circle key={`l${i}`} cx={150} cy={140 + i * 9} r={1.6} fill={HULL} stroke={INK} strokeWidth={0.6} />,
    <circle key={`r${i}`} cx={200} cy={140 + i * 9} r={1.6} fill={HULL} stroke={INK} strokeWidth={0.6} />,
  ]);
  return (
    <Panel
      title="The fishermen’s box"
      source="Harsdörffer 1651: what Drebbel saw on the Thames"
      label="Diagram: a rowing boat on the water with a box full of holes hanging from it on a rope, under the surface; cut loose, the boat would ride higher."
    >
      <Water y={92} />
      {/* boat, sitting low */}
      <path d="M30,78 L190,78 L176,104 L44,104 Z" fill={HULL} stroke={INK} strokeWidth={1.4} />
      {/* rope and box */}
      <line x1={182} y1={86} x2={175} y2={134} stroke={INK} strokeWidth={1} />
      <rect x={150} y={134} width={50} height={36} fill={WATER} fillOpacity={0.35} stroke={INK} strokeWidth={1.2} />
      {holes}
      <ellipse cx={170} cy={154} rx={8} ry={3} fill="none" stroke={INK} strokeWidth={0.8} />
      <ellipse cx={182} cy={161} rx={7} ry={2.6} fill="none" stroke={INK} strokeWidth={0.8} />
      <Label x={146} y={186} anchor="end">box full of holes,</Label>
      <Label x={146} y={199} anchor="end">for keeping the fish</Label>
      <Lead x1={148} y1={183} x2={152} y2={168} />
      <Label x={10} y={30}>Cut the box loose</Label>
      <Label x={10} y={44}>and the boat floats higher</Label>
      <path d="M110,72 L110,56" stroke={GOLD} strokeWidth={1.4} markerEnd="url(#drebbel-fishbox-up)" />
      <defs>
        <marker id="drebbel-fishbox-up" viewBox="0 0 10 10" refX={5} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={GOLD} />
        </marker>
      </defs>
    </Panel>
  );
}

function HarsdoerfferBoat() {
  return (
    <Panel
      title="Drebbel’s boat, as Harsdörffer tells it"
      source="Harsdörffer 1651, from one of Drebbel’s kinsmen"
      label="Diagram: a closed boat under the surface, with water-boxes in its bottom, oars at the sides, a window, and a long tube up to the surface for air."
    >
      <Water y={44} />
      {/* air tube with a float */}
      <path d="M160,112 C162,90 168,70 172,46" fill="none" stroke={INK} strokeWidth={2} />
      <circle cx={172} cy={42} r={4} fill={HULL} stroke={INK} strokeWidth={1} />
      <Label x={180} y={30}>long tube</Label>
      <Label x={180} y={42}>for air</Label>
      {/* hull: walls and deck of greased leather */}
      <rect x={34} y={108} width={172} height={62} rx={26} fill={HULL} stroke={INK} strokeWidth={1.4} />
      <path d="M48,108 L192,108" stroke={GOLD} strokeWidth={3} strokeDasharray="5 3" />
      <Label x={14} y={72}>walls and deck of</Label>
      <Label x={14} y={84}>greased leather</Label>
      <Lead x1={60} y1={88} x2={70} y2={106} />
      {/* window */}
      <circle cx={52} cy={136} r={6} fill={WATER} fillOpacity={0.4} stroke={INK} strokeWidth={1} />
      {/* water-boxes */}
      <rect x={78} y={148} width={34} height={16} fill={WATER} fillOpacity={0.55} stroke={INK} strokeWidth={1} />
      <rect x={128} y={148} width={34} height={16} fill={WATER} fillOpacity={0.55} stroke={INK} strokeWidth={1} />
      {/* oars */}
      <line x1={40} y1={150} x2={8} y2={178} stroke={INK} strokeWidth={1.6} />
      <line x1={200} y1={150} x2={232} y2={178} stroke={INK} strokeWidth={1.6} />
      <Label x={120} y={190} anchor="middle">water-boxes to sink it,</Label>
      <Label x={120} y={202} anchor="middle">oars or a pole to drive it</Label>
      <Lead x1={120} y1={180} x2={120} y2={165} />
    </Panel>
  );
}

function BeeckmanGuess() {
  return (
    <Panel
      title="Beeckman’s guess, 1620"
      source="Beeckman’s journal, fol. 154r, from his drawing ABCD"
      label="Diagram: a boat with a closed tank in its bottom and a pipe with a tap through the hull; open the tap and the tank floods and the boat sinks; pump it out and it rises."
    >
      <Water y={60} />
      <rect x={40} y={70} width={160} height={84} rx={6} fill={HULL} stroke={INK} strokeWidth={1.4} />
      {/* the tight tank, half full */}
      <rect x={40} y={124} width={160} height={30} fill="none" stroke={INK} strokeWidth={1.2} />
      <rect x={41} y={136} width={158} height={17} fill={WATER} fillOpacity={0.55} />
      {/* pipe and tap D */}
      <line x1={120} y1={154} x2={120} y2={184} stroke={INK} strokeWidth={2} />
      <path d="M113,166 L127,174 L127,166 L113,174 Z" fill={HULL} stroke={INK} strokeWidth={1} />
      <text x={131} y={174} fontSize={11} fill={INK}>D</text>
      <Label x={46} y={116}>closed tank</Label>
      <Label x={120} y={198} anchor="middle">open the tap: the tank floods, the boat sinks</Label>
      <Label x={10} y={30}>pump the water out</Label>
      <Label x={10} y={44}>and it rises again</Label>
    </Panel>
  );
}

export function HowItSank() {
  return (
    <figure className="not-prose my-10">
      <div className="grid gap-8 md:grid-cols-3">
        <FishBox />
        <HarsdoerfferBoat />
        <BeeckmanGuess />
      </div>
      <figcaption className="mt-4 text-sm text-muted leading-relaxed">
        How the boat went under, in the only two accounts that say. Our diagrams of what the texts
        describe, not pictures of the boat: no picture of it from Drebbel&rsquo;s time survives.
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                             */
/* ------------------------------------------------------------------ */

/** tier: which side of the axis the label sits on (negative = above) and how far, so close years do not collide. */
const EVENTS: { year: number; who: string; what: string; tier: -2 | -1 | 1 | 2 }[] = [
  { year: 1620, who: 'Beeckman 1620', what: 'hears of it; draws a guess', tier: -1 },
  { year: 1633, who: 'Drebbel dies', what: '', tier: 1 },
  { year: 1644, who: 'Mersenne 1644', what: '“well known”', tier: -1 },
  { year: 1648, who: 'Wilkins 1648', what: '“already experimented”', tier: 2 },
  { year: 1651, who: 'Harsdörffer 1651', what: 'boxes, leather, the King', tier: -2 },
  { year: 1660, who: 'Boyle 1660', what: 'twelve rowers, a liquor', tier: 1 },
  { year: 1680, who: 'Borelli 1680', what: 'first picture of one', tier: 2 },
  { year: 1695, who: 'Papin 1695', what: 'his own boats, drawn', tier: -1 },
];

export function SourcesTimeline() {
  const x0 = 1615;
  const x1 = 1700;
  const left = 24;
  const right = 24;
  const width = 720;
  const x = (y: number) => left + ((y - x0) / (x1 - x0)) * (width - left - right);
  const mid = 95;
  return (
    <figure className="not-prose my-10">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} 190`} className="w-full min-w-[40rem] h-auto" role="img" aria-label="Timeline of the reports of Drebbel’s boat from 1620 to 1695.">
          <line x1={left} x2={width - right} y1={mid} y2={mid} stroke={SOFT} strokeWidth={1} />
          {EVENTS.map((e) => {
            // the first and last labels hang inward so they are not cut at the edges
            const anchor = e.year < 1625 ? 'start' : e.year > 1690 ? 'end' : 'middle';
            const tx = x(e.year) + (anchor === 'start' ? -6 : anchor === 'end' ? 6 : 0);
            const stem = e.tier * 26;
            // labels above sit on top of their stem; labels below hang under it
            const ty = e.tier < 0 ? mid + stem - 18 : mid + stem + 16;
            const dead = e.year === 1633;
            return (
              <Fragment key={e.year}>
                <line x1={x(e.year)} x2={x(e.year)} y1={mid} y2={mid + stem} stroke={dead ? SOFT : INK} strokeWidth={1} />
                <circle cx={x(e.year)} cy={mid} r={dead ? 3 : 4} fill={dead ? HULL : INK} stroke={INK} strokeWidth={1} />
                <text x={tx} y={ty} fontSize={12} fill={INK} textAnchor={anchor}>
                  {e.who}
                </text>
                {e.what && (
                  <text x={tx} y={ty + 13} fontSize={10.5} fill={SOFT} textAnchor={anchor}>
                    {e.what}
                  </text>
                )}
              </Fragment>
            );
          })}
        </svg>
      </div>
      <figcaption className="mt-2 text-sm text-muted leading-relaxed">
        Every report but Beeckman&rsquo;s was written after Drebbel died in 1633, and all of them are
        second-hand.
      </figcaption>
    </figure>
  );
}
