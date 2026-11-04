import Link from 'next/link';
import type { ResolvedLanes, ResolvedDot } from './histories';

// A concept's senses over time, one lane per sense (#7623). Server-rendered SVG of plain links, with no client
// JavaScript: a reader or a crawler gets every dot as an <a>, and the hover labels are CSS only.
//
// Dots, not areas, on purpose. Area would read as how common a sense was, and this data only records what we read.
// For the same reason a stretch of GAP_YEARS or more with no claim is dashed: the line must not imply evidence.

const START = -350;
const BREAK = 1500; // time after this is drawn wider: most of the claims are after it, and the caption says so
const END = 2030;
const GAP_YEARS = 200;

type Layout = {
  w: number; row: number; breakAt: number; pad: number; r: number; font: number; char: number;
  ticks: number[]; gloss: boolean; tag: 'wide' | 'small';
};
// Two drawings rather than one scaled: at phone width the wide one's type would be illegible, and a sideways-scrolling
// chart hides exactly the overlap at the modern end that it exists to show.
const WIDE: Layout = { w: 900, row: 74, breakAt: 0.36, pad: 14, r: 4.5, font: 11, char: 6, ticks: [-300, 1, 500, 1000, 1500, 1600, 1700, 1800, 1900, 2000], gloss: true, tag: 'wide' };
const SMALL: Layout = { w: 420, row: 70, breakAt: 0.24, pad: 8, r: 3.5, font: 12, char: 6.8, ticks: [-300, 1500, 1700, 1900], gloss: false, tag: 'small' };

const yearLabel = (y: number) => (y < 0 ? `${-y} BCE` : y === 1 ? '1 CE' : String(y));
const dateLabel = (d: ResolvedDot) => `${d.approx ? 'c. ' : ''}${yearLabel(d.date)}`;

