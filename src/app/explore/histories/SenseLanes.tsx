import Link from 'next/link';
import type { ResolvedLanes, ResolvedDot } from './histories';

// A concept's senses over time, one rule per sense (#7623), drawn after the engraved chronological charts of the
// eighteenth century (Priestley's Chart of Biography, 1765): lines of ink on a ruled sheet, names set beside them.
// Server-rendered SVG of plain links, with no client JavaScript: a reader or a crawler gets every mark as an <a>,
// and the hover labels are CSS only.
//
// Marks on a rule, not areas, on purpose. Area would read as how common a sense was, and this data only records what
// we read. For the same reason a stretch of GAP_YEARS or more with no claim is dotted: the line must not imply evidence.

const START = -350;
const BREAK = 1500; // time after this is drawn wider: most of the claims are after it, and the note says so
const END = 2030;
const GAP_YEARS = 200;
// Marks closer than this are nudged along the rule, so two claims of one year both show. Round marks need more room.
const TICK_APART = 3.4;
const ROUND_APART = 7.5;

type Layout = {
  w: number; breakAt: number; pad: number; title: number; small: number; titleChar: number; nameChar: number;
  ticks: number[]; gloss: boolean;
};
// Two drawings rather than one scaled: at phone width the wide one's type would be illegible, and a sideways-scrolling
// chart hides exactly the overlap at the modern end that it exists to show.
const WIDE: Layout = { w: 900, breakAt: 0.36, pad: 14, title: 21, small: 12.5, titleChar: 8.6, nameChar: 6.2, ticks: [-300, 500, 1000, 1500, 1600, 1700, 1800, 1900, 2000], gloss: true };
const SMALL: Layout = { w: 420, breakAt: 0.24, pad: 8, title: 19, small: 12.5, titleChar: 8, nameChar: 6.6, ticks: [-300, 1500, 1700, 1900], gloss: false };

const yearLabel = (y: number) => (y < 0 ? `${-y} BCE` : y === 1 ? '1 CE' : String(y));
const dateLabel = (d: ResolvedDot) => `${d.approx ? 'c. ' : ''}${yearLabel(d.date)}`;
const HALO = { paintOrder: 'stroke' as const, stroke: 'var(--background)', strokeWidth: 4 };
const NAME_LEADING = 14;