function Chart({ data, layout }: { data: ResolvedLanes; layout: Layout }) {
  const { w, row, breakAt, pad, r, font, char, ticks, gloss } = layout;
  const AXIS = 24;
  const height = AXIS + data.lanes.length * row + 12;
  const scale = (year: number) => {
    const t = year <= BREAK
      ? ((year - START) / (BREAK - START)) * breakAt
      : breakAt + ((year - BREAK) / (END - BREAK)) * (1 - breakAt);
    return pad + t * (w - pad * 2);
  };

  /** Close dots sit above or below the lane line; a name that fits neither label row is left to hover and the list. */
  const place = (dots: ResolvedDot[]) => {
    const dotEnds = [-Infinity, -Infinity, -Infinity];
    const labelEnds = [-Infinity, -Infinity];
    return dots.map((d) => {
      const x = scale(d.date);
      let level = dotEnds.findIndex((end) => end <= x - r * 2);
      if (level < 0) level = 0;
      dotEnds[level] = x;
      let labelRow = -1;
      let labelX = x;
      const name = d.label === true ? d.who : d.label || '';
      if (name) {
        const half = (name.length * char) / 2 + 3; // the width is an estimate: keep clear of the edge
        labelX = Math.min(Math.max(x, half), w - half);
        labelRow = labelEnds.findIndex((end) => end <= labelX - half);
        if (labelRow >= 0) labelEnds[labelRow] = labelX + half + 6;
      }
      return { d, x, dy: [0, -(r + 3.5), r + 3.5][level], name, labelRow, labelX };
    });
  };

  let y = AXIS;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="block w-full" role="group" aria-label={data.finding}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={scale(t)} x2={scale(t)} y1={AXIS - 4} y2={height - 12} style={{ stroke: 'var(--border-light)' }} strokeWidth={1} />
          <text x={Math.max(scale(t), 24)} y={12} textAnchor="middle" fontSize={font} style={{ fill: 'var(--text-muted)' }}>{yearLabel(t)}</text>
        </g>
      ))}
      {data.lanes.map((lane) => {
        const top = y;
        y += row;
        const lineY = top + 34;
        return (
          <g key={lane.key}>
            {lane.apart && <line x1={0} x2={w} y1={top + 1} y2={top + 1} style={{ stroke: 'var(--border-medium)' }} strokeWidth={1} strokeDasharray="4 3" />}
            <text x={2} y={top + 15} fontSize={font + 2} fontWeight={600} style={{ fill: 'var(--text-primary)', paintOrder: 'stroke', stroke: 'var(--bg-primary, var(--bg-white))', strokeWidth: 3 }}>
              {lane.label}
              {gloss && <tspan fontWeight={400} fontSize={font + 1} dx={8} style={{ fill: 'var(--text-muted)' }}>{lane.gloss}</tspan>}
            </text>
            {lane.dots.slice(1).map((d, i) => {
              const prev = lane.dots[i];
              return (
                <line
                  key={`${d.c}:${d.id}`}
                  x1={scale(prev.date)} x2={scale(d.date)} y1={lineY} y2={lineY}
                  strokeWidth={1.5}
                  strokeDasharray={d.date - prev.date >= GAP_YEARS ? '2 4' : undefined}
                  style={{ stroke: 'var(--text-muted)' }}
                />
              );
            })}
            {place(lane.dots).map(({ d, x, dy, name, labelRow, labelX }) => (
              <a key={`${d.c}:${d.id}`} href={d.href} className="group outline-none" style={{ textDecoration: 'none' }}>
                <title>{`${d.who}, ${dateLabel(d)}${d.partial ? ' (partly supported)' : ''}. ${d.statement}`}</title>
                <circle cx={x} cy={lineY + dy} r={r + 6} fill="transparent" />
                <circle
                  cx={x}
                  cy={lineY + dy}
                  r={r}
                  strokeWidth={1.5}
                  className="group-focus-visible:stroke-[3px]"
                  style={{ fill: d.partial ? 'var(--bg-primary, var(--bg-white))' : 'var(--text-primary)', stroke: 'var(--text-primary)' }}
                />
                {name && labelRow >= 0 && (
                  <text x={labelX} y={lineY + 21 + labelRow * 13} textAnchor="middle" fontSize={font} style={{ fill: 'var(--text-secondary)' }}>
                    {name}
                  </text>
                )}
                {/* every dot says who and when on hover or keyboard focus */}
                <text
                  x={Math.min(Math.max(x, 90), w - 90)}
                  y={lineY - 11}
                  textAnchor="middle"
                  fontSize={font + 1}
                  fontWeight={600}
                  className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 pointer-events-none"
                  style={{ fill: 'var(--text-primary)', paintOrder: 'stroke', stroke: 'var(--bg-primary, var(--bg-white))', strokeWidth: 4 }}
                >
                  {`${d.who}, ${dateLabel(d)}`}
                </text>
              </a>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export default function SenseLanes({ data }: { data: ResolvedLanes }) {
  return (
    <figure className="not-prose">
      <figcaption className="mb-4">
        <h2 className="font-serif text-2xl mb-2" style={{ color: 'var(--text-primary)' }}>{data.title}</h2>
        <p className="font-body text-lg leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{data.finding}</p>
      </figcaption>

      <div className="md:hidden"><Chart data={data} layout={SMALL} /></div>
      {/* wider than the reading column, centred on it: the modern end is where the senses overlap */}
      <div className="hidden md:block relative left-1/2 -translate-x-1/2 w-[min(calc(100vw-2rem),980px)]"><Chart data={data} layout={WIDE} /></div>

      <p className="text-sm leading-relaxed mt-4" style={{ color: 'var(--text-muted)' }}>
        Each dot is one claim in this history, placed at the date of the text or thinker it cites. Open a dot for the claim
        and the page it quotes. A hollow dot is a claim only partly supported by its page. Each line runs from a sense’s
        earliest dot to its latest, and it includes people arguing against that sense. Those are the earliest and latest
        claims in this history, not the first and last uses of the sense, and the line does not show how common it was.
        A dashed stretch means we found nothing for {GAP_YEARS} years or more in what we read, not that the sense had
        gone. Time after 1500 is drawn wider than time before it.
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