function Chart({ data, layout }: { data: ResolvedLanes; layout: Layout }) {
  const { w, breakAt, pad, title, small, titleChar, nameChar, ticks, gloss } = layout;
  const scale = (year: number) => {
    const t = year <= BREAK
      ? ((year - START) / (BREAK - START)) * breakAt
      : breakAt + ((year - BREAK) / (END - BREAK)) * (1 - breakAt);
    return pad + t * (w - pad * 2);
  };

  // Lay every lane out first: its height depends on how many rows of names it needs.
  const AXIS = 30;
  let cursor = AXIS;
  const rows = data.lanes.map((lane) => {
    const labelEnds = [-Infinity, -Infinity];
    const apart = (a: ResolvedDot, aFirst: boolean, b: ResolvedDot) => (aFirst || a.partial || b.partial ? ROUND_APART : TICK_APART);
    const xs: number[] = [];
    lane.dots.forEach((d, i) => { xs[i] = i === 0 ? scale(d.date) : Math.max(scale(d.date), xs[i - 1] + apart(lane.dots[i - 1], i === 1, d)); });
    // nudging can run off the end of the sheet: pull back from the right edge, keeping the spacing
    for (let i = xs.length - 1, limit = w - 6; i >= 0; i--) {
      xs[i] = Math.min(xs[i], limit);
      if (i > 0) limit = xs[i] - apart(lane.dots[i - 1], i === 1, lane.dots[i]);
    }
    const marks = lane.dots.map((d, i) => {
      const x = xs[i];
      const name = d.label === true ? d.who : d.label || '';
      const half = (name.length * nameChar) / 2 + 3; // an estimate: keep clear of the edge and of the next name
      // the first name starts at its mark, so it clears the lane title set to the left of that mark
      const nameX = i === 0 ? x - 2 : Math.min(Math.max(x, half + 5), w - half);
      const from = i === 0 ? nameX : nameX - half;
      const to = i === 0 ? nameX + half * 2 - 6 : nameX + half;
      const nameRow = name ? labelEnds.findIndex((end) => end <= from) : -1;
      if (nameRow >= 0) labelEnds[nameRow] = to + 4;
      return { d, x, name, nameX, nameRow, first: i === 0 };
    });
    const firstX = marks[0].x;
    // A lane that starts late has empty sheet to its left: the title goes there, against its first mark. That is what
    // makes the staircase of new senses legible. A lane that starts early has no room, so its title sits above the rule.
    const beside = Math.max(lane.label.length * titleChar, gloss ? lane.gloss.length * nameChar : 0) < firstX - 22;
    const top = cursor + (lane.apart ? 16 : 0);
    const lineY = top + (beside ? 20 : 40);
    const namedRows = Math.max(...marks.map((m) => m.nameRow)) + 1;
    cursor = lineY + 12 + namedRows * NAME_LEADING + 12;
    return { lane, marks, firstX, beside, top, lineY };
  });
  const height = cursor;

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="block w-full" role="group" aria-label={data.finding}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={scale(t)} x2={scale(t)} y1={AXIS - 8} y2={height} strokeWidth={0.75} style={{ stroke: 'var(--border-light)' }} />
          <text x={t < 0 ? 2 : scale(t)} y={14} textAnchor={t < 0 ? 'start' : 'middle'} fontSize={small + 1.5} className="font-serif" style={{ fill: 'var(--text-muted)', fontVariantNumeric: 'oldstyle-nums' }}>{yearLabel(t)}</text>
        </g>
      ))}
      {rows.map(({ lane, marks, firstX, beside, top, lineY }) => (
        <g key={lane.key}>
          {lane.apart && <line x1={0} x2={w} y1={top - 8} y2={top - 8} strokeWidth={0.75} style={{ stroke: 'var(--text-muted)' }} />}

          <text
            x={beside ? firstX - 16 : 2}
            y={beside ? lineY - (gloss ? 2 : -6) : top + 15}
            textAnchor={beside ? 'end' : 'start'}
            fontSize={title}
            fontWeight={500}
            fontStyle={lane.apart ? 'italic' : undefined}
            className="font-serif"
            style={{ fill: 'var(--text-primary)', ...HALO }}
          >
            {lane.label}
            {gloss && !beside && <tspan dx={10} fontSize={small + 1} fontWeight={400} fontStyle="italic" style={{ fill: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>{lane.gloss}</tspan>}
          </text>
          {gloss && beside && (
            <text x={firstX - 16} y={lineY + 14} textAnchor="end" fontSize={small + 1} fontStyle="italic" style={{ fill: 'var(--text-muted)', fontFamily: 'var(--font-body)', ...HALO }}>{lane.gloss}</text>
          )}

          {marks.slice(1).map((m, i) => {
            const prev = marks[i];
            const gap = m.d.date - prev.d.date >= GAP_YEARS;
            return (
              <line
                key={`${m.d.c}:${m.d.id}`}
                x1={prev.x} x2={m.x} y1={lineY} y2={lineY}
                strokeWidth={gap ? 1 : 1.25}
                strokeLinecap="round"
                strokeDasharray={gap ? '0.5 4.5' : undefined}
                style={{ stroke: 'var(--text-primary)' }}
              />
            );
          })}

          {marks.map(({ d, x, name, nameX, nameRow, first }) => (
            <a key={`${d.c}:${d.id}`} href={d.href} className="group outline-none" style={{ textDecoration: 'none' }}>
              <title>{`${d.who}, ${dateLabel(d)}${d.partial ? ' (partly supported)' : ''}. ${d.statement}`}</title>
              <rect x={x - 7} y={lineY - 12} width={14} height={24} fill="transparent" />
              {first ? (
                <circle cx={x} cy={lineY} r={4.75} strokeWidth={1.25} className={`[stroke:var(--text-primary)] ${d.partial ? '[fill:var(--background)]' : '[fill:var(--accent-gold)]'} group-hover:[fill:var(--accent-gold-dark)] group-focus-visible:[fill:var(--accent-gold-dark)]`} />
              ) : d.partial ? (
                <circle cx={x} cy={lineY} r={3.25} strokeWidth={1.25} className="[fill:var(--background)] [stroke:var(--text-primary)] group-hover:[stroke:var(--accent-gold-dark)] group-focus-visible:[stroke:var(--accent-gold-dark)]" />
              ) : (
                <line x1={x} x2={x} y1={lineY - 6} y2={lineY + 6} strokeWidth={1.5} className="[stroke:var(--text-primary)] group-hover:[stroke:var(--accent-gold-dark)] group-hover:[stroke-width:2.5] group-focus-visible:[stroke:var(--accent-gold-dark)] group-focus-visible:[stroke-width:2.5]" />
              )}
              {name && nameRow >= 0 && (
                <text x={nameX} y={lineY + 22 + nameRow * NAME_LEADING} textAnchor={first ? 'start' : 'middle'} fontSize={small} style={{ fill: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>
                  {name}
                </text>
              )}
              {/* every mark says who and when on hover or keyboard focus */}
              <text
                x={Math.min(Math.max(x, 110), w - 110)}
                y={lineY - 9}
                textAnchor="middle"
                fontSize={small + 1}
                fontWeight={600}
                className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 pointer-events-none"
                style={{ fill: 'var(--text-primary)', fontFamily: 'var(--font-body)', ...HALO }}
              >
                {`${d.who}, ${dateLabel(d)}`}
              </text>
            </a>
          ))}
        </g>
      ))}
    </svg>
  );
}

/** One entry in the key, drawn with the same mark the chart uses. */
function KeyMark({ children, mark }: { children: React.ReactNode; mark: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <svg viewBox="0 0 24 16" width={24} height={16} aria-hidden="true" className="shrink-0">{mark}</svg>
      <span>{children}</span>
    </li>
  );
}

const RULE = { stroke: 'var(--text-primary)' };

export default function SenseLanes({ data }: { data: ResolvedLanes }) {
  return (
    <figure className="not-prose">
      <figcaption className="mb-6">
        <h2 className="font-serif text-3xl mb-2" style={{ color: 'var(--text-primary)' }}>{data.title}</h2>
        <p className="font-body text-lg leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{data.finding}</p>
      </figcaption>

      <div className="md:hidden"><Chart data={data} layout={SMALL} /></div>
      {/* wider than the reading column, centred on it: the modern end is where the senses overlap */}
      <div className="hidden md:block relative left-1/2 -translate-x-1/2 w-[min(calc(100vw-2rem),980px)]"><Chart data={data} layout={WIDE} /></div>

      <ul className="mt-6 grid gap-x-6 gap-y-2 sm:grid-cols-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
        <KeyMark mark={<><line x1={0} x2={24} y1={8} y2={8} strokeWidth={1.25} style={RULE} /><circle cx={12} cy={8} r={4.75} strokeWidth={1.25} style={{ ...RULE, fill: 'var(--accent-gold)' }} /></>}>Earliest claim in this history</KeyMark>
        <KeyMark mark={<><line x1={0} x2={24} y1={8} y2={8} strokeWidth={1.25} style={RULE} /><line x1={12} x2={12} y1={2} y2={14} strokeWidth={1.5} style={RULE} /></>}>A claim</KeyMark>
        <KeyMark mark={<><line x1={0} x2={24} y1={8} y2={8} strokeWidth={1.25} style={RULE} /><circle cx={12} cy={8} r={3.25} strokeWidth={1.25} style={{ ...RULE, fill: 'var(--background)' }} /></>}>A claim only partly supported by its page</KeyMark>
        <KeyMark mark={<line x1={1} x2={23} y1={8} y2={8} strokeWidth={1} strokeLinecap="round" strokeDasharray="0.5 4.5" style={RULE} />}>Nothing found for {GAP_YEARS} years or more in what we read</KeyMark>
      </ul>
      <p className="text-sm leading-relaxed mt-4" style={{ color: 'var(--text-muted)' }}>
        Open any mark for the claim and the page it quotes. A line runs from a sense’s earliest claim here to its latest,
        people arguing against it included. It does not show a sense’s first use, or how common it was. Time before 1500 is
        compressed.
      </p>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm" style={{ color: 'var(--text-secondary)' }}>Every claim on this chart, as a list</summary>
        <div className="mt-4 space-y-6">
          {data.lanes.map((lane) => (
            <section key={lane.key}>
              <h3 className="font-serif text-lg" style={{ color: 'var(--text-primary)' }}>{lane.label}</h3>
              <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>{lane.gloss}</p>
              <ul className="space-y-2">
                {lane.dots.map((d) => (
                  <li key={`${d.c}:${d.id}`} className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    <Link href={d.href}>{d.who}, {dateLabel(d)}</Link>
                    {d.partial ? ' (partly supported)' : ''}. {d.statement}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </details>
    </figure>
  );
}
